'use strict';
// section 4.8: forward log + outcome job. Every explain event gets one row in forward_log.jsonl at
// CREATION (price of the coin and of BTC at that moment, plus the instrument used). An hourly job fills
// d1 / d7 / d30 once each horizon has passed: the coin's move and its move relative to BTC.
//   - A horizon is measured at its own timestamp: the current price only when the job runs within a short
//     grace window of the horizon; later it reads the exact historical observation (public klines, read-only,
//     polite); with no historical source the horizon is marked missing. A later price never stands in for it.
//   - Missing is explicit: { missing: true, reason } (bounded retries for unavailable instruments).
//   - Rows are appended; for each event_id the LAST line wins. Completed rows older than 60 days are moved
//     into monthly archive files; the live file is re-read only when its size/mtime changes.
//   - run() is single-flight and record() is per-event single-flight; every read-modify-append is synchronous.
const fs = require('fs');
const path = require('path');
const { etDay } = require('./timeET');

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const HORIZONS = [['d1', 1], ['d7', 7], ['d30', 30]];
const GRACE_MS = 2 * HOUR;            // current price is acceptable within this window after a horizon
const MAX_TRIES = 6;                  // hourly retries before a horizon is marked unavailable
const BASELINE_MAX_DELAY_MS = 10 * 60e3; // a baseline read later than this after creation is not a creation price
const ARCHIVE_AFTER_MS = 60 * DAY;
const UNLIVE_EXPIRE_MS = 2 * DAY;
const COMPLETED = new Set(['done', 'no_price', 'expired']);
const r1 = (n) => Math.round(Number(n) * 10) / 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// "1000PEPE" / "1MBABYDOGE" -> "PEPE" / "BABYDOGE"
function baseTicker(ticker) {
  return String(ticker).toUpperCase().replace(/^(1000000|1000|1M)(?=[A-Z])/, '');
}
// Contract symbol -> units per contract (1000PEPEUSDT = 1000).
function multOf(symbol) {
  const m = /^(1000000|1000|1M)(?=[A-Z])/.exec(String(symbol).toUpperCase());
  if (!m) return 1;
  return m[1] === '1000' ? 1000 : 1e6;
}
function candidates(ticker) {
  const b = baseTicker(ticker);
  return [`${b}USDT`, `1000${b}USDT`, `1000000${b}USDT`, `1M${b}USDT`];
}

// priceFn(ticker, instrument?) -> { price, instrument } | null. Prices are per single unit (1000-contracts divided
// by 1000). With `instrument` only that contract is asked, so a baseline and a later read can never use different
// contracts. priceFn.at(instrumentOrTicker, tsMs) -> price at that minute | null (klines, open of the minute).
function makePriceFn(request, { gapMs = 250, sleepFn = sleep } = {}) {
  let last = 0;
  async function polite() {
    const wait = last + gapMs - Date.now();
    last = Math.max(Date.now(), last + gapMs);
    if (wait > 0) await sleepFn(wait);
  }
  async function getJson(url) {
    await polite();
    return (await request(url)).json();
  }
  async function price(ticker, instrument) {
    const syms = instrument ? [instrument] : candidates(ticker);
    for (const sym of syms) {
      try {
        const j = await getJson(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${sym}`);
        const p = Number(j && j.price);
        if (p > 0 && Number.isFinite(p)) return { price: p / multOf(sym), instrument: sym };
      } catch (e) { /* try the next symbol */ }
    }
    return null;
  }
  price.at = async function at(instrumentOrTicker, ts) {
    const s = String(instrumentOrTicker).toUpperCase();
    const syms = /USDT$/.test(s) ? [s] : candidates(s);
    for (const sym of syms) {
      try {
        const j = await getJson(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1m&startTime=${Math.floor(ts)}&limit=1`);
        const k = Array.isArray(j) ? j[0] : null;
        if (!k || Math.abs(Number(k[0]) - ts) > 2 * 60e3) continue;
        const p = Number(k[1]);
        if (p > 0 && Number.isFinite(p)) return p / multOf(sym);
      } catch (e) { /* try the next symbol */ }
    }
    return null;
  };
  return price;
}

// priceFn may return a bare number (tests / legacy) or { price, instrument }.
function norm(q) {
  if (q && typeof q === 'object') {
    const p = Number(q.price);
    return p > 0 && Number.isFinite(p) ? { price: p, instrument: q.instrument || null } : null;
  }
  const p = Number(q);
  return p > 0 && Number.isFinite(p) ? { price: p, instrument: null } : null;
}

function createOutcomes({ dir, now = () => Date.now(), priceFn, priceAtFn = null, log = (m) => console.log(m), maxTries = MAX_TRIES, graceMs = GRACE_MS, archiveAfterMs = ARCHIVE_AFTER_MS }) {
  const file = path.join(dir, 'forward_log.jsonl');
  const archiveFile = (ym) => path.join(dir, `forward_log.archive.${ym}.jsonl`);
  const at = priceAtFn || (priceFn && priceFn.at) || null;

  const sigOf = (f) => { try { const st = fs.statSync(f); return `${st.size}:${st.mtimeMs}`; } catch (e) { return null; } };
  function parseFile(f) {
    const m = new Map();
    try {
      for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { const r = JSON.parse(line); if (r && r.event_id) m.set(r.event_id, r); } catch (e) { /* skip a torn line */ }
      }
    } catch (e) { /* no file yet */ }
    return m;
  }

  // mtime/size cache: the file is re-parsed only when it changed.
  let cache = { sig: null, map: null };
  let parses = 0;
  function load() {
    const s = sigOf(file);
    if (cache.map && cache.sig === s) return cache.map;
    parses++;
    cache = { sig: s, map: parseFile(file) };
    return cache.map;
  }
  const all = () => [...load().values()];
  const latest = (id) => load().get(id) || null;
  function append(row) {
    fs.mkdirSync(dir, { recursive: true });
    const before = sigOf(file);
    const was = cache.map && cache.sig === before;
    fs.appendFileSync(file, JSON.stringify(row) + '\n');
    if (was) { cache.map.set(row.event_id, row); cache.sig = sigOf(file); }
  }

  // ----- archive -----
  const archCache = new Map(); // file -> { sig, map }
  function archiveFiles() {
    try { return fs.readdirSync(dir).filter((n) => /^forward_log\.archive\.\d{4}-\d{2}\.jsonl$/.test(n)).sort().map((n) => path.join(dir, n)); } catch (e) { return []; }
  }
  function readArchive(f) {
    const s = sigOf(f);
    const c = archCache.get(f);
    if (c && c.sig === s) return c.map;
    const map = parseFile(f);
    archCache.set(f, { sig: s, map });
    return map;
  }
  // Live rows plus archived ones (the live file wins on a duplicate id). Used by the monthly base-rate rebuild.
  function allWithArchive() {
    const m = new Map();
    for (const f of archiveFiles()) for (const [id, r] of readArchive(f)) m.set(id, r);
    for (const [id, r] of load()) m.set(id, r);
    return [...m.values()];
  }

  // Move completed rows older than archiveAfterMs into monthly archive files, and rewrite the live file with
  // one line per remaining event. Synchronous, so nothing interleaves with it. Returns archived row count.
  let lastCompact = 0;
  function compact({ force = false } = {}) {
    const t = now();
    if (!force && t - lastCompact < DAY) return 0;
    lastCompact = t;
    const rows = all();
    const old = rows.filter((r) => COMPLETED.has(r.status) && Date.parse(r.t0) < t - archiveAfterMs);
    const bytes = (() => { try { return fs.statSync(file).size; } catch (e) { return 0; } })();
    if (!old.length && bytes < 512 * 1024) return 0;
    const byMonth = new Map();
    for (const r of old) {
      const ym = new Date(Date.parse(r.t0)).toISOString().slice(0, 7);
      (byMonth.get(ym) || byMonth.set(ym, []).get(ym)).push(r);
    }
    for (const [ym, rs] of byMonth) {
      const f = archiveFile(ym);
      const have = parseFile(f);
      const fresh = rs.filter((r) => !have.has(r.event_id));
      if (fresh.length) fs.appendFileSync(f, fresh.map((r) => JSON.stringify(r)).join('\n') + '\n');
    }
    const oldIds = new Set(old.map((r) => r.event_id));
    const keep = rows.filter((r) => !oldIds.has(r.event_id));
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, keep.map((r) => JSON.stringify(r)).join('\n') + (keep.length ? '\n' : ''));
    fs.renameSync(tmp, file);
    cache = { sig: null, map: null };
    if (old.length) log(`[explain] forward log: archived ${old.length} completed rows`);
    return old.length;
  }

  // ----- baseline at creation -----
  const inflight = new Map(); // event_id -> promise
  function record(ev) {
    if (latest(ev.id)) return Promise.resolve(null);
    if (inflight.has(ev.id)) return inflight.get(ev.id);
    const p = recordInner(ev).finally(() => inflight.delete(ev.id));
    inflight.set(ev.id, p);
    return p;
  }
  async function recordInner(ev) {
    const t0 = ev.created_at || ev.live_at;
    const btc = norm(await priceFn('BTC'));
    const coin = ev.coin ? norm(await priceFn(ev.coin.ticker)) : btc;
    const readAt = now();
    const late = !(readAt - Date.parse(t0) <= BASELINE_MAX_DELAY_MS);
    const ok = !!(btc && coin) && !late;
    const row = {
      event_id: ev.id, category: ev.category, subtype: ev.subtype, coin: ev.coin ? ev.coin.ticker : null,
      headline: ev.facts && ev.facts.headline, date: etDay(t0), t0, live: !!ev.live_at, live_at: ev.live_at || null,
      p0: ok ? coin.price : null, btc0: ok ? btc.price : null, p0_at: new Date(readAt).toISOString(),
      instr: ok && ev.coin ? coin.instrument : null, btc_instr: ok ? btc.instrument : null,
      d1: null, d7: null, d30: null, tries: {},
      status: ok ? 'open' : 'no_price',
    };
    if (!ok) row.reason = late ? 'baseline_not_at_creation' : 'no_price';
    if (latest(ev.id)) return null; // raced with another writer; no await since the check
    append(row);
    if (!ok) log(`[explain] forward log: no creation price for ${ev.id} (${row.reason})`);
    return row;
  }

  // A queued event was promoted: its measurements stay anchored to creation. An event without a creation
  // baseline (created before this logic) gets an explicit no_price row; later prices never stand in.
  async function markLive(ev) {
    if (inflight.has(ev.id)) await inflight.get(ev.id).catch(() => {});
    const cur = latest(ev.id);
    if (!cur) {
      append({ event_id: ev.id, category: ev.category, subtype: ev.subtype, coin: ev.coin ? ev.coin.ticker : null, headline: ev.facts && ev.facts.headline, date: etDay(ev.created_at), t0: ev.created_at, live: true, live_at: ev.live_at || null, p0: null, btc0: null, instr: null, btc_instr: null, d1: null, d7: null, d30: null, tries: {}, status: 'no_price', reason: 'no_creation_baseline' });
      return null;
    }
    if (cur.live === false) { const row = { ...cur, live: true, live_at: ev.live_at || new Date(now()).toISOString() }; append(row); return row; }
    return null;
  }

  // ----- horizons -----
  let runP = null;
  function run() {
    if (runP) return runP;
    runP = runInner().finally(() => { runP = null; });
    return runP;
  }

  async function runInner() {
    const t = now();
    compact();
    let resolved = 0;
    const memoNow = new Map(); // instrument key -> quote, once per run
    const memoAt = new Map();  // `${instr}@${ts}` -> price | null
    const quoteNow = async (ticker, instr) => {
      const k = ticker + '|' + (instr || '');
      if (!memoNow.has(k)) memoNow.set(k, norm(await priceFn(ticker, instr || undefined)));
      return memoNow.get(k);
    };
    const quoteAt = async (instr, ts) => {
      const k = instr + '@' + ts;
      if (!memoAt.has(k)) { let p = null; try { p = await at(instr, ts); } catch (e) { p = null; } memoAt.set(k, p > 0 && Number.isFinite(p) ? p : null); }
      return memoAt.get(k);
    };

    for (const snap of all()) {
      if (snap.status !== 'open') continue;
      if (snap.live === false) {
        if (t - Date.parse(snap.t0) > UNLIVE_EXPIRE_MS) { append({ ...snap, status: 'expired' }); resolved++; }
        continue;
      }
      const t0ms = Date.parse(snap.t0);
      const due = HORIZONS.filter(([h, days]) => snap[h] == null && t >= t0ms + days * DAY);
      if (!due.length) continue;
      const cells = {};
      const tries = { ...(snap.tries || {}) };
      for (const [h, days] of due) {
        const target = t0ms + days * DAY;
        let obs = null;
        let missing = null;
        if (t - target <= graceMs) {
          const b = await quoteNow('BTC', snap.btc_instr);
          const c = snap.coin ? await quoteNow(snap.coin, snap.instr) : b;
          const same = b && c && (!snap.btc_instr || !b.instrument || b.instrument === snap.btc_instr) && (!snap.instr || !c.instrument || c.instrument === snap.instr);
          if (b && c && !same) missing = 'instrument_mismatch';
          else if (b && c) obs = { p: c.price, btc: b.price, t: new Date(t).toISOString(), instr: c.instrument };
        } else if (at) {
          const bi = snap.btc_instr || 'BTC';
          const ci = snap.coin ? (snap.instr || snap.coin) : bi;
          const b = await quoteAt(bi, target);
          const c = snap.coin ? await quoteAt(ci, target) : b;
          if (b && c) obs = { p: c, btc: b, t: new Date(target).toISOString(), instr: snap.instr };
        } else {
          missing = 'missed_horizon';
        }
        // Rows without a recorded instrument cannot prove the contract is the same: reject absurd ratios.
        if (obs && !snap.instr && snap.coin) {
          const ratio = obs.p / snap.p0;
          if (!(ratio > 1 / 200 && ratio < 200)) { obs = null; missing = 'instrument_unverified'; }
        }
        if (obs) {
          const ret = (obs.p / snap.p0 - 1) * 100;
          const btcRet = (obs.btc / snap.btc0 - 1) * 100;
          cells[h] = { t: obs.t, target: new Date(target).toISOString(), p: obs.p, btc: obs.btc, ret: r1(ret), ret_vs_btc: r1(ret - btcRet) };
        } else if (missing) {
          cells[h] = { missing: true, reason: missing, t: new Date(t).toISOString() };
        } else {
          tries[h] = (tries[h] || 0) + 1;
          if (tries[h] >= maxTries) cells[h] = { missing: true, reason: 'unavailable', t: new Date(t).toISOString() };
        }
      }
      const cur = latest(snap.event_id) || snap;
      const row = JSON.parse(JSON.stringify(cur));
      let changed = false;
      for (const [h, cell] of Object.entries(cells)) {
        if (row[h] == null) { row[h] = cell; resolved++; changed = true; }
      }
      if (JSON.stringify(tries) !== JSON.stringify(row.tries || {})) { row.tries = tries; changed = true; }
      if (row.d30 != null) row.status = 'done';
      if (changed) append(row);
    }
    return resolved;
  }

  return { record, markLive, run, all, allWithArchive, compact, file, _parses: () => parses };
}

module.exports = { createOutcomes, makePriceFn, baseTicker, multOf, HORIZONS, MAX_TRIES };

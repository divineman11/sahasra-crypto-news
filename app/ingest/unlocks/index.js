'use strict';
// Unlock calendar service: fetch (every 6h, politely), aggregate, write view.json, optional Discord
// reminders 7/2/1 days before a SUPPLY SHOCK, optional weekly AI cross-check.
const agg = require('./aggregate');
const sources = require('./sources');
const store = require('./store');
const crosscheck = require('./crosscheck');
const { loadTracked } = require('./tracked');

const HOUR = 3600e3;
const DAY_MS = 24 * HOUR;
const REFRESH_MS = 6 * HOUR; // one page per source per run, every 6h
const TICK_MS = 15 * 60e3; // wake-up cadence; each source keeps its own next-attempt time
const BACKOFF_BASE_MS = 15 * 60e3;
const CROSSCHECK_EVERY_MS = 7 * DAY_MS;
const ALERT_STEPS = [7, 2, 1];

const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

function srcState(st, name) {
  if (!st.sources[name]) st.sources[name] = { lastOkAt: 0, lastAttemptAt: 0, lastError: null, lastErrorAt: 0, fails: 0, nextAt: 0, count: 0 };
  return st.sources[name];
}
function markOk(s, nowMs, count) {
  Object.assign(s, { lastOkAt: nowMs, lastAttemptAt: nowMs, lastError: null, fails: 0, nextAt: nowMs + REFRESH_MS, count });
}
function markFail(s, nowMs, msg) {
  s.fails = (s.fails || 0) + 1;
  Object.assign(s, { lastAttemptAt: nowMs, lastError: String(msg).slice(0, 300), lastErrorAt: nowMs, nextAt: nowMs + Math.min(REFRESH_MS, BACKOFF_BASE_MS * 2 ** (s.fails - 1)) });
}

/**
 * Pure: which Discord reminders are due now. A reminder for a SUPPLY SHOCK goes out at 7, 2 and 1 days before.
 * If we only notice it at 1 day left, only the 1-day reminder is sent (the older steps are marked done).
 * @returns [{key, step, item, daysLeft, markKeys:[...]}]
 */
function dueAlerts(view, sent, nowMs) {
  const out = [];
  for (const u of view.upcoming || []) {
    if (!u.supplyShock || u.ts * 1000 <= nowMs) continue;
    const daysLeft = Math.ceil((u.ts * 1000 - nowMs) / DAY_MS);
    const crossed = ALERT_STEPS.filter((s) => daysLeft <= s);
    if (!crossed.length) continue;
    const step = Math.min(...crossed);
    const keys = crossed.map((s) => `${u.symbol}|${u.ts}|${s}`);
    if (sent[`${u.symbol}|${u.ts}|${step}`]) continue;
    out.push({ key: `${u.symbol}|${u.ts}|${step}`, step, item: u, daysLeft, markKeys: keys });
  }
  return out;
}

const fmtTokens = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n)));

function alertText(a) {
  const u = a.item;
  const pct = u.pctCirc != null ? `${Math.round(u.pctCirc * 10) / 10}% of circulating supply` : 'a large share of supply';
  const toks = u.tokens ? ` (about ${fmtTokens(u.tokens)} ${u.symbol})` : '';
  const when = a.daysLeft <= 1 ? 'within a day' : `in ${a.daysLeft} days`;
  const dis = u.disagree ? `\nNote: sources disagree on the size (${u.disagree.badge}).` : '';
  return `**SUPPLY SHOCK ${u.symbol}**: ${pct}${toks} unlocks ${when}, on ${agg.etDate(u.ts)} (ET).${dis}\nThis is a news explanation, not financial advice.`;
}

/** Drop cross-check rows that are stale or that our calendar now covers. */
function visibleCrosscheck(cc, upcoming, nowS) {
  const items = (cc.items || []).filter((it) => {
    const ts = Date.parse(it.date + 'T00:00:00Z') / 1000;
    if (ts < nowS - DAY_MS / 1000) return false;
    if (it.kind === 'missing' && upcoming.some((u) => u.symbol === it.symbol && Math.abs(u.ts - ts) <= agg.CLUSTER_S)) return false;
    return true;
  });
  return { lastRunAt: cc.lastRunAt || 0, lastOkAt: cc.lastOkAt || 0, lastError: cc.lastError || null, items };
}

function createService(opts = {}) {
  const env = opts.env || process.env;
  const dir = opts.dir || store.dirOf(env);
  const nowFn = opts.now || (() => Date.now());
  const log = opts.log || ((m) => console.log(m));
  const request = opts.request || sources.httpsRequest;
  const alerts = opts.alerts || null;
  const runCmd = opts.runCommand || crosscheck.runCommand;
  const trackedFn = opts.loadTracked || (() => loadTracked(env));
  let running = false;
  let timer = null;

  function rebuild(st) {
    const nowMs = nowFn();
    const supply = Object.entries(st.supply).map(([id, s]) => ({ id, ...s }));
    const base = agg.buildView({ rows: st.rows, supply, nowS: Math.floor(nowMs / 1000) });
    const view = Object.assign(base, {
      crosscheck: Object.assign({ enabled: !!env.UNLOCK_CROSSCHECK_CMD }, visibleCrosscheck(st.crosscheck, base.upcoming, Math.floor(nowMs / 1000))),
      sources: Object.fromEntries(Object.entries(st.sources).map(([k, s]) => [k, { lastOkAt: s.lastOkAt, lastError: s.lastError, lastErrorAt: s.lastErrorAt, fails: s.fails, count: s.count }])),
    });
    store.saveView(dir, view);
    return view;
  }

  async function refreshDefiLlama(st, tracked) {
    const s = srcState(st, 'defillama');
    if (nowFn() < s.nextAt) return;
    const nowMs = nowFn();
    try {
      const r = await sources.fetchDefiLlama(request, tracked, Math.floor(nowMs / 1000));
      const nowS = Math.floor(nowMs / 1000);
      st.rows = st.rows.filter((x) => x.source !== 'defillama' && x.ts >= nowS - 7 * 86400).concat(r.rows);
      for (const sr of r.supply) {
        const cur = st.supply[sr.id];
        if (!cur) st.supply[sr.id] = { symbol: sr.symbol, name: sr.name, circ: sr.circ, total: null, max: sr.max, tgeS: sr.tgeS, source: 'llama', updatedMs: nowMs };
        else {
          cur.tgeS = sr.tgeS || cur.tgeS || null;
          cur.name = cur.name || sr.name;
          if (cur.source === 'llama') Object.assign(cur, { circ: sr.circ, max: sr.max, updatedMs: nowMs }); // llama never overwrites CoinGecko
        }
      }
      markOk(s, nowMs, r.rows.length);
      log(`[unlocks] DefiLlama: ${r.rows.length} events for ${r.supply.length} tracked coins`);
    } catch (e) {
      markFail(s, nowMs, e.message || e);
      log(`[unlocks] DefiLlama failed (keeping old data, retry in ${Math.round((s.nextAt - nowMs) / 60000)} min): ${e.message || e}`);
    }
  }

  async function refreshTokenomics(st, tracked) {
    const s = srcState(st, 'tokenomics');
    if (nowFn() < s.nextAt) return;
    const nowMs = nowFn();
    try {
      const r = await sources.fetchTokenomics(request, tracked.isTracked, Math.floor(nowMs / 1000));
      st.rows = st.rows.filter((x) => x.source !== 'tokenomics').concat(r.rows);
      markOk(s, nowMs, r.rows.length);
      log(`[unlocks] Tokenomics: ${r.rows.length} events`);
    } catch (e) {
      markFail(s, nowMs, e.message || e);
      log(`[unlocks] Tokenomics failed (keeping old data): ${e.message || e}`);
    }
  }

  async function refreshSupply(st, tracked) {
    const s = srcState(st, 'coingecko');
    if (env.COINGECKO_SUPPLY === '0') return;
    const nowMs = nowFn();
    if (nowMs < s.nextAt || nowMs - s.lastOkAt < DAY_MS) return;
    const today = utcDay(nowMs);
    if (s.callsDay !== today) { s.callsDay = today; s.callsUsed = 0; }
    const budget = { callsLeft: sources.GECKO_MAX_CALLS_PER_DAY - (s.callsUsed || 0) };
    if (budget.callsLeft <= 0) return;
    const ids = Object.keys(st.supply).filter((id) => tracked.idToSym.has(id) || tracked.trackAll);
    if (!ids.length) return;
    const idToSym = tracked.trackAll ? { get: (id) => (st.supply[id] ? st.supply[id].symbol : null) } : tracked.idToSym;
    const r = await sources.fetchSupply(request, ids, idToSym, budget);
    s.callsUsed = (s.callsUsed || 0) + r.calls;
    if (r.failed || !r.supply.length) {
      markFail(s, nowMs, r.failed || 'CoinGecko returned no supply rows');
      s.nextAt = Math.max(s.nextAt, nowMs + 2 * HOUR);
      log(`[unlocks] CoinGecko supply failed: ${s.lastError}`);
      return;
    }
    for (const g of r.supply) {
      const cur = st.supply[g.id] || { symbol: idToSym.get(g.id), tgeS: null };
      st.supply[g.id] = Object.assign(cur, { circ: g.circ, total: g.total, max: g.max, source: 'coingecko', updatedMs: nowMs });
    }
    markOk(s, nowMs, r.supply.length);
    s.nextAt = nowMs + DAY_MS;
    log(`[unlocks] CoinGecko supply: ${r.supply.length} coins in ${r.calls} call(s)`);
  }

  async function sendAlerts(st, view) {
    const nowMs = nowFn();
    for (const [k, t] of Object.entries(st.alerts)) if (nowMs - t > 30 * DAY_MS) delete st.alerts[k];
    if (!alerts || !alerts.enabled) return 0;
    let n = 0;
    for (const a of dueAlerts(view, st.alerts, nowMs)) {
      try {
        await alerts.post(alertText(a));
        for (const k of a.markKeys) st.alerts[k] = nowMs;
        n += 1;
      } catch (e) {
        log(`[unlocks] Discord reminder failed: ${e.message || e}`); // not marked: retried next tick
      }
    }
    return n;
  }

  async function maybeCrosscheck(st, view, force) {
    const cmd = env.UNLOCK_CROSSCHECK_CMD;
    if (!cmd) return false;
    const nowMs = nowFn();
    if (!force && nowMs - st.crosscheck.lastRunAt < CROSSCHECK_EVERY_MS) return false;
    if (!view.upcoming.length) return false; // nothing to compare yet
    st.crosscheck.lastRunAt = nowMs;
    const r = await runCmd(cmd, crosscheck.buildInput(view.upcoming, nowMs), { env });
    if (r.ok) {
      st.crosscheck.lastOkAt = nowMs;
      st.crosscheck.lastError = null;
      st.crosscheck.items = r.items;
      log(`[unlocks] cross-check done: ${r.items.length} possible gap(s)`);
    } else {
      st.crosscheck.lastError = r.error;
      log(`[unlocks] cross-check failed: ${r.error}`);
    }
    return true;
  }

  async function runOnce({ forceCrosscheck = false } = {}) {
    if (running) return null;
    running = true;
    try {
      const st = store.loadStore(dir);
      const tracked = trackedFn();
      await refreshDefiLlama(st, tracked);
      await refreshTokenomics(st, tracked);
      await refreshSupply(st, tracked);
      let view = rebuild(st);
      await sendAlerts(st, view);
      if (await maybeCrosscheck(st, view, forceCrosscheck)) view = rebuild(st);
      store.saveStore(dir, st);
      return view;
    } catch (e) {
      log(`[unlocks] run error: ${e && e.message ? e.message : e}`);
      return null;
    } finally {
      running = false;
    }
  }

  function start() {
    if (env.UNLOCKS_ENABLED === '0') return () => {};
    const first = setTimeout(() => { runOnce(); }, 30000);
    timer = setInterval(() => { runOnce(); }, TICK_MS);
    return stop.bind(null, first);
  }
  function stop(first) {
    if (first) clearTimeout(first);
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { runOnce, start, rebuild: () => rebuild(store.loadStore(dir)), dir };
}

module.exports = { createService, dueAlerts, alertText, visibleCrosscheck, ALERT_STEPS };

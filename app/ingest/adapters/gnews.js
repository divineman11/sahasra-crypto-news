'use strict';

const fs = require('fs');
const path = require('path');
const http = require('../http');
const { matchStrength, stripSourceSuffix, getRec, listBases } = require('../coinMatch');
const { isNonCoin, EXCLUDE } = require('../tickers');

// tier priority, lowest first: a coin promoted from C/B into a higher tier should be re-fetched
// immediately at that tier's cadence rather than wait out its old (looser) tier's nextDueAt.
const RANK = { A: 0, B: 1, C: 2 };

const JUNK_HOSTS = ['binance.com', 'kucoin.com', 'bybit.com', 'bitget.com', 't.co'];
const DEFAULT_STATE_FILE = path.join(__dirname, '..', 'cache', 'gnews_state.json');
const MAX_PER_TICK = 3;
const MAX_ITEMS_PER_COIN = 30;
const SEVEN_D = 7 * 86400000;
// how often an active (but not-yet-due) coin's `lastListedAt` marker is refreshed in the state
// file; keeping this coarse is what lets a steady-state tick (nothing due, nothing new) skip
// the state-file write entirely (Step 4B/C state-hygiene requirement).
const ACTIVE_REFRESH_MS = 24 * 3600 * 1000;

// ---- tier-A interval (unchanged from Step 4A) --------------------------------------------
function tierAIntervalMin(n, budget, minMin) {
  return Math.max(minMin, Math.ceil((1440 * n) / (0.9 * budget)));
}

// ---- planner (Step 4B/C) ------------------------------------------------------------------
// Pure. Returns minutes for A/B/C, or Infinity for a tier that must be paused this tick because
// tier A (which must never be starved) already consumes the usable budget.
//   usable   = 0.9 * budget                      (10% headroom, same margin as tier A alone used)
//   aDaily   = nA * 1440 / A                      requests/day tier A is already spending
//   B        = max(60,  ceil(1440*nB / (0.75 * (usable - aDaily))))   — paused if usable-aDaily <= 0
//   bDaily   = nB * 1440 / B (0 when B is paused)
//   C        = max(720, ceil(1440*nCRequests / (usable - aDaily - bDaily))) — paused if that's <= 0
// nCRequests is the number of HTTP requests/day tier C needs, not the number of coins (see the
// batching helpers below): curated C coins get one request each, default-record C coins are
// batched 4-per-request.
function planIntervals({ nA, nB, nCRequests, budget, tierAMin }) {
  const A = tierAIntervalMin(nA, budget, tierAMin);
  const usable = 0.9 * budget;
  const aDaily = (nA * 1440) / A;
  const remainB = usable - aDaily;
  const B = remainB <= 0 ? Infinity : Math.max(60, Math.ceil((1440 * nB) / (0.75 * remainB)));
  const bDaily = B === Infinity ? 0 : (nB * 1440) / B;
  const remainC = usable - aDaily - bDaily;
  const C = remainC <= 0 ? Infinity : Math.max(720, Math.ceil((1440 * nCRequests) / remainC));
  return { A, B, C };
}

function fmtIv(m) { return m === Infinity ? 'paused' : m + 'm'; }

// ---- tier-B derivation (Step 4B) -----------------------------------------------------------
// Pure. Takes the raw array from GET https://fapi.binance.com/fapi/v1/ticker/24hr (objects with
// at least {symbol, quoteVolume}), normalises bases the same way ingest.js's refreshBases /
// tickers.splitBinanceBases do (strip USDT|USDC|USD1 quote, strip 1000000/1000 prefix), drops
// dated/quarterly contracts, non-ASCII and isNonCoin bases, and returns the top `n` bases by
// quote volume (desc). ingest.js calls this hourly against the live payload and keeps the
// previous list on a fetch/parse failure; this function itself never throws on bad input.
const QUOTE_RE = /(USDT|USDC|USD1)$/;
function stripPrefix(s) {
  if (s.startsWith('1000000')) return s.slice(7);
  if (s.startsWith('1000')) return s.slice(4);
  return s;
}
function deriveTierB(tickers, { n = 100 } = {}) {
  const byBase = new Map();
  for (const row of (Array.isArray(tickers) ? tickers : [])) {
    const sym = String((row && row.symbol) || '').toUpperCase();
    if (!sym || sym.indexOf('_') !== -1 || !QUOTE_RE.test(sym)) continue;
    const base = stripPrefix(sym.replace(QUOTE_RE, ''));
    if (!base || !/^[A-Z0-9]+$/.test(base) || isNonCoin(base)) continue;
    const vol = Number(row.quoteVolume) || 0;
    const prev = byBase.get(base);
    if (prev === undefined || vol > prev) byBase.set(base, vol);
  }
  return [...byBase.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map((e) => e[0]);
}

// ---- tier-C batching (Step 4B/C requirement 3) ---------------------------------------------
// Pure. `dueSorted` is the list of due tier-C bases, most-overdue (smallest nextDueAt) first.
// Curated coins (their own record in coinSources.json) always get their own request. Coins on
// the default record are grouped 4-per-request, formed greedily from the most-overdue coins
// (batches have no persistent identity — they're re-formed fresh every tick).
function planCGroups(dueSorted, curatedSet) {
  const queue = dueSorted.slice();
  const groups = [];
  while (queue.length) {
    const base = queue.shift();
    if (curatedSet.has(base)) {
      groups.push({ bases: [base], kind: 'single' });
      continue;
    }
    const bases = [base];
    for (let i = 0; i < queue.length && bases.length < 4;) {
      if (!curatedSet.has(queue[i])) { bases.push(queue[i]); queue.splice(i, 1); }
      else i += 1;
    }
    groups.push({ bases, kind: 'defaultBatch' });
  }
  return groups;
}

function minutesLeftInUTCDay(t) {
  const d = new Date(t);
  const endOfDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0);
  return Math.max(0, (endOfDay - t) / 60000);
}

function decode(s) {
  if (!s) return '';
  let out = String(s).trim();
  if (out.startsWith('<![CDATA[') && out.endsWith(']]>')) {
    out = out.slice(9, -3).trim();
  }
  out = out
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
  return out.trim();
}

function parseItems(xml) {
  const text = String(xml || '');
  const chunks = text.split(/<item>/i);
  const items = [];
  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i];
    const end = chunk.indexOf('</item>');
    const body = end >= 0 ? chunk.slice(0, end) : chunk;
    const titleMatch = body.match(/<title>([\s\S]*?)<\/title>/i);
    const linkMatch = body.match(/<link>([\s\S]*?)<\/link>/i);
    const pubMatch = body.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
    const srcMatch = body.match(/<source url="([^"]*)"[^>]*>([\s\S]*?)<\/source>/i);
    items.push({
      title: decode(titleMatch ? titleMatch[1] : ''),
      link: decode(linkMatch ? linkMatch[1] : ''),
      pubDate: decode(pubMatch ? pubMatch[1] : ''),
      sourceUrl: decode(srcMatch ? srcMatch[1] : ''),
      publisherName: decode(srcMatch ? srcMatch[2] : '')
    });
  }
  return items;
}

function loadState(stateFile) {
  try {
    const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (!st || typeof st !== 'object') throw new Error('bad state');
    if (!st.coins || typeof st.coins !== 'object') st.coins = {};
    return st;
  } catch (e) {
    return { day: '', used: 0, coins: {} };
  }
}

function saveState(stateFile, st) {
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile + '.tmp', JSON.stringify(st));
    fs.renameSync(stateFile + '.tmp', stateFile);
  } catch (e) {
    console.error('[gnews] failed to save state:', e && e.message);
  }
}

// Ensures a state entry exists for `base` and records which tier it's currently in. Returns
// true iff it mutated the entry (used to decide whether the state file needs (re)writing).
//
// Fix (B1, Step 4B/C review): a coin's nextDueAt was set for its OLD tier's (looser) interval —
// e.g. fetched as tier C (interval ~13h), then a minute later it becomes a portfolio coin (tier A,
// interval ~20m). Without this, it would sit on its stale tier-C nextDueAt for up to ~13h before
// tier A picks it up, which is worse than 4A (where every tracked coin was on the tight interval).
// On a PROMOTION (moving to a numerically-lower-ranked, higher-priority tier) reset nextDueAt to 0
// so it's due on the very next tick, at the new tier's cadence. A demotion (A->B, B->C, A->C)
// needs nothing: it just keeps running on its current schedule until that next fires, then falls
// back to the slower interval — no urgency, no wasted request.
//
// firstDone is deliberately left untouched by a promotion. It is a per-COIN (not per-tier) flag:
// once a coin has been fetched successfully in ANY tier, we already have some recent (when:2d)
// coverage of it, refreshed at whatever cadence its previous tier ran on. Re-triggering the
// when:7d backfill on promotion to A would mostly re-fetch and dedupe against items we already
// have, for no benefit — the thing tier A actually buys a promoted coin is a much SHORTER
// interval going forward, not a second backfill. A coin that was pruned (inactive >7d) and later
// re-added starts with a fresh `firstDone:false` from the `!e` branch above, which is correct:
// after a week+ absence a 7-day backfill is genuinely useful again.
function ensureCoin(st, base, tier, t) {
  let e = st.coins[base];
  let changed = false;
  if (!e) { e = st.coins[base] = { nextDueAt: 0, lastOkAt: 0, firstDone: false }; changed = true; }
  if (e.lastOkAt && t - e.lastOkAt > SEVEN_D && e.firstDone) { e.firstDone = false; changed = true; }
  if (e.tier !== tier) {
    if (e.tier && RANK[tier] < RANK[e.tier]) e.nextDueAt = 0; // promotion: due immediately
    e.tier = tier;
    changed = true;
  }
  if (!e.lastListedAt || t - e.lastListedAt >= ACTIVE_REFRESH_MS) { e.lastListedAt = t; changed = true; }
  return changed;
}

function buildUrl(q) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
}

function make({
  getTierA,
  getTierB = () => [],
  getTierC = () => [],
  request = http.request,
  now = () => Date.now(),
  stateFile = process.env.GNEWS_STATE_FILE || DEFAULT_STATE_FILE,
  budget = Number(process.env.GNEWS_DAILY_BUDGET || 5000),
  tierAMin = Number(process.env.GNEWS_TIER_A_MIN || 20),
  enabled = process.env.GNEWS_ENABLED !== '0',
  tiers = process.env.GNEWS_TIERS || 'A,B,C'
} = {}) {
  let listA = [];
  let listB = [];
  let listC = [];
  let listsAt = 0;
  let consecutive429 = 0;
  let lastStatsAt = now();
  let stats = { kept: 0, dropped: 0, junk: 0, errors: 0 };
  let lastInterval = null;

  // tiers B/C derive bases straight from exchange symbols/tickers, which
  // still include quote/stable bases (USDC, USD1, FDUSD, DAI, ...) once stripped of a *different*
  // quote suffix (e.g. a hypothetical USDCUSDT ticker's base "USDC"). tickers.js's own tagger
  // already drops these via EXCLUDE — matched tickers were silently dropped downstream (`ok()` in
  // tickers.js returns null for them), so the request was just wasted budget with unusable output.
  function validBase(b) { return /^[A-Z0-9]+$/.test(b) && !isNonCoin(b) && !EXCLUDE.has(b); }

  async function run() {
    if (!enabled) return [];

    const t = now();
    const enabledTiers = new Set(String(tiers).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean));

    if (t - listsAt >= 60000 || !listsAt) {
      if (enabledTiers.has('A')) {
        try { listA = (getTierA() || []).map((x) => String(x).toUpperCase()).filter(validBase); } catch (e) { /* keep previous */ }
      } else listA = [];
      if (enabledTiers.has('B')) {
        try { listB = (getTierB() || []).map((x) => String(x).toUpperCase()).filter(validBase); } catch (e) { /* keep previous */ }
      } else listB = [];
      if (enabledTiers.has('C')) {
        try { listC = (getTierC() || []).map((x) => String(x).toUpperCase()).filter(validBase); } catch (e) { /* keep previous */ }
      } else listC = [];
      listsAt = t;
    }

    const aSet = new Set(listA);
    const bSet = new Set(listB.filter((b) => !aSet.has(b)));
    const cSet = new Set(listC.filter((b) => !aSet.has(b) && !bSet.has(b)));
    const curatedSet = new Set(listBases());

    const st = loadState(stateFile);
    let changed = false;
    const day = new Date(t).toISOString().slice(0, 10);
    if (st.day !== day) { st.day = day; st.used = 0; changed = true; }

    const activeAll = new Set([...aSet, ...bSet, ...cSet]);
    for (const b of aSet) if (ensureCoin(st, b, 'A', t)) changed = true;
    for (const b of bSet) if (ensureCoin(st, b, 'B', t)) changed = true;
    for (const b of cSet) if (ensureCoin(st, b, 'C', t)) changed = true;
    for (const key of Object.keys(st.coins)) {
      if (activeAll.has(key)) continue;
      const e = st.coins[key];
      if (e.lastListedAt && t - e.lastListedAt > SEVEN_D) { delete st.coins[key]; changed = true; }
      else if (!e.lastListedAt) { e.lastListedAt = t; changed = true; } // grace period for legacy (pre-4B/C) entries
    }

    const nA = aSet.size, nB = bSet.size, nC = cSet.size;
    const curatedC = [...cSet].filter((b) => curatedSet.has(b));
    const defaultC = [...cSet].filter((b) => !curatedSet.has(b));
    const nCRequests = Math.ceil(curatedC.length + defaultC.length / 4);

    const intervals = planIntervals({ nA, nB, nCRequests, budget, tierAMin });
    if (!lastInterval || lastInterval.A !== intervals.A || lastInterval.B !== intervals.B || lastInterval.C !== intervals.C) {
      console.log(`[gnews] intervals now A=${intervals.A}m B=${fmtIv(intervals.B)} C=${fmtIv(intervals.C)} (nA=${nA} nB=${nB} nC=${nC} nCreq/d=${nCRequests})`);
      lastInterval = intervals;
    }

    if (t - lastStatsAt >= 600000) {
      const dueA = [...aSet].filter((b) => st.coins[b].nextDueAt <= t).length;
      const dueB = [...bSet].filter((b) => st.coins[b].nextDueAt <= t).length;
      const dueC = [...cSet].filter((b) => st.coins[b].nextDueAt <= t).length;
      console.log(`[gnews] used=${st.used}/${budget} today, A=${nA}(int=${fmtIv(intervals.A)},due=${dueA}) B=${nB}(int=${fmtIv(intervals.B)},due=${dueB}) C=${nC}(int=${fmtIv(intervals.C)},due=${dueC},req/d=${nCRequests}) kept=${stats.kept} dropped=${stats.dropped} junk=${stats.junk} (last 10 min), errors=${stats.errors}`);
      stats = { kept: 0, dropped: 0, junk: 0, errors: 0 };
      lastStatsAt = t;
    }

    if (st.used >= budget) {
      if (changed) saveState(stateFile, st);
      return [];
    }

    const minsLeft = minutesLeftInUTCDay(t);
    const aRemainingToday = (!nA || intervals.A === Infinity) ? 0 : Math.ceil((nA * minsLeft) / intervals.A);

    // ---- build the priority order for this tick: A (most-overdue first), then B, then C -----
    const byNextDue = (a, b) => st.coins[a].nextDueAt - st.coins[b].nextDueAt;
    const dueA = [...aSet].filter((b) => st.coins[b].nextDueAt <= t).sort(byNextDue);
    const candidates = dueA.map((b) => ({ tier: 'A', bases: [b], kind: 'single' }));
    if (intervals.B !== Infinity) {
      const dueB = [...bSet].filter((b) => st.coins[b].nextDueAt <= t).sort(byNextDue);
      for (const b of dueB) candidates.push({ tier: 'B', bases: [b], kind: 'single' });
    }
    if (intervals.C !== Infinity) {
      const dueC = [...cSet].filter((b) => st.coins[b].nextDueAt <= t).sort(byNextDue);
      for (const g of planCGroups(dueC, curatedSet)) candidates.push({ tier: 'C', bases: g.bases, kind: g.kind });
    }

    const pending = [];
    let issued = 0;
    let usedIncremented = false;
    try {
      for (const cand of candidates) {
        if (issued >= MAX_PER_TICK) break;
        if (st.used >= budget) break;
        if (cand.tier !== 'A' && !(st.used + aRemainingToday + 1 <= budget)) break; // reserve for tier A

        let query;
        if (cand.kind === 'defaultBatch') {
          const names = cand.bases.map((b) => '"' + getRec(b).name + '"').join(' OR ');
          query = `(${names}) crypto when:2d`;
        } else {
          const base = cand.bases[0];
          const rec = getRec(base);
          const firstDone = st.coins[base].firstDone;
          const range = (cand.tier === 'A' && !firstDone) ? '7d' : '2d';
          query = rec.query + ' when:' + range;
        }
        const url = buildUrl(query);
        st.used += 1;
        usedIncremented = true;
        const res = await request(url, { timeoutMs: 12000 });
        const text = String((res && res.text) || '');
        if (!/<rss|<item>/i.test(text)) throw Object.assign(new Error('gnews: non-RSS body'), { status: 429, retryAfterMs: 0 });

        const items = [];
        for (const it of parseItems(text)) {
          let host = 'news.google.com';
          try { host = new URL(it.sourceUrl).hostname.replace(/^www\./, ''); } catch (e) { /* keep default */ }
          if (JUNK_HOSTS.some((h) => host === h || host.endsWith('.' + h))) { stats.junk += 1; continue; }
          const title = stripSourceSuffix(it.title, it.publisherName);
          const pub = new Date(it.pubDate);
          if (isNaN(pub.getTime()) || t - pub.getTime() > SEVEN_D || pub.getTime() - t > 10 * 60000) { stats.dropped += 1; continue; }
          // store.js takes tickers[0] as priceTicker, so for a multi-coin
          // batch item the order of hintTickers matters. Reuse the strength each candidate base
          // already computed (2 = hard evidence: alias/$SYM/SYMUSDT/(SYM), 1 = weak+context-only)
          // and put the strongest-evidence coin(s) first; a stable sort keeps ties in batch order.
          const scored = cand.bases
            .map((b) => ({ b, s: matchStrength(title, b, getRec(b)) }))
            .filter((x) => x.s > 0);
          if (!scored.length) { stats.dropped += 1; continue; }
          scored.sort((x, y) => y.s - x.s);
          const matched = scored.map((x) => x.b);
          items.push({
            sourceName: 'gnews:' + host,
            sourceTier: 4,
            kind: 'news',
            exchange: null,
            title,
            url: it.link,
            publishedAt: pub,
            hintCategory: null,
            hintTickers: matched,
            sourceDomain: host,
            alertable: false
          });
        }
        items.sort((a, b) => b.publishedAt - a.publishedAt);
        pending.push({ tier: cand.tier, bases: cand.bases, items: items.slice(0, MAX_ITEMS_PER_COIN * cand.bases.length) });
        issued += 1;
      }
    } catch (err) {
      stats.errors += 1;
      if (err && err.status === 429) {
        consecutive429 += 1;
        err.retryAfterMs = Math.max(err.retryAfterMs || 0, 60000 * Math.pow(2, Math.min(consecutive429 - 1, 5)));
      }
      if (usedIncremented) changed = true;
      saveState(stateFile, st); // persist `used`; do NOT advance any nextDueAt
      throw err; // rethrow the SAME error object so the scheduler backs off
    }
    consecutive429 = 0;
    if (usedIncremented) changed = true;

    for (const p of pending) {
      const iv = p.tier === 'A' ? intervals.A : p.tier === 'B' ? intervals.B : intervals.C;
      for (const base of p.bases) {
        st.coins[base].nextDueAt = t + iv * 60000;
        st.coins[base].firstDone = true;
        st.coins[base].lastOkAt = t;
      }
    }
    if (changed) saveState(stateFile, st);
    const out = pending.flatMap((p) => p.items);
    stats.kept += out.length;
    return out;
  }

  return { name: 'gnews', tier: 4, intervalMs: 20000, warmRuns: 1, run };
}

module.exports = { make, tierAIntervalMin, planIntervals, deriveTierB, planCGroups, parseItems };
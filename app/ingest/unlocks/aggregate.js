'use strict';
// Pure logic for the unlock calendar: parsing the two public sources, aggregating events into
// per-day groups, and deriving the badges (SUPPLY SHOCK, SRC DISAGREE, DATA MISSING, TGE anniversary).
// No network and no file access here, so everything is unit-testable.

const DAY = 86400;
const CLUSTER_S = 36 * 3600; // events of one coin within +-36h of the cluster anchor are one unlock day
const SAME_SOURCE_GAP_S = 12 * 3600; // two rows of the SAME source more than 12h apart stay separate days
const SHOCK_PCT = 5; // supply shock = at least 5% of circulating supply
const DISAGREE_RATIO = 1.5; // sources disagree when max/min > 1.5 ...
const DISAGREE_MIN_PCT = 1; // ... and the larger one is at least 1%
const MISSING_LOCKED = 0.2; // more than 20% still locked ...
const MISSING_WINDOW_DAYS = 60; // ... but no unlock event in the next 60 days
const OLD_TOKEN_YEARS = 4; // older than this: locked% is burn/lockup noise, not a cliff candidate
const KEEP_PAST_S = 3 * DAY; // events up to 3 days old are kept (for "just unlocked")
const WINDOW_AHEAD_S = 60 * DAY;

const SRC_SHORT = { defillama: 'llama', tokenomics: 'tkn', manual: 'manual' };

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const pos = (v) => {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
};

// "A cliff of {tokens[0]} tokens was unlocked from Jump Crypto on {timestamp}" -> "Jump Crypto"
const ALLOC_RES = [/\bfrom ([^{}]+?) on \{timestamp\}/, /\bof ([^{}]+?) tokens (?:were|will be|was|is) /, /\bto ([^{}]+?) on \{timestamp\}/];
function llamaAlloc(desc) {
  const d = String(desc || '');
  for (const rx of ALLOC_RES) {
    const m = rx.exec(d);
    if (m) return m[1].trim();
  }
  return '';
}

// Token amount of ONE DefiLlama event. Cliff: noOfTokens=[amount] (summed if several).
// Linear: noOfTokens=[old_rate, new_rate] in tokens PER WEEK (a rate change, not an amount), so the
// daily flow at the new rate is new/7. Linear rows are kept for display but never added to totals.
function llamaEventTokens(e) {
  const vals = (e.noOfTokens || []).map(num).filter((x) => x !== null);
  if (!vals.length) return 0;
  if ((e.unlockType || '') === 'linear') return Math.max(vals[vals.length - 1], 0) / 7;
  return vals.reduce((a, b) => a + b, 0);
}

// DefiLlama circSupply already includes today's unlock, so within +-2 days of now use
// min(circSupply, circSupply30d); for later events circSupply30d is stale history, so use circSupply.
function llamaDenominator(item, ts, nowS) {
  const c = pos(item.circSupply) || 0;
  const c30 = pos(item.circSupply30d) || 0;
  const near = ts == null || nowS == null || Math.abs(ts - nowS) <= 2 * DAY;
  if (near && c && c30) return Math.min(c, c30);
  return c || c30;
}

/**
 * @param items DefiLlama `pageProps.data` array
 * @param symOf (item) => ticker or null (null = coin not tracked, skipped)
 * @returns rows [{symbol,name,ts,tokens,pctCirc,category,unlockType,description,source,nParts}]
 */
function parseLlamaItems(items, symOf, nowS) {
  const rows = [];
  for (const item of items || []) {
    const sym = symOf(item);
    if (!sym) continue;
    const agg = new Map();
    for (const e of item.events || []) {
      const ts = parseInt(e && e.timestamp, 10);
      if (!Number.isFinite(ts)) continue;
      if (!(nowS - KEEP_PAST_S <= ts && ts <= nowS + WINDOW_AHEAD_S)) continue;
      const key = `${ts}|${e.category || ''}|${e.unlockType || ''}`;
      let a = agg.get(key);
      if (!a) {
        a = { ts, cat: e.category || '', ut: e.unlockType || '', tokens: 0, n: 0, who: [] };
        agg.set(key, a);
      }
      a.tokens += llamaEventTokens(e);
      a.n += 1;
      const w = llamaAlloc(e.description);
      if (w && !a.who.includes(w)) a.who.push(w);
    }
    for (const a of agg.values()) {
      const denom = llamaDenominator(item, a.ts, nowS);
      rows.push({
        symbol: sym,
        name: item.name || sym,
        ts: a.ts,
        tokens: a.tokens,
        pctCirc: denom > 0 ? Math.round((a.tokens / denom) * 100 * 1000) / 1000 : null,
        category: a.cat,
        unlockType: a.ut,
        description: ('llama: ' + a.who.join(', ')).slice(0, 200),
        source: 'defillama',
        nParts: a.n,
      });
    }
  }
  return rows;
}

// Supply facts from the same DefiLlama page: [{id, symbol, circ, max, tgeS}]
// tgeS is the earliest event timestamp the page shows (a rough stand-in for the token launch date).
function llamaSupplyRows(items, symOf) {
  const out = [];
  for (const item of items || []) {
    const sym = symOf(item);
    if (!sym) continue;
    const tss = [];
    for (const k of ['events', 'lastEvent']) {
      for (const e of item[k] || []) {
        const ts = parseInt(e && e.timestamp, 10);
        if (Number.isFinite(ts)) tss.push(ts);
      }
    }
    out.push({ id: item.gecko_id, symbol: sym, name: item.name || sym, circ: pos(item.circSupply), max: pos(item.maxSupply), tgeS: tss.length ? Math.min(...tss) : null });
  }
  return out;
}

const TKN_MAP = { Insiders: 'insiders', Investors: 'privateSale', Community: 'ecosystem', Foundation: 'ecosystem', 'Public Sale': 'publicSale' };

/** Second source. `arr` = the unlockDataArray of the page; `isTracked(sym)` filters to our coins. */
function parseTokenomics(arr, isTracked, nowS) {
  const rows = [];
  for (const item of arr || []) {
    const rec = item && item[1];
    if (!rec || typeof rec !== 'object') continue;
    const sym = String(rec.ticker || '').trim().toUpperCase();
    const a = rec.allTokenUnlocks || {};
    if (!sym || !isTracked(sym)) continue;
    const dates = a.dates || [];
    const pcts = a.percentage_of_mcap || [];
    const amts = a.token_amounts || [];
    const brk = a.stakeholder_breakdowns || [];
    dates.forEach((d, k) => {
      const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(d));
      if (!m) return;
      const ts = Math.floor(Date.UTC(+m[3], +m[1] - 1, +m[2]) / 1000);
      if (!(nowS - KEEP_PAST_S <= ts && ts <= nowS + WINDOW_AHEAD_S)) return;
      const b = brk[k] && typeof brk[k] === 'object' ? brk[k] : {};
      const tot = Object.values(b).filter((v) => typeof v === 'number').reduce((x, y) => x + y, 0);
      const shares = Object.entries(b)
        .filter(([, v]) => tot && typeof v === 'number' && v > 0)
        .map(([key, v]) => [key, (v / tot) * 100])
        .sort((x, y) => y[1] - x[1]);
      const top = shares.length ? TKN_MAP[shares[0][0]] || shares[0][0] : '';
      rows.push({
        symbol: sym,
        name: rec.name || sym,
        ts,
        tokens: num(amts[k]) || 0,
        pctCirc: num(pcts[k]),
        category: top,
        unlockType: 'scheduled',
        description: ('tokenomics: ' + shares.map(([key, p]) => `${key} ${Math.round(p)}%`).join(', ')).slice(0, 200),
        source: 'tokenomics',
        nParts: 1,
      });
    });
  }
  return rows;
}

/**
 * Per coin, cluster events within +-36h so different sources merge (20:42 UTC vs 00:00 UTC).
 * Linear rate-steps are ignored (ongoing vesting, not a discrete unlock).
 * Per source the percentages and tokens of all parts are summed; maxPct is the largest per-source total.
 */
function dayGroups(rows) {
  const groups = [];
  const bySym = new Map();
  const sorted = rows.filter((r) => r.unlockType !== 'linear').sort((a, b) => a.ts - b.ts);
  for (const r of sorted) {
    const list = bySym.get(r.symbol) || [];
    let d = null;
    for (const cand of list) {
      if (Math.abs(r.ts - cand.anchor) <= CLUSTER_S && (!(r.source in cand.srcTs) || Math.abs(r.ts - cand.srcTs[r.source]) <= SAME_SOURCE_GAP_S)) {
        d = cand;
        break;
      }
    }
    if (!d) {
      d = { symbol: r.symbol, name: r.name, ts: r.ts, anchor: r.ts, per: {}, tok: {}, cats: [], nParts: 0, srcTs: {} };
      list.push(d);
      bySym.set(r.symbol, list);
      groups.push(d);
    }
    if (!(r.source in d.srcTs)) d.srcTs[r.source] = r.ts;
    d.ts = Math.min(d.ts, r.ts);
    if (r.pctCirc != null) d.per[r.source] = (d.per[r.source] || 0) + r.pctCirc;
    d.tok[r.source] = (d.tok[r.source] || 0) + (r.tokens || 0);
    d.nParts += r.nParts || 1;
    if (r.category && !d.cats.includes(r.category)) d.cats.push(r.category);
  }
  for (const d of groups) {
    const per = Object.entries(d.per);
    if (per.length) {
      const top = per.reduce((a, b) => (b[1] > a[1] ? b : a));
      d.maxPct = top[1];
      d.topSource = top[0];
      d.tokens = d.tok[top[0]] ?? null;
    } else {
      const tk = Object.entries(d.tok);
      d.maxPct = null;
      d.topSource = tk.length ? tk.reduce((a, b) => (b[1] > a[1] ? b : a))[0] : null;
      d.tokens = tk.length ? Math.max(...tk.map((x) => x[1])) : null;
    }
    d.sources = Array.from(new Set(Object.keys(d.tok)));
  }
  return groups;
}

const fmtPct = (v) => String(Math.round(v * 10) / 10);
const fDay = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
const etDate = (tsS) => fDay.format(tsS * 1000);

// Two sources both give a % but differ by more than 1.5x.
function disagreement(g) {
  const per = Object.entries(g.per || {}).filter(([, v]) => v > 0);
  if (per.length < 2) return null;
  const lo = per.reduce((a, b) => (b[1] < a[1] ? b : a));
  const hi = per.reduce((a, b) => (b[1] > a[1] ? b : a));
  if (hi[1] < DISAGREE_MIN_PCT || hi[1] / lo[1] <= DISAGREE_RATIO) return null;
  const name = (s) => SRC_SHORT[s] || s;
  return {
    minPct: lo[1],
    maxPct: hi[1],
    minSource: lo[0],
    maxSource: hi[0],
    perSourcePct: Object.fromEntries(per.map(([k, v]) => [k, Math.round(v * 1000) / 1000])),
    badge: `SRC DISAGREE ${name(lo[0])} ${fmtPct(lo[1])}% vs ${name(hi[0])} ${fmtPct(hi[1])}% (${etDate(g.ts)})`,
  };
}

const isShock = (g) => g.maxPct != null && g.maxPct >= SHOCK_PCT;

/**
 * Coins with a lot still locked but no schedule from any source, plus TGE+6m/+12m anniversaries.
 * supply: array [{id, symbol, name, circ, total, max, tgeS}]   rows: calendar rows (any source)
 */
function coverageGaps(supply, rows, nowS) {
  const have60 = new Set(rows.filter((r) => r.ts >= nowS && r.ts <= nowS + MISSING_WINDOW_DAYS * DAY).map((r) => r.symbol));
  const missing = [];
  const anniversaries = [];
  for (const s of supply) {
    const den = s.total && s.max ? Math.min(s.total, s.max) : null; // no max = uncapped -> skip
    if (!s.circ || !den || den <= 0) continue;
    const locked = 1 - s.circ / den;
    if (locked <= MISSING_LOCKED) continue;
    const t0 = s.tgeS || null;
    if (t0 && nowS - t0 > OLD_TOKEN_YEARS * 365.25 * DAY) continue;
    if (!have60.has(s.symbol)) missing.push({ symbol: s.symbol, name: s.name || s.symbol, lockedPct: Math.round(locked * 1000) / 10 });
    if (t0) {
      for (const months of [6, 12]) {
        const at = t0 + months * 30.4375 * DAY;
        const dd = (at - nowS) / DAY;
        if (dd < 0 || dd > 14) continue;
        const near = rows.some((r) => r.symbol === s.symbol && r.ts >= at - 3 * DAY && r.ts <= at + 3 * DAY);
        if (!near) anniversaries.push({ symbol: s.symbol, name: s.name || s.symbol, months, days: Math.round(dd * 10) / 10, ts: Math.round(at), lockedPct: Math.round(locked * 1000) / 10 });
      }
    }
  }
  missing.sort((a, b) => b.lockedPct - a.lockedPct);
  anniversaries.sort((a, b) => a.days - b.days);
  return { missing, anniversaries };
}

/** Everything the web needs, from raw rows + supply. Pure. */
function buildView({ rows, supply, nowS, crosscheck = null, sources = {}, extra = {} }) {
  const groups = dayGroups(rows);
  const nameBy = new Map();
  for (const s of supply || []) nameBy.set(s.symbol, s.name);
  const upcoming = groups
    .filter((g) => g.ts >= nowS - DAY && g.ts <= nowS + WINDOW_AHEAD_S)
    .sort((a, b) => a.ts - b.ts)
    .map((g) => ({
      id: `${g.symbol}_${g.ts}`,
      symbol: g.symbol,
      name: nameBy.get(g.symbol) || g.name || g.symbol,
      ts: g.ts,
      tokens: g.tokens,
      pctCirc: g.maxPct,
      categories: g.cats,
      sources: g.sources,
      nParts: g.nParts,
      perSourcePct: Object.fromEntries(Object.entries(g.per).map(([k, v]) => [k, Math.round(v * 1000) / 1000])),
      supplyShock: isShock(g),
      disagree: disagreement(g),
      justUnlocked: g.ts <= nowS && nowS - g.ts <= DAY,
    }));
  const gaps = coverageGaps(supply || [], rows, nowS);
  return {
    generatedAt: nowS * 1000,
    upcoming,
    missing: gaps.missing,
    anniversaries: gaps.anniversaries,
    crosscheck,
    sources,
    ...extra,
  };
}

module.exports = {
  CLUSTER_S, SHOCK_PCT, DISAGREE_RATIO, SRC_SHORT, KEEP_PAST_S, WINDOW_AHEAD_S, DAY,
  llamaAlloc, llamaEventTokens, llamaDenominator, parseLlamaItems, llamaSupplyRows, parseTokenomics,
  dayGroups, disagreement, isShock, coverageGaps, buildView, etDate,
};

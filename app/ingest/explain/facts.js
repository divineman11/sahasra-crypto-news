'use strict';
// Builds ExplainEvent.facts — the ONLY place numbers may come from — out of one classified post
const { etShort } = require('./timeET');

const MONTHS = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|January|February|March|April|June|July|August|September|October|November|December';
const DATE_RE = new RegExp('\\b(' + MONTHS + ')\\.? (\\d{1,2})\\b', 'i');
const USD_RE = /\$\s?(\d[\d,]*(?:\.\d+)?)\s*(billion|million|thousand|bn|b|m|k)?(?![A-Za-z0-9])/i;
const MULT = { billion: 1e9, bn: 1e9, b: 1e9, million: 1e6, m: 1e6, thousand: 1e3, k: 1e3 };
const BODY_RE = /\b(SEC|CFTC|DOJ|Federal Reserve|Fed|Treasury|White House|Senate|Congress|House|European Commission|ESMA|FCA|MAS|SFC|FSA|IRS|OCC|FDIC|Court|ECB|Bank of England)\b/;
const FREEZE_PARTS = /(freez(?:e|es|ing)|halt(?:s|ed|ing)? (trading|withdrawals|deposits)|paus(?:e|es|ed|ing) (?:all )?(withdrawals|deposits|trading))/i;

// Amounts stated in coins ("114.09 ETH", "approximately 2,000 BTC", "1.5 million USDC"): number + upper-case symbol.
const COIN_RE = /(?<![A-Za-z0-9$.,])(\d[\d,]*(?:\.\d+)?)\s?(billion|million|thousand|bn|m|k)?\s?([A-Z][A-Z0-9]{1,9})\b/g;
const NOT_COINS = new Set(['USD', 'US', 'UK', 'EU', 'UTC', 'ET', 'EST', 'EDT', 'PM', 'AM', 'CEO', 'CTO', 'DAO', 'TVL', 'SEC', 'DOJ', 'FBI', 'API', 'ATH', 'ETF', 'KYC', 'AML', 'NFT', 'DEX', 'CEX', 'DEFI', 'UAE', 'APY', 'APR', 'USDOLLAR', 'ID', 'OK', 'V1', 'V2', 'V3', 'V4']);

const r1 = (n) => Math.round(Number(n) * 10) / 10;

function titleDate(title) {
  const m = DATE_RE.exec(title || '');
  if (!m) return null;
  const mon = m[1].slice(0, 3);
  return mon.charAt(0).toUpperCase() + mon.slice(1).toLowerCase() + ' ' + parseInt(m[2], 10);
}

function parseCoinAmount(title) {
  const t = String(title || '');
  let m;
  COIN_RE.lastIndex = 0;
  while ((m = COIN_RE.exec(t))) {
    const sym = m[3];
    if (NOT_COINS.has(sym) || /^V\d/.test(sym)) continue;
    const n = parseFloat(m[1].replace(/,/g, ''));
    if (!isFinite(n) || n <= 0) continue;
    const qty = Math.round(n * (m[2] ? MULT[m[2].toLowerCase()] : 1) * 1e6) / 1e6;
    return { qty, symbol: sym };
  }
  return null;
}

function parseUsd(title) {
  const m = USD_RE.exec(title || '');
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ''));
  if (!isFinite(n)) return null;
  const v = Math.round(n * (m[2] ? MULT[m[2].toLowerCase()] : 1));
  return v > 0 ? v : null;
}

function marketType(title) {
  if (/\bperp(etual)?s?\b|\bfutures\b/i.test(title)) return 'futures';
  if (/\bspot\b/i.test(title)) return 'spot';
  return null;
}

function capExchange(e) {
  if (!e) return null;
  const s = String(e);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function extractFacts(post, ctx) {
  const title = post.title || '';
  const cat = ctx.category;
  const sub = ctx.subtype;
  const pubMs = post.publishedAt instanceof Date ? post.publishedAt.getTime() : Date.parse(post.publishedAt);
  const f = {
    ticker: ctx.ticker || null,
    project: ctx.name || ctx.ticker || null,
    headline: title,
    source: post.sourceDomain || post.sourceName || null,
    source_tier: Number(post.sourceTier) || 4,
    kind: post.kind || 'news',
    url: post.url || null,
    published_at: isFinite(pubMs) ? new Date(pubMs).toISOString() : null,
    unlock_pct_circ: null, unlock_pct: null, unlock_past: false, unlock_source: null, unlock_pct_basis: null, unlock_tokens: null, unlock_date_et: null,
    amount_usd: null, amount_coin: null, exchange: capExchange(post.exchange), market: null,
    price_t0: null, btc_t0: null, range_24h_pct: null,
    peg_usd: null, what_paused: null, body: null, event_date_et: null,
    restrictions: [],
  };
  if (cat === 'unlock') {
    if (post.unlockPct != null) {
      f.unlock_pct = r1(post.unlockPct);
      f.unlock_pct_basis = post.unlockPctBasis || null;
      if (f.unlock_pct_circ == null && (post.unlockPctBasis === 'circulating' || post.unlockPctBasis == null)) f.unlock_pct_circ = r1(post.unlockPct);
    }
    if (f.unlock_tokens == null && post.unlockAmount != null) f.unlock_tokens = Math.round(post.unlockAmount);
    if (f.unlock_date_et == null) f.unlock_date_et = titleDate(title);
    // Unlock calendar fills in what the headline lacks (see unlocks/lookup.js); never overrides a headline number.
    const cal = post.unlockCal;
    if (cal) {
      f.unlock_source = 'calendar';
      if (f.unlock_pct_circ == null && cal.pct != null) f.unlock_pct_circ = r1(cal.pct);
      if (f.unlock_tokens == null && cal.tokens != null) f.unlock_tokens = Math.round(cal.tokens);
      if (cal.past) { f.unlock_past = true; f.unlock_date_et = etShort(cal.ts * 1000); }
      else if (f.unlock_date_et == null) f.unlock_date_et = etShort(cal.ts * 1000);
    }
  }
  if (cat === 'hack') { f.amount_usd = parseUsd(title); f.amount_coin = parseCoinAmount(title); }
  if (sub === 'depeg') f.peg_usd = 1;
  if (cat === 'listing' || cat === 'delisting') { f.market = marketType(title); f.event_date_et = titleDate(title); }
  if (cat === 'etf' || cat === 'regulatory') {
    const b = BODY_RE.exec(title);
    f.body = b ? b[1] : null;
  }
  const fz = FREEZE_PARTS.exec(title);
  if (fz || sub === 'halt') {
    const what = fz ? (fz[2] || fz[3] || '').toLowerCase() : '';
    f.what_paused = what || null;
    if (what) f.restrictions.push({ kind: what === 'trading' ? 'trading_halt' : 'withdrawals_paused', detail: what === 'trading' ? 'Trading paused' : (what === 'deposits' ? 'Deposits paused' : 'Withdrawals paused'), when_et: isFinite(pubMs) ? etShort(pubMs) : null });
  }
  const d = titleDate(title);
  if (cat === 'delisting' && d) f.restrictions.push({ kind: 'delist_date', detail: 'Last trading date', when_et: d });
  if (cat === 'regulatory' && d && /\b(deadline|decision|by|before|until)\b/i.test(title)) f.restrictions.push({ kind: 'decision_deadline', detail: 'Decision date', when_et: d });
  return f;
}

// Union/max merge of a newer post's facts into the event's facts (§4.3).
function mergeFacts(cur, nxt) {
  const out = Object.assign({}, cur);
  const max = (a, b) => (a == null ? b : b == null ? a : Math.max(a, b));
  out.unlock_pct_circ = max(cur.unlock_pct_circ, nxt.unlock_pct_circ);
  // a circulating-basis pct always wins over a total/max one
  if (out.unlock_pct_circ != null && (cur.unlock_pct_basis !== 'circulating')) { out.unlock_pct = out.unlock_pct_circ; out.unlock_pct_basis = 'circulating'; }
  else if (out.unlock_pct_circ == null) { out.unlock_pct = max(cur.unlock_pct, nxt.unlock_pct); out.unlock_pct_basis = cur.unlock_pct_basis || nxt.unlock_pct_basis; }
  out.unlock_tokens = max(cur.unlock_tokens, nxt.unlock_tokens);
  if (cur.unlock_past || nxt.unlock_past) out.unlock_past = true;
  if (cur.unlock_source || nxt.unlock_source) out.unlock_source = cur.unlock_source || nxt.unlock_source;
  out.amount_usd = max(cur.amount_usd, nxt.amount_usd);
  const ca = cur.amount_coin, na = nxt.amount_coin;
  out.amount_coin = ca && na && ca.symbol === na.symbol ? (na.qty > ca.qty ? na : ca) : (ca || na || null);
  for (const k of ['unlock_date_et', 'market', 'event_date_et', 'what_paused', 'body', 'exchange', 'peg_usd']) if (out[k] == null) out[k] = nxt[k];
  const better = nxt.source_tier < cur.source_tier || (nxt.source_tier === cur.source_tier && Date.parse(nxt.published_at) > Date.parse(cur.published_at));
  if (better) for (const k of ['headline', 'source', 'source_tier', 'kind', 'url', 'published_at']) out[k] = nxt[k];
  const seen = new Set((cur.restrictions || []).map((r) => r.kind + '|' + r.detail));
  out.restrictions = (cur.restrictions || []).slice();
  for (const r of nxt.restrictions || []) if (!seen.has(r.kind + '|' + r.detail)) out.restrictions.push(r);
  return out;
}

module.exports = { extractFacts, mergeFacts, titleDate, parseUsd, parseCoinAmount };

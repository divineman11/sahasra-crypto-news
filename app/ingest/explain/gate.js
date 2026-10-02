'use strict';
// Big-news gate. Pure function of one classified post.
const { TOP_EXCHANGES } = require('../config');

const MACRO_TOPICS = [
  ['fed_rate', /\b(fed chair|federal reserve|fomc|powell|rate (cut|hike)s?|interest rates?)\b/i],
  ['cpi', /\b(cpi|inflation|ppi)\b/i],
  ['executive_order', /\bexecutive order\b/i],
  ['stablecoin_bill', /\b((stablecoin|market structure|crypto) bill|genius act|clarity act)\b/i],
];
const THEFT_RE = /\b(hacked|hackers?|hack (of|on|at|hits|drains)|drained|drainer|stolen|security breach|data breach|breach of|attacker|compromised|rug ?pull(ed)?)\b/i;
const OFFICIAL_KINDS = new Set(['exchange', 'official']);
const STABLECOINS = new Set(['USDT', 'USDC', 'DAI', 'USDE', 'FDUSD', 'TUSD', 'USDD', 'PYUSD', 'FRAX', 'LUSD', 'USDS', 'USD1', 'RLUSD', 'GUSD', 'BUSD', 'USDP', 'CRVUSD']);
const STRONG_DEPEG_RE = /\b(depeg(s|ged)?|loses? (its )?peg|lost (its )?peg)/i;

function macroTopic(title) {
  for (const [slug, re] of MACRO_TOPICS) if (re.test(title)) return slug;
  return null;
}

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
}

/**
 * @param post classified post: { id, title, category, importance, sentiment, kind, sourceTier, exchange,
 *   tickers[], flags, unlockPct, unlockPctBasis, userLabel, storyId }
 * @returns { pass, reason, category, subtype, coin, topic }
 */
function evaluate(post, opts = {}) {
  const now = opts.now || Date.now();
  const no = (reason) => ({ pass: false, reason, category: post && post.category, subtype: null, coin: null, topic: null });
  if (!post) return no('no post');
  if (post.userLabel === 'dismiss') return no('dismissed');
  if (post.publishedAt) {
    const pub = post.publishedAt instanceof Date ? post.publishedAt.getTime() : Date.parse(post.publishedAt);
    if (isFinite(pub) && now - pub > 48 * 3600e3) return no('stale: older than 48h');
  }
  const title = post.title || '';
  const flags = post.flags || {};
  const tier = Number(post.sourceTier) || 4;
  const kind = post.kind || 'news';
  const ticker = (post.tickers && post.tickers[0]) || null;
  const exch = String(post.exchange || '').toLowerCase();
  const out = (category, subtype, reason, extra) => Object.assign({ pass: true, reason, category, subtype, coin: ticker, topic: null }, extra || {});

  // 2. depeg / freeze flags can pass even when the category is maintenance/other.
  const trusted = tier <= 2 || OFFICIAL_KINDS.has(kind);
  const depegOk = flags.depeg && trusted && (STRONG_DEPEG_RE.test(title) || (ticker && STABLECOINS.has(String(ticker).toUpperCase())));
  if (depegOk) {
    return out('hack', 'depeg', 'depeg flag', { topic: ticker ? null : 'depeg_' + (slug(post.exchange) || String(post.id || '').slice(0, 8)) });
  }
  const cat = post.category;
  if (cat === 'hack' && (tier <= 2 || OFFICIAL_KINDS.has(kind))) {
    const sub = flags.freeze && !THEFT_RE.test(title) ? 'halt' : THEFT_RE.test(title) ? 'theft' : 'exploit';
    return out('hack', sub, 'hack from tier<=2 or exchange/official source', { topic: ticker ? null : 'hack_' + (slug(post.exchange) || String(post.id || '').slice(0, 8)) });
  }
  if (flags.freeze && trusted && cat !== 'maintenance') {
    const c = cat === 'hack' || cat === 'regulatory' ? cat : 'hack';
    return out(c, 'halt', 'freeze flag', { topic: ticker ? null : 'halt_' + (slug(post.exchange) || String(post.id || '').slice(0, 8)) });
  }
  if (cat === 'maintenance' || cat === 'other' || !cat) return no('category ' + cat + ' never passes');

  // 1. unlock supply shock
  if (cat === 'unlock') {
    // >= 5% of total/max supply implies >= 5% of circulating, so any basis qualifies.
    if (post.unlockPct != null && post.unlockPct >= 5 && ticker) return out('unlock', 'supply_shock', 'unlock >= 5% of supply (' + (post.unlockCal ? 'unlock calendar' : 'news') + ', basis ' + (post.unlockPctBasis || 'unstated') + ')');
    return no('unlock below 5% of circulating / unconfirmed');
  }
  // 3. listing / delisting on a top exchange
  if ((cat === 'listing' || cat === 'delisting') && kind === 'exchange' && TOP_EXCHANGES.includes(exch)) {
    if (!ticker) return no('listing without a coin');
    return out(cat, 'top_exchange', cat + ' on top exchange');
  }
  // 4. major regulatory / ETF / macro
  if ((cat === 'etf' || cat === 'regulatory') && post.importance >= 70 && (tier <= 2 || kind === 'regulator')) {
    const topic = cat === 'regulatory' ? macroTopic(title) : null;
    if (topic) return out(cat, 'macro', 'macro topic ' + topic, { coin: null, topic });
    let subtype;
    if (cat === 'etf') subtype = post.sentiment === 'bullish' ? 'bullish' : post.sentiment === 'bearish' ? 'bearish' : 'neutral';
    else subtype = post.sentiment === 'bullish' ? 'bull' : post.sentiment === 'bearish' ? 'bear' : 'macro';
    const t = ticker ? null : (cat === 'etf' ? 'etf_market' : 'crypto_regulation');
    return out(cat, subtype, cat + ' importance>=70 from tier<=2/regulator', { topic: t });
  }
  return no('no gate condition matched');
}

module.exports = { evaluate, macroTopic, MACRO_TOPICS };

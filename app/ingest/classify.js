'use strict';

const { STOCK_PERP_TITLE_RE: STOCK_PERP_RE } = require('./tickers');

const REGEXPS = {
  hack: /\b(hacked|hackers?|hack (of|on|at|hits|drains)|exploit(ed|er)?|exploits? (of|on|in|at)|drained|drainer|stolen|security breach|data breach|breach of|attacker|rug ?pull(ed)?|compromised)\b/i,
  delisting: /\b(delist(s|ed|ing)?|removal of .*pairs?|will cease|cease trading|trading termination)\b/i,
  listing: /\b(will list|to list|lists|listed|listing|will launch .*perpetual|new listing|adds? .* (spot|futures|margin|perpetual)|add(s|ed)? support for|launch(es|ed)? (spot|futures|perpetual) trading)\b/i,
  etf: /\bETFs?\b/i,
  regulatory: /\b(SEC|CFTC|DOJ|lawsuit|sued|sues|charged|charges (against|filed|over)|faces? charges|criminal charges|indict(ed|ment)?|regulat(or|ors|ion|ory)|sanction(s|ed)?|court|settlement|settled with|fined|senate|congress|legislation|lawmakers|federal reserve|fed chair|white house|executive order|(stablecoin|crypto|market structure) bill)\b/i,
  maintenance: /\b(maintenance|suspend(s|ed)?|paus(e|es|ed)|deposits?|withdrawals?|network upgrade|hard fork)\b/i,
};

// Token unlocks / vesting cliffs / emissions. Tested right after delisting, before listing.
// Context-anchored (a bare "unlocks"/"emissions" is far too common in non-crypto news).
const UNLOCK_POS_RE = /\b(token unlocks?|vesting (cliff|schedule)s?|cliff unlocks?|token emissions?|tokens? (will )?(be )?unlocked|unlock(s|ed|ing)?\b[^.]{0,60}\b(tokens?|supply|circulation|coins|(?<![$€£¥\d.,])(?<![$€£¥]\s)\d+(\.\d+)?\s*(%|((bn|[bmk]|billion|million)\b(?!\s*(usd|dollars?|euros?|pounds?)))))|\d[\d,.]*\s*%\s*of\b[^.]{0,30}\b(supply|circulating|tokens?)\b[^.]{0,30}\bunlock|(\d[\d,.]*\s*(bn|[bmk]|billion|million)?|\$[\d.,]+[bmk]?)\s*(worth of\s+)?([A-Za-z0-9]{2,10}\s+)?tokens?\b[^.]{0,30}\b(unlock|releas|vest|enter|hit)|releas(e|es|ed|ing)\s+[\d$][\d,.]*\s*(bn|[bmk]|billion|million)?\s*tokens?\b)/i;
const UNLOCK_NEG_RE = /\b(release notes|releases?\s+v\d|(software|protocol|mainnet|client|press) release|unlocks? (new|access|features?|staking|support|power|potential|liquidity)|carbon emissions|imf|world bank|loans?|bail-?outs?|credit lines?|tranches?|disburse(s|d|ments?)?|(in|of) funding|funding for|funds? for)\b/i;
REGEXPS.unlock = { test: (s) => UNLOCK_POS_RE.test(s) && !UNLOCK_NEG_RE.test(s) };

const CATEGORY_ORDER = ['hack', 'delisting', 'unlock', 'etf', 'listing', 'regulatory', 'maintenance'];

const IMPORTANCE_NEWS = { listing: 60, delisting: 60, hack: 85, unlock: 60, etf: 70, regulatory: 70, maintenance: 30, other: 20 };
const IMPORTANCE_EXCHANGE = { listing: 95, delisting: 90, maintenance: 40, other: 30 };
// Official project sources (): baseline importance by sourceName prefix
// (gh:<org>/<repo> release, forum:<host> governance topic, blog:<host> post), used only when
// the title doesn't itself hit a stronger category (hack/regulatory/etc. still promote normally
// via IMPORTANCE_NEWS below).
const OFFICIAL_IMPORTANCE = { gh: 40, forum: 30, blog: 35 };

const OPINION_RE = /\b(price (analysis|prediction)|prediction|recap|here's why|what to expect|could|might|analyst(s)? (say|says|think)|opinion|explained|guide|morning minute|daily (brief|recap|wrap|digest)|weekly (recap|wrap|digest)|newsletter|roundup|round-up|live updates|this week in|the week in|markets wrap)\b/i;
const LOWVALUE_RE = /\b(best crypto to (buy|invest)|next crypto to explode|top \d+ (alt)?coins|presale|(jumps?|rises?|drops?|falls?|surges?|gains?|declines?|rebounds?|slips?|climbs?) (nearly |over |about )?\d+(\.\d+)?%|in (one|four|24) hours?|price (analysis|outlook|prediction|news|eyes|targets|builds|sets up))(?![A-Za-z0-9])/i;
const ETF_BEAR_RE = /\b(delay(s|ed)?|reject(s|ed|ion)?|den(y|ies|ied)|postpone(s|d)?|withdraw(s|n|al)?|outflows?|pulls? (out|back))\b/gi;
const ETF_BULL_RE = /\b(approves|approved|approve|launch(es|ed)?|inflows?|debut(s|ed)?|green ?light(s|ed)?|pulls? in|pulled in|draws? in|drew in)\b/gi;
const REG_BULL_RE = /\b(drop(s|ped)?|dismiss(es|ed|al)?|end(s|ed)?|close(s|d)?|withdraw(s|n)?|clear(s|ed)?|win(s)?|won|victory|pardon(s|ed)?|vacate(s|d)?|overturn(s|ed)?)\b[^.]{0,40}\b(lawsuit|case|charges?|probe|investigation|suit|action)\b/gi;
const REG_BULL_RE_2 = /\b(lawsuit|case|charges?|probe|investigation|suit|action)\b[^.]{0,30}\b(dropped|dismissed|ended|closed|withdrawn|cleared|vacated|overturned)\b/gi;
const REG_BEAR_RE = /\b(lawsuit|sued|sues|charged|charges (against|filed|over)|faces? charges|criminal charges|indict(ed|ment)?|ban(s|ned)?|fined|sanction(s|ed)?|probe|investigat(es|ion|ing)|subpoena(s|ed)?)\b/i;
const BULL_RE = /\b(surge[sd]?|soar(s|ed)?|rall(y|ies|ied)|jump(s|ed)?|record high|breakout|inflows?|approv(ed|al))\b/i;
const BEAR_RE = /\b(plunge[sd]?|crash(es|ed)?|slump(s|ed)?|drop(s|ped)?|fall(s)?|fell|outflows?|liquidat(ed|ions?)|sell-?off)\b/i;

const PROMO_RE = /\b(splash|campaign|event|airdrop|launchpool|launchpad|earn|promotion|promo|reward|rewards|prize|giveaway|competition|trading challenge|carnival|bonus)\b|이벤트|에어드랍|기념|캠페인|리워드|경품|혜택/i;
const PROMO_EXCEPTION_RE = /\b(will list|listing of|new listing|will launch|launches .*(perpetual|spot)|listed)\b/i;

const PRODUCT_SCOPE_RE = /\b(margin|loan|alpha|earn|convert|buy crypto|copy trading|trading bots?|collateral|launchpool|megadrop|options|delivery contract|monitoring tag|trading pairs?|spot trading pairs?|vip)\b/i;
const QUOTE_PERP_RE = /\b[A-Z0-9]{2,15}(USDC|FDUSD)\b/i;

const PHISHING_RE = /\b(phishing|scam(s|mers)?|warns? users|fake (app|site|website|support))\b/i;
const COMPANY_LISTING_PHRASES = [
  /\b(nasdaq|nyse|tsx|asx|lse|otc|publicly|us|u\.s\.|stock|exchange)[- ]listed\b/gi,
  /\blisted (company|firm|miner|companies|firms)\b/gi,
  /\blisting (on|at) (the )?(nasdaq|nyse|tsx|asx|lse)\b/gi,
];

// flags consumed by the explain-card gate (not categories). Added to the result only when true.
const DEPEG_RE = /\b(depeg(s|ged)?|loses? (its )?peg|lost (its )?peg|below \$?0\.9\d)/i;
const FREEZE_RE = /\b(freez(e|es|ing)|halt(s|ed|ing)? (trading|withdrawals|deposits)|paus(e|es|ed|ing) (all )?(withdrawals|deposits|trading))\b/i;
// a freeze/halt headline with hack-like context is a security event, not routine maintenance.
const HACKCTX_RE = /\b(suspicious|outflows?|exploit(ed|s)?|drained|stolen|hack(ed|ers?)?|breach(ed)?|compromised|attacker)\b/i;

const NEG_RE = /\b(not|no|never|refuses? to|refused to|declines? to|declined to|won't|will not|fails? to|failed to|yet to|has not|hasn't|have not|haven't|denies|denied)\b/i;

const ALPHA_LISTING_RE = /doesn'?t mean official listing|not an official listing|alpha listing/i;

function isNegated(title, index) {
  const start = Math.max(0, index - 25);
  const before = title.slice(start, index);
  return NEG_RE.test(before);
}

function etfSentiment(title) {
  let best = null; // { index, cls }
  ETF_BULL_RE.lastIndex = 0;
  let m;
  while ((m = ETF_BULL_RE.exec(title)) !== null) {
    if (!isNegated(title, m.index)) {
      if (best === null || m.index < best.index) best = { index: m.index, cls: 'bull' };
    }
  }
  ETF_BEAR_RE.lastIndex = 0;
  while ((m = ETF_BEAR_RE.exec(title)) !== null) {
    if (!isNegated(title, m.index)) {
      if (best === null || m.index < best.index) best = { index: m.index, cls: 'bear' };
    }
  }
  if (best === null) return 'neutral';
  return best.cls === 'bull' ? 'bullish' : 'bearish';
}

function regulatorySentiment(title) {
  // Favourable resolution: only counts if not negated.
  REG_BULL_RE.lastIndex = 0;
  let m;
  while ((m = REG_BULL_RE.exec(title)) !== null) {
    if (!isNegated(title, m.index)) return 'bullish';
  }
  REG_BULL_RE_2.lastIndex = 0;
  while ((m = REG_BULL_RE_2.exec(title)) !== null) {
    const vi = m.index + m[0].lastIndexOf(m[2]);
    if (!isNegated(title, vi)) return 'bullish';
  }
  if (REG_BEAR_RE.test(title)) return 'bearish';
  return 'neutral';
}

function detectCategory(raw) {
  if (raw.hintCategory) return { category: raw.hintCategory, phishing: false };
  const title = raw.title || '';

  // Phishing/scam warnings that are not hacks
  if (PHISHING_RE.test(title) && !REGEXPS.hack.test(title)) {
    return { category: 'other', phishing: true };
  }

  let testTitle = title;
  if ((raw.kind || 'news') === 'news') {
    testTitle = title;
    for (const re of COMPANY_LISTING_PHRASES) {
      testTitle = testTitle.replace(re, '');
    }
  }

  const order = CATEGORY_ORDER.map((cat) => (cat === 'listing' ? ['listing', testTitle] : [cat, title]));
  for (const [cat, t] of order) {
    if (REGEXPS[cat].test(t)) return { category: cat, phishing: false };
  }
  return { category: 'other', phishing: false };
}

// Token amount ("1.66B", "1.655 billion", "113M tokens", "1,655,000,000 tokens") and % of supply
// ("12.5% of total supply", "48% of circulating", "5% of tokens enter circulation", "1.5% supply").
const UNLOCK_AMOUNT_RE = /(?<![$\d.,])(\d[\d,]*(?:\.\d+)?)\s*(billion|million|thousand|bn|b|m|k)\b(?!\s*(?:usd|dollars?|worth))/i;
const UNLOCK_AMOUNT_PLAIN_RE = /(?<![$\d.,])(\d{1,3}(?:,\d{3})+|\d{7,})\s*(?:[A-Za-z0-9]{2,10}\s+)?tokens?\b/i;
const UNLOCK_PCT_RE = /(\d+(?:\.\d+)?)\s*%\s*(?:of\s+(?:the\s+)?)?((?:(?:total|circulating|current|max(?:imum)?|token)\s+)*)(?:supply|circulation|circulating|tokens?)\b/i;
const UNIT_MULT = { billion: 1e9, bn: 1e9, b: 1e9, million: 1e6, m: 1e6, thousand: 1e3, k: 1e3 };

function parseUnlock(title) {
  let amount = null;
  let m = UNLOCK_AMOUNT_RE.exec(title);
  if (m) {
    const n = parseFloat(m[1].replace(/,/g, ''));
    if (isFinite(n)) amount = Math.round(n * UNIT_MULT[m[2].toLowerCase()]);
  } else if ((m = UNLOCK_AMOUNT_PLAIN_RE.exec(title))) {
    const n = parseFloat(m[1].replace(/,/g, ''));
    if (isFinite(n)) amount = Math.round(n);
  }
  let pct = null;
  let basis = null;
  m = UNLOCK_PCT_RE.exec(title);
  if (m) {
    pct = parseFloat(m[1]);
    const ctx = m[0] + ' ' + title.slice(m.index + m[0].length, m.index + m[0].length + 25);
    if (/circulat/i.test(ctx)) basis = 'circulating';
    else if (/max/i.test(m[0])) basis = 'max';
    else if (/total/i.test(m[0])) basis = 'total';
  }
  return { amount, pct, basis };
}

function sentimentFor(category, title) {
  if (category === 'listing') return 'bullish';
  if (category === 'delisting' || category === 'hack' || category === 'unlock') return 'bearish';
  if (category === 'etf') return etfSentiment(title);
  if (category === 'regulatory') {
    return regulatorySentiment(title); // Settlements stay neutral (ambiguous).
  }
  const bull = BULL_RE.test(title);
  const bear = BEAR_RE.test(title);
  if (bull && !bear) return 'bullish';
  if (bear && !bull) return 'bearish';
  return 'neutral';
}

// every return path — the two early returns below included — must
// go through the maxImportance cap, so this is the single place that applies it.
function withCap(raw, result) {
  if (typeof raw.maxImportance === 'number') {
    result.importance = Math.min(result.importance, raw.maxImportance);
  }
  return result;
}

function classify(raw, tickers) {
  const kind = raw.kind || 'news';
  const title = raw.title || '';

  const detected = detectCategory(raw);
  let category = detected.category;
  const isPhishing = detected.phishing;

  // Binance Alpha is not a spot listing — downgrade listings only, never a hack/delisting/other material event.
  if (ALPHA_LISTING_RE.test(title) && (category === 'listing' || category === 'other' || category == null)) {
    return withCap(raw, { category: 'other', importance: 30, sentiment: 'neutral' });
  }

  if ((category === 'maintenance' || category === 'other') && FREEZE_RE.test(title) && HACKCTX_RE.test(title)) category = 'hack';

  let isPromo = false;
  if (kind === 'exchange' && PROMO_RE.test(title) && !PROMO_EXCEPTION_RE.test(title)) {
    isPromo = true;
    category = 'other';
  }

  if (kind === 'news' && category !== 'hack' && OPINION_RE.test(title)) category = 'other';

  // Tokenized-stock instruments are not crypto catalysts.
  if (STOCK_PERP_RE.test(title) && category !== 'hack') {
    return withCap(raw, { category: 'other', importance: 30, sentiment: 'neutral' });
  }

  // product-level exchange notices should not get full listing/delisting scores
  let importanceOverride = null;
  let neutralSentiment = false;
  if (kind === 'exchange' && !isPromo) {
    if (category === 'listing' && PRODUCT_SCOPE_RE.test(title) && !/\bwill list\b/i.test(title)) {
      category = 'maintenance';
      importanceOverride = 40;
      neutralSentiment = true;
    } else if (category === 'listing' && QUOTE_PERP_RE.test(title) && !/\bwill list\b/i.test(title)) {
      importanceOverride = 50;
    } else if (
      category === 'delisting' &&
      (PRODUCT_SCOPE_RE.test(title) || /\b(removal of|will remove)\b/i.test(title) || QUOTE_PERP_RE.test(title)) &&
      !/\bwill delist\b[^.]*\b(on|from) (spot|binance|bybit|bitget|kucoin)\b|\bdelisting of\b/i.test(title)
    ) {
      category = 'maintenance';
      importanceOverride = 40;
      neutralSentiment = true;
    }
  }

  let importance;
  if (kind === 'regulator') {
    importance = 80;
    category = 'regulatory';
  } else if (kind === 'symbol') {
    importance = 80;
  } else if (kind === 'exchange') {
    if (isPromo) {
      importance = 30;
    } else if (category === 'hack' || category === 'etf' || category === 'regulatory') {
      importance = IMPORTANCE_NEWS[category];
    } else {
      importance = IMPORTANCE_EXCHANGE[category] !== undefined ? IMPORTANCE_EXCHANGE[category] : 30;
    }
  } else if (kind === 'official') {
    // Still promoted by the usual category regexes (hack/regulatory/etc.); only the "nothing
    // special detected" (category 'other') case falls back to the per-source-type baseline.
    if (category !== 'other' && IMPORTANCE_NEWS[category] !== undefined) {
      importance = IMPORTANCE_NEWS[category];
    } else {
      const prefix = String(raw.sourceName || '').split(':')[0];
      importance = OFFICIAL_IMPORTANCE[prefix] !== undefined ? OFFICIAL_IMPORTANCE[prefix] : 30;
    }
  } else if (isPhishing) {
    importance = 40;
  } else {
    importance = IMPORTANCE_NEWS[category] !== undefined ? IMPORTANCE_NEWS[category] : 20;
  }
  let unlockInfo = null;
  if (category === 'unlock') {
    unlockInfo = parseUnlock(title);
    // kind 'symbol' (new-market notices) keeps its own importance; promos never reach here (category forced to 'other').
    if (kind !== 'symbol' && !isPromo) importance = unlockInfo.pct !== null && unlockInfo.pct >= 5 ? 80 : 60;
  }
  if (importanceOverride !== null) importance = importanceOverride;
  // Tier-4 (per-coin search) filler: price-move bots, predictions, listicles.
  if (kind === 'news' && Number(raw.sourceTier) === 4 && category === 'other' && (OPINION_RE.test(title) || LOWVALUE_RE.test(title))) importance = 10;

  let sentiment;
  if (isPhishing) {
    sentiment = 'neutral';
  } else if (isPromo) {
    sentiment = 'neutral';
  } else if (neutralSentiment) {
    sentiment = 'neutral';
  } else {
    sentiment = sentimentFor(category, title);
  }
  // Per-item importance cap (whale_alert_io telegram items force importance <=10
  // via a per-channel `maxImportance` option on the raw item) — generic, so any adapter can use
  // it. Applied last, in withCap, so it covers this return path and the two early returns above.
  const out = { category, importance, sentiment };
  if (unlockInfo) {
    out.unlockAmount = unlockInfo.amount;
    out.unlockPct = unlockInfo.pct;
    out.unlockPctBasis = unlockInfo.basis;
  }
  const depeg = DEPEG_RE.test(title);
  const freeze = FREEZE_RE.test(title);
  if (depeg || freeze) out.flags = { depeg, freeze };
  return withCap(raw, out);
}

module.exports = { classify, parseUnlock, NEG_RE };
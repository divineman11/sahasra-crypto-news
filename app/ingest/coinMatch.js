'use strict';

const { nameOf, isNonCoin, STOCK_PERP_TITLE_RE, NAME_BLOCK, BARE_BLOCK, NEEDS_GATE } = require('./tickers');
const SOURCES = require('./coinSources.json'); // keys starting with '_' are metadata and must be ignored

const CONTEXT_RE = /\b(crypto|cryptocurrenc(y|ies)|tokens?|coins?|altcoins?|memecoin|meme coin|blockchain|on-?chain|DeFi|DEX|perps?|perpetual|futures|staking|stake|unlock|airdrop|mainnet|testnet|launch(es|ed)?|upgrade|partnership|integration|listing|TVL|whales?|liquidations?|market cap|price|rall(y|ies)|surges?|jumps?|drops?|falls?|rebounds?|breakout|bullish|bearish|bull|bear|ETPs?|ETFs?|wallet|validators?|protocol|network|USDT|Binance|Coinbase|Bybit|Bitget|Kraken|OKX)\b/i;
const STOCK_WORDS_RE = /\b(shares|stock price|\(NYSE:|\(NASDAQ:|earnings|EPS)\b/i;
const JUNK_TITLE_RE = /^Convert \d|\(@[A-Za-z0-9_.-]+\)'s insights|Price Today, Live Chart|Related Funding Rounds|Price, Market Cap, Volume and Chart|^\$?[A-Za-z]+ Entry: \d/i;

function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Strips a trailing CoinGecko disambiguation parenthetical ("POL (ex-MATIC)" -> "POL") and any
// stray quotes, so the cleaned name is safe to drop straight into a Google query or an alias list.
function cleanName(n) {
  return String(n).replace(/\s*\([^)]*\)\s*$/, '').replace(/"/g, '').trim();
}

// Fix (B2, Step 4B/C review): a default (uncurated) coin's CoinGecko name is very often an
// ordinary English word ("Gas", "Safe", "Flow", "Spark", "Cap", "Genius", "Vision", ...). The old
// default record put that name in `aliases` (matched case-insensitively, no context required),
// so batched tier-C OR-queries tagged generic headlines ("Ethereum gas fees drop" -> GAS, "Is it
// safe to keep crypto on Binance?" -> SAFE, one item tagged GAS+SAFE+FLOW+SPARK at once). Fix:
//   - a single-word name is NEVER an alias (case-insensitive, no-context match is too loose for an
//     ordinary word); only a genuinely multi-word name ("Shiba Inu") still counts as one.
//   - both the ticker itself and (if different) the bare name are only ever "weak" evidence: they
//     require CONTEXT_RE (crypto/token/price/... nearby) AND are matched case-SENSITIVE (matchCoin
//     rule 6), so "gas fees" (lowercase) never matches "GAS" — only a literal "GAS" token does.
//   - anything already known to be a blocked/ambiguous common word (tickers.js NAME_BLOCK for the
//     name, BARE_BLOCK/NEEDS_GATE for the ticker — the same lists the main tagger uses to keep
//     "gas"/"safe"/"open" etc. from being tagged on their own) is excluded from weak matching too,
//     so it can still only match via a hard $SYM / SYMUSDT / (SYM) / curated-alias signal.
function getRec(base) {
  const b = String(base).toUpperCase();
  if (SOURCES[b] && !b.startsWith('_')) return SOURCES[b];
  const name = cleanName(nameOf(b)) || b;
  const lower = name.toLowerCase();
  const blocked = NAME_BLOCK.has(lower) || BARE_BLOCK.has(name.toUpperCase()) || BARE_BLOCK.has(b) || NEEDS_GATE.has(b);
  // Fix (recall regression, Step 4B/C review): `name.toUpperCase() !== b` dropped the
  // name entirely whenever it equals the ticker ignoring case ("Bonk"/BONK, "Pendle"/PENDLE,
  // "Sushi"/SUSHI, "Morpho"/MORPHO, ...) on the (wrong) assumption that it'd be a redundant
  // duplicate of the ticker-form weak entry already pushed above — but that ticker-form entry is
  // uppercase-only (case-sensitive rule 6), so it never matches a headline's natural mixed-case
  // spelling ("Bonk rallies", not "BONK rallies"), and recall for ~56 top-500 coins collapsed to
  // $SYM/pair only. Compare EXACT case instead: "Bonk" !== "BONK" so the mixed-case name is
  // pushed as its own (still case-sensitive, still context-gated) weak word; a genuine name===b
  // case (e.g. KAITO, whose CoinGecko name literally IS "KAITO") stays ticker-only, no duplicate.
  const weak = [];
  if (b.length >= 3 && !blocked) weak.push(b);
  if (name !== b && !name.includes(' ') && !blocked) weak.push(name);
  return {
    name,
    ambiguous: true,
    query: '"' + name + '" crypto',
    aliases: (name.includes(' ') && !blocked) ? [name] : [],
    weak
  };
}

function listBases() {
  return Object.keys(SOURCES).filter(k => !k.startsWith('_'));
}

function stripSourceSuffix(title, publisher) {
  const t = String(title || '').trim();
  if (typeof publisher === 'string' && publisher) {
    const suffix = ' - ' + publisher;
    if (t.endsWith(suffix)) return t.slice(0, t.length - suffix.length).trim();
  }
  return t.replace(/\s+-\s+[^-]{1,60}$/, '').trim();
}

// Returns a match STRENGTH, not just a boolean: 0 = no match, 1 = weak (context-gated, rule 6),
// 2 = strong (alias / $SYM / SYMUSDT / (SYM) — rules 2-5). matchCoin is just `strength > 0`; the
// gnews adapter uses the strength directly (F4, Step 4B/C review) to order a batch item's
// hintTickers with its strongest evidence first, cheaply, from the same checks it already runs.
function matchStrength(title, base, rec) {
  const r = rec || getRec(base);
  const B = String(base).toUpperCase();
  const t = String(title || '').trim();

  // 1. hard rejects
  if (isNonCoin(B) || STOCK_PERP_TITLE_RE.test(t) || JUNK_TITLE_RE.test(t)) return 0;

  // 2. aliases (case-insensitive, word-bounded)
  const aliases = r.aliases || [];
  for (const alias of aliases) {
    const re = new RegExp('(^|[^a-z0-9])' + esc(alias.toLowerCase()) + '([^a-z0-9]|$)');
    if (re.test(t.toLowerCase())) return 2;
  }

  // 3. $TICKER
  if (new RegExp('\\$' + esc(B) + '\\b', 'i').test(t)) return 2;

  // 4. TICKERUSDT
  if (new RegExp('\\b' + esc(B) + 'USDT\\b').test(t)) return 2;

  // 5. (TICKER) unless stock wording
  const stock = STOCK_WORDS_RE.test(t);
  if (!stock && t.includes('(' + B + ')')) return 2;

  // 6. weak matches with crypto context (CASE-SENSITIVE)
  const weak = Array.isArray(r.weak) ? r.weak : (r.ambiguous ? [] : [B, r.name]);
  if (!stock && CONTEXT_RE.test(t)) {
    for (const w of weak) {
      if (!w) continue;
      const re = new RegExp('(^|[^A-Za-z0-9])' + esc(w) + '([^A-Za-z0-9]|$)');
      if (re.test(t)) return 1;
    }
  }

  // 7. no match
  return 0;
}

function matchCoin(title, base, rec) {
  return matchStrength(title, base, rec) > 0;
}

module.exports = { matchCoin, matchStrength, stripSourceSuffix, getRec, listBases, cleanName, CONTEXT_RE, JUNK_TITLE_RE };
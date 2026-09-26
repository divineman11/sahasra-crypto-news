'use strict';

const fs = require('fs');
const path = require('path');
const { request } = require('./http');

const CACHE_FILE = path.join(__dirname, 'cache', 'coins.json');
const CACHE_TTL = 24 * 3600 * 1000;

const MAX_TICKERS = 50;

const NON_COIN_SEED = new Set(['OURA','CORZ','SDGR','TLT','STONK','JEPQ','KIOXIA','URNM','HUT','GSTOCK','TSLA','NVDA','AAPL','MSTR','COIN','HOOD','CRCL','SPY','QQQ','META','MSFT','AMZN','GOOGL','XAU','XAG','NATGAS','COPPER','BTCDOM','DEFI']);
const NONCOIN_CACHE = process.env.NONCOIN_CACHE_FILE || require('path').join(__dirname, 'cache', 'noncoin.json');
let nonCoin = new Set(NON_COIN_SEED);
try {
  const saved = JSON.parse(require('fs').readFileSync(NONCOIN_CACHE, 'utf8'));
  if (Array.isArray(saved)) for (const s of saved) nonCoin.add(String(s).toUpperCase());
} catch (e) { /* no cache yet */ }
const STOCK_PERP_TITLE_RE = /\b(stock (index )?perp(etual)?s?( contracts?)?|tokenized stocks?|xstocks?|bstocks?|pre-?ipo|pre-?market perp(etual)?s?|tradfi perp(etual)?s?|equity perp(etual)?s?)\b/i;

const ALIASES = {
  bitcoin: 'BTC', satoshi: 'BTC',
  ethereum: 'ETH', ether: 'ETH', vitalik: 'ETH',
  'binance coin': 'BNB',
  ripple: 'XRP',
  dogecoin: 'DOGE',
  cardano: 'ADA',
  solana: 'SOL',
  chainlink: 'LINK',
  polkadot: 'DOT',
  avalanche: 'AVAX',
  toncoin: 'TON',
  tron: 'TRX',
  litecoin: 'LTC',
  'shiba inu': 'SHIB',
  uniswap: 'UNI',
  'near protocol': 'NEAR',
  polygon: 'POL',
  hyperliquid: 'HYPE',
  'sui network': 'SUI',
  arbitrum: 'ARB',
  celestia: 'TIA',
  injective: 'INJ',
  aptos: 'APT',
  pepe: 'PEPE',
  aave: 'AAVE',
  sui: 'SUI',
  'render network': 'RENDER',
  'maker dao': 'MKR',
  ethena: 'ENA',
  'pump fun': 'PUMP',
  'world liberty': 'WLFI',
  'stellar lumens': 'XLM',
  'stacks network': 'STX',
  'compound finance': 'COMP',
  'compound protocol': 'COMP',
  'immutable x': 'IMX',
  'mantle network': 'MNT',
};

const EXCLUDE = new Set(['USDT', 'USDC', 'FDUSD', 'USD1', 'DAI', 'USDE', 'TUSD', 'BUSD', 'USD', 'EUR', 'JPY', 'KRW', 'ERC20', 'BEP20', 'TRC20', 'SPL', 'UTC', 'KRWMARKET', 'BSC']);
const BARE_BLOCK = new Set(['ONE', 'OP', 'IN', 'A', 'ON', 'AI', 'GAS', 'OI', 'US', 'NOW', 'IT', 'BE', 'GO', 'UP', 'ME', 'MY', 'SO', 'OR', 'AT', 'NO', 'ALL', 'NEW', 'FOR', 'THE', 'TOP', 'CAT', 'DOG', 'ID', 'IP', 'OK', 'HOT', 'BIG', 'ACT', 'KEY', 'SUN', 'WIN', 'JOB', 'TRUMP', 'CEO', 'ETF', 'SEC', 'AND', 'ARE', 'HAS', 'WILL', 'CAN', 'NOT', 'BUT', 'OUT', 'ANY', 'ONLY', 'FREE', 'LIVE', 'BACK', 'NEXT', 'OPEN', 'REAL', 'SAFE', 'GENIUS', 'CLARITY', 'BILL', 'FED', 'FOMC', 'CPI', 'GDP', 'IPO', 'USA', 'UK', 'EU', 'ETH2', 'API', 'NFT', 'DEFI', 'RWA', 'DAO', 'TVL', 'ATH', 'CTO', 'CFTC', 'DOJ', 'IRS', 'OCC', 'FDIC', 'JUST', 'BREAKING', 'UPDATE', 'ALERT', 'NEWS', 'WEEK', 'TODAY', 'SPX', 'ARK', 'ALT', 'NFP', 'DXY', 'VIX', 'PCE', 'PMI', 'G7', 'G20', 'TGE', 'ICO', 'KYC', 'AML', 'OFAC', 'UTC', 'VIP', 'AMA', 'ETN', 'ETP', 'OTC', 'SWIFT', 'IMF', 'ECB', 'BOJ', 'PBOC']);
const NEEDS_GATE = new Set(['DOGE', 'ZK', 'OG', 'IO', 'AI', 'ONE', 'OP', 'GAS', 'SUN', 'MOVE', 'PEOPLE', 'VIRTUAL', 'PROMPT', 'PORTAL', 'BANANA', 'COOKIE', 'COPPER', 'NATGAS', 'AUCTION', 'ARK', 'SPX']);
const GATED_SUBJECT = new Set(['OP', 'AI', 'ONE', 'GAS', 'SUN', 'ARK', 'SPX']);
const NAME_BLOCK = new Set(['kucoin', 'gate', 'gate token', 'binance', 'bitget', 'bybit', 'okx', 'kraken', 'coinbase', 'bithumb', 'upbit', 'mexc', 'htx', 'just', 'near', 'story', 'sonic', 'maker', 'origin', 'render', 'echo', 'open', 'safe', 'hyper', 'bitcoin cash sv', 'world', 'pump', 'zero', 'space', 'frax', 'flow', 'mask', 'gas', 'core', 'ethena', 'genius', 'clarity', 'federal', 'reserve', 'treasury', 'senate', 'congress', 'bitcoin etf', 'stable', 'stablecoin', 'token', 'crypto', 'blockchain', 'market', 'bank', 'capital', 'fund', 'trust', 'labs', 'protocol', 'network', 'finance', 'digital', 'global', 'united', 'america', 'liberty', 'freedom', 'justice', 'alpha', 'omega', 'prime', 'pulse', 'magic', 'spark', 'nexus', 'optimism', 'stellar', 'stacks', 'compound', 'immutable', 'mantle', 'status', 'gravity', 'movement', 'threshold', 'portal', 'harmony', 'polygon labs', 'theta', 'render', 'arweave', 'oasis', 'kava', 'celo', 'flare', 'sonic', 'story', 'berachain', 'monad', 'plasma', 'sei', 'midnight', 'lighter', 'jupiter', 'stable', 'derive', 'backpack', 'olympus', 'bedrock', 'vision', 'shuffle', 'ultima', 'sentient', 'seeker', 'humanity', 'chutes', 'helium', 'arkham', 'walrus', 'pharos', 'stronghold', 'espresso', 'comedian', 'babylon', 'cortex', 'aurora', 'lombard', 'centrifuge', 'ontology', 'affine', 'canton', 'tether', 'gnosis', 'wormhole', 'securitize', 'succinct', 'treehouse', 'rain', 'sky', 'grass', 'beam', 'cap', 'purr', 'turbo', 'blur', 'sushi', 'orca', 'kite', 'diem', 'velo', 'prom', 'fluid', 'dog', 'coco', 'swop']);

const EXCHANGE_NAME_TOKENS = new Set(['kucoin', 'kucoin token', 'binance', 'binance coin', 'okx', 'bitget', 'gate', 'gate token', 'gate.io', 'crypto.com', 'htx', 'huobi', 'mexc', 'bybit']);
const EXCH_EVENT_AFTER = /^('s|’s)?\s+((exchange|platform|wallet|futures)\s+)?(hacked|exploited|drained|breach(ed)?|attacked|compromised|outage|insolven\w*|bankrupt\w*|token|coin|price)\b/i;

let bySymbol = new Map();
let names = [];
let nameUpper = new Map();
let addedBases = new Set();

const _stats = { fetches: 0 };

function stripPrefix(t) {
  if (t.startsWith('1000000')) return t.slice(7);
  if (t.startsWith('1000')) return t.slice(4);
  return t;
}

// A wire-style headline written (almost) entirely in capitals: bare uppercase tokens are not evidence there.
function isAllCapsTitle(title) {
  let t = String(title || '').replace(/https?:\/\/\S+/g, ' ');
  // relay wrappers ("Tree News: *HEADLINE: BBG Tree News:", "AggrNews: HEADLINE AggrNews:") put a mixed-case
  // source label around a shouting wire headline; strip a label only if it itself has a lowercase letter
  const lead = /^\s*([A-Za-z][A-Za-z ]{1,24}):\s*/.exec(t);
  if (lead && /[a-z]/.test(lead[1])) t = t.slice(lead[0].length);
  const tail = /\s+([A-Za-z][A-Za-z ]{1,24}):\s*$/.exec(t);
  if (tail && /[a-z]/.test(tail[1])) t = t.slice(0, tail.index);
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length < 12) return false;
  const upper = letters.replace(/[^A-Z]/g, '').length;
  return upper / letters.length >= 0.9;
}

function ok(t) {
  if (!t) return null;
  const s = stripPrefix(t.toUpperCase());
  if (!s || EXCLUDE.has(s)) return null;
  if (nonCoin.has(s)) return null;
  return s;
}

async function fetchPage(page) {
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}`;
  _stats.fetches += 1;
  const res = await request(url, { timeoutMs: 15000 });
  return res.json();
}

function readCache(ignoreTtl) {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (ignoreTtl || Date.now() - parsed.fetchedAt < CACHE_TTL) return parsed.coins;
  } catch (_) {
    // no valid cache
  }
  return null;
}

function writeCache(coins) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ fetchedAt: Date.now(), coins }));
  } catch (_) {
    // cache write is best-effort
  }
}

function buildIndexes(coins, sym, nms, up) {
  for (const c of coins) {
    const s = String(c.symbol || '').toUpperCase();
    if (!s) continue;
    if (!sym.has(s)) sym.set(s, String(c.name || s));
    const name = String(c.name || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
    if (name) {
      nms.push({ nameLower: name.toLowerCase(), ticker: s });
      const upper = name.toUpperCase();
      if (!up.has(upper)) up.set(upper, s);
    }
  }
}

async function loadUniverse(opts = {}) {
  if (opts === true) opts = { force: true };
  const force = !!opts.force;
  const newBySymbol = new Map();
  const newNames = [];
  const newNameUpper = new Map();

  const fetchFresh = async () => {
    const [p1, p2] = await Promise.all([fetchPage(1), fetchPage(2)]);
    const fresh = [...p1, ...p2];
    writeCache(fresh);
    return fresh;
  };

  if (force) {
    let fresh = null;
    try {
      fresh = await fetchFresh();
    } catch (_) {
      fresh = readCache(true);
    }
    if (fresh) buildIndexes(fresh, newBySymbol, newNames, newNameUpper);
  } else {
    const cached = readCache(false);
    if (cached) {
      buildIndexes(cached, newBySymbol, newNames, newNameUpper);
    } else {
      let fresh = null;
      try {
        fresh = await fetchFresh();
      } catch (err) {
        try {
          const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
          fresh = parsed.coins;
        } catch (_) {
          throw err;
        }
      }
      buildIndexes(fresh, newBySymbol, newNames, newNameUpper);
    }
  }

  // swap only if the new coin list is non-empty (a valid fetch or a valid cache)
  if (newBySymbol.size === 0) {
    console.error('[tickers] refresh failed, keeping previous universe');
    return;
  }

  // replay bases previously added via addBases
  for (const sym of addedBases) {
    if (!newBySymbol.has(sym)) newBySymbol.set(sym, sym);
  }

  // atomic swap
  bySymbol = newBySymbol;
  names = newNames;
  nameUpper = newNameUpper;
}

function addBases(bases) {
  for (const b of bases || []) {
    const sym = stripPrefix(String(b).toUpperCase());
    if (!sym) continue;
    addedBases.add(sym);
    if (!bySymbol.has(sym)) bySymbol.set(sym, sym);
  }
}

function setNonCoinBases(list) {
  const next = new Set(NON_COIN_SEED);
  for (const b of list || []) {
    const s = stripPrefix(String(b).toUpperCase());
    if (s) next.add(s);
  }
  nonCoin = next;
  try {
    require('fs').mkdirSync(require('path').dirname(NONCOIN_CACHE), { recursive: true });
    require('fs').writeFileSync(NONCOIN_CACHE, JSON.stringify([...next]));
  } catch (e) { /* best-effort */ }
}
function isNonCoin(sym) {
  return nonCoin.has(stripPrefix(String(sym || '').toUpperCase()));
}
// Split Binance futures exchangeInfo into crypto coin bases and non-coin (equity/commodity/index/premarket) bases.
function splitBinanceBases(info) {
  const QUOTE_RE = /(USDT|USDC|USD1|BTC|ETH|BNB)$/;
  const coin = new Set();
  const other = new Set();
  for (const s of (info && Array.isArray(info.symbols)) ? info.symbols : []) {
    const sym = String(s.symbol || '').toUpperCase();
    if (sym.indexOf('_') !== -1) continue; // quarterly/dated contracts
    if (s.contractType && s.contractType !== 'PERPETUAL' && s.contractType !== 'TRADIFI_PERPETUAL') continue;
    const raw = sym.replace(QUOTE_RE, '');
    const base = stripPrefix(raw);
    if (!base) continue;
    if (!/^[A-Z0-9]+$/.test(base)) continue; // non-ASCII bases
    if (s.underlyingType === 'COIN') coin.add(base);
    else other.add(base);
  }
  for (const b of coin) other.delete(b);
  return { coinBases: [...coin], nonCoinBases: [...other] };
}

function nameOf(ticker) {
  return bySymbol.get(String(ticker).toUpperCase()) || String(ticker).toUpperCase();
}

function resolveParenthetical(token, listingContext) {
  const upper = token.toUpperCase();
  // (a) known ticker
  if (bySymbol.has(upper)) {
    if (BARE_BLOCK.has(upper) || NEEDS_GATE.has(upper)) return listingContext ? upper : null;
    return upper;
  }
  // (b) matches a coin NAME case-insensitively
  if (nameUpper.has(upper)) {
    if (BARE_BLOCK.has(upper) || NEEDS_GATE.has(upper)) return listingContext ? upper : null;
    return nameUpper.get(upper);
  }
  // (c) brand-new listing: accept raw token only if fully uppercase
  if (token === upper) {
    if (BARE_BLOCK.has(upper) || NEEDS_GATE.has(upper) || EXCLUDE.has(upper)) return null;
    return listingContext ? upper : null;
  }
  return null;
}

const CHAIN_BEFORE = /\b(on|across|in|via|of the|built on|deployed on)\s+$/;
const CHAIN_AFTER = /^(\s*\([^)]{1,30}\))?(-based|\s+based|\s+ecosystem|\s+network|\s+chain|\s+mainnet|\s+wallets?|\s+users?|\s+blockchain|\s+(dex|protocol|bridge|d?app|l2|layer[- ]?2|rollup))\b/;
const EVENT_AFTER = /^(\s*\([^)]{1,30}\))?(\s+(network|chain|mainnet|blockchain|protocol|foundation|bridge|dao|team|labs?))?('s|’s)?\s+(hacked|exploited|drained|drains|drain|attacked|compromised|halted|paused|suffers|loses|lost|goes down|outage)\b/i;
const VENUE_AFTER = /^(\s*\([^)]{1,30}\))?('s|’s)?\s+(lists|will list|to list|adds|will add|launches|will launch|delists|will delist|suspends|announces|opens|debuts)\b/i;
const ASSET_AFTER = /^\s+(etfs?|etps?|price|futures|options)\b/i;
const PEOPLE_AFTER = /^('s|’s)?\s+(veterans?|alumni|co-?founders|founders|executives?|employees?|engineers?|developers?|devs|team members?)\b/i;

function contextOf(lowerTitle, start, end) {
  if (PEOPLE_AFTER.test(lowerTitle.slice(end))) return 'people';
  if (EVENT_AFTER.test(lowerTitle.slice(end))) return 'subject';
  if (VENUE_AFTER.test(lowerTitle.slice(end))) return 'venue';
  if (ASSET_AFTER.test(lowerTitle.slice(end))) return 'subject';
  if (CHAIN_BEFORE.test(lowerTitle.slice(0, start)) || CHAIN_AFTER.test(lowerTitle.slice(end))) return 'chain';
  return 'plain';
}

function isCoinNameOrAlias(phrase) {
  const p = String(phrase || '').toLowerCase().trim();
  if (!p) return false;
  if (Object.prototype.hasOwnProperty.call(ALIASES, p)) return true;
  if (nameUpper.has(p.toUpperCase())) return true;
  for (const n of names) {
    if (n.nameLower === p) return true;
  }
  return false;
}

function tagTickers(title, hint, opts = {}) {
  const out = tagTickersInner(title, hint, opts);
  return finalizeCurated(title, hint, opts, out);
}

function tagTickersInner(title, hint, opts = {}) {
  const out = [];
  const seen = new Set();
  const push = (t) => {
    const s = ok(t);
    if (!s || seen.has(s) || out.length >= MAX_TICKERS) return;
    seen.add(s);
    out.push(s);
  };

  if (opts.kind === 'symbol') {
    for (const h of hint || []) push(h);
    return out;
  }

  const stockTitle = STOCK_PERP_TITLE_RE.test(title);

  const listingTitle = title
    .replace(/\b(nasdaq|nyse|tsx|asx|lse|otc|publicly|us|u\.s\.|stock|exchange)[- ]listed\b/gi, ' ')
    .replace(/\blisted (company|firm|miner|companies|firms)\b/gi, ' ');

  const listingContext = opts.kind === 'exchange' ||
    /\b(will list|to list|lists|listed|listing|launch(es|ed)?|new market)\b/i.test(listingTitle);

  for (const h of hint || []) { if (stockTitle && !bySymbol.has(stripPrefix(String(h).toUpperCase()))) continue; push(h); }
  if (out.length >= MAX_TICKERS) return out;

  const lower = title.toLowerCase();

  // $TICKER
  for (const m of title.matchAll(/\$([A-Za-z0-9]{2,15})/g)) {
    const s = m[1].toUpperCase();
    if (bySymbol.has(s)) {
      const start = m.index;
      const end = start + m[0].length;
      if (CHAIN_BEFORE.test(lower.slice(0, start))) continue;
      if (VENUE_AFTER.test(lower.slice(end))) continue;
      const ctx = contextOf(lower, start, end);
      if (ctx === 'chain' || ctx === 'venue') continue;
      push(s);
    }
  }
  if (out.length >= MAX_TICKERS) return out;

  // parenthetical
  for (const m of title.matchAll(/\(([A-Za-z0-9]{2,15})\)/g)) {
    const known = bySymbol.has(m[1].toUpperCase()) || nameUpper.has(m[1].toUpperCase());
    let resolved = resolveParenthetical(m[1], listingContext);
    if (resolved && !known && opts.kind === 'news' &&
        !/\b(binance|bybit|bitget|kucoin|bithumb|upbit|coinbase|okx|kraken|robinhood|hyperliquid|gate\.io|mexc)\b/i.test(title)) {
      resolved = null;
    }
    if (resolved) {
      const openIdx = m.index;
      const closeIdx = openIdx + m[0].length;
      const before = lower.slice(0, openIdx);
      const after = lower.slice(closeIdx);
      // (a) subject check FIRST: if text after the ")" marks the token as the
      //     subject of an event, accept it and skip chain lookback checks
      if (EVENT_AFTER.test(after)) {
        // subject (e.g. "Bug in Balancer (BAL) exploited") → keep
      } else if (VENUE_AFTER.test(after)) {
        // (b) text after the ")" marks venue context (e.g. "Hyperliquid (HYPE) lists XYZ")
        resolved = null;
      } else {
        // (c) text before the "(" marks chain context
        if (CHAIN_BEFORE.test(before)) resolved = null;
        else {
          // (d) strip up to 3 trailing words before the "("; if what remains
          //     ends in chain context, the parenthetical describes the chain
          //     (e.g. "protocol hacked on solana" minus 1 word = "protocol hacked on"
          //      → CHAIN_BEFORE matches "on " → skip SOL)
          const pre = lower.slice(0, openIdx).replace(/\s+$/, '');
          const wordRe = /[a-z0-9.'’-]+/g;
          const wordStarts = [];
          let wm;
          while ((wm = wordRe.exec(pre)) !== null) wordStarts.push(wm.index);
          const maxK = Math.min(3, wordStarts.length);
          for (let k = 1; k <= maxK; k++) {
            const rest = pre.slice(0, wordStarts[wordStarts.length - k]);
            if (CHAIN_BEFORE.test(rest + ' ')) {
              resolved = null;
              break;
            }
          }
        }
        if (resolved && CHAIN_AFTER.test(after)) resolved = null;
      }
    }
    if (resolved && stockTitle && !bySymbol.has(resolved)) resolved = null;
    if (resolved) push(resolved);
  }
  if (out.length >= MAX_TICKERS) return out;

  // pair patterns
  for (const m of title.matchAll(/\b(?:1000000|1000)?([A-Z0-9]{2,15}?)(?:USDT|USDC|FDUSD)\b/g)) { if (stockTitle && !bySymbol.has(stripPrefix(m[1].toUpperCase()))) continue; push(m[1]); }
  if (out.length >= MAX_TICKERS) return out;

  // coin names and aliases, longest phrase first
  const phrases = [
    ...names.filter((n) => (n.nameLower.length >= 6 || n.nameLower.includes(' '))).map((n) => ({ phrase: n.nameLower, ticker: n.ticker, blocked: NAME_BLOCK.has(n.nameLower) })),
    ...Object.keys(ALIASES).map((p) => ({ phrase: p, ticker: ALIASES[p], blocked: NAME_BLOCK.has(p) })),
  ].sort((a, b) => b.phrase.length - a.phrase.length);
  const used = new Set();
  let work = lower;
  for (const { phrase, ticker, blocked } of phrases) {
    if (used.has(phrase)) continue;
    const re = new RegExp(`(^|[^a-z0-9])(${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})([^a-z0-9]|$)`);
    const m = re.exec(work);
    if (m) {
      const start = m.index + m[1].length;
      const end = start + m[2].length;
      const ctx = contextOf(work, start, end);
      let tag = false;
      if (EXCHANGE_NAME_TOKENS.has(phrase)) {
        tag = EXCH_EVENT_AFTER.test(work.slice(end));
      } else if (ctx === 'subject') {
        tag = true;
      } else if (ctx === 'plain') {
        tag = !blocked;
      }
      // never tag on 'venue', 'chain', or 'people'
      if (tag) {
        push(ticker);
        used.add(phrase);
      }
      // mask the matched span even when not tagged so shorter phrases can't re-match
      work = work.slice(0, start) + ' '.repeat(m[2].length) + work.slice(end);
    }
    if (out.length >= MAX_TICKERS) return out;
  }

  // bare uppercase tokens
  const capsTitle = isAllCapsTitle(title);
  let capsKeep = null;
  if (capsTitle) {
    const CM = require('./coinMatch'); // lazy: avoids a circular require at load time
    capsKeep = new Set(CM.listBases().filter((b) => CM.getRec(b).ambiguous === false));
  }
  for (const m of title.matchAll(/\b[A-Z0-9]{2,10}\b/g)) {
    const s = m[0];
    if (!bySymbol.has(s)) continue;
    if (capsTitle && !capsKeep.has(s)) continue; // all-caps wire headline: ordinary words (NEAR, HIGH, BANK…) are not coins
    const start = m.index;
    const end = start + s.length;
    // skip tokens already handled by the $TICKER and parenthetical rules
    if (start > 0 && (title[start - 1] === '$' || title[start - 1] === '(')) continue;
    if (end < title.length && title[end] === ')') continue;
    const ctx = contextOf(lower, start, end);
    if (ctx === 'chain' || ctx === 'venue') continue;
    if (BARE_BLOCK.has(s) && !GATED_SUBJECT.has(s)) continue;
    if (BARE_BLOCK.has(s) && GATED_SUBJECT.has(s)) {
      if (ctx === 'subject') push(s);
      continue;
    }
    if (NEEDS_GATE.has(s)) {
      if (ctx === 'subject') push(s);
      // in exchange notices, bare universe tokens in NEEDS_GATE (e.g. DOGE) are tagged
      else if (opts.kind === 'exchange' && !BARE_BLOCK.has(s)) push(s);
      continue;
    }
    push(s);
    if (out.length >= MAX_TICKERS) return out;
  }

  return out;
}

// media/social/official posts get the same curated-alias recall/ambiguity gate as
// news — the gate used to bail out for any kind other than news/undefined/null, so e.g. a Reddit
// thread ("r/CryptoCurrency: Ethena governance vote passes", kind social) or a YouTube video title
// ("Is Sui the next Solana?", kind media) never got curated aliases like "Ethena"/"Sui" resolved
// to ENA/SUI at all. Hint tickers (raw.hintTickers) always survived anyway — hintSet below is
// built straight from `hint`, independent of opts.kind — this only widens which kinds get the
// curated finalizer's OWN alias/evidence matching.
const CURATED_FINALIZE_KINDS = new Set(['news', 'media', 'social', 'official', undefined, null]);

function finalizeCurated(title, hint, opts, out) {
  if (opts.kind === 'exchange' || opts.kind === 'symbol') return out;
  if (!CURATED_FINALIZE_KINDS.has(opts.kind)) return out;
  const CM = require('./coinMatch'); // lazy: avoids a circular require at load time
  const hintSet = new Set((hint || []).map((h) => stripPrefix(String(h).toUpperCase())));
  const curated = new Set(CM.listBases());
  const lower = title.toLowerCase();
  const allCaps = isAllCapsTitle(title);
  const recFor = (b) => { const r = CM.getRec(b); return allCaps ? Object.assign({}, r, { weak: [] }) : r; };
  const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hardEvidence = (b) => new RegExp('\\$' + escRe(b) + '\\b', 'i').test(title) ||
    new RegExp('(^|[^A-Z0-9])(1000000|1000)?' + escRe(b) + '(USDT|USDC|FDUSD)\\b').test(title);
  // FIX2: spans of multi-word CoinGecko names in the title ("bitcoin cash", "bitcoin sv", "baby doge coin", "ethereum name service");
  // an alias occurrence lying inside such a span of a DIFFERENT ticker is not evidence for this base.
  const covered = [];
  for (const n of names) {
    if (!n.nameLower.includes(' ') || !lower.includes(n.nameLower)) continue;
    const re = new RegExp('(^|[^a-z0-9])' + escRe(n.nameLower) + '([^a-z0-9]|$)', 'g');
    let m;
    while ((m = re.exec(lower)) !== null) { const s = m.index + m[1].length; covered.push([s, s + n.nameLower.length, n.ticker]); re.lastIndex = s + 1; }
  }
  const freeOccurrence = (phraseLower, b) => {
    const re = new RegExp('(^|[^a-z0-9])' + escRe(phraseLower) + '([^a-z0-9]|$)', 'g');
    let m;
    while ((m = re.exec(lower)) !== null) {
      const s = m.index + m[1].length, e = s + phraseLower.length;
      if (!covered.some(([cs, ce, tk]) => tk !== b && cs <= s && e <= ce && (ce - cs) > (e - s))) return [s, e];
      re.lastIndex = s + 1;
    }
    return null;
  };
  const aliasHit = (b) => (CM.getRec(b).aliases || []).filter((a) => freeOccurrence(a.toLowerCase(), b));
  // FIX1: a standalone UPPERCASE base token (not $X / (X) / pair) is the inner tagger's own evidence; the inner rules
  // (BARE_BLOCK / NEEDS_GATE subject gating) already applied, so trust it.
  const bareUpper = (b) => !allCaps && new RegExp('(^|[^A-Za-z0-9$(])' + escRe(b) + '([^A-Za-z0-9)]|$)').test(title);

  // (a) ambiguous curated coins keep a tag only with hard evidence, a hint, or the curated gate's approval
  let result = out.filter((t) => !curated.has(t) || hintSet.has(t) || !CM.getRec(t).ambiguous || hardEvidence(t) || bareUpper(t) || CM.matchCoin(title, t, recFor(t)));

  // locate the evidence span for base b: longest alias, else $B, else pair, else (B), else first weak word (case-sensitive)
  const evidenceSpan = (b) => {
    const hits = aliasHit(b).sort((x, y) => y.length - x.length);
    if (hits.length) {
      const span = freeOccurrence(hits[0].toLowerCase(), b);
      if (span) return span;
    }
    const pats = [new RegExp('\\$' + escRe(b) + '\\b', 'i'), new RegExp('(1000000|1000)?' + escRe(b) + '(USDT|USDC|FDUSD)\\b'), new RegExp('\\(' + escRe(b) + '\\)')];
    for (const re of pats) { const m = re.exec(title); if (m) return [m.index, m.index + m[0].length]; }
    const rec = recFor(b);
    const weak = Array.isArray(rec.weak) ? rec.weak : (rec.ambiguous ? [] : [b, rec.name]);
    for (const w of weak) {
      if (!w) continue;
      const re = new RegExp('(^|[^A-Za-z0-9])' + escRe(w) + '([^A-Za-z0-9]|$)', 'g');
      let m;
      while ((m = re.exec(title)) !== null) {
        const s = m.index + m[1].length, e = s + w.length;
        if (!covered.some(([cs, ce, tk]) => tk !== b && cs <= s && e <= ce && (ce - cs) > (e - s))) return [s, e];
        re.lastIndex = s + 1;
      }
    }
    return null;
  };
  const RELAX_CHAIN_AFTER = /^\s+(dex|bridge|protocol|network|mainnet|blockchain|chain)\b/;

  // (b) add curated coins the gate accepts, but only in subject/plain context (never venue/chain/people)
  const candidates = [];
  for (const b of curated) {
    if (result.includes(b) || isNonCoin(b)) continue;
    if (!CM.matchCoin(title, b, recFor(b))) continue;
    const span = evidenceSpan(b);
    if (!span) continue; // FIX2b: no locatable (un-shadowed) evidence -> do not add
    if (span) {
      let ctx = contextOf(lower, span[0], span[1]);
      const before = lower.slice(0, span[0]);
      const after = lower.slice(span[1]);
      if (ctx === 'chain' && RELAX_CHAIN_AFTER.test(after) && !CHAIN_BEFORE.test(before) && !/\b(from|on|in|across|via)\s+$/.test(before)) ctx = 'plain';
      if (ctx === 'venue' && /^(\s*\([^)]{1,30}\))?('s|’s)?\s+announces\b/.test(after)) ctx = 'plain'; // "NEAR Protocol announces an upgrade" is about the coin
      if (ctx !== 'subject' && ctx !== 'plain') continue;
    }
    candidates.push(b);
  }

  // (c) longest alias wins ("Bitcoin Cash" → BCH not BTC; "Ethereum Classic" → ETC not ETH)
  const matched = {};
  for (const b of [...candidates, ...result.filter((t) => curated.has(t))]) matched[b] = aliasHit(b);
  const shadowed = (b) => false && matched[b] && matched[b].length > 0 && matched[b].every((a) =>
    Object.keys(matched).some((o) => o !== b && matched[o].some((c) => c.length > a.length && c.toLowerCase().includes(a.toLowerCase()))));
  result = result.filter((t) => !(curated.has(t) && !hintSet.has(t) && !hardEvidence(t) && shadowed(t)));
  for (const b of candidates) if (!shadowed(b) && !result.includes(b) && result.length < MAX_TICKERS) result.push(b);
  return result;
}

module.exports = { loadUniverse, addBases, tagTickers, nameOf, _stats, setNonCoinBases, isNonCoin, splitBinanceBases, STOCK_PERP_TITLE_RE, NAME_BLOCK, BARE_BLOCK, NEEDS_GATE, EXCLUDE, isAllCapsTitle };
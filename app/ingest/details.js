'use strict';

const { request } = require('./http');

// Quote/stablecoin symbols that must never be surfaced as affected assets
// (EXCLUDE semantics from tickers.js).
const EXCLUDE = new Set([
  'USDT', 'USDC', 'FDUSD', 'USD', 'EUR', 'TRY', 'BTC',
]);

const MAX_TICKERS = 50;

const RE_PAIR = /\b([A-Z0-9]{2,15})\/(USDT|USDC|FDUSD|BTC|ETH|BNB|TRY|EUR)\b/g;
const RE_CONCAT_PAIR = /\b(?:1000000|1000)?([A-Z0-9]{2,15}?)(USDT|USDC|FDUSD)\b/g;
const RE_PARENTHETICAL = /\(([A-Z0-9]{2,15})\)/g;

const RE_SCRIPT_BLOCK = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;
const RE_STYLE_BLOCK = /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi;
const RE_TAG = /<[^>]+>/g;

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const _loggedOnce = new Set();

function stripBase(base) {
  let b = base;
  if (/^1000000/.test(b) && b.length > 7) b = b.slice(7);
  else if (/^1000/.test(b) && b.length > 5) b = b.slice(4);
  return b;
}

function normalizeBase(base) {
  if (!base) return null;
  const stripped = stripBase(base.toUpperCase());
  if (stripped.length < 2) return null;
  if (EXCLUDE.has(stripped)) return null;
  return stripped;
}

/**
 * Pure text extraction, used by tests.
 * Returns uppercase, deduped, EXCLUDE-filtered bases (max 50).
 */
function extractFromText(text, { parentheticals = true } = {}) {
  const out = [];
  const seen = new Set();
  const add = (base) => {
    const b = normalizeBase(base);
    if (!b || seen.has(b)) return;
    seen.add(b);
    out.push(b);
    if (out.length >= MAX_TICKERS) return;
  };

  if (typeof text !== 'string' || text.length === 0) return out;

  let m;
  RE_PAIR.lastIndex = 0;
  while ((m = RE_PAIR.exec(text)) !== null) {
    add(m[1]);
    if (out.length >= MAX_TICKERS) break;
  }
  RE_CONCAT_PAIR.lastIndex = 0;
  while ((m = RE_CONCAT_PAIR.exec(text)) !== null) {
    add(m[1]);
    if (out.length >= MAX_TICKERS) break;
  }
  if (parentheticals) {
    RE_PARENTHETICAL.lastIndex = 0;
    while ((m = RE_PARENTHETICAL.exec(text)) !== null) {
      add(m[1]);
      if (out.length >= MAX_TICKERS) break;
    }
  }
  return out;
}

function stripHtml(html) {
  return String(html)
    .replace(RE_SCRIPT_BLOCK, ' ')
    .replace(RE_STYLE_BLOCK, ' ')
    .replace(RE_TAG, ' ');
}

function logOnce(source, msg) {
  const key = `${source}\u0000${msg}`;
  if (_loggedOnce.has(key)) return;
  _loggedOnce.add(key);
  console.log(`[details] ${source} ${msg}`);
}

/**
 * Returns a budget of n: take() returns true for the first n calls,
 * false afterwards.
 */
function makeBudget(n) {
  let remaining = n;
  return {
    take() {
      if (remaining > 0) {
        remaining -= 1;
        return true;
      }
      return false;
    },
  };
}

/**
 * Extract affected-asset tickers from the detail page of an important
 * exchange notice whose title names no coin.
 * Returns [] on any error.
 */
async function detailTickers(raw, { timeoutMs = 4000 } = {}) {
  if (!raw || !raw.url) return [];
  // Only Binance is supported for now: other exchanges' pages are
  // client-rendered and yield nothing.
  if (raw.sourceName !== 'binance-cms') return [];
  try {
    const parts = String(raw.url).split('?')[0].split('/').filter(Boolean);
    const code = parts[parts.length - 1];
    if (!code) {
      logOnce(raw.sourceName, 'no article code in url');
      return [];
    }
    const url = `https://www.binance.com/bapi/composite/v1/public/cms/article/detail/query?articleCode=${encodeURIComponent(code)}`;
    const res = await request(url, {
      headers: { 'user-agent': BROWSER_UA, accept: 'application/json,text/plain,*/*' },
      timeoutMs,
    });
    let json;
    try {
      json = JSON.parse(res.text);
    } catch {
      logOnce(raw.sourceName, 'invalid JSON from detail API');
      return [];
    }
    const data = json && json.data;
    if (!data || data.body == null) {
      logOnce(raw.sourceName, 'no body in detail API response');
      return [];
    }
    const text = JSON.stringify(data.body);
    return extractFromText(text, { parentheticals: true });
  } catch (err) {
    logOnce(raw.sourceName || 'unknown', (err && err.message) || 'fetch failed');
    return [];
  }
}

module.exports = { detailTickers, extractFromText, makeBudget };
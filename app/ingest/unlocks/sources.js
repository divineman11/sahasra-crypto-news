'use strict';
// Network fetchers for the unlock calendar. Each does ONE page/request per run and returns parsed data
// (or throws). `request` is injected (ingest/http.js `request` in production) so tests can stub it.
const https = require('https');
const zlib = require('zlib');
const agg = require('./aggregate');

// Cloudflare 403s unusual or library-style User-Agents on these pages, so use a plain browser-style one (override with UNLOCKS_USER_AGENT).
const UA = process.env.UNLOCKS_USER_AGENT || require('../config').BROWSER_UA;
const LLAMA_URL = 'https://defillama.com/unlocks';
const TOKENOMICS_URL = 'https://app.tokenomics.com/unlocks';
const GECKO_MARKETS = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&per_page=250&page=1&ids=';
const GECKO_MAX_URL_IDS_CHARS = 1700; // CoinGecko answers 403 for very long ids= lists
const GECKO_MAX_CALLS_PER_DAY = 2;

/**
 * Default HTTP client for these pages. DefiLlama's Cloudflare answers 403 to Node's built-in fetch but
 * accepts a plain https request with a browser-style User-Agent, so use the https module (gzip supported).
 * Same shape as ingest/http.js request(): { status, text, json() }; throws an Error with .status on HTTP >= 400.
 */
function httpsRequest(url, { ua = UA, timeoutMs = 30000, redirects = 3 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': ua, 'Accept-Encoding': 'gzip', Accept: '*/*' }, timeout: timeoutMs }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(httpsRequest(new URL(res.headers.location, url).toString(), { ua, timeoutMs, redirects: redirects - 1 }));
      }
      if (status >= 400) {
        res.resume();
        const e = new Error('HTTP ' + status + ' for ' + url);
        e.status = status;
        return reject(e);
      }
      const stream = res.headers['content-encoding'] === 'gzip' ? res.pipe(zlib.createGunzip()) : res;
      const parts = [];
      stream.on('data', (d) => parts.push(d));
      stream.on('error', reject);
      stream.on('end', () => {
        const text = Buffer.concat(parts).toString('utf8');
        resolve({ status, text, json: () => JSON.parse(text) });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout after ' + timeoutMs + 'ms')));
    req.on('error', reject);
  });
}

/** Pull the JSON out of a Next.js page: <script id="__NEXT_DATA__" type="application/json">...</script> */
function extractNextData(html) {
  const open = '<script id="__NEXT_DATA__" type="application/json">';
  const i = html.indexOf(open);
  if (i < 0) throw new Error('__NEXT_DATA__ not found');
  const j = html.indexOf('</script>', i + open.length);
  if (j < 0) throw new Error('__NEXT_DATA__ not closed');
  return JSON.parse(html.slice(i + open.length, j));
}

/** DefiLlama: rows + supply facts. `tracked` = { idToSym: Map, trackAll: bool } */
async function fetchDefiLlama(request, tracked, nowS) {
  const res = await request(LLAMA_URL, { ua: UA, timeoutMs: 90000 });
  const items = extractNextData(res.text).props.pageProps.data;
  if (!Array.isArray(items) || !items.length) throw new Error('DefiLlama page has no unlock list');
  const symOf = (item) => {
    const s = tracked.idToSym.get(item.gecko_id);
    if (s) return s;
    if (tracked.trackAll) {
      const t = item.tSymbol || (item.tokenPrice && item.tokenPrice[0] && item.tokenPrice[0].symbol);
      return t ? String(t).toUpperCase() : null;
    }
    return null;
  };
  return {
    rows: agg.parseLlamaItems(items, symOf, nowS),
    supply: agg.llamaSupplyRows(items, symOf),
    itemCount: items.length,
  };
}

/** Tokenomics (second opinion): a Next.js flight-data page. `isTracked(sym)` filters to our coins. */
async function fetchTokenomics(request, isTracked, nowS) {
  const res = await request(TOKENOMICS_URL, { ua: UA, timeoutMs: 90000 });
  const chunks = res.text.match(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g) || [];
  const flight = chunks
    .map((c) => {
      const m = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/.exec(c);
      return m ? JSON.parse(m[1]) : '';
    })
    .join('');
  const key = flight.indexOf('"unlockDataArray":');
  if (key < 0) throw new Error('tokenomics: unlockDataArray not found');
  const start = flight.indexOf('[', key);
  // balanced-bracket scan (strings aware) instead of a second full JSON parse of the whole payload
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let k = start; k < flight.length; k++) {
    const ch = flight[k];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '[') depth++;
    else if (ch === ']' && --depth === 0) { end = k; break; }
  }
  if (end < 0) throw new Error('tokenomics: unlockDataArray not closed');
  const arr = JSON.parse(flight.slice(start, end + 1));
  return { rows: agg.parseTokenomics(arr, isTracked, nowS) };
}

/** Split ids so each URL stays under ~1,700 id characters. */
function chunkIds(ids, maxChars = GECKO_MAX_URL_IDS_CHARS) {
  const chunks = [];
  let cur = [];
  let len = 0;
  for (const id of ids) {
    if (cur.length && len + id.length + 1 > maxChars) { chunks.push(cur); cur = []; len = 0; }
    cur.push(id);
    len += id.length + 1;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/**
 * CoinGecko /coins/markets (free, keyless): circulating / total / max supply.
 * `budget` = { callsLeft } is decremented per HTTP call (failed calls count). At most 2 calls per day overall.
 * Returns { supply: [{id, circ, total, max}], calls, failed }
 */
async function fetchSupply(request, ids, idToSym, budget) {
  const out = [];
  let calls = 0;
  let failed = null;
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  for (const chunk of chunkIds(uniq)) {
    if (budget.callsLeft <= 0) break;
    budget.callsLeft -= 1;
    calls += 1;
    try {
      const res = await request(GECKO_MARKETS + chunk.map(encodeURIComponent).join(','), { ua: UA, timeoutMs: 60000 });
      const data = res.json();
      if (!Array.isArray(data)) throw new Error('unexpected CoinGecko reply');
      for (const c of data) {
        if (!c || !c.id || !idToSym.get(c.id)) continue;
        const p = (v) => (Number(v) > 0 ? Number(v) : null);
        out.push({ id: c.id, circ: p(c.circulating_supply), total: p(c.total_supply), max: p(c.max_supply) });
      }
    } catch (e) {
      failed = e && e.message ? e.message : String(e);
      break; // no retry: a retry would spend the daily budget
    }
  }
  return { supply: out, calls, failed };
}

module.exports = { UA, httpsRequest, extractNextData, fetchDefiLlama, fetchTokenomics, fetchSupply, chunkIds, GECKO_MAX_CALLS_PER_DAY };

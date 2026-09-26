'use strict';

const STOPWORDS = new Set(['the', 'a', 'an', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'with', 'at', 'by', 'from', 'as', 'is', 'are', 'will', 'be', 'has', 'have', 'its', 'it', 'this', 'that', 'after', 'amid', 'over', 'new', 'says']);

const MASK64 = (1n << 64n) - 1n;

function normalize(title) {
  const words = String(title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter((w) => w && !STOPWORDS.has(w));
  return words.join(' ');
}

function fnv1a64(str) {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < str.length; i++) {
    h ^= BigInt(str.charCodeAt(i));
    h = (h * 0x100000001b3n) & MASK64;
  }
  return h;
}

function simhash64(title) {
  const words = normalize(title).split(/\s+/).filter(Boolean);
  const features = [...words];
  for (let i = 0; i + 1 < words.length; i++) features.push(words[i] + ' ' + words[i + 1]);
  const sums = new Array(64).fill(0);
  for (const f of features) {
    const h = fnv1a64(f);
    for (let i = 0; i < 64; i++) {
      sums[i] += (h >> BigInt(i)) & 1n ? 1 : -1;
    }
  }
  let out = 0n;
  for (let i = 0; i < 64; i++) {
    if (sums[i] > 0) out |= 1n << BigInt(i);
  }
  return out.toString(16).padStart(16, '0');
}

function hamming(hexA, hexB) {
  const x = BigInt('0x' + hexA) ^ BigInt('0x' + hexB);
  let count = 0;
  let v = x;
  while (v) {
    v &= v - 1n;
    count++;
  }
  return count;
}

const EXCHANGE_RE = /binance|bybit|bitget|kucoin|bithumb|upbit|coinbase|okx|kraken|robinhood|hyperliquid/i;

function detectExchange(title, rawExchange) {
  if (rawExchange) return rawExchange;
  if (!title) return null;
  const m = String(title).match(EXCHANGE_RE);
  return m ? m[0] : null;
}

class StoryIndex {
  constructor(windowMs = 6 * 3600 * 1000) {
    this.windowMs = windowMs;
    this.entries = [];
  }

  load(rows) {
    for (const row of rows || []) {
      this.entries.push({
        id: row.id,
        storyId: row.storyId || row.id,
        simhash: row.simhash,
        normTitle: normalize(row.title || ''),
        category: row.category,
        tickers: (row.instruments || []).map((i) => i.ticker),
        exchange: row.exchange || null,
        firstSeenAt: row.firstSeenAt instanceof Date ? row.firstSeenAt : new Date(row.firstSeenAt || Date.now()),
      });
    }
    this._prune();
  }

  assign({ id, simhash, normTitle, category, tickers, exchange, firstSeenAt }) {
    this._prune();
    const now = (firstSeenAt instanceof Date ? firstSeenAt : new Date(firstSeenAt || Date.now())).getTime();
    let matched = null;
    for (const e of this.entries) {
      const age = now - e.firstSeenAt.getTime();
      if (age < 0 || age > this.windowMs) continue;
      if (normTitle && e.normTitle === normTitle) { matched = e; break; }
      if (simhash && e.simhash && hamming(simhash, e.simhash) <= 3) { matched = e; break; }
      if ((category === 'listing' || category === 'delisting') && e.category === category &&
          tickers.length && e.tickers.length && tickers[0] === e.tickers[0] && exchange && e.exchange && exchange === e.exchange) {
        matched = e; break;
      }
    }
    const storyId = matched ? matched.storyId : id;
    this.entries.push({ id, storyId, simhash, normTitle, category, tickers, exchange, firstSeenAt: new Date(now) });
    return storyId;
  }

  remove(id) {
    this.entries = this.entries.filter((e) => e.id !== id);
  }

  _prune() {
    const cutoff = Date.now() - this.windowMs;
    this.entries = this.entries.filter((e) => e.firstSeenAt.getTime() >= cutoff);
  }
}

module.exports = { normalize, simhash64, hamming, StoryIndex, detectExchange };
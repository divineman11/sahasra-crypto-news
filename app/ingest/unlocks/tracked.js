'use strict';
// Which coins does the calendar cover? The ones the app already tracks: the CoinGecko coin table that
// ingest/tickers.js caches in ingest/cache/coins.json (id + symbol). If that table is not there yet,
// or UNLOCKS_TRACK_ALL=1, every coin the unlock sources list is kept.
const fs = require('fs');
const path = require('path');

const COINS_FILE = path.join(__dirname, '..', 'cache', 'coins.json');

function loadTracked(env = process.env, file = COINS_FILE) {
  const idToSym = new Map();
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const c of j.coins || []) {
      if (c && c.id && c.symbol) idToSym.set(String(c.id), String(c.symbol).toUpperCase());
    }
  } catch (e) { /* no coin table yet */ }
  const extra = String(env.UNLOCKS_EXTRA_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const id of extra) if (!idToSym.has(id)) idToSym.set(id, id.toUpperCase());
  const trackAll = env.UNLOCKS_TRACK_ALL === '1' || idToSym.size === 0;
  const symbols = new Set(idToSym.values());
  return { idToSym, symbols, trackAll, isTracked: (s) => trackAll || symbols.has(String(s).toUpperCase()) };
}

module.exports = { loadTracked, COINS_FILE };

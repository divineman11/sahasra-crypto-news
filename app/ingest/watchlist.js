'use strict';

const { PORTFOLIO } = require('./config');
const { isNonCoin } = require('./tickers');

// Coins we care about right now: the NEWS_PORTFOLIO list from app/.env (comma-separated tickers).
function loadWatchBases({ portfolio = PORTFOLIO } = {}) {
  const set = new Set();
  for (const p of portfolio || []) set.add(String(p).trim().toUpperCase());
  return [...set].filter((b) => /^[A-Z0-9]+$/.test(b) && !isNonCoin(b)).sort();
}

module.exports = { loadWatchBases };
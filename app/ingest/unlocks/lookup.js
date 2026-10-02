'use strict';
// Read-side helper used by the explain cards: "what does the calendar say about this coin right now?"
const fs = require('fs');
const path = require('path');
const { dirOf } = require('./store');

const cache = { file: '', mtime: -1, view: null };

function readView(env = process.env) {
  const file = path.join(dirOf(env), 'view.json');
  try {
    const st = fs.statSync(file);
    if (cache.file === file && cache.mtime === st.mtimeMs) return cache.view;
    cache.view = JSON.parse(fs.readFileSync(file, 'utf8'));
    cache.file = file;
    cache.mtime = st.mtimeMs;
    return cache.view;
  } catch (e) {
    return null;
  }
}

/**
 * Pure: the unlock of `ticker` nearest to `nowMs` within [-24h, +14d], or null.
 * `past` = it already happened (within 24h), so cards should use past tense.
 */
function pickUnlock(view, ticker, nowMs) {
  if (!view || !Array.isArray(view.upcoming) || !ticker) return null;
  const T = String(ticker).toUpperCase();
  let best = null;
  for (const u of view.upcoming) {
    if (u.symbol !== T) continue;
    const tsMs = u.ts * 1000;
    if (tsMs < nowMs - 24 * 3600e3 || tsMs > nowMs + 14 * 24 * 3600e3) continue;
    if (!best || Math.abs(tsMs - nowMs) < Math.abs(best.ts * 1000 - nowMs)) best = u;
  }
  if (!best) return null;
  return { pct: best.pctCirc, tokens: best.tokens, ts: best.ts, past: best.ts * 1000 <= nowMs, supplyShock: !!best.supplyShock };
}

function lookupUnlock(ticker, nowMs = Date.now(), view) {
  return pickUnlock(view === undefined ? readView() : view, ticker, nowMs);
}

module.exports = { readView, pickUnlock, lookupUnlock };

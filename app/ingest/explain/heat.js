'use strict';
// Heat badge data: 24h price range % from the Binance perp 24h ticker. At most one lookup per coin per
// 10 minutes (callers cache via checked_at).

const HIGH_RANGE = 8; // percent

const r1 = (n) => Math.round(Number(n) * 10) / 10;

async function lookup(ticker, request) {
  const sym = String(ticker).toUpperCase() + 'USDT';
  const out = { range_24h_pct: null };
  try {
    const j = (await request(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${sym}`)).json();
    const hi = Number(j.highPrice), lo = Number(j.lowPrice);
    if (hi > 0 && lo > 0) out.range_24h_pct = r1(((hi - lo) / lo) * 100);
  } catch (e) { /* no perp or network: leave null */ }
  return out;
}

// Pure: {range_24h_pct} -> heat object stored on the event.
function toHeat(m, nowIso) {
  const range = m.range_24h_pct;
  const high = range != null && range >= HIGH_RANGE;
  return { level: range == null ? null : high ? 'high' : 'normal', range_24h_pct: range, checked_at: nowIso };
}

function makeFetcher(request) {
  return async (ticker) => lookup(ticker, request);
}

module.exports = { lookup, toHeat, makeFetcher, HIGH_RANGE };

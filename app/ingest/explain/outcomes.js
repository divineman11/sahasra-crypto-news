'use strict';
// section 4.8: forward log + outcome job. Every live explain event gets one row in forward_log.jsonl
// (price of the coin and of BTC at t0). An hourly job fills d1 / d7 / d30 once each horizon has passed:
// the coin's move and its move relative to BTC. Rows are appended; for each event_id the LAST line wins
// (append-only file, no in-place edits). At most one price fetch per open row per horizon.
const fs = require('fs');
const path = require('path');
const { etDay } = require('./timeET');

const DAY = 24 * 3600e3;
const HORIZONS = [['d1', 1], ['d7', 7], ['d30', 30]];
const r1 = (n) => Math.round(Number(n) * 10) / 10;

// priceFn(ticker) -> number | null  (ticker 'BTC' for the benchmark).
function makePriceFn(request) {
  return async function price(ticker) {
    const t = String(ticker).toUpperCase();
    for (const sym of [`${t}USDT`, `1000${t}USDT`]) {
      try {
        const j = (await request(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${sym}`)).json();
        const p = Number(j && j.price);
        if (p > 0) return p;
      } catch (e) { /* try the next symbol */ }
    }
    return null;
  };
}

function createOutcomes({ dir, now = () => Date.now(), priceFn, log = (m) => console.log(m) }) {
  const file = path.join(dir, 'forward_log.jsonl');

  // event_id -> latest row
  function all() {
    const m = new Map();
    try {
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { const r = JSON.parse(line); if (r && r.event_id) m.set(r.event_id, r); } catch (e) { /* skip a torn line */ }
      }
    } catch (e) { /* no file yet */ }
    return [...m.values()];
  }
  function append(row) {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(file, JSON.stringify(row) + '\n');
  }

  // On event creation (or promotion to live): row with p0 / btc0. Macro events (no coin) use BTC for both.
  async function record(ev) {
    if (all().some((r) => r.event_id === ev.id)) return null;
    const t0 = ev.live_at || ev.created_at;
    const btc0 = await priceFn('BTC');
    const p0 = ev.coin ? await priceFn(ev.coin.ticker) : btc0;
    const row = {
      event_id: ev.id, category: ev.category, subtype: ev.subtype, coin: ev.coin ? ev.coin.ticker : null,
      headline: ev.facts && ev.facts.headline, date: etDay(t0), t0, p0: p0 || null, btc0: btc0 || null,
      d1: null, d7: null, d30: null, status: p0 && btc0 ? 'open' : 'no_price',
    };
    append(row);
    if (row.status === 'no_price') log(`[explain] forward log: no price for ${ev.id}`);
    return row;
  }

  // Hourly: fill every open row's due horizons, in order. Returns number of cells filled.
  async function run() {
    const t = now();
    let filled = 0;
    let btcNow; // fetched lazily, at most once per run
    for (const row of all()) {
      if (row.status !== 'open') continue;
      const due = HORIZONS.filter(([h, days]) => row[h] == null && t >= Date.parse(row.t0) + days * DAY);
      if (!due.length) continue;
      if (btcNow === undefined) btcNow = await priceFn('BTC');
      const pNow = row.coin ? await priceFn(row.coin) : btcNow;
      if (!pNow || !btcNow) continue; // try again next hour
      const iso = new Date(t).toISOString();
      const ret = r1((pNow / row.p0 - 1) * 100);
      const btcRet = r1((btcNow / row.btc0 - 1) * 100);
      for (const [h] of due) {
        row[h] = { t: iso, p: pNow, btc: btcNow, ret, ret_vs_btc: r1(ret - btcRet) };
        filled++;
      }
      if (row.d30) row.status = 'done';
      append(row);
    }
    return filled;
  }

  return { record, run, all, file };
}

module.exports = { createOutcomes, makePriceFn, HORIZONS };

'use strict';
// sections 3.3 / 4.8: base rates. Rebuilt monthly (1st, 03:00 ET) from the forward log; an optional
// base_rates.seed.json (kept out of version control) is merged in (seed n + log n). The card shows
// "Historically X of N ..." only when n >= min_n; otherwise the literal "Not enough comparable cases".
const fs = require('fs');
const path = require('path');
const { etParts } = require('./timeET');

const MIN_N = 20;

function median(a) {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 10) / 10;
}

/**
 * @param rows  forward-log rows (latest per event)
 * @param seed  { "category:subtype": { n, lower_vs_btc_d30, median_vs_btc_d30, source } } | null
 */
function rebuild({ rows, seed, now, minN = MIN_N }) {
  const groups = {};
  for (const r of rows || []) {
    if (r.status !== 'done' || !r.d30 || r.d30.ret_vs_btc == null) continue;
    (groups[r.category + ':' + r.subtype] = groups[r.category + ':' + r.subtype] || []).push(r.d30.ret_vs_btc);
  }
  const out = { built_at: new Date(now).toISOString(), min_n: minN };
  const keys = new Set([...Object.keys(groups), ...Object.keys(seed || {}).filter((k) => seed[k] && typeof seed[k] === 'object')]);
  for (const k of keys) {
    const g = groups[k] || [];
    const s = seed && seed[k] && seed[k].n > 0 ? seed[k] : null;
    const logMed = median(g);
    const lower = g.filter((x) => x < 0).length;
    const n = g.length + (s ? s.n : 0);
    let med = logMed;
    if (s && g.length) med = Math.round(((s.median_vs_btc_d30 * s.n + logMed * g.length) / n) * 10) / 10; // n-weighted
    else if (s) med = s.median_vs_btc_d30;
    out[k] = {
      n,
      lower_vs_btc_d30: lower + (s ? s.lower_vs_btc_d30 : 0),
      median_vs_btc_d30: med,
      source: s ? `${s.source || 'seed'}${g.length ? ' + forward log' : ''}` : 'forward log',
    };
  }
  return out;
}

function createStore({ dir, now = () => Date.now(), outcomes = null, log = (m) => console.log(m), minN = MIN_N }) {
  const file = path.join(dir, 'base_rates.json');
  const seedFile = path.join(dir, 'base_rates.seed.json');
  let cache = { mtime: -1, data: null };

  function read() {
    try {
      const st = fs.statSync(file);
      if (cache.mtime === st.mtimeMs) return cache.data;
      cache = { mtime: st.mtimeMs, data: JSON.parse(fs.readFileSync(file, 'utf8')) };
      return cache.data;
    } catch (e) {
      return null;
    }
  }
  function loadSeed() {
    try { return JSON.parse(fs.readFileSync(seedFile, 'utf8')); } catch (e) { return null; }
  }
  // Entry for "category:subtype", or null unless n >= min_n.
  function get(key) {
    const d = read();
    if (!d) return null;
    const e = d[key];
    return e && typeof e === 'object' && e.n >= (d.min_n || minN) ? e : null;
  }
  function rebuildNow() {
    const data = rebuild({ rows: outcomes ? outcomes.all() : [], seed: loadSeed(), now: now(), minN });
    fs.mkdirSync(dir, { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
    cache = { mtime: -1, data: null };
    log(`[explain] base rates rebuilt (${Object.keys(data).filter((k) => k.includes(':')).length} groups)`);
    return data;
  }
  // Monthly rule: first run builds; afterwards rebuild once per ET month, from the 1st at 03:00 ET on.
  function maybeRebuild() {
    const d = read();
    if (!d) return rebuildNow();
    const b = etParts(Date.parse(d.built_at));
    const n = etParts(now());
    if ((b.y !== n.y || b.m !== n.m) && (n.d > 1 || n.hour >= 3)) return rebuildNow();
    return null;
  }
  return { get, rebuildNow, maybeRebuild, file, seedFile };
}

module.exports = { rebuild, createStore, median, MIN_N };

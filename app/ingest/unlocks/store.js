'use strict';
// Tiny JSON file store for the unlock calendar (no database table needed).
//   store.json  raw rows, supply facts, per-source health, cross-check results, sent alerts (collector writes)
//   view.json   the computed calendar the web app reads (collector writes, web only reads)
const fs = require('fs');
const path = require('path');

const DEFAULT_DIR = path.join(__dirname, '..', 'cache', 'unlocks');
const dirOf = (env = process.env) => env.UNLOCKS_DIR || DEFAULT_DIR;

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data);
  for (let i = 0; i < 5; i++) {
    try { fs.renameSync(tmp, file); return; } catch (e) {
      if ((e.code === 'EPERM' || e.code === 'EBUSY') && i < 4) { const until = Date.now() + 50; while (Date.now() < until) { /* brief spin */ } continue; }
      throw e;
    }
  }
}

function emptyStore() {
  return { v: 1, rows: [], supply: {}, sources: {}, crosscheck: { lastRunAt: 0, lastOkAt: 0, lastError: null, items: [] }, alerts: {} };
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

function loadStore(dir) {
  const j = readJson(path.join(dir, 'store.json'));
  if (!j || typeof j !== 'object') return emptyStore();
  const s = Object.assign(emptyStore(), j);
  s.crosscheck = Object.assign(emptyStore().crosscheck, j.crosscheck || {});
  return s;
}
function saveStore(dir, store) { writeAtomic(path.join(dir, 'store.json'), JSON.stringify(store)); }
function saveView(dir, view) { writeAtomic(path.join(dir, 'view.json'), JSON.stringify(view)); }
function loadView(dir) { return readJson(path.join(dir, 'view.json')); }

module.exports = { dirOf, loadStore, saveStore, saveView, loadView, emptyStore, writeAtomic, readJson, DEFAULT_DIR };

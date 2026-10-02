#!/usr/bin/env node
'use strict';
// Manual runner:   node scripts/unlocks.js fetch        download the calendar now (ignores the 6 h timer)
//                  node scripts/unlocks.js crosscheck   run the weekly AI cross-check now (needs UNLOCK_CROSSCHECK_CMD)
//                  node scripts/unlocks.js print        print the next unlocks from the cache
require('dotenv').config();
const store = require('../ingest/unlocks/store');
const { createService } = require('../ingest/unlocks');

async function main() {
  const cmd = process.argv[2] || 'print';
  const dir = store.dirOf();
  if (cmd === 'print') {
    const v = store.loadView(dir);
    if (!v) {
      console.log('No calendar yet. Run:  npm run unlocks:fetch');
      return;
    }
    for (const u of v.upcoming.slice(0, 40)) {
      const d = new Date(u.ts * 1000).toISOString().slice(0, 10);
      const pct = u.pctCirc == null ? '-' : Math.round(u.pctCirc * 10) / 10 + '%';
      console.log(`${d}  ${u.symbol.padEnd(8)} ${pct.padStart(7)}  ${u.supplyShock ? 'SUPPLY SHOCK ' : ''}${u.disagree ? u.disagree.badge : ''}`);
    }
    return;
  }
  if (cmd === 'fetch' || cmd === 'crosscheck') {
    if (cmd === 'fetch') {
      const st = store.loadStore(dir);
      for (const s of Object.values(st.sources)) s.nextAt = 0; // run every source now
      store.saveStore(dir, st);
    }
    const view = await createService().runOnce({ forceCrosscheck: cmd === 'crosscheck' });
    if (!view) {
      console.error('The run did not finish (see messages above).');
      process.exit(1);
    }
    console.log(`Done: ${view.upcoming.length} upcoming unlocks, ${view.missing.length} DATA MISSING, ${view.anniversaries.length} TGE anniversaries.`);
    if (cmd === 'crosscheck') {
      const cc = view.crosscheck;
      console.log(cc && cc.lastError ? 'Cross-check failed: ' + cc.lastError : `Cross-check items: ${(cc && cc.items.length) || 0}`);
    }
    return;
  }
  console.error('Usage: node scripts/unlocks.js fetch | crosscheck | print');
  process.exit(2);
}

main().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});

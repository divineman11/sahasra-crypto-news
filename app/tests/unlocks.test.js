'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const agg = require('../ingest/unlocks/aggregate');
const cc = require('../ingest/unlocks/crosscheck');
const { dueAlerts, createService } = require('../ingest/unlocks');
const { computeStatus, formatBanner } = require('../ingest/setupStatus');
const { classify } = require('../ingest/classify');

const DAY = 86400;
const NOW = 1790900000;
const row = (o) => Object.assign({ symbol: 'AAA', name: 'AAA', ts: NOW + DAY, tokens: 1, pctCirc: 1, category: 'x', unlockType: 'cliff', source: 'defillama', nParts: 1 }, o);

test('2Z-like fixture: 7 cliffs at one timestamp sum to 1.655e9, >=30%, SUPPLY SHOCK', () => {
  const ts = NOW - 3600;
  const parts = [900e6, 500e6, 70e6, 60e6, 50e6, 45e6, 30e6];
  const item = {
    gecko_id: 'doublezero', name: 'DoubleZero', circSupply: 5129447992, circSupply30d: 3470000000,
    events: parts.map((n) => ({ timestamp: ts, category: 'insiders', unlockType: 'cliff', noOfTokens: [n], description: 'A cliff of {tokens[0]} tokens was unlocked from Jump Crypto on {timestamp}' })),
  };
  const rows = agg.parseLlamaItems([item], () => '2Z', NOW);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tokens, 1.655e9);
  assert.equal(rows[0].nParts, 7);
  assert.ok(rows[0].pctCirc >= 30);
  const view = agg.buildView({ rows, supply: [], nowS: NOW });
  assert.equal(view.upcoming[0].supplyShock, true);
  assert.equal(view.upcoming[0].justUnlocked, true);
});

test('denominator: circSupply30d only within +-2 days, else circSupply', () => {
  const item = { circSupply: 200, circSupply30d: 100 };
  assert.equal(agg.llamaDenominator(item, NOW, NOW), 100);
  assert.equal(agg.llamaDenominator(item, NOW + 10 * DAY, NOW), 200);
});

test('linear events: weekly rate / 7, never part of totals', () => {
  assert.equal(agg.llamaEventTokens({ unlockType: 'linear', noOfTokens: [100, 700] }), 100);
  const rows = agg.parseLlamaItems([{ gecko_id: 'x', circSupply: 1000, events: [{ timestamp: NOW + DAY, unlockType: 'linear', noOfTokens: [0, 7000] }] }], () => 'LIN', NOW);
  assert.equal(rows.length, 1);
  assert.equal(agg.buildView({ rows, supply: [], nowS: NOW }).upcoming.length, 0);
});

test('clustering: +-36h merges sources; same source 13h apart stays separate; other coins separate', () => {
  const g1 = agg.dayGroups([row({ ts: NOW + DAY, source: 'defillama' }), row({ ts: NOW + DAY + 20 * 3600, source: 'tokenomics' })]);
  assert.equal(g1.length, 1);
  assert.deepEqual(g1[0].sources.sort(), ['defillama', 'tokenomics']);
  assert.equal(agg.dayGroups([row({ ts: NOW + DAY }), row({ ts: NOW + DAY + 13 * 3600 })]).length, 2);
  assert.equal(agg.dayGroups([row({ ts: NOW + DAY }), row({ ts: NOW + DAY, symbol: 'BBB' })]).length, 2);
});

test('disagreement: ratio > 1.5 and larger >= 1%', () => {
  const g = (a, b) => agg.dayGroups([row({ pctCirc: a, source: 'defillama' }), row({ pctCirc: b, source: 'tokenomics' })])[0];
  assert.match(agg.disagreement(g(2.5, 1.6)).badge, /^SRC DISAGREE tkn 1\.6% vs llama 2\.5%/);
  assert.equal(agg.disagreement(g(2.4, 1.6)), null); // exactly 1.5
  assert.equal(agg.disagreement(g(0.9, 0.3)), null); // larger < 1%
});

test('DATA MISSING: >20% locked, no event within 60d; skips old tokens and uncapped ones', () => {
  const sup = (o) => Object.assign({ id: 'a', symbol: 'AAA', circ: 30, total: 100, max: 100, tgeS: NOW - 100 * DAY }, o);
  assert.equal(agg.coverageGaps([sup()], [], NOW).missing[0].lockedPct, 70);
  assert.equal(agg.coverageGaps([sup()], [row({ ts: NOW + 10 * DAY })], NOW).missing.length, 0);
  assert.equal(agg.coverageGaps([sup({ tgeS: NOW - 5 * 365 * DAY })], [], NOW).missing.length, 0);
  assert.equal(agg.coverageGaps([sup({ max: null })], [], NOW).missing.length, 0);
  assert.equal(agg.coverageGaps([sup({ circ: 90 })], [], NOW).missing.length, 0);
});

test('TGE anniversary: +6m within 14 days and no event within +-3d', () => {
  const tge = NOW - (6 * 30.4375 - 5) * DAY;
  const sup = [{ id: 'a', symbol: 'AAA', circ: 30, total: 100, max: 100, tgeS: tge }];
  const a = agg.coverageGaps(sup, [], NOW).anniversaries;
  assert.equal(a.length, 1);
  assert.equal(a[0].months, 6);
  assert.equal(agg.coverageGaps(sup, [row({ ts: Math.round(tge + 6 * 30.4375 * DAY + DAY) })], NOW).anniversaries.length, 0);
  assert.equal(agg.coverageGaps([{ ...sup[0], tgeS: NOW - (6 * 30.4375 - 20) * DAY }], [], NOW).anniversaries.length, 0);
});

test('alerts: 7/2/1 day reminders for supply shocks, once each', () => {
  const view = { upcoming: [{ symbol: 'AAA', ts: NOW + 2 * DAY - 100, supplyShock: true, pctCirc: 9 }, { symbol: 'BBB', ts: NOW + DAY, supplyShock: false }] };
  const due = dueAlerts(view, {}, NOW * 1000);
  assert.equal(due.length, 1);
  assert.equal(due[0].step, 2);
  const sent = {};
  due[0].markKeys.forEach((k) => (sent[k] = 1));
  assert.equal(dueAlerts(view, sent, NOW * 1000).length, 0);
});

test('crosscheck contract: input top 30, reply validation, real command round-trip', async () => {
  const upcoming = Array.from({ length: 40 }, (_, i) => ({ symbol: 'C' + i, name: 'c', ts: NOW + DAY, tokens: 1, pctCirc: i, sources: ['defillama'] }));
  const input = cc.buildInput(upcoming, NOW * 1000);
  assert.equal(input.ours.length, 30);
  assert.equal(input.ours[0].symbol, 'C39');
  const ok = cc.parseReply('```json\n{"missing":[{"symbol":"zzz","date":"2026-10-20","pct_of_circulating":4,"source":"x","note":"n"}],"undercounted":[{"symbol":"AAA","date":"2026-10-21","our_pct":1,"their_pct":3}]}\n```');
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.items.map((i) => i.kind + ':' + i.symbol), ['missing:ZZZ', 'undercounted:AAA']);
  assert.equal(cc.parseReply('not json').ok, false);
  assert.equal(cc.parseReply('{"foo":1}').ok, false);
  assert.equal(cc.parseReply('{"missing":[{"symbol":"bad sym!","date":"nope"}]}').items.length, 0);
  const f = path.join(os.tmpdir(), 'cc-echo-' + process.pid + '.js');
  fs.writeFileSync(f, 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(JSON.stringify({missing:[{symbol:"QQQ",date:"2026-10-30",note:String(j.ours.length)}],undercounted:[]}))})');
  const r = await cc.runCommand('node "' + f + '"', input, { timeoutMs: 20000 });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.items[0].symbol, 'QQQ');
  assert.equal(r.items[0].note, '30');
  const bad = await cc.runCommand('node -e "process.exit(3)"', input, { timeoutMs: 20000 });
  assert.equal(bad.ok, false);
});

test('service: stubbed sources, one fetch per source, CoinGecko at most 2 calls/day, view written', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unl-'));
  const calls = { llama: 0, tkn: 0, gecko: 0 };
  const nowMs = NOW * 1000;
  const page = (data) => `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { data } } })}</script></html>`;
  const items = Array.from({ length: 400 }, (_, i) => ({
    gecko_id: 'coin-with-a-rather-long-gecko-id-' + i, name: 'C' + i, tSymbol: 'C' + i, circSupply: 100, circSupply30d: 100, maxSupply: 1000,
    events: i === 0 ? [{ timestamp: NOW + 3 * DAY, category: 'insiders', unlockType: 'cliff', noOfTokens: [50] }] : [],
  }));
  const request = async (url) => {
    if (url.includes('defillama')) { calls.llama++; return { text: page(items) }; }
    if (url.includes('tokenomics')) { calls.tkn++; return { text: 'no data here' }; }
    calls.gecko++;
    return { json: () => [] };
  };
  const svc = createService({ dir, request, now: () => nowMs, env: { UNLOCKS_TRACK_ALL: '1' }, loadTracked: () => ({ idToSym: new Map(), symbols: new Set(), trackAll: true, isTracked: () => true }), log: () => {} });
  const v1 = await svc.runOnce();
  await svc.runOnce();
  assert.equal(calls.llama, 1);
  assert.equal(calls.tkn, 1); // failed once, backoff keeps the second run from retrying
  assert.ok(calls.gecko <= 2);
  assert.equal(v1.upcoming.length, 1);
  assert.equal(v1.upcoming[0].pctCirc, 50);
  assert.ok(v1.sources.tokenomics.lastError);
  assert.ok(fs.existsSync(path.join(dir, 'view.json')));
});

test('setup status: OFF items get a fix; attention banner text; ON when configured', () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-'));
  const off = computeStatus({ env: {}, now: NOW * 1000, cacheDir, phase: 'startup' });
  const byId = Object.fromEntries(off.features.map((f) => [f.id, f]));
  assert.equal(byId.crosscheck.state, 'off');
  assert.ok(byId.crosscheck.fix);
  assert.equal(byId.discord.state, 'off');
  assert.equal(byId.rewrite.state, 'off');
  assert.equal(byId.unlockCalendar.state, 'on');
  assert.equal(off.needsAttention, true);
  assert.match(off.attention[0].message, /Unlock cross-check is off/);
  assert.match(formatBanner(off), /\[ OFF \] Weekly AI cross-check/);
  const view = { sources: { defillama: { lastOkAt: NOW * 1000 - 3600e3 }, coingecko: { lastOkAt: NOW * 1000 - 3600e3 } }, crosscheck: { lastOkAt: NOW * 1000 - 3600e3, lastRunAt: NOW * 1000 - 3600e3 } };
  const on = computeStatus({ env: { UNLOCK_CROSSCHECK_CMD: 'x', DISCORD_NEWS_WEBHOOK: 'https://discord.com/api/webhooks/1/abc', NEWS_REDIS: 'off' }, now: NOW * 1000, cacheDir, phase: 'live', view, heartbeat: { at: NOW * 1000 - 1000, redis: 'off', failing: [] } });
  assert.equal(on.attention.length, 0);
  const failing = computeStatus({ env: { UNLOCK_CROSSCHECK_CMD: 'x' }, now: NOW * 1000, cacheDir, phase: 'live', view: { sources: { defillama: { lastOkAt: 0, lastError: 'HTTP 403', lastErrorAt: NOW * 1000 - 1000 } } }, heartbeat: { at: NOW * 1000, redis: 'off' } });
  assert.equal(failing.features.find((f) => f.id === 'unlockCalendar').state, 'warn');
  assert.ok(failing.sourcesFailed.length === 1);
});

test('classifier: coin + unlock wording is an unlock; negatives are not', () => {
  const c = (t, k) => classify({ title: t, kind: 'news', sourceTier: 3 }, k).category;
  assert.equal(c('2Z gains 21% ahead of Oct. 2 unlock', ['2Z']), 'unlock');
  assert.notEqual(c('IMF unlocks new loan for Egypt', ['BTC']), 'unlock');
  assert.notEqual(c('Bitcoin unlocks a $150T market', ['BTC']), 'unlock');
  assert.notEqual(c('Company unlocks the potential of Solana', ['SOL']), 'unlock');
});

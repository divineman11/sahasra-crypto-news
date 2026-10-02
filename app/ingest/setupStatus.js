'use strict';
// Setup / safety status: which protections are ON, which are OFF, and how to fix each OFF item.
// Used three ways: the collector prints it as a banner at startup, the web app serves it at
// GET /api/setup/status (and draws the /setup page), and the home page uses it for the attention banner.
// Reads only env + two small files the collector writes (cache/heartbeat.json, cache/unlocks/view.json).
const fs = require('fs');
const path = require('path');

const HOUR = 3600e3;
const DAY = 24 * HOUR;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

const setEnv = (env, k) => String(env[k] || '').trim() !== '';
const age = (ms, now) => (ms ? now - ms : Infinity);
const failedRecently = (s, now) => !!(s && s.lastError && s.lastErrorAt && now - s.lastErrorAt < DAY && s.lastErrorAt >= (s.lastOkAt || 0));
const ago = (ms, now) => {
  const h = Math.round((now - ms) / HOUR);
  return h < 1 ? 'less than an hour ago' : h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
};

/**
 * @param {object} o
 * @param {object} [o.env]       process.env
 * @param {number} [o.now]       ms
 * @param {string} o.cacheDir    app/ingest/cache
 * @param {'startup'|'live'} [o.phase]  'startup' = the collector has only just started (nothing fetched yet is normal)
 * @param {object} [o.heartbeat] override (tests)
 * @param {object} [o.view]      override (tests)
 */
function computeStatus(o) {
  const env = o.env || process.env;
  const now = o.now || Date.now();
  const startup = o.phase === 'startup';
  const udir = env.UNLOCKS_DIR || path.join(o.cacheDir, 'unlocks');
  const view = o.view !== undefined ? o.view : readJson(path.join(udir, 'view.json'));
  const hb = o.heartbeat !== undefined ? o.heartbeat : readJson(path.join(o.cacheDir, 'heartbeat.json'));
  const src = (view && view.sources) || {};
  const features = [];
  const add = (f) => features.push(Object.assign({ important: false }, f));

  // News collector alive (web side only: the collector itself is obviously running at startup)
  if (!startup) {
    const alive = hb && age(hb.at, now) < 10 * 60e3;
    add({
      id: 'collector', label: 'News collector', important: true,
      state: alive ? 'on' : 'warn',
      detail: alive ? `running (heartbeat ${ago(hb.at, now)})` : 'not running, or not started yet — no new stories will arrive',
      fix: alive ? null : 'Open a second terminal in the app folder and run:  npm run ingest:lite   (or  npm run all:lite  to start everything).',
    });
  }

  // Unlock calendar
  const calOff = env.UNLOCKS_ENABLED === '0';
  const ll = src.defillama;
  let cal;
  if (calOff) cal = { state: 'off', detail: 'turned off (UNLOCKS_ENABLED=0)', fix: 'Delete the line UNLOCKS_ENABLED=0 from app/.env, then restart the collector.' };
  else if (failedRecently(ll, now) && age(ll.lastOkAt, now) > DAY) cal = { state: 'warn', detail: `DefiLlama could not be read: ${ll.lastError}`, fix: 'Usually temporary. The collector retries by itself. If it stays like this for a day, check your internet connection or firewall.' };
  else if (ll && ll.lastOkAt) cal = { state: 'on', detail: `updated ${ago(ll.lastOkAt, now)} (every 6 h)`, fix: null };
  else if (startup) cal = { state: 'on', detail: 'first download starts about 30 seconds after launch', fix: null };
  else cal = { state: 'warn', detail: 'no data downloaded yet', fix: 'Start the collector (npm run ingest:lite) and wait a minute.' };
  add(Object.assign({ id: 'unlockCalendar', label: 'Unlock calendar', important: true }, cal));

  // CoinGecko supply
  const cg = src.coingecko;
  let sup;
  if (calOff || env.COINGECKO_SUPPLY === '0') sup = { state: 'off', detail: 'turned off', fix: 'Delete COINGECKO_SUPPLY=0 (and UNLOCKS_ENABLED=0 if present) from app/.env. Without it the DATA MISSING and TGE badges cannot work.' };
  else if (failedRecently(cg, now) && age(cg.lastOkAt, now) > 3 * DAY) sup = { state: 'warn', detail: `CoinGecko supply failed: ${cg.lastError}`, fix: 'CoinGecko limits free calls. The collector tries at most 2 times a day. Wait, or check your internet connection.' };
  else if (cg && cg.lastOkAt) sup = { state: 'on', detail: `supply numbers updated ${ago(cg.lastOkAt, now)}`, fix: null };
  else if (startup) sup = { state: 'on', detail: 'first download happens after the unlock list is loaded', fix: null };
  else sup = { state: 'warn', detail: 'no supply numbers yet', fix: 'Wait for the first calendar run (about a minute after the collector starts).' };
  add(Object.assign({ id: 'coingeckoSupply', label: 'CoinGecko supply numbers', important: true }, sup));

  // Weekly AI cross-check
  const cc = view && view.crosscheck;
  if (!setEnv(env, 'UNLOCK_CROSSCHECK_CMD')) add({ id: 'crosscheck', label: 'Weekly AI cross-check', important: true, state: 'off', detail: 'off — unlock data may be incomplete', fix: 'Set UNLOCK_CROSSCHECK_CMD in app/.env to a command that asks your own AI. Start from scripts/crosscheck.example.js and docs/unlock-crosscheck-prompt.md.' });
  else if (cc && cc.lastError && cc.lastRunAt && cc.lastRunAt >= (cc.lastOkAt || 0)) add({ id: 'crosscheck', label: 'Weekly AI cross-check', important: true, state: 'warn', detail: `last run failed: ${cc.lastError}`, fix: 'Run your command by hand with:  npm run unlocks:crosscheck  and read the error. See docs/unlock-crosscheck-prompt.md.' });
  else add({ id: 'crosscheck', label: 'Weekly AI cross-check', important: true, state: 'on', detail: cc && cc.lastOkAt ? `last ran ${ago(cc.lastOkAt, now)}` : 'on, runs once a week', fix: null });

  // Redis live push
  if (env.NEWS_REDIS === 'off') add({ id: 'redis', label: 'Live push (Redis)', state: 'off', detail: 'off — the page shows new stories when you refresh', fix: 'Optional. Install Redis (see README), remove NEWS_REDIS=off from app/.env, and start with  npm run all  instead of  npm run all:lite.' });
  else if (!startup && hb && hb.redis === 'down') add({ id: 'redis', label: 'Live push (Redis)', state: 'warn', detail: 'Redis is not answering', fix: 'Start Redis (npm run redis), or switch to  npm run all:lite  which does not need it.' });
  else add({ id: 'redis', label: 'Live push (Redis)', state: 'on', detail: 'on — new stories appear instantly', fix: null });

  // Discord
  const hook = String(env.DISCORD_NEWS_WEBHOOK || '').trim();
  if (!hook) add({ id: 'discord', label: 'Discord alerts', state: 'off', detail: 'off — no alerts are sent', fix: 'Optional. Make a webhook in your Discord channel settings (Integrations) and paste it into DISCORD_NEWS_WEBHOOK in app/.env.' });
  else if (!/^https:\/\/(?:[a-z]+\.)?discord(?:app)?\.com\/api\/webhooks\//i.test(hook)) add({ id: 'discord', label: 'Discord alerts', state: 'warn', detail: 'the webhook link does not look like a Discord webhook', fix: 'It should start with https://discord.com/api/webhooks/ . Copy it again from Discord.' });
  else add({ id: 'discord', label: 'Discord alerts', state: 'on', detail: 'on — important watch-list news and SUPPLY SHOCK reminders (7/2/1 days)', fix: null });

  // Plain-words rewrite of explain cards
  if (setEnv(env, 'EXPLAIN_REWRITE_CMD')) add({ id: 'rewrite', label: 'Plain-words card rewrite', state: 'on', detail: 'on — every rewrite is checked so it cannot add numbers or advice', fix: null });
  else add({ id: 'rewrite', label: 'Plain-words card rewrite', state: 'off', detail: 'off — cards use the built-in templates (still correct)', fix: 'Optional. Set EXPLAIN_REWRITE_CMD in app/.env to a command that rewrites text with your own AI (reads JSON on stdin, prints JSON).' });

  // News sources failing right now (from the collector heartbeat)
  const failing = (!startup && hb && Array.isArray(hb.failing)) ? hb.failing : [];
  if (failing.length) add({ id: 'newsSources', label: 'News sources', state: 'warn', detail: `${failing.length} source(s) failing: ${failing.slice(0, 5).join(', ')}${failing.length > 5 ? '…' : ''}`, fix: 'Usually a website was down for a moment. The collector keeps retrying. If it lasts, check your internet connection.' });

  // Source failures worth telling the user about
  const sourcesFailed = [];
  for (const [name, s] of Object.entries(src)) if (failedRecently(s, now)) sourcesFailed.push({ name, error: s.lastError, at: s.lastErrorAt });

  // Attention list for the home-page banner
  const attention = [];
  for (const f of features) {
    if (f.state === 'on') continue;
    if (!f.important && f.id !== 'newsSources') continue;
    let message;
    if (f.id === 'crosscheck' && f.state === 'off') message = 'Unlock cross-check is off — unlock data may be incomplete.';
    else if (f.id === 'unlockCalendar') message = f.state === 'off' ? 'The unlock calendar is off — you can miss big unlocks.' : 'The unlock calendar could not be updated — dates may be out of date.';
    else if (f.id === 'coingeckoSupply') message = 'Supply numbers are missing — unlock sizes and the DATA MISSING check may be wrong.';
    else if (f.id === 'collector') message = 'The news collector is not running — no new stories are arriving.';
    else if (f.id === 'newsSources') message = f.detail;
    else message = `${f.label}: ${f.detail}`;
    attention.push({ id: f.id, state: f.state, message });
  }
  for (const s of sourcesFailed) {
    if (attention.some((a) => a.id === 'unlockCalendar' || a.id === 'coingeckoSupply')) continue;
    attention.push({ id: 'source:' + s.name, state: 'warn', message: `A data source (${s.name}) failed recently — numbers may be a little old.` });
  }

  return {
    generatedAt: now,
    features,
    sourcesFailed,
    attention,
    needsAttention: attention.length > 0,
    setupUrl: '/setup',
  };
}

/** Console banner for the collector's startup. Plain ASCII so every terminal shows it. */
function formatBanner(status, { port = 4180 } = {}) {
  const w = 74;
  const line = '='.repeat(w);
  const lines = [line, '  SAHASRA SAFETY CHECK  (what is protecting you, and what is switched off)', line];
  for (const f of status.features) {
    const tag = f.state === 'on' ? '[ ON  ]' : f.state === 'warn' ? '[ WARN]' : '[ OFF ]';
    lines.push(`  ${tag} ${f.label}${f.detail ? ' - ' + f.detail : ''}`);
    if (f.state !== 'on' && f.fix) lines.push(`          fix: ${f.fix}`);
  }
  lines.push(line);
  lines.push(status.needsAttention
    ? `  ${status.attention.length} thing(s) need attention. Step-by-step help: http://localhost:${port}/setup`
    : `  All important protections are on. Status page: http://localhost:${port}/setup`);
  lines.push(line);
  return lines.join('\n');
}

module.exports = { computeStatus, formatBanner };

// Bluesky adapter — one adapter for all curated accounts (`bsky:all`).
//
// One budget, one health row: 21 unauthenticated `getAuthorFeed` requests share
// a single interval, sequentially with a small gap (GAP_MS). Each account keeps
// at most MAX_PER_ACCOUNT posts per run; a dead/renamed/blocked account never
// aborts the poll. Keyless public API — default on, quietHealth: true.
//
// DID is the identity (handles change; DIDs do not). The live handle from the
// response is used for post URLs so a renamed account still links correctly.
//
// kind: 'social' routes items to the Social tab; sourceTier: 4 +
// alertable:false + maxImportance:10 keep posts never marked important, never
// a Discord alert, exactly as youtube.js documents.

'use strict';

const http = require('../http');
const { BSKY_ACCOUNTS, BSKY_FILTER } = require('../config');

const API = 'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed';
// 21 sequential requests (worst case ~320 s with gaps/timeouts) must never
// exceed the scheduler watchdog (interval + 30 s), so floor the interval at 6 min.
const INTERVAL_MS = Math.max(360000, Number(process.env.BLUESKY_INTERVAL_MS) || 600000); // 10 min
const GAP_MS = 250;                 // pause between consecutive account requests
const FORTY_EIGHT_H = 48 * 3600000;
const FUTURE_SKEW_MS = 10 * 60000;  // createdAt more than 10 min in the future => use indexedAt
const PER_ACCOUNT_LIMIT = 30;       // getAuthorFeed limit param
const MAX_PER_ACCOUNT = 10;         // newest N kept per account per run (Cas Piancey cap)
const MIN_TEXT_CHARS = 20;          // "Excellent" + image is not a headline
const TITLE_MAX = 200;
const UA = process.env.BLUESKY_USER_AGENT || 'SahasraNews/1.0 (self-hosted news reader)';

const filterRe = new RegExp(BSKY_FILTER, 'i');

// Injectable for tests.
let _sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function _setSleep(fn) {
  _sleep = fn || ((ms) => new Promise((r) => setTimeout(r, ms)));
}

// Throttled per-account error log: one line per did per hour.
const _errLogAt = new Map();
function logAccountError(acct, err) {
  const now = Date.now();
  const last = _errLogAt.get(acct.did) || 0;
  if (now - last < 3600000) return;
  _errLogAt.set(acct.did, now);
  const status = err && err.statusCode !== undefined ? err.statusCode : (err && err.status !== undefined ? err.status : 0);
  const message = (err && err.message) ? err.message : String(err);
  console.error('[bsky] ' + acct.handle + ': HTTP ' + status + ' ' + message);
}

let _disabledLogged = false;

// Collapse whitespace, strip a trailing bare URL, truncate on a word boundary.
function singleLine(text) {
  let t = String(text || '').replace(/\s+/g, ' ').trim();
  const tokens = t.split(' ');
  const last = tokens[tokens.length - 1] || '';
  const looksLikeUrl = /^(https?:\/\/|www\.)\S+$/i.test(last);
  const rest = looksLikeUrl ? tokens.slice(0, -1).join(' ').trim() : t;
  if (looksLikeUrl && rest.length >= MIN_TEXT_CHARS) t = rest;
  if (t.length > TITLE_MAX) {
    t = t.slice(0, TITLE_MAX);
    const sp = t.lastIndexOf(' ');
    if (sp > 0) t = t.slice(0, sp);
    t += '…';
  }
  return t;
}

function buildUrl(handle, uri) {
  const rkey = String(uri || '').split('/').pop();
  return 'https://bsky.app/profile/' + handle + '/post/' + rkey;
}

function parseFeed(json, acct, nowMs = Date.now()) {
  const items = [];
  if (!json || !Array.isArray(json.feed)) return items;
  for (const f of json.feed) {
    if (items.length >= MAX_PER_ACCOUNT) break;
    if (f.reason) continue;                       // reposts / pins
    if (f.reply || (f.post && f.post.record && f.post.record.reply)) continue;
    const post = f.post;
    const rec = post && post.record;
    if (!post || !rec || !post.uri) continue;
    let text = String(rec.text || '');
    const ext = (rec.embed && rec.embed.$type === 'app.bsky.embed.external') ? rec.embed.external : null;
    if (text.trim().length < MIN_TEXT_CHARS && ext && ext.title) text = ext.title;
    if (text.trim().length < MIN_TEXT_CHARS) continue;
    const title = singleLine(text);
    if (acct.filter !== false &&
        !filterRe.test(text + ' ' + (ext ? ext.title + ' ' + (ext.description || '') : ''))) continue;
    if (Array.isArray(rec.langs) && rec.langs.length && !rec.langs.some((l) => /^en/i.test(l))) continue;
    const created = new Date(rec.createdAt);
    const indexed = new Date(post.indexedAt);
    let ts;
    if (isNaN(created.getTime()) || created.getTime() > nowMs + FUTURE_SKEW_MS) ts = indexed;
    else ts = created;
    if (isNaN(ts.getTime())) continue;
    if (ts.getTime() < nowMs - FORTY_EIGHT_H) continue;
    const rkey = post.uri.split('/').pop();
    if (!rkey) continue;
    const live = post.author && post.author.handle;
    const handle = (live && live !== 'handle.invalid') ? live : acct.handle;
    const url = buildUrl(handle, post.uri);
    items.push({
      sourceName: 'bsky:' + acct.handle,
      sourceTier: 4,
      kind: 'social',
      exchange: null,
      title,
      url,
      publishedAt: ts,
      hintCategory: null,
      hintTickers: [],
      sourceDomain: 'bsky.app',
      alertable: false,
      maxImportance: 10,
      uri: post.uri
    });
  }
  return items;
}

async function run(accounts) {
  const out = [];
  const seen = new Set();
  let okCount = 0, failCount = 0, lastErr = null;
  let first = true;
  for (const acct of accounts) {
    if (!first) await _sleep(GAP_MS);
    first = false;
    const url = API + '?actor=' + encodeURIComponent(acct.did) +
      '&filter=posts_no_replies&limit=' + PER_ACCOUNT_LIMIT;
    let items;
    try {
      const res = await http.request(url, { ua: UA, timeoutMs: 15000 });
      items = parseFeed(res.json(), acct);
      okCount++;
    } catch (err) {
      failCount++;
      lastErr = err;
      logAccountError(acct, err);
      continue;
    }
    for (const item of items) {
      if (seen.has(item.uri)) continue;
      seen.add(item.uri);
      delete item.uri;
      out.push(item);
    }
  }
  if (okCount === 0 && failCount > 0) throw lastErr;
  out.sort((a, b) => b.publishedAt - a.publishedAt);
  return out;
}

function makeAdapter(accounts = BSKY_ACCOUNTS) {
  return { name: 'bsky:all', tier: 4, intervalMs: INTERVAL_MS, quietHealth: true, run: () => run(accounts) };
}

function make(accounts = BSKY_ACCOUNTS) {
  if (process.env.BLUESKY_ENABLED === '0') {
    if (!_disabledLogged) {
      _disabledLogged = true;
      console.log('[bsky] disabled (BLUESKY_ENABLED=0)');
    }
    return [];
  }
  return [makeAdapter(accounts)];
}

module.exports = { make, makeAdapter, parseFeed, singleLine, buildUrl, _setSleep, API, INTERVAL_MS };
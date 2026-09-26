'use strict';

// (updated): Reddit adapter, two modes sharing one rate budget:
//
// 1. OAuth mode (one adapter per subreddit in config.REDDIT_SUBS, active when all four
// REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET/REDDIT_USERNAME/REDDIT_PASSWORD env keys are set) —
// authenticated via OAuth's "password" grant. One access token is fetched and cached
// module-wide (`cachedToken`) and shared across every subreddit adapter.
//
// 2. Keyless RSS mode (Reddit no longer issues free "script" API apps): a single adapter
// 'reddit:multi' requesting https://www.reddit.com/r/<sub1>+<sub2>+.../hot/.rss?limit=100
// every 10 minutes (RSS_INTERVAL_MS, overridable via REDDIT_RSS_INTERVAL_MS, min 2 min).
//
// Both modes share one 60 s minimum gap between any two reddit.com requests (`awaitRedditGap`).
//
// kind 'social', tier 4, alertable:false, maxImportance:10 (never marked important, never a
// Discord alert — same withCap()/store.js guarantee as youtube.js). hintTickers is always [] —
// the title tagger (tickers.js) runs on the raw Reddit title like any other untagged source.

const http = require('../http');
const { REDDIT_SUBS } = require('../config');
const Parser = require('rss-parser').Parser || require('rss-parser');

const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const REFRESH_SKEW_MS = 60000; // treat the token as expired 60s before Reddit says it is
const INTERVAL_MS = 5 * 60000;
const FORTY_EIGHT_H = 48 * 3600000;
const NEWS_FLAIR_RE = /news|breaking/i;

const RSS_BASE = 'https://www.reddit.com/r/';
const RSS_SUFFIX = '/hot/.rss?limit=100';
const RSS_INTERVAL_MS = Math.max(120000, Number(process.env.REDDIT_RSS_INTERVAL_MS) || 600000);
const REDDIT_MIN_GAP_MS = 60000;
const DAILY_THREAD_RE = /\b(daily|weekly|monthly)\b.*\b(discussion|thread|megathread)\b|\bmegathread\b|\bgeneral discussion\b/i;
const AUTOMOD = '/u/AutoModerator';
const SUB_FROM_LINK_RE = /^https?:\/\/(?:www\.|old\.)?reddit\.com\/r\/([^/]+)\//i;
const DEFAULT_RSS_UA = 'SahasraNews/1.0 (self-hosted RSS reader)';

function env() {
  return {
    clientId: process.env.REDDIT_CLIENT_ID || '',
    clientSecret: process.env.REDDIT_CLIENT_SECRET || '',
    username: process.env.REDDIT_USERNAME || '',
    password: process.env.REDDIT_PASSWORD || '',
    userAgent: process.env.REDDIT_USER_AGENT || '',
  };
}

function isConfigured(e = env()) {
  return !!(e.clientId && e.clientSecret && e.username && e.password);
}

function userAgentFor(e) {
  return e.userAgent || 'SahasraNews/1.0 (by u/' + e.username + ')';
}

// Injectable clock + shared gap between any two reddit.com requests (OAuth and RSS share the
// single budget). `_clock` is swappable in tests; `lastRedditRequestAt` records when the most
// recent reddit.com request was issued.
const _clock = { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };
let lastRedditRequestAt = 0;
async function awaitRedditGap() {
  const wait = REDDIT_MIN_GAP_MS - (_clock.now() - lastRedditRequestAt);
  if (lastRedditRequestAt > 0 && wait > 0) await _clock.sleep(wait);
  lastRedditRequestAt = _clock.now();
}

function mode(e = env()) {
  if (isConfigured(e)) return 'oauth';
  if (process.env.REDDIT_RSS_ENABLED === '0') return 'off';
  return 'rss';
}

function rssUrl(subs) {
  return RSS_BASE + (subs || []).map((s) => s.sub).join('+') + RSS_SUFFIX;
}

function rssUserAgent(e = env()) {
  return e.userAgent || DEFAULT_RSS_UA;
}

// Pure parser for a multireddit /hot/.rss document. Maps each <entry> back to its subreddit via
// the permalink link, applies per-sub filters (skip AutoModerator, daily/weekly/megathread
// titles, >48h old posts) and caps each sub at cfg.rssTake (default 5) — feed order is hot order,
// so the cap keeps the hottest posts. Returns the standard item shape; never fetches anything.
async function parseRssItems(text, subs, nowMs = Date.now()) {
  const parser = new Parser({ timeout: 15000 });
  const parsed = await parser.parseString(String(text || ''));
  const bySubLower = new Map((subs || []).map((s) => [String(s.sub).toLowerCase(), s]));
  const taken = new Map();
  const cutoff = nowMs - FORTY_EIGHT_H;
  const items = [];
  for (const it of parsed.items || []) {
    const link = String(it.link || '').trim();
    const m = SUB_FROM_LINK_RE.exec(link);
    if (!m) continue;
    const cfg = bySubLower.get(m[1].toLowerCase());
    if (!cfg) continue;                          // multireddit self-link or a sub we don't follow
    if (String(it.author || '').trim() === AUTOMOD) continue;
    const title = String(it.title || '').trim();
    if (!title || DAILY_THREAD_RE.test(title)) continue;
    const publishedAt = new Date(it.isoDate || it.pubDate || '');
    if (isNaN(publishedAt.getTime()) || publishedAt.getTime() < cutoff) continue;
    const n = taken.get(cfg.sub) || 0;
    if (n >= (cfg.rssTake || 5)) continue;       // feed order = hot order, so the cap keeps the hottest
    taken.set(cfg.sub, n + 1);
    items.push({
      sourceName: 'reddit:' + cfg.sub, sourceTier: 4, kind: 'social', exchange: null, title,
      url: link.split('?')[0], publishedAt, hintCategory: null, hintTickers: [], sourceDomain: 'reddit.com',
      alertable: false, maxImportance: 10,
    });
  }
  return items;
}

function makeRssAdapter(subs) {
  return {
    name: 'reddit:multi', tier: 4, intervalMs: RSS_INTERVAL_MS, quietHealth: true,
    async run() {
      await awaitRedditGap();
      const res = await http.request(rssUrl(subs), { ua: rssUserAgent(env()), timeoutMs: 20000 });
      return parseRssItems(res.text, subs);
    },
  };
}

// Module-wide token cache, shared by every subreddit adapter (one script-app login for all of
// them). `tokenPromise` collapses concurrent callers into a single in-flight token fetch.
let cachedToken = null; // { accessToken, expiresAt }
let tokenPromise = null;

async function fetchToken(e) {
  const auth = Buffer.from(e.clientId + ':' + e.clientSecret).toString('base64');
  const body = 'grant_type=password&username=' + encodeURIComponent(e.username) + '&password=' + encodeURIComponent(e.password);
  const res = await http.request(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    ua: userAgentFor(e),
    timeoutMs: 15000,
  });
  const json = res.json();
  if (!json || !json.access_token) {
    // surface Reddit's own (non-secret) error code — e.g. "invalid_grant"
    // for a bad password or an account with 2FA enabled that needs "password:otp" instead — never
    // the credentials themselves.
    const errCode = json && json.error ? json.error : 'no access_token in response';
    throw new Error('reddit: token request failed (' + errCode + ')');
  }
  const expiresAt = Date.now() + (Number(json.expires_in) || 3600) * 1000;
  cachedToken = { accessToken: json.access_token, expiresAt };
  return cachedToken.accessToken;
}

// a concurrent fetch (forced or not) is always collapsed into the single
// in-flight `tokenPromise` — the earlier version only did this for non-forced calls, so N
// adapters hitting a 401 at once could each fire their own forced-refresh POST. A rejected fetch
// clears `tokenPromise` (via .finally below) without ever populating `cachedToken`, so a failed
// attempt is never cached and the next call retries cleanly.
async function getToken({ force = false } = {}) {
  const e = env();
  if (!force && cachedToken && cachedToken.expiresAt - REFRESH_SKEW_MS > Date.now()) {
    return cachedToken.accessToken;
  }
  if (tokenPromise) return tokenPromise;
  const p = fetchToken(e).finally(() => {
    if (tokenPromise === p) tokenPromise = null;
  });
  tokenPromise = p;
  return p;
}

// GET a subreddit's /hot listing. On a 401 (expired/invalid token, e.g. another process rotated
// it): if `cachedToken` has already moved on from the token this request used (another adapter's
// concurrent refresh beat us to it), reuse that newer token instead of forcing yet another POST
// (F5) — otherwise force exactly one refresh and retry once. A second 401 propagates as-is (the
// scheduler's normal HttpError-driven backoff handles it, same as any other adapter's
// auth/rate-limit failure) — including a non-401 error (e.g. 429), which is never intercepted
// here and propagates with its original status/retryAfterMs untouched.
async function fetchHot(sub, e) {
  const url = 'https://oauth.reddit.com/r/' + sub + '/hot?limit=50&raw_json=1';
  const token = await getToken();
  try {
    await awaitRedditGap();
    const res = await http.request(url, { headers: { Authorization: 'Bearer ' + token }, ua: userAgentFor(e), timeoutMs: 15000 });
    return res.json();
  } catch (err) {
    if (!err || err.status !== 401) throw err;
    const freshToken = (cachedToken && cachedToken.accessToken && cachedToken.accessToken !== token)
      ? cachedToken.accessToken
      : await getToken({ force: true });
    const res2 = await http.request(url, { headers: { Authorization: 'Bearer ' + freshToken }, ua: userAgentFor(e), timeoutMs: 15000 });
    return res2.json();
  }
}

function makeSubAdapter(cfg) {
  const sub = cfg.sub;
  const minScore = cfg.minScore;
  const name = 'reddit:' + sub;

  async function run() {
    const e = env();
    const json = await fetchHot(sub, e);
    const children = json && json.data && Array.isArray(json.data.children) ? json.data.children : [];
    const cutoff = Date.now() - FORTY_EIGHT_H;
    const items = [];
    for (const c of children) {
      const d = c && c.data;
      if (!d) continue;
      if (d.stickied) continue;
      if (d.over_18) continue;
      // a moderator/automod-removed or author-deleted post has nothing
      // worth showing (title/permalink survive removal, but the content behind them is gone).
      if (d.removed_by_category) continue;
      if (d.author === '[deleted]') continue;
      if (d.selftext === '[removed]' || d.selftext === '[deleted]') continue;
      const publishedAt = new Date((Number(d.created_utc) || 0) * 1000);
      if (isNaN(publishedAt.getTime()) || publishedAt.getTime() < cutoff) continue;
      const score = Number(d.score) || 0;
      const flair = String(d.link_flair_text || '');
      if (!(score >= minScore || NEWS_FLAIR_RE.test(flair))) continue;
      const title = String(d.title || '').trim();
      const permalink = String(d.permalink || '');
      if (!title || !permalink) continue;
      items.push({
        sourceName: name,
        sourceTier: 4,
        kind: 'social',
        exchange: null,
        title,
        url: 'https://www.reddit.com' + permalink,
        publishedAt,
        hintCategory: null,
        hintTickers: [],
        sourceDomain: 'reddit.com',
        alertable: false,
        maxImportance: 10,
      });
    }
    return items;
  }

  return { name, tier: 4, intervalMs: INTERVAL_MS, run };
}

let disabledLogged = false;
let rssLogged = false;

function make(subs = REDDIT_SUBS) {
  const m = mode();
  if (m === 'oauth') return (subs || []).map(makeSubAdapter);
  if (m === 'rss') {
    if (!rssLogged) {
      rssLogged = true;
      console.log('[reddit] unauthenticated RSS mode — one multireddit /hot/.rss request every ' + Math.round(RSS_INTERVAL_MS / 60000) + ' min for ' + (subs || []).length + ' subs (set REDDIT_* keys for OAuth mode, REDDIT_RSS_ENABLED=0 to turn off)');
    }
    return [makeRssAdapter(subs || [])];
  }
  if (!disabledLogged) {
    disabledLogged = true;
    console.log('[reddit] disabled — REDDIT_RSS_ENABLED=0 and no REDDIT_CLIENT_ID/SECRET/USERNAME/PASSWORD keys');
  }
  return [];
}

module.exports = { make, makeSubAdapter, isConfigured, getToken, fetchToken, fetchHot, userAgentFor, mode, rssUrl, rssUserAgent, parseRssItems, makeRssAdapter, awaitRedditGap, _clock };
'use strict';

// Generalized t.me/s/<channel> wire adapter: one instance per entry in config.TG_CHANNELS.
// Message id/url/publishedAt come from bwenews.js's own tested segment parser (`parseBwenews`)
// reused as-is — that function's public behaviour and tests (the unit tests)
// are untouched, since it is already channel-agnostic (it only reads whatever
// `data-post="<channel>/<id>"` markup the Telegram widget page contains). bwenews.js itself is
// not modified and `tg:bwenews` keeps its own dedicated adapter with its BWEnews-specific gating
// (GATING_RE/DISCARD_RE/CJK title cut).
//
// Title TEXT is extracted separately, locally, by this file (extractTextLines below), not via
// bwenews.js's own extractText(): that one collapses every whitespace run — including the real
// newlines it inserts for `<br>` — into a single space, which is fine for bwenews's own gating
// but loses exactly the line-break information a wire title needs to be built from (its first
// line). Duplicating this one small, regex-for-regex-comparable helper here (rather than changing
// bwenews.js's tested, public flattening behaviour) keeps bwenews.js's diff at zero.
//
// Title used to fall back to "the first sentence" (split on the first
// [.!?] + whitespace) when a message had no real line break — but a single line with no <br> is
// the NORMAL shape for Walter_Bloomberg/WatcherGuru/Tree/PeckShield/CertiK, and that heuristic
// truncated headlines at ordinary abbreviations ("U.S.", "vs.", "Inc.", "approx.", "SEC v.",
// "Sept. 30"), which then made the Walter_Bloomberg crypto/macro filter drop real headlines
// whose only matching keyword happened to fall after the abbreviation it cut at. The sentence
// heuristic is gone: title = the first real line if the message has one, otherwise the WHOLE
// message text (bounded only by the 240-char cap below, cut at a word boundary).

const http = require('../http');
const { BROWSER_UA, TG_CHANNELS } = require('../config');
const { parseBwenews } = require('./bwenews');

const SEVEN_D = 7 * 86400000;
const MAX_TITLE_LEN = 240;

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// Same message-text <div> match as bwenews.js's extractText, but `<br>` becomes a real "\n"
// (kept, not collapsed away) so callers can find the first LINE of a message.
function extractTextLines(segment) {
  const seg = segment.replace(/<a[^>]*class="[^"]*tgme_widget_message_reply[^"]*"[\s\S]*?<\/a>/g, '');
  let m = seg.match(/<[^>]*class="[^"]*tgme_widget_message_text[^"]*js-message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  if (!m) {
    m = seg.match(/<[^>]*class="[^"]*tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    if (m && /js-message_reply_text/.test(m[0])) m = null;
  }
  if (!m) return '';
  const inner = m[1]
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  const decoded = decodeEntities(inner);
  // collapse horizontal whitespace within each line only; real line breaks survive.
  return decoded
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

// title = the message's first real line (a genuine <br>-derived break), or — when the message is
// a single line, the normal shape for most wire channels — the whole message text, untouched
// (B2 fix: no more "first sentence" guess, which truncated at ordinary abbreviations).
function firstLineOrFull(rawText) {
  const text = String(rawText || '');
  const nlIdx = text.indexOf('\n');
  return (nlIdx === -1 ? text : text.slice(0, nlIdx)).trim();
}

// Leading/trailing emoji or pictographs used as wire-service attention markers (e.g. leading
// "\u{1F6A8} JUST IN:" or "⚡️ BREAKING:"), anchored to the start/end only — a symbol
// that's part of the actual headline text ("BTC → $100k") must never be touched.
const SYMBOL_CLASS = '[\\u{1F000}-\\u{1FFFF}\\u{2600}-\\u{27BF}\\u{2190}-\\u{21FF}\\u{2B00}-\\u{2BFF}\\u{FE0F}\\u{200D}]';
const LEADING_EMOJI_RE = new RegExp('^(?:' + SYMBOL_CLASS + '|\\s)+', 'u');
const TRAILING_EMOJI_RE = new RegExp('(?:' + SYMBOL_CLASS + '|\\s)+$', 'u');
const WIRE_PREFIX_RE = /^(JUST IN|BREAKING NEWS|BREAKING|URGENT|ALERT|UPDATE|NEW)\s*[:\-—]+\s*/i;
const TRAILING_SOURCE_RE = /\s*(?:Source|Src|via|H\/T)\s*[:\-]\s*\S*$/i;
const TRAILING_URL_RE = /\s*https?:\/\/\S+$/i;

function cleanTitle(rawText) {
  let t = firstLineOrFull(rawText);
  // Emoji burst and wire prefix can appear in either order ("\u{1F6A8} JUST IN:" or
  // "JUST IN: \u{1F6A8}"), so strip both, alternating, until neither removes anything more.
  for (let i = 0; i < 3; i++) {
    const before = t;
    t = t.replace(LEADING_EMOJI_RE, '').trim();
    t = t.replace(WIRE_PREFIX_RE, '').trim();
    if (t === before) break;
  }
  t = t.replace(TRAILING_SOURCE_RE, '').replace(TRAILING_URL_RE, '').trim();
  t = t.replace(TRAILING_EMOJI_RE, '').trim();
  return t;
}

function isLinkOnly(title) {
  return !title || /^https?:\/\/\S+$/i.test(title);
}

// B2: cut long titles at a word boundary (never mid-word) and mark the cut with an ellipsis,
// instead of a hard character-count slice. Result length is always <= maxLen.
function truncateAtWord(s, maxLen) {
  if (s.length <= maxLen) return s;
  const budget = maxLen - 1; // leave room for the ellipsis character
  const cut = s.slice(0, budget);
  const lastSpace = cut.lastIndexOf(' ');
  const trimmed = (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
  return trimmed + '…';
}

function makeChannelAdapter(cfg) {
  const channel = cfg.channel;
  const nameLower = String(channel).toLowerCase();
  const name = 'tg:' + nameLower;
  const pageUrl = 'https://t.me/s/' + channel;
  const tier = cfg.tier || 3;
  const intervalMs = cfg.intervalMs || 60000;
  const alertable = cfg.alertable !== false; // default true unless explicitly false
  const maxImportance = typeof cfg.maxImportance === 'number' ? cfg.maxImportance : null;
  const titlePrefix = cfg.titlePrefix || '';
  const filterRe = cfg.filter ? new RegExp(cfg.filter, 'i') : null;
  // F1: unverified by default (same treatment as an unverified officialSources.json entry) —
  // scheduler.js backs a quietHealth adapter off to <=1/6h once it's been failing for a while,
  // and health.js never pages Discord for it.
  const quietHealth = cfg.verified !== true;

  async function run() {
    const res = await http.request(pageUrl, { ua: BROWSER_UA, timeoutMs: 15000 });
    if (res.status !== 200) {
      throw new Error(name + ': unexpected status ' + res.status);
    }
    const messages = parseBwenews(res.text); // id/url/publishedAt — bwenews.js's own parser

    // Raw per-message HTML, split exactly the way bwenews.js's parseBwenews does, used only to
    // recover the line-preserving text above (matched back to each message by its `data-post`
    // id, which is what parseBwenews sets as `msg.id`).
    const rawSegments = res.text.split('data-post="').slice(1);
    const rawTextById = new Map();
    for (const raw of rawSegments) {
      const idPart = raw.slice(0, raw.indexOf('"'));
      if (idPart && !rawTextById.has(idPart)) rawTextById.set(idPart, extractTextLines(raw));
    }

    const cutoff = Date.now() - SEVEN_D;
    const seen = new Set(); // dedupe within a single page fetch
    const items = [];
    for (const msg of messages) {
      if (!msg.publishedAt || msg.publishedAt.getTime() < cutoff) continue;
      if (seen.has(msg.url)) continue;
      seen.add(msg.url);

      const rawText = rawTextById.get(msg.id) || msg.text || '';
      const cleaned = cleanTitle(rawText);
      if (isLinkOnly(cleaned)) continue; // link-only post — nothing to show
      // The channel filter (e.g. Walter_Bloomberg's crypto/macro filter) must see the full,
      // cleaned title — never a truncated one — so a keyword that only appears late in a long
      // headline is not lost (B2).
      if (filterRe && !filterRe.test(cleaned)) continue;
      const title = truncateAtWord(cleaned, MAX_TITLE_LEN);

      const item = {
        sourceName: name,
        sourceTier: tier,
        kind: 'news',
        exchange: null,
        title: titlePrefix + title,
        url: msg.url,
        publishedAt: msg.publishedAt,
        hintCategory: null,
        hintTickers: [],
        sourceDomain: 't.me',
      };
      if (!alertable) item.alertable = false;
      if (maxImportance !== null) item.maxImportance = maxImportance;
      items.push(item);
    }
    return items;
  }

  return { name, tier, intervalMs, run, quietHealth };
}

function make(channels = TG_CHANNELS) {
  return (channels || []).map(makeChannelAdapter);
}

module.exports = { make, makeChannelAdapter, cleanTitle, firstLineOrFull, truncateAtWord, extractTextLines };

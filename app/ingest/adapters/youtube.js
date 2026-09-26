'use strict';

// YouTube Media tab, one adapter per channel in config.YT_CHANNELS.
//   feed: https://www.youtube.com/feeds/videos.xml?channel_id=<ID> (Atom: <entry><yt:videoId>,
//   <title>, <link rel="alternate" href>, <published>, <media:group><media:thumbnail url>).
// kind 'media', tier 4, alertable:false, maxImportance:10 (never marked important, never a
// Discord alert — classify.js's withCap() applies the cap on every return path, and store.js
// never sets alertState:'pending' when raw.alertable === false). Title is left exactly as
// YouTube has it — no titlePrefix — the coin-page/feed source column already shows the channel
// via sourceName.
//
// YouTube Shorts are skipped when detectable: a Shorts entry's <link> contains "/shorts/" rather
// than "/watch?v=". url is always rebuilt as the canonical https://www.youtube.com/watch?v=<id>
// form (not whatever query string YouTube's feed happens to emit) so later URL-based dedupe in
// store.js is stable.
//
// a channel's videos.xml <entry><link> almost certainly always uses the
// normal /watch?v=<id> form even for a Short (YouTube's Shorts distinction is a player/surface
// thing, not a separate feed entry shape), so isShorts() is very likely a no-op in practice —
// there is no cheap, feed-only signal that positively marks an entry as a Short. It is kept
// anyway as a defensive, zero-cost check (a plain regex on data already in hand) for the case
// where the feed link does contain "/shorts/": we deliberately do NOT add an extra HEAD/GET
// request to youtube.com/shorts/<id> to positively classify every entry, since that would double
// this adapter's request volume for a tab (Media) that never alerts and is capped at
// importance<=10 either way.

const Parser = require('rss-parser').Parser || require('rss-parser');
const { request } = require('../http');
const { YT_CHANNELS } = require('../config');

const INTERVAL_MS = 30 * 60000;
const SEVEN_D = 7 * 86400000;
const MAX_ITEMS = 20;

function isShorts(link) {
  return /\/shorts\//i.test(String(link || ''));
}

// Pulls the video id out of a normal watch link (?v=<id>) — used as a fallback when the feed's
// own <yt:videoId> element is missing for some reason.
function videoIdFromLink(link) {
  const m = String(link || '').match(/[?&]v=([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : null;
}

function canonicalUrl(videoId) {
  return 'https://www.youtube.com/watch?v=' + videoId;
}

function parseDate(it) {
  const d = new Date(it.isoDate || it.pubDate || '');
  return isNaN(d.getTime()) ? null : d;
}

function capAndSort(items) {
  items.sort((a, b) => b.publishedAt - a.publishedAt);
  items.length = Math.min(items.length, MAX_ITEMS);
  return items;
}

function makeChannelAdapter(entry) {
  const name = 'yt:' + entry.slug;
  const feedUrl = 'https://www.youtube.com/feeds/videos.xml?channel_id=' + entry.channelId;
  const parser = new Parser({ timeout: 15000, customFields: { item: [['yt:videoId', 'videoId']] } });

  async function run() {
    const res = await request(feedUrl, { conditional: true });
    if (res.notModified || res.status === 304) return [];
    const parsed = await parser.parseString(res.text);
    const cutoff = Date.now() - SEVEN_D;
    const items = [];
    for (const it of parsed.items || []) {
      const link = String(it.link || '').trim();
      if (!link) continue;
      if (isShorts(link)) continue; // Shorts are not long-form Media-tab content
      const title = String(it.title || '').trim();
      if (!title) continue;
      const publishedAt = parseDate(it);
      if (!publishedAt || publishedAt.getTime() < cutoff) continue;
      const videoId = it.videoId || videoIdFromLink(link);
      if (!videoId) continue;
      items.push({
        sourceName: name,
        sourceTier: 4,
        kind: 'media',
        exchange: null,
        title,
        url: canonicalUrl(videoId),
        publishedAt,
        hintCategory: null,
        hintTickers: [],
        sourceDomain: 'youtube.com',
        alertable: false,
        maxImportance: 10,
      });
    }
    return capAndSort(items);
  }

  return { name, tier: 4, intervalMs: INTERVAL_MS, quietHealth: entry.verified !== true, run };
}

function make(channels = YT_CHANNELS) {
  return (channels || []).map(makeChannelAdapter);
}

module.exports = { make, makeChannelAdapter, isShorts, videoIdFromLink, canonicalUrl };
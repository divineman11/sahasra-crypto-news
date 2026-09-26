'use strict';

const Parser = require('rss-parser').Parser || require('rss-parser');
const { request } = require('../http');
const { RSS_FEEDS, SEC_UA } = require('../config');

function parseDate(it) {
  const d = new Date(it.isoDate || it.pubDate || '');
  return isNaN(d.getTime()) ? null : d;
}

function make() {
  const adapters = [];
  for (const feed of RSS_FEEDS || []) {
    const parser = new Parser({ timeout: 15000 });
    const tier = feed.tier || 3;
    const intervalMs = feed.intervalMs || 90000;
    const kind = feed.kind || 'news';
    const titlePrefix = feed.titlePrefix || '';
    const filter = feed.filter ? new RegExp(feed.filter, 'i') : null;
    adapters.push({
      name: feed.name,
      tier,
      intervalMs,
      async run() {
        const res = await request(feed.url, { conditional: true });
        if (res.notModified || res.status === 304) return [];
        const parsed = await parser.parseString(res.text);
        const items = [];
        for (const it of parsed.items || []) {
          const title = String(it.title || '').trim();
          const url = String(it.link || '').trim();
          if (!title || !url) continue;
          const publishedAt = parseDate(it);
          if (!publishedAt) continue;
          if (filter && !filter.test(title)) continue;
          items.push({
            sourceName: feed.name,
            sourceTier: tier,
            kind,
            exchange: null,
            title: titlePrefix + title,
            url,
            publishedAt,
            hintCategory: null,
            hintTickers: [],
          });
        }
        if (feed.maxItems) {
          items.sort((a, b) => b.publishedAt - a.publishedAt);
          items.length = Math.min(items.length, feed.maxItems);
        }
        return items;
      },
    });
  }

  if (SEC_UA) {
    const parser = new Parser({ timeout: 15000 });
    adapters.push({
      name: 'sec',
      tier: 2,
      kind: 'regulator',
      intervalMs: 120000,
      async run() {
        const res = await request('https://www.sec.gov/news/pressreleases.rss', {
          ua: SEC_UA,
        });
        if (res.notModified || res.status === 304) return [];
        const parsed = await parser.parseString(res.text);
        const items = [];
        for (const it of parsed.items || []) {
          const title = String(it.title || '').trim();
          const url = String(it.link || '').trim();
          if (!title || !url) continue;
          const publishedAt = parseDate(it);
          if (!publishedAt) continue;
          items.push({
            sourceName: 'sec',
            sourceTier: 2,
            kind: 'regulator',
            exchange: null,
            title: '[SEC] ' + title,
            url,
            publishedAt,
            hintCategory: null,
            hintTickers: [],
          });
        }
        return items;
      },
    });
  }

  return adapters;
}

module.exports = { make };
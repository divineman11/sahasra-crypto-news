'use strict';

const { request } = require('../http');

const TYPES = [
  { type: 'new_crypto', hint: 'listing' },
  { type: 'delistings', hint: 'delisting' },
];

function make() {
  let idx = 0;
  return {
    name: 'bybit',
    tier: 1,
    intervalMs: 2500,
    warmRuns: 2,
    async run() {
      const { type, hint } = TYPES[idx % TYPES.length];
      idx++;
      const res = await request(
        `https://api.bybit.com/v5/announcements/index?locale=en-US&type=${type}&limit=20`,
        {}
      );
      if (res.notModified || res.status === 304) return [];
      const body = res.json();
      if (!body || body.retCode !== 0) {
        throw new Error(
          `bybit: API error code=${body ? body.retCode : 'n/a'} msg=${body ? body.retMsg : 'no body'}`
        );
      }
      const list = (body.result && body.result.list) || [];
      if (!Array.isArray(list) || list.length === 0) {
        throw new Error('bybit: empty list (API shape change?)');
      }
      const items = [];
      for (const it of list) {
        const title = String(it.title || '').trim();
        const url = String(it.url || '').trim();
        if (!title || !url) continue;
        items.push({
          sourceName: 'bybit',
          sourceTier: 1,
          kind: 'exchange',
          exchange: 'Bybit',
          title,
          url,
          publishedAt: new Date(it.publishTime),
          hintCategory: hint,
          hintTickers: [],
        });
      }
      return items;
    },
  };
}

module.exports = { make };
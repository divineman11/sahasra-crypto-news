'use strict';

const { request } = require('../http');

const TYPES = [
  { annType: 'new-listings', hint: 'listing' },
  { annType: 'delistings', hint: 'delisting' },
];

function make() {
  let idx = 0;
  return {
    name: 'kucoin',
    tier: 1,
    intervalMs: 2500,
    warmRuns: 2,
    async run() {
      const { annType, hint } = TYPES[idx % TYPES.length];
      idx++;
      const res = await request(
        `https://api.kucoin.com/api/v3/announcements?annType=${annType}&lang=en_US&pageSize=20`,
        {}
      );
      if (res.notModified || res.status === 304) return [];
      const body = res.json();
      if (!body || body.code !== '200000') {
        throw new Error(
          `kucoin: API error code=${body && body.code} msg=${body && body.msg}`
        );
      }
      const list = (body.data && body.data.items) || [];
      if (list.length === 0) {
        throw new Error(`kucoin: empty list (API shape change?)`);
      }
      const items = [];
      for (const it of list) {
        const title = String(it.annTitle || '').trim();
        const url = String(it.annUrl || '').trim();
        if (!title || !url) continue;
        items.push({
          sourceName: 'kucoin',
          sourceTier: 1,
          kind: 'exchange',
          exchange: 'KuCoin',
          title,
          url,
          publishedAt: new Date(it.cTime),
          hintCategory: hint,
          hintTickers: [],
        });
      }
      return items;
    },
  };
}

module.exports = { make };
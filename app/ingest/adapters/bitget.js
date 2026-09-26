'use strict';

const { request } = require('../http');

const TYPES = [
  { annType: 'coin_listings', hint: 'listing' },
  { annType: 'symbol_delisting', hint: 'delisting' },
];

function make() {
  let idx = 0;
  return {
    name: 'bitget',
    tier: 1,
    intervalMs: 2500,
    warmRuns: 2,
    async run() {
      const { annType, hint } = TYPES[idx % TYPES.length];
      idx++;
      const res = await request(
        `https://api.bitget.com/api/v2/public/annoucements?annType=${annType}&language=en_US`,
        {}
      );
      if (res.notModified || res.status === 304) return [];
      const body = res.json();
      if (!body || body.code !== '00000') {
        throw new Error(
          `bitget: API error code=${body && body.code} msg=${body && body.msg}`
        );
      }
      const list = (body && body.data) || [];
      if (!Array.isArray(list) || list.length === 0) {
        throw new Error('bitget: empty list (API shape change?)');
      }
      const items = [];
      for (const it of list) {
        const title = String(it.annTitle || '').trim();
        const url = String(it.annUrl || '').trim();
        if (!title || !url) continue;
        items.push({
          sourceName: 'bitget',
          sourceTier: 1,
          kind: 'exchange',
          exchange: 'Bitget',
          title,
          url,
          publishedAt: new Date(Number(it.cTime)),
          hintCategory: hint,
          hintTickers: [],
        });
      }
      return items;
    },
  };
}

module.exports = { make };
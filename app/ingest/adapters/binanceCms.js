'use strict';

const { request } = require('../http');

const TYPES = [
  { catalogId: 48, hint: 'listing' },
  { catalogId: 161, hint: 'delisting' },
];

function make() {
  let idx = 0;
  return {
    name: 'binance-cms',
    tier: 1,
    intervalMs: 12000,
    warmRuns: 2,
    async run() {
      const { catalogId, hint } = TYPES[idx % TYPES.length];
      idx++;
      const res = await request(
        `https://www.binance.com/bapi/composite/v1/public/cms/article/list/query?type=1&pageNo=1&pageSize=20&catalogId=${catalogId}`,
        { conditional: true }
      );
      if (res.notModified || res.status === 304) return [];
      const body = res.json();
      if (!body || body.code !== '000000') {
        throw new Error(
          `binance-cms: API error code=${body && body.code} msg=${body && body.msg}`
        );
      }
      const catalogs = (body.data && body.data.catalogs) || [];
      const articles =
        (catalogs[0] && catalogs[0].articles) || [];
      const items = [];
      for (const it of articles) {
        const title = String(it.title || '').trim();
        const code = String(it.code || '').trim();
        if (!title || !code) continue;
        items.push({
          sourceName: 'binance-cms',
          sourceTier: 1,
          kind: 'exchange',
          exchange: 'Binance',
          title,
          url: `https://www.binance.com/en/support/announcement/detail/${code}`,
          publishedAt: new Date(it.releaseDate),
          hintCategory: hint,
          hintTickers: [],
        });
      }
      if (articles.length === 0) {
        throw new Error('binance-cms: empty list (API shape change?)');
      }
      return items;
    },
  };
}

module.exports = { make };
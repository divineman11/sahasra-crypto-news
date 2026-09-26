'use strict';

const { request } = require('../http');

const RE_LISTING = /마켓 추가|신규 상장|원화 마켓/;
const RE_DELISTING = /거래지원 종료|상장 폐지|유의 종목/;
const RE_MAINT = /입출금|점검/;
const RE_TICKER = /\(([A-Z0-9]{2,15})\)/g;
const RE_DESIGNATION_LIFTED = /해제/;

function classify(title, categories) {
  if (RE_DESIGNATION_LIFTED.test(title)) return null;
  if (RE_DELISTING.test(title)) return 'delisting';
  if (RE_LISTING.test(title)) return 'listing';
  if ((categories || []).includes('입출금') || RE_MAINT.test(title)) return 'maintenance';
  return null;
}

function make() {
  const name = 'bithumb';
  return {
    name,
    tier: 1,
    intervalMs: 2000,
    async run() {
      const res = await request('https://api.bithumb.com/v1/notices?count=20', {});
      if (res.notModified || res.status === 304) return [];
      const body = res.json();
      if (!Array.isArray(body) || body.length === 0) {
        throw new Error(`${name}: empty list (API shape change?)`);
      }
      const items = [];
      for (const it of body) {
        const rawTitle = String(it.title || '').trim();
        const url = String(it.pc_url || '').trim();
        if (!rawTitle || !url) continue;
        const tickers = [];
        let m;
        RE_TICKER.lastIndex = 0;
        while ((m = RE_TICKER.exec(rawTitle)) !== null) tickers.push(m[1]);
        items.push({
          sourceName: 'bithumb',
          sourceTier: 1,
          kind: 'exchange',
          exchange: 'Bithumb',
          title: '[Bithumb] ' + rawTitle,
          url,
          publishedAt: new Date(String(it.published_at).replace(' ', 'T') + '+09:00'),
          hintCategory: classify(rawTitle, it.categories),
          hintTickers: tickers,
        });
      }
      return items;
    },
  };
}

module.exports = { make };
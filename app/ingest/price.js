'use strict';

const { request } = require('./http');
const { serializePost } = require('../lib/serialize');

let pausedUntil = 0;
const STOP_BATCH = Symbol('stop-batch');

function round3(x) {
  return Math.round(x * 1000) / 1000;
}

async function fetchKlines(sym, startTime) {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1m&startTime=${startTime}&limit=20`;
  const res = await request(url, { timeoutMs: 15000 });
  return res.json();
}

function startPriceWorker({ prisma, redis, futuresSymbols, intervalMs = 30000 }) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let running = false;

  const processPost = async (post) => {
    try {
      const T = post.priceTicker;
      if (!T) {
        await prisma.post.update({ where: { id: post.id }, data: { priceStatus: 'na' } });
        return;
      }
      const syms = new Set(futuresSymbols() || []);
      if (syms.size === 0) return;
      const sym = [T + 'USDT', '1000' + T + 'USDT', '1000000' + T + 'USDT'].find((s) => syms.has(s));
      if (!sym) {
        await prisma.post.update({ where: { id: post.id }, data: { priceStatus: 'na' } });
        return;
      }
      const firstSeen = post.firstSeenAt instanceof Date ? post.firstSeenAt : new Date(post.firstSeenAt);
      const m0 = Math.floor(firstSeen.getTime() / 60000) * 60000;
      await sleep(250);
      const rows = await fetchKlines(sym, m0 - 60000);
      const byOpen = new Map(rows.map((r) => [Number(r[0]), Number(r[4])]));
      const p0 = byOpen.get(m0 - 60000);
      const p1 = byOpen.get(m0);
      const p5 = byOpen.get(m0 + 4 * 60000);
      const p15 = byOpen.get(m0 + 14 * 60000);
      if (p0 == null || p1 == null || p5 == null || p15 == null) {
        await prisma.post.update({ where: { id: post.id }, data: { priceStatus: 'na' } });
        return;
      }
      const ret1m = round3((p1 / p0 - 1) * 100);
      const ret5m = round3((p5 / p0 - 1) * 100);
      const ret15m = round3((p15 / p0 - 1) * 100);
      const updated = await prisma.post.update({
        where: { id: post.id },
        data: {
          p0,
          ret1m,
          ret5m,
          ret15m,
          moved5m: Math.abs(ret5m) >= 1,
          priceStatus: 'done',
        },
        include: { instruments: true, votes: true },
      });
      const dto = serializePost(updated);
      await redis.publish('news:update', JSON.stringify(dto));
    } catch (e) {
      if (e && (e.status === 429 || e.status === 418)) {
        pausedUntil = Date.now() + Math.max(e.retryAfterMs || 0, e.status === 418 ? 10 * 60000 : 60000);
        console.error(`[price] rate limited (HTTP ${e.status}); pausing Binance requests until ${new Date(pausedUntil).toISOString()}`);
        throw STOP_BATCH;
      }
      console.error(`[price] post ${post.id} error:`, e.message || e);
    }
  };

  const run = async () => {
    if (running) return;
    running = true;
    try {
      if (Date.now() < pausedUntil) return;
      await prisma.post.updateMany({
        where: {
          priceStatus: 'pending',
          firstSeenAt: { lt: new Date(Date.now() - 24 * 3600000) },
        },
        data: { priceStatus: 'na' },
      });
      const posts = await prisma.post.findMany({
        where: {
          priceStatus: 'pending',
          firstSeenAt: { lte: new Date(Date.now() - 16 * 60000) },
        },
        take: 20,
        orderBy: { firstSeenAt: 'asc' },
      });
      for (const post of posts) {
        try {
          await processPost(post);
        } catch (e) {
          if (e === STOP_BATCH) break;
          throw e;
        }
      }
    } catch (e) {
      console.error('[price] worker error:', e.message || e);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(run, intervalMs);
  setTimeout(run, 3000);
  return () => clearInterval(timer);
}

module.exports = { startPriceWorker };
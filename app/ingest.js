'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { createRedis } = require('./ingest/redisOptional');
const { Scheduler } = require('./ingest/scheduler');
const { loadUniverse, addBases, setNonCoinBases, splitBinanceBases } = require('./ingest/tickers');
const http = require('./ingest/http');
const { StoryIndex } = require('./ingest/cluster');
const { Store } = require('./ingest/store');
const { Alerts, startAlertWorker } = require('./ingest/discord');
const { startRepublish } = require('./ingest/republish');
const { startNewsFile } = require('./ingest/newsFile');
const { startHealth } = require('./ingest/health');
const { startPriceWorker } = require('./ingest/price');
const { startWeeklyReport } = require('./ingest/report');
const bybit = require('./ingest/adapters/bybit');
const bitget = require('./ingest/adapters/bitget');
const kucoin = require('./ingest/adapters/kucoin');
const bithumb = require('./ingest/adapters/bithumb');
const binanceCms = require('./ingest/adapters/binanceCms');
const symbols = require('./ingest/adapters/symbols');
const bwenews = require('./ingest/adapters/bwenews');
const upbit = require('./ingest/adapters/upbit');
const rss = require('./ingest/adapters/rss');
const gnews = require('./ingest/adapters/gnews');
const telegram = require('./ingest/adapters/telegram');
const official = require('./ingest/adapters/official');
const youtube = require('./ingest/adapters/youtube');
const reddit = require('./ingest/adapters/reddit');
const bluesky = require('./ingest/adapters/bluesky');
const { loadWatchBases } = require('./ingest/watchlist');

const TIER_CACHE_FILE = path.join(__dirname, 'ingest', 'cache', 'gnews_tiers.json');

// gnews tiers B (top-100 Binance USDT-M perps by 24h quote volume) and C (every other coin base)
// are cached to disk so a restart has them before the first refresh completes.
function loadTierCache() {
  try {
    const parsed = JSON.parse(fs.readFileSync(TIER_CACHE_FILE, 'utf8'));
    return {
      B: Array.isArray(parsed.B) ? parsed.B : [],
      C: Array.isArray(parsed.C) ? parsed.C : [],
    };
  } catch (e) {
    return { B: [], C: [] };
  }
}
function saveTierCache(tierBList, tierCList) {
  try {
    fs.mkdirSync(path.dirname(TIER_CACHE_FILE), { recursive: true });
    fs.writeFileSync(TIER_CACHE_FILE + '.tmp', JSON.stringify({ B: tierBList, C: tierCList, updatedAt: Date.now() }));
    fs.renameSync(TIER_CACHE_FILE + '.tmp', TIER_CACHE_FILE);
  } catch (e) {
    console.error('[ingest] gnews tier cache save error:', e.message || e);
  }
}

async function main() {
  const prisma = new PrismaClient();
  const redis = createRedis();

  await loadUniverse();
  const universeTimer = setInterval(() => { loadUniverse({ force: true }).catch((e) => console.error('[ingest] universe refresh error:', e.message)); }, 24 * 3600 * 1000);

  const recent = await prisma.post.findMany({
    where: { firstSeenAt: { gte: new Date(Date.now() - 6 * 3600000) } },
    select: {
      id: true,
      storyId: true,
      simhash: true,
      title: true,
      category: true,
      exchange: true,
      firstSeenAt: true,
      instruments: true,
    },
  });
  const storyIndex = new StoryIndex();
  if (typeof storyIndex.load === 'function') {
    storyIndex.load(recent);
  } else {
    for (const p of recent) {
      storyIndex.assign({
        id: p.id,
        simhash: p.simhash,
        normTitle: p.title,
        category: p.category,
        tickers: p.instruments.map((i) => i.ticker),
        exchange: p.exchange,
        firstSeenAt: p.firstSeenAt,
      });
    }
  }

  const alerts = new Alerts({ prisma, redis });
  const store = new Store({ prisma, redis, storyIndex, alerts });
  await store.init();

  const scheduler = new Scheduler({
    redis,
    onItems: async (items, { warm }) => {
      await store.beginBatch();
      let failures = 0;
      let firstMsg = '';
      for (const raw of items) {
        try {
          await store.save(raw, { warm }); // Store sets alert eligibility itself (new posts and revisions)
        } catch (e) {
          failures += 1;
          if (!firstMsg) firstMsg = e && e.message ? e.message : String(e);
        }
      }
      if (failures > 0) {
        throw new Error(`${failures} of ${items.length} items failed to save: ${firstMsg}`);
      }
    },
  });

  const tierCache = loadTierCache();
  let tierBList = tierCache.B; // top-100 Binance USDT-M coin perps by 24h quote volume, minus tier A (excluded in gnews.js)
  let tierCList = tierCache.C; // every other coin base known to the universe, minus tiers A and B (excluded in gnews.js)

  const adapters = [
    bybit.make(),
    bitget.make(),
    kucoin.make(),
    bithumb.make(),
    binanceCms.make(),
    bwenews.make(),
    upbit.make(),
    ...symbols.make({ prisma }),
    ...rss.make(),
    gnews.make({ getTierA: () => loadWatchBases(), getTierB: () => tierBList, getTierC: () => tierCList }),
    ...(process.env.TG_WIRES_ENABLED !== '0' ? telegram.make() : []),
    ...(process.env.OFFICIAL_ENABLED !== '0' ? official.make() : []),
    ...(process.env.YOUTUBE_ENABLED !== '0' ? youtube.make() : []),
    // reddit.make() itself is a no-op (and logs one disabled-startup line) when
    // REDDIT_CLIENT_ID/SECRET/USERNAME/PASSWORD aren't all set — REDDIT_ENABLED only gates
    // whether we even try.
    ...(process.env.REDDIT_ENABLED !== '0' ? reddit.make() : []),
    ...bluesky.make(),
  ];

  let futuresFirstRun = true;
  const refreshBases = async () => {
    try {
      const res = await http.request('https://fapi.binance.com/fapi/v1/exchangeInfo', { timeoutMs: 15000 });
      const { coinBases, nonCoinBases } = splitBinanceBases(res.json());
      if (coinBases.length < 100) throw new Error('exchangeInfo looks incomplete (' + coinBases.length + ' coin bases)');
      if (coinBases.length) addBases(coinBases);
      setNonCoinBases(nonCoinBases);
      tierCList = coinBases;
      saveTierCache(tierBList, tierCList);
      if (futuresFirstRun) {
        futuresFirstRun = false;
        console.log(`[ingest] bases: ${coinBases.length} coin, ${nonCoinBases.length} non-coin (stocks/commodities/indexes)`);
      }
    } catch (e) {
      console.error('[ingest] exchangeInfo bases error:', e.message || e);
      // fallback: previous behaviour so the universe still gets futures bases
      try {
        const bases = symbols.binanceFuturesBases();
        if (bases && bases.length) addBases(bases);
        if (futuresFirstRun) futuresFirstRun = false;
      } catch (e2) {
        console.error('[ingest] addBases error:', e2.message || e2);
      }
    }
  };
  const basesTimer = setInterval(() => {
    if (!futuresFirstRun) refreshBases();
  }, 10 * 60000);

  const refreshTierB = async () => {
    try {
      const res = await http.request('https://fapi.binance.com/fapi/v1/ticker/24hr', { timeoutMs: 15000 });
      const list = gnews.deriveTierB(res.json(), { n: 100 });
      if (!list.length) throw new Error('empty tier-B list');
      tierBList = list;
      saveTierCache(tierBList, tierCList);
    } catch (e) {
      console.error('[ingest] gnews tier-B refresh error (keeping previous list):', e.message || e);
    }
  };
  const tierBTimer = setInterval(refreshTierB, 60 * 60000);
  setTimeout(() => { refreshTierB(); }, 20000);
  const futuresHook = setInterval(() => {
    if (!futuresFirstRun && symbols.binanceFuturesBases().length) {
      clearInterval(futuresHook);
    }
  }, 2000);
  setTimeout(() => { refreshBases(); }, 12000);

  for (const a of adapters) scheduler.add(a);

  scheduler.start();
  const stopNewsFile = startNewsFile({ prisma, scheduler });
  const stopHealth = startHealth({ scheduler, alerts });
  const stopPrice = startPriceWorker({ prisma, redis, futuresSymbols: symbols.binanceFuturesSymbols });
  const stopWeekly = startWeeklyReport({ prisma, redis, alerts });
  const stopAlertWorker = startAlertWorker({ prisma, redis, alerts });
  const stopRepublish = startRepublish({ prisma, redis });

  console.log(`[ingest] started ${adapters.length} adapters`);

  const shutdown = async () => {
    try {
      scheduler.stop();
      clearInterval(basesTimer);
      clearInterval(tierBTimer);
      clearInterval(futuresHook);
      clearInterval(universeTimer);
      if (typeof stopNewsFile === 'function') stopNewsFile();
      if (typeof stopHealth === 'function') stopHealth();
      if (typeof stopPrice === 'function') stopPrice();
      if (typeof stopWeekly === 'function') stopWeekly();
      if (typeof stopAlertWorker === 'function') stopAlertWorker();
      if (typeof stopRepublish === 'function') stopRepublish();
      await prisma.$disconnect();
      redis.quit();
    } catch (_) {
      /* ignore */
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

process.on('unhandledRejection', (err) => {
  console.error('[ingest] unhandled rejection:', err && err.stack ? err.stack : err);
});

main().catch((e) => {
  console.error('[ingest] fatal:', e && e.stack ? e.stack : e);
  process.exit(1);
});
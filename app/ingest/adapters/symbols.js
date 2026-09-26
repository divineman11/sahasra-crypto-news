'use strict';

const http = require('../http');
const { request } = http;

const QUOTE_RE = /(USDT|USDC|FDUSD|TUSD|BUSD|BTC|ETH|BNB|TRY|EUR|BRL|JPY|USD1)$/;

const MIN_SYMBOLS = {
  'binance-spot': 100,
  'binance-futures': 100,
  hyperliquid: 50,
  'okx-spot': 500,
  'okx-swap': 200,
  coinbase: 300,
};

function baseOf(symbol) {
  const m = symbol.match(QUOTE_RE);
  if (!m) return null;
  let base = symbol.slice(0, m.index);
  base = base.replace(/^(1000000|1000)/, '');
  return base;
}

function hyperliquidBase(name) {
  if (/^k[A-Z0-9]{2,}$/.test(name)) return name.slice(1);
  return name;
}

function baseFromSymbol(venue, symbol) {
  if (!symbol) return null;
  if (venue === 'okx-spot' || venue === 'okx-swap' || venue === 'coinbase') { const b = String(symbol).split('-')[0]; return b ? b.toUpperCase() : null; }
  if (venue === 'hyperliquid') return hyperliquidBase(symbol);
  return baseOf(symbol);
}

function normalizeEntry(venue, x) {
  if (venue === 'okx-spot') {
    return {
      symbol: String(x.instId),
      base: String(x.baseCcy || ''),
      meta: { state: x.state, listTime: x.listTime },
    };
  }
  if (venue === 'okx-swap') {
    const uly = String(x.uly || x.instId || '');
    return {
      symbol: String(x.instId),
      base: uly.split('-')[0] || '',
      meta: { state: x.state, listTime: x.listTime },
    };
  }
  if (venue === 'coinbase') {
    return {
      symbol: String(x.id),
      base: String(x.base_currency || ''),
      meta: null,
    };
  }
  return { symbol: String(x), base: null, meta: null };
}

function labelFor(venue) {
  if (venue === 'binance-spot') return 'Binance spot';
  if (venue === 'binance-futures') return 'Binance futures';
  if (venue === 'okx-spot') return 'OKX spot';
  if (venue === 'okx-swap') return 'OKX perpetual';
  if (venue === 'coinbase') return 'Coinbase';
  return 'Hyperliquid perp';
}

function urlFor(venue, symbol) {
  if (venue === 'binance-spot') return `https://www.binance.com/en/trade/${symbol}?type=spot`;
  if (venue === 'binance-futures') return `https://www.binance.com/en/futures/${symbol}`;
  if (venue === 'okx-spot') return `https://www.okx.com/trade-spot/${symbol.toLowerCase()}`;
  if (venue === 'okx-swap') return `https://www.okx.com/trade-swap/${symbol.toLowerCase()}`;
  if (venue === 'coinbase') return `https://www.coinbase.com/advanced-trade/spot/${symbol}`;
  return `https://app.hyperliquid.xyz/trade/${symbol}`;
}

function exchangeFor(venue) {
  if (venue === 'hyperliquid') return 'Hyperliquid';
  if (venue === 'okx-spot' || venue === 'okx-swap') return 'OKX';
  if (venue === 'coinbase') return 'Coinbase';
  return 'Binance';
}

function titleFor(venue, symbol, meta) {
  if (venue === 'okx-spot') {
    if (meta && meta.state === 'preopen') {
      const when = meta.listTime ? new Date(Number(meta.listTime)).toISOString() : 'soon';
      return `OKX pre-listing: ${symbol} opens ${when}`;
    }
    return `New OKX spot market live: ${symbol}`;
  }
  if (venue === 'okx-swap') {
    if (meta && meta.state === 'preopen') {
      const when = meta.listTime ? new Date(Number(meta.listTime)).toISOString() : 'soon';
      return `OKX pre-listing: ${symbol} opens ${when}`;
    }
    return `New OKX perpetual live: ${symbol}`;
  }
  if (venue === 'coinbase') return `New Coinbase market live: ${symbol}`;
  const label = labelFor(venue);
  return `New ${label} market live: ${symbol}`;
}

const futuresSymbols = new Set();
const futuresSet = new Set();

function binanceFuturesSymbols() {
  return [...futuresSymbols];
}

function binanceFuturesBases() {
  return [...futuresSet];
}

function symbolAdapter({ prisma, name, venue, fetchSymbols }) {
  const known = new Set();
  const knownBases = new Set();
  const prevBaseCounts = new Map();
  const missingRuns = new Map();
  const delistedEmitted = new Set();
  const floodSuppressed = new Set();
  let loaded = false;
  let seeded = false;

  function delistingItem(base, day) {
    return {
      sourceName: name,
      sourceTier: 1,
      kind: 'symbol',
      exchange: exchangeFor(venue),
      title: `Coinbase delisted ${base.toUpperCase()} (no online markets)`,
      url: `https://www.coinbase.com/advanced-trade/spot/${base.toUpperCase()}-USD#delisted-${day}`,
      publishedAt: new Date(),
      hintCategory: 'delisting',
      hintTickers: [base],
      symbolRef: { venue, symbol: 'DELIST:' + base.toUpperCase() },
    };
  }

  return {
    name,
    tier: 1,
    intervalMs: 10000,
    async run() {
      if (!loaded) {
        const rows = await prisma.knownSymbol.findMany({ where: { venue } });
        for (const r of rows) {
          if (String(r.symbol).startsWith('DELIST:')) continue;
          known.add(r.symbol);
          const b = baseFromSymbol(venue, r.symbol);
          if (b) knownBases.add(b);
        }
        loaded = true;
        if (rows.length === 0) seeded = true;
      }

      const fetched = await fetchSymbols();
      const symbols = [];
      const metaBySymbol = new Map();
      const baseBySymbol = new Map();
      for (const x of Array.isArray(fetched) ? fetched : []) {
        const e = normalizeEntry(venue, x);
        if (!e.symbol) continue;
        symbols.push(e.symbol);
        if (e.base) baseBySymbol.set(e.symbol, e.base);
        metaBySymbol.set(e.symbol, e.meta);
      }

      if (!Array.isArray(fetched) || symbols.length < (MIN_SYMBOLS[venue] || 1)) {
        throw new Error(`suspicious ${venue} symbol list size: ${symbols && symbols.length}`);
      }

      if (venue === 'binance-futures') {
        futuresSymbols.clear();
        futuresSet.clear();
        for (const symbol of symbols) {
          futuresSymbols.add(symbol);
          const b = baseOf(symbol);
          if (b) futuresSet.add(b);
        }
      }

      // Coinbase delisting detection: track online product counts per base.
      let delistingItems = [];
      if (venue === 'coinbase') {
        const counts = new Map();
        for (const s of symbols) {
          const b = baseBySymbol.get(s);
          if (b) counts.set(b, (counts.get(b) || 0) + 1);
        }
        if (prevBaseCounts.size === 0) {
          // First run: just record the baseline, emit nothing.
        } else {
          for (const [base, count] of counts) {
            if (count >= 1) {
              missingRuns.delete(base);
              delistedEmitted.delete(base);
            }
          }
          for (const [base] of prevBaseCounts) {
            if (!(counts.get(base) >= 1) && !delistedEmitted.has(base)) {
              missingRuns.set(base, (missingRuns.get(base) || 0) + 1);
            }
          }
          const gone = [];
          for (const [base, n] of missingRuns) {
            if (n >= 3) gone.push(base);
          }
          const firstMissing = [];
          for (const [base, n] of missingRuns) {
            if (n === 1) firstMissing.push(base);
          }
          if (firstMissing.length > 10) {
            console.error(`[symbols] ${venue}: ${firstMissing.length} bases lost all online markets — treating as feed glitch, not emitting`);
            for (const base of firstMissing) { missingRuns.delete(base); prevBaseCounts.delete(base); }
          } else if (gone.length > 10) {
            console.error(`[symbols] ${venue}: ${gone.length} bases lost all online markets — treating as feed glitch, not emitting`);
            for (const base of gone) missingRuns.delete(base);
          } else {
            const day = new Date().toISOString().slice(0, 10);
            for (const base of gone) {
              const delistSym = 'DELIST:' + base.toUpperCase();
              try {
                await prisma.knownSymbol.create({ data: { venue, symbol: delistSym, pendingEmit: true } });
              } catch (err) {
                if (err && err.code === 'P2002') {
                  try {
                    await prisma.knownSymbol.update({ where: { venue_symbol: { venue, symbol: delistSym } }, data: { pendingEmit: true, firstSeenAt: new Date() } });
                  } catch (err2) {
                    console.error(`[symbols] ${venue}: failed to re-flag delisting ${base}: ${err2.message}`);
                    continue;
                  }
                } else {
                  console.error(`[symbols] ${venue}: failed to record delisting ${base}: ${err.message}`);
                  continue;
                }
              }
              delistingItems.push(delistingItem(base, day));
              delistedEmitted.add(base);
              missingRuns.delete(base);
            }
          }
        }
        for (const [b, c] of counts) prevBaseCounts.set(b, c);
      }

      if (seeded) {
        if (symbols.length) {
          try {
            await prisma.knownSymbol.createMany({
              data: symbols.map((s) => ({ venue, symbol: s, firstSeenAt: new Date(0) })),
              skipDuplicates: true,
            });
          } catch (err) {
            throw err;
          }
        }
        seeded = false;
        for (const s of symbols) {
          known.add(s);
          const b = baseBySymbol.get(s) || baseFromSymbol(venue, s);
          if (b) knownBases.add(b);
        }
        return delistingItems;
      }

      const items = [];
      // Pass 1: decide everything from memory before any write.
      const fresh = [];
      const batchBases = new Set();
      for (const symbol of symbols) {
        if (known.has(symbol)) continue;
        const base = baseBySymbol.get(symbol) || baseFromSymbol(venue, symbol);
        const isNewBase = !!base && !knownBases.has(base) && !batchBases.has(base) && !floodSuppressed.has(symbol);
        if (isNewBase) batchBases.add(base);
        fresh.push({ symbol, base, isNewBase });
      }
      const newCount = fresh.filter((f) => f.isNewBase).length;
      const flood = newCount > 10;
      if (flood) {
        console.error(`[symbols] ${venue}: ${newCount} new bases in one cycle — recorded silently, not emitted`);
        for (const f of fresh) floodSuppressed.add(f.symbol);
      }
      // Pass 2: one atomic row write per symbol, carrying its pending disposition.
      const newBases = [];
      for (const f of fresh) {
        const emit = f.isNewBase && !flood;
        try {
          await prisma.knownSymbol.create({ data: { venue, symbol: f.symbol, pendingEmit: emit } });
        } catch (err) {
          console.error(`[symbols] ${venue}: failed to save known symbol ${f.symbol}: ${err.message}`);
          continue;
        }
        known.add(f.symbol);
        if (f.base) knownBases.add(f.base);
        if (emit) newBases.push({ base: f.base, symbol: f.symbol });
      }
      for (const { base, symbol } of newBases) {
        items.push({
          sourceName: name,
          sourceTier: 1,
          kind: 'symbol',
          exchange: exchangeFor(venue),
          title: titleFor(venue, symbol, metaBySymbol.get(symbol)),
          url: urlFor(venue, symbol),
          publishedAt: new Date(),
          hintCategory: 'listing',
          hintTickers: [base],
          symbolRef: { venue, symbol },
        });
      }

      try {
        const pending = await prisma.knownSymbol.findMany({
          where: {
            venue,
            pendingEmit: true,
            firstSeenAt: { gte: new Date(Date.now() - 24 * 3600e3) },
          },
        });
        for (const row of pending) {
          if (items.some((it) => it.symbolRef && it.symbolRef.symbol === row.symbol)) continue;
          if (delistingItems.some((it) => it.symbolRef && it.symbolRef.symbol === row.symbol)) continue;
          if (String(row.symbol).startsWith('DELIST:')) {
            const d = row.firstSeenAt ? new Date(row.firstSeenAt) : new Date();
            items.push(delistingItem(row.symbol.slice(7), d.toISOString().slice(0, 10)));
            continue;
          }
          const base = (row.symbol && baseBySymbol.get(row.symbol)) || baseFromSymbol(venue, row.symbol);
          items.push({
            sourceName: name,
            sourceTier: 1,
            kind: 'symbol',
            exchange: exchangeFor(venue),
            title: titleFor(venue, row.symbol, metaBySymbol.get(row.symbol)),
            url: urlFor(venue, row.symbol),
            publishedAt: new Date(),
            hintCategory: 'listing',
            hintTickers: base ? [base] : [],
            symbolRef: { venue, symbol: row.symbol },
          });
        }
      } catch (err) {
        console.error(`[symbols] ${venue}: failed to load pending symbols: ${err.message}`);
      }

      return items.concat(delistingItems);
    },
  };
}

async function fetchBinanceSpot() {
  const res = await http.request('https://api.binance.com/api/v3/ticker/price', {});
  const body = res.json();
  return (Array.isArray(body) ? body : [])
    .map((x) => String(x.symbol))
    .filter(Boolean);
}

async function fetchBinanceFutures() {
  const res = await http.request('https://fapi.binance.com/fapi/v1/ticker/price', {});
  const body = res.json();
  return (Array.isArray(body) ? body : [])
    .map((x) => String(x.symbol))
    .filter((s) => s && !s.includes('_'));
}

async function fetchHyperliquid() {
  const res = await http.request('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'meta' }),
  });
  const body = res.json();
  const universe = (body && body.universe) || [];
  return universe.filter((u) => u && !u.isDelisted).map((u) => String(u.name));
}

async function fetchOkxSpot() {
  const res = await http.request('https://app.okx.com/api/v5/public/instruments?instType=SPOT', {});
  const body = res.json();
  const data = (body && body.data) || [];
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('okx-spot: empty instrument list');
  }
  return data.filter((x) => x && ['USDT', 'USDC', 'USD'].includes(x.quoteCcy));
}

async function fetchOkxSwap() {
  const res = await http.request('https://app.okx.com/api/v5/public/instruments?instType=SWAP', {});
  const body = res.json();
  const data = (body && body.data) || [];
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('okx-swap: empty instrument list');
  }
  return data;
}

async function fetchCoinbase() {
  const res = await http.request('https://api.exchange.coinbase.com/products', {});
  const body = res.json();
  return (Array.isArray(body) ? body : [])
    .filter((p) => p && p.status === 'online' && ['USD', 'USDC', 'USDT'].includes(p.quote_currency));
}

function make({ prisma }) {
  return [
    symbolAdapter({
      prisma,
      name: 'sym-binance-spot',
      venue: 'binance-spot',
      fetchSymbols: fetchBinanceSpot,
    }),
    symbolAdapter({
      prisma,
      name: 'sym-binance-futures',
      venue: 'binance-futures',
      fetchSymbols: fetchBinanceFutures,
    }),
    symbolAdapter({
      prisma,
      name: 'sym-hyperliquid',
      venue: 'hyperliquid',
      fetchSymbols: fetchHyperliquid,
    }),
    symbolAdapter({
      prisma,
      name: 'sym-okx-spot',
      venue: 'okx-spot',
      fetchSymbols: fetchOkxSpot,
    }),
    symbolAdapter({
      prisma,
      name: 'sym-okx-swap',
      venue: 'okx-swap',
      fetchSymbols: fetchOkxSwap,
    }),
    symbolAdapter({
      prisma,
      name: 'sym-coinbase',
      venue: 'coinbase',
      fetchSymbols: fetchCoinbase,
    }),
  ];
}

module.exports = { make, binanceFuturesBases, binanceFuturesSymbols };
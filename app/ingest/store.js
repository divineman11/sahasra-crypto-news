'use strict';

const crypto = require('crypto');
const { tagTickers, nameOf } = require('./tickers');
const { classify } = require('./classify');
const { normalize, simhash64, detectExchange } = require('./cluster');
const { detailTickers, makeBudget } = require('./details');
const { serializePost } = require('../lib/serialize');
const { hotUpsert } = require('./hotListUpsert');
const { KEEP_DAYS } = require('./config');

class Store {
  constructor({ prisma, redis, storyIndex, alerts = null }) {
    this.prisma = prisma;
    this.redis = redis;
    this.storyIndex = storyIndex;
    this.alerts = alerts;
    this.urls = new Map();
    this.revisedAt = new Map();
    this.detailBudget = null;
    this.titleKeys = new Set();
  }

  beginBatch() {
    this.detailBudget = makeBudget(5);
  }

  async init() {
    const posts = await this.prisma.post.findMany({
      take: 5000,
      orderBy: { firstSeenAt: 'desc' },
      select: { id: true, url: true, title: true },
    });
    for (const p of posts) this.urls.set(p.url, { id: p.id, title: p.title });
    const recent = await this.prisma.post.findMany({
      where: { firstSeenAt: { gte: new Date(Date.now() - KEEP_DAYS * 86400000) } },
      select: { title: true, sourceDomain: true },
    });
    for (const r of recent) this.titleKeys.add(normalize(r.title) + '|' + r.sourceDomain);
  }

  async save(raw, opts = {}) {
    try {
      if (!(raw.publishedAt instanceof Date) || isNaN(raw.publishedAt.getTime()) ||
          !raw.url || !/^https?:\/\//i.test(raw.url)) {
        console.error('[store] skip invalid item', raw.sourceName, raw.url);
        return null;
      }
      if (raw.publishedAt.getTime() > Date.now() + 10 * 60e3) {
        console.error('[store] future publishedAt quarantined', raw.sourceName, raw.url);
        return null;
      }
      const now = new Date();
      const cutoff = now.getTime() - KEEP_DAYS * 86400000;
      if (raw.publishedAt.getTime() < cutoff) return null;

      const known = this.urls.get(raw.url);
      if (known) {
        if (raw.kind === 'symbol' && raw.symbolRef) {
          try {
            await this.prisma.knownSymbol.update({
              where: { venue_symbol: { venue: raw.symbolRef.venue, symbol: raw.symbolRef.symbol } },
              data: { pendingEmit: false, emittedAt: new Date() },
            });
          } catch (e) {}
        }
        if (known.detailPending && (known.detailAttempts || 0) < 3 && (!this.detailBudget || this.detailBudget.take())) {
          known.detailAttempts = (known.detailAttempts || 0) + 1;
          try {
            const extra = await detailTickers(raw);
            if (extra && extra.length > 0) {
              const cls2 = classify(raw, extra);
              const cur2 = await this.prisma.post.findUnique({ where: { id: known.id }, select: { priceStatus: true, alertState: true } });
              await this.prisma.post.update({
                where: { id: known.id },
                data: {
                  importance: cls2.importance,
                  sentiment: cls2.sentiment,
                  ...(cur2 && cur2.priceStatus === 'pending' ? { priceTicker: extra[0] } : {}),
                  ...(raw.alertable !== false && this.alerts && cur2 && cur2.alertState == null && this.alerts.isEligible({ tickers: extra, importance: cls2.importance, publishedAt: raw.publishedAt }, !!opts.warm) ? { alertState: 'pending' } : {}),
                  instruments: { connectOrCreate: extra.map((t) => ({ where: { ticker: t }, create: { ticker: t, name: nameOf(t) } })) },
                },
              });
              known.detailPending = false;
              known.detail = extra.slice();
              console.log(`[store] detail retry tagged ${raw.url}: ${extra.join(',')}`);
            }
          } catch (e) {
            console.error('[store] detail retry error:', e.message || e);
          }
        }
        if (normalize(known.title) === normalize(raw.title)) return null;
        const lastRevised = this.revisedAt.get(raw.url);
        if (lastRevised && Date.now() - lastRevised < 10 * 60e3) return null;
        // Title changed at the same URL → a correction/revision.
        const tickers = raw.kind === 'politics' ? [] : tagTickers(raw.title, raw.hintTickers || [], { kind: raw.kind });
        const keepDetail = tickers.length === 0 && (known.detail === undefined || (Array.isArray(known.detail) && known.detail.length > 0));
        const effTickers = keepDetail && Array.isArray(known.detail) ? known.detail : tickers;
        const cls = classify(raw, effTickers);
        try {
          const cur = await this.prisma.post.findUnique({
            where: { id: known.id },
            select: { priceStatus: true, alertState: true },
          });
          const updated = await this.prisma.post.update({
            where: { id: known.id },
            data: {
              title: raw.title,
              category: cls.category,
              importance: cls.importance,
              sentiment: cls.sentiment,
              ...(cur && cur.priceStatus === 'pending' ? { priceTicker: effTickers[0] || null } : {}),
              ...(raw.alertable !== false && this.alerts && cur && cur.alertState == null && this.alerts.isEligible({ tickers: effTickers, importance: cls.importance, publishedAt: raw.publishedAt }, !!opts.warm) ? { alertState: 'pending' } : {}),
              ...(keepDetail ? {} : { instruments: { set: [], connectOrCreate: tickers.map((t) => ({ where: { ticker: t }, create: { ticker: t, name: nameOf(t) } })) } }),
            },
            include: { instruments: true, votes: true },
          });
          this.urls.set(raw.url, Object.assign({}, known, { id: known.id, title: raw.title }));
          this.revisedAt.set(raw.url, Date.now());
          console.log(`[store] revised ${raw.url}`);
          const dto = serializePost(updated);
          const json = JSON.stringify(dto);
          try {
            await this.redis.publish('news:update', json);
          } catch (e) {
            console.error('[store] revise publish error:', e.message || e);
          }
          return Object.assign(dto, { revised: true });
        } catch (e) {
          console.error('[store] revise error:', e.message || e);
        }
        return null;
      }

      if (String(raw.sourceName || '').startsWith('gnews:')) {
        const dom = raw.sourceDomain || new URL(raw.url).hostname.replace(/^www\./, '');
        if (this.titleKeys.has(normalize(raw.title) + '|' + dom)) return null; // a direct copy already exists
      }
      // Trump-section items (kind "politics") are never tagged with coins, see adapters/trump.js.
      let tickers = raw.kind === 'politics' ? [] : tagTickers(raw.title, raw.hintTickers || [], { kind: raw.kind });
      let cls = classify(raw, tickers);
      const needsDetail = raw.kind === 'exchange' && tickers.length === 0 &&
        (cls.category === 'listing' || cls.category === 'delisting' || cls.category === 'maintenance');
      let detailOk = false;
      if (raw.kind === 'exchange' && tickers.length === 0 &&
          (cls.category === 'listing' || cls.category === 'delisting' || cls.category === 'maintenance') &&
          (!this.detailBudget || this.detailBudget.take())) {
        try {
          const extra = await detailTickers(raw);
          if (extra && extra.length > 0) {
            tickers = extra;
            cls = classify(raw, tickers);
            detailOk = true;
          }
        } catch (e) {
          console.error('[store] detailTickers error:', e.message || e);
        }
      }
      const norm = normalize(raw.title);
      const sh = simhash64(raw.title);
      const id = crypto.randomUUID();
      const storyId = this.storyIndex.assign({
        id,
        simhash: sh,
        normTitle: norm,
        category: cls.category,
        tickers,
        exchange: raw.exchange || detectExchange(raw.title),
        firstSeenAt: now,
      });

      const eligible = raw.alertable === false ? false : (this.alerts ? this.alerts.isEligible({ tickers, importance: cls.importance, publishedAt: raw.publishedAt }, !!opts.warm) : false);

      const data = {
        id,
        title: raw.title,
        url: raw.url,
        sourceDomain: raw.sourceDomain || new URL(raw.url).hostname.replace(/^www\./, ''),
        publishedAt: raw.publishedAt,
        kind: raw.kind,
        sentiment: cls.sentiment,
        sourceName: raw.sourceName,
        sourceTier: raw.sourceTier,
        category: cls.category,
        importance: cls.importance,
        exchange: raw.exchange || null,
        storyId,
        simhash: sh,
        firstSeenAt: now,
        announcementSeenAt: raw.kind === 'exchange' ? now : null,
        priceTicker: tickers[0] || null,
        priceStatus: tickers.length > 0 && (now.getTime() - raw.publishedAt.getTime()) <= 30 * 60000 ? 'pending' : 'na',
        alertState: eligible ? 'pending' : null,
        instruments: {
          connectOrCreate: tickers.map((t) => ({
            where: { ticker: t },
            create: { ticker: t, name: nameOf(t) },
          })),
        },
      };

      let post;
      try {
        post = await this.prisma.post.create({
          data,
          include: { instruments: true, votes: true },
        });
      } catch (e) {
        if (e && e.code === 'P2002') {
          const target = e.meta && e.meta.target;
          const targets = Array.isArray(target) ? target : (target ? [target] : []);
          if (targets.includes('url')) {
            if (raw.kind === 'symbol' && raw.symbolRef && raw.symbolRef.venue && raw.symbolRef.symbol) {
              try {
                await this.prisma.knownSymbol.update({
                  where: { venue_symbol: { venue: raw.symbolRef.venue, symbol: raw.symbolRef.symbol } },
                  data: { pendingEmit: false, emittedAt: new Date() },
                });
              } catch (e2) { /* ignore */ }
            }
            this.storyIndex.remove(id);
            // this.urls missed it (init() only loads the most recent 5000 by
            // firstSeenAt — an older row a feed re-lists falls outside that window) but the DB's
            // unique constraint on url just confirmed it already exists. Cache it now (one cheap
            // lookup for the id) so a later re-poll of the same url short-circuits at the `known`
            // check above instead of re-attempting a create() — and, for an exchange item, a
            // detailTickers fetch — on every single poll.
            try {
              const existing = await this.prisma.post.findUnique({ where: { url: raw.url }, select: { id: true } });
              if (existing) this.urls.set(raw.url, { id: existing.id, title: raw.title });
            } catch (e3) { /* best-effort cache only — a miss here just means the same fallback repeats next poll */ }
            return null;
          }
          try {
            post = await this.prisma.post.create({
              data,
              include: { instruments: true, votes: true },
            });
          } catch (e2) {
            this.storyIndex.remove(id);
            throw e2;
          }
        } else {
          this.storyIndex.remove(id);
          throw e;
        }
      }
      this.urls.set(raw.url, { id: post.id, title: post.title, detailPending: needsDetail && !detailOk, detail: detailOk ? tickers.slice() : null });
      this.titleKeys.add(normalize(post.title) + '|' + post.sourceDomain);

      if (raw.kind === 'exchange' && cls.category === 'listing') {
        const venues =
          raw.exchange === 'Binance' ? ['binance-spot', 'binance-futures'] :
          raw.exchange === 'Hyperliquid' ? ['hyperliquid'] : null;
        if (venues) {
          let earliest = null;
          for (const t of tickers) {
            const cands = await this.prisma.knownSymbol.findMany({
              where: {
                symbol: { in: [t + 'USDT', t + 'USDC', t + 'FDUSD', '1000' + t + 'USDT', '1000000' + t + 'USDT', t] },
                venue: { in: venues },
                firstSeenAt: { gt: new Date(86400000) },
              },
              select: { firstSeenAt: true },
            });
            for (const c of cands) {
              if (now.getTime() - c.firstSeenAt.getTime() <= 7 * 86400000) {
                if (!earliest || c.firstSeenAt < earliest) earliest = c.firstSeenAt;
              }
            }
          }
          if (earliest) {
            await this.prisma.post.update({ where: { id: post.id }, data: { symbolSeenAt: earliest } });
          }
        }
      } else if (raw.kind === 'symbol' && tickers[0]) {
        await this.setSymbolSeen(tickers[0], now, raw.exchange);
      }

      if (raw.kind === 'symbol' && raw.symbolRef && raw.symbolRef.venue && raw.symbolRef.symbol) {
        try {
          await this.prisma.knownSymbol.update({
            where: { venue_symbol: { venue: raw.symbolRef.venue, symbol: raw.symbolRef.symbol } },
            data: { pendingEmit: false, emittedAt: new Date() },
          });
        } catch (e) {
          console.error('[store] symbol ack error:', e.message || e);
        }
      }

      const dto = serializePost(post);
      const json = JSON.stringify(dto);
      let published = false;
      try {
        await hotUpsert(this.redis, post.id, json);
        published = true;
      } catch (e) {
        console.error('[store] redis publish failed:', e.message || e);
        published = false;
      }
      if (published) {
        try {
          await this.prisma.post.update({ where: { id: post.id }, data: { hotPublishedAt: new Date() } });
        } catch (e) {
          console.error('[store] hotPublishedAt update error:', e.message || e);
        }
      }

      const ts = now.toISOString().slice(11, 19);
      const t90 = raw.title.length > 90 ? raw.title.slice(0, 90) : raw.title;
      console.log(`[ingest] ${ts} ${raw.sourceName} [${cls.category} ${cls.importance}] <${tickers.join(',')}> ${t90}`);
      return dto;
    } catch (e) {
      console.error('[store] save error:', e.message || e);
      throw e;
    }
  }

  async setSymbolSeen(base, at, exchange) {
    if (!base) return;
    const since = new Date(at.getTime() - 7 * 86400000);
    await this.prisma.post.updateMany({
      where: {
        category: 'listing',
        kind: 'exchange',
        exchange,
        symbolSeenAt: null,
        firstSeenAt: { gte: since },
        instruments: { some: { ticker: base } },
      },
      data: { symbolSeenAt: at },
    });
  }
}

module.exports = { Store };
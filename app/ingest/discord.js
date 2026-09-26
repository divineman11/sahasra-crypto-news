'use strict';

const { DISCORD_WEBHOOK, PORTFOLIO } = require('./config');
const { request } = require('./http');
const { loadWatchBases } = require('./watchlist');

class Alerts {
  constructor({ prisma, redis }) {
    this.prisma = prisma;
    this.redis = redis;
    this.enabled = !!DISCORD_WEBHOOK;
    this.portfolio = new Set(PORTFOLIO || []);
    this.lastRead = 0;
  }

  refreshPortfolio() {
    const now = Date.now();
    if (now - this.lastRead < 5 * 60000) return;
    this.lastRead = now;
    try {
      this.portfolio = new Set(loadWatchBases());
    } catch (_) {
      /* keep the previous portfolio on read errors */
    }
  }

  async post(content) {
    if (!this.enabled) return;
    await request(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content }),
      timeoutMs: 10000,
    });
  }

  isEligible({ tickers, importance, publishedAt }, warm) {
    if (!this.enabled) return false;
    this.refreshPortfolio();
    if (!warm) return false;
    if (!importance || importance < 70) return false;
    if (!publishedAt || Date.now() - new Date(publishedAt).getTime() > 48 * 3600000) return false;
    return (tickers || []).some((t) => this.portfolio.has(t));
  }

  async enqueue(dto, { warm }) {
    if (!this.enabled) return;
    this.refreshPortfolio();
    const tickers = (dto.instruments || []).map((i) => i.ticker || i);
    const eligible = this.isEligible({ tickers, importance: dto.importance, publishedAt: dto.publishedAt }, !!warm);
    if (!eligible) return;
    await this.prisma.post.updateMany({ where: { id: dto.id, alertState: null }, data: { alertState: 'pending' } });
  }

  async healthAlert(name, text) {
    try {
      if (!this.enabled) return;
      if (await this.redis.exists('alert:health:' + name)) return;
      await request(DISCORD_WEBHOOK, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: `⚠️ news source silent: ${name} — ${text}`.slice(0, 1900) }),
        timeoutMs: 10000,
      });
      await this.redis.set('alert:health:' + name, '1', 'EX', 1800);
    } catch (e) {
      /* ignore */
    }
  }
}

function startAlertWorker({ prisma, redis, alerts, intervalMs = 15000 }) {
  let timer = null;
  let running = false;
  let stopped = false;
  let pausedUntil = 0;
  let firstTick = true;

  async function tick() {
    if (running || stopped) return;
    if (Date.now() < pausedUntil) return;
    running = true;
    try {
      if (firstTick) {
        firstTick = false;
        // Uncertain deliveries: crashed between POST and DB update → never resend automatically.
        await prisma.post.updateMany({
          where: { alertState: 'sending' },
          data: { alertState: 'uncertain' },
        });
      }
      const now = new Date();
      const posts = await prisma.post.findMany({
        where: {
          alertState: 'pending',
          OR: [{ alertNextAt: null }, { alertNextAt: { lte: now } }],
        },
        orderBy: { firstSeenAt: 'asc' },
        take: 10,
        include: { instruments: true },
      });
      for (const post of posts) {
        const key = post.storyId || post.id;
        const dupe = await prisma.post.findFirst({
          where: {
            AND: [
              { OR: [{ storyId: key }, { id: key }] },
              { id: { not: post.id } },
              {
                OR: [
                  { alertState: 'sent', alertSentAt: { gte: new Date(Date.now() - 30 * 60000) } },
                  { alertState: { in: ['sending', 'uncertain'] }, firstSeenAt: { gte: new Date(Date.now() - 24 * 3600000) } },
                ],
              },
            ],
          },
        });
        if (dupe) {
          await prisma.post.update({ where: { id: post.id }, data: { alertState: 'skip' } });
          continue;
        }
        const tickers = (post.instruments || []).map((i) => i.ticker || i);
        let content =
          `**[${(post.category || '').toUpperCase()} ${post.importance}] ${tickers.join(' ')}** ${post.title}\n` +
          `${post.sourceName || ''} · ${post.exchange || ''} · <${post.url}>`;
        if (content.length > 1900) content = content.slice(0, 1900);
        // Atomic claim: only proceed if this tick transitioned pending → sending.
        const claim = await prisma.post.updateMany({
          where: { id: post.id, alertState: 'pending' },
          data: { alertState: 'sending' },
        });
        if (claim.count !== 1) continue; // another tick already claimed it
        let delivered = false;
        try {
          await request(DISCORD_WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content }), timeoutMs: 10000 });
          delivered = true;
        } catch (e) {
          if (e && e.status === 429) {
            await prisma.post.update({ where: { id: post.id }, data: { alertState: 'pending' } });
            const wait = Number(e.retryAfterMs) > 0 ? Number(e.retryAfterMs) : intervalMs;
            pausedUntil = Date.now() + wait;
            return;
          }
          const attempts = (post.alertAttempts || 0) + 1;
          if (post.firstSeenAt && Date.now() - new Date(post.firstSeenAt).getTime() > 24 * 3600000) {
            await prisma.post.update({ where: { id: post.id }, data: { alertState: 'failed' } });
          } else {
            const backoffMin = Math.min(Math.pow(2, attempts), 60);
            await prisma.post.update({
              where: { id: post.id },
              data: {
                alertAttempts: attempts,
                alertState: 'pending',
                alertNextAt: new Date(Date.now() + backoffMin * 60000),
              },
            });
          }
        }
        if (delivered) {
          try {
            await prisma.post.update({ where: { id: post.id }, data: { alertState: 'sent', alertSentAt: new Date() } });
          } catch (ackErr) {
            // Delivered but not acknowledged: never return to the automatic-send queue.
            try { await prisma.post.update({ where: { id: post.id }, data: { alertState: 'uncertain' } }); } catch (_) { /* stays 'sending'; the startup sweep marks it uncertain */ }
          }
        }
      }
    } catch (e) {
      /* ignore */
    } finally {
      running = false;
    }
  }

  timer = setInterval(tick, intervalMs);
  tick().catch(() => {});

  return function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  };
}

module.exports = { Alerts, startAlertWorker };
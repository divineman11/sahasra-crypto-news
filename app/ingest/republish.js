'use strict';

const { serializePost: serialize } = require('../lib/serialize');
const { hotUpsert } = require('./hotListUpsert');

/**
 * Durable republish worker.
 *
 * Finds posts whose Redis publication failed (hotPublishedAt still null)
 * and retries the hot-list publication, in order, until success or the
 * tick is exhausted.
 *
 * @param {object} opts
 * @param {import('@prisma/client').PrismaClient} opts.prisma
 * @param {import('ioredis').default} opts.redis
 * @param {number} [opts.intervalMs=30000]
 * @returns {() => void} stop function
 */
function startRepublish({ prisma, redis, intervalMs = 30000 }) {
  let timer = null;
  let running = false;
  let stopped = false;

  async function tick() {
    if (running || stopped) return;
    running = true;
    try {
      const posts = await prisma.post.findMany({
        where: {
          hotPublishedAt: null,
          firstSeenAt: { gte: new Date(Date.now() - 2 * 3600e3) },
        },
        orderBy: { firstSeenAt: 'asc' },
        take: 50,
        include: { instruments: true, votes: true },
      });

      let published = 0;
      for (const post of posts) {
        const dto = serialize(post);
        try {
          const json = JSON.stringify(dto);
          await hotUpsert(redis, post.id, json);
          await prisma.post.update({
            where: { id: post.id },
            data: { hotPublishedAt: new Date() },
          });
          published += 1;
        } catch (err) {
          console.error('[republish] republish failed for %s: %s', post.id, err.message);
          break; // stop this tick
        }
      }

      if (published > 0) {
        console.log(`[republish] published ${published} pending post(s)`);
      }
    } catch (err) {
      console.error('[republish] republish tick error: %s', err.message);
    } finally {
      running = false;
    }
  }

  timer = setInterval(() => {
    tick();
  }, intervalMs);
  if (timer.unref) timer.unref();

  // run once shortly after start
  setTimeout(tick, 1000).unref();

  return function stop() {
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

module.exports = { startRepublish };
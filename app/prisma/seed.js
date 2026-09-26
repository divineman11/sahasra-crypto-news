require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');
const { INSTRUMENTS } = require('../lib/instruments');
const { makeArticle } = require('../lib/mockNews');
const { serializePost } = require('../lib/serialize');

const prisma = new PrismaClient();

async function main() {
  // upsert all 30 instruments
  for (const inst of INSTRUMENTS) {
    await prisma.instrument.upsert({
      where: { ticker: inst.ticker },
      create: { ticker: inst.ticker, name: inst.name },
      update: { name: inst.name },
    });
  }

  const now = Date.now();
  const created = [];

  for (let i = 0; i < 20; i++) {
    const article = makeArticle(new Date(now - i * 3 * 60 * 1000));
    const url = `https://seed.local/post-${i}`;
    const instrumentConnects = article.tickers
      .map((t) => INSTRUMENTS.find((inst) => inst.ticker === t))
      .filter(Boolean)
      .map((inst) => ({ ticker: inst.ticker }));

    const post = await prisma.post.upsert({
      where: { url },
      create: {
        title: article.title,
        url,
        sourceDomain: article.sourceDomain,
        publishedAt: article.publishedAt,
        kind: article.kind,
        sentiment: article.sentiment,
        instruments: { connect: instrumentConnects },
        votes: { create: article.votes },
      },
      update: {
        title: article.title,
        sourceDomain: article.sourceDomain,
        publishedAt: article.publishedAt,
        kind: article.kind,
        sentiment: article.sentiment,
        instruments: { set: [], connect: instrumentConnects },
        votes: {
          upsert: {
            create: article.votes,
            update: article.votes,
          },
        },
      },
      include: { instruments: true, votes: true },
    });

    // ensure VoteData exists
    await prisma.voteData.upsert({
      where: { postId: post.id },
      create: { postId: post.id, ...article.votes },
      update: article.votes,
    });

    created.push(
      await prisma.post.findUnique({
        where: { id: post.id },
        include: { instruments: true, votes: true },
      })
    );
  }

  // rebuild Redis hot list
  let redis = null;
  try {
    redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      lazyConnect: true,
      connectTimeout: 5000,
      retryStrategy: () => null,
    });
    redis.on('error', () => {});
    await redis.connect();
    await redis.del('news:hot');
    const asc = [...created].sort(
      (a, b) => a.publishedAt.getTime() - b.publishedAt.getTime()
    );
    for (const p of asc) {
      await redis.lpush('news:hot', JSON.stringify(serializePost(p)));
    }
    await redis.ltrim('news:hot', 0, 999);
    console.log(`[seed] rebuilt Redis news:hot with ${asc.length} posts`);
  } catch (err) {
    console.warn('[seed] Redis unreachable, skipping hot list rebuild:', err.message);
  } finally {
    if (redis) {
      try {
        await redis.quit();
      } catch (_) {}
    }
  }

  console.log(`[seed] seeded 20 posts and ${INSTRUMENTS.length} instruments`);
}

main()
  .catch((err) => {
    console.error('[seed] DB error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
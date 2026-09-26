'use strict';

const fs = require('fs');
const path = require('path');
const { NEWS_LIVE_JSON } = require('./config');

function writeAtomic(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data);
  for (let i = 0; i < 5; i++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      if ((e.code === 'EPERM' || e.code === 'EBUSY') && i < 4) {
        const until = Date.now() + 50;
        while (Date.now() < until) {}
        continue;
      }
      throw e;
    }
  }
}

function classify(post) {
  if (post.category === 'hack' || post.category === 'delisting' || post.sentiment === 'bearish') return 'risk';
  if (post.sentiment === 'bullish') return 'catalyst';
  return 'other';
}

function better(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (b.importance !== a.importance) return b.importance > a.importance ? b : a;
  return new Date(b.publishedAt) > new Date(a.publishedAt) ? b : a;
}

function toISO(v) {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function buildHealth(scheduler, now) {
  if (!scheduler || typeof scheduler.health !== 'function') {
    return { known: false };
  }
  let h;
  try {
    h = scheduler.health();
  } catch (e) {
    return { known: false };
  }
  const adapters = Array.isArray(h) ? h : (h && Array.isArray(h.adapters) ? h.adapters : []);
  const tier1 = adapters.filter((a) => a && a.tier === 1);
  const tier1Ok = tier1.filter((a) => {
    const lastOk = a.lastOkAt ? new Date(a.lastOkAt).getTime() : 0;
    return lastOk > now - 15 * 60000 && (a.consecutiveErrors || 0) < 3;
  });
  const stale = [];
  for (const a of adapters) {
    if (!a) continue;
    // Same interval-aware window as health.js (a fixed 30-min window falsely marks any
    // 30-min-or-slower adapter as stale on ~half of jittered cycles), AND quietHealth
    // (unverified) adapters never mark health as degraded for readers of the file — an
    // unverified source going quiet is a log-only concern (see health.js), not something
    // readers of the file should be alerted for.
    const windowMs = Math.max(a.tier === 1 ? 15 * 60000 : 30 * 60000, (a.intervalMs || 0) * 2);
    const lastOk = a.lastOkAt ? new Date(a.lastOkAt).getTime() : 0;
    const ok = lastOk > now - windowMs && (a.consecutiveErrors || 0) < 3 && (a.consecutiveSaveErrors || 0) < 3;
    if (!ok && !a.quietHealth) stale.push(a.name);
  }
  return {
    known: true,
    ok: stale.length === 0,
    tier1Ok: tier1Ok.length,
    tier1Total: tier1.length,
    stale,
  };
}

// At ~3-4.5k posts/day, a single 48h/take-5000 query silently truncates the older part of the
// window (important items 30-48h old vanish; newsCount48h undercounts; media/social rows eat
// into the 5000). Split into two queries instead — (a) important items: importance>=50 only,
// so they can never be crowded out by a flood of low-importance rows; (b) counts/newsLatest:
// excludes media/social in SQL (kind notIn) with a narrow select, and a much larger take since
// it has to cover the whole 48h window's ordinary news volume. Both takes are injectable
// (options or env) so tests can exercise the truncation-avoidance behaviour with small numbers
// instead of seeding thousands of rows.
const DEFAULT_IMPORTANT_TAKE = Number(process.env.NEWSFILE_IMPORTANT_TAKE || 5000);
const DEFAULT_COUNTS_TAKE = Number(process.env.NEWSFILE_COUNTS_TAKE || 20000);

async function tick(prisma, scheduler, opts = {}) {
  const now = Date.now();
  const since = new Date(now - 48 * 3600e3);
  const future = new Date(now + 5 * 60e3);
  const importantTake = opts.importantTake || DEFAULT_IMPORTANT_TAKE;
  const countsTake = opts.countsTake || DEFAULT_COUNTS_TAKE;

  const baseWhere = {
    publishedAt: { gte: since, lte: future },
    firstSeenAt: { gte: since },
    OR: [{ userLabel: null }, { userLabel: { not: 'dismiss' } }],
  };

  // (a) important-item candidates: importance>=50 filtered in SQL, so a flood of
  // low-importance posts can never crowd a genuinely important item out of the
  // take-limited result set.
  const importantPosts = await prisma.post.findMany({
    where: { ...baseWhere, importance: { gte: 50 } },
    include: { instruments: true },
    orderBy: { firstSeenAt: 'desc' },
    take: importantTake,
  });

  // (b) counts/newsLatest candidates: every ordinary-news post in the window (no importance
  // filter — an important-worthy hack at importance 20 still counts), media/social excluded in
  // SQL (redundant with the JS-side kind check below, kept as defense-in-depth against a fake/
  // older prisma stub in a test not implementing `kind: {notIn}`), narrow select since flags
  // only need a handful of fields per post.
  const countPosts = await prisma.post.findMany({
    where: { ...baseWhere, kind: { notIn: ['media', 'social'] } },
    select: {
      id: true, storyId: true, publishedAt: true, importance: true, sourceName: true,
      title: true, url: true, category: true, sentiment: true, firstSeenAt: true, kind: true,
      instruments: { select: { ticker: true } },
    },
    orderBy: { firstSeenAt: 'desc' },
    take: countsTake,
  });

  const flags = {};
  for (const p of importantPosts) {
    const item = {
      id: p.id,
      title: p.title,
      url: p.url,
      category: p.category,
      importance: p.importance,
      sentiment: p.sentiment,
      source: p.sourceName,
      storyId: p.storyId,
      publishedAt: toISO(p.publishedAt),
      firstSeenAt: toISO(p.firstSeenAt),
    };
    const cls = classify(p);
    for (const ins of p.instruments) {
      const t = ins.ticker;
      if (!flags[t]) {
        flags[t] = {
          count: 0,
          risk: null,
          catalyst: null,
          other: null,
          items: [],
          latestPublishedAt: null,
        };
      }
      const f = flags[t];
      f.count += 1;
      if (cls === 'risk') f.risk = better(f.risk, item);
      else if (cls === 'catalyst') f.catalyst = better(f.catalyst, item);
      else f.other = better(f.other, item);
      f.items.push({ item, cls });
      const pub = new Date(p.publishedAt).getTime();
      if (!f.latestPublishedAt || new Date(f.latestPublishedAt).getTime() < pub) {
        f.latestPublishedAt = item.publishedAt;
      }
    }
  }

  const classRank = { risk: 0, catalyst: 1, other: 2 };
  for (const t of Object.keys(flags)) {
    const f = flags[t];
    // distinct storyIds
    const seenStories = new Set();
    for (const e of f.items) {
      if (e.item.storyId !== null && e.item.storyId !== undefined) seenStories.add(e.item.storyId);
      else seenStories.add(e.item.id);
    }
    f.count = seenStories.size;
    f.items = f.items
      .slice()
      .sort((a, b) => {
        if (classRank[a.cls] !== classRank[b.cls]) return classRank[a.cls] - classRank[b.cls];
        if (b.item.importance !== a.item.importance) return b.item.importance - a.item.importance;
        return new Date(b.item.publishedAt) - new Date(a.item.publishedAt);
      })
      .slice(0, 5)
      .map((e) => e.item);
  }

  const newsByTicker = {};
  for (const p of countPosts) {
    // The neutral "📰 N" count (newsCount48h/newsLatest) is meant for ordinary news coverage —
    // a YouTube video or Reddit thread is not a news story in that sense (and both are already
    // capped at importance<=10, so they can never appear as a risk/catalyst/other important
    // item via importantPosts above). Excluded here only; importantPosts is unaffected.
    // (Already excluded in SQL above via `kind: {notIn}` — kept here too as defense-in-depth.)
    if (p.kind === 'media' || p.kind === 'social') continue;
    const item = {
      id: p.id,
      title: p.title,
      url: p.url,
      category: p.category,
      importance: p.importance,
      sentiment: p.sentiment,
      source: p.sourceName,
      storyId: p.storyId,
      publishedAt: toISO(p.publishedAt),
      firstSeenAt: toISO(p.firstSeenAt),
    };
    for (const ins of p.instruments) {
      const t = ins.ticker;
      if (!newsByTicker[t]) newsByTicker[t] = [];
      newsByTicker[t].push(item);
    }
  }
  for (const t of Object.keys(newsByTicker)) {
    if (!flags[t]) {
      flags[t] = { count: 0, risk: null, catalyst: null, other: null, items: [], latestPublishedAt: null };
    }
    const list = newsByTicker[t].slice().sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    const stories = new Set();
    const latest = [];
    for (const it of list) {
      const key = it.storyId !== null && it.storyId !== undefined ? it.storyId : it.id;
      if (stories.has(key)) continue;
      stories.add(key);
      if (latest.length < 3) latest.push(it);
    }
    flags[t].newsCount48h = stories.size;
    flags[t].newsLatestPublishedAt = list.length ? list[0].publishedAt : null;
    flags[t].newsLatest = latest;
  }

  const health = buildHealth(scheduler, now);

  const out = {
    schema: 2,
    asof: new Date(now).toISOString(),
    asof_ms: now,
    heartbeat_ms: 0,
    window_h: 48,
    min_importance: 50,
    news_min_importance: 0,
    health,
    flags,
  };
  return out;
}

// The file is rewritten every 15 s.
function startNewsFile({ prisma, scheduler = null, intervalMs = 15000, importantTake, countsTake }) {
  let lastErrLog = 0;
  let running = false;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      const out = await tick(prisma, scheduler, { importantTake, countsTake });
      out.heartbeat_ms = intervalMs;
      const dir = path.dirname(NEWS_LIVE_JSON);
      if (!fs.existsSync(dir)) return;
      writeAtomic(NEWS_LIVE_JSON, JSON.stringify(out));
    } catch (e) {
      if (e && e.code === 'ENOENT' && !fs.existsSync(path.dirname(NEWS_LIVE_JSON))) return;
      if (Date.now() - lastErrLog >= 60000) {
        lastErrLog = Date.now();
        console.error('[newsFile] error:', e.message || e);
      }
    } finally {
      running = false;
    }
  };

  const timer = setInterval(run, intervalMs);
  run();
  return () => clearInterval(timer);
}

module.exports = { startNewsFile, tick };
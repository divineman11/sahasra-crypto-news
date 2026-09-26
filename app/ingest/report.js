'use strict';

const { request } = require('./http');
const { DISCORD_WEBHOOK } = require('./config');

function sign(sentiment) {
  if (sentiment === 'bullish') return 1;
  if (sentiment === 'bearish') return -1;
  return 0;
}

async function hitRate(prisma, days) {
  const since = new Date(Date.now() - days * 86400000);
  const posts = await prisma.post.findMany({
    where: { priceStatus: 'done', firstSeenAt: { gte: since } },
    select: { sourceName: true, category: true, moved5m: true, ret5m: true, sentiment: true },
  });

  const groups = new Map();
  for (const p of posts) {
    for (const key of [p.sourceName, p.category]) {
      if (!groups.has(key)) groups.set(key, { name: key, n: 0, moved: 0, absSum: 0, signedSum: 0 });
      const g = groups.get(key);
      g.n++;
      if (p.moved5m) g.moved++;
      g.absSum += Math.abs(p.ret5m || 0);
      g.signedSum += (p.ret5m || 0) * sign(p.sentiment);
    }
  }
  return [...groups.values()]
    .map((g) => ({
      name: g.name,
      n: g.n,
      moved5mPct: g.n ? Math.round((g.moved / g.n) * 1000) / 10 : 0,
      avgAbsRet5m: g.n ? Math.round((g.absSum / g.n) * 1000) / 1000 : 0,
      avgSignedRet5m: g.n ? Math.round((g.signedSum / g.n) * 1000) / 1000 : 0,
    }))
    .sort((a, b) => b.n - a.n);
}

function formatTable(rows) {
  const columns = ['group', 'n', 'moved5mPct', 'avgAbsRet5m', 'avgSignedRet5m'];
  const headers = ['group', 'n', 'moved5m%', 'avg|ret5m|', 'avg signed ret5m'];
  const headerCells = headers.map(String);
  const rowCells = rows.map((r) =>
    columns.map((col) => {
      if (col === 'group') return String(r.name ?? '');
      if (col === 'n') return String(r.n ?? 0);
      const v = r[col];
      return typeof v === 'number' ? v.toFixed(2) : String(v ?? '');
    })
  );
  const widths = columns.map((_, i) =>
    Math.max(headerCells[i].length, ...rowCells.map((cells) => cells[i].length))
  );
  const lines = [headerCells.map((c, i) => c.padEnd(widths[i])).join('  ')];
  for (const cells of rowCells) {
    lines.push(cells.map((c, i) => c.padEnd(widths[i])).join('  '));
  }
  return lines.join('\n');
}

async function postDiscord(content) {
  if (!DISCORD_WEBHOOK) return;
  const body = '```\n' + (content.length > 1900 - 8 ? content.slice(0, 1892) : content) + '\n```';
  await request(DISCORD_WEBHOOK, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: body }),
    timeoutMs: 10000,
  });
}

function isoWeek(d = new Date()) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function startWeeklyReport({ prisma, redis, alerts }) {
  const run = async () => {
    try {
      const now = new Date();
      if (now.getUTCDay() !== 1) return;
      const week = isoWeek(now);
      const res = await redis.set('report:week:' + week, '1', 'EX', 8 * 86400, 'NX');
      if (res !== 'OK') return;
      const rows = await hitRate(prisma, 7);
      await postDiscord(formatTable(rows));
    } catch (e) {
      console.error('[report] weekly error:', e.message || e);
    }
  };
  const timer = setInterval(run, 3600000);
  setTimeout(run, 60000);
  return () => clearInterval(timer);
}

module.exports = { hitRate, formatTable, startWeeklyReport };

if (require.main === module) {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const args = process.argv.slice(2);
  let days = 7;
  let discord = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--days') days = Number(args[++i]) || 7;
    if (args[i] === '--discord') discord = true;
  }
  hitRate(prisma, days)
    .then((rows) => {
      const table = formatTable(rows);
      console.log(table);
      if (discord) return postDiscord(table);
    })
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
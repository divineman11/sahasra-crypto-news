'use strict';
// Tells the web app (/setup page, attention banner) that the collector is alive, whether Redis answers,
// and which news sources have been failing. Written to ingest/cache/heartbeat.json every 30 seconds.
const path = require('path');
const { writeAtomic } = require('./unlocks/store');

const CACHE_DIR = path.join(__dirname, 'cache');

function snapshot({ scheduler, redis, env = process.env, now = Date.now() }) {
  let redisState = 'live';
  if (env.NEWS_REDIS === 'off') redisState = 'off';
  else if (redis && redis.status && redis.status !== 'ready') redisState = 'down';
  const failing = [];
  try {
    for (const [name, a] of scheduler.adapters) {
      if (a.state.consecutiveErrors >= 5 && !(a.adapter && a.adapter.quietHealth)) failing.push(name);
    }
  } catch (_) { /* no scheduler */ }
  return { at: now, pid: process.pid, redis: redisState, failing: failing.slice(0, 20) };
}

function startHeartbeat({ scheduler, redis, dir = CACHE_DIR, intervalMs = 30000 }) {
  const beat = () => {
    try { writeAtomic(path.join(dir, 'heartbeat.json'), JSON.stringify(snapshot({ scheduler, redis }))); } catch (_) { /* best effort */ }
  };
  beat();
  const t = setInterval(beat, intervalMs);
  return () => clearInterval(t);
}

module.exports = { startHeartbeat, snapshot, CACHE_DIR };

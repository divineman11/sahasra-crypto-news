'use strict';

class MemoryRedis {
  constructor() {
    this.kv = new Map(); // key -> { value, expiresAt|null }
    this.lists = new Map(); // key -> array
    this.hashes = new Map(); // key -> Map
    this.status = 'ready';
  }

  _expireCheck(key, store) {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      store.delete(key);
      return undefined;
    }
    return entry;
  }

  _getLiveKV(key) {
    return this._expireCheck(key, this.kv);
  }

  async set(key, value, ...args) {
    let seconds = null;
    let nx = false;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (typeof arg === 'string') {
        const up = arg.toUpperCase();
        if (up === 'EX') {
          seconds = Number(args[i + 1]);
          i++;
        } else if (up === 'NX') {
          nx = true;
        }
      }
    }
    const existing = this._getLiveKV(key);
    if (nx && existing) {
      return null;
    }
    const expiresAt = seconds !== null ? Date.now() + seconds * 1000 : null;
    this.kv.set(key, { value, expiresAt });
    return 'OK';
  }

  async get(key) {
    const entry = this._getLiveKV(key);
    return entry ? entry.value : null;
  }

  async exists(key) {
    return this._getLiveKV(key) !== undefined ? 1 : 0;
  }

  async del(key) {
    const existed = this._getLiveKV(key) !== undefined;
    this.kv.delete(key);
    this.lists.delete(key);
    this.hashes.delete(key);
    return existed ? 1 : 0;
  }

  async hset(key, field, value) {
    let hash = this.hashes.get(key);
    if (!hash) {
      hash = new Map();
      this.hashes.set(key, hash);
    }
    hash.set(field, value);
    return 1;
  }

  async hgetall(key) {
    const hash = this.hashes.get(key);
    if (!hash) return {};
    const out = {};
    for (const [field, value] of hash) {
      out[field] = value;
    }
    return out;
  }

  async lpush(key, ...values) {
    let list = this.lists.get(key);
    if (!list) {
      list = [];
      this.lists.set(key, list);
    }
    for (const value of values) {
      list.unshift(value);
    }
    return list.length;
  }

  async ltrim(key, start, stop) {
    const list = this.lists.get(key) || [];
    const len = list.length;
    let s = start < 0 ? len + start : start;
    let e = stop < 0 ? len + stop : stop;
    s = Math.max(0, s);
    e = Math.min(len - 1, e);
    const kept = s <= e ? list.slice(s, e + 1) : [];
    this.lists.set(key, kept);
    return 'OK';
  }

  async lrange(key, start, stop) {
    const list = this.lists.get(key) || [];
    const len = list.length;
    let s = start < 0 ? len + start : start;
    let e = stop < 0 ? len + stop : stop;
    s = Math.max(0, s);
    e = Math.min(len - 1, e);
    return s <= e ? list.slice(s, e + 1) : [];
  }

  async publish(channel, message) {
    return 0;
  }

  async eval(script, numKeys, ...args) {
    if (
      typeof script === 'string' &&
      script.includes('--hotUpsert') &&
      numKeys === 1
    ) {
      const key = args[0];
      const id = args[1];
      const json = args[2];
      const limit = Number(args[3]);
      const list = this.lists.get(key) || [];
      // Dedupe by id without mutating during iteration: keep entries whose
      // decoded .id does not match, then prepend the new json and cap length.
      const kept = list.filter(entry => {
        try {
          return JSON.parse(entry).id !== id;
        } catch {
          return true;
        }
      });
      const maxLen = Number.isFinite(limit) && limit > 0 ? limit : 1000;
      const newList = [json, ...kept].slice(0, maxLen);
      this.lists.set(key, newList);
      return 1;
    }
    return -1;
  }

  lremExact(list, entry) {
    const idx = list.indexOf(entry);
    if (idx !== -1) list.splice(idx, 1);
    return idx !== -1 ? 1 : 0;
  }

  multi() {
    const ops = [];
    const self = this;
    const proxy = {
      lpush(key, ...values) {
        ops.push(() => self.lpush(key, ...values));
        return proxy;
      },
      ltrim(key, start, stop) {
        ops.push(() => self.ltrim(key, start, stop));
        return proxy;
      },
      publish(channel, message) {
        ops.push(() => self.publish(channel, message));
        return proxy;
      },
      set(key, value, ...args) {
        ops.push(() => self.set(key, value, ...args));
        return proxy;
      },
      zadd(key, ...args) {
        ops.push(async () => null);
        return proxy;
      },
      zremrangebyscore(key, min, max) {
        ops.push(async () => null);
        return proxy;
      },
      async exec() {
        const results = [];
        for (const op of ops) {
          const result = await op();
          results.push([null, result]);
        }
        return results;
      }
    };
    return proxy;
  }

  on() {
    return this;
  }

  async quit() {
    return 'OK';
  }

  async disconnect() {
    return 'OK';
  }
}

function createRedis() {
  if (process.env.NEWS_REDIS === 'off') {
    console.log('[redis] NEWS_REDIS=off — using in-memory stand-in (no WSL/Redis needed)');
    return new MemoryRedis();
  }
  const Redis = require('ioredis');
  return new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: 2,
    enableOfflineQueue: true
  });
}

module.exports = { createRedis, MemoryRedis };
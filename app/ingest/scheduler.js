'use strict';

class Scheduler {
  constructor({ redis, onItems }) {
    this.redis = redis;
    this.onItems = onItems || (async () => {});
    this.adapters = new Map();
    this.timers = new Map();
    this.stopped = false;
  }

  add(adapter) {
    this.adapters.set(adapter.name, {
      adapter,
      state: {
        lastOkAt: 0,
        lastErrAt: 0,
        lastErr: null,
        consecutiveErrors: 0,
        itemsTotal: 0,
        warm: false,
        backoffUntil: 0,
        lastTickAt: 0,
        lastNonEmptyAt: 0,
        okRuns: 0,
        consecutiveSaveErrors: 0,
        lastSaveErr: null,
        lastSaveErrAt: 0,
        lastSaveOkAt: 0,
        inflight: null,
        inflightLogged: false,
        itemsInflight: null,
        itemsInflightLogged: false,
        itemsInflightSince: 0,
      },
    });
  }

  start() {
    this.stopped = false;
    for (const [name] of this.adapters) this._loop(name);
  }

  stop() {
    this.stopped = true;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  health() {
    const out = [];
    for (const { adapter, state } of this.adapters.values()) {
      out.push({ name: adapter.name, tier: adapter.tier, intervalMs: adapter.intervalMs, quietHealth: !!adapter.quietHealth, ...state });
    }
    return out;
  }

  _loop(name) {
    const entry = this.adapters.get(name);
    if (!entry) return;
    this._schedule(name, 0);
  }

  _schedule(name, delay) {
    if (this.stopped) return;
    const t = setTimeout(() => this._run(name), delay);
    t.unref && t.unref();
    this.timers.set(name, t);
  }

  async _run(name) {
    const entry = this.adapters.get(name);
    if (!entry || this.stopped) return;
    const { adapter, state } = entry;
    const now = Date.now();

    // non-overlap guard: a previous run timed out but its promise has not settled
    if (state.inflight) {
      if (!state.inflightLogged) {
        console.log(`[sched] ${name} previous run still pending, skipping`);
        state.inflightLogged = true;
      }
      this._schedule(name, this._jitter(adapter.intervalMs));
      return;
    }

    // non-overlap guard for saves: previous onItems timed out but is still running
    if (state.itemsInflight) {
      // escape hatch for a truly hung save: die so the supervisor restarts us
      if (state.itemsInflightSince && now - state.itemsInflightSince > 10 * 60 * 1000) {
        console.log(`[sched] ${name} save stuck >10 min — exiting so the supervisor restarts the collector`);
        process.exit(1);
      }
      if (!state.itemsInflightLogged) {
        console.log(`[sched] ${name} previous save still pending, skipping fetch`);
        state.itemsInflightLogged = true;
      }
      this._schedule(name, this._jitter(adapter.intervalMs));
      return;
    }

    // sleep-resume guard (skipped when the gap was a planned backoff)
    if (
      state.lastTickAt &&
      !(state.backoffUntil >= state.lastTickAt) &&
      now - state.lastTickAt > adapter.intervalMs * 1.2 + 60000
    ) {
      console.log(`[sched] clock jump on ${name}, skipping one cycle`);
      state.lastTickAt = now;
      this._schedule(name, this._jitter(adapter.intervalMs));
      return;
    }
    state.lastTickAt = now;

    let delay;
    if (state.backoffUntil > now) {
      delay = state.backoffUntil - now;
    } else {
      let watchdogTimer = null;
      let onItemsWdTimer = null;
      try {
        // per-run watchdog: a hung adapter can never stop its loop
        const wd = Math.max(45000, adapter.intervalMs + 30000);
        const watchdog = new Promise((_, rej) => {
          watchdogTimer = setTimeout(
            () => rej(Object.assign(new Error('watchdog timeout after ' + wd + ' ms'), { status: 0 })),
            wd
          );
        });
        const runPromise = Promise.resolve(adapter.run());
        state.inflight = runPromise;
        state.inflightLogged = false;
        state.inflight.finally(() => {
          if (state.inflight === runPromise) state.inflight = null;
        }).catch(() => {});
        const items = (await Promise.race([runPromise, watchdog])) || [];
        clearTimeout(watchdogTimer);
        state.lastOkAt = Date.now();
        state.consecutiveErrors = 0;
        state.okRuns++;
        state.itemsTotal += items.length;
        if (items.length > 0) state.lastNonEmptyAt = Date.now();
        let onItemsOk = false;
        try {
          // onItems gets its own watchdog scaled to the batch size
          const onItemsWd = Math.max(60000, items.length * 2000);
          const onItemsWatchdog = new Promise((_, rej) => {
            onItemsWdTimer = setTimeout(() => rej(new Error('onItems watchdog timeout')), onItemsWd);
          });
          const itemsPromise = Promise.resolve(this.onItems(items, { warm: state.warm, adapter }));
          state.itemsInflight = itemsPromise;
          state.itemsInflightLogged = false;
          state.itemsInflightSince = Date.now();
          state.itemsInflight.finally(() => {
            if (state.itemsInflight === itemsPromise) {
              state.itemsInflight = null;
              state.itemsInflightSince = 0;
            }
          }).catch(() => {});
          await Promise.race([itemsPromise, onItemsWatchdog]);
          clearTimeout(onItemsWdTimer);
          onItemsOk = true;
        } catch (err) {
          clearTimeout(onItemsWdTimer);
          console.error(`[sched] onItems error for ${name}: ${err.message}`);
          state.consecutiveSaveErrors++;
          state.lastSaveErr = err.message;
          state.lastSaveErrAt = Date.now();
          require('./http').clearConditionalCache();
        }
        if (onItemsOk) {
          state.consecutiveSaveErrors = 0;
          state.lastSaveOkAt = Date.now();
        }
        if (onItemsOk && state.okRuns >= (adapter.warmRuns || 1)) state.warm = true;
        delay = this._jitter(adapter.intervalMs);
      } catch (err) {
        clearTimeout(watchdogTimer);
        state.consecutiveErrors++;
        state.lastErrAt = Date.now();
        state.lastErr = `${err.message}${err.status ? ` (status ${err.status})` : ''}`;
        state.backoffUntil = this._backoffUntil(adapter, state, err);
        delay = state.backoffUntil - Date.now();
        console.log(`[sched] ${name} error #${state.consecutiveErrors}: ${state.lastErr}; backing off ${Math.round(delay / 1000)}s`);
      }
    }

    // health persistence must never block the loop
    this._persist(name, adapter, state).catch(() => {});
    this._schedule(name, Math.max(delay, 1));
  }

  _jitter(intervalMs) {
    return intervalMs * (0.8 + 0.4 * Math.random());
  }

  _backoffUntil(adapter, state, err) {
    const now = Date.now();
    const retry = err.retryAfterMs || null;
    // Unverified (quietHealth) sources: once persistently failing, retry at most once every 6h
    // instead of the normal <=10 min ceiling. This lives here (not in a health.js side-channel)
    // so it can never be raced or overwritten by the generic backoff computed on every failed
    // run below — see the fix-round review (B1) for the bug this replaced.
    if (adapter.quietHealth && state.consecutiveErrors >= (adapter.quietFailThreshold || 6)) {
      return now + Math.max(retry || 0, 6 * 3600 * 1000);
    }
    if (err.status === 403 || err.status === 418) return now + Math.max(retry || 0, 10 * 60 * 1000);
    if (err.status === 429) return now + Math.max(retry || 0, 60 * 1000);
    return now + Math.min(adapter.intervalMs * 2 ** state.consecutiveErrors, 10 * 60 * 1000);
  }

  async _persist(name, adapter, state) {
    if (!this.redis) return;
    try {
      await this.redis.hset('ingest:health', name, JSON.stringify({ ...state, tier: adapter.tier, intervalMs: adapter.intervalMs }));
    } catch (err) {
      // ignore redis errors
    }
  }
}

module.exports = { Scheduler };
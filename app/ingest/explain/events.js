'use strict';
// / §4.1 / §4.3: ExplainEvent store (one atomic JSON file), rate limits, queue, merge.
// No DB migration. Files live under ingest/cache/explain/ (git-ignored).
const fs = require('fs');
const path = require('path');
const gate = require('./gate');
const { extractFacts, mergeFacts } = require('./facts');
const templates = require('./templates');
const evidence = require('./evidence');
const { createRewriter } = require('./rewrite');
const heatLib = require('./heat');
const outcomesLib = require('./outcomes');
const baseRatesLib = require('./baseRates');
const { etDay } = require('./timeET');
const { NEG_RE } = require('../classify');

const HOUR = 3600e3;
const MAX_PER_HOUR = 3;
const QUEUE_EXPIRE_MS = 6 * HOUR;
const CLOSE_AFTER_MS = 72 * HOUR;
const KEEP_MS = 30 * 24 * HOUR;
const MERGE_WINDOW_MS = 24 * HOUR;
const OFFICIAL_KINDS = new Set(['exchange', 'official', 'regulator', 'symbol']);

function writeAtomic(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data);
  for (let i = 0; i < 5; i++) {
    try { fs.renameSync(tmp, file); return; } catch (e) {
      if ((e.code === 'EPERM' || e.code === 'EBUSY') && i < 4) { const until = Date.now() + 50; while (Date.now() < until) {} continue; }
      throw e;
    }
  }
}

function nameFor(ticker) {
  try { return require('../tickers').nameOf(ticker) || ticker; } catch (e) { return ticker; }
}

function sentimentOf(s) {
  return s === 'bullish' || s === 'bearish' ? s : 'neutral';
}

function createEngine(opts = {}) {
  const dir = opts.dir || process.env.EXPLAIN_DIR || path.join(__dirname, '..', 'cache', 'explain');
  const file = path.join(dir, 'events.json');
  const nowFn = opts.now || (() => Date.now());
  const maxPerHour = opts.maxPerHour || MAX_PER_HOUR;
  const log = opts.log || ((m) => console.log(m));
  let events = null;
  const rewriter = opts.rewriteCmd ? createRewriter({ dir, cmd: opts.rewriteCmd, dailyMax: opts.rewriteDailyMax || 20, now: nowFn, timeoutMs: opts.rewriteTimeoutMs || 20000, log }) : null;
  const fetchHeat = opts.fetchHeat || null; // (ticker) -> {range_24h_pct}
  const outcomes = opts.priceFn ? outcomesLib.createOutcomes({ dir, now: nowFn, priceFn: opts.priceFn, log }) : null;
  const rates = baseRatesLib.createStore({ dir, now: nowFn, outcomes, log, minN: opts.minN });
  let lastOutcomesRun = 0;
  const pending = new Set();
  const bg = (p) => { const q = p.catch((e) => log('[explain] background error: ' + (e && e.message || e))).then(() => { pending.delete(q); }); pending.add(q); return q; };

  function load() {
    if (events) return events;
    try { events = JSON.parse(fs.readFileSync(file, 'utf8')); if (!Array.isArray(events)) events = []; } catch (e) { events = []; }
    return events;
  }
  function save() {
    fs.mkdirSync(dir, { recursive: true });
    writeAtomic(file, JSON.stringify(events));
  }
  const slotsUsed = (now) => load().filter((e) => e.live_at && Date.parse(e.live_at) > now - HOUR).length;

  function rebuild(ev, post, isFirst) {
    // Facts are recomputed from the event's merged facts; templates + evidence re-render each time.
    ev.text = templates.render(ev.category, ev.subtype, ev.facts);
    ev.glossary = ev.text.glossary || [];
    delete ev.text.glossary;
    ev.evidence = evidence.compute(ev.timeline, ev.facts);
    applyBaseRate(ev);
    if (rewriter) rewriter.applyCached(ev);
  }

  const MEASURE = { unlock: 'coins were lower vs BTC 30 days after an unlock this big' };
  // "Historically X of N ..." only from base_rates.json and only when n >= min_n; else the literal stays.
  function applyBaseRate(ev) {
    const br = rates.get(ev.category + ':' + ev.subtype);
    if (!br) return;
    const down = ev.text.scenarios.find((s) => s.dir === 'down');
    if (down) down.base_rate = { x: br.lower_vs_btc_d30, n: br.n, measure: MEASURE[ev.category] || 'coins were lower vs BTC 30 days after an event like this' };
    ev.text.uncertain = ev.text.uncertain.filter((u) => u !== 'Not enough comparable cases');
  }

  // Past cases from the forward log: same category:subtype, same coin first, finished rows before open ones.
  function setHistory(ev) {
    if (!outcomes) return;
    const coin = ev.coin ? ev.coin.ticker : null;
    const rows = outcomes.all().filter((r) => r.category === ev.category && r.subtype === ev.subtype && r.event_id !== ev.id && r.status !== 'no_price');
    rows.sort((a, b) => ((b.coin === coin) - (a.coin === coin)) || ((b.status === 'done') - (a.status === 'done')) || (Date.parse(b.t0) - Date.parse(a.t0)));
    const cases = rows.slice(0, 5).map((r) => ({ date: r.date, coin: r.coin, headline: r.headline, r1: r.d1 ? r.d1.ret_vs_btc : null, r7: r.d7 ? r.d7.ret_vs_btc : null, r30: r.d30 ? r.d30.ret_vs_btc : null }));
    ev.history = { cases, note: cases.length ? null : 'Not enough comparable cases' };
  }

  async function refreshHeat(ev) {
    if (!fetchHeat || !ev.coin) return;
    const m = await fetchHeat(ev.coin.ticker);
    ev.heat = heatLib.toHeat(m || {}, new Date(nowFn()).toISOString());
    save();
  }

  // Background work after a create/merge: LLM rewrite (if configured) and heat lookup (if configured).
  function afterChange(ev) {
    if (rewriter && ev.text.source !== 'rewrite') bg(rewriter.run(ev).then(() => save()));
    if (fetchHeat && ev.coin && !(ev.heat && ev.heat.checked_at)) bg(refreshHeat(ev));
  }

  function describeChange(before, ev, post, kind) {
    const a = before, b = ev.facts, parts = [];
    if (b.unlock_pct_circ != null && b.unlock_pct_circ !== a.unlock_pct_circ) parts.push(a.unlock_pct_circ != null ? `unlock size now ${b.unlock_pct_circ}% (was ${a.unlock_pct_circ}%)` : `unlock size now ${b.unlock_pct_circ}%`);
    if (b.unlock_tokens != null && b.unlock_tokens !== a.unlock_tokens) parts.push(`token count now ${templates.fmtCount(b.unlock_tokens)}`);
    if (b.amount_usd != null && b.amount_usd !== a.amount_usd) parts.push(`reported loss now about ${templates.fmtUsd(b.amount_usd)}`);
    const added = (b.restrictions || []).slice((a.restrictions || []).length).map((r) => r.detail.toLowerCase());
    if (added.length) parts.push('new restriction: ' + added.join(', '));
    if (kind === 'denial') parts.push('a denial or correction was reported');
    else if (kind === 'confirmation') parts.push('an official source confirmed');
    if (!parts.length) parts.push(`another source reported the same story (${post.sourceDomain || post.sourceName})`);
    return `Rev ${ev.rev}: ${parts.join('; ')}.`;
  }

  function timelineEntry(post, kind, nowIso) {
    const info = evidence.sourceInfo(post);
    const pub = post.publishedAt instanceof Date ? post.publishedAt.getTime() : Date.parse(post.publishedAt);
    const ts = new Date(isFinite(pub) ? Math.min(pub, Date.parse(nowIso)) : Date.parse(nowIso)).toISOString();
    return Object.assign({ ts, kind, source: info.domain, title: post.title, url: post.url, post_id: post.id }, info);
  }

  function consider(post) {
    const now = nowFn();
    const nowIso = new Date(now).toISOString();
    const g = gate.evaluate(post, { now });
    if (!g.pass) return null;
    load();
    const day = etDay(now);
    const key = g.coin || g.topic;
    const id = `evt_${day}_${key}_${g.category}`;

    let ev = events.find((e) => e.id === id);
    if (!ev) {
      ev = events.find((e) => (e.post_ids.includes(post.id) || (post.storyId && e.story_ids.includes(post.storyId))) && now - Date.parse(e.created_at) < MERGE_WINDOW_MS) || null;
    }
    if (ev && ev.post_ids.includes(post.id)) return ev;

    const ticker = g.coin;
    const ctx = { category: g.category, subtype: g.subtype, ticker, name: ticker ? (post.names && post.names[ticker]) || nameFor(ticker) : (post.exchange || null) };
    const nf = extractFacts(post, ctx);

    if (ev) {
      // §4.3 attach
      const title = post.title || '';
      let kind = 'update';
      if (NEG_RE.test(title) && /hack|exploit/i.test(title)) kind = 'denial';
      else if (OFFICIAL_KINDS.has(post.kind)) kind = 'confirmation';
      ev.timeline.push(timelineEntry(post, kind, nowIso));
      ev.post_ids.push(post.id);
      if (post.storyId && !ev.story_ids.includes(post.storyId)) ev.story_ids.push(post.storyId);
      const before = JSON.parse(JSON.stringify(ev.facts));
      ev.facts = mergeFacts(ev.facts, nf);
      ev.importance = Math.max(ev.importance || 0, post.importance || 0);
      ev.rev += 1;
      ev.updated_at = nowIso;
      rebuild(ev, post, false);
      setHistory(ev);
      ev.last_change = { rev: ev.rev, at: nowIso, text: describeChange(before, ev, post, kind) };
      save();
      afterChange(ev);
      log(`[explain] merged ${ev.id} rev ${ev.rev}`);
      return ev;
    }

    const live = slotsUsed(now) < maxPerHour;
    const prior = events
      .filter((e) => e.category === g.category && (g.coin ? e.coin && e.coin.ticker === g.coin : e.topic === g.topic))
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .slice(0, 5)
      .map((e) => ({ date: etDay(e.created_at), coin: e.coin ? e.coin.ticker : null, headline: e.facts.headline, r1: null, r7: null, r30: null }));
    ev = {
      id,
      rev: 1,
      created_at: nowIso,
      updated_at: nowIso,
      state: live ? 'live' : 'queued',
      category: g.category,
      subtype: g.subtype,
      sentiment: sentimentOf(post.sentiment),
      coin: ticker ? { ticker, name: ctx.name } : null,
      topic: g.coin ? null : g.topic,
      exchange: post.exchange ? String(post.exchange).toLowerCase() : null,
      facts: nf,
      text: null,
      evidence: null,
      heat: { level: null, range_24h_pct: null },
      history: { cases: prior, note: prior.length ? null : 'Not enough comparable cases' },
      timeline: [timelineEntry(post, 'first', nowIso)],
      post_ids: [post.id],
      story_ids: post.storyId ? [post.storyId] : [],
      glossary: [],
      importance: post.importance || 0,
      live_at: live ? nowIso : null,
    };
    rebuild(ev, post, true);
    setHistory(ev);
    ev.last_change = null;
    events.push(ev);
    save();
    if (live && outcomes) bg(outcomes.record(ev));
    afterChange(ev);
    log(`[explain] new ${ev.state} event ${ev.id} (${g.reason})`);
    return ev;
  }

  // Promote queued events FIFO (importance desc, then time) while hourly slots are free.
  function promoteQueue() {
    load();
    const now = nowFn();
    let n = 0;
    for (;;) {
      if (slotsUsed(now) >= maxPerHour) break;
      const q = events.filter((e) => e.state === 'queued').sort((a, b) => (b.importance - a.importance) || (Date.parse(a.created_at) - Date.parse(b.created_at)));
      if (!q.length) break;
      q[0].state = 'live';
      q[0].live_at = new Date(now).toISOString();
      q[0].updated_at = q[0].live_at;
      if (outcomes) bg(outcomes.record(q[0]));
      n++;
      log(`[explain] promoted ${q[0].id}`);
    }
    if (n) save();
    return n;
  }

  function closeOld() {
    load();
    const now = nowFn();
    let closed = 0, expired = 0, pruned = 0;
    const keep = [];
    for (const e of events) {
      const age = now - Date.parse(e.created_at);
      if (e.state === 'queued' && age > QUEUE_EXPIRE_MS) { expired++; log(`[explain] queue expired ${e.id}`); continue; }
      if (age > KEEP_MS) { pruned++; continue; }
      if (e.state === 'live' && age > CLOSE_AFTER_MS) { e.state = 'closed'; closed++; }
      keep.push(e);
    }
    events = keep;
    if (closed || expired || pruned) save();
    return { closed, expired, pruned };
  }

  function tick() {
    const r = { promoted: promoteQueue(), ...closeOld() };
    try { rates.maybeRebuild(); } catch (e) { log('[explain] base rates error: ' + e.message); }
    if (outcomes && nowFn() - lastOutcomesRun >= HOUR) {
      lastOutcomesRun = nowFn();
      bg(outcomes.run().then((n) => { if (n) refreshDerived(); }));
    }
    if (fetchHeat) {
      const now = nowFn();
      const due = load().filter((e) => e.state === 'live' && e.coin && (!e.heat || !e.heat.checked_at || now - Date.parse(e.heat.checked_at) > 10 * 60e3)).slice(0, 5);
      for (const e of due) bg(refreshHeat(e));
    }
    return r;
  }
  // After outcomes fill in: refresh history + base-rate lines of live events.
  function refreshDerived() {
    let ch = false;
    for (const e of load()) {
      if (e.state !== 'live') continue;
      const before = JSON.stringify([e.history, e.text.scenarios.map((s) => s.base_rate), e.text.uncertain]);
      setHistory(e);
      rebuildText(e);
      if (JSON.stringify([e.history, e.text.scenarios.map((s) => s.base_rate), e.text.uncertain]) !== before) ch = true;
    }
    if (ch) save();
  }
  function rebuildText(e) { applyBaseRate(e); }
  const settled = async () => { while (pending.size) await Promise.all([...pending]); };

  const visible = (e) => e.state !== 'queued';
  function list({ limit = 20, coin = null, includeQueued = false } = {}) {
    load();
    return events
      .filter((e) => (includeQueued || visible(e)) && (!coin || (e.coin && e.coin.ticker === String(coin).toUpperCase())))
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
      .slice(0, limit);
  }
  const get = (id) => load().find((e) => e.id === id) || null;
  const byPost = (postId) => load().find((e) => visible(e) && e.post_ids.includes(postId)) || null;
  function reset() { events = null; }

  return { consider, promoteQueue, closeOld, tick, list, get, byPost, reset, settled, file, outcomes, rates, _events: () => load() };
}

let def = null;
function engine() {
  if (!def) {
    const cfg = require('../config');
    def = createEngine({
      rewriteCmd: process.env.EXPLAIN_REWRITE_CMD || cfg.EXPLAIN_REWRITE_CMD || '',
      rewriteDailyMax: parseInt(process.env.EXPLAIN_REWRITE_DAILY_MAX || '', 10) || cfg.EXPLAIN_REWRITE_DAILY_MAX,
      fetchHeat: process.env.EXPLAIN_HEAT === '0' ? null : heatLib.makeFetcher((u) => require('../http').request(u, { timeoutMs: 8000 })),
      priceFn: outcomesLib.makePriceFn((u) => require('../http').request(u, { timeoutMs: 8000 })),
    });
  }
  return def;
}
// Safe wrappers for the live collector: never throw into the ingest path.
function consider(post) {
  if (process.env.EXPLAIN_ENABLED === '0') return null;
  try { return engine().consider(post); } catch (e) { console.error('[explain] consider error:', e.message || e); return null; }
}
function tick() {
  if (process.env.EXPLAIN_ENABLED === '0') return null;
  try { return engine().tick(); } catch (e) { console.error('[explain] tick error:', e.message || e); return null; }
}

module.exports = { createEngine, consider, tick, engine };

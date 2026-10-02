'use strict';
// §4.5 optional plain-words rewrite. OFF unless EXPLAIN_REWRITE_CMD is set.
// The command reads JSON {facts, text} on stdin and prints JSON {why, tradeoffs, scenarios:[{title,condition}]}.
// Only why / tradeoffs / scenario title+condition are rewritable; everything else stays template.
// Sparingly: one call per facts-hash, max 1 in flight, daily cap, cached by sha1(category|subtype|facts).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const guard = require('./numberGuard');
const { etDay } = require('./timeET');

const DAY = 24 * 3600e3;

function hashOf(ev) {
  return crypto.createHash('sha1').update(`${ev.category}|${ev.subtype}|${JSON.stringify(ev.facts)}`).digest('hex');
}

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

function createRewriter({ dir, cmd, dailyMax = 20, now = () => Date.now(), timeoutMs = 20000, log = (m) => console.log(m) }) {
  const file = path.join(dir, 'rewrite_cache.json');
  let cache = null;
  let inflight = false;

  function load() {
    if (cache) return cache;
    try { cache = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { cache = null; }
    if (!cache || typeof cache !== 'object') cache = {};
    if (!cache.entries) cache.entries = {};
    if (!cache.daily) cache.daily = { day: '', n: 0 };
    return cache;
  }
  function save() {
    fs.mkdirSync(dir, { recursive: true });
    writeAtomic(file, JSON.stringify(cache));
  }

  function apply(ev, value, cached) {
    ev.text.why = value.why;
    ev.text.tradeoffs = value.tradeoffs;
    value.scenarios.forEach((s, i) => { ev.text.scenarios[i].title = s.title; ev.text.scenarios[i].condition = s.condition; });
    ev.text.source = 'rewrite';
    ev.text.rewriteInfo = { tried: true, accepted: true, reason: null, cached };
  }

  // Sync: use a previously accepted rewrite for this exact facts-hash.
  function applyCached(ev) {
    if (!cmd) return false;
    const e = load().entries[hashOf(ev)];
    if (e && e.accepted && e.value && ev.text && ev.text.source !== 'rewrite') {
      apply(ev, e.value, true);
      return true;
    }
    return false;
  }

  function runCommand(input) {
    return new Promise((resolve) => {
      let out = '';
      let done = false;
      const p = spawn(cmd, [], { shell: true, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
      const timer = setTimeout(() => {
        try {
          if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
          else p.kill('SIGKILL');
        } catch (e) { /* ignore */ }
        finish({ error: 'timeout' });
      }, timeoutMs);
      p.stdout.on('data', (d) => { if (out.length < 200000) out += d; });
      p.stderr.on('data', () => {});
      p.on('error', (e) => finish({ error: 'spawn error: ' + e.message }));
      p.on('close', (code) => finish(code === 0 ? { out } : { error: 'exit code ' + code, out }));
      try { p.stdin.on('error', () => {}); p.stdin.end(JSON.stringify(input)); } catch (e) { /* ignore */ }
    });
  }

  // Async: returns { status }. Mutates ev only if it is still the same facts-hash when the command returns.
  async function run(ev) {
    if (!cmd) return { status: 'off' };
    if (ev.text.source === 'rewrite') return { status: 'already' };
    const c = load();
    const h = hashOf(ev);
    const t = now();
    const hit = c.entries[h];
    if (hit && hit.accepted && hit.value) { apply(ev, hit.value, true); return { status: 'cached' }; }
    if (hit && t - hit.at < DAY) {
      log(`[explain] rewrite skip ${hit.reason} (retry blocked 24h)`);
      ev.text.rewriteInfo = { tried: true, accepted: false, reason: hit.reason, cached: true };
      return { status: 'blocked' };
    }
    if (inflight) { log('[explain] rewrite skip busy'); return { status: 'busy' }; }
    const day = etDay(t);
    if (c.daily.day !== day) c.daily = { day, n: 0 };
    if (c.daily.n >= dailyMax) { log('[explain] rewrite skip daily cap'); return { status: 'cap' }; }
    c.daily.n += 1;
    inflight = true;
    const template = JSON.parse(JSON.stringify(ev.text));
    let res;
    try {
      res = await runCommand({ facts: ev.facts, text: { why: template.why, tradeoffs: template.tradeoffs, scenarios: template.scenarios.map((s) => ({ title: s.title, condition: s.condition })) } });
    } finally {
      inflight = false;
    }
    let reason = null;
    let value = null;
    if (res.error) reason = res.error;
    else {
      const v = guard.validateOutput(res.out, template, ev.facts);
      if (v.ok) value = v.value; else reason = v.reason;
    }
    c.entries[h] = value ? { at: now(), accepted: true, value } : { at: now(), accepted: false, reason };
    save();
    if (hashOf(ev) !== h) return { status: 'stale' };
    if (value) { apply(ev, value, false); return { status: 'applied' }; }
    log(`[explain] rewrite skip ${reason}`);
    ev.text.rewriteInfo = { tried: true, accepted: false, reason, cached: false };
    return { status: 'rejected', reason };
  }

  return { run, applyCached, hashOf, file, enabled: !!cmd };
}

module.exports = { createRewriter, hashOf };

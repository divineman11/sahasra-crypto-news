'use strict';
// Optional weekly cross-check, "bring your own AI".
// UNLOCK_CROSSCHECK_CMD is any shell command. It receives JSON on stdin (our top upcoming unlocks) and
// must print JSON on stdout listing unlocks that other trackers show but we do not (or show smaller).
// See docs/unlock-crosscheck-prompt.md for the contract and scripts/crosscheck.example.js for a wrapper.
const { spawn } = require('child_process');

const MAX_ITEMS = 30;
const TIMEOUT_MS = 5 * 60000;
const MAX_STDOUT = 2 * 1024 * 1024;

/** Input document for the command. `upcoming` = view.upcoming. */
function buildInput(upcoming, nowMs) {
  const items = upcoming
    .filter((u) => u.ts * 1000 >= nowMs - 24 * 3600e3)
    .slice()
    .sort((a, b) => (b.pctCirc ?? -1) - (a.pctCirc ?? -1) || (b.tokens || 0) - (a.tokens || 0))
    .slice(0, MAX_ITEMS)
    .map((u) => ({
      symbol: u.symbol,
      name: u.name,
      date: new Date(u.ts * 1000).toISOString().slice(0, 10),
      tokens: u.tokens != null ? Math.round(u.tokens) : null,
      pct_of_circulating: u.pctCirc != null ? Math.round(u.pctCirc * 100) / 100 : null,
      sources: u.sources,
    }));
  return {
    schema: 'sahasra.unlock-crosscheck.v1',
    generated_at: new Date(nowMs).toISOString(),
    ours: items,
    reply_schema: {
      missing: [{ symbol: 'TICKER', date: 'YYYY-MM-DD', pct_of_circulating: 'number|null', tokens: 'number|null', source: 'site name', note: 'one short sentence' }],
      undercounted: [{ symbol: 'TICKER', date: 'YYYY-MM-DD', our_pct: 'number|null', their_pct: 'number', source: 'site name', note: 'one short sentence' }],
    },
  };
}

const sym = (v) => (typeof v === 'string' && /^[A-Za-z0-9]{1,12}$/.test(v.trim()) ? v.trim().toUpperCase() : null);
const dateOk = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v + 'T00:00:00Z')) ? v : null);
const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const text = (v, n) => (typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').replace(/[<>]/g, '').slice(0, n) : '');

/**
 * Parse + validate the command's stdout. Tolerates a ```json fence and chatter around the JSON object.
 * Returns { ok, items, error }. Items: [{kind:'missing'|'undercounted', symbol, date, pct, ourPct, tokens, source, note}]
 */
function parseReply(raw) {
  let s = String(raw == null ? '' : raw).trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let j;
  try {
    j = JSON.parse(s);
  } catch (e) {
    const a = s.indexOf('{');
    const b = s.lastIndexOf('}');
    try { j = JSON.parse(s.slice(a, b + 1)); } catch (e2) { return { ok: false, items: [], error: 'reply is not valid JSON' }; }
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { ok: false, items: [], error: 'reply must be a JSON object with "missing" and/or "undercounted"' };
  if (!Array.isArray(j.missing) && !Array.isArray(j.undercounted)) return { ok: false, items: [], error: 'reply has neither "missing" nor "undercounted" arrays' };
  const items = [];
  for (const m of Array.isArray(j.missing) ? j.missing : []) {
    const symbol = sym(m && m.symbol), date = dateOk(m && m.date);
    if (!symbol || !date) continue;
    items.push({ kind: 'missing', symbol, date, pct: numOrNull(m.pct_of_circulating), ourPct: null, tokens: numOrNull(m.tokens), source: text(m.source, 60), note: text(m.note, 200) });
  }
  for (const m of Array.isArray(j.undercounted) ? j.undercounted : []) {
    const symbol = sym(m && m.symbol), date = dateOk(m && m.date);
    const their = numOrNull(m && m.their_pct);
    if (!symbol || !date || their == null) continue;
    items.push({ kind: 'undercounted', symbol, date, pct: their, ourPct: numOrNull(m.our_pct), tokens: null, source: text(m.source, 60), note: text(m.note, 200) });
  }
  return { ok: true, items: items.slice(0, 100), error: null };
}

/** Run the user's command. Resolves { ok, items, error } and never rejects. */
function runCommand(cmd, input, { timeoutMs = TIMEOUT_MS, env = process.env } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let done = false;
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    let child;
    try {
      child = spawn(cmd, { shell: true, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      return resolve({ ok: false, items: [], error: 'could not start command: ' + (e.message || e) });
    }
    const timer = setTimeout(() => { try { child.kill(); } catch (_) { /* ignore */ } finish({ ok: false, items: [], error: `command timed out after ${Math.round(timeoutMs / 1000)}s` }); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; if (out.length > MAX_STDOUT) { try { child.kill(); } catch (_) { /* ignore */ } finish({ ok: false, items: [], error: 'command output too large' }); } });
    child.stderr.on('data', (d) => { if (err.length < 2000) err += d; });
    child.on('error', (e) => finish({ ok: false, items: [], error: 'command failed: ' + (e.message || e) }));
    child.on('close', (code) => {
      if (code !== 0) return finish({ ok: false, items: [], error: `command exited with code ${code}${err ? ': ' + err.trim().slice(0, 200) : ''}` });
      finish(parseReply(out));
    });
    child.stdin.on('error', () => { /* command may not read stdin */ });
    child.stdin.end(JSON.stringify(input));
  });
}

module.exports = { buildInput, parseReply, runCommand, MAX_ITEMS };

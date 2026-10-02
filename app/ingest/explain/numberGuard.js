'use strict';
// §4.6 number guard: a LLM rewrite is accepted only if it adds no number, ticker, advice word,
// URL or markdown that the facts + template did not already contain.
const fs = require('fs');
const path = require('path');

const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, dozen: 12, hundred: 100, thousand: 1000 };
const MULT = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9 };
const BANNED = /\b(buy|sell|long|short|target|entry|stop loss|take profit|guaranteed|will go|moon|dump)\b/i;
const RECOMMEND = /\b(i|we)\s+(recommend|suggest|advise)\b/i;
const URL_RE = /https?:\/\/|www\.|\bdot\s+(com|org|net|io|xyz|co|app|ai|me)\b|[a-z0-9]\.(com|org|net|io|xyz|co|app|ai|me)\b/i;
const MARKDOWN = /[*_`#]|\]\(|^\s*[-•]\s/m;
const NUM_RE = /\$?(\d[\d,]*(?:\.\d+)?)\s*(%|thousand|million|billion|bn|k|m|b)?(?![A-Za-z])/gi;
const FIELD_MIN = 0.4;
const FIELD_MAX = 1.6;

const norm = (n) => Number(Number(n).toPrecision(10));

// Every numeric token in a text, normalised ($ , % stripped; k/m/b/million/billion applied; words one..ten).
function numbersIn(text) {
  const out = [];
  const s = String(text == null ? '' : text);
  let m;
  NUM_RE.lastIndex = 0;
  while ((m = NUM_RE.exec(s))) {
    const base = parseFloat(m[1].replace(/,/g, ''));
    if (!isFinite(base)) continue;
    const suf = (m[2] || '').toLowerCase();
    out.push(norm(suf && suf !== '%' ? base * MULT[suf] : base));
    out.push(norm(base)); // raw digits too ("1.66B" also allows 1.66)
  }
  const w = s.toLowerCase().match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|dozen|hundred|thousand)\b/g) || [];
  for (const x of w) out.push(WORDS[x]);
  return out;
}

function walk(v, acc) {
  if (typeof v === 'number') { if (isFinite(v)) acc.push(norm(v)); }
  else if (typeof v === 'string') acc.push(...numbersIn(v));
  else if (Array.isArray(v)) v.forEach((x) => walk(x, acc));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => walk(x, acc));
}

function templateStrings(t) {
  const out = [t.what, t.why, t.tradeoffs];
  for (const s of t.scenarios || []) out.push(s.title, s.condition, s.evidence, s.timeframe);
  for (const a of t.affected || []) out.push(a.who, a.how);
  for (const w of t.watch || []) out.push(w.label, w.detail);
  for (const u of t.uncertain || []) out.push(u);
  return out.filter((x) => typeof x === 'string');
}

function allowedNumbers(facts, template) {
  const acc = [];
  walk(facts, acc);
  for (const s of templateStrings(template)) acc.push(...numbersIn(s));
  return new Set(acc);
}

let coinCache = null;
function coinSymbols() {
  if (coinCache) return coinCache;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cache', 'coins.json'), 'utf8'));
    coinCache = new Set((j.coins || []).map((c) => String(c.symbol).toUpperCase()));
  } catch (e) {
    coinCache = new Set(['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'ADA', 'USDT', 'USDC']);
  }
  return coinCache;
}

// Rewritable fields of a rewrite object -> [name, outText, templateText]
function fieldPairs(out, tpl) {
  const pairs = [['why', out.why, tpl.why], ['tradeoffs', out.tradeoffs, tpl.tradeoffs]];
  (tpl.scenarios || []).forEach((s, i) => {
    const o = (out.scenarios || [])[i] || {};
    pairs.push([`scenarios[${i}].title`, o.title, s.title], [`scenarios[${i}].condition`, o.condition, s.condition]);
  });
  return pairs;
}

/**
 * @param out      parsed rewrite { why, tradeoffs, scenarios:[{title,condition}] }
 * @param template the template text object it rewrites
 * @param facts    event facts
 * @returns { ok, reason }
 */
function check(out, template, facts, opts = {}) {
  if (!out || typeof out !== 'object') return { ok: false, reason: 'not an object' };
  if (!Array.isArray(out.scenarios) || out.scenarios.length !== (template.scenarios || []).length) return { ok: false, reason: 'scenario count differs' };
  const coins = opts.coins || coinSymbols();
  const allowedNums = allowedNumbers(facts, template);
  const tplText = templateStrings(template).join(' ');
  const allowedTickers = new Set(['BTC']);
  if (facts && facts.ticker) allowedTickers.add(String(facts.ticker).toUpperCase());
  for (const t of tplText.match(/\b[A-Z]{2,6}\b/g) || []) allowedTickers.add(t);
  for (const [name, o, t] of fieldPairs(out, template)) {
    if (typeof o !== 'string' || !o.trim()) return { ok: false, reason: `${name} missing` };
    if (o.includes('�')) return { ok: false, reason: `${name} invalid UTF-8` };
    const ratio = o.length / Math.max(1, String(t).length);
    if (ratio < FIELD_MIN || ratio > FIELD_MAX) return { ok: false, reason: `${name} length ${ratio.toFixed(2)}x outside ${FIELD_MIN}-${FIELD_MAX}x` };
    if (MARKDOWN.test(o)) return { ok: false, reason: `${name} contains markdown` };
    if (URL_RE.test(o)) return { ok: false, reason: `${name} contains a URL` };
    if (RECOMMEND.test(o)) return { ok: false, reason: `${name} contains a recommendation` };
    const b = o.match(BANNED);
    if (b) return { ok: false, reason: `banned word "${b[0].toLowerCase()}" in ${name}` };
    for (const n of numbersIn(o)) if (!allowedNums.has(n)) return { ok: false, reason: `number ${n} not in input (${name})` };
    for (const tk of o.match(/\b[A-Z]{2,6}\b/g) || []) if (coins.has(tk) && !allowedTickers.has(tk)) return { ok: false, reason: `ticker ${tk} not in input (${name})` };
  }
  return { ok: true, reason: null };
}

// Parse the command's stdout (tolerates a ```json fence) then run the guard.
function validateOutput(raw, template, facts, opts) {
  let s = String(raw == null ? '' : raw).trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let j;
  try { j = JSON.parse(s); } catch (e) { return { ok: false, reason: 'invalid or truncated JSON' }; }
  const g = check(j, template, facts, opts);
  if (!g.ok) return g;
  return { ok: true, reason: null, value: { why: j.why, tradeoffs: j.tradeoffs, scenarios: j.scenarios.map((x) => ({ title: x.title, condition: x.condition })) } };
}

module.exports = { check, validateOutput, numbersIn, allowedNumbers, BANNED };

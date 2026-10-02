#!/usr/bin/env node
'use strict';
/**
 * EXAMPLE wrapper for the weekly unlock cross-check. Copy it, edit it, point UNLOCK_CROSSCHECK_CMD at it.
 *
 *   UNLOCK_CROSSCHECK_CMD="node scripts/crosscheck.example.js"
 *
 * Sahasra runs the command once a week, writes a JSON document to its stdin (our top upcoming unlocks), and expects
 * a JSON object on stdout:  { "missing": [...], "undercounted": [...] }   (see docs/unlock-crosscheck-prompt.md).
 *
 * This wrapper is model-agnostic and contains no keys. It builds the prompt from docs/unlock-crosscheck-prompt.md and
 * sends it to ANY web-search-capable model through ONE of two adapters, chosen by environment variables:
 *
 *   A) A command-line tool.      CROSSCHECK_LLM_CMD="<command that reads the prompt on stdin and prints the answer>"
 *   B) An HTTP endpoint.         CROSSCHECK_LLM_URL="https://.../chat"
 *                                CROSSCHECK_LLM_BODY='{"model":"MODEL","messages":[{"role":"user","content":{{PROMPT}}}]}'
 *                                CROSSCHECK_LLM_HEADERS='{"Authorization":"Bearer ${MY_LLM_KEY}"}'   (optional; ${NAME} is read from your environment)
 *                                CROSSCHECK_LLM_RESPONSE_PATH="choices.0.message.content"           (optional; where the answer text is in the reply)
 *
 * {{PROMPT}} in the body is replaced by the prompt as a JSON string (already quoted). Keep your keys in your own
 * environment, never in this file and never in the repository.
 *
 * Try it without any model:   node scripts/crosscheck.example.js --dry-run < sample.json
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const https = require('https');
const http = require('http');

const PROMPT_FILE = path.join(__dirname, '..', '..', 'docs', 'unlock-crosscheck-prompt.md');

function readStdin() {
  return new Promise((resolve) => {
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => (s += d));
    process.stdin.on('end', () => resolve(s));
    if (process.stdin.isTTY) resolve('');
  });
}

function buildPrompt(inputJson) {
  let tpl;
  try { tpl = fs.readFileSync(PROMPT_FILE, 'utf8'); } catch (e) { tpl = 'Compare this list of token unlocks with public unlock trackers and reply with JSON {"missing":[],"undercounted":[]}.\n\n{{INPUT}}'; }
  // Use only the part of the doc between the markers as the prompt; fall back to the whole file.
  const a = tpl.indexOf('<!-- PROMPT START -->');
  const b = tpl.indexOf('<!-- PROMPT END -->');
  const body = a >= 0 && b > a ? tpl.slice(a + '<!-- PROMPT START -->'.length, b).trim() : tpl;
  return body.replace('{{INPUT}}', inputJson);
}

function viaCommand(cmd, prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, { shell: true, stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error('LLM command exited with code ' + code))));
    child.stdin.end(prompt);
  });
}

function expand(str) {
  return String(str).replace(/\$\{([A-Z0-9_]+)\}/gi, (_, n) => process.env[n] || '');
}

function viaHttp(urlStr, bodyTpl, headersJson, respPath, prompt) {
  return new Promise((resolve, reject) => {
    const body = bodyTpl.replace('{{PROMPT}}', JSON.stringify(prompt));
    const headers = Object.assign({ 'Content-Type': 'application/json' }, headersJson ? JSON.parse(expand(headersJson)) : {});
    const u = new URL(urlStr);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(u, { method: 'POST', headers: Object.assign(headers, { 'Content-Length': Buffer.byteLength(body) }), timeout: 240000 }, (res) => {
      let s = '';
      res.on('data', (d) => (s += d));
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error('LLM endpoint answered HTTP ' + res.statusCode));
        try {
          let j = JSON.parse(s);
          const p = respPath ? respPath.split('.') : ['choices', '0', 'message', 'content'];
          for (const k of p) j = j == null ? j : j[k];
          resolve(typeof j === 'string' ? j : s);
        } catch (e) { resolve(s); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('LLM endpoint timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

(async () => {
  const input = await readStdin();
  const prompt = buildPrompt(input.trim() || '{}');
  if (process.argv.includes('--dry-run')) { process.stdout.write(prompt + '\n'); return; }
  let answer;
  if (process.env.CROSSCHECK_LLM_CMD) answer = await viaCommand(process.env.CROSSCHECK_LLM_CMD, prompt);
  else if (process.env.CROSSCHECK_LLM_URL && process.env.CROSSCHECK_LLM_BODY) {
    answer = await viaHttp(process.env.CROSSCHECK_LLM_URL, process.env.CROSSCHECK_LLM_BODY, process.env.CROSSCHECK_LLM_HEADERS, process.env.CROSSCHECK_LLM_RESPONSE_PATH, prompt);
  } else {
    console.error('Set CROSSCHECK_LLM_CMD (a command-line AI tool) or CROSSCHECK_LLM_URL + CROSSCHECK_LLM_BODY (an HTTP AI endpoint). See the header of this file.');
    process.exit(2);
  }
  // Keep only the JSON object so chatter around it cannot break Sahasra's reader.
  const s = String(answer).replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const i = s.indexOf('{');
  const j = s.lastIndexOf('}');
  process.stdout.write((i >= 0 && j > i ? s.slice(i, j + 1) : '{"missing":[],"undercounted":[]}') + '\n');
})().catch((e) => { console.error(String(e && e.message || e)); process.exit(1); });

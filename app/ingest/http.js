'use strict';

const { BROWSER_UA } = require('./config');

const condCache = new Map();

class HttpError extends Error {
  constructor(message, status, retryAfterMs = null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function parseRetryAfter(value) {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs)) return secs * 1000;
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

async function request(url, { method = 'GET', headers = {}, body, ua, timeoutMs = 10000, conditional = false, followRedirects = true } = {}) {
  const finalHeaders = { ...headers };
  finalHeaders['User-Agent'] = ua || BROWSER_UA;
  if (conditional && condCache.has(url)) {
    const c = condCache.get(url);
    if (c.etag) finalHeaders['If-None-Match'] = c.etag;
    if (c.lastModified) finalHeaders['If-Modified-Since'] = c.lastModified;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  let text = '';
  try {
    try {
      res = await fetch(url, {
        method,
        headers: finalHeaders,
        body,
        // followRedirects:false (redirect:'manual') lets a caller read a 3xx's
        // Location header itself instead of being auto-followed to the final page — used by
        // official.js to read GitHub's /releases/latest redirect target without downloading it.
        // Default unchanged (follow) for every existing caller.
        redirect: followRedirects ? 'follow' : 'manual',
        signal: controller.signal,
      });
    } catch (err) {
      throw new HttpError(`network error: ${err.message}`, 0);
    }

    const status = res.status;
    // A manual (unfollowed) redirect is a normal, successful response for the caller to inspect
    // (status + Location header) — only >=400 is an error, same as the follow case.
    if (status >= 400) {
      const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
      throw new HttpError(`HTTP ${status} for ${url}`, status, retryAfterMs);
    }

    if (status !== 304 && !(status >= 300 && status < 400 && !followRedirects)) text = await res.text();
  } finally {
    clearTimeout(timer);
  }

  const etag = res.headers.get('etag');
  const lastModified = res.headers.get('last-modified');
  if (etag || lastModified) condCache.set(url, { etag, lastModified });

  const status = res.status;
  return { status, notModified: status === 304, headers: res.headers, text, json: () => JSON.parse(text) };
}

function clearConditionalCache() {
  condCache.clear();
}

module.exports = { request, HttpError, clearConditionalCache };
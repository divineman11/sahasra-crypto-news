'use strict';

// Trump news adapters for Sahasra's separate Trump section.
// kind is always 'politics' so these items stay out of the crypto feed.
// Google News pubDate is often a re-index date rather than the real publish
// date, so we decode the real article URL and verify the article's own
// published timestamp (falling back to a copies check) before trusting it.

const { request } = require('../http');

const MAX_ARTICLE_FETCHES = 12;
const MAX_COPIES_CHECKS = 8;

const realUrlCache = new Map(); // gid -> { url, at }
const articleDateCache = new Map(); // realUrl -> { result, at }
const staleGids = new Set();

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

function cacheGet(map, key) {
  const e = map.get(key);
  if (!e) return undefined;
  if (Date.now() - e.at > CACHE_TTL) {
    map.delete(key);
    return undefined;
  }
  return e.v;
}

function cacheSet(map, key, v) {
  map.set(key, { v, at: Date.now() });
}

function parseRssItems(xml) {
  const items = [];
  if (!xml) return items;
  const re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const body = m[1];
    items.push({
      title: xmlText(getTag(body, 'title')),
      link: xmlText(getTag(body, 'link')),
      description: xmlText(getTag(body, 'description')),
      guid: xmlText(getTag(body, 'guid')),
      pubDate: xmlText(getTag(body, 'pubDate')),
      source: xmlText(getTag(body, 'source')),
      originalUrl: xmlText(getTag(body, 'truth:originalUrl')),
    });
  }
  return items;
}

function getTag(xml, tag) {
  const m = xml.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + tag + '>', 'i'));
  return m ? m[1] : '';
}

function xmlText(s) {
  if (!s) return "";
  let t = String(s);
  const cd = t.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  if (cd) return cd[1].trim();
  return decodeEntities(t).trim();
}

function decodeEntities(s) {
  if (!s) return '';
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function stripHtml(s) {
  if (!s) return '';
  return decodeEntities(String(s))
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanTitle(title) {
  if (!title) return '';
  const m = title.match(/^(.*)\s+-\s+[^\-]{2,60}$/);
  if (m) return m[1].trim();
  return title.trim();
}

function wholeWord(word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^a-z0-9])' + escaped + '([^a-z0-9]|$)');
}

const BAD_PUBLISHERS = [
  'the new republic', 'newrepublic', 'daily beast', 'huffpost',
  'huffington post', 'salon', 'raw story', 'mediaite',
  'columbia journalism review', 'honolulu civil beat', 'the sun',
  'facebook', 'yahoo', 'aol', 'msn',
];

const BAD_KEYWORDS = [
  'opinion', 'op-ed', 'editorial', 'column', 'analysis |', 'analysis:',
  'what to know', 'explainer', 'podcast', 'poll', 'approval rating',
  'memoir', 'documentary', 'melania', 'barron', 'golf', 'snl', 'kimmel',
  'fact check', 'late-night',
];

const GOOD_KEYWORDS = [
  'tariff', 'tariffs', 'duties', 'trade deal', 'trade war', 'section 232',
  'section 301', 'ieepa', 'china', 'xi', 'sanction', 'sanctions', 'fed',
  'federal reserve', 'powell', 'rate cut', 'rate cuts', 'interest rate',
  'interest rates', 'iran', 'israel', 'hormuz', 'strike', 'strikes',
  'ceasefire', 'troops', 'missile', 'missiles', 'nuclear', 'russia',
  'putin', 'ukraine', 'taiwan', 'oil', 'opec', 'crypto', 'bitcoin',
  'stablecoin', 'executive order', 'signs', 'signed', 'national emergency',
  'shutdown', 'debt ceiling', 'tax', 'chips', 'nvidia', 'semiconductor',
  'export controls', 'export ban', 'dollar', 'treasury', 'bessent',
  'lutnick', 'greer', 'sec', 'truth social', 'press conference',
  'oval office', 'breaking', 'deficit', 'inflation', 'recession',
  'stocks', 'stock market', 'markets', 'yields', 'bond', 'bonds',
  'diesel', 'energy', 'gasoline', 'fuel', 'ai', 'artificial intelligence',
  'fomc', 'jobs report', 'gdp', 'cpi', 'embargo', 'blockade', 'war',
];

function passesNoiseFilter(item) {
  const title = (item.title || '').toLowerCase();
  const desc = stripHtml(item.description || '').toLowerCase();
  const text = title + ' ' + desc;

  if (!wholeWord('trump').test(text)) return false;

  const publisher = (item.publisher || '').toLowerCase();
  for (const p of BAD_PUBLISHERS) {
    if (wholeWord(p).test(publisher)) return false;
  }
  for (const k of BAD_KEYWORDS) {
    if (wholeWord(k).test(text)) return false;
  }
  for (const k of GOOD_KEYWORDS) {
    if (wholeWord(k).test(text)) return true;
  }
  return false;
}

function parseCandidateDate(raw, now) {
  if (!raw) return null;
  const s = decodeEntities(String(raw)).trim();
  if (!s) return null;

  const hasTz = /(Z|[+-]\d{2}:?\d{2})$/i.test(s);
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!hasTz && !isDateOnly) return null;

  const d = new Date(s);
  if (isNaN(d)) return null;

  // Reject dates more than 10 minutes in the future.
  if (d.getTime() - now.getTime() > 10 * 60 * 1000) return null;

  return d;
}

function extractArticleDate(html, now) {
  if (!html) return null;
  now = now instanceof Date ? now : new Date(now || Date.now());

  let m = html.match(/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i);
  if (!m) m = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i);
  if (m) { const d = parseCandidateDate(m[1], now); if (d) return d; }

  const ldRe = /"datePublished"\s*:\s*"([^"]+)"/g;
  while ((m = ldRe.exec(html)) !== null) {
    const d = parseCandidateDate(m[1], now);
    if (d) return d;
  }

  m = html.match(/itemprop=["']datePublished["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/content=["']([^"']+)["'][^>]*itemprop=["']datePublished["']/i);
  if (m) { const d = parseCandidateDate(m[1], now); if (d) return d; }

  m = html.match(/<time[^>]+datetime=["']([^"']+)["']/i);
  if (m) { const d = parseCandidateDate(m[1], now); if (d) return d; }

  return null;
}

function decodeBatchResponse(text) {
  if (!text) return null;
  const m = text.match(/\[\\"garturlres\\",\\"(.*?)\\"/);
  if (!m) return null;
  return m[1]
    .replace(/\\\\u003d/g, '=').replace(/\\\\u0026/g, '&')
    .replace(/\\u003d/g, '=').replace(/\\u0026/g, '&');
}

function gidFromLink(link) {
  if (!link) return null;
  const noQuery = link.split('?')[0];
  const parts = noQuery.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

async function decodeGoogleLink(link) {
  const gid = gidFromLink(link);
  if (!gid) return null;
  if (staleGids.has(gid)) return { stale: true, url: null };
  const cached = cacheGet(realUrlCache, gid);
  if (cached) return { stale: false, url: cached };

  let html;
  try {
    const r = await request('https://news.google.com/rss/articles/' + encodeURIComponent(gid), { timeoutMs: 8000 });
    html = r.text || '';
  } catch (e) {
    return { stale: false, url: null };
  }
  const sg = (html.match(/data-n-a-sg="([^"]+)"/) || [])[1];
  const ts = (html.match(/data-n-a-ts="([^"]+)"/) || [])[1];
  if (!sg || !ts) return { stale: false, url: null };

  try {
    const inner = JSON.stringify([
      'garturlreq',
      [['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1], 'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
      gid,
      Number(ts),
      sg,
    ]);
    const freq = encodeURIComponent(JSON.stringify([[['Fbv4je', inner, null, 'generic']]]));
    const r = await request('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: 'f.req=' + freq,
      timeoutMs: 10000,
    });
    const realUrl = decodeBatchResponse(r.text);
    if (!realUrl) return { stale: false, url: null };
    cacheSet(realUrlCache, gid, realUrl);
    return { stale: false, url: realUrl };
  } catch (e) {
    return { stale: false, url: null };
  }
}

async function fetchArticleDate(realUrl) {
  const cached = cacheGet(articleDateCache, realUrl);
  if (cached) return cached;
  let result = null;
  try {
    const r = await request(realUrl, { timeoutMs: 8000 });
    const text = r.text || '';
    if (text.length <= 2 * 1024 * 1024) {
      result = extractArticleDate(text, new Date());
    }
  } catch (e) {
    result = null;
  }
  cacheSet(articleDateCache, realUrl, result);
  return result;
}

function normalizeTitleForCompare(t) {
  return (t || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function dedupeKey(t) {
  return normalizeTitleForCompare(t).slice(0, 60);
}

function ageMs(date, now) {
  return now - date.getTime();
}

async function copiesCheck(cleanT, now) {
  try {
    const url = 'https://news.google.com/rss/search?q=' +
      encodeURIComponent('"' + cleanT + '"') + '&hl=en-US&gl=US&ceid=US:en';
    const r = await request(url, { timeoutMs: 10000 });
    const items = parseRssItems(r.text);
    const norm = normalizeTitleForCompare(cleanT);
    for (const it of items) {
      const itClean = cleanTitle(it.title);
      if (normalizeTitleForCompare(itClean) !== norm) continue;
      const d = it.pubDate ? new Date(it.pubDate) : null;
      if (d && !isNaN(d) && ageMs(d, now) > 2 * 60 * 60 * 1000) return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

async function processGoogleItems(entries, sourceName, maxAgeMs) {
  const now = Date.now();
  const out = [];
  const seen = new Set();

  const candidates = [];
  for (const e of entries) {
    const title = (e.title || '').trim();
    if (!title) continue;
    const ct = cleanTitle(title);
    if (!ct) continue;
    const publisher = (e.source && e.source.trim()) ||
      (title.match(/\s-\s+([^-]+)$/) || [])[1] || '';
    if (!passesNoiseFilter({ title: ct, description: e.description, publisher: publisher })) continue;
    const gd = e.pubDate ? new Date(e.pubDate) : null;
    if (!gd || isNaN(gd)) continue;
    if (now - gd.getTime() > maxAgeMs) continue;
    candidates.push({ raw: e, title: ct, publisher: publisher, googleDate: gd });
  }

  candidates.sort((a, b) => b.googleDate - a.googleDate);

  let fetches = 0;
  let copies = 0;

  for (const c of candidates) {
    if (out.length >= 25) break;
    const key = dedupeKey(c.title);
    if (seen.has(key)) continue;

    const gid = gidFromLink(c.raw.link);
    if (gid && staleGids.has(gid)) continue;

    let realUrl = null;
    if (fetches < MAX_ARTICLE_FETCHES) {
      fetches++;
      const dec = await decodeGoogleLink(c.raw.link);
      realUrl = dec.url;
    }

    let publishedAt = null;
    let verified = false;
    let dateUnknown = false;

    if (realUrl && fetches <= MAX_ARTICLE_FETCHES + 1 && (fetches - 1) <= MAX_ARTICLE_FETCHES) {
      const d = await fetchArticleDate(realUrl);
      if (d) {
        const age = now - d.getTime();
        if (/^\d{4}-\d{2}-\d{2}$/.test(d.toISOString ? '' : '')) { /* noop */ }
        if (d.toISOString().slice(0, 10) === new Date(now).toISOString().slice(0, 10) && isDateOnlyValue(d)) {
          dateUnknown = true;
        } else if (age > 2 * 60 * 60 * 1000) {
          if (gid) staleGids.add(gid);
          continue;
        } else {
          publishedAt = d;
          verified = true;
        }
      }
    }

    if (!verified && !dateUnknown) {
      if (fetches <= MAX_ARTICLE_FETCHES && copies < MAX_COPIES_CHECKS) {
        copies++;
        const stale = await copiesCheck(c.title, now);
        if (stale) {
          if (gid) staleGids.add(gid);
          continue;
        }
        seen.add(key);
        out.push(makeItem(sourceName, 2, c.title + ' — ' + c.publisher + ' [date unverified]',
          realUrl || c.raw.link, c.googleDate));
      } else {
        // Out of budget: skip this run, retry next run.
        continue;
      }
    } else if (dateUnknown) {
      seen.add(key);
      out.push(makeItem(sourceName, 2, c.title + ' — ' + c.publisher + ' [date unverified]',
        realUrl || c.raw.link, c.googleDate));
    } else {
      seen.add(key);
      out.push(makeItem(sourceName, 2, c.title + ' — ' + c.publisher, realUrl || c.raw.link, publishedAt));
    }
  }

  out.sort((a, b) => b.publishedAt - a.publishedAt);
  return out.slice(0, 25);
}

// Heuristic: a date-only value parses to midnight UTC of that day.
function isDateOnlyValue(d) {
  return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
}

function makeItem(sourceName, sourceTier, title, url, publishedAt) {
  return {
    sourceName: sourceName,
    sourceTier: sourceTier,
    kind: 'politics',
    exchange: null,
    title: title,
    url: url,
    publishedAt: publishedAt instanceof Date ? publishedAt : new Date(publishedAt),
    hintCategory: null,
    hintTickers: [],
  };
}

async function runTruth() {
  let res;
  try {
    res = await request('https://trumpstruth.org/feed', { timeoutMs: 20000 });
  } catch (e) {
    console.error('[trump] trump:truth failed:', e.message);
    return googleTruthFallback();
  }
  const items = parseRssItems(res.text);
  if (!items.length) return googleTruthFallback();

  const now = Date.now();
  const out = [];
  for (const it of items) {
    let text = stripHtml(it.description);
    if (!text) text = 'posted a photo or video';
    const d = it.pubDate ? new Date(it.pubDate) : null;
    if (!d || isNaN(d)) continue;
    if (now - d.getTime() > 24 * 60 * 60 * 1000) continue;
    let title;
    if (text === 'posted a photo or video') {
      title = 'Trump posted a photo or video on Truth Social';
    } else if (text.length > 220) {
      title = 'Trump on Truth Social: ' + text.slice(0, 220) + '…';
    } else {
      title = 'Trump on Truth Social: ' + text;
    }
    const url = it.originalUrl || it.link;
    if (!url) continue;
    out.push(makeItem('trump:truth', 1, title, url, d));
  }
  out.sort((a, b) => b.publishedAt - a.publishedAt);
  if (!out.length) return googleTruthFallback();
  return out.slice(0, 20);
}

async function googleTruthFallback() {
  const url = 'https://news.google.com/rss/search?q=%22Truth+Social%22+Trump+when:2h&hl=en-US&gl=US&ceid=US:en';
  try {
    const r = await request(url, { timeoutMs: 15000 });
    const entries = parseRssItems(r.text);
    const items = await processGoogleItems(entries, 'trump:truth-fallback', 2 * 60 * 60 * 1000);
    return items.slice(0, 20);
  } catch (e) {
    console.error('[trump] trump:truth-fallback failed:', e.message);
    return [];
  }
}

async function runNews() {
  const jobs = [
    { name: 'google-targeted', url: 'https://news.google.com/rss/search?q=Trump+(tariff+OR+tariffs+OR+Fed+OR+Powell+OR+%22executive+order%22+OR+Iran+OR+China+OR+Xi+OR+sanctions+OR+ceasefire)+when:2h&hl=en-US&gl=US&ceid=US:en', source: 'trump:gnews', google: true },
    { name: 'google-wires', url: 'https://news.google.com/rss/search?q=Trump+(site:reuters.com+OR+site:apnews.com)+when:2h&hl=en-US&gl=US&ceid=US:en', source: 'trump:gnews', google: true },
    { name: 'google-broad', url: 'https://news.google.com/rss/search?q=Trump+when:2h&hl=en-US&gl=US&ceid=US:en', source: 'trump:gnews', google: true },
    { name: 'whitehouse-actions', url: 'https://www.whitehouse.gov/presidential-actions/feed/', source: 'trump:whitehouse', google: false },
    { name: 'whitehouse-releases', url: 'https://www.whitehouse.gov/releases/feed/', source: 'trump:whitehouse', google: false },
    { name: 'cnbc', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', source: 'trump:cnbc', google: 'cnbc' },
  ];

  const collected = [];

  for (const job of jobs) {
    try {
      const r = await request(job.url, { timeoutMs: 15000 });
      const entries = parseRssItems(r.text);
      const now = Date.now();

      if (job.google === true) {
        const items = await processGoogleItems(entries, job.source, 2 * 60 * 60 * 1000);
        for (const it of items) collected.push(it);
      } else if (job.google === 'cnbc') {
        for (const e of entries) {
          const title = cleanTitle(e.title);
          if (!title) continue;
          const publisher = (e.source && e.source.trim()) || 'CNBC';
          if (!passesNoiseFilter({ title: title, description: e.description, publisher: publisher })) continue;
          const d = e.pubDate ? new Date(e.pubDate) : null;
          if (!d || isNaN(d)) continue;
          if (now - d.getTime() > 2 * 60 * 60 * 1000) continue;
          collected.push(makeItem(job.source, 2, title + ' — ' + publisher, e.link, d));
        }
      } else {
        for (const e of entries) {
          const title = stripHtml(e.title);
          if (!title) continue;
          const d = e.pubDate ? new Date(e.pubDate) : null;
          if (!d || isNaN(d)) continue;
          if (now - d.getTime() > 24 * 60 * 60 * 1000) continue;
          collected.push(makeItem(job.source, 2, '[White House] ' + title, e.link, d));
        }
      }
    } catch (e) {
      console.error('[trump] ' + job.name + ' failed:', e.message);
    }
  }

  const seen = new Set();
  const out = [];
  collected.sort((a, b) => b.publishedAt - a.publishedAt);
  for (const it of collected) {
    const key = dedupeKey(it.title);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out.slice(0, 25);
}

function make() {
  if (process.env.TRUMP_ENABLED === '0') return [];
  return [
    { name: 'trump:truth', tier: 1, kind: 'politics', intervalMs: 120000, run: runTruth },
    { name: 'trump:news', tier: 2, kind: 'politics', intervalMs: 300000, run: runNews },
  ];
}

module.exports = { make, _internals: { parseRssItems, stripHtml, cleanTitle, passesNoiseFilter, extractArticleDate, decodeBatchResponse } };
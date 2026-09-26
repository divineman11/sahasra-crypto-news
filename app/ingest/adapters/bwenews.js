"use strict";

const http = require("../http");
const { BROWSER_UA } = require("../config");

const NAME = "tg:bwenews";
const PAGE_URL = "https://t.me/s/BWEnews";
const INTERVAL_MS = 30000;

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function stripTags(s) {
  return s.replace(/<[^>]*>/g, "");
}

function collapseWhitespace(s) {
  return s.replace(/\s+/g, " ").trim();
}

function extractText(segment) {
  const seg = segment.replace(/<a[^>]*class="[^"]*tgme_widget_message_reply[^"]*"[\s\S]*?<\/a>/g, "");
  let m = seg.match(/<[^>]*class="[^"]*tgme_widget_message_text[^"]*js-message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  if (!m) {
    m = seg.match(/<[^>]*class="[^"]*tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    if (m && /js-message_reply_text/.test(m[0])) m = null;
  }
  if (!m) return "";
  const inner = m[1]
    .replace(/<br\s*\/?>/gi, " \n ")
    .replace(/<[^>]*>/g, "");
  return collapseWhitespace(decodeEntities(inner));
}

function extractLinks(segment) {
  const out = [];
  const seen = new Set();
  const re = /href="(https:\/\/[^"]+)"/g;
  let m;
  while ((m = re.exec(segment)) !== null) {
    let href = m[1];
    try {
      const u = new URL(href);
      const host = u.hostname.toLowerCase();
      if (host === "t.me" || host.endsWith(".t.me") || host === "telegram.org" || host.endsWith(".telegram.org")) continue;
    } catch (e) {
      continue;
    }
    if (!seen.has(href)) {
      seen.add(href);
      out.push(href);
    }
  }
  return out;
}

function parseBwenews(html) {
  if (!html || !html.trim()) return [];
  const segments = html.split('data-post="').slice(1);
  const messages = [];
  for (const raw of segments) {
    const idPart = raw.slice(0, raw.indexOf('"'));
    if (!idPart || idPart.indexOf("/") === -1) continue;
    const id = idPart;

    const timeMatch = raw.match(/<time[^>]*datetime="([^"]+)"/);
    let publishedAt;
    if (timeMatch) publishedAt = new Date(timeMatch[1]);
    if (!timeMatch || !publishedAt || isNaN(publishedAt.getTime())) continue;

    const text = extractText(raw);
    const links = extractLinks(raw);

    messages.push({
      id,
      url: "https://t.me/" + id,
      publishedAt,
      text,
      links,
    });
  }
  if (messages.length === 0) {
    throw new Error("bwenews: no messages parsed");
  }
  return messages;
}

function makeTitle(text) {
  let t = text;

  // cut at first CJK char occurring after position 15
  const cjk = /[\u3400-\u9FFF\uF900-\uFAFF]/;
  for (let i = 15; i < t.length; i++) {
    if (cjk.test(t[i])) {
      t = t.slice(0, i);
      break;
    }
  }

  const eqIdx = t.indexOf(" 方程式");
  if (eqIdx !== -1) t = t.slice(0, eqIdx);

  t = t.trim();
  if (/^BWENEWS:/i.test(t)) t = t.replace(/^BWENEWS:/i, "").trim();

  if (t.length > 240) t = t.slice(0, 240);
  return t.trim();
}

const GATING_RE = /\b(hack(ed|s)?|exploit(ed|s)?|drain(ed|s)?|stolen|breach|attack(er|ed)?|compromised|SEC|CFTC|DOJ|lawsuit|charged|indict|delist(s|ed|ing)?|will list|lists|listing|launch(es|ed)?|halt(s|ed)?|pause[ds]?|suspend(s|ed)?|outage|ETF|liquidat\w*|bankrupt\w*|insolven\w*|freeze|frozen|depeg\w*|withdrawals?)\b/i;
const DISCARD_RE = /BWENEWS AI|No Accuracy Guaranteed/i;

function messageToItem(msg) {
  if (DISCARD_RE.test(msg.text) && !(Array.isArray(msg.links) && msg.links.length >= 1)) return null;

  const title = makeTitle(msg.text);
  if (!title) return null;
  if (!GATING_RE.test(title)) return null;

  return {
    sourceName: NAME,
    sourceTier: 2,
    kind: "news",
    exchange: null,
    title,
    url: msg.url,
    publishedAt: msg.publishedAt,
    hintCategory: null,
    hintTickers: [],
  };
}

async function run(ctx) {
  const res = await http.request(PAGE_URL, {
    ua: BROWSER_UA,
    timeoutMs: 15000,
  });
  if (res.status !== 200) {
    throw new Error("bwenews: unexpected status " + res.status);
  }
  const messages = parseBwenews(res.text);

  const items = [];
  for (const msg of messages) {
    const item = messageToItem(msg);
    if (item) items.push(item);
  }
  return items;
}

function make() {
  return {
    name: NAME,
    tier: 2,
    intervalMs: INTERVAL_MS,
    run,
  };
}

module.exports = { make, parseBwenews };
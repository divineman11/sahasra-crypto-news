'use strict';

// Official project sources (): one adapter per entry in officialSources.json.
//   github -> GitHub releases Atom feed, stable releases only, interval 30 min
//   forum  -> Discourse governance forum latest.rss, governance-looking topics only, interval 30 min, alertable:false
//   blog   -> plain project-blog RSS, interval 30 min
//
// Unverified sources (verified:false, i.e. not yet confirmed live by the operator) are marked
// `quietHealth: true` on the returned adapter. scheduler.js reads that flag itself (in
// _backoffUntil) to back a persistently-failing one off to <=1/6h once it has failed
// `quietFailThreshold` (default 6) times in a row; health.js reads the same flag only to suppress
// Discord health alerts for it (log-only) — see the fix-round review (B1) for why
// the once-per-6h policy itself must live in the scheduler and not be re-derived from a
// health-check-side timer (a race between the two backoff computations could undo it for hours).

const fs = require('fs');
const path = require('path');
const Parser = require('rss-parser').Parser || require('rss-parser');
const { request } = require('../http');

const SOURCES_FILE = path.join(__dirname, '..', 'officialSources.json');
const INTERVAL_MS = 30 * 60000;
const SEVEN_D = 7 * 86400000;
const MAX_ITEMS = 20;
// a GitHub repo's releases.atom mixes stable tags with CI/nightly/testnet
// tags that don't even look "unstable" by name (sui_v1.82.0_1790353319_ci, v0.34.2-mocha,
// 3.4.0-b3, 11.0.1-docker, crates-0.37.1, master-with-ledger-fix, aptos-cli-*, move-flow-*, ...).
// A GitHub repo therefore very rarely has more than a couple of genuinely stable releases inside
// any 30-min poll window, so the cap is lowered from 20 (shared with forum/blog) to 5.
const GITHUB_MAX_ITEMS = 5;

// Applied to the release TAG (short, machine-generated version string: "v1.3.0-rc1", "nightly").
// Anchored on non-letter boundaries rather than \b so that /i's case-folding of the character
// class also excludes uppercase (F4, review): a marker glued onto a version number still
// matches ("v1.3.0-rc1"), but a marker that's merely a substring of an unrelated word doesn't
// ("source-1.0", "arch-v1.2", "latest" all keep).
const TAG_UNSTABLE_RE = /(^|[^a-z])(rc\d*|beta|alpha|pre(view|release)?|nightly|test(net|ing)?|dev(net)?)([^a-z]|$)/i;
// Applied to the release TITLE (free text, can legitimately contain "prepare"/"predictive"/etc.)
// with word boundaries so normal prose doesn't get caught; also catches the spelled-out
// "Release Candidate" (F4, review).
const TITLE_UNSTABLE_RE = /\b(rc\d*|release candidates?|beta|alpha|pre(view|release)?|nightly|test(net|ing)?|dev(net)?)\b/i;

// every term \b-bounded so e.g. "AIP" can't substring-match inside "Taipei", or
// "vote" inside "Devoted", or "grant" inside "Immigrant". The old generic `\[.*\]` (any brackets
// anywhere) is replaced with `^\[[^\]]+\]` — only a LEADING bracketed tag counts ("[ARFC] ..."),
// not one appearing later in an otherwise off-topic title ("Introduce yourself [new members]").
const GOVERNANCE_RE = /\b(proposals?|AIP|ARFC|DRC|delist(ing)?|temp(erature)? check|snapshot|votes?|voting|onchain|upgrades?|treasury|grants?|parameters?|RFC|request for comment)\b|^\[[^\]]+\]/i;

function loadSources(file = SOURCES_FILE) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = Array.isArray(parsed) ? parsed : parsed.sources;
  return Array.isArray(list) ? list : [];
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (e) {
    return '';
  }
}

function adapterName(entry) {
  if (entry.type === 'github') {
    const m = String(entry.url).match(/github\.com\/([^/]+)\/([^/]+)\/releases\.atom/i);
    return m ? 'gh:' + m[1] + '/' + m[2] : 'gh:' + hostOf(entry.url);
  }
  if (entry.type === 'forum') return 'forum:' + hostOf(entry.url);
  return 'blog:' + hostOf(entry.url);
}

// a tag can itself contain a slash (optimism's per-component releases,
// e.g. "op-batcher/v1.17.0"). The atom feed's <link> always percent-encodes it (.../releases/tag/
// op-batcher%2Fv1.17.0), but GitHub's own /releases/latest Location header uses a literal slash
// (.../releases/tag/op-batcher/v1.17.0) — the old `[^/?#]+` capture stopped at that first slash,
// so tagOf() returned "op-batcher" for the Location header vs "op-batcher/v1.17.0" (decoded) for
// the atom entry: they could never compare equal, and the adapter emitted nothing for any repo
// with slash-shaped tags. Capture the whole rest of the path (up to a query/fragment) and
// decodeURIComponent it either way, so both forms normalise to the same string.
function tagOf(link) {
  const m = String(link || '').match(/\/releases\/tag\/([^?#]+)/);
  if (m) return decodeURIComponent(m[1]);
  const parts = String(link || '').split('/').filter(Boolean);
  return parts.length ? decodeURIComponent(parts[parts.length - 1]) : '';
}

function isUnstableRelease(tag, title) {
  return (tag && TAG_UNSTABLE_RE.test(tag)) || (title && TITLE_UNSTABLE_RE.test(title));
}

// fallback-only strict tag shape, used when GitHub's own
// /releases/latest redirect can't be read (network/5xx/no Location). A CI/component/misc tag
// (sui_v1.82.0_<epoch>_ci, v0.34.2-mocha, 3.4.0-b3, 11.0.1-docker, master-with-ledger-fix,
// crates-0.37.1, nearcore's crates-0.37.x) does not have this shape and is dropped; a real
// (possibly prefixed/suffixed) stable version tag does: v1.17.6, aptos-node-v1.49.1-hotfix,
// op-node/v1.19.8, v2026.04-1. NOTE: this intentionally also drops a tag like
// polkadot-stable2606-2 (no "." at all) in the fallback path — acceptable there since the
// fallback only runs when GitHub's own /latest redirect (the primary, more precise signal)
// could not be read at all.
const STRICT_TAG_RE = /^(?:[a-z][a-z0-9-]*[-_/])?v?\d+(?:\.\d+){1,3}(?:-(?:hotfix|\d+))?$/i;
// nearcore's crates-0.37.1 has the STRICT_TAG_RE shape (a fully-numeric version after a
// "word-"-shaped prefix) but is a per-crate publish tag, not the project's own release — explicit
// deny since the generic prefix group alone can't tell "crates-" apart from a real project prefix.
const CRATES_PREFIX_RE = /^crates-/i;

function isStrictStableTag(tag) {
  if (!tag) return false;
  if (CRATES_PREFIX_RE.test(tag)) return false;
  return STRICT_TAG_RE.test(tag);
}

function githubLatestUrl(atomUrl) {
  return String(atomUrl).replace(/releases\.atom(?:[?#].*)?$/, 'releases/latest');
}

// B1: read GitHub's own "which release is current" signal — /releases/latest redirects (302) to
// /releases/tag/<tag> of the newest release that is neither a prerelease nor a draft. Requested
// with followRedirects:false so we read the Location header instead of downloading the target
// page. Returns the tag, or null if the request failed or didn't look like a proper redirect
// (network error, 5xx, unexpected 200, missing Location) — the caller then falls back to
// isStrictStableTag() over the atom feed.
async function fetchLatestReleaseTag(atomUrl) {
  try {
    const res = await request(githubLatestUrl(atomUrl), { followRedirects: false, timeoutMs: 30000 });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers && typeof res.headers.get === 'function' ? res.headers.get('location') : null;
      if (loc) return tagOf(loc);
    }
    return null;
  } catch (e) {
    return null;
  }
}

// The atom feed only carries the newest ~10 tags; busy repos push the real stable release out of it.
// Ask the REST API for the latest release (unauthenticated, 60 req/h; only called on a feed miss).
function githubApiLatestUrl(atomUrl) {
  const m = /github\.com\/([^/]+)\/([^/]+)\/releases\.atom/.exec(String(atomUrl));
  return m ? `https://api.github.com/repos/${m[1]}/${m[2]}/releases/latest` : null;
}
async function fetchApiLatestRelease(atomUrl) {
  const url = githubApiLatestUrl(atomUrl);
  if (!url) return null;
  try {
    const res = await request(url, { timeoutMs: 30000, headers: { accept: 'application/vnd.github+json' } });
    if (res.status !== 200) return null;
    const j = typeof res.json === 'function' ? res.json() : JSON.parse(res.text);
    if (!j || !j.tag_name || !j.published_at) return null;
    return j;
  } catch (e) {
    return null;
  }
}

function releaseTitle(projectName, rawTitle) {
  const t = String(rawTitle || '').trim();
  if (!projectName) return t;
  const has = t.toLowerCase().indexOf(String(projectName).toLowerCase()) !== -1;
  return has ? t : (projectName + ' ' + t).trim();
}

function parseDate(it) {
  const d = new Date(it.isoDate || it.pubDate || '');
  return isNaN(d.getTime()) ? null : d;
}

function capAndSort(items, limit = MAX_ITEMS) {
  items.sort((a, b) => b.publishedAt - a.publishedAt);
  items.length = Math.min(items.length, limit);
  return items;
}

function makeGithubAdapter(entry) {
  const name = adapterName(entry);
  const domain = hostOf(entry.url);
  const parser = new Parser({ timeout: 15000 });
  async function run() {
    const res = await request(entry.url, { conditional: true, timeoutMs: 30000 });
    if (res.notModified || res.status === 304) return [];
    const parsed = await parser.parseString(res.text);
    const cutoff = Date.now() - SEVEN_D;
    // Parsed and 7-day-cutoff-filtered, but not yet stability-filtered — the primary path below
    // needs the raw candidates (incl. otherwise-"unstable-looking" ones GitHub itself picked as
    // latest) to match against the /releases/latest tag; only the fallback path applies a tag
    // shape filter ahead of time.
    const candidates = [];
    const feedTags = new Set();
    for (const it of parsed.items || []) {
      const rawTitle = String(it.title || '').trim();
      const url = String(it.link || '').trim();
      if (!rawTitle || !url) continue;
      feedTags.add(tagOf(url));
      const publishedAt = parseDate(it);
      if (!publishedAt || publishedAt.getTime() < cutoff) continue;
      candidates.push({ tag: tagOf(url), rawTitle, url, publishedAt });
    }

    const buildItem = (c) => ({
      sourceName: name,
      sourceTier: 3,
      kind: 'official',
      exchange: null,
      title: releaseTitle(entry.name, c.rawTitle),
      url: c.url,
      publishedAt: c.publishedAt,
      hintCategory: null,
      hintTickers: [entry.base],
      sourceDomain: domain,
    });

    // B1: primary path — GitHub's own /releases/latest redirect names the exact tag it considers
    // current (newest non-prerelease, non-draft release). Keep only the one atom entry whose tag
    // equals it (belt-and-braces: still drop it if isUnstableRelease somehow still flags it), so a
    // poll never emits more than one item. If GitHub named a tag that isn't even in the atom feed
    // (window/pagination edge case), emit nothing rather than guessing.
    const latestTag = await fetchLatestReleaseTag(entry.url);
    if (latestTag !== null) {
      let match = candidates.find((c) => c.tag === latestTag);
      if (!match) {
        if (feedTags.has(latestTag)) return []; // the latest release is in the feed, just older than 7 days — nothing to fetch
        const rel = await fetchApiLatestRelease(entry.url);
        if (!rel || rel.tag_name !== latestTag || rel.prerelease || rel.draft) return [];
        const publishedAt = new Date(rel.published_at);
        if (isNaN(publishedAt.getTime()) || publishedAt.getTime() < cutoff) return [];
        match = { tag: rel.tag_name, rawTitle: String(rel.name || rel.tag_name).trim(), url: String(rel.html_url || '').trim() || (githubLatestUrl(entry.url).replace(/\/latest$/, '/tag/') + rel.tag_name), publishedAt };
      }
      if (isUnstableRelease(match.tag, match.rawTitle)) return [];
      return [buildItem(match)];
    }

    // Fallback: the /latest request failed (network/5xx/no Location) — filter the atom feed
    // itself by a strict tag shape (drops CI/component/misc tags a plain unstable-word regex
    // wouldn't catch), plus isUnstableRelease as belt-and-braces.
    const items = [];
    for (const c of candidates) {
      if (!isStrictStableTag(c.tag)) continue;
      if (isUnstableRelease(c.tag, c.rawTitle)) continue;
      items.push(buildItem(c));
    }
    return capAndSort(items, GITHUB_MAX_ITEMS);
  }
  return { name, tier: 3, intervalMs: INTERVAL_MS, quietHealth: entry.verified !== true, run };
}

function makeForumAdapter(entry) {
  const name = adapterName(entry);
  const domain = hostOf(entry.url);
  const parser = new Parser({ timeout: 15000 });
  async function run() {
    const res = await request(entry.url, { conditional: true, timeoutMs: 30000 });
    if (res.notModified || res.status === 304) return [];
    const parsed = await parser.parseString(res.text);
    const cutoff = Date.now() - SEVEN_D;
    const items = [];
    for (const it of parsed.items || []) {
      const title = String(it.title || '').trim();
      const url = String(it.link || '').trim();
      if (!title || !url) continue;
      if (!GOVERNANCE_RE.test(title)) continue;
      const publishedAt = parseDate(it);
      if (!publishedAt || publishedAt.getTime() < cutoff) continue;
      items.push({
        sourceName: name,
        sourceTier: 3,
        kind: 'official',
        exchange: null,
        title,
        url,
        publishedAt,
        hintCategory: null,
        hintTickers: [entry.base],
        sourceDomain: domain,
        alertable: false,
      });
    }
    return capAndSort(items);
  }
  return { name, tier: 3, intervalMs: INTERVAL_MS, quietHealth: entry.verified !== true, run };
}

function makeBlogAdapter(entry) {
  const name = adapterName(entry);
  const domain = hostOf(entry.url);
  const parser = new Parser({ timeout: 15000 });
  async function run() {
    const res = await request(entry.url, { conditional: true, timeoutMs: 30000 });
    if (res.notModified || res.status === 304) return [];
    const parsed = await parser.parseString(res.text);
    const cutoff = Date.now() - SEVEN_D;
    const items = [];
    for (const it of parsed.items || []) {
      const title = String(it.title || '').trim();
      const url = String(it.link || '').trim();
      if (!title || !url) continue;
      const publishedAt = parseDate(it);
      if (!publishedAt || publishedAt.getTime() < cutoff) continue;
      items.push({
        sourceName: name,
        sourceTier: 3,
        kind: 'official',
        exchange: null,
        title,
        url,
        publishedAt,
        hintCategory: null,
        hintTickers: [entry.base],
        sourceDomain: domain,
      });
    }
    return capAndSort(items);
  }
  return { name, tier: 3, intervalMs: INTERVAL_MS, quietHealth: entry.verified !== true, run };
}

function make({ sources = loadSources() } = {}) {
  const adapters = [];
  for (const entry of sources) {
    if (!entry || !entry.url || !entry.base) continue;
    if (entry.type === 'github') adapters.push(makeGithubAdapter(entry));
    else if (entry.type === 'forum') adapters.push(makeForumAdapter(entry));
    else adapters.push(makeBlogAdapter(entry));
  }
  return adapters;
}

module.exports = {
  make,
  loadSources,
  adapterName,
  tagOf,
  isUnstableRelease,
  releaseTitle,
  TAG_UNSTABLE_RE,
  TITLE_UNSTABLE_RE,
  GOVERNANCE_RE,
  // B1
  STRICT_TAG_RE,
  isStrictStableTag,
  githubLatestUrl,
  githubApiLatestUrl,
  fetchLatestReleaseTag,
  GITHUB_MAX_ITEMS,
};
// Pure favicon-URL helper for the small publisher favicon shown before the source name in
// FeedRow — Google's public s2 favicon service, keyed only by hostname (no fetch/cache on our
// side, nothing stored).
//
// Plain CommonJS (no TS syntax), same pattern as sourceTab.js / mediaThumb.js next to it: it loads
// unmodified both from the Next.js app (via allowJs + faviconUrl.d.ts) and from the Node test
// suites (`require(APP + '/src/lib/faviconUrl.js')`).

// A conservative hostname check: one or more dot-separated labels, each 1-63 chars of
// alphanumeric/hyphen not starting or ending with a hyphen. Rejects "", whitespace-only strings,
// bare words with no dot ("localhost"-style), and anything carrying a scheme/path ("http://x.com",
// "x.com/path") — s2's `domain` param wants a bare host, not a URL.
const HOSTNAME_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;

/**
 * @param {string|null|undefined} domain a bare hostname, e.g. "coindesk.com". For a gnews:* post
 *   this is the post's own `sourceDomain` — the publisher host the article actually came from
 *   (already what ingest stores there), not news.google.com.
 * @returns {string|null} a Google s2 favicon URL (32px source, rendered at 14x14), or null when
 *   `domain` is empty/invalid.
 */
function faviconUrl(domain) {
  if (typeof domain !== 'string') return null;
  const d = domain.trim().toLowerCase();
  if (!d || !HOSTNAME_RE.test(d)) return null;
  return 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(d) + '&sz=32';
}

module.exports = { faviconUrl };

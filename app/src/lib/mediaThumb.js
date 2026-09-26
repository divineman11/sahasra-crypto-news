// Pure YouTube-thumbnail helper for the coin-page Media tab and PostDetail — no schema change:
// the thumbnail is derived from the post's own `url` at render time, never stored.
//
// Plain CommonJS (no TS syntax), same pattern as sourceTab.js next to it: it loads unmodified
// both from the Next.js app (via allowJs + mediaThumb.d.ts) and from the Node test suites
// (`require(APP + '/src/lib/mediaThumb.js')`).

/**
 * Extracts a YouTube video id from a watch/youtu.be URL, or null for anything else
 * (including malformed URLs, YouTube channel/playlist links, and non-YouTube URLs).
 * @param {string|null|undefined} url
 * @returns {string|null}
 */
function extractYouTubeId(url) {
  if (!url) return null;
  let u;
  try {
    u = new URL(String(url));
  } catch (e) {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  if (host === 'youtu.be') {
    const id = u.pathname.replace(/^\//, '').split('/')[0];
    return id || null;
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') {
      const id = u.searchParams.get('v');
      return id || null;
    }
  }
  return null;
}

/**
 * @param {string|null|undefined} url a post's url
 * @returns {string|null} the i.ytimg.com mqdefault thumbnail url, or null when `url` isn't a
 *   recognisable YouTube watch/youtu.be link.
 */
function mediaThumb(url) {
  const id = extractYouTubeId(url);
  return id ? 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg' : null;
}

module.exports = { mediaThumb, extractYouTubeId };

// Shared, pure classifier for the coin-page source tabs (News / Exchange / Official / Social / Media)
// and for the "hide low-importance tier-4 sources" feed toggle.
//
// Plain CommonJS (no TS syntax) so it loads unmodified both from the Next.js app (via allowJs +
// the sourceTab.d.ts type declarations next to this file) and from the Node test suites
// (`require(APP + '/src/lib/sourceTab.js')`), keeping exactly one implementation of these rules.
//
// Kept in sync with app/src/app/api/coin/[ticker]/route.ts, which translates the same rules into
// a Prisma `where` clause (see the comment there for why).

/**
 * @param {{kind?: string|null, sourceName?: string|null}} post
 * @returns {'news'|'exchange'|'official'|'social'|'media'}
 */
function sourceTab(post) {
  const kind = (post && post.kind) || "";
  const sourceName = (post && post.sourceName) || "";

  if (kind === "media") return "media";
  if (kind === "social") return "social";
  if (kind === "official" || kind === "blog" || sourceName.startsWith("blog:")) return "official";
  if (kind === "exchange" || kind === "symbol") return "exchange";
  return "news";
}

/**
 * True when a post should be hidden by the main feed's "Hide low-importance" toggle: any tier-4
 * source (Google News per-coin search, YouTube, Reddit, the whale_alert_io wire — anything the
 * ingest side marks sourceTier:4) whose importance is below 30. Tier-4 is a volume-vs-precision
 * tradeoff by construction (per-coin search recall, aggregator noise), unlike tiers 1-3, so a
 * single sourceTier check covers every present and future tier-4 adapter without listing sources
 * by name.
 *
 * `hideLowImportanceGnews` is kept as an alias (same function) for backward compatibility with
 * any other caller/import of the old name — the predicate itself was generalised in the step 7
 * review (F2) from "sourceName starts with gnews:" to "sourceTier === 4", since the same
 * feed-noise problem applies equally to Media/Social tab volume.
 * @param {{sourceTier?: number|null, importance?: number|null}} post
 * @returns {boolean}
 */
function hideLowImportanceTier4(post) {
  const sourceTier = post && typeof post.sourceTier === "number" ? post.sourceTier : null;
  const importance = post && typeof post.importance === "number" ? post.importance : 0;
  return sourceTier === 4 && importance < 30;
}

const hideLowImportanceGnews = hideLowImportanceTier4;

const SOURCE_TABS = ["news", "exchange", "official", "social", "media"];

module.exports = { sourceTab, hideLowImportanceTier4, hideLowImportanceGnews, SOURCE_TABS };

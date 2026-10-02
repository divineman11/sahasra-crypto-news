'use strict';
// evidence meter: secular, rule-based. Inputs only: source quality, corroboration, timestamp, uncertainty.
const { etClock } = require('./timeET');

const PRIMARY_KINDS = new Set(['exchange', 'official', 'regulator', 'symbol']);
const SOCIAL_KINDS = new Set(['social', 'media']);

function isGnews(sourceName) {
  return String(sourceName || '').startsWith('gnews:');
}

// A timeline entry's source facts, derived once from the post.
function sourceInfo(post) {
  const kind = post.kind || 'news';
  return {
    src_kind: kind,
    tier: Number(post.sourceTier) || 4,
    domain: post.sourceDomain || post.sourceName || 'unknown',
    primary: PRIMARY_KINDS.has(kind),
    social: SOCIAL_KINDS.has(kind),
    gnews: isGnews(post.sourceName),
  };
}

function plural(n, w) {
  return `${n} ${w}${n === 1 ? '' : 's'}`;
}

/**
 * @param timeline entries with { ts, kind, src_kind, tier, domain, primary, social, gnews }
 * @param facts    event facts (per_source_pct, exchange)
 * @returns { level, reason, sources, primary, latest_ts }
 */
function compute(timeline, facts) {
  const entries = (timeline || []).filter((e) => e.kind !== 'price');
  const domains = new Set(entries.map((e) => e.domain));
  const prim = entries.filter((e) => e.primary);
  const primDomains = new Set(prim.map((e) => e.domain));
  const others = [...domains].filter((d) => !primDomains.has(d));
  const denial = entries.some((e) => e.kind === 'denial');
  const latest = entries.reduce((m, e) => (Date.parse(e.ts) > m ? Date.parse(e.ts) : m), 0);
  const latest_ts = latest ? new Date(latest).toISOString() : null;
  const when = latest ? `last confirmed ${etClock(latest)}` : 'no timestamp';
  const publisher12 = entries.some((e) => e.tier <= 2 && !e.social && !e.gnews && !e.primary);
  const exchangeOnly = entries.length > 0 && entries.every((e) => e.src_kind === 'exchange');
  const first = prim[0];
  const primLabel = first
    ? (first.src_kind === 'exchange' ? `${(facts && facts.exchange) || first.domain} announcement`
      : first.src_kind === 'regulator' ? `${first.domain} statement`
      : first.src_kind === 'symbol' ? `${first.domain} market notice`
      : `${first.domain} official post`)
    : null;

  let level, reason;
  if (denial) {
    level = 'Limited';
    reason = `Limited — a denial or correction is present, ${when}`;
  } else if (prim.length > 0 && domains.size >= 2) {
    level = 'Strong';
    reason = others.length > 0
      ? `Strong — ${primLabel} + ${plural(others.length, 'news source')}, ${when}`
      : `Strong — ${primLabel} + ${plural(primDomains.size - 1, 'more primary source')}, ${when}`;
  } else if (prim.length > 0) {
    level = 'Moderate';
    reason = exchangeOnly ? `Moderate — ${primLabel} only, ${when}` : `Moderate — ${primLabel}, single source, ${when}`;
  } else if (publisher12) {
    level = 'Moderate';
    const d = entries.find((e) => e.tier <= 2 && !e.social && !e.gnews);
    reason = `Moderate — ${d.domain} report${others.length > 1 ? ` + ${plural(others.length - 1, 'more source')}` : ''}, no official confirmation yet, ${when}`;
  } else {
    level = 'Limited';
    const d = entries[0];
    const what = d && d.social ? 'social/media item' : d && d.gnews ? 'aggregator item' : 'unverified item';
    reason = `Limited — ${plural(domains.size, 'source')} (${what}), no official confirmation yet, ${when}`;
  }
  return { level, reason, sources: domains.size, primary: prim.length > 0, latest_ts };
}

module.exports = { compute, sourceInfo };

function serializePost(p) {
  const instruments = (p.instruments || [])
    .map((i) => ({ ticker: i.ticker, name: i.name }))
    .sort((a, b) => (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0));
  const votes = p.votes
    ? {
        bullish: p.votes.bullish,
        bearish: p.votes.bearish,
        important: p.votes.important,
        toxic: p.votes.toxic,
      }
    : { bullish: 0, bearish: 0, important: 0, toxic: 0 };
  return {
    id: p.id,
    title: p.title,
    url: p.url,
    sourceDomain: p.sourceDomain,
    publishedAt: new Date(p.publishedAt).toISOString(),
    createdAt: new Date(p.createdAt).toISOString(),
    firstSeenAt: p.firstSeenAt
      ? new Date(p.firstSeenAt).toISOString()
      : new Date(p.createdAt).toISOString(),
    kind: p.kind,
    sentiment: p.sentiment,
    sourceName: p.sourceName || "unknown",
    sourceTier: p.sourceTier ?? 4,
    category: p.category || "other",
    importance: p.importance ?? 20,
    exchange: p.exchange ?? null,
    storyId: p.storyId ?? p.id,
    announcementSeenAt: p.announcementSeenAt
      ? new Date(p.announcementSeenAt).toISOString()
      : null,
    symbolSeenAt: p.symbolSeenAt
      ? new Date(p.symbolSeenAt).toISOString()
      : null,
    userLabel: p.userLabel ?? null,
    ret1m: p.ret1m ?? null,
    ret5m: p.ret5m ?? null,
    ret15m: p.ret15m ?? null,
    moved5m: p.moved5m ?? null,
    priceStatus: p.priceStatus || "na",
    instruments,
    votes,
  };
}

module.exports = { serializePost };
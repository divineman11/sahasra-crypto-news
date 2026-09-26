import type { PostDTO, Votes } from "./types";

interface PrismaPostWithRelations {
  id: string;
  title: string;
  url: string;
  sourceDomain: string;
  publishedAt: Date | string;
  createdAt: Date | string;
  firstSeenAt?: Date | string | null;
  announcementSeenAt?: Date | string | null;
  symbolSeenAt?: Date | string | null;
  kind: string;
  sentiment: string;
  sourceName?: string | null;
  sourceTier?: number | null;
  category?: string | null;
  importance?: number | null;
  exchange?: string | null;
  storyId?: string | null;
  userLabel?: string | null;
  ret1m?: number | null;
  ret5m?: number | null;
  ret15m?: number | null;
  moved5m?: boolean | null;
  priceStatus?: string | null;
  instruments: { ticker: string; name: string }[];
  votes: {
    bullish: number;
    bearish: number;
    important: number;
    toxic: number;
  } | null;
}

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return new Date(value).toISOString();
}

export function serializePost(p: PrismaPostWithRelations): PostDTO {
  const instruments = [...(p.instruments ?? [])]
    .map((i) => ({ ticker: i.ticker, name: i.name }))
    .sort((a, b) => (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0));

  const votes: Votes = p.votes
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
    firstSeenAt: toIsoOrNull(p.firstSeenAt ?? p.createdAt) as string,
    kind: p.kind as PostDTO["kind"],
    sentiment: p.sentiment as PostDTO["sentiment"],
    sourceName: p.sourceName ?? "unknown",
    sourceTier: p.sourceTier ?? 4,
    category: (p.category ?? "other") as PostDTO["category"],
    importance: p.importance ?? 20,
    exchange: p.exchange ?? null,
    storyId: p.storyId ?? p.id,
    announcementSeenAt: toIsoOrNull(p.announcementSeenAt),
    symbolSeenAt: toIsoOrNull(p.symbolSeenAt),
    userLabel: (p.userLabel ?? null) as PostDTO["userLabel"] | null,
    ret1m: p.ret1m ?? null,
    ret5m: p.ret5m ?? null,
    ret15m: p.ret15m ?? null,
    moved5m: p.moved5m ?? null,
    priceStatus: p.priceStatus ?? "na",
    instruments,
    votes,
  };
}
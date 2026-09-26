export type Sentiment = "bullish" | "bearish" | "neutral";
export type Kind = "news" | "exchange" | "regulator" | "symbol" | "media" | "blog" | "official" | "social";
export type VoteType = "bullish" | "bearish" | "important" | "toxic";
export type FilterKey = "all" | "hot" | "rising" | "bullish" | "bearish" | "exchange" | "important" | "saved";
export type Category = "listing" | "delisting" | "hack" | "etf" | "regulatory" | "maintenance" | "other";
export type UserLabel = "catalyst" | "dismiss";

export interface Votes {
  bullish: number;
  bearish: number;
  important: number;
  toxic: number;
}

export interface PostDTO {
  id: string;
  title: string;
  url: string;
  sourceDomain: string;
  publishedAt: string; // ISO 8601
  createdAt: string; // ISO 8601
  kind: Kind;
  sentiment: Sentiment;
  instruments: { ticker: string; name: string }[];
  votes: Votes; // zeros if VoteData row missing
  firstSeenAt: string;
  sourceName: string;
  sourceTier: number;
  category: Category;
  importance: number;
  exchange: string | null;
  storyId: string | null;
  announcementSeenAt: string | null;
  symbolSeenAt: string | null;
  userLabel: UserLabel | null;
  ret1m: number | null;
  ret5m: number | null;
  ret15m: number | null;
  moved5m: boolean | null;
  priceStatus: string;
}
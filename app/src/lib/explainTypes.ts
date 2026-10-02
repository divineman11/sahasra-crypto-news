// Mirrors one ExplainEvent object written by app/ingest/explain/events.js (spec section 3.1).
export type ExplainDir = "down" | "up" | "chop";

export interface ExplainScenario {
  dir: ExplainDir;
  title: string;
  timeframe: string;
  condition: string;
  evidence: string;
  base_rate: { x: number; n: number; measure: string } | null;
}

export interface ExplainRestriction {
  kind: "withdrawals_paused" | "trading_halt" | "delist_date" | "decision_deadline";
  detail: string;
  when_et: string | null;
}

export interface ExplainTimelineRow {
  ts: string;
  kind: "first" | "update" | "confirmation" | "denial" | "price";
  source: string;
  title: string;
  url: string;
  post_id: string;
}

export interface ExplainEvidence {
  level: "Strong" | "Moderate" | "Limited";
  reason: string;
  sources: number;
  primary: boolean;
  latest_ts: string | null;
}

export interface ExplainHistoryCase {
  date: string;
  coin: string | null;
  headline: string;
  r1: number | null;
  r7: number | null;
  r30: number | null;
}

export interface ExplainEvent {
  id: string;
  rev: number;
  created_at: string;
  updated_at: string;
  state: "live" | "queued" | "closed";
  category: string;
  subtype: string | null;
  sentiment: "bearish" | "bullish" | "neutral";
  coin: { ticker: string; name: string } | null;
  topic: string | null;
  exchange: string | null;
  facts: {
    headline: string;
    source: string | null;
    source_tier: number;
    url: string | null;
    published_at: string | null;
    restrictions: ExplainRestriction[];
    [k: string]: unknown;
  };
  text: {
    what: string;
    why: string;
    scenarios: ExplainScenario[];
    tradeoffs: string;
    affected: { who: string; how: string }[];
    watch: { label: string; detail: string }[];
    uncertain: string[];
    source: "template" | "rewrite";
    rewriteInfo: unknown;
  };
  evidence: ExplainEvidence;
  heat: { level: "high" | "normal" | null; range_24h_pct: number | null; checked_at?: string };
  last_change?: { rev: number; at: string; text: string } | null;
  history: { cases: ExplainHistoryCase[]; note: string | null };
  timeline: ExplainTimelineRow[];
  post_ids: string[];
  glossary: string[];
}

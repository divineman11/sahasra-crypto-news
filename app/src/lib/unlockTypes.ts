// Mirrors ingest/unlocks/view.json (written by the collector, see ingest/unlocks/aggregate.js buildView).
export interface UnlockDisagree {
  minPct: number;
  maxPct: number;
  badge: string;
  perSourcePct: Record<string, number>;
}

export interface UnlockItem {
  id: string;
  symbol: string;
  name: string;
  ts: number; // unix seconds
  tokens: number | null;
  pctCirc: number | null;
  categories: string[];
  sources: string[];
  nParts: number;
  supplyShock: boolean;
  disagree: UnlockDisagree | null;
  justUnlocked: boolean;
}

export interface UnlockMissing { symbol: string; name: string; lockedPct: number }
export interface UnlockAnniversary { symbol: string; name: string; months: number; days: number; ts: number; lockedPct: number }

export interface CrosscheckItem {
  kind: "missing" | "undercounted";
  symbol: string;
  date: string;
  pct: number | null;
  ourPct: number | null;
  tokens: number | null;
  source: string;
  note: string;
}

export interface UnlockView {
  generatedAt: number;
  upcoming: UnlockItem[];
  missing: UnlockMissing[];
  anniversaries: UnlockAnniversary[];
  crosscheck: { enabled: boolean; lastRunAt: number; lastOkAt: number; lastError: string | null; items: CrosscheckItem[] } | null;
  sources: Record<string, { lastOkAt: number; lastError: string | null; lastErrorAt: number; fails: number; count: number }>;
}

export interface SetupFeature {
  id: string;
  label: string;
  important: boolean;
  state: "on" | "off" | "warn";
  detail: string;
  fix: string | null;
}

export interface SetupStatus {
  generatedAt: number;
  features: SetupFeature[];
  sourcesFailed: { name: string; error: string; at: number }[];
  attention: { id: string; state: string; message: string }[];
  needsAttention: boolean;
  setupUrl: string;
}

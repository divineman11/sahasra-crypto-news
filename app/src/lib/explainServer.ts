import fs from "fs";
import path from "path";
import type { ExplainEvent } from "./explainTypes";

// Server-side reader for app/ingest/cache/explain/events.json (written atomically by the collector).
// Read on request with an mtime cache: no polling, no DB.
type Raw = ExplainEvent & { story_ids?: string[]; live_at?: string | null; importance?: number };

function eventsFile(): string {
  const dir = process.env.EXPLAIN_DIR || path.join(process.cwd(), "ingest", "cache", "explain");
  return path.join(dir, "events.json");
}

let cache: { file: string; mtime: number; events: Raw[]; byPost: Map<string, string> } = {
  file: "",
  mtime: -1,
  events: [],
  byPost: new Map(),
};

function load(): typeof cache {
  const file = eventsFile();
  try {
    const st = fs.statSync(file);
    if (cache.file === file && cache.mtime === st.mtimeMs) return cache;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const events: Raw[] = Array.isArray(parsed) ? parsed : [];
    const byPost = new Map<string, string>();
    for (const e of events) {
      if (e.state === "queued") continue;
      for (const pid of e.post_ids ?? []) byPost.set(pid, e.id);
    }
    cache = { file, mtime: st.mtimeMs, events, byPost };
  } catch {
    cache = { file, mtime: -1, events: [], byPost: new Map() };
  }
  return cache;
}

// Drop collector-internal bookkeeping before sending an event to the browser.
export function publicEvent(e: Raw): ExplainEvent {
  const { story_ids: _s, live_at: _l, importance: _i, ...rest } = e;
  void _s; void _l; void _i;
  return rest as ExplainEvent;
}

export function listExplain(limit: number, coin?: string | null): ExplainEvent[] {
  const c = coin ? coin.toUpperCase() : null;
  return load()
    .events.filter((e) => e.state !== "queued" && (!c || e.coin?.ticker === c))
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
    .slice(0, limit)
    .map(publicEvent);
}

export function getExplain(id: string): ExplainEvent | null {
  const e = load().events.find((x) => x.id === id && x.state !== "queued");
  return e ? publicEvent(e) : null;
}

export function explainEventIdForPost(postId: string): string | null {
  return load().byPost.get(postId) ?? null;
}

export function withExplain<T extends { id: string }>(dto: T): T & { explainEventId: string | null } {
  return { ...dto, explainEventId: explainEventIdForPost(dto.id) };
}

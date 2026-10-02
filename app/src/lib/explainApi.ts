import type { ExplainEvent } from "./explainTypes";

export async function fetchExplainEvent(id: string, signal?: AbortSignal): Promise<ExplainEvent | null> {
  const res = await fetch(`/api/explain/${encodeURIComponent(id)}`, { cache: "no-store", signal });
  if (!res.ok) return null;
  const j = (await res.json()) as { event?: ExplainEvent };
  return j.event ?? null;
}

export async function fetchExplainList(limit = 20, coin?: string, signal?: AbortSignal): Promise<ExplainEvent[]> {
  const q = new URLSearchParams({ limit: String(limit) });
  if (coin) q.set("coin", coin);
  const res = await fetch(`/api/explain?${q.toString()}`, { cache: "no-store", signal });
  if (!res.ok) return [];
  const j = (await res.json()) as { events?: ExplainEvent[] };
  return j.events ?? [];
}

export type ExplainTag = { label: string; cls: string };

// Plain, secular category tag (never a Devi): colour comes from the category/subtype table in spec 4.2.
export function explainTag(category: string, subtype: string | null): ExplainTag {
  const k = `${category}:${subtype ?? ""}`;
  switch (k) {
    case "hack:theft": return { label: "Hack", cls: "ex-tag-red" };
    case "hack:exploit": return { label: "Exploit", cls: "ex-tag-red" };
    case "hack:depeg": return { label: "Depeg", cls: "ex-tag-red" };
    case "hack:halt":
    case "regulatory:halt": return { label: "Halt", cls: "ex-tag-amber" };
    case "delisting:top_exchange": return { label: "Delisting", cls: "ex-tag-amber" };
    case "unlock:supply_shock": return { label: "Unlock", cls: "ex-tag-violet" };
    case "listing:top_exchange": return { label: "Listing", cls: "ex-tag-lime" };
    case "regulatory:macro": return { label: "Macro", cls: "ex-tag-cyan" };
    default:
      if (category === "etf") return { label: "ETF", cls: "ex-tag-cyan" };
      if (category === "regulatory") return { label: "Regulation", cls: "ex-tag-cyan" };
      return { label: category, cls: "ex-tag-cyan" };
  }
}

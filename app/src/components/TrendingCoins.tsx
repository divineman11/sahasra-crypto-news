"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { useFeedStore } from "@/store/useFeedStore";
import { hideLowImportanceTier4 } from "@/lib/sourceTab";

interface Trend {
  ticker: string;
  count: number;
  net: number;
  bull: number;
  bear: number;
}

export function TrendingCoins() {
  const posts = useFeedStore((s) => s.posts);
  const addTicker = useFeedStore((s) => s.addTicker);
  const hideLowGnews = useFeedStore((s) => s.hideLowGnews);

  const trends = useMemo<Trend[]>(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const map = new Map<string, Trend>();
    const seenStories = new Map<string, Set<string>>();
    // Same predicate the main feed applies (visibleStories) — otherwise Trending's counts include
    // low-importance tier-4 posts the feed itself is hiding, and the two disagree on a coin's volume.
    const source = hideLowGnews ? posts.filter((p) => !hideLowImportanceTier4(p)) : posts;
    for (const p of source) {
      if (new Date(p.publishedAt).getTime() < cutoff) continue;
      const storyKey = p.storyId ?? p.id;
      for (const inst of p.instruments) {
        const t = map.get(inst.ticker) ?? { ticker: inst.ticker, count: 0, net: 0, bull: 0, bear: 0 };
        const stories = seenStories.get(inst.ticker) ?? new Set<string>();
        if (!stories.has(storyKey)) {
          stories.add(storyKey);
          seenStories.set(inst.ticker, stories);
          t.count += 1;
        }
        if (p.sentiment === "bullish") {
          t.bull += 1;
          t.net += 1;
        } else if (p.sentiment === "bearish") {
          t.bear += 1;
          t.net -= 1;
        }
        map.set(inst.ticker, t);
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.ticker.localeCompare(b.ticker)).slice(0, 10);
  }, [posts, hideLowGnews]);

  return (
    <div className="flex flex-col gap-1 p-3">
      <h2 className="text-[10px] uppercase tracking-wider text-slate-500">Trending (24h)</h2>
      {trends.length === 0 ? (
        <p className="py-2 text-xs text-slate-600">No mentions in the last 24 hours.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {trends.map((t) => {
            const total = t.bull + t.bear;
            const bullPct = total === 0 ? 50 : Math.round((t.bull / total) * 100);
            const color = t.net > 0 ? "text-emerald-400" : t.net < 0 ? "text-rose-400" : "text-cyan-300";
            return (
              <li key={t.ticker} className="group flex items-center gap-1">
                <Link
                  href={`/coin/${t.ticker}`}
                  className="min-w-0 flex-1 rounded px-1 py-0.5 text-left hover:bg-slate-800/60"
                  title={`Open ${t.ticker} coin page`}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className={`font-mono ${color}`}>${t.ticker}</span>
                    <span className="font-mono text-[10px] text-slate-500 tabular-nums">{t.count} stories</span>
                  </div>
                  <div className="mt-0.5 flex h-1 w-full overflow-hidden rounded">
                    <div className="bg-emerald-500/70" style={{ width: `${bullPct}%` }} />
                    <div className="bg-rose-500/70" style={{ width: `${100 - bullPct}%` }} />
                  </div>
                </Link>
                <button
                  onClick={() => addTicker(t.ticker)}
                  className="shrink-0 rounded px-1 py-1 text-slate-600 opacity-0 group-hover:opacity-100 hover:text-emerald-400 focus:opacity-100 focus-visible:opacity-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/60"
                  title={`Add ${t.ticker} to portfolio`}
                >
                  <Plus className="h-3 w-3" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
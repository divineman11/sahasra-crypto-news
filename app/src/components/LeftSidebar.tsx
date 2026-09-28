"use client";

import { useEffect, useMemo, useState } from "react";
import {
  LayoutList,
  Flame,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  Building2,
  X,
  Plus,
  AlertCircle,
  Bookmark,
  Flag,
} from "lucide-react";
import { useFeedStore } from "@/store/useFeedStore";
import { visibleStories } from "@/lib/filters";
import { fetchLatest } from "@/lib/feedApi";
import type { FilterKey } from "@/lib/types";

const FILTERS: { key: FilterKey; label: string; icon: typeof LayoutList }[] = [
  { key: "all", label: "All", icon: LayoutList },
  { key: "hot", label: "Hot", icon: Flame },
  { key: "rising", label: "Rising", icon: TrendingUp },
  { key: "important", label: "Important", icon: AlertCircle },
  { key: "exchange", label: "Exchange", icon: Building2 },
  { key: "bullish", label: "Bullish", icon: ArrowUpRight },
  { key: "bearish", label: "Bearish", icon: ArrowDownRight },
  { key: "saved", label: "Saved", icon: Bookmark },
  { key: "trump", label: "Trump", icon: Flag },
];

export function LeftSidebar() {
  const posts = useFeedStore((s) => s.posts);
  const filter = useFeedStore((s) => s.filter);
  const portfolio = useFeedStore((s) => s.portfolio);
  const setFilter = useFeedStore((s) => s.setFilter);
  const addTicker = useFeedStore((s) => s.addTicker);
  const removeTicker = useFeedStore((s) => s.removeTicker);
  const hideLowGnews = useFeedStore((s) => s.hideLowGnews);
  const setHideLowGnews = useFeedStore((s) => s.setHideLowGnews);
  const saved = useFeedStore((s) => s.saved);
  const [input, setInput] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const savedSet = useMemo(() => new Set(saved), [saved]);

  const counts = useMemo(
    () =>
      FILTERS.reduce<Record<string, number>>((acc, f) => {
        acc[f.key] = visibleStories(posts, f.key, portfolio, now, hideLowGnews, savedSet).length;
        return acc;
      }, {}),
    [posts, portfolio, now, hideLowGnews, savedSet]
  );

  const submit = () => {
    if (input.trim()) {
      addTicker(input);
      setInput("");
    }
  };

  return (
    <aside className="flex h-full flex-col gap-4 p-3">
      <nav className="flex flex-col gap-1">
        {FILTERS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`flex items-center justify-between rounded px-2 py-1.5 text-left text-xs font-medium transition-colors ${
              filter === key
                ? "bg-emerald-500/10 text-emerald-400"
                : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
            }`}
          >
            <span className="flex items-center gap-2">
              <Icon size={14} />
              {label}
            </span>
            <span className="font-mono text-[10px] text-slate-500">{counts[key]}</span>
          </button>
        ))}
      </nav>

      <p className="px-2 text-[10px] leading-snug text-slate-500">
        Hot = importance ≥70 &amp; ≤48h · Rising = ≥2 sources in 60 min · Important = importance ≥50
        (any age) · Exchange = exchange / new-market sources · Saved = bookmarked
      </p>

      <label className="flex items-center gap-2 px-2 text-[11px] text-slate-400 select-none">
        <input
          type="checkbox"
          checked={hideLowGnews}
          onChange={(e) => {
            // hideLowTier4 is now also applied server-side, so a toggle has to
            // refetch from a clean slate (setHideLowGnews itself resets posts/cursor) rather than
            // just re-filter what's already in memory.
            setHideLowGnews(e.target.checked);
            fetchLatest().catch(() => {});
          }}
          className="h-3 w-3 accent-emerald-500"
        />
        Hide low-importance (Google News, video, Reddit, whale)
      </label>

      <div className="flex flex-col gap-2">
        <h2 className="text-[10px] uppercase tracking-wider text-slate-500">Portfolio</h2>
        <div className="flex gap-1">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="TICKER"
            className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-slate-200 placeholder:text-slate-600 focus:border-emerald-500/50 focus:outline-none"
          />
          <button
            onClick={submit}
            className="rounded border border-slate-700 px-1.5 text-slate-400 hover:border-emerald-500/50 hover:text-emerald-400"
            aria-label="Add ticker"
          >
            <Plus size={14} />
          </button>
        </div>
        {portfolio.length === 0 ? (
          <p className="text-[10px] leading-snug text-slate-600">
            Add tickers to filter the feed to your portfolio.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {portfolio.map((t) => (
              <span
                key={t}
                className="flex items-center gap-1 rounded border border-cyan-500/30 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300"
              >
                ${t}
                <button
                  onClick={() => removeTicker(t)}
                  className="text-slate-500 hover:text-rose-400"
                  aria-label={`Remove ${t}`}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
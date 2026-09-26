"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import type { PostDTO } from "@/lib/types";
import type { SourceTab } from "@/lib/sourceTab";
import { ageMs, fmtAge, groupStories, isFresh, type StoryView } from "@/lib/filters";
import { CATEGORY_STYLE, fmtDateTime, fmtPubTime, kindIcon } from "@/lib/ui";
import { mediaThumb } from "@/lib/mediaThumb";

type Range = "48h" | "7d";
type Tab = "all" | SourceTab;

interface Counts {
  all: number;
  news: number;
  exchange: number;
  official: number;
  social: number;
  media: number;
  important: number;
}

interface CoinResponse {
  ticker: string;
  name: string | null;
  range: Range;
  tab: Tab;
  counts: Counts;
  items: PostDTO[];
  nextCursor: string | null;
}

const TAB_DEFS: { key: Tab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "news", label: "News" },
  { key: "exchange", label: "Exchange" },
  { key: "official", label: "Official" },
  { key: "social", label: "Social" },
  { key: "media", label: "Media" },
];

const EMPTY_COUNTS: Counts = { all: 0, news: 0, exchange: 0, official: 0, social: 0, media: 0, important: 0 };

async function fetchCoin(
  ticker: string,
  range: Range,
  tab: Tab,
  minImportance: number,
  cursor: string | null,
  limit?: number
): Promise<{ data: CoinResponse | null; status: number }> {
  const sp = new URLSearchParams({ range, tab, minImportance: String(minImportance) });
  if (cursor) sp.set("cursor", cursor);
  if (limit) sp.set("limit", String(limit));
  const res = await fetch(`/api/coin/${encodeURIComponent(ticker)}?${sp.toString()}`, { cache: "no-store" });
  if (!res.ok) return { data: null, status: res.status };
  const data = (await res.json()) as CoinResponse;
  return { data, status: res.status };
}

export default function CoinPage() {
  const params = useParams<{ ticker: string }>();
  const rawTicker = params?.ticker ?? "";
  const ticker = rawTicker.toUpperCase().replace(/[^A-Z0-9]/g, "");

  const [mounted, setMounted] = useState(false);
  const [range, setRange] = useState<Range>("48h");
  const [tab, setTab] = useState<Tab>("all");
  const [importantOnly, setImportantOnly] = useState(false);

  const [name, setName] = useState<string | null>(null);
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [items, setItems] = useState<PostDTO[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [headline48h, setHeadline48h] = useState<{ all: number; important: number } | null>(null);
  const [headline7d, setHeadline7d] = useState<{ all: number; important: number } | null>(null);

  const [now, setNow] = useState(() => Date.now());

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const minImportance = importantOnly ? 50 : 0;

  // Main list load — reset on ticker/range/tab/importantOnly change.
  useEffect(() => {
    if (!mounted) return;
    // Ticker normalises to A-Z0-9 only, so e.g. non-ASCII or empty route params (/coin/, /coin/龙虾)
    // collapse to "" — treat that as not-found immediately rather than never firing a request (which
    // would otherwise leave `loading` stuck true forever, since the guard below used to bail out
    // before ever calling setLoading(false) / setNotFound(true)).
    if (!ticker) {
      setLoading(false);
      setNotFound(true);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setError(null);
    fetchCoin(ticker, range, tab, minImportance, null)
      .then(({ data, status }) => {
        if (cancelled) return;
        if (status === 404) {
          setNotFound(true);
          return;
        }
        if (!data) {
          setError(`request failed (${status})`);
          return;
        }
        setName(data.name);
        setCounts(data.counts);
        setItems(data.items);
        setNextCursor(data.nextCursor);
      })
      .catch(() => {
        if (!cancelled) setError("network error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mounted, ticker, range, tab, minImportance]);

  // Header badges: 48h and 7d totals, independent of the list's own range/tab selection. Only the
  // `counts` field is used here, so limit=1 avoids pulling a full page of rows just to read it.
  useEffect(() => {
    if (!mounted || !ticker) return;
    let cancelled = false;
    fetchCoin(ticker, "48h", "all", 0, null, 1).then(({ data }) => {
      if (!cancelled && data) setHeadline48h({ all: data.counts.all, important: data.counts.important });
    });
    fetchCoin(ticker, "7d", "all", 0, null, 1).then(({ data }) => {
      if (!cancelled && data) setHeadline7d({ all: data.counts.all, important: data.counts.important });
    });
    return () => {
      cancelled = true;
    };
  }, [mounted, ticker]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    fetchCoin(ticker, range, tab, minImportance, nextCursor)
      .then(({ data }) => {
        if (!data) return;
        setItems((prev) => [...prev, ...data.items]);
        setNextCursor(data.nextCursor);
      })
      .finally(() => setLoadingMore(false));
  }, [ticker, range, tab, minImportance, nextCursor, loadingMore]);

  const stories: StoryView[] = useMemo(() => groupStories(items), [items]);

  if (!mounted) {
    return <div className="p-4 font-mono text-xs text-slate-500">loading…</div>;
  }

  return (
    <div className="flex h-screen flex-col p-4">
      <TopBar />
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto rounded border border-slate-800 p-4 text-xs font-mono text-slate-300">
        <Link href="/" className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> back to feed
        </Link>

        {notFound ? (
          <div className="mt-6 text-slate-400">
            <p>Unknown ticker &quot;{ticker || "?"}&quot;.</p>
          </div>
        ) : error ? (
          <div className="mt-6 text-slate-400">
            <p>{error}</p>
          </div>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap items-baseline gap-3">
              <h1 className="text-lg font-sans font-semibold text-slate-100">${ticker}</h1>
              {name ? <span className="text-slate-500">{name}</span> : null}
            </div>

            <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-500">
              <span>
                48h:{" "}
                <span className="text-slate-300">{headline48h ? headline48h.all : "…"}</span>{" "}
                stories, <span className="text-emerald-400">{headline48h ? headline48h.important : "…"}</span> important
              </span>
              <span>·</span>
              <span>
                7d: <span className="text-slate-300">{headline7d ? headline7d.all : "…"}</span> stories,{" "}
                <span className="text-emerald-400">{headline7d ? headline7d.important : "…"}</span> important
              </span>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {(["48h", "7d"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={`rounded border px-2 py-0.5 text-[11px] ${
                    range === r
                      ? "border-emerald-500/60 text-emerald-400"
                      : "border-slate-700 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {r === "48h" ? "48h" : "7 days"}
                </button>
              ))}
              <span className="mx-1 text-slate-700">|</span>
              <label className="flex items-center gap-1.5 text-[11px] text-slate-400 select-none">
                <input
                  type="checkbox"
                  checked={importantOnly}
                  onChange={(e) => setImportantOnly(e.target.checked)}
                  className="h-3 w-3 accent-emerald-500"
                />
                Important only (≥50)
              </label>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5 border-b border-slate-800 pb-3">
              {TAB_DEFS.map((t) => {
                const count = t.key === "all" ? counts.all : counts[t.key as SourceTab];
                const active = tab === t.key;
                const empty = count === 0;
                return (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`rounded border px-2 py-0.5 text-[11px] ${
                      active
                        ? "border-cyan-500/60 text-cyan-300"
                        : empty
                          ? "border-slate-800 text-slate-600 hover:text-slate-400"
                          : "border-slate-700 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {t.label} <span className="text-[10px] tabular-nums">({count})</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-3">
              {loading ? (
                <p className="py-6 text-center text-slate-600">loading stories…</p>
              ) : stories.length === 0 ? (
                <p className="py-6 text-center text-slate-600">No stories for this coin / range / tab.</p>
              ) : (
                <ul className="divide-y divide-slate-800/60">
                  {stories.map((v) => (
                    <CoinStoryRow key={v.post.id} story={v} now={now} />
                  ))}
                </ul>
              )}

              {!loading && nextCursor ? (
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="mt-3 flex w-full items-center justify-center gap-1 py-2 text-[11px] text-slate-400 hover:text-emerald-400 disabled:opacity-50"
                >
                  {loadingMore ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  {loadingMore ? "loading…" : "Load more"}
                </button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CoinStoryRow({ story, now }: { story: StoryView; now: number }) {
  const { post, count, maxImportance } = story;
  const ki = kindIcon(post.kind);
  const cat = CATEGORY_STYLE[post.category];
  const age = ageMs(post, now);
  const thumb = post.kind === "media" ? mediaThumb(post.url) : null;

  return (
    <li className="flex items-center gap-2 py-1.5">
      <span className="w-14 shrink-0 font-mono text-slate-500" title={fmtDateTime(post.publishedAt)}>
        {fmtPubTime(post.publishedAt)}
      </span>
      <ki.Icon className={`h-3.5 w-3.5 shrink-0 ${ki.cls}`} aria-label={ki.label} />
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumb}
          alt=""
          width={48}
          height={27}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-[27px] w-12 shrink-0 rounded object-cover"
        />
      ) : null}
      <Link href={`/post/${post.id}`} className="min-w-0 flex-1 truncate text-slate-200 hover:text-white" title={post.title}>
        {post.title}
      </Link>
      <a
        href={post.url}
        target="_blank"
        rel="noopener noreferrer"
        title={`Open original on ${post.sourceDomain}`}
        className="shrink-0 text-slate-600 hover:text-sky-400"
      >
        <ExternalLink className="h-3 w-3" />
      </a>
      <span className="hidden w-28 shrink-0 truncate text-slate-500 sm:inline" title={post.sourceName}>
        {post.sourceTier === 1 && post.exchange ? post.exchange : post.sourceDomain}
      </span>
      {count > 1 ? (
        <span className="shrink-0 rounded border border-slate-600 px-1 text-[10px] text-slate-400" title={`${count} sources`}>
          +{count - 1}
        </span>
      ) : null}
      {cat.label ? <span className={`shrink-0 rounded border px-1 text-[10px] ${cat.cls}`}>{cat.label}</span> : null}
      <span className="shrink-0 font-mono text-slate-400">{maxImportance}</span>
      <span
        className={`hidden shrink-0 rounded border px-1 text-[10px] sm:inline ${
          isFresh(post, now) ? "border-emerald-500/40 text-emerald-400" : "border-slate-700 text-slate-600"
        }`}
      >
        {fmtAge(age)}
      </span>
      <div className="hidden shrink-0 items-center gap-1 md:flex">
        {post.instruments.slice(0, 3).map((inst) => (
          <Link
            key={inst.ticker}
            href={`/coin/${inst.ticker}`}
            className="rounded border border-cyan-500/30 px-1 text-[10px] text-cyan-300 hover:brightness-125"
          >
            ${inst.ticker}
          </Link>
        ))}
      </div>
    </li>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

interface CoinHit {
  ticker: string;
  name: string;
  count7d: number;
}

interface PostHit {
  id: string;
  title: string;
  sourceDomain: string;
}

interface SearchResults {
  coins: CoinHit[];
  posts: PostHit[];
}

const EMPTY: SearchResults = { coins: [], posts: [] };
const DEBOUNCE_MS = 250;

export function SearchBox() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trimmed = query.trim();

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (trimmed.length === 0) {
      setResults(EMPTY);
      setLoading(false);
      return;
    }
    setLoading(true);
    // Abort the in-flight request (if any) whenever `trimmed` changes again before it resolves, so a
    // slow older response can never land after — and overwrite — a newer one's results.
    const controller = new AbortController();
    debounceRef.current = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, { cache: "no-store", signal: controller.signal })
        .then((res) => (res.ok ? res.json() : EMPTY))
        .then((data: SearchResults) => setResults(data ?? EMPTY))
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setResults(EMPTY);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      controller.abort();
    };
  }, [trimmed]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const exactCoin = useMemo(
    () => results.coins.find((c) => c.ticker === trimmed.toUpperCase()) ?? null,
    [results, trimmed]
  );

  const hasResults = results.coins.length > 0 || results.posts.length > 0;

  const goToCoin = (ticker: string) => {
    router.push(`/coin/${ticker}`);
    setOpen(false);
    inputRef.current?.blur();
  };

  const goToPost = (id: string) => {
    router.push(`/post/${id}`);
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-[220px]">
      <div className="flex items-center gap-1.5 rounded border border-slate-700 bg-slate-900/80 px-2 py-1 focus-within:border-cyan-500/50">
        <Search className="h-3 w-3 shrink-0 text-slate-500" aria-hidden="true" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (trimmed.length > 0) setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              inputRef.current?.blur();
              return;
            }
            if (e.key === "Enter") {
              if (exactCoin) {
                goToCoin(exactCoin.ticker);
              } else if (results.coins.length > 0) {
                goToCoin(results.coins[0].ticker);
              } else if (results.posts.length > 0) {
                goToPost(results.posts[0].id);
              }
            }
          }}
          placeholder="Search coins / news…"
          aria-label="Search coins and news"
          className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-slate-200 placeholder:text-slate-600 focus:outline-none"
        />
      </div>

      {open && trimmed.length > 0 ? (
        // Wider than the (deliberately compact) input so post titles aren't truncated to a few words.
        // w-[min(520px,90vw)] caps it at 90% of the viewport so it never causes horizontal page
        // scroll on a narrow/phone-width screen; left-0 anchors it under the input's left edge.
        <div className="absolute left-0 z-20 mt-1 max-h-80 w-[min(520px,90vw)] overflow-y-auto rounded border border-slate-700 bg-slate-900 shadow-lg shadow-black/50">
          {loading ? (
            <p className="px-2 py-2 text-[11px] text-slate-500">searching…</p>
          ) : !hasResults ? (
            <p className="px-2 py-2 text-[11px] text-slate-500">no matches</p>
          ) : (
            <>
              {results.coins.length > 0 ? (
                <div className="border-b border-slate-800 py-1">
                  <p className="px-2 pb-1 text-[9px] uppercase tracking-wider text-slate-600">Coins</p>
                  {results.coins.map((c) => (
                    <button
                      key={c.ticker}
                      onClick={() => goToCoin(c.ticker)}
                      className="flex w-full items-center justify-between px-2 py-1 text-left text-[11px] text-slate-300 hover:bg-slate-800/60"
                    >
                      <span>
                        <span className="font-mono text-cyan-300">${c.ticker}</span>{" "}
                        <span className="text-slate-500">{c.name}</span>
                      </span>
                      <span className="shrink-0 text-[10px] text-slate-600">{c.count7d}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              {results.posts.length > 0 ? (
                <div className="py-1">
                  <p className="px-2 pb-1 text-[9px] uppercase tracking-wider text-slate-600">News</p>
                  {results.posts.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => goToPost(p.id)}
                      className="block w-full truncate px-2 py-1 text-left text-[11px] text-slate-300 hover:bg-slate-800/60"
                      title={p.title}
                    >
                      {p.title}
                      <span className="ml-1 text-slate-600">· {p.sourceDomain}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

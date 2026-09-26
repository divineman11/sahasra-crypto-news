"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useFeedStore, MAX_POSTS } from "@/store/useFeedStore";
import { visibleStories } from "@/lib/filters";
import { fetchOlder } from "@/lib/feedApi";
import { FeedRow, FEED_GRID_COLS } from "@/components/FeedRow";
import { ArrowUp, History } from "lucide-react";

export function NewsFeed() {
  const posts = useFeedStore((s) => s.posts);
  const filter = useFeedStore((s) => s.filter);
  const portfolio = useFeedStore((s) => s.portfolio);
  const hideLowGnews = useFeedStore((s) => s.hideLowGnews);
  const saved = useFeedStore((s) => s.saved);
  const pendingCount = useFeedStore((s) => s.pending.length);
  const setPaused = useFeedStore((s) => s.setPaused);
  const flushPending = useFeedStore((s) => s.flushPending);
  const nextCursor = useFeedStore((s) => s.nextCursor);
  const loadingOlder = useFeedStore((s) => s.loadingOlder);
  const cursorStale = useFeedStore((s) => s.cursorStale);
  const source = useFeedStore((s) => s.source);
  const [now, setNow] = useState(() => Date.now());

  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const hoverRef = useRef(false);

  const update = useCallback(() => {
    const top = listRef.current?.scrollTop ?? 0;
    setPaused(hoverRef.current || top > 4);
  }, [setPaused]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => () => setPaused(false), [setPaused]);

  const savedSet = useMemo(() => new Set(saved), [saved]);
  const stories = useMemo(
    () => visibleStories(posts, filter, portfolio, now, hideLowGnews, savedSet),
    [posts, filter, portfolio, now, hideLowGnews, savedSet]
  );

  // The store caps in-memory posts at MAX_POSTS (oldest dropped) so a week of history can't grow
  // without bound — once we're at the cap, fetching another older page would just be discarded by
  // that same cap (sorted-desc-then-sliced), so stop asking and say why instead of spinning forever.
  const capHit = posts.length >= MAX_POSTS;
  const canLoadMore = source === "live" && typeof nextCursor === "string" && nextCursor.length > 0 && !capHit;

  // Infinite scroll: an IntersectionObserver sentinel at the bottom of the list calls fetchOlder()
  // once it scrolls into view, in addition to the manual "Load older" button (kept as a fallback —
  // e.g. for reduced-motion / no-IO environments, and so the control is still keyboard-reachable).
  //
  // F1 review: IntersectionObserver only invokes its callback on a *transition* of isIntersecting
  // (false->true), plus once immediately when observe() is first called. With `canLoadMore` as the
  // only dep, a single auto-load appended new rows below the sentinel without moving it out of view
  // (still `isIntersecting: true`, unchanged) — no further callback fired, so scrolling stalled after
  // exactly one page. Adding `posts.length` re-creates the observer (disconnect + observe again) on
  // every successful load; observe() re-reports the *current* intersection state immediately, so if
  // the sentinel is still visible the chain continues — until nextCursor goes null, the MAX_POSTS cap
  // is hit, or (see below) a page added nothing new. Deliberately NOT depending on `loadingOlder`:
  // that would re-create the observer on every request's start/end regardless of outcome, so a
  // persistently-failing fetch (e.g. a stuck 500) would reconnect-and-immediately-refire forever.
  useEffect(() => {
    const root = listRef.current;
    const target = sentinelRef.current;
    if (!root || !target) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        const s = useFeedStore.getState();
        if (s.source !== "live" || s.loadingOlder || !s.nextCursor) return;
        if (s.posts.length >= MAX_POSTS) return;
        fetchOlder();
      },
      { root, rootMargin: "200px" }
    );
    observer.observe(target);
    return () => observer.disconnect();
    // `posts.length` unchanged after a fetch (a page whose items were all already in the store, so
    // nothing new got added) means this effect does NOT re-run — the stale observer stays attached
    // and won't refire until something else changes it, which is exactly "stop chaining" for a
    // zero-growth page; no separate counter needed.
  }, [canLoadMore, posts.length]);

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div
        className={`grid ${FEED_GRID_COLS} gap-2 border-b border-slate-800 px-2 py-1 text-[10px] uppercase tracking-wider text-slate-500`}
      >
        <span aria-hidden="true" />
        <span>Age</span>
        <span>Title</span>
        <span>Source</span>
        <span>Tags</span>
        <span>Mark</span>
      </div>
      <div
        ref={listRef}
        onScroll={update}
        onMouseEnter={() => {
          hoverRef.current = true;
          update();
        }}
        onMouseLeave={() => {
          hoverRef.current = false;
          update();
        }}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
      >
        {pendingCount > 0 && (
          <button
            onClick={() => {
              flushPending();
              listRef.current?.scrollTo({ top: 0 });
            }}
            className="sticky top-0 z-10 flex w-full items-center justify-center gap-1 border-b border-emerald-500/30 bg-slate-900/95 py-1 text-[11px] text-emerald-400 hover:bg-slate-800"
          >
            <ArrowUp size={12} /> {pendingCount} new post
            {pendingCount === 1 ? "" : "s"} — click to show
          </button>
        )}
        {stories.length === 0 ? (
          <p className="p-4 text-center text-xs text-slate-600">
            No stories match the current filter.
          </p>
        ) : (
          stories.map((v) => <FeedRow key={v.post.id} story={v} now={now} savedSet={savedSet} />)
        )}
        {source === "live" ? (
          capHit ? (
            <p className="py-2 text-center text-[10px] text-amber-400">
              showing the most recent {MAX_POSTS.toLocaleString()} posts — scroll-loading paused to
              keep memory bounded
            </p>
          ) : cursorStale ? (
            // F7 review: the cursor row fetchOlder() was about to page from no longer exists
            // (filtered out or deleted between loads) — a 400, not "we reached the end of the
            // 7-day archive", so this is a different message from the end-of-archive marker below.
            <p className="py-2 text-center text-[10px] text-amber-400">
              feed changed — reload to continue
            </p>
          ) : canLoadMore ? (
            <>
              <button
                onClick={() => {
                  fetchOlder();
                }}
                disabled={loadingOlder}
                className="flex w-full items-center justify-center gap-1 py-2 text-[11px] text-slate-400 hover:text-emerald-400"
              >
                <History size={12} />
                {loadingOlder ? "loading…" : "Load older"}
              </button>
              <div ref={sentinelRef} aria-hidden="true" className="h-1" />
            </>
          ) : nextCursor === null ? (
            <p className="py-2 text-center text-[10px] text-slate-600">
              end of 7-day archive
            </p>
          ) : null
        ) : null}
      </div>
    </section>
  );
}
"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PostDTO, VoteType, FilterKey } from "@/lib/types";
import type { StoryView } from "@/lib/filters";
import { MOCK_POSTS } from "@/lib/mockPosts";
import { toggleSavedMembers, MAX_SAVED_IDS } from "@/lib/storyFilters";

// The minimal shape toggleSaved actually needs — a full StoryView works too (it's a superset), but
// callers (PostDetail) that only have a single post + its sibling posts, not a real StoryView,
// shouldn't have to fabricate the other StoryView fields (count/maxImportance/tier1) just to call it.
export type SavedToggleTarget = Pick<StoryView, "post" | "members">;

type WsStatus = "connecting" | "open" | "closed";

interface FeedState {
  posts: PostDTO[];
  source: "mock" | "live";
  filter: FilterKey;
  portfolio: string[];
  myVotes: Record<string, VoteType[]>;
  wsStatus: WsStatus;
  flashIds: Record<string, number>;
  pending: PostDTO[];
  paused: boolean;
  nextCursor: string | null | undefined;
  loadingOlder: boolean;
  hideLowGnews: boolean;
  saved: string[];
  expandedId: string | null;
  // Set when a "load older" fetch gets a 400 (its cursor row no longer exists — e.g. it was
  // filtered/deleted between page loads): distinct from nextCursor===null (genuine end of the
  // 7-day archive) so NewsFeed can tell the two apart (F7 review).
  cursorStale: boolean;
  setHideLowGnews(v: boolean): void;
  toggleSaved(story: SavedToggleTarget): void;
  toggleExpanded(id: string): void;
  setCursorStale(v: boolean): void;
  hydrate(posts: PostDTO[]): void;
  mergeSnapshot(posts: PostDTO[]): void;
  upsertPost(post: PostDTO, isNew: boolean): void;
  setPaused(paused: boolean): void;
  flushPending(): void;
  setNextCursor(c: string | null): void;
  setLoadingOlder(b: boolean): void;
  setFilter(f: FilterKey): void;
  addTicker(t: string): void;
  removeTicker(t: string): void;
  setWsStatus(s: WsStatus): void;
  applyLocalVote(id: string, type: VoteType): void;
  recordMyVote(id: string, type: VoteType): void;
}

// Bumped from 1000 -> 3000 for step 8's 7-day infinite scroll: the feed now pages back a full week
// instead of stopping at 48h, so the in-memory cap has to hold a correspondingly larger window.
// Exported so NewsFeed can detect "we hit the cap" (posts.length >= MAX_POSTS) and stop auto-loading
// rather than silently discarding older pages it just fetched.
export const MAX_POSTS = 3000;
const FLASH_MS = 5000;
const MAX_PENDING = 200;
const MAX_MYVOTES = 2000;

function sortDesc(list: PostDTO[]): PostDTO[] {
  return [...list].sort((a, b) => {
    if (a.firstSeenAt !== b.firstSeenAt) {
      return a.firstSeenAt < b.firstSeenAt ? 1 : -1;
    }
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}

function capped(list: PostDTO[]): PostDTO[] {
  return sortDesc(list).slice(0, MAX_POSTS);
}

function pruneFlash(flashIds: Record<string, number>): Record<string, number> {
  const now = Date.now();
  const out: Record<string, number> = {};
  for (const [id, ts] of Object.entries(flashIds)) {
    if (now - ts < FLASH_MS) out[id] = ts;
  }
  return out;
}

export const useFeedStore = create<FeedState>()(
  persist(
    (set, get) => ({
      posts: MOCK_POSTS,
      source: "mock",
      filter: "all",
      portfolio: [],
      myVotes: {},
      wsStatus: "connecting",
      flashIds: {},
      pending: [],
      paused: false,
      nextCursor: undefined,
      loadingOlder: false,
      hideLowGnews: true,
      saved: [],
      expandedId: null,
      cursorStale: false,

      hydrate: (incoming) => {
        if (incoming.length === 0) return;
        const { posts, source, pending } = get();
        const base = source === "mock" ? [] : posts;
        const byId = new Map(base.map((p) => [p.id, p]));
        for (const p of incoming) byId.set(p.id, p);
        const pendingIds = new Set(incoming.map((p) => p.id));
        const newPending = pending.filter((p) => !pendingIds.has(p.id));
        set({ posts: capped(Array.from(byId.values())), source: "live", ...(newPending.length !== pending.length ? { pending: newPending } : {}) });
      },

      mergeSnapshot: (incoming) => {
        if (incoming.length === 0) return;
        const { posts, source, pending } = get();
        if (source === "mock") {
          set({ posts: capped(incoming), source: "live" });
          return;
        }
        const existingIds = new Set(posts.map((p) => p.id));
        const pendingIds = new Set(pending.map((p) => p.id));
        const additions = incoming.filter(
          (p) => !existingIds.has(p.id) && !pendingIds.has(p.id)
        );
        if (additions.length === 0) return;
        set({ posts: capped([...posts, ...additions]) });
      },

      upsertPost: (post, isNew) => {
        const { posts, pending, paused, flashIds } = get();
        const idx = posts.findIndex((p) => p.id === post.id);
        if (idx !== -1) {
          const next = [...posts];
          next[idx] = post;
          set({ posts: next });
          return;
        }
        const pIdx = pending.findIndex((p) => p.id === post.id);
        if (pIdx !== -1) {
          const next = [...pending];
          next[pIdx] = post;
          set({ pending: next });
          return;
        }
        if (paused) {
          set({ pending: [post, ...pending].slice(0, MAX_PENDING) });
          return;
        }
        const patch: Partial<FeedState> = { posts: capped([post, ...posts]) };
        if (isNew) {
          patch.flashIds = { ...pruneFlash(flashIds), [post.id]: Date.now() };
        }
        set(patch);
      },

      setPaused: (p) => {
        set({ paused: p });
        if (!p && get().pending.length > 0) {
          get().flushPending();
        }
      },

      flushPending: () => {
        const { posts, pending, flashIds } = get();
        if (pending.length === 0) return;
        const byId = new Map(posts.map((x) => [x.id, x]));
        for (const p of pending) byId.set(p.id, p);
        const nextFlash = pruneFlash(flashIds);
        const now = Date.now();
        for (const p of pending) nextFlash[p.id] = now;
        set({ posts: capped(Array.from(byId.values())), pending: [], flashIds: nextFlash });
      },

      setNextCursor: (c) => set({ nextCursor: c }),
      setLoadingOlder: (b) => set({ loadingOlder: b }),
      // hideLowTier4 is now applied server-side too, so a toggle can't just flip
      // the flag and let the client-side filter (visibleStories) hide/reveal rows already in
      // memory — pages fetched under the old filter and pages fetched under the new one would mix.
      // Reset to a clean slate (posts + pagination cursor) on an actual change; the caller (the
      // toggle's onChange handler) re-fetches the first page right after calling this.
      setHideLowGnews: (v) => {
        if (get().hideLowGnews === v) return;
        set({ hideLowGnews: v, posts: [], nextCursor: undefined, cursorStale: false });
      },
      setFilter: (f) => set({ filter: f }),
      setWsStatus: (s) => set({ wsStatus: s }),
      setCursorStale: (v) => set({ cursorStale: v }),

      // F2 review: delegates to the same pure toggleSavedMembers() helper the Saved filter's
      // isSavedStory() predicate is built to agree with — "any member saved" reads as saved, so
      // toggling clears every member's id, not just whichever one the id-only version used to touch.
      toggleSaved: (story) => {
        const { saved } = get();
        set({ saved: toggleSavedMembers(saved, story, MAX_SAVED_IDS) });
      },

      toggleExpanded: (id) => {
        set((s) => ({ expandedId: s.expandedId === id ? null : id }));
      },

      addTicker: (t) => {
        const clean = t.toUpperCase().trim().replace(/[^A-Z0-9]/g, "");
        if (!clean) return;
        const { portfolio } = get();
        if (portfolio.includes(clean)) return;
        set({ portfolio: [...portfolio, clean] });
      },

      removeTicker: (t) => {
        set({ portfolio: get().portfolio.filter((x) => x !== t) });
      },

      applyLocalVote: (id, type) => {
        const { posts } = get();
        set({
          posts: posts.map((p) =>
            p.id === id
              ? { ...p, votes: { ...p.votes, [type]: p.votes[type] + 1 } }
              : p
          ),
        });
      },

      recordMyVote: (id, type) => {
        const { myVotes } = get();
        const current = myVotes[id] ?? [];
        let nextMyVotes: Record<string, VoteType[]>;
        if (current.includes(type)) {
          nextMyVotes = { ...myVotes };
        } else {
          nextMyVotes = { ...myVotes, [id]: [...current, type] };
        }
        const keys = Object.keys(nextMyVotes);
        if (keys.length > MAX_MYVOTES) {
          const trimmed: Record<string, VoteType[]> = {};
          for (const k of keys.slice(keys.length - MAX_MYVOTES)) {
            trimmed[k] = nextMyVotes[k];
          }
          nextMyVotes = trimmed;
        }
        set({ myVotes: nextMyVotes });
      },
    }),
    {
      name: "cnt-portfolio",
      partialize: (s) => ({
        portfolio: s.portfolio,
        myVotes: s.myVotes,
        hideLowGnews: s.hideLowGnews,
        saved: s.saved,
      }),
    }
  )
);
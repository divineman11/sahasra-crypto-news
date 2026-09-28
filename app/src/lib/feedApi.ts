import { useFeedStore } from "@/store/useFeedStore";
import type { PostDTO } from "@/lib/types";

function isPostDTO(x: unknown): x is PostDTO {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.title === "string" &&
    typeof o.publishedAt === "string" &&
    Array.isArray(o.instruments) &&
    typeof o.votes === "object" &&
    o.votes !== null
  );
}

// the server now supports filtering out low-importance tier-4 rows itself
// (`hideLowTier4=1`) — pass it whenever the store's hideLowGnews toggle is on, so a hidden row
// never counts against the 7-day scroll's 3000-post in-memory cap in the first place.
function hideLowTier4Param(): string {
  return useFeedStore.getState().hideLowGnews ? "&hideLowTier4=1" : "";
}

export async function fetchLatest(): Promise<void> {
  try {
    const res = await fetch(`/api/posts?limit=50${hideLowTier4Param()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`fetchLatest failed: ${res.status}`);
    const data: unknown = await res.json();
    const payload = data as { posts?: unknown[]; nextCursor?: string | null } | null;
    const posts = Array.isArray(payload?.posts)
      ? (payload.posts as unknown[]).filter(isPostDTO)
      : [];
    if (posts.length > 0) {
      useFeedStore.getState().hydrate(posts);
    }
    if (useFeedStore.getState().nextCursor === undefined) {
      useFeedStore.getState().setNextCursor(payload?.nextCursor ?? null);
    }
    // The Trump section has its own feed (kind=politics); the crypto request above never includes it.
    const tr = await fetch(`/api/posts?limit=50&kind=politics`, { cache: "no-store" });
    if (tr.ok) {
      const td = (await tr.json()) as { posts?: unknown[] } | null;
      const tposts = Array.isArray(td?.posts) ? (td!.posts as unknown[]).filter(isPostDTO) : [];
      if (tposts.length > 0) useFeedStore.getState().hydrate(tposts);
    }
  } catch (err) {
    console.warn("fetchLatest error", err);
  }
}

export async function fetchOlder(): Promise<void> {
  const s = useFeedStore.getState();
  if (s.loadingOlder || !s.nextCursor) return;
  useFeedStore.getState().setLoadingOlder(true);
  try {
    // Paging always asks for the 7-day range — the initial fetchLatest() snapshot stays 48h (the
    // API's own default, for backward compatibility with any other caller), but "load older"
    // reveals the rest of the week regardless of which 48h-scoped cursor page it started from: the
    // keyset cursor only encodes "strictly before this row's (firstSeenAt, id)", so switching range
    // mid-pagination just widens which older rows now qualify, it doesn't skip or duplicate any.
    const res = await fetch(
      `/api/posts?limit=50&range=7d&cursor=${encodeURIComponent(s.nextCursor)}${hideLowTier4Param()}`,
      { cache: "no-store" }
    );
    if (res.ok) {
      const data: unknown = await res.json();
      const payload = data as { posts?: unknown[]; nextCursor?: string | null } | null;
      const posts = Array.isArray(payload?.posts)
        ? (payload.posts as unknown[]).filter(isPostDTO)
        : [];
      if (posts.length > 0) {
        useFeedStore.getState().hydrate(posts);
      }
      useFeedStore.getState().setNextCursor(payload?.nextCursor ?? null);
    } else if (res.status === 400) {
      // The cursor row is gone (filtered out or deleted between page loads) — this is not "we
      // reached the end of the 7-day archive", so NewsFeed shows a distinct "feed changed" message
      // (F7 review) rather than the "end of 7-day archive" marker.
      useFeedStore.getState().setCursorStale(true);
      useFeedStore.getState().setNextCursor(null);
    } else {
      throw new Error(`fetchOlder failed: ${res.status}`);
    }
  } catch (err) {
    console.warn("fetchOlder error", err);
  } finally {
    useFeedStore.getState().setLoadingOlder(false);
  }
}
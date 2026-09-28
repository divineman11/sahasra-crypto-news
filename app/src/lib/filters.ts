import type { FilterKey, PostDTO } from "@/lib/types";
import { hideLowImportanceTier4 } from "@/lib/sourceTab";
import { isImportantStory, isSavedStory, toggleSavedMembers } from "@/lib/storyFilters";

export type { FilterKey };
export { isImportantStory, isSavedStory, toggleSavedMembers };

export interface StoryView {
  post: PostDTO;
  members: PostDTO[];
  count: number;
  maxImportance: number;
  tier1: boolean;
}

export const HOT_IMPORTANCE = 70;
export const FRESH_MS = 48 * 3600 * 1000;
const RISING_MS = 3600 * 1000;

export function ageMs(p: PostDTO, now: number): number {
  return now - Date.parse(p.publishedAt);
}

export function isFresh(p: PostDTO, now: number): boolean {
  return ageMs(p, now) <= FRESH_MS;
}

export function fmtAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function byFirstSeenDesc(a: PostDTO, b: PostDTO): number {
  if (a.firstSeenAt !== b.firstSeenAt) return a.firstSeenAt < b.firstSeenAt ? 1 : -1;
  return a.id < b.id ? 1 : -1;
}

export function groupStories(posts: PostDTO[]): StoryView[] {
  const groups = new Map<string, PostDTO[]>();
  for (const p of posts) {
    const key = p.storyId ?? p.id;
    let arr = groups.get(key);
    if (!arr) {
      arr = [];
      groups.set(key, arr);
    }
    arr.push(p);
  }
  const views: StoryView[] = [];
  for (const members of groups.values()) {
    members.sort((a, b) => {
      if (a.firstSeenAt !== b.firstSeenAt) return a.firstSeenAt < b.firstSeenAt ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });
    views.push({
      post: members[0],
      members,
      count: members.length,
      maxImportance: members.reduce((m, x) => Math.max(m, x.importance), 0),
      tier1: members.some((m) => m.sourceTier === 1),
    });
  }
  views.sort((a, b) => byFirstSeenDesc(a.post, b.post));
  return views;
}

// `savedIds` is only consulted by the "saved" case — every other filter ignores it, so callers
// that never pass one (existing call sites, other suites) keep working unchanged.
export function matchesStory(
  v: StoryView,
  f: FilterKey,
  now: number,
  savedIds: Iterable<string> = []
): boolean {
  switch (f) {
    case "all":
      return true;
    case "hot":
      return v.maxImportance >= HOT_IMPORTANCE && isFresh(v.post, now);
    case "rising":
      return v.members.filter((m) => now - Date.parse(m.firstSeenAt) <= RISING_MS && now - Date.parse(m.publishedAt) <= 6 * 3600 * 1000).length >= 2;
    case "bullish":
      return v.post.sentiment === "bullish";
    case "bearish":
      return v.post.sentiment === "bearish";
    case "exchange":
      return v.tier1;
    // Important/Saved are deliberately freshness-agnostic (unlike Hot/Rising): a >48h-old post
    // that's still highly important, or that the user bookmarked, should keep showing once it's
    // loaded into the store (via the 7-day "load older" pagination) — see NewsFeed/store cap notes.
    case "important":
      return isImportantStory(v);
    case "saved":
      return isSavedStory(v, savedIds);
    // The Trump section: visibleStories() has already narrowed the posts to kind "politics".
    case "trump":
      return true;
    default:
      return true;
  }
}

export function visibleStories(
  posts: PostDTO[],
  f: FilterKey,
  portfolio: string[],
  now: number,
  // Named for the persisted store key (`hideLowGnews`, kept as-is so existing users' localStorage
  // isn't migrated) — the predicate it drives was generalised in F2 to every tier-4 source, not
  // just Google News.
  hideLowGnews = false,
  savedIds: Iterable<string> = []
): StoryView[] {
  // Trump news (kind "politics") lives only in the separate Trump section, never in the crypto
  // feed filters, and the Trump section shows nothing else.
  const trumpOnly = f === "trump";
  const scoped = posts.filter((p) => (trumpOnly ? p.kind === "politics" : p.kind !== "politics"));
  // F4 review: "Saved" is exempt from both the hide-low-tier-4 toggle and portfolio narrowing —
  // a bookmark is a deliberate per-item choice, so a low-importance tier-4 post or a coin outside
  // the portfolio the user explicitly starred should still show up under Saved. Every caller
  // (NewsFeed's row list and LeftSidebar's counts) goes through this one function, so the exemption
  // can't drift between the two.
  const exemptSaved = f === "saved";
  const base = !exemptSaved && hideLowGnews ? scoped.filter((p) => !hideLowImportanceTier4(p)) : scoped;
  let views = groupStories(base).filter((v) => matchesStory(v, f, now, savedIds));
  if (!exemptSaved && !trumpOnly && portfolio.length > 0) {
    const set = new Set(portfolio);
    views = views.filter((v) => v.members.some((m) => m.instruments.some((i) => set.has(i.ticker))));
  }
  return views;
}
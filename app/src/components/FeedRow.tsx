"use client";

import { memo } from "react";
import Link from "next/link";
import { Check, ChevronRight, ExternalLink, Star, X } from "lucide-react";
import { useFeedStore } from "@/store/useFeedStore";
import { useLabel } from "@/hooks/useLabel";
import { ageMs, fmtAge, isFresh, isSavedStory, type StoryView } from "@/lib/filters";
import { CATEGORY_STYLE, SENTIMENT_CHIP, fmtDateTime, fmtRet, kindIcon } from "@/lib/ui";
import { faviconUrl } from "@/lib/faviconUrl";

// Shared between the row grid and NewsFeed's header row so the two can never drift apart. Columns:
// expand chevron, age, title (gets the rest — the wider-headline requirement), source, tags, mark.
// Ticker chips live inline at the end of the title cell rather than in their own column — merging
// them in is what actually buys the title its extra room at common (~1280px) widths, per the step 8
// spec, instead of a breakpoint-gated layout.
export const FEED_GRID_COLS = "grid-cols-[18px_48px_minmax(0,1fr)_132px_128px_76px]";

// Row height (h-7) in px — content-visibility's size hint (F3 review) so the browser can skip
// layout/paint for off-screen rows without needing full list virtualization, while still reserving
// the right amount of scrollbar space. Only ever applied to the fixed-height row itself, never to
// the variable-height expanded detail panel below it.
const ROW_CSS_VARS = "[content-visibility:auto] [contain-intrinsic-size:auto_28px]";
// Chips shown inline before falling back to "+N" — kept low (2, not 3) so the title cell's flexible
// text always keeps most of the width even when a row carries several tickers (V1 review).
const MAX_INLINE_TICKERS = 2;

function FeedRowImpl({ story, now, savedSet }: { story: StoryView; now: number; savedSet: ReadonlySet<string> }) {
  const flashAt = useFeedStore((s) => s.flashIds[story.post.id]);
  const expanded = useFeedStore((s) => s.expandedId === story.post.id);
  const toggleExpanded = useFeedStore((s) => s.toggleExpanded);
  const toggleSaved = useFeedStore((s) => s.toggleSaved);
  const { setLabel, busy } = useLabel(story.post);
  const { post, count, maxImportance } = story;

  // Agrees with the Saved filter (isSavedStory checks every clustered member, not just the lead
  // post) so the star's on/off state can never disagree with whether the row shows up under Saved
  // (F2 review). `savedSet` is built once per render in NewsFeed and passed down, not recomputed
  // per row.
  const saved = isSavedStory(story, savedSet);
  const flash = flashAt !== undefined && now - flashAt <= 2500;
  const cat = CATEGORY_STYLE[post.category];
  const ki = kindIcon(post.kind);
  const age = ageMs(post, now);
  const fresh = isFresh(post, now);
  const favicon = faviconUrl(post.sourceDomain);
  const detailId = `feedrow-detail-${post.id}`;

  let rowCls = `grid ${FEED_GRID_COLS} items-center gap-2 h-7 text-xs px-2 border-b border-slate-800/60 hover:bg-slate-800/60 ${ROW_CSS_VARS}`;
  if (flash) rowCls += " row-flash";
  if (post.userLabel === "catalyst") rowCls += " border-l-2 border-emerald-500";

  const inlineTickers = post.instruments.slice(0, MAX_INLINE_TICKERS);
  const extraTickers = post.instruments.length - inlineTickers.length;

  return (
    <div style={post.userLabel === "dismiss" ? { opacity: 0.4 } : undefined}>
      <div className={rowCls}>
        {/* 1. expand */}
        <button
          type="button"
          onClick={() => toggleExpanded(post.id)}
          aria-expanded={expanded}
          aria-controls={detailId}
          aria-label={expanded ? "Collapse details" : "Expand details"}
          className="flex h-4 w-4 shrink-0 items-center justify-center text-slate-500 hover:text-slate-200"
        >
          <ChevronRight className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-90" : ""}`} />
        </button>

        {/* 2. age (relative, absolute time in tooltip) */}
        <span
          className={`font-mono truncate ${fresh ? "text-emerald-400" : "text-slate-500"}`}
          title={`published: ${fmtDateTime(post.publishedAt)}\ncollected: ${fmtDateTime(post.firstSeenAt)}`}
        >
          {fmtAge(age)}
        </span>

        {/* 3. title (+ up to 2 ticker chips inline when there's room) — the title itself is the
            only item that shrinks (flex-1, basis 0) so it never gets crowded out by the icon/chips,
            which claim only their own content width and no more . */}
        <div className="min-w-0 flex items-center gap-1.5 overflow-hidden">
          <ki.Icon className={`h-3.5 w-3.5 shrink-0 ${ki.cls}`} aria-label={ki.label} />
          <Link
            href={`/post/${post.id}`}
            className="min-w-0 flex-1 truncate text-slate-200 hover:text-white"
            title={post.title}
          >
            {post.title}
          </Link>
          {inlineTickers.map((t) => (
            <Link
              key={t.ticker}
              href={`/coin/${t.ticker}`}
              title={`Open ${t.ticker} coin page`}
              className={`shrink-0 rounded border px-1 text-[10px] hover:brightness-125 ${SENTIMENT_CHIP[post.sentiment]}`}
            >
              ${t.ticker}
            </Link>
          ))}
          {extraTickers > 0 && <span className="shrink-0 text-slate-500">+{extraTickers}</span>}
        </div>

        {/* 4. source (favicon + name) */}
        <div className="min-w-0 flex items-center gap-1">
          {favicon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={favicon}
              alt=""
              width={14}
              height={14}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="h-3.5 w-3.5 shrink-0 rounded-sm"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          ) : null}
          <span className="min-w-0 truncate text-slate-400" title={post.sourceName}>
            {post.sourceTier === 1 && post.exchange ? post.exchange : post.sourceDomain}
          </span>
          {count > 1 && (
            <span
              className="shrink-0 rounded border border-slate-600 px-1 text-[10px] text-slate-400"
              title={`${count} sources`}
            >
              +{count - 1}
            </span>
          )}
        </div>

        {/* 5. tags */}
        <div className="min-w-0 flex items-center gap-1.5 overflow-hidden">
          {cat.label && (
            <span className={`shrink-0 rounded border px-1 text-[10px] ${cat.cls}`}>{cat.label}</span>
          )}
          {/* Hidden below `lg` (V1 review) — the least essential tag when width is tight; the
              category badge and ret5m carry more signal per pixel. */}
          <span className="hidden shrink-0 font-mono text-slate-400 lg:inline">{maxImportance}</span>
          {post.ret5m != null && (
            <span
              className={`shrink-0 font-mono ${post.moved5m ? "font-bold " : ""}${
                post.ret5m > 0 ? "text-emerald-400" : post.ret5m < 0 ? "text-rose-400" : "text-slate-400"
              }`}
            >
              {fmtRet(post.ret5m)}
            </span>
          )}
        </div>

        {/* 6. mark */}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            title={saved ? "unsave" : "save"}
            aria-pressed={saved}
            aria-label={saved ? "Remove from saved" : "Save"}
            onClick={() => toggleSaved(story)}
            className={`h-5 w-5 flex items-center justify-center rounded hover:bg-slate-700 ${
              saved ? "text-amber-400" : "text-slate-500"
            }`}
          >
            <Star className="h-3 w-3" fill={saved ? "currentColor" : "none"} />
          </button>
          <button
            type="button"
            title="mark as catalyst"
            disabled={busy}
            onClick={() => setLabel("catalyst")}
            className={`h-5 w-5 flex items-center justify-center rounded hover:bg-slate-700 disabled:opacity-40 ${
              post.userLabel === "catalyst" ? "text-emerald-400" : "text-slate-500"
            }`}
          >
            <Check className="h-3 w-3" />
          </button>
          <button
            type="button"
            title="dismiss"
            disabled={busy}
            onClick={() => setLabel("dismiss")}
            className={`h-5 w-5 flex items-center justify-center rounded hover:bg-slate-700 disabled:opacity-40 ${
              post.userLabel === "dismiss" ? "text-rose-400" : "text-slate-500"
            }`}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      {expanded ? <FeedRowDetail id={detailId} story={story} /> : null}
    </div>
  );
}

function FeedRowDetail({ id, story }: { id: string; story: StoryView }) {
  const { post, members } = story;
  const hasReaction = post.ret1m != null || post.ret5m != null || post.ret15m != null;

  return (
    <div id={id} className="border-b border-slate-800/60 bg-slate-900/40 px-3 py-2.5 text-[11px] text-slate-300">
      <p className="text-slate-200">{post.title}</p>

      {/* V2 review: a strict 2-column (label | value) definition list, one pair per row — the
          previous 2/3-col grid with a col-span-2 "Source" row threw the odd/even cell count off,
          so later labels and values landed in different rows (e.g. "Importance" next to "other",
          its own value "55" a row below, next to "Published"). A fixed 2-col template can't drift
          like that: every dt is immediately followed by its own dd, always. */}
      <dl className="mt-2 grid grid-cols-[110px_minmax(0,1fr)] gap-y-1">
        <dt className="text-slate-500">Source</dt>
        <dd>
          {post.sourceName} (tier {post.sourceTier})
        </dd>
        <dt className="text-slate-500">Category</dt>
        <dd>{CATEGORY_STYLE[post.category].label || post.category}</dd>
        <dt className="text-slate-500">Importance</dt>
        <dd>{story.maxImportance}</dd>
        <dt className="text-slate-500">Published</dt>
        <dd>{fmtDateTime(post.publishedAt)}</dd>
        <dt className="text-slate-500">First seen</dt>
        <dd>{fmtDateTime(post.firstSeenAt)}</dd>
      </dl>

      {post.instruments.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-slate-500">Tickers:</span>
          {post.instruments.map((t) => (
            <Link
              key={t.ticker}
              href={`/coin/${t.ticker}`}
              className={`rounded border px-1.5 py-0.5 text-[10px] hover:brightness-125 ${SENTIMENT_CHIP[post.sentiment]}`}
            >
              ${t.ticker}
            </Link>
          ))}
        </div>
      ) : null}

      {hasReaction ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span className="text-slate-500">Price reaction:</span>
          {(["1m", "5m", "15m"] as const).map((label, i) => {
            const v = [post.ret1m, post.ret5m, post.ret15m][i];
            if (v == null) return null;
            return (
              <span
                key={label}
                className={`font-mono ${v > 0 ? "text-emerald-400" : v < 0 ? "text-rose-400" : "text-slate-400"}`}
              >
                {label} {fmtRet(v)}
              </span>
            );
          })}
        </div>
      ) : null}

      {members.length > 1 ? (
        <div className="mt-2">
          <span className="text-slate-500">{members.length} sources in this story:</span>
          <ul className="mt-1 flex flex-col gap-0.5">
            {members.map((m) => (
              <li key={m.id} className="truncate">
                <a href={m.url} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-sky-400">
                  {m.sourceTier === 1 && m.exchange ? m.exchange : m.sourceDomain}
                </a>
                <span className="text-slate-600"> — {m.title}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-2.5 flex items-center gap-3">
        <a
          href={post.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300"
        >
          Open article <ExternalLink className="h-3 w-3" />
        </a>
        <Link href={`/post/${post.id}`} className="text-slate-400 hover:text-slate-200">
          Details
        </Link>
      </div>
    </div>
  );
}

export const FeedRow = memo(FeedRowImpl);

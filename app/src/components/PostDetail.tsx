"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ExternalLink, Plus, Star, X } from "lucide-react";
import type { PostDTO } from "@/lib/types";
import { useFeedStore } from "@/store/useFeedStore";
import { useLabel } from "@/hooks/useLabel";
import { isSimulated } from "@/lib/simulated";
import { mediaThumb } from "@/lib/mediaThumb";
import { ExplainLoader } from "@/components/explain/ExplainLoader";
import {
  ageMs,
  fmtAge,
  groupStories,
  isFresh,
  isSavedStory,
} from "@/lib/filters";
import {
  CATEGORY_STYLE,
  SENTIMENT_CHIP,
  fmtDateTime,
  fmtPubTime,
  fmtRet,
  kindIcon,
} from "@/lib/ui";

function minutesBetween(aIso: string, bIso: string): number {
  return Math.round((Date.parse(aIso) - Date.parse(bIso)) / 60000);
}

export function PostDetail({ post }: { post: PostDTO }) {
  const posts = useFeedStore((s) => s.posts);
  const addTicker = useFeedStore((s) => s.addTicker);
  const savedList = useFeedStore((s) => s.saved);
  const toggleSaved = useFeedStore((s) => s.toggleSaved);
  const { setLabel, busy } = useLabel(post);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const kind = kindIcon(post.kind);
  const cat = CATEGORY_STYLE[post.category];
  const storyKey = post.storyId ?? post.id;

  const siblings = posts
    .filter((p) => (p.storyId ?? p.id) === storyKey)
    .sort((a, b) => (a.firstSeenAt === b.firstSeenAt ? (a.id < b.id ? -1 : 1) : a.firstSeenAt < b.firstSeenAt ? -1 : 1));

  const storyForSave = { post, members: siblings.length > 0 ? siblings : [post] };
  const saved = isSavedStory(storyForSave, savedList);

  const postTickers = new Set(post.instruments.map((i) => i.ticker));
  const related = groupStories(
    posts.filter((p) => (p.storyId ?? p.id) !== storyKey && p.instruments.some((i) => postTickers.has(i.ticker)))
  ).slice(0, 10);

  const fresh = isFresh(post, now);
  const hot = post.importance >= 70 && fresh;
  const ticker = post.instruments[0]?.ticker;

  const diffMin =
    post.announcementSeenAt && post.symbolSeenAt
      ? minutesBetween(post.symbolSeenAt, post.announcementSeenAt)
      : null;

  const thumb = post.kind === "media" ? mediaThumb(post.url) : null;
  const explainId = post.explainEventId ?? siblings.find((p) => p.explainEventId)?.explainEventId ?? null;

  return (
    <div className="max-w-4xl p-4 text-xs font-mono text-slate-300">
      <Link href="/" className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-300">
        <ArrowLeft className="h-3 w-3" /> back to feed
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-slate-500">
        <span className={`inline-flex items-center gap-1 ${kind.cls}`}>
          <kind.Icon className="h-3 w-3" /> {kind.label}
        </span>
        <span>·</span>
        <span>{post.sourceTier === 1 ? post.exchange : post.sourceDomain}</span>
        <span>·</span>
        <span>published {fmtDateTime(post.publishedAt)}</span>
        <span>·</span>
        <span>{fmtAge(ageMs(post, now))} ago</span>
      </div>

      <h1 className="mt-2 text-lg text-slate-100 font-sans font-semibold">{post.title}</h1>

      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumb}
          alt=""
          width={320}
          height={180}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="mt-3 h-auto max-w-xs rounded border border-slate-800"
        />
      ) : null}

      <div className="mt-2 flex flex-wrap gap-2">
        {cat.label ? (
          <span className={`border px-1.5 py-0.5 text-[10px] ${cat.cls}`}>{cat.label}</span>
        ) : null}
        <span className="border border-slate-600 px-1.5 py-0.5 text-[10px] text-slate-400">
          importance {post.importance}
        </span>
        <span className={`border px-1.5 py-0.5 text-[10px] ${SENTIMENT_CHIP[post.sentiment]}`}>
          {post.sentiment.toUpperCase()}
        </span>
        {hot ? (
          <span className="border border-orange-500/60 px-1.5 py-0.5 text-[10px] text-orange-400">HOT</span>
        ) : null}
        <span
          className={`border px-1.5 py-0.5 text-[10px] ${
            fresh ? "border-emerald-500/50 text-emerald-400" : "border-slate-600 text-slate-600"
          }`}
        >
          {fresh ? "FRESH ≤48h" : "OLDER THAN 48h"}
        </span>
      </div>

      {post.instruments.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {post.instruments.map((inst) => (
            <span key={inst.ticker} className="inline-flex items-center gap-1">
              <Link
                href={`/coin/${inst.ticker}`}
                title={`Open ${inst.ticker} coin page`}
                className={`border px-1.5 py-0.5 ${SENTIMENT_CHIP[post.sentiment]} hover:brightness-125`}
              >
                ${inst.ticker} · {inst.name}
              </Link>
              <button
                onClick={() => addTicker(inst.ticker)}
                title="add to portfolio"
                className="border border-slate-700 px-1 py-0.5 text-slate-500 hover:text-emerald-400"
              >
                <Plus className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {explainId ? (
        <div className="mt-3">
          <ExplainLoader id={explainId} />
        </div>
      ) : null}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => toggleSaved(storyForSave)}
          aria-pressed={saved}
          aria-label={saved ? "Remove from saved" : "Save"}
          className={`inline-flex items-center gap-1 border px-2 py-0.5 ${
            saved ? "border-amber-500 text-amber-400" : "border-slate-600 text-slate-400 hover:text-amber-400"
          }`}
        >
          <Star className="h-3 w-3" fill={saved ? "currentColor" : "none"} /> {saved ? "Saved" : "Save"}
        </button>
        <button
          onClick={() => setLabel("catalyst")}
          disabled={busy}
          className={`border px-2 py-0.5 ${
            post.userLabel === "catalyst"
              ? "border-emerald-500 text-emerald-400"
              : "border-slate-600 text-slate-400 hover:text-emerald-400"
          } disabled:opacity-50`}
        >
          ✓ Catalyst
        </button>
        <button
          onClick={() => setLabel("dismiss")}
          disabled={busy}
          className={`border px-2 py-0.5 ${
            post.userLabel === "dismiss"
              ? "border-rose-500 text-rose-400"
              : "border-slate-600 text-slate-400 hover:text-rose-400"
          } disabled:opacity-50`}
        >
          ✕ Dismiss
        </button>
      </div>
      <p className="mt-1 text-[10px] text-slate-600">
        Personal label — mark stories as useful or noise
      </p>

      <div className="mt-4 border border-slate-800 p-3">
        <h2 className="mb-2 text-[10px] uppercase tracking-wide text-slate-500">Timing</h2>
        <dl className="grid grid-cols-[160px_minmax(0,1fr)] gap-y-1">
          <dt className="text-slate-500">Published</dt>
          <dd>{fmtDateTime(post.publishedAt)}</dd>
          <dt className="text-slate-500">First seen</dt>
          <dd>{fmtDateTime(post.firstSeenAt)}</dd>
          <dt className="text-slate-500">Source tier</dt>
          <dd>Tier {post.sourceTier}</dd>
          <dt className="text-slate-500">Source</dt>
          <dd>{post.sourceName}</dd>
          {post.announcementSeenAt ? (
            <>
              <dt className="text-slate-500">Announcement seen</dt>
              <dd>{fmtDateTime(post.announcementSeenAt)}</dd>
            </>
          ) : null}
          {post.symbolSeenAt ? (
            <>
              <dt className="text-slate-500">Market live</dt>
              <dd>
                {fmtDateTime(post.symbolSeenAt)}
                {diffMin !== null
                  ? diffMin >= 0
                    ? ` (+${diffMin} min after announcement)`
                    : ` (${-diffMin} min before announcement)`
                  : ""}
              </dd>
            </>
          ) : null}
        </dl>
      </div>

      <div className="mt-4 border border-slate-800 p-3">
        <h2 className="mb-2 text-[10px] uppercase tracking-wide text-slate-500">
          Price after first seen{ticker ? ` · ${ticker}` : ""}
        </h2>
        {post.priceStatus === "done" ? (
          <div className="grid grid-cols-3 gap-2">
            {([["1m", post.ret1m], ["5m", post.ret5m], ["15m", post.ret15m]] as const).map(
              ([label, v]) => (
                <div key={label} className="border border-slate-800 p-2 text-center">
                  <div className="text-[10px] text-slate-500">{label}</div>
                  <div
                    className={
                      v == null ? "text-slate-500" : v > 0 ? "text-emerald-400" : v < 0 ? "text-rose-400" : "text-slate-300"
                    }
                  >
                    {fmtRet(v)}
                  </div>
                </div>
              )
            )}
            {post.moved5m ? (
              <div className="col-span-3 text-[10px] text-amber-400">moved ≥1% in 5m</div>
            ) : null}
          </div>
        ) : post.priceStatus === "pending" ? (
          <p className="text-slate-500">
            measuring… available ~16 min after first seen (Binance perp 1m candles)
          </p>
        ) : (
          <p className="text-slate-500">no Binance perp for this coin</p>
        )}
      </div>

      {!isSimulated(post) ? (
        <div className="mt-4">
          <a
            href={post.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300"
          >
            Open original on {post.sourceDomain} <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      ) : null}

      <div className="mt-4 border border-slate-800 p-3">
        <h2 className="mb-2 text-[10px] uppercase tracking-wide text-slate-500">
          Sources in this story ({siblings.length})
        </h2>
        <ul className="space-y-1">
          {siblings.map((p, i) => {
            const c = CATEGORY_STYLE[p.category];
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-2">
                {i === 0 ? (
                  <span className="border border-emerald-500/50 px-1 text-[10px] text-emerald-400">1st</span>
                ) : null}
                <span className="text-slate-500" title={`collected ${fmtDateTime(p.firstSeenAt)}`}>{fmtPubTime(p.publishedAt)}</span>
                <span className="text-slate-400">{p.sourceTier === 1 ? p.exchange : p.sourceDomain}</span>
                <a
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 truncate text-slate-300 hover:text-sky-400"
                >
                  {p.title}
                </a>
                {c.label ? (
                  <span className={`border px-1 text-[10px] ${c.cls}`}>{c.label}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-4 border border-slate-800 p-3">
        <h2 className="mb-2 text-[10px] uppercase tracking-wide text-slate-500">Related news</h2>
        {related.length === 0 ? (
          <p className="text-slate-500">No related news yet.</p>
        ) : (
          <ul className="space-y-1">
            {related.map((v) => {
              const c = CATEGORY_STYLE[v.post.category];
              return (
                <li key={v.post.id}>
                  <Link
                    href={`/post/${v.post.id}`}
                    className="flex flex-wrap items-center gap-2 text-slate-300 hover:bg-slate-800/60"
                  >
                    <span className="text-slate-500">{fmtPubTime(v.post.publishedAt)}</span>
                    <span className="min-w-0 flex-1 truncate">{v.post.title}</span>
                    <span className="text-slate-500">{v.post.exchange ?? v.post.sourceDomain}</span>
                    {c.label ? (
                      <span className={`border px-1 text-[10px] ${c.cls}`}>{c.label}</span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
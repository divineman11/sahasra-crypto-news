import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { serializePost } from "@/lib/serialize";
import type { SourceTab } from "@/lib/sourceTab";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Mirrors newsFile.js: posts up to 5 minutes in the future are still shown (clock skew / scheduled
// publish times slightly ahead of ingest), anything further out is treated as not-yet-published.
const FUTURE_SLACK_MS = 5 * 60 * 1000;

const RANGE_MS: Record<"48h" | "7d", number> = {
  "48h": 48 * 3600 * 1000,
  "7d": 7 * 24 * 3600 * 1000,
};

const TABS = ["all", "news", "exchange", "official", "social", "media"] as const;
type Tab = (typeof TABS)[number];

function isTab(v: string | null): v is Tab {
  return v !== null && (TABS as readonly string[]).includes(v);
}

// Same rules as sourceTab() in src/lib/sourceTab.js, translated into a Prisma `where` fragment.
// We translate rather than fetch-and-filter in JS: counts must reflect the *whole* range (up to 7
// days of posts for a coin), and doing that by loading every row into JS and running sourceTab()
// over it would be unbounded and slow as history grows. Translating the same small rule set into
// SQL keeps every query (the page fetch and each of the 5 count queries) index-friendly and bounded
// by the query planner, not by how many rows we happened to pull back. The two implementations are
// exercised against the same kind/sourceName fixtures in the unit tests, so a
// change to one without the other is caught (including a cross-check that sourceTab() agrees with
// every item this route puts in each tab).
//
// The precedence must mirror sourceTab.js's if/else chain exactly: media, then social, then
// official (kind official/blog OR sourceName "blog:*"), then exchange (kind exchange/symbol), then
// news (everything else). Because "blog:*" is checked as part of the *official* branch before the
// exchange/media/social branches are ever reached in JS, a row with kind "exchange" (or "media") and
// a "blog:*" sourceName is official/media respectively, NOT exchange — so official must exclude rows
// already claimed by media/social, and exchange must exclude "blog:*" sourceNames explicitly (media
// and social don't need that exclusion: their kind check alone already wins earlier in the chain, and
// kind is a single field so it can't simultaneously be "exchange"/"symbol").
function tabWhere(tab: SourceTab): Prisma.PostWhereInput {
  switch (tab) {
    case "media":
      return { kind: "media" };
    case "social":
      return { kind: "social" };
    case "official":
      return {
        kind: { notIn: ["media", "social"] },
        OR: [{ kind: { in: ["official", "blog"] } }, { sourceName: { startsWith: "blog:" } }],
      };
    case "exchange":
      return {
        kind: { in: ["exchange", "symbol"] },
        NOT: { sourceName: { startsWith: "blog:" } },
      };
    case "news":
    default:
      return {
        kind: { notIn: ["media", "social", "official", "blog", "exchange", "symbol"] },
        NOT: { sourceName: { startsWith: "blog:" } },
      };
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
): Promise<NextResponse> {
  const { ticker: rawTicker } = await params;
  const ticker = (rawTicker ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!ticker) {
    return NextResponse.json({ error: "ticker required" }, { status: 400 });
  }

  const sp = req.nextUrl.searchParams;
  const range: "48h" | "7d" = sp.get("range") === "7d" ? "7d" : "48h";
  const tabInput = sp.get("tab");
  const tab: Tab = isTab(tabInput) ? tabInput : "all";

  const impInput = Number.parseInt(sp.get("minImportance") ?? "", 10);
  const minImportance = Number.isFinite(impInput) ? Math.min(100, Math.max(0, impInput)) : 0;

  let limit = Number.parseInt(sp.get("limit") ?? "100", 10);
  if (!Number.isFinite(limit)) limit = 100;
  limit = Math.min(300, Math.max(1, limit));

  const cursor = sp.get("cursor");

  try {
    const instrument = await prisma.instrument.findUnique({ where: { ticker } });
    if (!instrument) {
      return NextResponse.json({ error: "unknown ticker" }, { status: 404 });
    }

    let cursorRow: { id: string; publishedAt: Date } | null = null;
    if (cursor) {
      cursorRow = await prisma.post.findUnique({
        where: { id: cursor },
        select: { id: true, publishedAt: true },
      });
      if (!cursorRow) {
        return NextResponse.json({ error: "invalid cursor" }, { status: 400 });
      }
    }

    const now = Date.now();
    const baseWhere: Prisma.PostWhereInput = {
      instruments: { some: { ticker } },
      publishedAt: {
        gte: new Date(now - RANGE_MS[range]),
        lte: new Date(now + FUTURE_SLACK_MS),
      },
      importance: { gte: minImportance },
      OR: [{ userLabel: null }, { userLabel: { not: "dismiss" } }],
    };

    const activeWhere: Prisma.PostWhereInput =
      tab === "all" ? baseWhere : { AND: [baseWhere, tabWhere(tab)] };

    // Keyset pagination on (publishedAt, id) rather than Prisma's `cursor: {id}, skip: 1`: skip-1
    // assumes the cursor row itself still matches `where`, which isn't guaranteed (it may have been
    // dismissed, or its importance may have dropped below minImportance, between page fetches) — in
    // that case Prisma's keyset+OFFSET silently drops the row right after the missing cursor instead
    // of returning it. An explicit "strictly before the cursor's (publishedAt, id)" filter has no such
    // failure mode: it only depends on the cursor row's own timestamp/id, not on it still matching.
    const pageWhere: Prisma.PostWhereInput = cursorRow
      ? {
          AND: [
            activeWhere,
            {
              OR: [
                { publishedAt: { lt: cursorRow.publishedAt } },
                { publishedAt: cursorRow.publishedAt, id: { lt: cursorRow.id } },
              ],
            },
          ],
        }
      : activeWhere;

    const [rows, countAll, countNews, countExchange, countOfficial, countSocial, countMedia, countImportant] =
      await Promise.all([
        prisma.post.findMany({
          where: pageWhere,
          orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
          take: limit + 1,
          include: { instruments: true, votes: true },
        }),
        prisma.post.count({ where: baseWhere }),
        prisma.post.count({ where: { AND: [baseWhere, tabWhere("news")] } }),
        prisma.post.count({ where: { AND: [baseWhere, tabWhere("exchange")] } }),
        prisma.post.count({ where: { AND: [baseWhere, tabWhere("official")] } }),
        prisma.post.count({ where: { AND: [baseWhere, tabWhere("social")] } }),
        prisma.post.count({ where: { AND: [baseWhere, tabWhere("media")] } }),
        prisma.post.count({ where: { AND: [baseWhere, { importance: { gte: 50 } }] } }),
      ]);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && page.length > 0 ? page[page.length - 1].id : null;

    return NextResponse.json(
      {
        ticker,
        name: instrument.name,
        range,
        tab,
        counts: {
          all: countAll,
          news: countNews,
          exchange: countExchange,
          official: countOfficial,
          social: countSocial,
          media: countMedia,
          important: countImportant,
        },
        items: page.map(serializePost),
        nextCursor,
      },
      { headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } }
    );
  } catch (err) {
    console.error("coin route error", err);
    return NextResponse.json({ error: "database unavailable" }, { status: 500 });
  }
}

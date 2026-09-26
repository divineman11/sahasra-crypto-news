import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { serializePost } from "@/lib/serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;
// Bounds how many candidate instruments we score by count7d before picking the top 10. Wide enough
// that a real query (a ticker prefix or a word in a coin name) never plausibly has more matches than
// this in the ~500-instrument universe this app tracks, while keeping the count7d fan-out queries bounded.
const COIN_CANDIDATE_LIMIT = 50;

// Prisma's `contains`/`startsWith` compile to Postgres LIKE/ILIKE, where "%" and "_" are wildcards
// and "\" is the (default) escape character — a raw user query containing any of those would be
// interpreted as a pattern rather than literal text (q="%" matching every row, q with "_" matching
// any single character there). Escape all three before they reach a `contains`/`startsWith` filter.
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const sp = req.nextUrl.searchParams;
  const qRaw = sp.get("q") ?? "";
  const q = qRaw.trim();

  if (q.length < 1 || q.length > 64) {
    return NextResponse.json({ error: "q must be 1-64 characters" }, { status: 400 });
  }

  let limit = Number.parseInt(sp.get("limit") ?? "30", 10);
  if (!Number.isFinite(limit)) limit = 30;
  limit = Math.min(100, Math.max(1, limit));

  const qUpper = q.toUpperCase();
  const likeQ = escapeLike(q);
  const likeQUpper = escapeLike(qUpper);
  const notDismissed: Prisma.PostWhereInput = {
    OR: [{ userLabel: null }, { userLabel: { not: "dismiss" } }],
  };

  try {
    const [candidates, exactInstrument, posts] = await Promise.all([
      prisma.instrument.findMany({
        where: {
          OR: [
            { ticker: { startsWith: likeQUpper, mode: "insensitive" } },
            { name: { contains: likeQ, mode: "insensitive" } },
          ],
        },
        take: COIN_CANDIDATE_LIMIT,
        orderBy: { ticker: "asc" },
      }),
      // An exact ticker match must always be scored and ranked first, even if the candidate query
      // above (bounded to COIN_CANDIDATE_LIMIT, alphabetical) doesn't happen to include it.
      prisma.instrument.findUnique({ where: { ticker: qUpper } }),
      prisma.post.findMany({
        where: {
          title: { contains: likeQ, mode: "insensitive" },
          publishedAt: { gte: new Date(Date.now() - SEVEN_DAYS_MS) },
          ...notDismissed,
        },
        orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
        take: limit,
        include: { instruments: true, votes: true },
      }),
    ]);

    const candidateMap = new Map(candidates.map((c) => [c.ticker, c]));
    if (exactInstrument) candidateMap.set(exactInstrument.ticker, exactInstrument);

    const withCounts = await Promise.all(
      [...candidateMap.values()].map(async (inst) => ({
        ticker: inst.ticker,
        name: inst.name,
        count7d: await prisma.post.count({
          where: {
            instruments: { some: { ticker: inst.ticker } },
            publishedAt: { gte: new Date(Date.now() - SEVEN_DAYS_MS) },
            ...notDismissed,
          },
        }),
      }))
    );

    withCounts.sort((a, b) => {
      const aExact = a.ticker === qUpper;
      const bExact = b.ticker === qUpper;
      if (aExact !== bExact) return aExact ? -1 : 1;
      if (b.count7d !== a.count7d) return b.count7d - a.count7d;
      return a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0;
    });

    return NextResponse.json(
      {
        coins: withCounts.slice(0, 10),
        posts: posts.map(serializePost),
      },
      { headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } }
    );
  } catch (err) {
    console.error("search route error", err);
    return NextResponse.json({ error: "database unavailable" }, { status: 500 });
  }
}

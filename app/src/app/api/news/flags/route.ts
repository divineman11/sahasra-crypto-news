import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializePost } from "@/lib/serialize";
import { parseSince } from "@/lib/since";
import type { PostDTO } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface TopItem {
  id: string;
  title: string;
  url: string;
  category: string;
  importance: number;
  sentiment: string;
  source: string;
  firstSeenAt: string;
}

interface Flag {
  count: number;
  maxImportance: number;
  latestSeenAt: string;
  top: TopItem[];
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const sp = req.nextUrl.searchParams;
  const sinceInput = sp.get("since");
  const sinceMs = parseSince(sinceInput);
  const sinceDate = new Date(Date.now() - sinceMs);
  const n = Number.parseInt(sp.get("minImportance") ?? "", 10);
  const minImportance = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 50;

  const rawTickers = sp.get("tickers");
  let tickers: string[] | null = null;
  if (rawTickers !== null && rawTickers.trim() !== "") {
    tickers = rawTickers
      .split(",")
      .map((t) => t.trim().toUpperCase().replace(/[^A-Z0-9]/g, ""))
      .filter((t) => t.length > 0)
      .slice(0, 200);
    if (tickers.length === 0) tickers = [];
  }

  try {
    const posts = await prisma.post.findMany({
      where: {
        publishedAt: { gte: sinceDate },
        firstSeenAt: { gte: sinceDate },
        importance: { gte: minImportance },
        OR: [{ userLabel: null }, { userLabel: { not: "dismiss" } }],
        ...(tickers !== null && tickers.length > 0
          ? { instruments: { some: { ticker: { in: tickers } } } }
          : {}),
      },
      orderBy: [{ firstSeenAt: "desc" }, { id: "desc" }],
      include: { instruments: true, votes: true },
    });

    const dtos = posts.map(serializePost);
    const byTicker = new Map<string, PostDTO[]>();
    for (const p of dtos) {
      for (const inst of p.instruments) {
        if (tickers !== null && tickers.length > 0 && !tickers.includes(inst.ticker)) continue;
        const arr = byTicker.get(inst.ticker) ?? [];
        arr.push(p);
        byTicker.set(inst.ticker, arr);
      }
    }

    const flags: Record<string, Flag> = {};
    for (const [ticker, list] of byTicker) {
      const sorted = [...list].sort((a, b) => b.importance - a.importance);
      const top: TopItem[] = sorted.slice(0, 3).map((p) => ({
        id: p.id,
        title: p.title,
        url: p.url,
        category: p.category,
        importance: p.importance,
        sentiment: p.sentiment,
        source: p.exchange ?? p.sourceDomain,
        firstSeenAt: p.firstSeenAt,
      }));
      let latest = list[0].firstSeenAt;
      for (const p of list) {
        if (p.firstSeenAt > latest) latest = p.firstSeenAt;
      }
      flags[ticker] = {
        count: list.length,
        maxImportance: sorted[0].importance,
        latestSeenAt: latest,
        top,
      };
    }

    const effectiveWindowHours = Math.round(sinceMs / 3_600_000);
    return NextResponse.json(
      {
        asof: new Date().toISOString(),
        window: sinceInput !== null ? `${effectiveWindowHours}h` : "48h",
        minImportance,
        flags,
      },
      { headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } }
    );
  } catch (err) {
    console.error("flags route error", err);
    return NextResponse.json({ error: "database unavailable" }, { status: 500 });
  }
}
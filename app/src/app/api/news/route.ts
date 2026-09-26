import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializePost } from "@/lib/serialize";
import { parseSince } from "@/lib/since";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const sp = req.nextUrl.searchParams;
  const ticker = (sp.get("ticker") ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!ticker) {
    return NextResponse.json({ error: "ticker required" }, { status: 400 });
  }

  const sinceInput = sp.get("since");
  const sinceMs = parseSince(sinceInput);
  const n = Number.parseInt(sp.get("minImportance") ?? "", 10);
  const minImportance = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
  const limit = Math.min(100, Math.max(1, parseInt(sp.get("limit") ?? "20", 10) || 20));

  try {
    const where = {
      instruments: { some: { ticker } },
      publishedAt: { gte: new Date(Date.now() - sinceMs) },
      importance: { gte: minImportance },
      OR: [{ userLabel: null }, { userLabel: { not: "dismiss" } }],
    };

    const [posts, totalCount, importantCount] = await Promise.all([
      prisma.post.findMany({
        where,
        orderBy: [{ firstSeenAt: "desc" }, { id: "desc" }],
        take: limit,
        include: { instruments: true, votes: true },
      }),
      prisma.post.count({ where }),
      prisma.post.count({ where: { ...where, importance: { gte: Math.max(50, minImportance) } } }),
    ]);

    return NextResponse.json(
      {
        ticker,
        since: sinceMs === 48 * 60 * 60 * 1000 ? "48h" : (sinceInput ?? "48h"),
        minImportance,
        count: posts.length,
        totalCount,
        importantCount,
        items: posts.map(serializePost),
      },
      { headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } }
    );
  } catch (err) {
    console.error("news route error", err);
    return NextResponse.json({ error: "database unavailable" }, { status: 500 });
  }
}
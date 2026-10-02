import { NextRequest, NextResponse } from "next/server";
import { listExplain } from "@/lib/explainServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/explain?limit=20&coin=STO -> { events }.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(100, Math.max(1, parseInt(sp.get("limit") ?? "20", 10) || 20));
  const coin = (sp.get("coin") ?? "").replace(/[^A-Za-z0-9]/g, "") || null;
  return NextResponse.json({ events: listExplain(limit, coin) }, { headers: { "Cache-Control": "no-store" } });
}

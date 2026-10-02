import { NextResponse } from "next/server";
import { readUnlockView } from "@/lib/unlocksServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/unlocks            -> the whole calendar view
// GET /api/unlocks?coin=BTC   -> only that coin's upcoming unlocks (plus its gaps / cross-check rows)
export async function GET(req: Request): Promise<NextResponse> {
  const view = readUnlockView();
  const headers = { "Cache-Control": "no-store" };
  if (!view) return NextResponse.json({ available: false, view: null }, { headers });
  const coin = new URL(req.url).searchParams.get("coin");
  if (!coin) return NextResponse.json({ available: true, view }, { headers });
  const T = coin.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const nowS = Date.now() / 1000;
  const slim = {
    ...view,
    upcoming: view.upcoming.filter((u) => u.symbol === T && u.ts >= nowS - 24 * 3600),
    missing: view.missing.filter((m) => m.symbol === T),
    anniversaries: view.anniversaries.filter((a) => a.symbol === T),
    crosscheck: view.crosscheck ? { ...view.crosscheck, items: view.crosscheck.items.filter((i) => i.symbol === T) } : null,
  };
  return NextResponse.json({ available: true, view: slim }, { headers });
}

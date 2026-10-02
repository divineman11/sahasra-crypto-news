import { NextResponse } from "next/server";
import { getExplain } from "@/lib/explainServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  const event = /^evt_[A-Za-z0-9_\-]{1,120}$/.test(id) ? getExplain(id) : null;
  if (!event) return NextResponse.json({ error: "event not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ event }, { headers: { "Cache-Control": "no-store" } });
}

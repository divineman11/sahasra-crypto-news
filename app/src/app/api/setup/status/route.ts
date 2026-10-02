import path from "path";
import { NextResponse } from "next/server";
import { computeStatus } from "../../../../../ingest/setupStatus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/setup/status -> which safety features are ON / OFF / WARN, with a plain fix for each.
// Contains no secrets: only yes/no states and short text (never the webhook URL or the commands).
export async function GET(): Promise<NextResponse> {
  const status = computeStatus({ env: process.env, cacheDir: path.join(process.cwd(), "ingest", "cache"), phase: "live" });
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}

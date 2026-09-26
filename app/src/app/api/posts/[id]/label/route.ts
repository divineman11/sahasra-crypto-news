import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializePost } from "@/lib/serialize";
import { updateHotList } from "@/lib/hotList";
import type { UserLabel } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f-]{36}$/i;
const ALLOWED_ORIGINS = new Set(["http://localhost:4180", "http://127.0.0.1:4180"]);

function isValidLabel(v: unknown): v is UserLabel | null {
  return v === null || v === "catalyst" || v === "dismiss";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;

  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    return NextResponse.json({ error: "unsupported media type" }, { status: 415 });
  }
  const origin = req.headers.get("origin");
  if (origin !== null && !ALLOWED_ORIGINS.has(origin)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const label = (body as { label?: unknown } | null)?.label;
  if (!isValidLabel(label)) {
    return NextResponse.json({ error: "invalid label" }, { status: 400 });
  }

  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  try {
    const existing = await prisma.post.findUnique({
      where: { id },
      select: { id: true, storyId: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const storyId = existing.storyId ?? existing.id;
    await prisma.post.updateMany({
      where: { OR: [{ storyId }, { id: storyId }] },
      data: { userLabel: label },
    });

    const updated = await prisma.post.findMany({
      where: { OR: [{ storyId }, { id: storyId }] },
      include: { instruments: true, votes: true },
    });

    for (const post of updated) {
      const dto = serializePost(post);
      await updateHotList(post.id, JSON.stringify(dto));
    }

    const clicked = updated.find((p) => p.id === id) ?? updated[0];
    const dto = clicked ? serializePost(clicked) : null;
    return NextResponse.json({ post: dto }, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e?.code === "P2025") {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    console.error("label route error", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
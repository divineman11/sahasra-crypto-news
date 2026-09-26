import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { serializePost } from "@/lib/serialize";
import type { VoteType } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_TYPES: VoteType[] = ["bullish", "bearish", "important", "toxic"];

const UPDATE_HOT_LUA = `local items = redis.call("LRANGE", KEYS[1], 0, -1)
for i, s in ipairs(items) do
  local ok, obj = pcall(cjson.decode, s)
  if ok and type(obj) == "table" and obj.id == ARGV[1] then
    redis.call("LSET", KEYS[1], i - 1, ARGV[2])
    return i - 1
  end
end
return -1`;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().includes("application/json")) {
    return NextResponse.json({ error: "content-type must be application/json" }, { status: 415 });
  }
  const origin = req.headers.get("origin");
  if (origin && !["http://localhost:4180", "http://127.0.0.1:4180"].includes(origin)) {
    return NextResponse.json({ error: "forbidden origin" }, { status: 403 });
  }

  const { id } = await params;

  let type: string;
  try {
    const body = await req.json();
    type = body?.type;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (typeof type !== "string" || !VALID_TYPES.includes(type as VoteType)) {
    return NextResponse.json({ error: "invalid vote type" }, { status: 400 });
  }

  try {
    const post = await prisma.post.findUnique({ where: { id }, select: { id: true } });
    if (!post) {
      return NextResponse.json({ error: "post not found" }, { status: 404 });
    }

    const create: Prisma.VoteDataUncheckedCreateInput = { postId: id, [type]: 1 };
    const update: Prisma.VoteDataUncheckedUpdateInput = { [type]: { increment: 1 } };

    await prisma.voteData.upsert({
      where: { postId: id },
      create,
      update,
    });

    const reloaded = await prisma.post.findUnique({
      where: { id },
      include: { instruments: true, votes: true },
    });
    if (!reloaded) {
      return NextResponse.json({ error: "post not found" }, { status: 404 });
    }

    const dto = serializePost(reloaded);

    try {
      const json = JSON.stringify(dto);
      await redis.eval(UPDATE_HOT_LUA, 1, "news:hot", id, json);
      await redis.publish("news:update", json);
    } catch (pubErr) {
      console.error("[api/vote] redis publish failed:", pubErr);
    }

    return NextResponse.json({ post: dto }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[api/vote] error:", err);
    return NextResponse.json({ error: "internal server error" }, { status: 500 });
  }
}
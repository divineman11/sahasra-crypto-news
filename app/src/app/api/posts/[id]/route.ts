import { prisma } from "@/lib/prisma";
import { serializePost } from "@/lib/serialize";
import { withExplain } from "@/lib/explainServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return Response.json({ error: "post not found" }, { status: 404 });
  }

  try {
    const p = await prisma.post.findUnique({
      where: { id },
      include: { instruments: true, votes: true },
    });
    if (!p) {
      return Response.json({ error: "post not found" }, { status: 404 });
    }
    return Response.json(
      { post: withExplain(serializePost(p)) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return Response.json({ error: "database unavailable" }, { status: 500 });
  }
}
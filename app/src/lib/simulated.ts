import type { PostDTO } from "@/lib/types";

export function isSimulated(post: Pick<PostDTO, "id" | "url">): boolean {
  if (post.id.startsWith("mock-")) return true;
  try {
    return new URL(post.url).hostname.endsWith(".local");
  } catch {
    return true;
  }
}
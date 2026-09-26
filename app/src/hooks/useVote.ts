"use client";

import { useState } from "react";
import type { PostDTO, VoteType } from "@/lib/types";
import { useFeedStore } from "@/store/useFeedStore";

export function useVote(post: PostDTO): {
  vote: (type: VoteType) => Promise<void>;
  busy: boolean;
  voted: VoteType[];
} {
  const [busy, setBusy] = useState(false);
  const applyLocalVote = useFeedStore((s) => s.applyLocalVote);
  const upsertPost = useFeedStore((s) => s.upsertPost);
  const voted = useFeedStore((s) => s.myVotes[post.id]) ?? [];
  const recordMyVote = useFeedStore((s) => s.recordMyVote);

  async function vote(type: VoteType): Promise<void> {
    if (busy) return;
    if (voted.includes(type)) return;
    if (post.id.startsWith("mock-")) {
      applyLocalVote(post.id, type);
      recordMyVote(post.id, type);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/posts/${post.id}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      if (res.ok) {
        const data = await res.json();
        upsertPost(data.post, false);
        recordMyVote(post.id, type);
      }
    } catch {
      // swallow network errors
    } finally {
      setBusy(false);
    }
  }

  return { vote, busy, voted };
}
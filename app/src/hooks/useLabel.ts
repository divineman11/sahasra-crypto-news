"use client";

import { useCallback, useState } from "react";
import type { PostDTO, UserLabel } from "@/lib/types";
import { useFeedStore } from "@/store/useFeedStore";

export function useLabel(post: PostDTO): {
  setLabel: (l: UserLabel | null) => Promise<void>;
  busy: boolean;
} {
  const [busy, setBusy] = useState(false);

  const setLabel = useCallback(
    async (l: UserLabel | null) => {
      const effective = l === post.userLabel ? null : l;
      setBusy(true);
      try {
        const res = await fetch(`/api/posts/${post.id}/label`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: effective }),
        });
        if (res.ok) {
          const data = (await res.json()) as { post: PostDTO };
          useFeedStore.getState().upsertPost(data.post, false);
        }
      } catch {
        // swallow network errors
      } finally {
        setBusy(false);
      }
    },
    [post.id, post.userLabel]
  );

  return { setLabel, busy };
}
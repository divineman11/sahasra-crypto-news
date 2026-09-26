"use client";

import type { ReactNode } from "react";
import { useFeedSocket } from "@/hooks/useFeedSocket";
import { useHydratePosts } from "@/hooks/useHydratePosts";

export function FeedProvider({ children }: { children: ReactNode }) {
  useFeedSocket();
  useHydratePosts();
  return <>{children}</>;
}
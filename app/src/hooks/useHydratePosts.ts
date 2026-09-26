"use client";

import { useEffect } from "react";
import { fetchLatest } from "@/lib/feedApi";

export function useHydratePosts(): void {
  useEffect(() => {
    fetchLatest().catch((err) =>
      console.warn("hydrate failed, keeping mock data", err)
    );
  }, []);
}
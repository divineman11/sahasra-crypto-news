import type { Kind } from "./types";

export type SourceTab = "news" | "exchange" | "official" | "social" | "media";

export const SOURCE_TABS: readonly SourceTab[];

export function sourceTab(post: { kind?: Kind | string | null; sourceName?: string | null }): SourceTab;

export function hideLowImportanceTier4(post: {
  sourceTier?: number | null;
  importance?: number | null;
}): boolean;

/** @deprecated alias of hideLowImportanceTier4, kept for backward compatibility */
export const hideLowImportanceGnews: typeof hideLowImportanceTier4;

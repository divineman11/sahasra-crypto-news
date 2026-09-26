export const IMPORTANT_MIN_IMPORTANCE: number;
export const MAX_SAVED_IDS: number;

export function isImportantStory(story: { maxImportance?: number } | null | undefined): boolean;

export function isSavedStory(
  story: { post?: { id?: string }; members?: { id?: string }[] } | null | undefined,
  savedIds: Iterable<string>
): boolean;

export function addSavedId(list: string[] | null | undefined, id: string, max?: number): string[];
export function removeSavedId(list: string[] | null | undefined, id: string): string[];

export function toggleSavedMembers(
  list: string[] | null | undefined,
  story: { post?: { id?: string }; members?: { id?: string }[] } | null | undefined,
  max?: number
): string[];

// Pure predicates for the "Important" and "Saved" feed filters, plus the saved-id list cap logic
// — kept in a plain CommonJS module (not lib/filters.ts) so they can be unit-tested directly from
// the Node test suite the same way sourceTab.js / mediaThumb.js are (Node can't require a .ts
// file). lib/filters.ts re-exports these for the app; store/useFeedStore.ts uses addSavedId /
// removeSavedId directly to maintain the persisted `saved` list.
//
// Plain CommonJS (no TS syntax), same pattern as sourceTab.js / mediaThumb.js next to it: it loads
// unmodified both from the Next.js app (via allowJs + storyFilters.d.ts) and from the Node test
// suites (`require(APP + '/src/lib/storyFilters.js')`).

const IMPORTANT_MIN_IMPORTANCE = 50;
const MAX_SAVED_IDS = 500;

/**
 * "Important" = the story's highest member importance is >= 50 — no freshness requirement (unlike
 * Hot, which additionally requires <=48h), matching /api/coin's `important` count (>= 50, over
 * whatever range/tab is active) so the two "important" concepts in the app agree.
 * @param {{maxImportance?: number}} story a StoryView (or anything with a numeric maxImportance)
 * @returns {boolean}
 */
function isImportantStory(story) {
  return !!story && typeof story.maxImportance === 'number' && story.maxImportance >= IMPORTANT_MIN_IMPORTANCE;
}

/**
 * A story is "saved" when any of its clustered member posts has been bookmarked, not just its
 * lead post — a duplicate of a saved story arriving from a second source shouldn't need a second
 * bookmark.
 * @param {{post?: {id?: string}, members?: {id?: string}[]}} story a StoryView
 * @param {Iterable<string>} savedIds
 * @returns {boolean}
 */
function isSavedStory(story, savedIds) {
  if (!story) return false;
  const set = savedIds instanceof Set ? savedIds : new Set(savedIds || []);
  const members = Array.isArray(story.members) && story.members.length > 0 ? story.members : [story.post];
  return members.some((m) => m && set.has(m.id));
}

/**
 * Adds `id` to the front of `list` (most-recently-saved first), de-duplicating, and caps the
 * result at `max` entries by dropping the oldest (the tail) — pure, so re-adding an id already in
 * the list is a no-op reorder to the front, not growth.
 * @param {string[]|null|undefined} list
 * @param {string} id
 * @param {number} [max]
 * @returns {string[]}
 */
function addSavedId(list, id, max) {
  const cap = typeof max === 'number' && max > 0 ? max : MAX_SAVED_IDS;
  const base = Array.isArray(list) ? list : [];
  if (!id) return base.slice(0, cap);
  const next = [id, ...base.filter((x) => x !== id)];
  return next.length > cap ? next.slice(0, cap) : next;
}

/**
 * @param {string[]|null|undefined} list
 * @param {string} id
 * @returns {string[]}
 */
function removeSavedId(list, id) {
  const base = Array.isArray(list) ? list : [];
  return base.filter((x) => x !== id);
}

/**
 * The single toggle rule the star button (FeedRow) and PostDetail's Save button both use, so the
 * star's on/off state always agrees with isSavedStory() / the Saved filter — F2 review: toggling
 * used to add/remove only the lead post's id, so a story whose *non-lead* member had been saved
 * (isSavedStory() true via that member) showed the star as OFF, and clicking it would ADD the lead
 * id instead of clearing the save.
 *
 * Rule: if ANY member of the story is currently saved, unsave the whole story (remove every
 * member's id, not just whichever one was actually in the list — cheap and self-healing against any
 * legacy/partial state). Otherwise save it by adding just the story's lead post id (matching how
 * isSavedStory() already treats "any member saved" as sufficient to read the story as saved).
 * @param {string[]|null|undefined} list current saved-id list
 * @param {{post?: {id?: string}, members?: {id?: string}[]}} story a StoryView
 * @param {number} [max]
 * @returns {string[]}
 */
function toggleSavedMembers(list, story, max) {
  const base = Array.isArray(list) ? list : [];
  const members = Array.isArray(story && story.members) && story.members.length > 0 ? story.members : [story && story.post];
  const memberIds = members.map((m) => m && m.id).filter(Boolean);
  const set = new Set(base);
  const anySaved = memberIds.some((id) => set.has(id));
  if (anySaved) {
    const removeSet = new Set(memberIds);
    return base.filter((id) => !removeSet.has(id));
  }
  const leadId = story && story.post && story.post.id;
  return leadId ? addSavedId(base, leadId, max) : base.slice();
}

module.exports = {
  IMPORTANT_MIN_IMPORTANCE,
  MAX_SAVED_IDS,
  isImportantStory,
  isSavedStory,
  addSavedId,
  removeSavedId,
  toggleSavedMembers,
};

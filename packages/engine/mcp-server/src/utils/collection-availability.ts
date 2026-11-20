/**
 * How a FamilySearch collection can be searched, from its catalog counts: the one
 * label `collections_search`, `research_append`'s locality stamp and
 * `project_context` give research-plan, so the planner copies it rather than
 * reading counts.
 *
 * Browse-only: no indexed person, or fewer than one per thousand images. About
 * 27 of FamilySearch's 3,519 collections have a handful of indexed persons over
 * millions of page images (Pennsylvania, Probate Records: 52 persons, 3.2 million
 * images; New York, Probate Records: 59 in 14 million). A name search there finds
 * nothing and reads as a real nil. The next collection up holds about 1,700 per
 * million (catalog, 2026-11-20).
 */
export type CollectionAvailability = "name-searchable" | "browse-only";

/** Below this many indexed persons per image a collection is browse-only. */
export const BROWSE_ONLY_PERSONS_PER_IMAGE = 0.001;

/** The label for these counts, or null when the person count is unknown. An
 *  unknown or zero image count leaves the person count alone to decide. */
export function collectionAvailability(personCount: unknown, imageCount?: unknown): CollectionAvailability | null {
  if (typeof personCount !== "number" || !Number.isInteger(personCount) || personCount < 0) return null;
  if (personCount === 0) return "browse-only";
  if (
    typeof imageCount === "number" &&
    Number.isFinite(imageCount) &&
    imageCount > 0 &&
    personCount / imageCount < BROWSE_ONLY_PERSONS_PER_IMAGE
  ) {
    return "browse-only";
  }
  return "name-searchable";
}

import { findSchemaIds, sectionForId } from './schemaIds'

/**
 * The card a chip names, or null.
 *
 * "A chip ... opens the card it names." Measured on the captured session: 544 of
 * 1,009 chips name a schema id in their summary, and 519 of those name exactly one,
 * so the target is unambiguous for 95% of them.
 *
 * Where a chip names several (25 in the capture) the FIRST is taken: it is the
 * subject of the call in every sample, and a chip cannot open two cards at once.
 *
 * Null for a chip that names nothing, or that names an id inside a URL — in each case
 * the chip stays exactly as unclickable as it is today.
 *
 * The `section` check in the loop is DEFENSIVE, not load-bearing, and a mutation test
 * proved it: `findSchemaIds` and `sectionForId` are driven by the same prefix set, so
 * a found id always resolves and the skip branch is unreachable today. It is kept for
 * the day a prefix is added to one and not the other — which `schemaIds.test.ts`
 * already pins from the other direction ("covers every prefix it claims to know").
 * Reuses the finder the prose linker already uses, so both agree on what an
 * identifier is and neither can drift from the other.
 */
export function chipTarget(summary: string): { id: string; section: string } | null {
  for (const hit of findSchemaIds(summary ?? '')) {
    const section = sectionForId(hit.id)
    if (section) return { id: hit.id, section }
  }
  return null
}

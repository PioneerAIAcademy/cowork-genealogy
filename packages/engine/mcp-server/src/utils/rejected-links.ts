/**
 * Rejections a researcher has recorded, and the refusal they buy.
 *
 * Ruled 2026-09-30: a rejection is its OWN record, not a fourth `confidence` value.
 * That field means "how sure are we this IS a match" — `confident | probable |
 * speculative` — and "rejected" is the opposite claim, not a weaker degree of it.
 * Every reader of `confidence` would otherwise have to learn a value meaning
 * "ignore this row".
 *
 * Why it must be remembered rather than deleted: in the reported case a researcher
 * challenged an assumption and the agent reverted to it, because nothing recorded
 * the rivals. Deleting a link loses the fact that a person said no.
 *
 * Decidable from `research.json` alone, so per ADR-0011 the writer tool enforces it
 * rather than a skill body asking the model to remember — a rule in prose is a rule
 * the model may not follow.
 */

export interface RejectedLink {
  id?: unknown;
  assertion_id?: unknown;
  person_id?: unknown;
  reason?: unknown;
  created?: unknown;
  [k: string]: unknown;
}

function pairMatches(r: unknown, assertionId: string, personId: string): boolean {
  if (!r || typeof r !== "object") return false;
  const rec = r as RejectedLink;
  return rec.assertion_id === assertionId && rec.person_id === personId;
}

/** The rejection covering this pair, or null. Returned rather than a bare boolean so
 *  a refusal can quote the researcher's own reason back to them. */
export function rejectionFor(
  assertionId: string,
  personId: string,
  rejected: RejectedLink[] | undefined
): RejectedLink | null {
  for (const r of rejected ?? []) {
    if (pairMatches(r, assertionId, personId)) return r as RejectedLink;
  }
  return null;
}

/**
 * Whether this exact (assertion, person) pair has been rejected.
 *
 * Exact: rejecting "this record is not Mary" says nothing about her sister, and
 * nothing about a different record for Mary. A broader rule would silently block
 * work the researcher never objected to.
 */
export function isRejectedPair(
  assertionId: string,
  personId: string,
  rejected: RejectedLink[] | undefined
): boolean {
  return rejectionFor(assertionId, personId, rejected) !== null;
}

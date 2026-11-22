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

import { isLiveAssertion } from "./assertion-liveness.js";
import { isTwoParty, recordPartyKeyer, sameRecord } from "./record-persona.js";

export interface RejectedLink {
  id?: unknown;
  assertion_id?: unknown;
  person_id?: unknown;
  reason?: unknown;
  created?: unknown;
  [k: string]: unknown;
}

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/**
 * The ids of every assertion a rejection covers: the rejected assertion itself,
 * plus every other live assertion of the same record entry, the party
 * `recordPartyKeyer` keys it on (the key `research_append` uses for "a link claims
 * its whole record entry", PR #4355), so rejecting and linking agree on what a
 * party is.
 *
 * Falls back to the exact assertion where the keyer returns null, where the
 * rejected assertion is unknown, and for a two-party fact (`isTwoParty`): PR #4355
 * leaves those out of an entry, so each has its own link and is rejected alone. A
 * two-party sibling is never swept in either.
 */
export function assertionsCoveredBy(rj: unknown, assertions: unknown): Set<string> {
  const out = new Set<string>();
  const rec = rj as RejectedLink | null | undefined;
  if (!rec || typeof rec !== "object" || typeof rec.assertion_id !== "string") return out;
  out.add(rec.assertion_id);
  const list = arr(assertions);
  const rejected = list.find((a) => a && a.id === rec.assertion_id);
  if (!rejected || isTwoParty(rejected.fact_type) || typeof rejected.record_id !== "string") return out;
  const onRecord = list.filter(
    (a) => a && (a.id === rejected.id || (isLiveAssertion(a) && sameRecord(a.record_id, rejected.record_id))),
  );
  const keyOf = recordPartyKeyer(onRecord);
  const key = keyOf(rejected);
  if (key === null) return out;
  for (const a of onRecord) {
    if (typeof a.id === "string" && !isTwoParty(a.fact_type) && keyOf(a) === key) out.add(a.id);
  }
  return out;
}

/** The rejection covering this pair, or null. Returned rather than a bare boolean so
 *  a refusal can quote the researcher's own reason back to them. `assertions` is the
 *  project's `research.assertions`: a rejection covers its whole record entry, and the
 *  entry cannot be read from the ids alone. */
export function rejectionFor(
  assertionId: string,
  personId: string,
  rejected: RejectedLink[] | undefined,
  assertions: unknown
): RejectedLink | null {
  for (const r of rejected ?? []) {
    if (!r || typeof r !== "object" || (r as RejectedLink).person_id !== personId) continue;
    if ((r as RejectedLink).assertion_id === assertionId) return r as RejectedLink;
    if (assertionsCoveredBy(r, assertions).has(assertionId)) return r as RejectedLink;
  }
  return null;
}

/**
 * Whether this (assertion, person) pair has been rejected, directly or as part of a
 * rejected record entry.
 *
 * Rejecting "this record is not Mary" is a claim about the record's party, so it
 * covers every assertion that party carries (`assertionsCoveredBy`). It says nothing
 * about her sister (another party of the record), nor about a different record for
 * Mary. A broader rule would silently block work the researcher never objected to.
 */
export function isRejectedPair(
  assertionId: string,
  personId: string,
  rejected: RejectedLink[] | undefined,
  assertions: unknown
): boolean {
  return rejectionFor(assertionId, personId, rejected, assertions) !== null;
}

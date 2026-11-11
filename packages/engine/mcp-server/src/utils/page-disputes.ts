// page-disputes — where a record's own page reads its index differently (#4286).
//
// A page reading names the index assertion it disputes in
// `disputes_assertion_id`. These helpers group each disputed index assertion with
// every reading that disputes it, following a re-extracted target through
// `superseded_by` to the assertion standing in for it now.
// Spec: docs/specs/research-append-tool-spec.md §11.9 and the ruling-10 rows.

import { isLiveAssertion } from "./assertion-liveness.js";

/** Follow `superseded_by` from an assertion id to the one standing in for it now. */
export function liveSuccessorId(id: string, byId: ReadonlyMap<string, any>): string {
  const seen = new Set<string>();
  let at = id;
  while (!seen.has(at)) {
    seen.add(at);
    const by = byId.get(at)?.superseded_by;
    if (typeof by !== "string" || !by.startsWith("a_") || !byId.has(by)) return at;
    at = by;
  }
  return at;
}

/** Each disputed live index assertion, keyed by id, with every live assertion disputing it. */
export function disputeGroups(research: any): Map<string, { target: any; disputers: any[] }> {
  const all: any[] = Array.isArray(research?.assertions) ? research.assertions : [];
  const byId = new Map<string, any>(all.filter((a) => typeof a?.id === "string").map((a) => [a.id, a]));
  const groups = new Map<string, { target: any; disputers: any[] }>();
  for (const a of all) {
    if (!isLiveAssertion(a) || typeof a?.disputes_assertion_id !== "string") continue;
    const target = byId.get(liveSuccessorId(a.disputes_assertion_id, byId));
    if (!target || !isLiveAssertion(target)) continue;
    const g = groups.get(target.id) ?? { target, disputers: [] };
    g.disputers.push(a);
    groups.set(target.id, g);
  }
  return groups;
}

/** The id of the dispute group an assertion belongs to, or undefined: a disputed
 *  index assertion keys its own group, a reading keys its target's. */
export function disputeGroupKey(
  a: any,
  groups: ReadonlyMap<string, unknown>,
  byId: ReadonlyMap<string, any>,
): string | undefined {
  const key =
    typeof a?.disputes_assertion_id === "string" ? liveSuccessorId(a.disputes_assertion_id, byId) : a?.id;
  return typeof key === "string" && groups.has(key) ? key : undefined;
}

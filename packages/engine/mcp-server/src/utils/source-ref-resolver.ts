// Resolve an assertion's source-ref by walking the intact provenance chain:
// assertion.source_id -> research.json source -> tree S-entry id.
//
// Shared by materialize_facts (facts/names) and tree_edit's add_relationship
// (`sourceAssertionId`) — both need the identical resolution, and duplicating
// it invites drift. tree-materialization-spec.md §8 requires relationship
// edges resolve their ref via "the same resolver materialize_facts uses";
// this module IS that resolver, lifted out so both tools import one
// implementation instead of two copies.
//
// Throws a plain Error on any missing hop — never silently nulls — so each
// caller wraps it in its own tool-specific error class (MaterializeFactsError,
// TreeEditError) to keep its existing error-handling contract.

import type { SimplifiedGedcomX, SimplifiedSourceReference } from "../types/gedcomx.js";

/** The assertion `fact_type`s that establish a link between TWO parties, and
 *  so can source a two-party write: `tree_edit add_relationship`'s edge, and
 *  `materialize_facts`'s named-party mint (tree-materialization-spec §4.6/§8).
 *
 *  `marriage` belongs here as squarely as `relationship` does — a marriage
 *  register is precisely the assertion that establishes a Couple — and its
 *  earlier absence made `add_relationship`'s own instruction ("source the
 *  Couple fact with the same assertion via sourceAssertionId") impossible to
 *  follow for the commonest Couple edge there is.
 *
 *  `parentage` and `parentchild` are in for the same reason: a parentage
 *  assertion establishes a parent-child link as squarely as a `relationship`
 *  one does, and the spellings are what models actually emit. Measured over the
 *  agent-produced `final-research` snapshots under `eval/runlogs/`: `parentage`
 *  19, `Parentage` 12, `ParentChild` 14 — 45 together, outnumbering the 27
 *  `Marriage` occurrences that motivated the case fold. Refusing those while
 *  accepting `Marriage` was not a defensible line.
 *
 *  `age` is deliberately out: it is indirect evidence about ONE person and
 *  names no second party. So are `marriage_intention` (3), `marriage_bann` (2)
 *  and `spouse` (2), each rarer by an order of magnitude and each a judgement
 *  about intent rather than an established link. `fact_type` is an OPEN enum,
 *  so this set can never be complete; it is a deliberate ruling on the
 *  spellings the corpus actually shows, not an attempt to enumerate the enum.
 *  Widen it the same way: measure first, then decide.
 *
 *  Lives here because this module is what both tools already share for exactly
 *  this pair. Read it through `isRelationshipEstablishing` rather than calling
 *  `.has()` directly: `fact_type` is an OPEN enum with no pattern, and models
 *  really do emit PascalCase for it: `Marriage` 27 times and `Relationship` 64
 *  across the agent-produced `final-research` snapshots under `eval/runlogs/`.
 *  The hand-written fixture corpus is clean of it, which is exactly why a
 *  fixture-only check would miss this. A caller that skips the case fold
 *  silently disagrees with one that does; sharing the set but not the
 *  normalization is how the two spellings drift apart while looking as though
 *  they cannot. */
export const RELATIONSHIP_ESTABLISHING_TYPES: ReadonlySet<string> = new Set([
  "relationship",
  "marriage",
  "parentage",
  "parentchild",
]);

/** True when an assertion's `fact_type` establishes a link between two parties.
 *  Case-folded, because the enum is open and the corpus is not consistent. */
export function isRelationshipEstablishing(factType: unknown): boolean {
  return RELATIONSHIP_ESTABLISHING_TYPES.has(String(factType ?? "").trim().toLowerCase());
}

export function resolveSourceRef(
  assertion: any,
  research: any,
  tree: SimplifiedGedcomX,
): SimplifiedSourceReference {
  const sourceId = assertion.source_id;
  if (typeof sourceId !== "string" || sourceId === "") {
    throw new Error(`assertion '${assertion.id}' has no source_id — cannot resolve provenance`);
  }
  const source = (Array.isArray(research.sources) ? research.sources : []).find(
    (s: any) => s && s.id === sourceId,
  );
  if (!source) {
    throw new Error(
      `assertion '${assertion.id}' cites source '${sourceId}' which is not in research.json sources`,
    );
  }
  const sdid = source.gedcomx_source_description_id;
  if (typeof sdid !== "string" || sdid === "") {
    throw new Error(
      `research source '${sourceId}' has no gedcomx_source_description_id — its tree S-entry is missing`,
    );
  }
  const sEntry = (tree.sources ?? []).find((s) => s && s.id === sdid);
  if (!sEntry) {
    throw new Error(
      `tree S-entry '${sdid}' (from source '${sourceId}') does not exist in tree.gedcomx.json — ` +
        "the S-entry is created by research_append's composite sourceDescription; materialize the record's " +
        "source first",
    );
  }
  const ref: SimplifiedSourceReference = { ref: sdid };
  // Ref quality reflects the evidence class (tree-materialization-spec §7.1/§8:
  // indirect evidence — e.g. a pre-1880 census parent-child edge — rides a
  // lower quality). Direct → 3, indirect → 2; anything else left unset.
  if (assertion.evidence_type === "direct") ref.quality = 3;
  else if (assertion.evidence_type === "indirect") ref.quality = 2;
  return ref;
}

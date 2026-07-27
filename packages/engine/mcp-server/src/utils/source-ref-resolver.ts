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

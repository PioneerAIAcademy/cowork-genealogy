/**
 * Graph-level pruning shared by the tools that emit a simplified tree.
 *
 * **Endpoint closure.** FamilySearch's relationship arrays reach one hop further
 * than its `persons[]`, so an edge can name a person the response never
 * returned. `validate_research_schema` makes an unresolvable endpoint a hard
 * error on all four spellings, and `project_create` — alone among the tree
 * writers in never calling `sanitizeTree` — refuses the ENTIRE write on any
 * error. So the alternative to dropping the edge is losing the user's whole
 * project write, not keeping the edge.
 *
 * Lifted here from `tools/person-read.ts` when `person_ancestors` turned out to
 * have the same class (issue #2747). CLAUDE.md: the second instance of a class
 * already fixed gets one shared guard, not a second one-off.
 *
 * Measured on live FamilySearch data 2026-09-23, `LZJW-C31` at 4 generations
 * with `marriageDetails`: **11 of 27** emitted relationships named a spouse
 * absent from `persons[]`; 13 of 28 with `--descendants`. Every instance was a
 * `Couple`, and the missing endpoint was always the spouse rather than a parent.
 */

/** The endpoint-bearing shape both callers' relationship types satisfy.
 *
 *  `type` is optional because `SimplifiedRelationship.type` is — `simplifyRelationship`
 *  only sets it when `stripUri` resolves — while `TreeRelationship.type` is required.
 *  The describe function below must therefore tolerate its absence. */
export type EndpointBearing = {
  type?: string;
  parent?: string;
  child?: string;
  person1?: string;
  person2?: string;
};

/** Relationships whose every endpoint is in `personIds`.
 *
 *  **Generic on purpose.** A non-generic `(rels: EndpointBearing[]) => EndpointBearing[]`
 *  widens `person_read`'s `TreeRelationship[]` at the call site and fails tsc three
 *  times over (`dropStrandedPersons`, `PersonReadResult.relationships`, the note
 *  builder). `<T extends EndpointBearing>` keeps each caller's own element type.
 *
 *  **Filter-only.** It never removes a person — `person_read` handles stranded
 *  persons separately, and `person_ancestors` must not drop an ancestor whose
 *  spouse was absent.
 *
 *  **Compares bare ids.** Callers bare every endpoint before calling: an absolute
 *  `…/persons/<id>` URL compared against a bare `persons[].id` never matches, so
 *  an unbared caller would drop every edge of that shape. */
export function dropDanglingEdges<T extends EndpointBearing>(
  relationships: T[],
  personIds: Set<string>,
): T[] {
  return relationships.filter((r) =>
    [r.parent, r.child, r.person1, r.person2].every(
      (endpoint) => endpoint === undefined || personIds.has(endpoint),
    ),
  );
}

/** The count-and-type sentence for edges `dropDanglingEdges` removed, or
 *  `undefined` when it removed none.
 *
 *  Shared so the two tools cannot drift into two wordings of one fact
 *  (issue #2747 review). `person_read` appends its own second sentence about the
 *  subject's own parentage; that one stays local to it, because only a tool with
 *  a requested person can say it.
 *
 *  A typeless edge is counted under `untyped` rather than interpolated as
 *  `undefined` — `SimplifiedRelationship.type` is optional, and `localeCompare`
 *  on `undefined` throws. */
export function describeDroppedEdges<T extends EndpointBearing>(
  before: T[],
  kept: T[],
): string | undefined {
  if (before.length === kept.length) return undefined;
  const keptSet = new Set(kept);
  const dropped = before.filter((r) => !keptSet.has(r));
  const byType = new Map<string, number>();
  for (const r of dropped) {
    const type = typeof r.type === "string" && r.type !== "" ? r.type : "untyped";
    byType.set(type, (byType.get(type) ?? 0) + 1);
  }
  const breakdown = [...byType.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, n]) => `${n} ${type}`)
    .join(", ");
  return (
    `Dropped ${dropped.length} relationship(s) whose endpoints are not in ` +
    `persons[] (${breakdown}). FamilySearch names kin one hop beyond the ` +
    `persons it returns; such an edge fails the project_create write ` +
    `outright, so it is not emitted.`
  );
}

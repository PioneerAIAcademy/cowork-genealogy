/** Any relationship-shaped object. Structural rather than nominal so the
 *  simplified-GedcomX and person-read shapes both qualify without importing
 *  either type here. */
export interface RelationshipEnds {
  parent?: string;
  child?: string;
  person1?: string;
  person2?: string;
}

/**
 * Every person id a relationship points at, whichever endpoint fields it uses.
 *
 * A simplified-GedcomX relationship carries its ends in one of two field pairs,
 * and which pair depends on the type: `Couple` uses `person1`/`person2`, while
 * `ParentChild` uses `parent`/`child` and carries no `person1` at all. Measured
 * over the 202 committed e2e final trees: 2242 ParentChild edges, all of them
 * `parent`/`child`, and 385 Couple edges, all of them `person1`/`person2`.
 *
 * THIS EXISTS BECAUSE THE FOUR-FIELD READ WAS WRITTEN BY HAND AND ONE COPY GOT
 * IT WRONG. `computeTouchedPersonIds` read only the Couple pair, so every
 * parentage write marked nobody as touched and the warning gate -- which
 * refuses a write that introduces a genealogical warning -- could not fire on a
 * parentage edge at all. The gate's own fixtures used `person1`/`person2` on a
 * ParentChild, a shape no real tree has, so they passed. Call this rather than
 * enumerating the fields again.
 */
export function relationshipEndpoints(r: RelationshipEnds): string[] {
  const ends: string[] = [];
  for (const e of [r.parent, r.child, r.person1, r.person2]) {
    if (typeof e === "string" && e) ends.push(e);
  }
  return ends;
}

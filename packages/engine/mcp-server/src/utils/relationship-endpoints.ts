import type { EndpointBearing } from "./tree-graph.js";

/**
 * Every person id a relationship points at, whichever endpoint fields it uses.
 *
 * A simplified-GedcomX relationship carries its ends in one of two field pairs,
 * and which pair depends on the type: `Couple` uses `person1`/`person2`, while
 * `ParentChild` uses `parent`/`child` and carries no `person1` at all. Over the
 * committed e2e final trees every ParentChild edge uses `parent`/`child` and
 * every Couple edge uses `person1`/`person2`, with no exceptions — re-derive
 * with `dev/measure-parentage-gate-rate.ts` rather than trusting a count
 * written here, which goes stale every time the corpus grows.
 *
 * THIS EXISTS BECAUSE THE FOUR-FIELD READ WAS WRITTEN BY HAND AND ONE COPY GOT
 * IT WRONG. `computeTouchedPersonIds` read only the Couple pair, so every
 * parentage write marked nobody as touched and the warning gate -- which
 * refuses a write that introduces a genealogical warning -- could not fire on a
 * parentage edge at all. The gate's own fixtures used `person1`/`person2` on a
 * ParentChild, a shape no real tree has, so they passed. Call this rather than
 * enumerating the fields again.
 *
 * Takes `EndpointBearing` (`tree-graph.ts`) rather than a second structural
 * type of its own: two names for one shape is how the hand-written reads got
 * out of step in the first place.
 */
export function relationshipEndpoints(r: EndpointBearing): string[] {
  const ends: string[] = [];
  for (const e of [r.parent, r.child, r.person1, r.person2]) {
    if (typeof e === "string" && e) ends.push(e);
  }
  return ends;
}

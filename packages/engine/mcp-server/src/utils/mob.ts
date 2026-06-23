// Mob — a thin TypeScript adapter over SimplifiedGedcomX, mirroring the
// Java MobWarnings' Mob/MPerson abstractions so the warning checks port
// near-directly from warnings.java.
//
// A Mob bundles:
//   - the underlying SimplifiedGedcomX (the whole tree slice)
//   - the anchor person's id (the "focal" person)
//
// And exposes the relative-accessor methods Java uses everywhere: getParents,
// getFathers, getMothers, getSpouses, getChildren, getSiblings, plus
// fact-family helpers on the anchor (birthLikeFacts, deathLikeFacts, etc.).
//
// For the single-person flow this branch implements, the Mob's tree is just
// the project's tree.gedcomx.json with the anchor pointing at the chosen
// person. For the future merge-comparison flow (Dallan's plan), a separate
// merge function will produce a combined SimplifiedGedcomX from a target +
// candidate; the same Mob shape wraps that result and runs the same checks.

import type {
  SimplifiedFact,
  SimplifiedGedcomX,
  SimplifiedPerson,
  SimplifiedRelationship,
} from "../types/gedcomx.js";

// ─── Fact-type families ────────────────────────────────────────────────────
// Mirror Java MobWarnings' FsFactType.{*}_FACT_TYPES. Membership confirmed
// by Richard Chesworth on 2026-06-02. The string form of each fact type
// matches the FsFactType identifier exactly (confirmed by Dallan), so we can
// compare fact.type === "Census" directly.

export const BIRTHLIKE_FACT_TYPES: ReadonlySet<string> = new Set([
  "Baptism",
  "Birth",
  "Christening",
  "Blessing",
  "Circumcision",
  "Adoption",
  "BirthNotice",
  "BirthRegistration",
  "NamingCeremony",
  "BaptismRegistration",
]);

export const DEATHLIKE_FACT_TYPES: ReadonlySet<string> = new Set([
  "Death",
  "Burial",
  "Cremation",
  "Funeral",
  "Obituary",
  "Probate",
  "Will",
  "DeathRegistration",
  "BurialRegistration",
]);

export const MARRIAGELIKE_FACT_TYPES: ReadonlySet<string> = new Set([
  "Marriage",
  "Engagement",
  "MarriageBanns",
  "MarriageContract",
  "MarriageLicense",
  "MarriageNotice",
  "MarriageRegistration",
  "MarriageSettlement",
  "MarriageIntent",
]);

export const DIVORCELIKE_FACT_TYPES: ReadonlySet<string> = new Set([
  "Divorce",
  "DivorceFiling",
  "Annulment",
  "Separation",
]);

export const MIGRATIONLIKE_FACT_TYPES: ReadonlySet<string> = new Set([
  "Immigration",
  "Emigration",
  "Migration",
  "Naturalization",
  "MoveTo",
  "MoveFrom",
  "Move",
  "NaturalizationRegistration",
]);

export const RESIDENCELIKE_FACT_TYPES: ReadonlySet<string> = new Set([
  "Census",
  "MunicipalCensus",
  "Residence",
]);

// Single-fact-type and small-set constants used by individual Java checks.
// Mirror warnings.java:23–29.
export const BIRTH: ReadonlySet<string> = new Set(["Birth"]);
export const CHRISTENING: ReadonlySet<string> = new Set(["Christening"]);
export const DEATH: ReadonlySet<string> = new Set(["Death"]);
export const BURIAL: ReadonlySet<string> = new Set(["Burial"]);
export const BIRTH_AND_EVENT_REGISTRATION: ReadonlySet<string> = new Set([
  "Birth",
  "EventRegistration",
]);
export const CHRISTENING_AND_BAPTISM: ReadonlySet<string> = new Set([
  "Christening",
  "Baptism",
]);

/** True when the fact's type is in any vital family (birth, death, or marriage). */
export function isVitalType(type: string | undefined): boolean {
  if (type === undefined) return false;
  return (
    BIRTHLIKE_FACT_TYPES.has(type) ||
    DEATHLIKE_FACT_TYPES.has(type) ||
    MARRIAGELIKE_FACT_TYPES.has(type)
  );
}

// ─── Gender ────────────────────────────────────────────────────────────────
// Mirrors org.gedcomx.types.GenderType. The "Intersex" and "OTHER" values
// from the Java enum are intentionally folded into "Unknown" here — the
// warning checks only branch on Male / Female / Unknown, and our
// SimplifiedPerson.gender field only ever carries one of those three.

export type GenderType = "Male" | "Female" | "Unknown";

function normalizeGender(raw: string | undefined): GenderType {
  if (raw === "Male" || raw === "Female") return raw;
  return "Unknown";
}

// ─── Mob ───────────────────────────────────────────────────────────────────

export class Mob {
  readonly tree: SimplifiedGedcomX;
  readonly anchorId: string;

  constructor(tree: SimplifiedGedcomX, anchorId: string) {
    this.tree = tree;
    this.anchorId = anchorId;
    if (this.findPerson(anchorId) === undefined) {
      throw new Error(
        `Mob: anchor person "${anchorId}" not found in tree.persons[]`,
      );
    }
  }

  /** The anchor / focal person. */
  getPerson(): SimplifiedPerson {
    // Non-null assertion is safe: the constructor verified the anchor exists.
    return this.findPerson(this.anchorId)!;
  }

  /** Gender of the anchor person. */
  getGender(): GenderType {
    return normalizeGender(this.getPerson().gender);
  }

  /** All persons in the tree, by id. */
  getAllPersons(): SimplifiedPerson[] {
    return this.tree.persons ?? [];
  }

  // ─── Relatives ───────────────────────────────────────────────────────────
  // All "one-hop" accessors. Each returns SimplifiedPerson[] (no duplicates,
  // preserves order seen in tree.relationships).

  getParents(): SimplifiedPerson[] {
    const parentIds = this.collectRelatedIds("parents-of-anchor");
    return this.resolvePersons(parentIds);
  }

  getFathers(includeUnknown = false): SimplifiedPerson[] {
    return this.getParents().filter((p) => {
      const g = normalizeGender(p.gender);
      return g === "Male" || (includeUnknown && g === "Unknown");
    });
  }

  getMothers(includeUnknown = false): SimplifiedPerson[] {
    return this.getParents().filter((p) => {
      const g = normalizeGender(p.gender);
      return g === "Female" || (includeUnknown && g === "Unknown");
    });
  }

  getSpouses(): SimplifiedPerson[] {
    const spouseIds = this.collectRelatedIds("spouse-of-anchor");
    return this.resolvePersons(spouseIds);
  }

  getChildren(): SimplifiedPerson[] {
    const childIds = this.collectRelatedIds("children-of-anchor");
    return this.resolvePersons(childIds);
  }

  getSons(includeUnknown = false): SimplifiedPerson[] {
    return this.getChildren().filter((p) => {
      const g = normalizeGender(p.gender);
      return g === "Male" || (includeUnknown && g === "Unknown");
    });
  }

  getDaughters(includeUnknown = false): SimplifiedPerson[] {
    return this.getChildren().filter((p) => {
      const g = normalizeGender(p.gender);
      return g === "Female" || (includeUnknown && g === "Unknown");
    });
  }

  /**
   * Children of any person in the tree (looked up by `personId`), in
   * source-relationship order. Used by `getRelativeMobs` to enrich
   * parent Mobs with the parent's full child set (i.e., the anchor's
   * siblings on that specific parent — distinct from
   * `getSiblings()` which spans both anchor parents).
   */
  getChildrenOf(personId: string): SimplifiedPerson[] {
    const ids = this.childrenOf(personId);
    return ids
      .map((id) => this.findPerson(id))
      .filter((p): p is SimplifiedPerson => p !== undefined);
  }

  /**
   * Siblings = children of any of the anchor's parents, excluding the anchor
   * itself. Order: first parent first, then unique children-of-second-parent.
   */
  getSiblings(): SimplifiedPerson[] {
    const out: SimplifiedPerson[] = [];
    const seen = new Set<string>([this.anchorId]);
    for (const parent of this.getParents()) {
      if (parent.id === undefined) continue;
      const siblingIds = this.childrenOf(parent.id);
      for (const sid of siblingIds) {
        if (seen.has(sid)) continue;
        const person = this.findPerson(sid);
        if (person !== undefined) {
          out.push(person);
          seen.add(sid);
        }
      }
    }
    return out;
  }

  // ─── Anchor's facts, filtered by family ──────────────────────────────────

  /** All facts on the anchor person. */
  getFacts(): SimplifiedFact[] {
    return this.getPerson().facts ?? [];
  }

  /** Anchor's facts of an exact type (single-string match). */
  getFactsOfType(type: string): SimplifiedFact[] {
    return this.getFacts().filter((f) => f.type === type);
  }

  /** Anchor's facts whose type is in the birth-like family. */
  birthLikeFacts(): SimplifiedFact[] {
    return this.getFacts().filter(
      (f) => f.type !== undefined && BIRTHLIKE_FACT_TYPES.has(f.type),
    );
  }

  /** Anchor's facts whose type is in the death-like family. */
  deathLikeFacts(): SimplifiedFact[] {
    return this.getFacts().filter(
      (f) => f.type !== undefined && DEATHLIKE_FACT_TYPES.has(f.type),
    );
  }

  /** Anchor's facts whose type is in the marriage-like family. */
  marriageLikeFacts(): SimplifiedFact[] {
    return this.getFacts().filter(
      (f) => f.type !== undefined && MARRIAGELIKE_FACT_TYPES.has(f.type),
    );
  }

  /** Anchor's vital (birth-like / death-like / marriage-like) facts. */
  vitalFacts(): SimplifiedFact[] {
    return this.getFacts().filter((f) => isVitalType(f.type));
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  private findPerson(id: string): SimplifiedPerson | undefined {
    return (this.tree.persons ?? []).find((p) => p.id === id);
  }

  private resolvePersons(ids: Set<string>): SimplifiedPerson[] {
    const out: SimplifiedPerson[] = [];
    for (const id of ids) {
      const p = this.findPerson(id);
      if (p !== undefined) out.push(p);
    }
    return out;
  }

  /**
   * Collect ids of persons standing in a given role relative to the anchor.
   * Walks `tree.relationships` once and applies a role-specific filter.
   */
  private collectRelatedIds(
    role:
      | "parents-of-anchor"
      | "children-of-anchor"
      | "spouse-of-anchor",
  ): Set<string> {
    const out = new Set<string>();
    for (const rel of this.tree.relationships ?? []) {
      const id = this.extractRelatedId(rel, role);
      if (id !== undefined) out.add(id);
    }
    return out;
  }

  private extractRelatedId(
    rel: SimplifiedRelationship,
    role: "parents-of-anchor" | "children-of-anchor" | "spouse-of-anchor",
  ): string | undefined {
    if (role === "parents-of-anchor") {
      if (rel.type !== "ParentChild") return undefined;
      if (rel.child !== this.anchorId) return undefined;
      return rel.parent;
    }
    if (role === "children-of-anchor") {
      if (rel.type !== "ParentChild") return undefined;
      if (rel.parent !== this.anchorId) return undefined;
      return rel.child;
    }
    // spouse-of-anchor
    if (rel.type !== "Couple") return undefined;
    if (rel.person1 === this.anchorId) return rel.person2;
    if (rel.person2 === this.anchorId) return rel.person1;
    return undefined;
  }

  private childrenOf(parentId: string): string[] {
    const out: string[] = [];
    for (const rel of this.tree.relationships ?? []) {
      if (rel.type !== "ParentChild") continue;
      if (rel.parent !== parentId) continue;
      if (rel.child !== undefined) out.push(rel.child);
    }
    return out;
  }
}

// ─── Relative-Mob synthesis ────────────────────────────────────────────────
// Java parity port of warnings.java:686 (`getRelativeMobs`).
//
// Java builds a list of Mobs — one per parent, spouse, and child of the
// anchor — and re-runs the warning checks against each. Each "relative mob"
// is anchored on the relative; the original anchor takes the reciprocal
// role (child of a parent-mob, spouse of a spouse-mob, parent of a
// child-mob). Child-mobs additionally include the original anchor's other
// children as the focal child's siblings (per warnings.java:707-714).
//
// In Java this is procedural: `new Mob(relative); mob.child(...)`. Our TS
// Mob is built from a SimplifiedGedcomX + anchorId — to keep that
// invariant clean, we synthesize a mini SimplifiedGedcomX per relative
// containing exactly the persons and relationships needed, then wrap it
// in a new Mob. Synthesized ids reuse the originals (the mini-tree never
// leaks back into the source tree).
//
// Java's `MAX_CHILDREN_TO_COMPARE = 40` cap on child iteration is mirrored
// to keep behavior identical for very large families.

const MAX_CHILDREN_TO_COMPARE = 40;

function syntheticPersonId(p: SimplifiedPerson): string {
  // The anchor must have an id (Mob's constructor enforces that on the
  // source tree, so derived persons always carry it forward).
  return p.id ?? "";
}

function buildParentMob(
  anchor: SimplifiedPerson,
  parent: SimplifiedPerson,
  parentsOtherChildren: SimplifiedPerson[],
): Mob | null {
  const parentId = syntheticPersonId(parent);
  const anchorId = syntheticPersonId(anchor);
  if (parentId === "" || anchorId === "") return null;
  const persons: SimplifiedPerson[] = [parent, anchor];
  const relationships: SimplifiedRelationship[] = [
    { type: "ParentChild", parent: parentId, child: anchorId },
  ];
  for (const sib of parentsOtherChildren) {
    const sibId = syntheticPersonId(sib);
    if (sibId === "" || sibId === anchorId) continue;
    persons.push(sib);
    relationships.push({
      type: "ParentChild",
      parent: parentId,
      child: sibId,
    });
  }
  return new Mob({ persons, relationships }, parentId);
}

function buildSpouseMob(
  anchor: SimplifiedPerson,
  spouse: SimplifiedPerson,
): Mob | null {
  const spouseId = syntheticPersonId(spouse);
  const anchorId = syntheticPersonId(anchor);
  if (spouseId === "" || anchorId === "") return null;
  const tree: SimplifiedGedcomX = {
    persons: [spouse, anchor],
    relationships: [
      { type: "Couple", person1: spouseId, person2: anchorId },
    ],
  };
  return new Mob(tree, spouseId);
}

function buildChildMob(
  anchor: SimplifiedPerson,
  child: SimplifiedPerson,
  siblings: SimplifiedPerson[],
): Mob | null {
  const childId = syntheticPersonId(child);
  const anchorId = syntheticPersonId(anchor);
  if (childId === "" || anchorId === "") return null;
  const persons: SimplifiedPerson[] = [child, anchor];
  const relationships: SimplifiedRelationship[] = [
    { type: "ParentChild", parent: anchorId, child: childId },
  ];
  for (const sib of siblings) {
    const sibId = syntheticPersonId(sib);
    if (sibId === "" || sibId === childId) continue;
    persons.push(sib);
    relationships.push({
      type: "ParentChild",
      parent: anchorId,
      child: sibId,
    });
  }
  return new Mob({ persons, relationships }, childId);
}

/**
 * Build the list of "relative mobs" the non-final warning loops run against.
 *
 * Returns one Mob per parent, spouse, and child of `mob`'s anchor — each
 * anchored on the relative, with the original anchor playing the reciprocal
 * role. Order mirrors Java: parents first (in source-relationship order),
 * then spouses, then children (capped at `MAX_CHILDREN_TO_COMPARE`).
 *
 * Returns `[]` when the anchor has no relatives. Returns Mobs whose
 * `getGender()` reflects the relative's gender — the caller filters with
 * `.getGender() === "Male" | "Female"` for the `male*` / `female*` warning
 * variants.
 */
export function getRelativeMobs(mob: Mob): Mob[] {
  const out: Mob[] = [];
  const anchor = mob.getPerson();
  for (const parent of mob.getParents()) {
    const parentId = parent.id ?? "";
    // INTENTIONAL divergence from Java (reviewed, kept): Java's getRelativeMobs
    // builds each parent-mob with ONLY the anchor as a child — the sibling loop
    // is commented out (warnings.java:692-694, "principal parents may not be
    // parents of siblings", a half-sibling false-positive concern). We DO
    // enrich the parent-mob with that parent's other children so the
    // relative-child checks (relativesChildBirthRange40, relatives child-birth
    // timing) can see a parent's full child set and flag e.g. a 40+-year span.
    // We use `getChildrenOf(parentId)` — children of THIS specific parent, not
    // Java's `getSiblings()` (children of EITHER parent) — which is tighter on
    // the half-sibling case Java was avoiding. Reverting to anchor-only would
    // disable those parent-mob child checks (and a test depends on this).
    const otherChildren =
      parentId === "" ? [] : mob.getChildrenOf(parentId);
    const m = buildParentMob(anchor, parent, otherChildren);
    if (m !== null) out.push(m);
  }
  for (const spouse of mob.getSpouses()) {
    const m = buildSpouseMob(anchor, spouse);
    if (m !== null) out.push(m);
  }
  const children = mob.getChildren().slice(0, MAX_CHILDREN_TO_COMPARE);
  for (const child of children) {
    const m = buildChildMob(anchor, child, children);
    if (m !== null) out.push(m);
  }
  return out;
}

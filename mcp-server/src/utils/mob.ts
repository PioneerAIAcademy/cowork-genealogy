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

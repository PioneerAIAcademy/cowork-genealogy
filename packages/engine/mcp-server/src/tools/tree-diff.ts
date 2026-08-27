// tree_diff — what a second simplified-GedcomX tree added, removed, and changed
// relative to a first.
//
// WHY THIS TOOL EXISTS. Two callers want the same question answered — "what did
// this session actually change in the tree?" — and neither can get it from the
// data alone. The tree-encoding completion gate (issue #1490) diffs the final
// tree against the write-once `starting-tree.gedcomx.json` baseline to tell a
// conclusion this session encoded from a fact that was already seeded; the
// viewer and `project_status` want the same session delta for display. Rather
// than each re-deriving a diff — and getting the relationship landmines wrong —
// they call this.
//
// IDENTITY, and the landmines it steps around:
//   - Persons key on `id`.
//   - Relationships key on their ENDPOINTS, never on `id`: a ParentChild carries
//     `parent`/`child`, a Couple carries `person1`/`person2` (unordered). Some
//     seeded trees point a relationship at a PID-TODO placeholder the agent
//     re-points during the run, so an `id` key would read a genuinely re-pointed
//     relationship as unchanged. Shared with the merge tool via `relationshipKey`.
//   - A `Marriage`/`Divorce` fact lives on the Couple relationship's `facts[]`,
//     not on a person, so relationship facts are diffed on both added and
//     already-present relationships.
//   - Facts key on a content signature (type + date + place + value), with a
//     missing field treated as absent — `primary`/`preferred` are omit-when-false.
//
// Pure and read-only: it takes both trees as input and touches no file and no
// network, so it is safe to call from the gate mid-write.

import { relationshipKey, factsEquivalent } from "../utils/merge-gedcomx.js";
import type {
  SimplifiedGedcomX,
  SimplifiedPerson,
  SimplifiedFact,
  SimplifiedRelationship,
} from "../types/gedcomx.js";

export interface TreeDiffInput {
  before?: SimplifiedGedcomX;
  after?: SimplifiedGedcomX;
}

/** A person that gained or lost facts, or a wholly added/removed person. */
export interface PersonDelta {
  id: string;
  addedFacts: SimplifiedFact[];
  removedFacts: SimplifiedFact[];
}

export interface RelationshipDelta {
  key: string;
  type?: string;
  relationship: SimplifiedRelationship;
}

/** A relationship present in BOTH trees whose `facts[]` changed — e.g. a
 *  Marriage fact dated onto a Couple that was already seeded. This is a distinct
 *  case from add/remove: the relationship endpoints are unchanged, only its
 *  facts moved. */
export interface RelationshipFactDelta {
  key: string;
  type?: string;
  relationship: SimplifiedRelationship;
  addedFacts: SimplifiedFact[];
  removedFacts: SimplifiedFact[];
}

export interface TreeDiffResult {
  personsAdded: string[];
  personsRemoved: string[];
  personsChanged: PersonDelta[];
  relationshipsAdded: RelationshipDelta[];
  relationshipsRemoved: RelationshipDelta[];
  /** Relationships in both trees that gained or lost facts (a Marriage/Divorce
   *  fact encoded onto an already-present Couple). */
  relationshipsChanged: RelationshipFactDelta[];
  /** Persons that gained at least one fact OR a relationship endpoint — the set
   *  a tree-encoding gate asks about ("did this conclusion's person gain tree
   *  structure?"). The union of personsAdded, the ids in personsChanged with
   *  added facts, the endpoints of relationshipsAdded, and the endpoints of
   *  relationshipsChanged that gained a fact — the last so a marriage dated onto
   *  a seeded couple counts as structure for both spouses. */
  personsWithNewStructure: string[];
}

function personMap(tree: SimplifiedGedcomX | undefined): Map<string, SimplifiedPerson> {
  const out = new Map<string, SimplifiedPerson>();
  for (const p of tree?.persons ?? []) {
    if (typeof p?.id === "string") out.set(p.id, p);
  }
  return out;
}

/** Facts in `a` not matched (by content) by any fact in `b`. */
function factsNotIn(a: SimplifiedFact[], b: SimplifiedFact[]): SimplifiedFact[] {
  const used = new Array(b.length).fill(false);
  const out: SimplifiedFact[] = [];
  for (const fa of a) {
    let matched = false;
    for (let i = 0; i < b.length; i++) {
      if (!used[i] && factsEquivalent(fa, b[i])) {
        used[i] = true;
        matched = true;
        break;
      }
    }
    if (!matched) out.push(fa);
  }
  return out;
}

function relationshipMap(
  tree: SimplifiedGedcomX | undefined,
): Map<string, SimplifiedRelationship> {
  const out = new Map<string, SimplifiedRelationship>();
  for (const r of tree?.relationships ?? []) {
    out.set(relationshipKey(r), r);
  }
  return out;
}

function relationshipEndpoints(r: SimplifiedRelationship): string[] {
  const ends: string[] = [];
  for (const e of [r.parent, r.child, r.person1, r.person2]) {
    if (typeof e === "string" && e) ends.push(e);
  }
  return ends;
}

export function treeDiff(input: TreeDiffInput): TreeDiffResult {
  const before = input.before ?? {};
  const after = input.after ?? {};

  const beforePersons = personMap(before);
  const afterPersons = personMap(after);

  const personsAdded: string[] = [];
  const personsRemoved: string[] = [];
  const personsChanged: PersonDelta[] = [];
  const withNewStructure = new Set<string>();

  for (const [id, ap] of afterPersons) {
    const bp = beforePersons.get(id);
    if (!bp) {
      personsAdded.push(id);
      withNewStructure.add(id);
      continue;
    }
    const addedFacts = factsNotIn(ap.facts ?? [], bp.facts ?? []);
    const removedFacts = factsNotIn(bp.facts ?? [], ap.facts ?? []);
    if (addedFacts.length || removedFacts.length) {
      personsChanged.push({ id, addedFacts, removedFacts });
      if (addedFacts.length) withNewStructure.add(id);
    }
  }
  for (const id of beforePersons.keys()) {
    if (!afterPersons.has(id)) personsRemoved.push(id);
  }

  const beforeRels = relationshipMap(before);
  const afterRels = relationshipMap(after);
  const relationshipsAdded: RelationshipDelta[] = [];
  const relationshipsRemoved: RelationshipDelta[] = [];
  const relationshipsChanged: RelationshipFactDelta[] = [];

  for (const [key, r] of afterRels) {
    const br = beforeRels.get(key);
    if (!br) {
      relationshipsAdded.push({ key, type: r.type, relationship: r });
      for (const e of relationshipEndpoints(r)) withNewStructure.add(e);
      continue;
    }
    // The relationship is in both trees — its endpoints are unchanged, but its
    // facts may not be. A Marriage/Divorce fact lives on the Couple here, so a
    // marriage dated onto a seeded couple shows up ONLY as a fact change, never
    // as an add. Diff the facts, and count a gained fact as new structure for
    // both endpoints (without it the tree-encoding gate warns on correct work).
    const addedFacts = factsNotIn(r.facts ?? [], br.facts ?? []);
    const removedFacts = factsNotIn(br.facts ?? [], r.facts ?? []);
    if (addedFacts.length || removedFacts.length) {
      relationshipsChanged.push({ key, type: r.type, relationship: r, addedFacts, removedFacts });
      if (addedFacts.length) {
        for (const e of relationshipEndpoints(r)) withNewStructure.add(e);
      }
    }
  }
  for (const [key, r] of beforeRels) {
    if (!afterRels.has(key)) {
      relationshipsRemoved.push({ key, type: r.type, relationship: r });
    }
  }

  return {
    personsAdded,
    personsRemoved,
    personsChanged,
    relationshipsAdded,
    relationshipsRemoved,
    relationshipsChanged,
    personsWithNewStructure: [...withNewStructure],
  };
}

export const treeDiffSchema = {
  name: "tree_diff",
  description:
    "Diff two SIMPLIFIED GedcomX trees (snake_case) and report what the second added, " +
    "removed, and changed relative to the first: persons added/removed, per-person facts " +
    "gained/lost, and relationships added/removed. Relationships are matched on their " +
    "endpoints (a ParentChild's `parent`/`child`, a Couple's `person1`/`person2`), never " +
    "on their `id`, so a relationship re-pointed from a placeholder to a real person reads " +
    "as changed structure, not as unchanged. A Marriage fact on a Couple relationship is " +
    "diffed as part of that relationship. `personsWithNewStructure` is the union of persons " +
    "who gained a fact or a relationship endpoint — the set to ask about when checking " +
    "whether a conclusion was encoded into the tree. Read-only; computes no I/O.",
  inputSchema: {
    type: "object" as const,
    properties: {
      before: {
        type: "object",
        description: "The earlier tree (e.g. the starting-tree.gedcomx.json baseline).",
        properties: {
          persons: { type: "array", items: { type: "object" } },
          relationships: { type: "array", items: { type: "object" } },
          sources: { type: "array", items: { type: "object" } },
        },
      },
      after: {
        type: "object",
        description: "The later tree (e.g. the current tree.gedcomx.json).",
        properties: {
          persons: { type: "array", items: { type: "object" } },
          relationships: { type: "array", items: { type: "object" } },
          sources: { type: "array", items: { type: "object" } },
        },
      },
    },
    required: ["before", "after"],
  },
};

// Which persona of a record is a given tree person, read off a source attached
// to that person or to one of the person's relationships. Shared by
// `extraction_append`'s person mode, which links relationship-level
// attachments, and `dev/source-screen.ts`, which scores them, so both run the
// same choice.

import { toArk } from "./ark.js";

type Json = any;

/** The tree as this module reads it: persons' gender and the relationships'
 *  endpoints and sources. Both the simplified project tree and a `person_read`
 *  result have this shape. */
export interface PersonaSelectTree {
  persons?: ReadonlyArray<{ id: string; gender?: string }>;
  relationships?: ReadonlyArray<{
    type?: string;
    person1?: string;
    person2?: string;
    parent?: string;
    child?: string;
    sources?: ReadonlyArray<{ ref: string }>;
  }>;
}

/** One attached source: the ARK it names, the tree source ids that carry it,
 *  and whether it hangs on the person (`subject`) or on a relationship. */
export interface PersonaSelectEntry {
  ark: string | null;
  source_ids: readonly string[];
  level: "subject" | "relationship";
}

export type PersonaSelection = { persona_id: string; selected_by: string } | { unscored: string };

type EdgeRole = "parent" | "child" | "spouse";

/** The record's persona whose ARK is the source's. */
export function personaFor(record: Json, ark: string): Json | undefined {
  return (record?.persons ?? []).find((p: Json) => typeof p?.ark === "string" && toArk(p.ark) === ark);
}

/** The person's role on each tree edge that cites the source. */
function subjectRoles(tree: PersonaSelectTree, sid: string, entry: PersonaSelectEntry): EdgeRole[] {
  const bare = (ref: string) => (ref.startsWith("#") ? ref.slice(1) : ref);
  const ids = new Set(entry.source_ids.map(bare));
  const roles = new Set<EdgeRole>();
  for (const r of tree.relationships ?? []) {
    if (!(r.sources ?? []).some((s) => typeof s?.ref === "string" && ids.has(bare(s.ref)))) continue;
    if (r.type === "Couple" && (r.person1 === sid || r.person2 === sid)) roles.add("spouse");
    else if (r.type === "ParentChild" && r.parent === sid) roles.add("parent");
    else if (r.type === "ParentChild" && r.child === sid) roles.add("child");
  }
  return [...roles];
}

/** The record personas that hold `role` relative to P, plus P if P already holds it. */
function roleCandidates(record: Json, p: Json, role: EdgeRole): Json[] {
  const rels: Json[] = record.relationships ?? [];
  const ids = new Set<string>();
  for (const r of rels) {
    if (role === "spouse") {
      if (r.type !== "Couple") continue;
      if (r.person1 === p.id) ids.add(r.person2);
      if (r.person2 === p.id) ids.add(r.person1);
      if (r.person1 === p.id || r.person2 === p.id) ids.add(p.id);
    } else if (r.type === "ParentChild") {
      const holder = role === "parent" ? r.parent : r.child;
      const other = role === "parent" ? r.child : r.parent;
      if (other === p.id) ids.add(holder);
      if (holder === p.id) ids.add(p.id);
    }
  }
  return (record.persons ?? []).filter((x: Json) => ids.has(x.id));
}

/**
 * The record persona that is the tree person `sid`, or why none can be chosen.
 * Subject-level: the ARK's own persona. Relationship-level: the ARK names the
 * other party, so take the persona holding the person's role relative to it,
 * narrowed by the person's gender. Never guesses: with no known gender a lone
 * candidate could be the other parent or partner, so nothing is chosen.
 */
export function selectSubjectPersona(tree: PersonaSelectTree, sid: string, entry: PersonaSelectEntry, record: Json): PersonaSelection {
  if (!record || record.is_error || !entry.ark) return { unscored: "record_unreadable" };
  const p = personaFor(record, entry.ark);
  if (!p) return { unscored: "record_unreadable" };
  if (entry.level === "subject") return { persona_id: p.id, selected_by: "ark" };

  const gender = tree.persons?.find((x) => x.id === sid)?.gender;
  if (!gender || gender === "Unknown") return { unscored: "no_gender" };
  const picks = new Map<string, EdgeRole>();
  let ambiguous = false;
  const roles = subjectRoles(tree, sid, entry);
  if (roles.length === 0) return { unscored: "no_relationship" };
  for (const role of roles) {
    const cands = roleCandidates(record, p, role).filter((c) => c.gender === gender);
    if (cands.length === 0) return { unscored: "no_relationship" };
    if (cands.length > 1) ambiguous = true;
    else picks.set(cands[0].id, role);
  }
  if (ambiguous) return { unscored: "ambiguous" };
  if (picks.size > 1) return { unscored: "edges_disagree" };
  const [[persona_id, role]] = [...picks];
  return { persona_id, selected_by: `role:${role}` };
}

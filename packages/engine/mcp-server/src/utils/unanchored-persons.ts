// The persons a finished project no longer needs: minted persons that no
// relationship edge connects, directly or through other persons, to an imported
// one. research_append removes them in the write that resolves the project's
// last open question (lead ruling, 2026-11-04, issue #3032).
//
// Anchors are the persons the project did not mint: a FamilySearch-shaped id, a
// starting-tree person, a person carrying an attachment link, and a project
// subject. A person research.json names anywhere other than a link is kept too:
// a proof summary, timeline, namesake row or warning justification that names
// it is a conclusion about it. So is a person whose links are the last ones
// behind a proof summary, which `unlinkedProofInvariants` would otherwise refuse
// on every later write to that summary. The links to a removed person
// (`person_evidence`, `rejected_links`) go with it, or they would dangle.

import { iteratePersonIdRefs } from "../validation/person-id-refs.js";
import { relationshipEndpoints } from "./relationship-endpoints.js";
import { countsForProofGate, isAttachmentLink } from "./tree-person.js";

/** research.json fields whose reference to a person goes when the person goes. */
const LINK_FIELDS = new Set(["person_evidence", "rejected_links"]);

const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/** Every person the anchors reach through relationship edges, anchors included. */
function reachable(tree: any, anchors: Set<string>): Set<string> {
  const neighbours = new Map<string, Set<string>>();
  for (const rel of list(tree?.relationships)) {
    const ends = relationshipEndpoints(rel ?? {});
    for (const a of ends) {
      for (const b of ends) {
        if (a === b) continue;
        if (!neighbours.has(a)) neighbours.set(a, new Set());
        neighbours.get(a)!.add(b);
      }
    }
  }
  const reached = new Set<string>(anchors);
  const queue = [...anchors];
  while (queue.length > 0) {
    for (const next of neighbours.get(queue.pop()!) ?? []) {
      if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }
  return reached;
}

/** The persons whose links would be the last proof-gate links behind a proof
 *  summary above `not_proved` once `removed` goes. */
function lastProofLinkHolders(research: any, removed: Set<string>): string[] {
  const links = list(research?.person_evidence).filter(countsForProofGate);
  const holders = new Set<string>();
  for (const ps of list(research?.proof_summaries)) {
    if (typeof ps?.tier !== "string" || ps.tier === "not_proved") continue;
    const supporting = new Set(list(ps.supporting_assertion_ids));
    const behind = links.filter((pe: any) => supporting.has(pe?.assertion_id));
    if (behind.length > 0 && behind.every((pe: any) => removed.has(pe?.person_id))) {
      for (const pe of behind) holders.add(pe.person_id);
    }
  }
  return [...holders];
}

/** The ids of the minted persons no edge path connects to an anchor, sorted.
 *  Empty when the tree holds no anchor at all: with nothing known to be
 *  imported, every person would read as minted, so nothing is removed. */
export function unanchoredMintedPersonIds(
  tree: any,
  research: any,
  isImported: (personId: string) => boolean,
): string[] {
  const ids: string[] = list(tree?.persons)
    .map((p: any) => p?.id)
    .filter((id: unknown): id is string => typeof id === "string" && id !== "");
  const present = new Set<string>(ids);

  const anchors = new Set<string>(ids.filter(isImported));
  for (const pe of list(research?.person_evidence)) {
    if (isAttachmentLink(pe) && present.has(pe?.person_id)) anchors.add(pe.person_id);
  }
  for (const id of list(research?.project?.subject_person_ids)) {
    if (present.has(id)) anchors.add(id);
  }
  if (anchors.size === 0) return [];
  for (const ref of iteratePersonIdRefs(research ?? {})) {
    if (!LINK_FIELDS.has(ref.field) && present.has(ref.pid)) anchors.add(ref.pid);
  }
  for (const wj of list(research?.warning_justifications)) {
    for (const id of list(wj?.person_ids)) if (present.has(id)) anchors.add(id);
  }

  for (;;) {
    const reached = reachable(tree, anchors);
    const removed = new Set(ids.filter((id) => !reached.has(id)));
    const keep = lastProofLinkHolders(research, removed);
    if (keep.length === 0) return [...removed].sort();
    for (const id of keep) anchors.add(id);
  }
}

export interface UnanchoredRemoval {
  persons: { id: string; name: string }[];
  relationshipCount: number;
  personEvidenceCount: number;
  rejectedLinkCount: number;
}

/** A person's preferred name, else its first, as one line. */
function displayName(person: any): string {
  const names = list(person?.names);
  const n = names.find((x: any) => x?.preferred) ?? names[0];
  return [n?.prefix, n?.given, n?.surname, n?.suffix].filter((s) => typeof s === "string" && s !== "").join(" ");
}

/** Remove `personIds` from the tree, with every relationship that touches one
 *  and every `person_evidence` and `rejected_links` entry that names one.
 *  Mutates both documents and reports what went, each person by name. */
export function removeUnanchoredPersons(tree: any, research: any, personIds: string[]): UnanchoredRemoval {
  const gone = new Set(personIds);
  const removed: UnanchoredRemoval = { persons: [], relationshipCount: 0, personEvidenceCount: 0, rejectedLinkCount: 0 };
  if (gone.size === 0) return removed;

  removed.persons = list(tree.persons)
    .filter((p: any) => gone.has(p?.id))
    .map((p: any) => ({ id: p.id, name: displayName(p) }));
  tree.persons = list(tree.persons).filter((p: any) => !gone.has(p?.id));
  const relationships = list(tree.relationships);
  tree.relationships = relationships.filter((rel: any) => !relationshipEndpoints(rel ?? {}).some((id) => gone.has(id)));
  removed.relationshipCount = relationships.length - tree.relationships.length;
  for (const [field, key] of [
    ["person_evidence", "personEvidenceCount"],
    ["rejected_links", "rejectedLinkCount"],
  ] as const) {
    if (!Array.isArray(research?.[field])) continue;
    const before = research[field].length;
    research[field] = research[field].filter((entry: any) => !gone.has(entry?.person_id));
    removed[key] = before - research[field].length;
  }
  return removed;
}

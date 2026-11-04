// The persons a finished project no longer needs: minted persons that no
// relationship edge connects, directly or through other persons, to an imported
// one. research_append removes them in the write that resolves the project's
// last open question (lead ruling, 2026-11-04, issue #3032).
//
// Anchors are the persons the project did not mint: a FamilySearch-shaped id, a
// starting-tree person, a person carrying an attachment link, and a project
// subject. A person research.json names anywhere other than a link is kept too:
// a proof summary, timeline or namesake row that names it is a conclusion
// about it. The links to a removed person (`person_evidence`, `rejected_links`)
// go with it, or they would dangle.

import { iteratePersonIdRefs } from "../validation/person-id-refs.js";
import { isAttachmentLink } from "./tree-person.js";

/** research.json fields whose reference to a person goes when the person goes. */
const LINK_FIELDS = new Set(["person_evidence", "rejected_links"]);

/** The edge endpoints of one simplified relationship. */
function endpoints(rel: any): string[] {
  return [rel?.parent, rel?.child, rel?.person1, rel?.person2].filter(
    (id): id is string => typeof id === "string" && id !== "",
  );
}

/** The ids of the minted persons no edge path connects to an anchor, sorted.
 *  Empty when the tree holds no anchor at all: with nothing known to be
 *  imported, every person would read as minted, so nothing is removed. */
export function unanchoredMintedPersonIds(
  tree: any,
  research: any,
  isImported: (personId: string) => boolean,
): string[] {
  const ids: string[] = (Array.isArray(tree?.persons) ? tree.persons : [])
    .map((p: any) => p?.id)
    .filter((id: unknown): id is string => typeof id === "string" && id !== "");
  const present = new Set<string>(ids);

  const anchors = new Set<string>(ids.filter(isImported));
  for (const pe of Array.isArray(research?.person_evidence) ? research.person_evidence : []) {
    if (isAttachmentLink(pe) && present.has(pe?.person_id)) anchors.add(pe.person_id);
  }
  for (const id of Array.isArray(research?.project?.subject_person_ids) ? research.project.subject_person_ids : []) {
    if (present.has(id)) anchors.add(id);
  }
  if (anchors.size === 0) return [];
  for (const ref of iteratePersonIdRefs(research ?? {})) {
    if (!LINK_FIELDS.has(ref.field) && present.has(ref.pid)) anchors.add(ref.pid);
  }

  const neighbours = new Map<string, Set<string>>();
  for (const rel of Array.isArray(tree?.relationships) ? tree.relationships : []) {
    const ends = endpoints(rel);
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
  return ids.filter((id) => !reached.has(id)).sort();
}

export interface UnanchoredRemoval {
  personIds: string[];
  relationshipIds: string[];
  personEvidenceIds: string[];
  rejectedLinkIds: string[];
}

/** Remove `personIds` from the tree, with every relationship that touches one
 *  and every `person_evidence` and `rejected_links` entry that names one.
 *  Mutates both documents and reports what went. */
export function removeUnanchoredPersons(tree: any, research: any, personIds: string[]): UnanchoredRemoval {
  const gone = new Set(personIds);
  const removed: UnanchoredRemoval = { personIds: [...personIds], relationshipIds: [], personEvidenceIds: [], rejectedLinkIds: [] };
  if (gone.size === 0) return removed;

  tree.persons = (tree.persons ?? []).filter((p: any) => !gone.has(p?.id));
  tree.relationships = (Array.isArray(tree.relationships) ? tree.relationships : []).filter((rel: any) => {
    if (!endpoints(rel).some((id) => gone.has(id))) return true;
    if (typeof rel?.id === "string") removed.relationshipIds.push(rel.id);
    return false;
  });
  for (const [field, ids] of [
    ["person_evidence", removed.personEvidenceIds],
    ["rejected_links", removed.rejectedLinkIds],
  ] as const) {
    if (!Array.isArray(research?.[field])) continue;
    research[field] = research[field].filter((entry: any) => {
      if (!gone.has(entry?.person_id)) return true;
      if (typeof entry?.id === "string") ids.push(entry.id);
      return false;
    });
  }
  return removed;
}

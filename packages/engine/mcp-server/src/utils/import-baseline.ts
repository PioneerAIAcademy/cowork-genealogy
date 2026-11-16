// Decision 7 of docs/plan/conclusion-tree.md: which tree objects are imports —
// other researchers' conclusions the project started with — rather than
// anything this project found or concluded.
//
// An import is anything in starting-tree.gedcomx.json. With no baseline (most
// production projects have none) it is anything carrying the FamilySearch-tree
// source at quality 1 among its refs (person-read-tree.ts puts one on every
// imported fact and relationship), or carrying no refs at all. "Only refs" would
// not do: corroboration adds record refs to an import. With a baseline, an object
// whose holder the baseline lacks (a minted person, or a merge survivor) is an
// import only by that FamilySearch-tree ref: a minted object often has no refs.

import type { SimplifiedFact } from "../types/gedcomx.js";
import { sameFactValue } from "./fact-helpers.js";

const FS_TREE_URL = "https://www.familysearch.org/tree";
const FS_TREE_TITLE = "FamilySearch Family Tree";

/** The ids of tree sources that are the FamilySearch Family Tree itself: by its
 *  url or its title, never by an id alone. */
export function familySearchTreeSourceIds(tree: any): Set<string> {
  const ids = new Set<string>();
  for (const s of Array.isArray(tree?.sources) ? tree.sources : []) {
    if (typeof s?.id !== "string") continue;
    const url = typeof s.url === "string" ? s.url.trim().replace(/\/+$/, "") : "";
    const title = typeof s.title === "string" ? s.title : "";
    if (url === FS_TREE_URL || title.startsWith(FS_TREE_TITLE)) ids.add(s.id);
  }
  return ids;
}

const ends = (r: any): string[] =>
  r?.type === "Couple"
    ? [String(r.person1), String(r.person2)].sort()
    : [String(r?.parent), String(r?.child)];
const edgeKey = (r: any) => `${r?.type}:${ends(r).join(r?.type === "Couple" ? "+" : ">")}`;

export interface ImportBaseline {
  /** The fact `fact`, held by `holderIds` (a person's id, or a Couple's two),
   *  came with the starting tree. */
  isImportFact(holderIds: readonly string[], fact: any): boolean;
  /** The edge came with the starting tree. */
  isImportEdge(edge: any): boolean;
}

export function importBaseline(tree: any, startingTree: any | null): ImportBaseline {
  const fsTree = familySearchTreeSourceIds(tree);
  const fsRef = (obj: any): boolean =>
    (Array.isArray(obj?.sources) ? obj.sources : []).some(
      (r: any) => fsTree.has(String(r?.ref)) && Number(r?.quality) === 1,
    );
  // With no baseline, an object with no refs at all is an import too.
  const byRefs = (obj: any): boolean =>
    (Array.isArray(obj?.sources) ? obj.sources : []).length === 0 || fsRef(obj);
  if (!startingTree) {
    return { isImportFact: (_h, fact) => byRefs(fact), isImportEdge: byRefs };
  }

  const baselinePersons = new Set<string>(
    (Array.isArray(startingTree?.persons) ? startingTree.persons : []).map((p: any) => String(p?.id)),
  );
  const baselineEdges = new Map<string, any>();
  const baselineFacts = new Map<string, any[]>();
  for (const p of Array.isArray(startingTree?.persons) ? startingTree.persons : []) {
    baselineFacts.set(String(p?.id), Array.isArray(p?.facts) ? p.facts : []);
  }
  for (const r of Array.isArray(startingTree?.relationships) ? startingTree.relationships : []) {
    baselineEdges.set(edgeKey(r), r);
    if (r?.type === "Couple") baselineFacts.set(ends(r).join("+"), Array.isArray(r.facts) ? r.facts : []);
  }

  return {
    isImportEdge(edge) {
      if (baselineEdges.has(edgeKey(edge))) return true;
      // An endpoint the baseline lacks: a person this project minted, or the
      // survivor of a merge that removed the baseline person. Only the
      // FamilySearch-tree ref the import carried still marks it; a minted
      // object often has no refs, so "no refs" says nothing here.
      return !ends(edge).every((p) => baselinePersons.has(p)) && fsRef(edge);
    },
    isImportFact(holderIds, fact) {
      const holder = [...holderIds].sort().join("+");
      if (!holderIds.every((p) => baselinePersons.has(p))) return fsRef(fact);
      const facts = baselineFacts.get(holder) ?? [];
      // Strict equality on type, date, place and value, not the merge tools'
      // compatibility test (Decision 31), and never an id alone: an added "Birth
      // 25 Nov 1879" beside an imported "Birth 1879", a dated Residence beside an
      // undated import, and an import this project edited in place (update_fact
      // keeps the id) are not the import.
      return facts.some((f) => sameFactValue(f as SimplifiedFact, fact as SimplifiedFact));
    },
  };
}

// tree_query — read-only filtered read of tree.gedcomx.json.
//
// The tree-side companion of research_query (which never serves the tree) and
// project_context (which carries only ids, names and one-hop family): agents
// that need a person's facts, dates, places, ark, marriages or a source's
// author call this instead of opening the file, which Cowork's VM cannot see.
// Spec: docs/specs/tree-query-tool-spec.md.

import { readProjectJson, NoProjectError, noProjectResult } from "../utils/project-io.js";

export interface TreeQueryInput {
  projectPath: string;
  /** Persons to return; omitted or empty = every person. */
  personIds?: string[];
  /** Keep only facts whose type's last URI segment matches one of these (case-insensitive). */
  factTypes?: string[];
}

export interface TreeQueryFact {
  id: string | null;
  type: string | null;
  primary: boolean | null;
  date: string | null;
  standardDate: string | null;
  place: string | null;
  standardPlace: string | null;
  value: string | null;
  assertionId: string | null;
  sourceRefs: string[];
}

export interface TreeQueryName {
  id: string | null;
  preferred: boolean;
  type: string | null;
  prefix: string | null;
  given: string | null;
  surname: string | null;
  suffix: string | null;
}

export interface TreeQueryPerson {
  id: string;
  ark: string | null;
  living: boolean | null;
  gender: string | null;
  names: TreeQueryName[];
  facts: TreeQueryFact[];
  sourceRefs: string[];
}

export interface TreeQueryRelationship {
  id: string | null;
  /** "Couple" or "ParentChild" (last URI segment); the raw type when neither. */
  type: string | null;
  person1: string | null;
  person2: string | null;
  parent: string | null;
  child: string | null;
  subtype: string | null;
  facts: TreeQueryFact[];
  notes: string[];
  sourceRefs: string[];
}

export interface TreeQuerySource {
  id: string;
  title: string | null;
  citation: string | null;
  author: string | null;
  url: string | null;
}

export type TreeQueryResult =
  | {
      ok: true;
      persons: TreeQueryPerson[];
      /** Edges with at least one end among the returned persons (all edges when no filter). */
      relationships: TreeQueryRelationship[];
      /** Source descriptions cited by a returned person, fact, name or relationship. */
      sources: TreeQuerySource[];
      /** Requested personIds that are not in the tree. */
      missingPersonIds: string[];
    }
  | { ok: false; errors: string[]; reason?: "no_project" };

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const lastSegment = (t: unknown): string | null => (typeof t === "string" ? t.split("/").pop() ?? t : null);

function refsOf(holder: any): string[] {
  const out: string[] = [];
  for (const r of Array.isArray(holder?.sources) ? holder.sources : []) {
    if (r && typeof r.ref === "string" && !out.includes(r.ref)) out.push(r.ref);
  }
  return out;
}

function projectFact(f: any): TreeQueryFact {
  return {
    id: str(f?.id),
    type: str(f?.type),
    primary: typeof f?.primary === "boolean" ? f.primary : null,
    date: str(f?.date),
    standardDate: str(f?.standard_date),
    place: str(f?.place),
    standardPlace: str(f?.standard_place),
    value: str(f?.value),
    assertionId: str(f?.assertion_id),
    sourceRefs: refsOf(f),
  };
}

function projectFacts(holder: any, wanted: Set<string> | null): TreeQueryFact[] {
  const out: TreeQueryFact[] = [];
  for (const f of Array.isArray(holder?.facts) ? holder.facts : []) {
    if (!f || typeof f !== "object") continue;
    if (wanted && !wanted.has((lastSegment(f.type) ?? "").toLowerCase())) continue;
    out.push(projectFact(f));
  }
  return out;
}

function projectPerson(p: any, wanted: Set<string> | null): TreeQueryPerson {
  const refs = new Set<string>(refsOf(p));
  const names: TreeQueryName[] = [];
  for (const n of Array.isArray(p.names) ? p.names : []) {
    if (!n || typeof n !== "object") continue;
    for (const r of refsOf(n)) refs.add(r);
    names.push({
      id: str(n.id),
      preferred: n.preferred === true,
      type: str(n.type),
      prefix: str(n.prefix),
      given: str(n.given),
      surname: str(n.surname),
      suffix: str(n.suffix),
    });
  }
  // Source refs span every fact, kept or filtered out, so a factTypes filter
  // never changes which S ids a person is reported as citing.
  for (const f of Array.isArray(p.facts) ? p.facts : []) for (const r of refsOf(f)) refs.add(r);
  return {
    id: p.id,
    ark: str(p.ark),
    living: typeof p.living === "boolean" ? p.living : null,
    gender: str(p.gender),
    names,
    facts: projectFacts(p, wanted),
    sourceRefs: [...refs],
  };
}

export async function treeQuery(input: TreeQueryInput): Promise<TreeQueryResult> {
  let tree: any;
  try {
    tree = await readProjectJson(input.projectPath, "tree.gedcomx.json");
  } catch (e) {
    if (e instanceof NoProjectError) return noProjectResult("read");
    return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
  }

  const ids = input.personIds;
  if (ids !== undefined && (!Array.isArray(ids) || ids.some((i) => typeof i !== "string"))) {
    return { ok: false, errors: ["personIds must be an array of strings"] };
  }
  const types = input.factTypes;
  if (types !== undefined && (!Array.isArray(types) || types.some((t) => typeof t !== "string"))) {
    return { ok: false, errors: ["factTypes must be an array of strings"] };
  }
  const wantedIds = ids && ids.length > 0 ? new Set(ids) : null;
  const wantedTypes = types && types.length > 0 ? new Set(types.map((t) => t.toLowerCase())) : null;

  const persons: TreeQueryPerson[] = [];
  const found = new Set<string>();
  for (const p of Array.isArray(tree?.persons) ? tree.persons : []) {
    if (!p || typeof p !== "object" || typeof p.id !== "string") continue;
    if (wantedIds && !wantedIds.has(p.id)) continue;
    found.add(p.id);
    persons.push(projectPerson(p, wantedTypes));
  }

  const refs = new Set<string>();
  for (const p of persons) for (const r of p.sourceRefs) refs.add(r);

  const relationships: TreeQueryRelationship[] = [];
  for (const r of Array.isArray(tree?.relationships) ? tree.relationships : []) {
    if (!r || typeof r !== "object") continue;
    const ends = [r.person1, r.person2, r.parent, r.child].filter((x): x is string => typeof x === "string");
    if (wantedIds && !ends.some((e) => found.has(e))) continue;
    for (const ref of refsOf(r)) refs.add(ref);
    for (const f of Array.isArray(r.facts) ? r.facts : []) for (const ref of refsOf(f)) refs.add(ref);
    relationships.push({
      id: str(r.id),
      type: lastSegment(r.type),
      person1: str(r.person1),
      person2: str(r.person2),
      parent: str(r.parent),
      child: str(r.child),
      subtype: str(r.subtype),
      facts: projectFacts(r, wantedTypes),
      sourceRefs: refsOf(r),
      notes: (Array.isArray(r.notes) ? r.notes : []).filter((n: unknown): n is string => typeof n === "string"),
    });
  }

  const sources: TreeQuerySource[] = [];
  for (const s of Array.isArray(tree?.sources) ? tree.sources : []) {
    if (!s || typeof s !== "object" || typeof s.id !== "string" || !refs.has(s.id)) continue;
    sources.push({
      id: s.id,
      title: str(s.title),
      citation: str(s.citation),
      author: str(s.author),
      url: str(s.url),
    });
  }

  return {
    ok: true,
    persons,
    relationships,
    sources,
    missingPersonIds: wantedIds ? [...wantedIds].filter((i) => !found.has(i)) : [],
  };
}

export const treeQuerySchema = {
  name: "tree_query",
  description:
    "Read-only: the tree's own facts, so you never open tree.gedcomx.json. Returns persons " +
    "[{id, ark, living, gender, names, facts, sourceRefs}] with each fact's type, date, " +
    "standardDate, place, standardPlace, value and sourceRefs; relationships [{type: Couple " +
    "or ParentChild, person1, person2, parent, child, subtype, facts, notes}] — marriages " +
    "and their dates live on the Couple's facts; sources [{id, title, citation, author, " +
    "url}] cited by what is returned; and missingPersonIds. personIds limits the persons " +
    "(and the edges touching them); omit it for the whole tree, which can be large. " +
    "factTypes (e.g. [\"Birth\", \"Death\", \"Marriage\"]) keeps only those fact types. " +
    "For ids, names, one-hop family and open questions use project_context; for research " +
    "records use research_query. Writes nothing.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectPath: {
        type: "string",
        description: "Absolute path to the project directory holding tree.gedcomx.json.",
      },
      personIds: {
        type: "array",
        items: { type: "string" },
        description: "Tree person ids to return. Omit for every person.",
      },
      factTypes: {
        type: "array",
        items: { type: "string" },
        description: "Fact types to keep, matched case-insensitively on the type's last URI segment. Omit for all.",
      },
    },
    required: ["projectPath"],
  },
};

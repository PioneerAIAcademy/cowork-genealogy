// tree_query — read-only filtered read of tree.gedcomx.json.
//
// The tree-side companion of research_query (which never serves the tree) and
// project_context (which carries only ids, names and one-hop family): agents
// that need a person's facts, dates, places, ark, marriages or a source's
// author call this instead of opening the file, which Cowork's VM cannot see.
// Spec: docs/specs/tree-query-tool-spec.md.

import { readProjectJson, NoProjectError, noProjectResult } from "../utils/project-io.js";
import { linkedPersons } from "../utils/tree-person.js";
import { TOOL_RESULT_CHAR_BUDGET } from "../constants.js";

export interface TreeQueryInput {
  projectPath: string;
  /** Persons to return, by tree id or FamilySearch id; omitted or empty = every person. */
  personIds?: string[];
  /** Keep only facts whose type's last URI segment matches one of these (case-insensitive). */
  factTypes?: string[];
  /** Return the source entries cited by what is returned. */
  includeSources?: boolean;
  /** Return these source entries, cited or not. Implies includeSources. */
  sourceIds?: string[];
}

// A key that would be null, "" or [] is left out of every object below; a
// fact's `place` is left out when it equals `standardPlace`, and its `date`
// when it equals `standardDate`. `preferred` and `primary` are sent only when
// true, the tree file's own rule (simplified-gedcomx-spec.md §6).

export interface TreeQueryFact {
  id?: string;
  type?: string;
  primary?: true;
  date?: string;
  standardDate?: string;
  place?: string;
  standardPlace?: string;
  value?: string;
  assertionId?: string;
  sourceRefs?: string[];
}

export interface TreeQueryName {
  id?: string;
  preferred?: true;
  type?: string;
  prefix?: string;
  given?: string;
  surname?: string;
  suffix?: string;
}

export interface TreeQueryPerson {
  id: string;
  ark?: string;
  living?: boolean;
  gender?: string;
  names?: TreeQueryName[];
  facts?: TreeQueryFact[];
  sourceRefs?: string[];
}

export interface TreeQueryRelationship {
  id?: string;
  /** "Couple" or "ParentChild" (last URI segment); the raw type when neither. */
  type?: string;
  person1?: string;
  person2?: string;
  parent?: string;
  child?: string;
  subtype?: string;
  facts?: TreeQueryFact[];
  notes?: string[];
  sourceRefs?: string[];
}

export interface TreeQuerySource {
  id: string;
  title?: string;
  citation?: string;
  author?: string;
  url?: string;
}

export type TreeQueryResult =
  | {
      ok: true;
      /** The answer was cut to TOOL_RESULT_CHAR_BUDGET; the omitted ids say what to ask for next. */
      truncated?: true;
      omittedPersonIds?: string[];
      omittedSourceIds?: string[];
      persons: TreeQueryPerson[];
      /** Edges with at least one end among the returned persons (all edges when no filter). */
      relationships: TreeQueryRelationship[];
      /** Only with includeSources or sourceIds. */
      sources?: TreeQuerySource[];
      /** Requested personIds that match no tree id and no person's FamilySearch link. */
      missingPersonIds: string[];
    }
  | { ok: false; errors: string[]; reason?: "no_project" };

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const lastSegment = (t: unknown): string | null => (typeof t === "string" ? t.split("/").pop() ?? t : null);

/** `obj` without its null, undefined, "" and [] values. */
function compact<T extends object>(obj: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out as T;
}

function refsOf(holder: any): string[] {
  const out: string[] = [];
  for (const r of Array.isArray(holder?.sources) ? holder.sources : []) {
    if (r && typeof r.ref === "string" && !out.includes(r.ref)) out.push(r.ref);
  }
  return out;
}

function projectFact(f: any): TreeQueryFact {
  const date = str(f?.date);
  const standardDate = str(f?.standard_date);
  const place = str(f?.place);
  const standardPlace = str(f?.standard_place);
  return compact<TreeQueryFact>({
    id: str(f?.id),
    type: str(f?.type),
    primary: f?.primary === true ? true : null,
    date: date !== null && date === standardDate ? null : date,
    standardDate,
    place: place !== null && place === standardPlace ? null : place,
    standardPlace,
    value: str(f?.value),
    assertionId: str(f?.assertion_id),
    sourceRefs: refsOf(f),
  });
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
    names.push(
      compact<TreeQueryName>({
        id: str(n.id),
        preferred: n.preferred === true ? true : null,
        type: str(n.type),
        prefix: str(n.prefix),
        given: str(n.given),
        surname: str(n.surname),
        suffix: str(n.suffix),
      }),
    );
  }
  // Source refs span every fact, kept or filtered out, so a factTypes filter
  // never changes which S ids a person is reported as citing.
  for (const f of Array.isArray(p.facts) ? p.facts : []) for (const r of refsOf(f)) refs.add(r);
  return compact<TreeQueryPerson>({
    id: p.id,
    ark: str(p.ark),
    living: typeof p.living === "boolean" ? p.living : null,
    gender: str(p.gender),
    names,
    facts: projectFacts(p, wanted),
    sourceRefs: [...refs],
  });
}

/** An edge's ends, as given. */
function endsOf(r: any): string[] {
  return [r.person1, r.person2, r.parent, r.child].filter((x): x is string => typeof x === "string");
}

/** An edge's projection and every S id it cites, its facts' included. */
function projectEdge(r: any, wanted: Set<string> | null): { edge: TreeQueryRelationship; refs: string[] } {
  const refs = new Set(refsOf(r));
  for (const f of Array.isArray(r.facts) ? r.facts : []) for (const ref of refsOf(f)) refs.add(ref);
  const edge = compact<TreeQueryRelationship>({
    id: str(r.id),
    type: lastSegment(r.type),
    person1: str(r.person1),
    person2: str(r.person2),
    parent: str(r.parent),
    child: str(r.child),
    subtype: str(r.subtype),
    facts: projectFacts(r, wanted),
    notes: (Array.isArray(r.notes) ? r.notes : []).filter((n: unknown): n is string => typeof n === "string"),
    sourceRefs: refsOf(r),
  });
  return { edge, refs: [...refs] };
}

function projectSource(s: any): TreeQuerySource {
  return compact<TreeQuerySource>({
    id: s.id,
    title: str(s.title),
    citation: str(s.citation),
    author: str(s.author),
    url: str(s.url),
  });
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((i) => typeof i === "string");

export async function treeQuery(input: TreeQueryInput): Promise<TreeQueryResult> {
  let tree: any;
  try {
    tree = await readProjectJson(input.projectPath, "tree.gedcomx.json");
  } catch (e) {
    if (e instanceof NoProjectError) return noProjectResult("read");
    return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
  }

  const errors: string[] = [];
  if (input.personIds !== undefined && !isStringArray(input.personIds)) errors.push("personIds must be an array of strings");
  if (input.factTypes !== undefined && !isStringArray(input.factTypes)) errors.push("factTypes must be an array of strings");
  if (input.includeSources !== undefined && typeof input.includeSources !== "boolean") errors.push("includeSources must be a boolean");
  if (input.sourceIds !== undefined && !isStringArray(input.sourceIds)) errors.push("sourceIds must be an array of strings");
  if (errors.length > 0) return { ok: false, errors };

  const ids = input.personIds && input.personIds.length > 0 ? input.personIds : null;
  const types = input.factTypes;
  const wantedTypes = types && types.length > 0 ? new Set(types.map((t) => t.toLowerCase())) : null;
  const namedSources = input.sourceIds && input.sourceIds.length > 0 ? [...new Set(input.sourceIds)] : null;
  const withSources = input.includeSources === true || input.sourceIds !== undefined;

  const treePersons: any[] = (Array.isArray(tree?.persons) ? tree.persons : []).filter(
    (p: any) => p && typeof p === "object" && typeof p.id === "string",
  );

  // Requested order; a FamilySearch id expands to every person it links to.
  let selected: any[];
  const missingPersonIds: string[] = [];
  if (ids) {
    const seen = new Set<string>();
    selected = [];
    for (const id of ids) {
      const byId = treePersons.find((p) => p.id === id);
      const hits = byId ? [byId] : linkedPersons(treePersons, id);
      if (hits.length === 0) {
        if (!missingPersonIds.includes(id)) missingPersonIds.push(id);
        continue;
      }
      for (const p of hits) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        selected.push(p);
      }
    }
  } else {
    selected = treePersons;
  }

  const persons = selected.map((p) => projectPerson(p, wantedTypes));
  const edges = (Array.isArray(tree?.relationships) ? tree.relationships : [])
    .filter((r: any) => r && typeof r === "object")
    .map((r: any) => ({ ends: endsOf(r), ...projectEdge(r, wantedTypes) }));
  const sourceById = new Map<string, any>();
  for (const s of Array.isArray(tree?.sources) ? tree.sources : []) {
    if (s && typeof s === "object" && typeof s.id === "string" && !sourceById.has(s.id)) sourceById.set(s.id, s);
  }
  const treeSourceOrder = [...sourceById.keys()];

  /** The edges for the first `k` persons: every edge when nothing narrows the
   *  persons, else those with an end among them. */
  const edgesFor = (k: number) => {
    if (!ids && k === persons.length) return edges;
    const kept = new Set(persons.slice(0, k).map((p) => p.id));
    return edges.filter((e: any) => e.ends.some((end: string) => kept.has(end)));
  };
  const citedBy = (k: number, keptEdges: any[]): Set<string> => {
    const refs = new Set<string>();
    for (const p of persons.slice(0, k)) for (const r of p.sourceRefs ?? []) refs.add(r);
    for (const e of keptEdges) for (const r of e.refs) refs.add(r);
    return refs;
  };
  /** The source ids returned for `k` persons, before any source is cut. */
  const sourceIdsFor = (k: number, keptEdges: any[]): string[] => {
    if (!withSources) return [];
    if (namedSources) return namedSources.filter((id) => sourceById.has(id));
    const cited = citedBy(k, keptEdges);
    return treeSourceOrder.filter((id) => cited.has(id));
  };

  const uncappedEdges = edgesFor(persons.length);
  const allSourceIds = sourceIdsFor(persons.length, uncappedEdges);

  const build = (k: number, sourceCount: number) => {
    const keptEdges = edgesFor(k);
    const sourceIds = sourceIdsFor(k, keptEdges).slice(0, sourceCount);
    const omittedPersons = persons.slice(k).map((p) => p.id);
    // A cited source no kept person or edge cites comes back with the omitted
    // persons' follow-up read, so only one a kept one cites is listed. A named
    // source rides on no person, so every one cut is listed.
    const keptCited = namedSources ? null : citedBy(k, keptEdges);
    const returned = new Set(sourceIds);
    const omittedSources = allSourceIds.filter(
      (id) => !returned.has(id) && (keptCited === null || keptCited.has(id)),
    );
    const truncated = omittedPersons.length > 0 || omittedSources.length > 0;
    const result: TreeQueryResult = {
      ok: true,
      ...(truncated ? { truncated: true as const } : {}),
      ...(omittedPersons.length > 0 ? { omittedPersonIds: omittedPersons } : {}),
      ...(omittedSources.length > 0 ? { omittedSourceIds: omittedSources } : {}),
      persons: persons.slice(0, k),
      relationships: keptEdges.map((e: any) => e.edge),
      ...(withSources ? { sources: sourceIds.map((id) => projectSource(sourceById.get(id))) } : {}),
      missingPersonIds,
    };
    return result;
  };
  const size = (r: TreeQueryResult) => JSON.stringify(r).length;
  const fits = (r: TreeQueryResult) => size(r) <= TOOL_RESULT_CHAR_BUDGET;

  /** The largest `n` in [lo, hi] for which `ok(n)`, or `lo` when none is. */
  const largest = (lo: number, hi: number, ok: (n: number) => boolean): number => {
    let best = lo;
    let a = lo;
    let b = hi;
    while (a <= b) {
      const mid = (a + b) >> 1;
      if (ok(mid)) {
        best = mid;
        a = mid + 1;
      } else {
        b = mid - 1;
      }
    }
    return best;
  };

  const all = persons.length;
  const full = build(all, allSourceIds.length);
  if (fits(full) || all === 0) return full;

  // Named sources are cut before persons when that alone fits every person;
  // when the persons alone are over, the named sources are kept and persons
  // go. Cited sources go with the persons who cite them, so persons go first.
  if (namedSources) {
    if (fits(build(all, 0))) {
      return build(all, largest(0, allSourceIds.length, (n) => fits(build(all, n))));
    }
    const k = largest(1, all, (n) => fits(build(n, allSourceIds.length)));
    if (fits(build(k, allSourceIds.length))) return build(k, allSourceIds.length);
    return build(k, largest(0, allSourceIds.length, (n) => fits(build(k, n))));
  }
  const k = largest(1, all, (n) => fits(build(n, Number.MAX_SAFE_INTEGER)));
  const kept = build(k, Number.MAX_SAFE_INTEGER);
  if (fits(kept) || !withSources) return kept;
  const s = largest(0, sourceIdsFor(k, edgesFor(k)).length, (n) => fits(build(k, n)));
  return build(k, s);
}

export const treeQuerySchema = {
  name: "tree_query",
  description:
    "Read-only: the tree's own facts, so you never open tree.gedcomx.json. Returns persons " +
    "[{id, ark, living, gender, names, facts, sourceRefs}] with each fact's type, date, " +
    "standardDate, place, standardPlace, value and sourceRefs; relationships [{type: Couple " +
    "or ParentChild, person1, person2, parent, child, subtype, facts, notes}] — marriages " +
    "and their dates live on the Couple's facts; and missingPersonIds. A key that would be " +
    "null or empty is left out (preferred and primary are sent only when true), and a fact's place (or date) is left out when it equals " +
    "standardPlace (or standardDate). Source entries [{id, title, citation, author, url}] " +
    "come back only when asked: includeSources: true returns those cited by what is " +
    "returned; sourceIds returns the named ones, cited or not. To read a person's sources, " +
    "ask for that person by personIds with includeSources, not the whole tree. personIds " +
    "takes tree ids or FamilySearch ids (a FamilySearch id returns every person linked to " +
    "it) and returns them in that order; omit it for the whole tree. factTypes (e.g. " +
    "[\"Birth\", \"Death\", \"Marriage\"]) keeps only those fact types. An answer too large " +
    "for one result is cut from the end and carries truncated: true: call again with personIds: " +
    "omittedPersonIds (and includeSources: true if you set it), and for omittedSourceIds " +
    "with personIds: [<first returned id>], sourceIds: omittedSourceIds. For ids, names, " +
    "one-hop family and open questions use project_context; for research records use " +
    "research_query. Writes nothing.",
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
        description:
          "Persons to return, by tree id (I1) or FamilySearch id (KWCH-ABC), in this order. Omit for every person.",
      },
      factTypes: {
        type: "array",
        items: { type: "string" },
        description: "Fact types to keep, matched case-insensitively on the type's last URI segment. Omit for all.",
      },
      includeSources: {
        type: "boolean",
        description: "Return the source entries cited by the returned persons and relationships. Default false.",
      },
      sourceIds: {
        type: "array",
        items: { type: "string" },
        description: "Return these source entries (S ids), whether or not a returned person cites them.",
      },
    },
    required: ["projectPath"],
  },
};

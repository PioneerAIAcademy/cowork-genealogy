// person-read-tree — build the starting tree host-side from a FamilySearch
// person read (issues #2944, #3384).
//
// Until this existed, init-project made the model re-type the whole read into
// `project_create`'s `tree` argument: about 51 KB of output for a 15-person
// pedigree, and on a 12-person read with 104 relationships the model spent its
// entire 32,000-token output cap rewriting the tree in thinking and never made
// the call (alpha #3033). `project_create` now reads the person itself and
// builds the tree here; the read never passes through the model.
//
// The build follows the rules init-project's Step 3 gave the model: local
// `I`/`N`/`F`/`R`/`S` ids, the canonical `ark`, the response-only source fields
// dropped, one FamilySearch-tree source as `S1` with a `quality: 1` ref on every
// fact and relationship, and the person-level and relationship-level refs
// re-pointed. Step 3 never fixed that source's wording; it names the Family Tree
// and the page the read came from, not one person, since it is cited on every
// relative's facts too.
//
// A person the researcher names whom the read lacks is not added here: the
// model never sees the read, so it cannot tell whether that person is already
// in it. It is added after the create, with `tree_edit` (lead ruling,
// 2026-10-20). `normalizeHandBuilt` is the other build, for a tree with no read.

import type { SimplifiedFact, SimplifiedRelationship } from "../types/gedcomx.js";
import { treePidOfArk } from "./ark.js";
import { collectFacts, standardizePlaces } from "./gedcomx-convert.js";
// The one relationship identity. A private copy here keyed on type and
// endpoints only, so an import carrying both a Biological and a Step parent on
// one pair was refused as a repeat — the opposite of what the tree says
// everywhere else (a Step edge beside a Biological one is a second edge).
import { relationshipMatches } from "./merge-gedcomx.js";
import { TREE_PERSON_FIELDS, TREE_SOURCE_FIELDS } from "../validation/tree-shape.js";

export class TreeBuildError extends Error {}

type Obj = Record<string, any>;

/** The staged element `stagePersonRead` writes: `{ personId, gedcomx }`. */
export interface StagedPersonRead {
  /** The post-redirect subject id. */
  personId: string;
  /** The id the caller asked for (`query.personId`); differs for a merged person. */
  requestedId: string;
  gedcomx: { persons?: Obj[]; relationships?: Obj[]; sources?: Obj[]; notes?: unknown };
}

export interface IdMap {
  /** FamilySearch PID -> tree `I` id (built from a read). */
  persons: Record<string, string>;
  /** FamilySearch source id -> tree `S` id (built from a read). */
  sources: Record<string, string>;
  /** The tree id of the FamilySearch-tree source: `S1` when built from a read;
   *  in a hand-built tree, the generic one, when something was cited to it. */
  familySearchTreeSource?: string;
  /** The tree id of the researcher's-statement source, when one was created. */
  statementSource?: string;
}

/** How many hand-entered facts and relationships were cited to a
 *  FamilySearch-tree source on evidence (`TreeEvidence`). */
export interface TreeCited {
  facts: number;
  relationships: number;
}

export interface BuiltTree {
  tree: { persons: Obj[]; relationships: Obj[]; sources: Obj[] };
  idMap: IdMap;
  subjectPersonIds: string[];
  /** The place retry for the read's facts, plus any `extra` facts in the same
   *  time budget (`budgetMs`, default `PLACE_RETRY_BUDGET_MS`). Not run by the
   *  build: the caller runs it once every refusal of its own has passed, so a
   *  refused call never waits on the network. */
  fillPlaces: (extra?: SimplifiedFact[], budgetMs?: number) => Promise<FilledPlace[]>;
}

/** How long the place retry may run. `project_create` is one MCP call, and the
 *  Cowork device bridge aborts any call at 60s; whatever resolved by then is
 *  kept, and a place still unresolved keeps `place` alone. */
export const PLACE_RETRY_BUDGET_MS = 20_000;
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** `1 October 2026`, the Evidence Explained access-date form, in UTC. */
export function accessDate(now: Date): string {
  return `${now.getUTCDate()} ${MONTHS[now.getUTCMonth()]} ${now.getUTCFullYear()}`;
}

/** Mints `<prefix><n>` ids, skipping any id already taken. */
class Minter {
  private next = new Map<string, number>();
  constructor(private taken: Set<string>) {}
  mint(prefix: string): string {
    let n = this.next.get(prefix) ?? 1;
    while (this.taken.has(`${prefix}${n}`)) n++;
    this.next.set(prefix, n + 1);
    const id = `${prefix}${n}`;
    this.taken.add(id);
    return id;
  }
}

const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);

/** Every fact on a tree's persons and relationships. Safe on a tree the
 *  validator has not seen yet: an entry that is not an object is skipped. */
export function factsOf(tree: { persons?: unknown; relationships?: unknown }): Obj[] {
  return [...arr(tree.persons), ...arr(tree.relationships)].flatMap((o) => arr(o.facts));
}

export function displayName(person: Obj | undefined): string {
  const n = arr(person?.names)[0] ?? {};
  return [n.given, n.surname].filter((s) => typeof s === "string" && s !== "").join(" ") || "Unknown";
}

/** The tree's own source fields (`tree-shape.ts`), so a field added there
 *  is carried here without a second edit. */
function pickSourceFields(src: Obj): Obj {
  const out: Obj = {};
  for (const k of TREE_SOURCE_FIELDS) if (src[k] !== undefined) out[k] = src[k];
  return out;
}

/** Person keys copied straight across: the tree's person fields less the
 *  ones the build rewrites. */
const COPIED_PERSON_FIELDS = [...TREE_PERSON_FIELDS].filter(
  (k) => !["id", "ark", "names", "facts", "sources"].includes(k),
);

function withRef(refs: unknown, add: Obj): Obj[] {
  return [...arr(refs), add];
}

/** A FamilySearch PID as compared here: trimmed, upper-case. */
export const pidKey = (v: string): string => v.trim().toUpperCase();

/**
 * What the project's staged `person_read`s show FamilySearch holds (issue
 * #3384). A hand-entered fact or relationship with no source of its own is
 * cited to the FamilySearch Family Tree only when it is here; anything else is
 * the researcher's statement. Keyed by canonical PID: a merged person's
 * requested id is mapped to the id it resolved to, on both sides.
 */
export interface TreeEvidence {
  /** canonical PID -> the facts a read holds on that person. */
  persons: Map<string, Obj[]>;
  /** The reads' relationships, endpoints as canonical PIDs. */
  relationships: Obj[];
  /** pidKey(requested id) -> canonical PID, for a merged person. */
  aliases: Map<string, string>;
}

export function buildTreeEvidence(reads: StagedPersonRead[]): TreeEvidence {
  const aliases = new Map<string, string>();
  for (const r of reads) {
    if (pidKey(r.requestedId) !== pidKey(r.personId)) aliases.set(pidKey(r.requestedId), pidKey(r.personId));
  }
  const canon = (pid: string) => aliases.get(pidKey(pid)) ?? pidKey(pid);
  const persons = new Map<string, Obj[]>();
  const relationships: Obj[] = [];
  for (const r of reads) {
    for (const p of arr(r.gedcomx?.persons)) {
      if (typeof p.id !== "string") continue;
      const key = canon(p.id);
      persons.set(key, [...(persons.get(key) ?? []), ...arr(p.facts)]);
    }
    for (const rel of arr(r.gedcomx?.relationships)) {
      const out: Obj = { ...rel };
      for (const k of ["parent", "child", "person1", "person2"] as const) {
        if (typeof out[k] === "string") out[k] = canon(out[k]);
      }
      relationships.push(out);
    }
  }
  return { persons, relationships, aliases };
}

/** A PID as the evidence keys it: a merged person's requested id is its subject's. */
function canonicalPid(evidence: TreeEvidence, pid: string): string {
  return evidence.aliases.get(pidKey(pid)) ?? pidKey(pid);
}

/** The facts a staged read holds on this FamilySearch person, or undefined
 *  when no read holds them (or there is no evidence). */
function heldOnPerson(pid: string | undefined, evidence: TreeEvidence | undefined): Obj[] | undefined {
  return pid && evidence ? evidence.persons.get(canonicalPid(evidence, pid)) : undefined;
}

/** A fact field as compared: trimmed, case-folded, spaces collapsed; empty is absent. */
function norm(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim().toLowerCase().replace(/\s+/g, " ");
  return s === "" ? undefined : s;
}

/** One field of a hand-entered fact against a held one: absent matches only an
 *  absent held value; a present value matches the held value or its standard form. */
function fieldMatches(given: unknown, held: unknown, heldStandard?: unknown): boolean {
  const g = norm(given);
  if (g === undefined) return norm(held) === undefined;
  return g === norm(held) || (heldStandard !== undefined && g === norm(heldStandard));
}

/** Does `held` contain this fact: same type, date, place and value? A
 *  `standard_date` the caller supplied must be the read's own: unlike a
 *  hand-entered `standard_place`, `project_create` keeps it as given, so a
 *  value the read does not hold would be written under FamilySearch's name. */
function heldFact(fact: Obj, held: Obj[]): boolean {
  return held.some(
    (h) =>
      norm(fact.type) !== undefined &&
      norm(fact.type) === norm(h.type) &&
      fieldMatches(fact.date, h.date, h.standard_date) &&
      (norm(fact.standard_date) === undefined || norm(fact.standard_date) === norm(h.standard_date)) &&
      fieldMatches(fact.place, h.place, h.standard_place) &&
      fieldMatches(fact.value, h.value),
  );
}

/** The held relationships matching `rel`, whose endpoints are canonical PIDs.
 *  `relationshipMatches` lets an absent subtype on EITHER side match; only one
 *  direction is evidence. An untyped `rel` is a less specific statement of a
 *  typed held edge, but a typed `rel` against an untyped held one claims more
 *  than FamilySearch said, so a subtype on `rel` must be the held edge's. */
function heldRelationships(rel: Obj, evidence: TreeEvidence): Obj[] {
  return evidence.relationships.filter(
    (h) =>
      relationshipMatches(h as SimplifiedRelationship, rel as SimplifiedRelationship) &&
      (rel.subtype === undefined || rel.subtype === h.subtype),
  );
}

/** `rel` with each endpoint replaced by its canonical PID, or undefined when an
 *  endpoint names no FamilySearch person. */
function pidEndpoints(
  rel: Obj,
  pidOf: (id: unknown) => string | undefined,
  evidence: TreeEvidence,
): Obj | undefined {
  const out: Obj = { ...rel };
  let ends = 0;
  for (const k of ["parent", "child", "person1", "person2"] as const) {
    if (!(k in rel)) continue;
    const pid = pidOf(rel[k]);
    if (!pid) return undefined;
    out[k] = canonicalPid(evidence, pid);
    ends++;
  }
  return ends === 2 ? out : undefined;
}

/** Staged ids, looked up through own-key Maps: a plain object would answer
 *  `constructor` or `toString` from its prototype. */
interface StagedIndex {
  /** pidKey(PID) -> `I` id, for every staged person and the subject's aliases. */
  persons: Map<string, string>;
  /** FamilySearch source id (exact) -> `S` id. */
  sources: Map<string, string>;
}

/**
 * Build the starting tree from a FamilySearch read. Throws `TreeBuildError`
 * when the read holds no subject, or a `subjectPersonIds` entry names no one in
 * it.
 */
export async function buildFromStagedRead(args: {
  staged: StagedPersonRead;
  subjectPersonIds?: unknown;
  now: Date;
}): Promise<BuiltTree> {
  const { staged, now } = args;
  const read = staged.gedcomx ?? {};
  const minter = new Minter(new Set());
  const idMap: IdMap = { persons: {}, sources: {} };

  // Persons: the subject first, so it is I1 (init-project's convention), then
  // the response order.
  const readPersons = arr(read.persons);
  // Case-insensitive: the staged id is the caller's input, trimmed but not
  // normalized, while FamilySearch returns its canonical upper-case id.
  const wanted = staged.personId.toUpperCase();
  const subject = readPersons.find((p) => typeof p.id === "string" && p.id.toUpperCase() === wanted);
  if (!subject) {
    throw new TreeBuildError(
      `the read holds no person ${JSON.stringify(staged.personId)}, so it cannot seed a ` +
        "project for them. Check the FamilySearch ID and create the project again with it as " +
        "personId.",
    );
  }
  const subjectPid: string = subject.id;
  const ordered = [subject, ...readPersons.filter((p) => p !== subject)];
  const index: StagedIndex = { persons: new Map(), sources: new Map() };
  for (const p of ordered) {
    if (typeof p.id !== "string") continue;
    const id = minter.mint("I");
    idMap.persons[p.id] = id;
    index.persons.set(pidKey(p.id), id);
  }
  // The requested id of a merged subject names the same person.
  for (const alias of [staged.personId, staged.requestedId]) {
    if (alias && !index.persons.has(pidKey(alias))) {
      idMap.persons[alias] = idMap.persons[subjectPid];
      index.persons.set(pidKey(alias), idMap.persons[subjectPid]);
    }
  }

  // Sources: the FamilySearch-tree source is S1; the read's own follow.
  const fsTree = minter.mint("S");
  idMap.familySearchTreeSource = fsTree;
  const subjectName = displayName(subject);
  const sources: Obj[] = [
    {
      id: fsTree,
      // Cited on every person's facts, so it names no one person as the
      // subject of a fact: the Tree, and the page the read was made from.
      title: `FamilySearch Family Tree (read from ${subjectName}, ${subjectPid})`,
      citation:
        `FamilySearch Family Tree (https://www.familysearch.org/tree : ` +
        `accessed ${accessDate(now)}), read from the page of ${subjectName} (${subjectPid}).`,
      url: "https://www.familysearch.org/tree",
    },
  ];
  for (const s of arr(read.sources)) {
    if (typeof s.id !== "string") continue;
    const id = minter.mint("S");
    idMap.sources[s.id] = id;
    index.sources.set(s.id, id);
    sources.push({ ...pickSourceFields(s), id });
  }
  const fsRef = { ref: fsTree, quality: 1 };
  const remapRefs = (refs: unknown): Obj[] =>
    arr(refs)
      .filter((r) => typeof r.ref === "string" && index.sources.has(r.ref))
      .map((r) => ({ ...r, ref: index.sources.get(r.ref) }));

  const buildFact = (f: Obj): Obj => {
    const { id: _id, sources: refs, ...rest } = f;
    return { id: minter.mint("F"), ...rest, sources: withRef(remapRefs(refs), fsRef) };
  };

  const persons: Obj[] = ordered
    .filter((p) => typeof p.id === "string")
    .map((p) => {
      const out: Obj = { id: idMap.persons[p.id] };
      out.ark = typeof p.ark === "string" && p.ark ? p.ark : `ark:/61903/4:1:${p.id}`;
      for (const k of COPIED_PERSON_FIELDS) if (p[k] !== undefined) out[k] = p[k];
      out.names = arr(p.names).map((n) => {
        const { id: _id, ...rest } = n;
        return { id: minter.mint("N"), ...rest };
      });
      const facts = arr(p.facts).map(buildFact);
      if (facts.length) out.facts = facts;
      const refs = remapRefs(p.sources);
      if (refs.length) out.sources = refs;
      return out;
    });

  const relationships: Obj[] = arr(read.relationships).map((r) => {
    const { id: _id, facts, sources: refs, ...rest } = r;
    const out: Obj = { id: minter.mint("R"), ...rest };
    for (const key of ["parent", "child", "person1", "person2"] as const) {
      if (typeof out[key] === "string" && index.persons.has(pidKey(out[key]))) {
        out[key] = index.persons.get(pidKey(out[key]));
      }
    }
    const builtFacts = arr(facts).map(buildFact);
    if (builtFacts.length) out.facts = builtFacts;
    out.sources = withRef(remapRefs(refs), fsRef);
    return out;
  });

  const tree = { persons, relationships, sources };
  const subjectId = idMap.persons[subjectPid];
  // The read's facts, for the place retry. It runs LAST, in the caller, so
  // every refusal below is instant.
  const readFacts = collectFacts(tree as never) as SimplifiedFact[];

  // subjectPersonIds: FamilySearch PIDs from the read; defaults to the subject.
  let subjectPersonIds: string[];
  if (args.subjectPersonIds === undefined) {
    subjectPersonIds = [subjectId];
  } else {
    if (!Array.isArray(args.subjectPersonIds)) {
      throw new TreeBuildError("subjectPersonIds must be an array of ids");
    }
    subjectPersonIds = args.subjectPersonIds.map((v) => {
      const mapped = typeof v === "string" ? index.persons.get(pidKey(v)) : undefined;
      if (!mapped) {
        throw new TreeBuildError(
          `subjectPersonIds entry ${JSON.stringify(v)} is not a FamilySearch ID in the read. ` +
            "With personId, name a person from the read by their FamilySearch ID (e.g. " +
            "\"LZNY-BRF\"); the tree's `I` ids are assigned here.",
        );
      }
      return mapped;
    });
  }

  return {
    tree,
    idMap,
    subjectPersonIds,
    fillPlaces: (extra = [], budgetMs) => retryUnresolvedPlaces([...readFacts, ...extra], budgetMs),
  };
}

/** A place the retry resolved: the fact's raw `place` and what it now carries. */
export interface FilledPlace {
  place: string;
  standardPlace: string;
}

/**
 * Places the read could not standardize (a transient failure, or past the
 * converter's soft cap on a large pedigree): one more try, through the same
 * resolver. A no-op, with no network traffic, when every fact already has one.
 *
 * On the read path, only the READ's facts; on the hand-built path
 * `project_create` passes every fact, having cleared each `standard_place`
 * first. And on copies: `standardizePlaces` mutates in place and keeps
 * running past the budget, so a late answer must not land on a tree that has
 * already been validated and written (it would reach one of the two files and
 * not the other).
 */
export async function retryUnresolvedPlaces(
  facts: SimplifiedFact[],
  budgetMs: number = PLACE_RETRY_BUDGET_MS,
): Promise<FilledPlace[]> {
  const copies = facts.map((f) => ({ ...f }));
  await Promise.race([
    standardizePlaces(copies),
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, Math.max(0, budgetMs));
      t.unref?.();
    }),
  ]);
  const filled = new Map<string, FilledPlace>();
  facts.forEach((f, i) => {
    const value = copies[i].standard_place;
    if (!f.standard_place && value) {
      f.standard_place = value;
      if (typeof f.place === "string") {
        // Keyed as `standardizePlaces` groups places (trimmed, case-folded,
        // spaces collapsed): one resolution is reported once, in the spelling
        // first met, however else the raw text was written.
        const key = `${f.place.trim().toLowerCase().replace(/\s+/g, " ")}\u0000${value}`;
        if (!filled.has(key)) filled.set(key, { place: f.place, standardPlace: value });
      }
    }
  });
  return [...filled.values()];
}

/** A `{ref, quality: 1}` to one "Researcher's statement" source, created the
 *  first time something hand-built has no source of its own. */
function lazyStatementSource(
  tree: BuiltTree["tree"],
  minter: Minter,
  idMap: IdMap,
  now: Date,
): () => Obj {
  return () => {
    if (!idMap.statementSource) {
      idMap.statementSource = minter.mint("S");
      tree.sources.push({
        id: idMap.statementSource,
        title: "Researcher's statement",
        citation: `Statement by the researcher when the project was created, ${accessDate(now)}.`,
      });
    }
    return { ref: idMap.statementSource, quality: 1 };
  };
}

/** A `{ref, quality: 1}` to one generic FamilySearch Family Tree source,
 *  created the first time a hand-entered fact or relationship is found in a
 *  staged read. It names no one page: the person's own `ark` is the page. */
function lazyTreeSource(
  tree: BuiltTree["tree"],
  minter: Minter,
  idMap: IdMap,
  now: Date,
): () => Obj {
  return () => {
    if (!idMap.familySearchTreeSource) {
      idMap.familySearchTreeSource = minter.mint("S");
      tree.sources.push({
        id: idMap.familySearchTreeSource,
        title: "FamilySearch Family Tree",
        citation: `FamilySearch Family Tree (https://www.familysearch.org/tree : accessed ${accessDate(now)}).`,
        url: "https://www.familysearch.org/tree",
      });
    }
    return { ref: idMap.familySearchTreeSource, quality: 1 };
  };
}

/**
 * No-ref mode (the objective-only build): the model's own ids are KEPT, since it
 * names `subjectPersonIds` and later `relates_to_person_ids` by them. Only a
 * missing id is minted, skipping every id the model used, and every fact or
 * relationship with no `sources` is cited to one researcher's-statement source
 * — unless `evidence` shows a staged read holds it, on a person whose `ark`
 * names that read's FamilySearch person, when it is cited to the Family Tree.
 * Mutates and returns the tree.
 */
export function normalizeHandBuilt(
  tree: { persons: unknown[]; relationships: unknown[]; sources: unknown[] },
  now: Date,
  subjectPersonIds?: unknown,
  evidence?: TreeEvidence,
): { tree: BuiltTree["tree"]; idMap: IdMap; treeCited: TreeCited } {
  // The caller's arrays are kept whole: an entry that is not an object stays in
  // place for the validator to refuse at its own index, rather than vanishing.
  const persons = arr(tree.persons);
  const relationships = arr(tree.relationships);
  const sources = arr(tree.sources);
  const taken = new Set<string>();
  const note = (v: unknown) => typeof v === "string" && taken.add(v);
  // Ids the caller REFERENCES are reserved too, not only those it defines: a
  // minted id equal to a dangling ref would make that ref silently valid,
  // binding it to whatever got the id. Left dangling, the validator refuses it.
  if (Array.isArray(subjectPersonIds)) for (const v of subjectPersonIds) note(v);
  const noteRefs = (o: Obj) => {
    for (const r of Array.isArray(o.sources) ? o.sources : []) if (isObj(r)) note(r.ref);
  };
  for (const r of relationships) {
    for (const k of ["parent", "child", "person1", "person2"]) note(r[k]);
    noteRefs(r);
    for (const f of arr(r.facts)) noteRefs(f);
  }
  for (const p of persons) {
    noteRefs(p);
    for (const n of arr(p.names)) noteRefs(n);
    for (const f of arr(p.facts)) noteRefs(f);
  }
  for (const s of sources) note(s.id);
  for (const p of persons) {
    note(p.id);
    for (const n of arr(p.names)) note(n.id);
    for (const f of arr(p.facts)) note(f.id);
  }
  for (const r of relationships) {
    note(r.id);
    for (const f of arr(r.facts)) note(f.id);
  }
  const minter = new Minter(taken);
  const idMap: IdMap = { persons: {}, sources: {} };
  const built = {
    persons: tree.persons as Obj[],
    relationships: tree.relationships as Obj[],
    sources: tree.sources as Obj[],
  };
  const statement = lazyStatementSource(built, minter, idMap, now);
  const treeSource = lazyTreeSource(built, minter, idMap, now);
  const treeCited: TreeCited = { facts: 0, relationships: 0 };
  // Only an absent id is minted. Any other value is the caller's, kept for the
  // validator to judge, as relationships and subjectPersonIds name it as given.
  const ensure = (o: Obj, prefix: string) => {
    if (o.id === undefined) o.id = minter.mint(prefix);
  };
  for (const s of sources) ensure(s, "S");
  // Only an absent or empty `sources` is unsourced. Any other value is the
  // caller's citation in the wrong shape, left for the validator to refuse:
  // replacing it would lose the source it names.
  const unsourced = (o: Obj) =>
    o.sources === undefined || (Array.isArray(o.sources) && o.sources.length === 0);
  const ensureSourced = (o: Obj, inTree: boolean, counter: keyof TreeCited) => {
    if (!unsourced(o)) return;
    if (inTree) {
      treeCited[counter]++;
      o.sources = [treeSource()];
    } else o.sources = [statement()];
  };
  const pidOfPerson = new Map<string, string>();
  for (const p of persons) {
    ensure(p, "I");
    const pid = treePidOfArk(p.ark);
    if (pid && typeof p.id === "string") pidOfPerson.set(p.id, pid);
    const held = heldOnPerson(pid, evidence);
    for (const n of arr(p.names)) ensure(n, "N");
    for (const f of arr(p.facts)) {
      ensure(f, "F");
      ensureSourced(f, !!held && heldFact(f, held), "facts");
    }
  }
  const pidOf = (id: unknown) => (typeof id === "string" ? pidOfPerson.get(id) : undefined);
  for (const r of relationships) {
    ensure(r, "R");
    const asPids = evidence && pidEndpoints(r, pidOf, evidence);
    const held = asPids ? heldRelationships(asPids, evidence!) : [];
    const heldFacts = held.flatMap((h) => arr(h.facts));
    for (const f of arr(r.facts)) {
      ensure(f, "F");
      ensureSourced(f, held.length > 0 && heldFact(f, heldFacts), "facts");
    }
    ensureSourced(r, held.length > 0, "relationships");
  }
  return { tree: built, idMap, treeCited };
}

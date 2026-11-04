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
// 2026-10-20). There is no other build: a project always starts from a read.

import type { SimplifiedFact } from "../types/gedcomx.js";
import { collectFacts, standardizePlaces } from "./gedcomx-convert.js";
import { isNonPlacePhrase } from "./place-resolver.js";
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
  /** The tree id of the FamilySearch-tree source: `S1`. */
  familySearchTreeSource?: string;
}

export interface BuiltTree {
  tree: { persons: Obj[]; relationships: Obj[]; sources: Obj[] };
  idMap: IdMap;
  subjectPersonIds: string[];
  /** The place retry for the read's facts, in `budgetMs` (default
   *  `PLACE_RETRY_BUDGET_MS`). Not run by the build: the caller runs it once
   *  every refusal of its own has passed, so a refused call never waits on the
   *  network. */
  fillPlaces: (budgetMs?: number) => Promise<FilledPlace[]>;
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
    fillPlaces: (budgetMs) => retryUnresolvedPlaces(readFacts, budgetMs),
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
 * Only the READ's facts. And on copies: `standardizePlaces` mutates in place and keeps
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
        const key = `${placeKey(f.place)}\u0000${value}`;
        if (!filled.has(key)) filled.set(key, { place: f.place, standardPlace: value });
      }
    }
  });
  return [...filled.values()];
}

/** A place as `standardizePlaces` groups it: trimmed, case-folded, spaces collapsed. */
const placeKey = (place: string) => place.trim().toLowerCase().replace(/\s+/g, " ");

/** The places among `facts` still without a `standard_place`, each once, in the
 *  spelling first met, keyed as `retryUnresolvedPlaces` keys a fill. A non-place
 *  phrase ("Same House") has no standard form to miss and is left out. */
export function unresolvedPlacesOf(facts: readonly Obj[]): string[] {
  const out = new Map<string, string>();
  for (const f of facts) {
    if (typeof f.place !== "string" || f.place.trim() === "" || f.standard_place || isNonPlacePhrase(f.place)) continue;
    if (!out.has(placeKey(f.place))) out.set(placeKey(f.place), f.place);
  }
  return [...out.values()];
}

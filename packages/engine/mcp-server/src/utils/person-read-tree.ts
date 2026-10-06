// person-read-tree — build the starting tree host-side from a staged
// `person_read` (issue #2944 Stage B).
//
// Until this existed, init-project made the model re-type the whole read into
// `project_create`'s `tree` argument: about 51 KB of output for a 15-person
// pedigree, and on a 12-person read with 104 relationships the model spent its
// entire 32,000-token output cap rewriting the tree in thinking and never made
// the call (alpha #3033). The read is already on the host, so the host builds
// the tree from it and the model passes a reference.
//
// The build follows the rules init-project's Step 3 gave the model: local
// `I`/`N`/`F`/`R`/`S` ids, the canonical `ark`, the response-only source fields
// dropped, one FamilySearch-tree source as `S1` with a `quality: 1` ref on every
// fact and relationship, and the person-level refs re-pointed. Step 3 never fixed
// that source's wording; it names the Family Tree and the page the read came
// from, not one person, since it is cited on every relative's facts too.
//
// Stubs the researcher's own statements imply (a maiden name's parent) arrive as
// ADDITIONS. The model cannot see the ids minted here, so in ref mode every id
// it writes is a label: re-minted after the staged ids, and a staged person is
// named by FamilySearch PID. An `I<n>` the model wrote would otherwise land on
// whichever staged person got that id, and no validator could tell.

import type { SimplifiedFact } from "../types/gedcomx.js";
import { collectFacts, standardizePlaces } from "./gedcomx-convert.js";
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
  /** FamilySearch PID -> tree `I` id (ref mode). */
  persons: Record<string, string>;
  /** FamilySearch source id -> tree `S` id (ref mode). */
  sources: Record<string, string>;
  /** Addition person label -> minted `I` id (ref mode), so a later step can
   *  name a stub (e.g. `known_holdings.relates_to_person_ids`). */
  additions: Record<string, string>;
  /** The tree id of the FamilySearch-tree source (ref mode). */
  familySearchTreeSource?: string;
  /** The tree id of the researcher's-statement source, when one was created. */
  statementSource?: string;
}

export interface BuiltTree {
  tree: { persons: Obj[]; relationships: Obj[]; sources: Obj[] };
  idMap: IdMap;
  subjectPersonIds: string[];
  /** The place retry for the read's facts. Not run by the build: the caller
   *  runs it once every refusal of its own has passed, so a refused call never
   *  waits on the network. */
  fillPlaces: () => Promise<FilledPlace[]>;
}

/** How long the place retry may run. `project_create` is one MCP call, and the
 *  Cowork device bridge aborts any call at 60s; whatever resolved by then is
 *  kept, and a place still unresolved keeps `place` alone. */
const PLACE_RETRY_BUDGET_MS = 20_000;
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

/** An addition collection: absent is empty, anything but an array of objects
 *  is refused. `arr` drops a bad entry, which for a citation would silently
 *  re-cite the fact to the researcher's statement. */
function list(v: unknown, where: string): Obj[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || !v.every(isObj)) {
    throw new TreeBuildError(
      `${where} must be an array of objects` +
        (where.endsWith("sources") ? ' such as [{"ref": "<source id>"}]' : "") +
        `; got ${JSON.stringify(v)}.`,
    );
  }
  return v;
}

/** The FamilySearch tree PID an addition's `ark` names: a tree-person ark
 *  (4:1:) in any spelling, or a tree person URL. A record or image ark names
 *  no tree person. */
function treePidOfArk(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  // Each %XX on its own, so one stray `%` does not switch decoding off.
  const text = value
    .trim()
    .replace(/%([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  // A FamilySearch tree person URL names the PID in a path segment after
  // /tree/person/ (details, sources, memories, a language prefix before it).
  // Read first, so a query string cannot override the path.
  const url = text.match(
    /^https?:\/\/(?:www\.)?familysearch\.org(?::\d+)?\/(?:[a-z]{2}(?:-[a-z]{2,4})?\/)?tree\/(?:person|pedigree)\/([^?#]*)/i,
  );
  if (url) {
    for (const seg of url[1].split("/")) {
      const pid = seg.match(/^([A-Za-z0-9]{4}-[A-Za-z0-9]{3,4})(?![A-Za-z0-9-])/);
      if (pid) return pid[1];
    }
    return undefined;
  }
  // Otherwise an ark: `ark:/61903/4:1:<PID>` in the path of a resolver URL, or
  // a bare `4:1:<PID>`. Never from a query string: a record URL can carry a
  // tree ark there without naming that person.
  const path = text.replace(/[?#].*$/, "");
  return path.match(/(?:ark:\/61903\/|^)4:1:([A-Za-z0-9]{4}-[A-Za-z0-9]{3,4})(?![A-Za-z0-9])/i)?.[1];
}

function displayName(person: Obj | undefined): string {
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
const pidKey = (v: string): string => v.trim().toUpperCase();

/** Staged ids, looked up through own-key Maps: a plain object would answer
 *  `constructor` or `toString` from its prototype. */
interface StagedIndex {
  /** pidKey(PID) -> `I` id, for every staged person and the subject's aliases. */
  persons: Map<string, string>;
  /** FamilySearch source id (exact) -> `S` id. */
  sources: Map<string, string>;
}

/** A relationship's identity: its type and endpoints (a Couple unordered). */
function relationshipKey(r: Obj): string {
  if (r.type === "Couple") return `Couple|${[r.person1, r.person2].map(String).sort().join("|")}`;
  return `${String(r.type)}|${String(r.parent)}|${String(r.child)}`;
}

/**
 * Build the tree from a staged read, then merge `additions`. Throws
 * `TreeBuildError` for an addition that names neither a staged person (by PID)
 * nor one of its own labels.
 */
export async function buildFromStagedRead(args: {
  staged: StagedPersonRead;
  additions?: { persons?: unknown[]; relationships?: unknown[]; sources?: unknown[] };
  subjectPersonIds?: unknown;
  now: Date;
}): Promise<BuiltTree> {
  const { staged, now } = args;
  const read = staged.gedcomx ?? {};
  const minter = new Minter(new Set());
  const idMap: IdMap = { persons: {}, sources: {}, additions: {} };

  // Persons: the subject first, so it is I1 (init-project's convention), then
  // the response order.
  const readPersons = arr(read.persons);
  // Case-insensitive: the staged id is the caller's input, trimmed but not
  // normalized, while FamilySearch returns its canonical upper-case id.
  const wanted = staged.personId.toUpperCase();
  const subject = readPersons.find((p) => typeof p.id === "string" && p.id.toUpperCase() === wanted);
  if (!subject) {
    throw new TreeBuildError(
      `the staged read holds no person ${JSON.stringify(staged.personId)}, so it cannot seed a ` +
        "project for them. Call person_read again with that FamilySearch ID and projectPath, and " +
        "pass the new staged.resultsRef as personReadRef.",
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
  // The read's facts, captured before additions join: the retry covers only
  // these, and runs LAST so every refusal below is instant.
  const readFacts = collectFacts(tree as never) as SimplifiedFact[];
  const labels = mergeAdditions(tree, args.additions, minter, idMap, index, now);

  // subjectPersonIds: a staged PID or an addition label; defaults to the subject.
  let subjectPersonIds: string[];
  if (args.subjectPersonIds === undefined) {
    subjectPersonIds = [subjectId];
  } else {
    if (!Array.isArray(args.subjectPersonIds)) {
      throw new TreeBuildError("subjectPersonIds must be an array of ids");
    }
    subjectPersonIds = args.subjectPersonIds.map((v) => {
      const mapped =
        typeof v === "string" ? index.persons.get(pidKey(v)) ?? labels.get(v) : undefined;
      if (!mapped) {
        throw new TreeBuildError(
          `subjectPersonIds entry ${JSON.stringify(v)} is neither a FamilySearch ID in the staged ` +
            "read nor a person in `tree`. With personReadRef, name a staged person by its " +
            "FamilySearch ID (e.g. \"LZNY-BRF\"); the tree's `I` ids are assigned here.",
        );
      }
      return mapped;
    });
  }

  return { tree, idMap, subjectPersonIds, fillPlaces: () => retryUnresolvedPlaces(readFacts) };
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
 * Only the READ's facts: a stub's place is the caller's, resolved with
 * place_search. And on copies: `standardizePlaces` mutates in place and keeps
 * running past the budget, so a late answer must not land on a tree that has
 * already been validated and written (it would reach one of the two files and
 * not the other).
 */
async function retryUnresolvedPlaces(facts: SimplifiedFact[]): Promise<FilledPlace[]> {
  const copies = facts.map((f) => ({ ...f }));
  await Promise.race([
    standardizePlaces(copies),
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, PLACE_RETRY_BUDGET_MS);
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

/**
 * Merge additions into a staged-built tree. Every id in an addition is a label
 * and is re-minted; person labels -> ids go in `idMap.additions`. Endpoints and
 * refs must name a staged PID / FamilySearch source id or an addition label.
 * Person and source labels follow one rule set: unique, and never a staged id.
 * Returns the person label map.
 */
function mergeAdditions(
  tree: BuiltTree["tree"],
  additions: { persons?: unknown[]; relationships?: unknown[]; sources?: unknown[] } | undefined,
  minter: Minter,
  idMap: IdMap,
  index: StagedIndex,
  now: Date,
): Map<string, string> {
  const personLabel = new Map<string, string>();
  if (!additions) return personLabel;
  const persons = list(additions.persons, "tree.persons");
  const relationships = list(additions.relationships, "tree.relationships");
  const sources = list(additions.sources, "tree.sources");

  const mintedFor = new Map<Obj, string>();
  const additionArks = new Map<string, string>();
  for (const p of persons) {
    const label = typeof p.id === "string" ? p.id : undefined;
    // An ark naming a person already in the read means that person was copied
    // in as an addition, which would put them in the tree twice; no validator
    // rejects two persons with one ark. An ark for someone the read does NOT
    // hold (a second person_read) is legitimate and kept.
    const arkPid = treePidOfArk(p.ark);
    if (arkPid && additionArks.has(pidKey(arkPid))) {
      throw new TreeBuildError(
        `tree persons ${JSON.stringify(additionArks.get(pidKey(arkPid)))} and ` +
          `${JSON.stringify(label ?? "(unlabelled)")} carry the ark of the same person, ${arkPid}; ` +
          "add each person once.",
      );
    }
    if (arkPid) additionArks.set(pidKey(arkPid), label ?? "(unlabelled)");
    if (arkPid && index.persons.has(pidKey(arkPid))) {
      throw new TreeBuildError(
        `tree person ${JSON.stringify(label ?? "(unlabelled)")} carries the ark of ${arkPid.trim()}, ` +
          "who is already in the staged read, so this would add them twice. With personReadRef " +
          "`tree` holds only people the read does not contain.",
      );
    }
    if (label !== undefined) {
      if (personLabel.has(label)) {
        throw new TreeBuildError(
          `tree person label ${JSON.stringify(label)} is used twice; give each addition its own label.`,
        );
      }
      if (index.persons.has(pidKey(label))) {
        throw new TreeBuildError(
          `tree person ${JSON.stringify(label)} is a FamilySearch ID already in the staged read. ` +
            "Additions are new people only; link to a staged person by naming its FamilySearch ID " +
            "in a relationship.",
        );
      }
    }
    const id = minter.mint("I");
    if (label !== undefined) personLabel.set(label, id);
    mintedFor.set(p, id);
  }
  idMap.additions = Object.fromEntries(personLabel);

  const sourceLabel = new Map<string, string>();
  for (const s of sources) {
    const label = typeof s.id === "string" ? s.id : undefined;
    if (label !== undefined) {
      if (sourceLabel.has(label)) {
        throw new TreeBuildError(
          `tree source label ${JSON.stringify(label)} is used twice; give each addition source its own label.`,
        );
      }
      if (index.sources.has(label)) {
        throw new TreeBuildError(
          `tree source ${JSON.stringify(label)} is a FamilySearch source already in the staged read; ` +
            "cite it by that id instead of adding it again.",
        );
      }
    }
    const id = minter.mint("S");
    if (label !== undefined) sourceLabel.set(label, id);
    // Kept as given, not picked: an unknown field is the caller's mistake and
    // the validator refuses it, rather than this build quietly dropping it.
    const { id: _sid, ...given } = s;
    tree.sources.push({ id, ...given });
  }

  const endpoint = (value: unknown, where: string): string => {
    if (typeof value === "string") {
      const mapped = index.persons.get(pidKey(value)) ?? personLabel.get(value);
      if (mapped) return mapped;
    }
    throw new TreeBuildError(
      `${where} names ${JSON.stringify(value)}, which is neither a FamilySearch ID in the staged ` +
        "read nor a person in `tree`. With personReadRef, name a staged person by its FamilySearch " +
        "ID (e.g. \"LZNY-BRF\"): the tree's `I` ids are assigned here, so an `I` id you write would " +
        "land on whichever staged person received it.",
    );
  };
  const refs = (value: unknown, where: string): Obj[] =>
    list(value, `${where} sources`).map((r) => {
      const mapped =
        typeof r.ref === "string" ? sourceLabel.get(r.ref) ?? index.sources.get(r.ref) : undefined;
      if (!mapped) {
        throw new TreeBuildError(
          `${where} cites source ${JSON.stringify(r.ref)}, which is neither a source in \`tree\` ` +
            "nor a FamilySearch source in the staged read.",
        );
      }
      return { ...r, ref: mapped };
    });

  const statement = lazyStatementSource(tree, minter, idMap, now);
  const fact = (f: Obj, where: string): Obj => {
    const { id: _id, sources: rs, ...rest } = f;
    const sourced = refs(rs, where);
    return { id: minter.mint("F"), ...rest, sources: sourced.length ? sourced : [statement()] };
  };

  for (const p of persons) {
    const id = mintedFor.get(p)!;
    const label = typeof p.id === "string" ? p.id : `(person ${id})`;
    const { id: _id, names, facts, sources: rs, ...rest } = p;
    const out: Obj = { id, ...rest };
    out.names = list(names, `tree person ${label}'s names`).map((n) => {
      const { id: _nid, sources: ns, ...nrest } = n;
      const nameRefs = refs(ns, `tree person ${label}'s name`);
      return { id: minter.mint("N"), ...nrest, ...(nameRefs.length ? { sources: nameRefs } : {}) };
    });
    const builtFacts = list(facts, `tree person ${label}'s facts`).map((f) => fact(f, `tree person ${label}'s fact`));
    if (builtFacts.length) out.facts = builtFacts;
    const personRefs = refs(rs, `tree person ${label}`);
    if (personRefs.length) out.sources = personRefs;
    tree.persons.push(out);
  }
  const existing = new Set(tree.relationships.map(relationshipKey));
  for (const r of relationships) {
    const where = `tree relationship ${typeof r.id === "string" ? r.id : ""}`.trim();
    const { id: _id, facts, sources: rs, ...rest } = r;
    const out: Obj = { id: minter.mint("R"), ...rest };
    for (const key of ["parent", "child", "person1", "person2"] as const) {
      if (key in out) out[key] = endpoint(out[key], `${where} ${key}`);
    }
    const key = relationshipKey(out);
    if (existing.has(key)) {
      throw new TreeBuildError(
        `${where} repeats a relationship already in the tree (${key.replace(/\|/g, " ")}); ` +
          "the read's relationships are imported already.",
      );
    }
    existing.add(key);
    const builtFacts = list(facts, `${where} facts`).map((f) => fact(f, `${where} fact`));
    if (builtFacts.length) out.facts = builtFacts;
    const relRefs = refs(rs, where);
    out.sources = relRefs.length ? relRefs : [statement()];
    tree.relationships.push(out);
  }
  return personLabel;
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

/**
 * No-ref mode (the objective-only build): the model's own ids are KEPT, since it
 * names `subjectPersonIds` and later `relates_to_person_ids` by them. Only a
 * missing id is minted, skipping every id the model used, and every fact or
 * relationship with no `sources` is cited to one researcher's-statement source.
 * Mutates and returns the tree.
 */
export function normalizeHandBuilt(
  tree: { persons: unknown[]; relationships: unknown[]; sources: unknown[] },
  now: Date,
  subjectPersonIds?: unknown,
): { tree: BuiltTree["tree"]; idMap: IdMap } {
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
  const idMap: IdMap = { persons: {}, sources: {}, additions: {} };
  const built = {
    persons: tree.persons as Obj[],
    relationships: tree.relationships as Obj[],
    sources: tree.sources as Obj[],
  };
  const statement = lazyStatementSource(built, minter, idMap, now);
  // Only an absent id is minted. Any other value is the caller's, kept for the
  // validator to judge, as relationships and subjectPersonIds name it as given.
  const ensure = (o: Obj, prefix: string) => {
    if (o.id === undefined) o.id = minter.mint(prefix);
  };
  for (const s of sources) ensure(s, "S");
  // Only an absent or empty `sources` is unsourced. Any other value is the
  // caller's citation in the wrong shape, left for the validator to refuse:
  // replacing it would lose the source it names.
  const ensureSourced = (o: Obj) => {
    if (o.sources === undefined || (Array.isArray(o.sources) && o.sources.length === 0)) {
      o.sources = [statement()];
    }
  };
  for (const p of persons) {
    ensure(p, "I");
    for (const n of arr(p.names)) ensure(n, "N");
    for (const f of arr(p.facts)) {
      ensure(f, "F");
      ensureSourced(f);
    }
  }
  for (const r of relationships) {
    ensure(r, "R");
    for (const f of arr(r.facts)) {
      ensure(f, "F");
      ensureSourced(f);
    }
    ensureSourced(r);
  }
  return { tree: built, idMap };
}

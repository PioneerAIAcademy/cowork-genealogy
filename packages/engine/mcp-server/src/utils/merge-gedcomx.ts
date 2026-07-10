// merge-gedcomx — deterministically merge SimplifiedGedcomX documents.
//
// Issue #250 / spec `docs/specs/merge-gedcomx-spec.md` (rev. 3). The function
// does NOT decide which people are the same — the caller supplies a list of
// `[survivorId, collapsedId]` pairs. For each pair the survivor id is kept and
// the collapsed person is folded into it.
//
//   Mode 1 (cross-document): mergeGedcomx(target, candidate, merges)
//     each pair = [targetId, candidateId]; candidate folds into target,
//     unpaired candidate persons are carried in as new relatives.
//   Mode 2 (same-document):  mergeGedcomx(target, null, merges)
//     each pair = [targetIdA, targetIdB]; B folds into A within the target.
//
// Pure: inputs are never mutated; a fresh document is returned. This is the
// pure core only — the two MCP tools that own filesystem I/O, the research.json
// remap, validation, and persistence are merge_record_into_tree (Mode 1) and
// merge_tree_persons (Mode 2) in src/tools/ (spec §5b).

import type {
  SimplifiedFact,
  SimplifiedGedcomX,
  SimplifiedName,
  SimplifiedPerson,
  SimplifiedRelationship,
  SimplifiedSourceDescription,
  SimplifiedSourceReference,
} from "../types/gedcomx.js";
import { getDayRange } from "./date-helpers.js";
import { getStandardDate } from "./fact-helpers.js";
import { maxIdNum } from "./gedcomx-ids.js";

/**
 * Merge `candidate` into `target` (or persons within `target` when
 * `candidate` is null), collapsing each `[survivorId, collapsedId]` pair.
 *
 * @throws on empty/duplicate/chained merges, or unknown ids (see spec §8).
 */
export function mergeGedcomx(
  target: SimplifiedGedcomX,
  candidate: SimplifiedGedcomX | null,
  merges: Array<[string, string]>,
): SimplifiedGedcomX {
  validateMerges(target, candidate, merges);

  if (candidate === null) {
    return mergeSameDocument(target, merges);
  }
  return mergeCrossDocument(target, candidate, merges);
}

// ─── Mode 1: cross-document merge ───────────────────────────────────────────

/** Per-prefix id counters, seeded from the target's current maxima. */
interface IdCounters {
  I: number;
  N: number;
  F: number;
  R: number;
  S: number;
}

function mergeCrossDocument(
  target: SimplifiedGedcomX,
  candidate: SimplifiedGedcomX,
  merges: Array<[string, string]>,
): SimplifiedGedcomX {
  const result = structuredClone(target);
  result.persons ??= [];
  const counters: IdCounters = {
    I: maxIdNum(result, "I"),
    N: maxIdNum(result, "N"),
    F: maxIdNum(result, "F"),
    R: maxIdNum(result, "R"),
    S: maxIdNum(result, "S"),
  };

  // candidate person id → survivor id (collapsed) or fresh I id (carried).
  const collapseMap = new Map<string, string>();
  for (const [s, c] of merges) collapseMap.set(c, s);
  const personIdMap = new Map<string, string>();
  for (const p of candidate.persons ?? []) {
    if (p.id === undefined) continue;
    personIdMap.set(p.id, collapseMap.get(p.id) ?? `I${++counters.I}`);
  }

  // candidate source id → deduped target id (by title) or fresh S id.
  const sourceIdMap = buildSourceIdMap(result, candidate.sources ?? [], counters);

  for (const person of candidate.persons ?? []) {
    if (person.id === undefined) continue;
    const content = remapPersonContent(person, counters, sourceIdMap);
    const survivorId = collapseMap.get(person.id);
    if (survivorId !== undefined) {
      const surv = result.persons.find((p) => p.id === survivorId)!;
      if (!surv.ark && content.ark) surv.ark = content.ark;
      if (!surv.gender && content.gender) surv.gender = content.gender;
      if (content.names.length) (surv.names ??= []).push(...content.names);
      if (content.facts.length) (surv.facts ??= []).push(...content.facts);
    } else {
      const carried: SimplifiedPerson = { id: personIdMap.get(person.id) };
      if (content.ark !== undefined) carried.ark = content.ark;
      if (content.gender !== undefined) carried.gender = content.gender;
      if (content.names.length) carried.names = content.names;
      if (content.facts.length) carried.facts = content.facts;
      result.persons.push(carried);
    }
  }

  // Equivalence-merge names and facts on each survivor (spec §7.1, §7.2).
  for (const survivorId of new Set(merges.map(([s]) => s))) {
    const surv = result.persons.find((p) => p.id === survivorId);
    if (surv?.names) surv.names = mergeNames(surv.names);
    if (surv?.facts) surv.facts = mergeFacts(surv.facts);
  }

  const remappedRels = (candidate.relationships ?? []).map((rel) =>
    remapRelationship(rel, personIdMap, sourceIdMap, counters),
  );
  const combinedRels = [...(result.relationships ?? []), ...remappedRels];
  if (combinedRels.length > 0) {
    result.relationships = dedupRelationships(combinedRels);
  }

  // Candidate `places[]` are NOT carried: the persisted tree format has no
  // top-level places section (facts carry place names), so carrying them
  // would persist a document the tree schema rejects. The tool layer strips
  // them with a warning before the merge (sanitizeCandidate).

  ensureUniqueFactAndNameIds(result);
  return result;
}

// ─── Mode 2: same-document merge ────────────────────────────────────────────

/**
 * Merge persons within a single document. Each `[survivorId, collapsedId]` pair
 * folds the collapsed person into the survivor, removes the collapsed person,
 * and repoints every relationship endpoint. No id remap is needed — the ids
 * already live in one namespace.
 */
function mergeSameDocument(
  target: SimplifiedGedcomX,
  merges: Array<[string, string]>,
): SimplifiedGedcomX {
  const result = structuredClone(target);
  result.persons ??= [];

  const collapseMap = new Map<string, string>();
  for (const [s, c] of merges) collapseMap.set(c, s);

  for (const [survivorId, collapsedId] of merges) {
    const surv = result.persons.find((p) => p.id === survivorId)!;
    const coll = result.persons.find((p) => p.id === collapsedId)!;
    if (!surv.ark && coll.ark) surv.ark = coll.ark;
    if (!surv.gender && coll.gender) surv.gender = coll.gender;
    if (coll.names?.length) (surv.names ??= []).push(...structuredClone(coll.names));
    if (coll.facts?.length) (surv.facts ??= []).push(...structuredClone(coll.facts));
  }

  const collapsedIds = new Set(merges.map(([, c]) => c));
  result.persons = result.persons.filter(
    (p) => p.id === undefined || !collapsedIds.has(p.id),
  );

  for (const rel of result.relationships ?? []) {
    const mapPerson = (id?: string): string | undefined =>
      id !== undefined ? (collapseMap.get(id) ?? id) : id;
    if (rel.parent !== undefined) rel.parent = mapPerson(rel.parent);
    if (rel.child !== undefined) rel.child = mapPerson(rel.child);
    if (rel.person1 !== undefined) rel.person1 = mapPerson(rel.person1);
    if (rel.person2 !== undefined) rel.person2 = mapPerson(rel.person2);
  }
  if (result.relationships?.length) {
    result.relationships = dedupRelationships(result.relationships);
  }

  for (const survivorId of new Set(merges.map(([s]) => s))) {
    const surv = result.persons.find((p) => p.id === survivorId);
    if (surv?.names) surv.names = mergeNames(surv.names);
    if (surv?.facts) surv.facts = mergeFacts(surv.facts);
  }

  ensureUniqueFactAndNameIds(result);
  return result;
}

/** A candidate person's content after id remap, ready to fold or carry. */
interface PersonContent {
  ark?: string;
  gender?: string;
  names: SimplifiedName[];
  facts: SimplifiedFact[];
}

/**
 * Clone a candidate person's names/facts with fresh N/F ids and source refs
 * rewritten through `sourceIdMap`. The id itself is assigned by the caller
 * (survivor id for a collapse, fresh I id for a carry). Person-level
 * `sources` are not part of the tree format and are not carried (the tool
 * layer strips them from candidates before the merge).
 */
function remapPersonContent(
  person: SimplifiedPerson,
  counters: IdCounters,
  sourceIdMap: Map<string, string>,
): PersonContent {
  const names = (person.names ?? []).map((n) => {
    const c = structuredClone(n);
    c.id = `N${++counters.N}`;
    if (c.sources) c.sources = remapSourceRefs(c.sources, sourceIdMap);
    return c;
  });
  const facts = (person.facts ?? []).map((f) => {
    const c = structuredClone(f);
    c.id = `F${++counters.F}`;
    if (c.sources) c.sources = remapSourceRefs(c.sources, sourceIdMap);
    return c;
  });
  return { ark: person.ark, gender: person.gender, names, facts };
}

/** Clone a candidate relationship with a fresh R id and all refs repointed. */
function remapRelationship(
  rel: SimplifiedRelationship,
  personIdMap: Map<string, string>,
  sourceIdMap: Map<string, string>,
  counters: IdCounters,
): SimplifiedRelationship {
  const c = structuredClone(rel);
  c.id = `R${++counters.R}`;
  const mapPerson = (id?: string): string | undefined =>
    id !== undefined ? (personIdMap.get(id) ?? id) : id;
  if (c.parent !== undefined) c.parent = mapPerson(c.parent);
  if (c.child !== undefined) c.child = mapPerson(c.child);
  if (c.person1 !== undefined) c.person1 = mapPerson(c.person1);
  if (c.person2 !== undefined) c.person2 = mapPerson(c.person2);
  if (c.facts) {
    c.facts = c.facts.map((f) => {
      const fc = structuredClone(f);
      fc.id = `F${++counters.F}`;
      if (fc.sources) fc.sources = remapSourceRefs(fc.sources, sourceIdMap);
      return fc;
    });
  }
  if (c.sources) c.sources = remapSourceRefs(c.sources, sourceIdMap);
  return c;
}

function remapSourceRefs(
  refs: SimplifiedSourceReference[],
  sourceIdMap: Map<string, string>,
): SimplifiedSourceReference[] {
  return refs.map((r) => {
    const c = structuredClone(r);
    if (c.ref !== undefined) c.ref = sourceIdMap.get(c.ref) ?? c.ref;
    return c;
  });
}

/**
 * Merge candidate sources into `result.sources`, deduping by `title`. Returns a
 * map from candidate source id → resulting id (an existing target id when a
 * title matches, else a fresh S id). Mutates `result.sources`.
 */
function buildSourceIdMap(
  result: SimplifiedGedcomX,
  candidateSources: SimplifiedSourceDescription[],
  counters: IdCounters,
): Map<string, string> {
  const map = new Map<string, string>();
  const titleToId = new Map<string, string>();
  for (const s of result.sources ?? []) {
    if (s.id !== undefined && s.title !== undefined && !titleToId.has(s.title)) {
      titleToId.set(s.title, s.id);
    }
  }
  for (const s of candidateSources) {
    if (s.id === undefined) continue;
    const existing = s.title !== undefined ? titleToId.get(s.title) : undefined;
    if (existing !== undefined) {
      map.set(s.id, existing);
      continue;
    }
    const newId = `S${++counters.S}`;
    map.set(s.id, newId);
    const cloned = structuredClone(s);
    cloned.id = newId;
    (result.sources ??= []).push(cloned);
    if (s.title !== undefined) titleToId.set(s.title, newId);
  }
  return map;
}

/**
 * Drop self-referential relationships, and collapse exact `type`+endpoint
 * duplicates into one — folding the duplicate's facts and source refs into the
 * kept relationship rather than discarding them (never throw facts away).
 */
function dedupRelationships(
  rels: SimplifiedRelationship[],
): SimplifiedRelationship[] {
  const byKey = new Map<string, SimplifiedRelationship>();
  const out: SimplifiedRelationship[] = [];
  for (const r of rels) {
    if (isSelfRelationship(r)) continue;
    const key = relationshipKey(r);
    const kept = byKey.get(key);
    if (kept) {
      if (r.facts?.length) {
        kept.facts = mergeFacts([...(kept.facts ?? []), ...r.facts]);
      }
      if (r.sources?.length) {
        kept.sources = dedupSourceRefs([...(kept.sources ?? []), ...r.sources]);
      }
      continue;
    }
    byKey.set(key, r);
    out.push(r);
  }
  return out;
}

function isSelfRelationship(r: SimplifiedRelationship): boolean {
  if (r.parent !== undefined && r.parent === r.child) return true;
  if (r.person1 !== undefined && r.person1 === r.person2) return true;
  return false;
}

function relationshipKey(r: SimplifiedRelationship): string {
  const type = r.type ?? "?";
  // Couple endpoints are unordered; ParentChild is directional.
  if (r.person1 !== undefined || r.person2 !== undefined) {
    const ends = [r.person1 ?? "", r.person2 ?? ""].sort();
    return `${type}|couple|${ends[0]}|${ends[1]}`;
  }
  return `${type}|pc|${r.parent ?? ""}|${r.child ?? ""}`;
}

// ─── Name equivalence (spec §7.1) ───────────────────────────────────────────

/**
 * Collapse equivalent names (a less-specific form merges into the fuller one)
 * and keep genuinely distinct names. Exactly one resulting name is preferred —
 * the most frequent across inputs, tie-broken by completeness.
 */
function mergeNames(names: SimplifiedName[]): SimplifiedName[] {
  if (names.length === 0) return names;
  if (names.length === 1) {
    const only = structuredClone(names[0]);
    only.preferred = true;
    return [only];
  }

  const classes: SimplifiedName[][] = [];
  for (const n of names) {
    const cls = classes.find((c) => c.some((m) => namesEquivalent(m, n)));
    if (cls) cls.push(n);
    else classes.push([n]);
  }

  const reps = classes.map((members) => {
    const best = members.reduce((a, b) => (scoreName(b) > scoreName(a) ? b : a));
    const rep = structuredClone(best);
    const sources = dedupSourceRefs(members.flatMap((m) => m.sources ?? []));
    if (sources.length > 0) rep.sources = sources;
    else delete rep.sources;
    rep.preferred = false;
    return { rep, size: members.length };
  });

  let best = 0;
  for (let i = 1; i < reps.length; i++) {
    const bigger = reps[i].size > reps[best].size;
    const tie = reps[i].size === reps[best].size;
    if (bigger || (tie && scoreName(reps[i].rep) > scoreName(reps[best].rep))) {
      best = i;
    }
  }
  reps[best].rep.preferred = true;
  return reps.map((r) => r.rep);
}

function namesEquivalent(a: SimplifiedName, b: SimplifiedName): boolean {
  return (
    tokensCompatible(nameTokens(a.given), nameTokens(b.given)) &&
    tokensCompatible(nameTokens(a.surname), nameTokens(b.surname))
  );
}

function nameTokens(part: string | undefined): string[] {
  return (part ?? "")
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * True when one token list is a subset of the other, treating a single-letter
 * initial as matching any token that starts with it (`j` ~ `john`).
 */
function tokensCompatible(a: string[], b: string[]): boolean {
  return coversAll(a, b) || coversAll(b, a);
}

function coversAll(big: string[], small: string[]): boolean {
  return small.every((s) => big.some((b) => tokenMatch(b, s)));
}

function tokenMatch(x: string, y: string): boolean {
  if (x === y) return true;
  if (x.length === 1 && y.startsWith(x)) return true;
  if (y.length === 1 && x.startsWith(y)) return true;
  return false;
}

/** Completeness score: more letters and diacritics = more complete. */
function scoreName(n: SimplifiedName): number {
  const text = `${n.given ?? ""} ${n.surname ?? ""}`.trim();
  const letters = text.replace(/\s/g, "").length;
  const diacritics =
    text.normalize("NFD").match(/\p{Mn}/gu)?.length ?? 0;
  return letters * 10 + diacritics;
}

function dedupSourceRefs(
  refs: SimplifiedSourceReference[],
): SimplifiedSourceReference[] {
  const seen = new Set<string>();
  const out: SimplifiedSourceReference[] = [];
  for (const r of refs) {
    const key = `${r.ref ?? ""}|${r.page ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(structuredClone(r));
  }
  return out;
}

/**
 * Final safety pass. Fact and name ids are only unique *within their own array*
 * in SimplifiedGedcomX, so merging arrays (mode-2 person collapse, relationship
 * fact-fold) can yield two facts/names sharing an id. Re-id any duplicate or
 * missing fact/name id with a fresh value above the current maximum. Safe
 * because nothing in the format references a fact or name id.
 */
function ensureUniqueFactAndNameIds(result: SimplifiedGedcomX): void {
  let fMax = maxIdNum(result, "F");
  const seenF = new Set<string>();
  const reidFacts = (facts?: SimplifiedFact[]): void => {
    for (const f of facts ?? []) {
      if (f.id === undefined || seenF.has(f.id)) f.id = `F${++fMax}`;
      seenF.add(f.id);
    }
  };
  for (const p of result.persons ?? []) reidFacts(p.facts);
  for (const r of result.relationships ?? []) reidFacts(r.facts);

  let nMax = maxIdNum(result, "N");
  const seenN = new Set<string>();
  for (const p of result.persons ?? []) {
    for (const n of p.names ?? []) {
      if (n.id === undefined || seenN.has(n.id)) n.id = `N${++nMax}`;
      seenN.add(n.id);
    }
  }
}

// ─── Validation (spec §6.1, §8) ─────────────────────────────────────────────

function validateMerges(
  target: SimplifiedGedcomX,
  candidate: SimplifiedGedcomX | null,
  merges: Array<[string, string]>,
): void {
  const targetPersons = target.persons ?? [];
  if (targetPersons.length === 0) {
    throw new Error("target_gedcomx has no persons");
  }
  if (merges.length === 0) {
    throw new Error("merges must not be empty — nothing to merge");
  }

  const survivors = merges.map((m) => m[0]);
  const collapsed = merges.map((m) => m[1]);

  const dupSurvivor = firstDuplicate(survivors);
  if (dupSurvivor !== undefined) {
    throw new Error(`invalid merges: ${dupSurvivor} appears in multiple pairs`);
  }
  const dupCollapsed = firstDuplicate(collapsed);
  if (dupCollapsed !== undefined) {
    throw new Error(`invalid merges: ${dupCollapsed} appears in multiple pairs`);
  }

  // Mode 2 only: survivor and collapsed share one namespace, so an id that is
  // both a survivor and a collapsed id is an ambiguous chain (a→b, b→c).
  if (candidate === null) {
    const survivorSet = new Set(survivors);
    const chained = collapsed.find((id) => survivorSet.has(id));
    if (chained !== undefined) {
      throw new Error(
        `invalid merges: ${chained} appears as both a survivor and a collapsed id (chains are not supported)`,
      );
    }
  }

  const targetIds = new Set(targetPersons.map((p) => p.id));
  for (const id of survivors) {
    if (!targetIds.has(id)) {
      throw new Error(`merge survivor id ${id} not found in target_gedcomx`);
    }
  }

  const collapsedSourceIds =
    candidate === null
      ? targetIds
      : new Set((candidate.persons ?? []).map((p) => p.id));
  for (const id of collapsed) {
    if (!collapsedSourceIds.has(id)) {
      throw new Error(`merge id ${id} not found`);
    }
  }
}

function firstDuplicate(ids: string[]): string | undefined {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return undefined;
}

// ─── Fact equivalence (spec §7.2) ───────────────────────────────────────────

/** Single-occurrence vital types: exactly one of each is marked `primary`. */
const VITAL_PRIMARY_TYPES: ReadonlySet<string> = new Set([
  "Birth",
  "Death",
  "Christening",
  "Burial",
]);

/**
 * Collapse equivalent facts (same type + compatible date + compatible place),
 * taking the most-specific date and place; keep genuinely distinct facts. For
 * each single-occurrence vital type the most-complete surviving fact is marked
 * `primary`. Other types keep an input `primary` if one was set.
 */
function mergeFacts(facts: SimplifiedFact[]): SimplifiedFact[] {
  if (facts.length === 0) return facts;

  const classes: SimplifiedFact[][] = [];
  for (const f of facts) {
    const cls = classes.find((c) => c.some((m) => factsEquivalent(m, f)));
    if (cls) cls.push(f);
    else classes.push([f]);
  }
  const reps = classes.map(mergeFactGroup);

  for (const type of VITAL_PRIMARY_TYPES) {
    const group = reps.filter((r) => r.type === type);
    if (group.length === 0) continue;
    for (const r of group) delete r.primary;
    const best = group.reduce((a, b) => (factMoreComplete(b, a) ? b : a));
    best.primary = true;
  }
  return reps;
}

/** Merge a class of equivalent facts into one, taking best date + best place. */
function mergeFactGroup(members: SimplifiedFact[]): SimplifiedFact {
  const rep = structuredClone(members[0]); // keep the first (target) id + type

  const bestDate = members.reduce((a, b) =>
    factDateWidth(b) < factDateWidth(a) ? b : a,
  );
  setOrDelete(rep, "date", bestDate.date);
  setOrDelete(rep, "standard_date", bestDate.standard_date);

  const bestPlace = members.reduce((a, b) =>
    placeChainLength(b) > placeChainLength(a) ? b : a,
  );
  setOrDelete(rep, "place", bestPlace.place);
  setOrDelete(rep, "standard_place", bestPlace.standard_place);

  const valued = members.find((m) => m.value !== undefined && m.value !== "");
  setOrDelete(rep, "value", valued?.value);

  if (members.some((m) => m.primary === true)) rep.primary = true;
  else delete rep.primary;

  const sources = dedupSourceRefs(members.flatMap((m) => m.sources ?? []));
  if (sources.length > 0) rep.sources = sources;
  else delete rep.sources;

  return rep;
}

function setOrDelete<K extends keyof SimplifiedFact>(
  fact: SimplifiedFact,
  key: K,
  value: SimplifiedFact[K] | undefined,
): void {
  if (value !== undefined) fact[key] = value;
  else delete fact[key];
}

function factsEquivalent(a: SimplifiedFact, b: SimplifiedFact): boolean {
  if (a.type !== b.type) return false;
  return datesCompatible(a, b) && placesCompatible(a, b);
}

/** Compatible when one date's day-range contains the other (or either is absent). */
function datesCompatible(a: SimplifiedFact, b: SimplifiedFact): boolean {
  const sa = getStandardDate(a);
  const sb = getStandardDate(b);
  if (sa === null || sb === null) return true;
  const ra = getDayRange(sa);
  const rb = getDayRange(sb);
  if (!ra || !rb) return true;
  return rangeContains(ra, rb) || rangeContains(rb, ra);
}

function rangeContains(
  outer: { min: number; max: number },
  inner: { min: number; max: number },
): boolean {
  return outer.min <= inner.min && inner.max <= outer.max;
}

/** Compatible when one place chain is a prefix of the other (or either is absent). */
function placesCompatible(a: SimplifiedFact, b: SimplifiedFact): boolean {
  const pa = placeChain(a);
  const pb = placeChain(b);
  if (pa.length === 0 || pb.length === 0) return true;
  return chainIsPrefix(pa, pb) || chainIsPrefix(pb, pa);
}

/** Root-first, normalized components of a fact's place (standard_place ∨ place). */
function placeChain(f: SimplifiedFact): string[] {
  const raw = f.standard_place ?? f.place;
  if (!raw) return [];
  return raw
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .reverse();
}

function placeChainLength(f: SimplifiedFact): number {
  return placeChain(f).length;
}

function chainIsPrefix(short: string[], long: string[]): boolean {
  return short.length <= long.length && short.every((t, i) => long[i] === t);
}

/** Day-span of a fact's date (smaller = more specific); Infinity when undated. */
function factDateWidth(f: SimplifiedFact): number {
  const s = getStandardDate(f);
  if (s === null) return Infinity;
  const r = getDayRange(s);
  if (!r) return Infinity;
  return r.max - r.min;
}

/** True when `a` is strictly more complete than `b` (date first, then place). */
function factMoreComplete(a: SimplifiedFact, b: SimplifiedFact): boolean {
  const da = factDateWidth(a);
  const db = factDateWidth(b);
  if (da !== db) return da < db;
  return placeChainLength(a) > placeChainLength(b);
}

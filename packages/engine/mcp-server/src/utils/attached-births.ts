/**
 * The tree person's FamilySearch-attached births and the pair test that reads
 * two of them as too far apart to be one birth (#4444), with the place lookups it
 * needs. Read by research_append's gates and by project_context's identity rung.
 * It writes nothing, so a reader tool can import it without becoming a document
 * writer (tests/packaging/ownership-manifest.test.ts).
 */

import { isLiveAssertion } from "./assertion-liveness.js";
import { compatiblePlace } from "./date-comparison.js";
import { birthPlacesAgree, recordIdOf, recordPartyKeys, YEAR_PATTERN } from "./settled-birth-disputes.js";
import { normalizeString } from "./string-similarity.js";
import {
  canonicalCountry,
  isNonPlacePhrase,
  placeReps,
  placeSegments,
  placeTypeKey,
  standardPlaceToCoords,
  standardPlaceToPlaceId,
  UK_CONSTITUENTS,
  type PlaceCoords,
} from "./place-resolver.js";
import { birthThresholdMiles, lookupWithin } from "./place-coords.js";
import { isAttachmentLink } from "./tree-person.js";
import { isAnalysed, registeredPairConflictIds, type AttachedBirthPair } from "./question-state.js";
import { haversineDistance } from "../tools/distance.js";

/** A list, or empty when the document holds anything else there. */
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/** Only a BIRTH place compares against the tree person's birth place. A
 *  christening place is where the church is, not where the child was born:
 *  3 of the corpus's false positives were a christening at Ashton-under-Lyne
 *  against a birth at Preston, which is an ordinary Lancashire life, not a
 *  contradiction. The DATE arm is the other way round -- a christening follows
 *  birth closely, so its date IS comparable. */
export const BIRTH_PLACE_FACT_TYPES: ReadonlySet<string> = new Set(["birth"]);

/** An informant with no proximity to the birth cannot contradict it. Senior
 *  genealogist ruling 2026-09-23 (John Mark Peter-Brown): "A baptismal record
 *  carries weight of birth assertion than a death record with a secondary
 *  information by someone who does not have firsthand information about the
 *  birth." 35 of the corpus's 38 false positives were exactly that -- a death
 *  record's `Born 1845, Pennsylvania` against a tree attesting Ireland, at
 *  `information_quality: "secondary"`, `informant_proximity:
 *  "family_not_present"`. Capping a sound identity link because a death
 *  certificate misreported a birthplace would make the tool worse.
 *
 *  This reads `informant_proximity` to decide whether a contradiction is
 *  CREDIBLE, which is evidence weighing. It is not the same as citing it to
 *  justify a tier, which `agents/person-evidence.md` forbids -- that rule is
 *  about raising confidence on source quality alone. Flagged here because the
 *  two sit close enough to be confused. */
export const WEAK_INFORMANT_PROXIMITY: ReadonlySet<string> = new Set([
  "family_not_present", "researcher", "unknown",
]);

/** Whether this assertion's stated value is credible enough to contradict the
 *  tree. Measured over every committed scenario fixture 2026-09-24: with these
 *  two gates the arm refuses **0 of 323** confident/probable person_evidence
 *  entries, against 38 without them and 274 comparing any place at all. An
 *  assertion a settled conflict set aside, on the attribute that conflict
 *  disputed, is not credible either: one a resolved conflict decided against, or
 *  a competitor in a moot one that carries both analyses (`resolvedAgainstIds`). */
export function contradictionIsCredible(assertion: any, resolvedAgainst: ReadonlySet<string>): boolean {
  if (resolvedAgainst.has(assertion?.id)) return false;
  if (assertion?.information_quality === "secondary") return false;
  return !WEAK_INFORMANT_PROXIMITY.has(
    String(assertion?.informant_proximity ?? "unknown"),
  );
}

/** A person_evidence link as the contradiction gate needs it: which assertion,
 *  to which person, at what tier. `id` is absent on a link this call appends;
 *  `fromBatch` marks a link an op of this call wrote, which the gate checks on
 *  that op itself. */
export interface PersonLink {
  assertion_id: string;
  person_id: string;
  id?: string;
  confidence?: unknown;
  fromBatch?: boolean;
}

/** A standard place's coordinates and, for the attached-births arm, the English
 *  full names of every representation of the same FamilySearch place: "Upper
 *  Canada, British North America" and "Ontario, Canada" are one place, 1791-1841
 *  and from 1867 (#4444). */
export type BirthPlaceInfo = Partial<PlaceCoords> & { aliases?: readonly string[] };

/** Whether a looked-up place carries coordinates: one that kept only its other
 *  names (a historical jurisdiction often has none) is unresolved for distance. */
export function hasCoords(p: BirthPlaceInfo | null | undefined): p is BirthPlaceInfo & PlaceCoords {
  return !!p && typeof p.latitude === "number" && typeof p.longitude === "number";
}

/** Coordinates of standard places, looked up in `prepareOps` because the gate
 *  below is synchronous. A name that is absent or null was not resolved. */
export type BirthPlaceCoords = ReadonlyMap<string, BirthPlaceInfo | null>;

/** The English full names of every representation of a standard place's
 *  FamilySearch place; empty when it resolves to no one place or the read
 *  failed. Throws only the FS budget refusal, which `lookupWithin` passes on. */
export async function placeAliases(name: string): Promise<string[]> {
  const placeId = await standardPlaceToPlaceId(name);
  const reps = placeId ? await placeReps(placeId) : [];
  return reps.map((r) => r.fullName).filter((n): n is string => typeof n === "string");
}

/** One entry of that map, for the dev measurements that look places up one at
 *  a time. `withAliases` also reads the place's other names; null when the
 *  place has no coordinates. */
export async function birthPlaceInfo(name: string, withAliases: boolean): Promise<BirthPlaceInfo | null> {
  const coords = await standardPlaceToCoords(name);
  if (!withAliases) return coords;
  const aliases = await placeAliases(name);
  if (coords) return { ...coords, aliases };
  return aliases.length > 0 ? { aliases } : null;
}

/** Places types (as `placeTypeKey` reads them) that name a whole region rather
 *  than somewhere a person is born. Their coordinates are the region's centre,
 *  so a distance from one is not computable and the pair caps. A county,
 *  department or municipality still gets a distance: the cruz-corona-ancestry
 *  record is a Mexican municipality. Two counties against each other cap,
 *  though: two different counties named as a birthplace are two different
 *  places (Perthshire against Forfarshire), not one place measured twice. */
export const REGION_PLACE_TYPES: ReadonlySet<string> = new Set([
  "continent", "country", "dependency or protectorate", "colony", "state", "province", "territory",
  "region", "prefecture", "governorate", "principality or emirate",
]);

/** The write path's whole budget for those lookups. Over it, a pair has no
 *  coordinates and the cap fires. */
export const BIRTH_PLACE_COORDS_BUDGET_MS = 10_000;

/** The country a birth place names: the last segment, read from the end, that
 *  `canonicalCountry` recognizes. A trailing United Kingdom gives way to a
 *  country named before it, so "Bath, Somerset, England" and "Bath, Somerset,
 *  England, United Kingdom" both read England, while England against Scotland,
 *  or against "Dublin, Ireland, United Kingdom", still differs. Null when no
 *  segment is recognized. A US state is not read as the United States: "CA" is
 *  also Canada, and a US place's standard_place names its country anyway. Not
 *  `placeCountry`: that groups countries whose borders moved, which suits a
 *  residence move and would let a census's "born Ireland" against "born
 *  England" through here. */
export function birthCountry(place: unknown): string | null {
  if (typeof place !== "string") return null;
  const segments = placeSegments(place);
  for (let i = segments.length - 1; i >= 0; i--) {
    const country = canonicalCountry(segments[i]);
    if (!country) continue;
    if (country === "united kingdom") {
      for (let k = i - 1; k >= 0; k--) {
        const inner = canonicalCountry(segments[k]);
        if (inner && inner !== "united kingdom") return inner;
      }
    }
    return country;
  }
  return null;
}

/** The country a standard place names. A FamilySearch standard place always
 *  ends at its country, so the last segment is read as one even when
 *  `canonicalCountry` does not know it ("Zagreb, Croatia"). */
export function standardPlaceCountry(standardPlace: unknown): string | null {
  const known = birthCountry(standardPlace);
  if (known) return known;
  if (typeof standardPlace !== "string") return null;
  const segments = placeSegments(standardPlace);
  return segments.length > 1 ? normalizeString(segments[segments.length - 1]) : null;
}

/** Both sides name a country and the two differ. Read from the place text, or
 *  from the standard_place when the text names none. A bare United Kingdom
 *  does not differ from a constituent: it names no constituent to differ from.
 *  Offline. */
export function birthCountriesDiffer(assertion: any, birth: any): boolean {
  const a = birthCountry(assertion?.place) ?? standardPlaceCountry(assertion?.standard_place);
  const b = birthCountry(birth?.place) ?? standardPlaceCountry(birth?.standard_place);
  if (a === null || b === null || a === b) return false;
  const ukPair = (x: string, y: string) => x === "united kingdom" && UK_CONSTITUENTS.has(y);
  return !ukPair(a, b) && !ukPair(b, a);
}

/** Every year `yearOf` would find in each value, not only the first. */
export function yearsIn(...values: unknown[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    for (const m of String(v ?? "").matchAll(new RegExp(YEAR_PATTERN, "g"))) out.push(Number(m[1]));
  }
  return out;
}

/** Whether two birth places that do not agree are far enough apart to be a
 *  contradiction (lead ruling 2026-10-13, issue #3390): different countries, or
 *  further apart than `birthThresholdMiles` allows for the era the dates span.
 *  Fails closed: with no country difference, the pair counts as far apart unless
 *  both sides carry a standard_place with coordinates finer than a region
 *  (`REGION_PLACE_TYPES`), they are not two counties, and some year is known.
 *  `unresolvedIsNear` opens the one case a slow lookup decides: a standard
 *  place the lookup returned no coordinates for. */
export function birthPlacesFarApart(assertion: any, birth: any, coords?: BirthPlaceCoords, unresolvedIsNear = false): boolean {
  if (birthCountriesDiffer(assertion, birth)) return true;
  const sa = assertion?.standard_place;
  const sb = birth?.standard_place;
  if (typeof sa !== "string" || typeof sb !== "string") return true;
  const pa = coords?.get(sa);
  const pb = coords?.get(sb);
  if (!hasCoords(pa) || !hasCoords(pb)) return !unresolvedIsNear;
  if (REGION_PLACE_TYPES.has(placeTypeKey(pa.type)) || REGION_PLACE_TYPES.has(placeTypeKey(pb.type))) return true;
  if (placeTypeKey(pa.type) === "county" && placeTypeKey(pb.type) === "county") return true;
  const years = yearsIn(birth.date, birth.standard_date, assertion.date);
  if (years.length === 0) return true;
  const { miles } = haversineDistance(pa.latitude, pa.longitude, pb.latitude, pb.longitude);
  return miles > birthThresholdMiles(Math.min(...years), Math.max(...years));
}

/** Every assertion this call can resolve: the document's, plus this batch's
 *  predicted appends. Reading only `research.assertions` let a batch that puts
 *  its assertion appends AFTER the person_evidence ops silence the gates, the
 *  ordering bypass the score gate already closed. */
export function resolvableAssertions(research: any, batchAssertions?: Map<string, any>): Map<string, any> {
  const assertionById = new Map<string, any>();
  for (const a of arr(research?.assertions)) {
    if (isLiveAssertion(a) && typeof a.id === "string") assertionById.set(a.id, a);
  }
  if (batchAssertions) for (const [id, a] of batchAssertions) assertionById.set(id, { ...a, id });
  return assertionById;
}

/** A birth place a record FamilySearch attaches to the tree person states, and
 *  whether the researcher has ruled that record not theirs. */
export interface AttachedBirth {
  assertion: any;
  ruledOut: boolean;
}

/** A birth-place assertion the place arms can read: a birth fact naming a place,
 *  not from a secondary or weak informant. No `resolvedAgainst` filter: a
 *  conflict that set one attached record aside is the agent weighing the tree,
 *  and the run in #4444 resolved exactly that the wrong way. */
export function readableBirthPlace(a: any): boolean {
  return (
    BIRTH_PLACE_FACT_TYPES.has(String(a?.fact_type ?? "").toLowerCase()) &&
    typeof a.place === "string" &&
    placeSegments(a.place).length > 0 &&
    !isNonPlacePhrase(a.place) &&
    contradictionIsCredible(a, new Set())
  );
}

/** The tree person's attached births (#4444): every assertion that ever had an
 *  attachment link to the person, so a checked replacement of one keeps it, and
 *  that is still linked to them or that the researcher rejected for them. One
 *  merely retired with nothing in its place drops out. A rejection outranks a
 *  live link: one appended earlier in this call is retired only after the gate
 *  runs. One appended later is not seen yet, so the link reads both births. */
export function attachedBirths(
  personId: unknown,
  research: any,
  assertionById: Map<string, any>,
  personLinks?: ReadonlyArray<PersonLink>,
): AttachedBirth[] {
  const all = arr(research?.person_evidence).filter((pe: any) => pe && pe.person_id === personId);
  const began = new Set(all.filter(isAttachmentLink).map((pe: any) => pe.assertion_id));
  if (began.size === 0) return [];
  const live = new Set(
    (personLinks ?? all.filter((pe: any) => pe.superseded_by == null))
      .filter((l: any) => l.person_id === personId)
      .map((l: any) => l.assertion_id),
  );
  const rejected = new Set(
    arr(research?.rejected_links).filter((r: any) => r?.person_id === personId).map((r: any) => r.assertion_id),
  );
  // A researcher rejects a record for the person through whichever of its
  // assertions they were shown, most often its name: a rejection rules out the
  // birth of the same record party, not only an assertion of the same id.
  const partyOf = recordPartyKeys(assertionById.values());
  const rejectedParties = new Set<string>();
  for (const id of rejected) {
    const r = assertionById.get(id);
    const key = r ? partyOf(r) : null;
    if (key) rejectedParties.add(key);
  }
  const out: AttachedBirth[] = [];
  for (const id of began) {
    const a = assertionById.get(id);
    if (!a || !readableBirthPlace(a)) continue;
    const key = partyOf(a);
    if (rejected.has(id) || (key != null && rejectedParties.has(key))) out.push({ assertion: a, ruledOut: true });
    else if (live.has(id)) out.push({ assertion: a, ruledOut: false });
  }
  return out;
}

/** A tree person's attached births as the gate reads them: for
 *  `dev/measure-core-identifier-gate.ts`, which imports the tool's own logic. */
export function attachedBirthsOf(personId: string, research: any, personLinks?: ReadonlyArray<PersonLink>): AttachedBirth[] {
  return attachedBirths(personId, research, resolvableAssertions(research), personLinks);
}

/** The two places as the distance test reads a pair, with the tree person's
 *  birth date standing in for a census birthplace that carries none. */
export function withBirthYear(a: any, birth: any): any {
  return { ...a, date: a.date ?? birth.date, standard_date: a.standard_date ?? birth.standard_date };
}

/** A birth place's names: its text, its standard place, and the other names of
 *  the same FamilySearch place when the prefetch read them. */
export function placeNamesOf(a: any, coords?: BirthPlaceCoords): string[] {
  const info = typeof a?.standard_place === "string" ? coords?.get(a.standard_place) : undefined;
  return [a?.place, a?.standard_place, ...(info?.aliases ?? [])].filter(
    (n): n is string => typeof n === "string" && placeSegments(n).length > 0,
  );
}

/** Whether two birth places agree under one of the FamilySearch place's other
 *  names, when the prefetch read them: a historical jurisdiction resolves to a
 *  different country ("Upper Canada, British North America" against "Ontario,
 *  Canada") though FamilySearch keeps both as one place. */
export function placesAgreeByName(x: any, y: any, coords?: BirthPlaceCoords): boolean {
  const ny = placeNamesOf(y, coords);
  return placeNamesOf(x, coords).some((n) => ny.some((m) => compatiblePlace(n, m)));
}

/** Two birth places that neither agree, under any of their names, nor fall
 *  within the distance band. A place's other names matter here because a
 *  historical jurisdiction resolves to a different country ("Upper Canada,
 *  British North America" against "Ontario, Canada"): the live walk over the e2e
 *  subjects read two people as self-contradicting on that alone. */
export function attachedPlacesFar(x: any, y: any, birth: any, coords?: BirthPlaceCoords, unresolvedIsNear = false): boolean {
  if (birthPlacesAgree(x, y) || placesAgreeByName(x, y, coords)) return false;
  return birthPlacesFarApart(withBirthYear(x, birth), withBirthYear(y, birth), coords, unresolvedIsNear);
}

/** Every ordered pair of attached births, from different records, that
 *  contradict each other. */
export function contradictingAttachedPairs(
  live: any[],
  birth: any,
  coords?: BirthPlaceCoords,
  unresolvedIsNear = false,
): Array<[any, any]> {
  const pairs: Array<[any, any]> = [];
  for (const x of live) {
    for (const y of live) {
      if (x !== y && recordIdOf(x) !== recordIdOf(y) && attachedPlacesFar(x, y, birth, coords, unresolvedIsNear)) pairs.push([x, y]);
    }
  }
  return pairs;
}

/** The tree person's Birth fact, which the arms take the year from. */
export function treeBirthFact(tree: any, personId: string): any {
  const person = arr(tree?.persons).find((p: any) => p?.id === personId);
  return arr(person?.facts).find((f: any) => String(f?.type ?? "").toLowerCase() === "birth");
}

/** A tree person's live attached births that contradict each other, as the gate
 *  reads them: for the live walk in `dev/measure-attached-birth-conflicts.ts`.
 *  Empty when the person has no Birth fact, which the gate needs for scope. */
export function attachedBirthConflictsOf(
  personId: string,
  research: any,
  tree: any,
  personLinks?: ReadonlyArray<PersonLink>,
  coords?: BirthPlaceCoords,
): Array<[any, any]> {
  const birth = treeBirthFact(tree, personId);
  if (!birth) return [];
  const live = attachedBirthsOf(personId, research, personLinks).filter((b) => !b.ruledOut).map((b) => b.assertion);
  return contradictingAttachedPairs(live, birth, coords).filter(([x, y]) => String(x.id) < String(y.id));
}

/** The tree people a question's attached-births check reads (#4444): the
 *  project's subjects, everyone live-linked to the question's assertions, and
 *  each one's tree family one hop out. One hop because a family merged through
 *  its children's attachments is what carries a stranger's records to the
 *  parents. The proof gate and project_context's identity rung both read this
 *  scope and nothing wider, so every refusal has a rung that routes it. */
export function attachedBirthScopePersons(research: any, tree: any, questionId: string): string[] {
  const direct = new Set<string>(
    arr(research?.project?.subject_person_ids).filter((id): id is string => typeof id === "string"),
  );
  const ids = new Set<unknown>();
  for (const a of arr(research?.assertions)) {
    if (Array.isArray(a?.extracted_for_question_ids) && a.extracted_for_question_ids.includes(questionId)) ids.add(a.id);
  }
  for (const pe of arr(research?.person_evidence)) {
    if (pe?.superseded_by == null && typeof pe?.person_id === "string" && ids.has(pe.assertion_id)) direct.add(pe.person_id);
  }
  const out = new Set(direct);
  for (const r of arr(tree?.relationships)) {
    const ends = r?.type === "Couple" ? [r.person1, r.person2] : r?.type === "ParentChild" ? [r.parent, r.child] : [];
    if (!ends.some((e: unknown) => typeof e === "string" && direct.has(e))) continue;
    for (const e of ends) if (typeof e === "string") out.add(e);
  }
  return [...out].sort();
}

/** Whether an analysed conflict (`isAnalysed`, the ladder's own reading) has
 *  weighed the pair: an identity conflict naming either record ("is the baptism
 *  this person's?" answers which one is), or a fact conflict naming both, which
 *  `attachedBirthConflictInvariants` keeps from being resolved across the pair. */
export function attachedBirthPairAnswered(research: any, pair: AttachedBirthPair): boolean {
  const named = new Set(registeredPairConflictIds(research, pair));
  return arr(research?.conflicts).some((c: any) => named.has(c?.id) && isAnalysed(c));
}

/** The pairs among `personIds` no analysed conflict has weighed yet: what the
 *  proof gate refuses on and project_context's identity rung routes on. */
export function unansweredAttachedBirthPairs(
  personIds: Iterable<string>,
  research: any,
  tree: any,
  coords?: BirthPlaceCoords,
): AttachedBirthPair[] {
  const out: AttachedBirthPair[] = [];
  for (const personId of personIds) {
    for (const [a, b] of attachedBirthConflictsOf(personId, research, tree, undefined, coords)) {
      const pair = { personId, a, b };
      if (!attachedBirthPairAnswered(research, pair)) out.push(pair);
    }
  }
  return out;
}

/** The standard places to look up before judging `personIds`' pairs, from
 *  pairs found with no place data, which can only shrink once place data is
 *  read. Other names for every such place: a historical jurisdiction resolves
 *  to another country ("Upper Canada" against "Ontario"). Coordinates only for a
 *  pair in one country: the distance test never reads them across countries. A
 *  family whose attached births agree costs no lookup. */
export function attachedBirthPairPlaces(
  pairs: Iterable<AttachedBirthPair>,
): { coordNames: string[]; aliasNames: string[] } {
  const coordNames = new Set<string>();
  const aliasNames = new Set<string>();
  for (const { a, b } of pairs) {
    const sameCountry = !birthCountriesDiffer(a, b);
    for (const x of [a, b]) {
      if (typeof x?.standard_place !== "string") continue;
      aliasNames.add(x.standard_place);
      if (sameCountry) coordNames.add(x.standard_place);
    }
  }
  return { coordNames: [...coordNames], aliasNames: [...aliasNames] };
}

/** Every question's unanswered pairs, with the places read once for all of
 *  them: what project_context and project_view pass to `questionStates`. A pair
 *  whose places are never read (none is standard, or the lookup is refused) is
 *  judged with no place data, as research_append's gate judges an unresolved
 *  place, so the rung never misses a pair the gate refuses on. `lookup` is the
 *  place reader; the dev replay passes one that reads nothing. */
export async function attachedBirthPairsByQuestion(
  research: any,
  tree: any,
  lookup: (coordNames: string[], aliasNames: string[]) => Promise<BirthPlaceCoords> = lookupBirthPlaceInfo,
): Promise<Map<string, AttachedBirthPair[]>> {
  const scopes = new Map<string, string[]>();
  for (const q of arr(research?.questions)) {
    if (typeof q?.id === "string") scopes.set(q.id, attachedBirthScopePersons(research, tree, q.id));
  }
  // Each person once, however many questions' scopes hold them.
  const persons = new Set([...scopes.values()].flat());
  const unread = new Map<string, AttachedBirthPair[]>();
  for (const p of persons) unread.set(p, unansweredAttachedBirthPairs([p], research, tree));
  const { coordNames, aliasNames } = attachedBirthPairPlaces([...unread.values()].flat());
  let coords: BirthPlaceCoords | undefined;
  if (coordNames.length > 0 || aliasNames.length > 0) {
    try {
      coords = await lookup(coordNames, aliasNames);
    } catch {
      // A refused or failed read: the pairs stand as read with no place data.
      coords = undefined;
    }
  }
  const byPerson = new Map<string, AttachedBirthPair[]>();
  for (const [p, pairs] of unread) {
    byPerson.set(p, pairs.length > 0 && coords ? unansweredAttachedBirthPairs([p], research, tree, coords) : pairs);
  }
  const out = new Map<string, AttachedBirthPair[]>();
  for (const [qid, scope] of scopes) {
    const pairs = scope.flatMap((p) => byPerson.get(p) ?? []);
    if (pairs.length > 0) out.set(qid, pairs);
  }
  return out;
}

/** Coordinates for `coordNames` and other FamilySearch names for `aliasNames`,
 *  side by side under one budget: what the place arms read. Shared by the
 *  prefetch and by project_context's identity rung, so the two read a pair the
 *  same way. */
export async function lookupBirthPlaceInfo(coordNames: Iterable<string>, aliasNames: Iterable<string>): Promise<BirthPlaceCoords> {
  const names = [...coordNames];
  const withNames = new Set(aliasNames);
  if (names.length === 0 && withNames.size === 0) return new Map();
  // Coordinates only for the distance test's names, so a pair already known to
  // be in different countries still costs no coordinate lookup; other names only
  // for the names the arms compare by name.
  const all = [...new Set([...names, ...withNames])];
  const [coords, aliases] = await Promise.all([
    names.length > 0
      ? lookupWithin([...new Set(names)], (name) => standardPlaceToCoords(name), BIRTH_PLACE_COORDS_BUDGET_MS)
      : Promise.resolve(new Map<string, PlaceCoords | null>()),
    withNames.size > 0
      ? lookupWithin([...withNames], placeAliases, BIRTH_PLACE_COORDS_BUDGET_MS)
      : Promise.resolve(new Map<string, string[] | null>()),
  ]);
  const out = new Map<string, BirthPlaceInfo | null>();
  for (const name of all) {
    const c = coords.get(name) ?? null;
    const a = aliases.get(name);
    if (c) out.set(name, a ? { ...c, aliases: a } : c);
    else out.set(name, a && a.length > 0 ? { aliases: a } : null);
  }
  return out;
}

/**
 * A candidate an earlier search for the subject already returned, and the two
 * writes that may not drop one (issue #4580):
 *
 *   - record_search refuses a birth range that excludes a candidate
 *     (`candidateExclusionRefusal`);
 *   - research_append refuses a `namesakes` row that rules a candidate out on
 *     nothing the project holds but its birth year (`namesakeCandidateRefusals`):
 *     not a precise birth date, a birthplace in another country or state, a link
 *     of the person, in their own entry and not as a parent, informant, witness
 *     or sponsor, to another record of the candidate's own collection, or a
 *     parent on the candidate's record unrelated to the person's tree parent of
 *     the same role.
 *
 * In the reported session `log_099` returned an 1870 household headed by
 * "Antoine Tyler", born 1833, for a subject born about 1853. The next search,
 * `log_100`, kept birth 1848–1858, came back nil, and the nil was reported as a
 * finding. The search-records agent body already says not to do this, and the
 * agent kept doing it (4 of 5 runs of `ut_search_records_035` with the prose
 * alone, 2026-11-23). Once the range was refused, the agent recorded Antoine as
 * the subject's namesake on the birth year instead (3 of 3 runs, 2026-11-25),
 * which drops her the same way and, being a namesake, released the range too.
 * Both are decidable from the project's own logged sidecars, so per ADR-0011 the
 * tools refuse them rather than the body asking the model to remember.
 *
 * A candidate is a row of a logged `record_search` sidecar whose echoed query
 * named the same `subjectId`, on a page of at most `CANDIDATE_PAGE_MAX` rows from
 * a search whose `totalMatches` is also at most `CANDIDATE_PAGE_MAX`. A short
 * result is a candidate list; a long one, or a short page of a long one, is a
 * pool the agent is entitled to narrow with a birth range, which is how a broad
 * search is meant to be followed up. A search the log records `negative` returned
 * rows the researcher already judged were not the subject, so none of its rows is
 * a candidate. That search must also have been for the subject: its `givenName`
 * or `givenNameAlt` matches one of the subject's given names in the tree, so a
 * search for a wife or a parent made under the subject's id, or one with no given
 * name (a surname sweep of households), finds no candidates for the subject. An
 * initial in the subject's tree name matches only an initial, so "Hannah E" does
 * not make a search for Edwin a search for her. The row's first given name must
 * match what that search asked for. A subject the tree does not hold, or holds
 * with no given name, has no candidates. A row whose record the researcher
 * rejected for the subject (`rejected_links`), recorded as a namesake of the
 * subject (`namesakes`), or whose own entry is linked `confident` (not
 * superseded) to another person (`person_evidence`), is not a candidate either.
 * A rejected or confident link counts only on the candidate's own entry in the
 * record (the entry whose extracted name has the row's first given name), so
 * linking a child of her household to another tree person does not release
 * her; when no extracted entry carries her name, any link of the record counts.
 *
 * The record_search call being judged: one with no given name of its own that
 * names a parent (`fatherGivenName`, `motherSurname`, …) searches for the
 * subject's child, and its range is not judged. Otherwise a call under one of the
 * subject's given names, or with none, is judged against every candidate; a call
 * under another given name is judged only against the candidates whose given name
 * it searches, so "Antoine" is refused on a tree that holds only "Ann" while
 * "Margaret" is not. A refusal never blocks the search itself: dropping the
 * range, or widening it to the named years, is always accepted.
 *
 * A call with no `subjectId` is judged for each of the project's subjects
 * (`project.subject_person_ids`) one of whose tree birth years (from any
 * birth-like fact: Birth, Christening, Baptism, …) its range includes, whatever
 * given name it searches: an "Ann" search for 1848–1858 with no subject is a
 * search for the subject born 1853, and leaving the id off would otherwise let
 * the range through unjudged. Its given name then binds it to candidates as it
 * does under the subject's id, so "Antoine" is judged against Antoine and
 * "Margaret" against no one. The birth year is what tells the subject from a
 * daughter named for her, whose search (Hannah, 1878–1884, for a mother born
 * 1857) leaves the mother's year out. One with no given name (a surname sweep),
 * or for a subject the tree gives no birth year, is not judged.
 *
 * Reads only; a document it cannot read allows the call (an unreadable sidecar
 * is skipped and the rest are judged), because a refusal built on a document it
 * could not read would be a guess.
 */

import { arkToBareId } from "./ark.js";
import { birthCountriesDiffer, yearsIn } from "./attached-births.js";
import { givenNamesRelated } from "./attachment-support.js";
import { stdDate } from "./date-standardize.js";
import { isPerfectStandardDate } from "./fact-helpers.js";
import { BIRTHLIKE_FACT_TYPES } from "./mob.js";
import { divisionContradiction } from "./place-resolver.js";
import { readProjectJson } from "./project-io.js";
import { diceCoefficient, normalizeString } from "./string-similarity.js";

/** Most rows a logged page may hold for its rows to count as candidates. */
export const CANDIDATE_PAGE_MAX = 5;

/** The parent-name arguments of a record_search call. */
const PARENT_NAME_KEYS = [
  "fatherGivenName",
  "fatherSurname",
  "motherGivenName",
  "motherSurname",
  "parentGivenName",
  "parentSurname",
] as const;

export interface CandidateExclusionInput {
  projectPath?: string;
  subjectId?: string;
  givenName?: string;
  givenNameAlt?: string;
  birthYearFrom?: number;
  birthYearTo?: number;
  fatherGivenName?: string;
  fatherSurname?: string;
  motherGivenName?: string;
  motherSurname?: string;
  parentGivenName?: string;
  parentSurname?: string;
}

export interface ExcludedCandidate {
  /** The subject the candidate was found for. */
  subjectId: string;
  recordId: string;
  personName: string | null;
  birthYear: number;
  logId: string;
}

/** A candidate as the project holds it, whatever range a call asks for. */
export interface Candidate {
  recordId: string;
  personName: string | null;
  birthDate: string;
  birthYear: number;
  birthPlace: string | null;
  /** The row's collection, or null when the row names none. */
  collectionId: string | null;
  /** The parents the row's own record names for its principal, each by first
   *  given name and gender (null when the record gives none), or empty. */
  parents: RecordParent[];
  logId: string;
}

export interface RecordParent {
  given: string;
  gender: string | null;
}

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/** A person's gender, lower-cased, or null when it names none. */
const genderOf = (p: any): string | null =>
  typeof p?.gender === "string" && p.gender.trim() !== "" ? p.gender.trim().toLowerCase() : null;

/** Record roles that name a person as a parent, informant, witness or sponsor of
 *  another person's record, not in an entry of their own. */
const NOT_OWN_ENTRY_ROLE = /^(father|mother|parent|informant|witness|godparent|sponsor)/;

/** Dice cutoff for two given names to be the same name (MobWarnings' DICE_CUTOFF). */
const GIVEN_NAME_DICE = 0.66;

/** The entry of a record an assertion belongs to: its persona, else its role. */
const entryKey = (a: any): string =>
  typeof a?.record_persona_id === "string" ? `p:${a.record_persona_id}` : `r:${a?.record_role ?? ""}`;

/** What rules a row out for the subject: the records named as the subject's
 *  namesakes, and, by bare record id, every assertion of each record with those
 *  the researcher rejected for the subject or linked `confident` to another
 *  person. */
interface RuledOut {
  namesakeRecords: Set<string>;
  byRecord: Map<string, { all: any[]; ruled: any[] }>;
}

function ruledOutFor(research: any, subjectId: string): RuledOut {
  const rejected = new Set(
    arr(research?.rejected_links)
      .filter((r) => r?.person_id === subjectId && typeof r?.assertion_id === "string")
      .map((r) => r.assertion_id as string),
  );
  const elsewhere = new Set(
    arr(research?.person_evidence)
      .filter((pe) => pe?.confidence === "confident" && pe?.person_id !== subjectId && !pe?.superseded_by)
      .map((pe) => pe?.assertion_id),
  );
  const byRecord = new Map<string, { all: any[]; ruled: any[] }>();
  for (const a of arr(research?.assertions)) {
    if (typeof a?.record_id !== "string") continue;
    const id = arkToBareId(a.record_id);
    const slot = byRecord.get(id) ?? { all: [], ruled: [] };
    slot.all.push(a);
    if (rejected.has(a?.id) || elsewhere.has(a?.id)) slot.ruled.push(a);
    byRecord.set(id, slot);
  }
  const namesakeRecords = new Set<string>();
  for (const n of arr(research?.namesakes)) {
    if (n?.person_id !== subjectId) continue;
    for (const id of arr(n?.record_ids)) if (typeof id === "string") namesakeRecords.add(arkToBareId(id));
  }
  return { namesakeRecords, byRecord };
}

/** Whether `row` (record `recordBareId`) is ruled out for the subject: named as
 *  a namesake, or a ruling link on the row's own entry in the record. The row's
 *  entry is each one whose extracted name has the row's first given name; when
 *  no entry's has, every entry counts. */
function isRuledOut(ruled: RuledOut, recordBareId: string, row: any): boolean {
  if (ruled.namesakeRecords.has(recordBareId)) return true;
  const slot = ruled.byRecord.get(recordBareId);
  if (!slot || slot.ruled.length === 0) return false;
  const given = typeof row?.personName === "string" ? row.personName.trim().split(/\s+/)[0] : "";
  const own = new Set(
    slot.all
      .filter((a) => a?.fact_type === "name" && typeof a?.value === "string")
      .filter((a) => givenMatches(a.value.trim().split(/\s+/)[0], given))
      .map(entryKey),
  );
  return own.size === 0 || slot.ruled.some((a) => own.has(entryKey(a)));
}

function givenMatches(given: string, pattern: string): boolean {
  const g = normalizeString(given);
  const p = normalizeString(pattern);
  if (!g || !p) return false;
  if (/[*?]/.test(p)) {
    const re = p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
    return new RegExp(`^${re}$`).test(g);
  }
  return g.startsWith(p) || p.startsWith(g) || diceCoefficient(g, p) >= GIVEN_NAME_DICE;
}

/** Every word of a query's `givenName` and `givenNameAlt`. */
function queryGivenWords(query: any): string[] {
  return [query?.givenName, query?.givenNameAlt]
    .filter((v): v is string => typeof v === "string" && v.trim() !== "")
    .flatMap((v) => v.trim().split(/\s+/));
}

/** The parents a staged row's record names for its principal (`gedcomx` and
 *  `primaryId`), each by first given name and gender, or empty when the row
 *  carries no record. */
function rowParents(row: any): RecordParent[] {
  const g = row?.gedcomx;
  if (!g || typeof row?.primaryId !== "string") return [];
  const byId = new Map(arr(g.persons).map((p: any) => [p?.id, p]));
  return arr(g.relationships)
    .filter((r: any) => r?.type === "ParentChild" && r?.child === row.primaryId)
    .flatMap((r: any) => {
      const parent = byId.get(r?.parent);
      return arr(parent?.names)
        .map((n: any) => n?.given)
        .filter((v: unknown): v is string => typeof v === "string" && v.trim() !== "")
        .map((v: string) => ({ given: v.trim().split(/\s+/)[0], gender: genderOf(parent) }));
    });
}

/** Whether `row` is a hit for the given name `query` searched for. A query with
 *  no given name searched for anyone, so every row is. */
function rowMatchesQueryGiven(row: any, query: any): boolean {
  const words = queryGivenWords(query);
  if (words.length === 0) return true;
  const given = typeof row?.personName === "string" ? row.personName.trim().split(/\s+/)[0] : "";
  return words.some((word) => givenMatches(given, word));
}

/** Every word of every given name the tree holds for `subjectId`, or empty. */
function subjectGivenWords(tree: any, subjectId: string): string[] {
  const person = arr(tree?.persons).find((p) => p?.id === subjectId);
  return arr(person?.names)
    .map((n) => (typeof n?.given === "string" ? n.given.replace(/["']/g, "") : ""))
    .flatMap((g) => g.trim().split(/\s+/))
    .filter((w) => w !== "");
}

/** Whether a query's given name is one of the subject's given names. An initial
 *  of the subject's matches only an initial. */
function queryIsForSubject(query: any, subjectWords: string[]): boolean {
  return queryGivenWords(query).some((word) =>
    subjectWords.some((s) =>
      normalizeString(s).length === 1 && normalizeString(word).length > 1 ? false : givenMatches(s, word),
    ),
  );
}

/** Whether a call with no given name of its own names a parent: it searches for
 *  the subject's child, whose birth range the subject's candidates do not bind. */
function isSearchForAChild(input: CandidateExclusionInput): boolean {
  return (
    queryGivenWords(input).length === 0 &&
    PARENT_NAME_KEYS.some((k) => typeof input[k] === "string" && input[k]!.trim() !== "")
  );
}

/** Every candidate `research` and `tree` hold for `subjectId`, oldest log entry
 *  first, one per record. With `call`, only those a call of that given name
 *  binds. Sidecars are read from `projectPath`. */
export async function candidatesFor(
  projectPath: string,
  research: any,
  tree: any,
  subjectId: string,
  call?: CandidateExclusionInput,
): Promise<Candidate[]> {
  const subjectWords = subjectGivenWords(tree, subjectId);
  if (subjectWords.length === 0) return [];
  const callIsForSubject = call === undefined || queryGivenWords(call).length === 0 || queryIsForSubject(call, subjectWords);

  const ruledOut = ruledOutFor(research, subjectId);
  const out: Candidate[] = [];
  const seen = new Set<string>();

  for (const entry of arr(research?.log)) {
    if (entry?.tool !== "record_search" || typeof entry?.results_ref !== "string") continue;
    if (entry?.outcome === "negative") continue;
    let sidecar: any;
    try {
      sidecar = await readProjectJson(projectPath, entry.results_ref);
    } catch {
      continue;
    }
    const payload = sidecar?.payload;
    if (payload?.query?.subjectId !== subjectId || !queryIsForSubject(payload.query, subjectWords)) continue;
    const rows = arr(payload?.results);
    const total = typeof payload?.totalMatches === "number" ? payload.totalMatches : rows.length;
    if (rows.length === 0 || rows.length > CANDIDATE_PAGE_MAX || total > CANDIDATE_PAGE_MAX) continue;

    for (const row of rows) {
      if (typeof row?.recordId !== "string") continue;
      const id = arkToBareId(row.recordId);
      if (seen.has(id) || isRuledOut(ruledOut, id, row) || !rowMatchesQueryGiven(row, payload.query)) continue;
      if (!callIsForSubject && !rowMatchesQueryGiven(row, call)) continue;
      const [birthYear] = yearsIn(row.birthDate);
      if (birthYear === undefined) continue;
      seen.add(id);
      out.push({
        recordId: row.recordId,
        personName: typeof row.personName === "string" ? row.personName : null,
        birthDate: String(row.birthDate),
        birthYear,
        birthPlace: typeof row.birthPlace === "string" ? row.birthPlace : null,
        collectionId: typeof row.collectionId === "string" ? row.collectionId : null,
        parents: rowParents(row),
        logId: typeof entry.id === "string" ? entry.id : entry.results_ref,
      });
    }
  }
  return out;
}

/** The first year of each birth-like fact (Birth, Christening, Baptism, …) the
 *  tree holds for `personId`; a fact with no year is skipped. */
function treeBirthYears(tree: any, personId: string): number[] {
  const person = arr(tree?.persons).find((p) => p?.id === personId);
  return arr(person?.facts)
    .filter((f) => typeof f?.type === "string" && BIRTHLIKE_FACT_TYPES.has(f.type))
    .map((f) => yearsIn(f.standard_date ?? f.date)[0])
    .filter((y): y is number => y !== undefined);
}

/** The subjects a call is judged for: its own `subjectId`, else, for a call that
 *  searches a given name, each project subject one of whose tree birth years its
 *  range includes. Which of that subject's candidates the call's given name
 *  binds is `candidatesFor`'s to decide, as it is under the subject's id. */
function subjectsJudged(input: CandidateExclusionInput, research: any, tree: any): string[] {
  if (input.subjectId) return [input.subjectId];
  if (queryGivenWords(input).length === 0) return [];
  const { birthYearFrom: from, birthYearTo: to } = input;
  return arr(research?.project?.subject_person_ids)
    .filter((id): id is string => typeof id === "string")
    .filter((id) =>
      treeBirthYears(tree, id).some(
        (born) => (typeof from !== "number" || from <= born) && (typeof to !== "number" || born <= to),
      ),
    );
}

/** Every candidate the call's birth range excludes, oldest log entry first. */
export async function excludedCandidates(input: CandidateExclusionInput): Promise<ExcludedCandidate[]> {
  const { projectPath, birthYearFrom: from, birthYearTo: to } = input;
  if (!projectPath) return [];
  if (typeof from !== "number" && typeof to !== "number") return [];
  if (isSearchForAChild(input)) return [];

  let research: any;
  let tree: any;
  try {
    research = await readProjectJson(projectPath, "research.json");
    tree = await readProjectJson(projectPath, "tree.gedcomx.json");
  } catch {
    return [];
  }

  const out: ExcludedCandidate[] = [];
  for (const subjectId of subjectsJudged(input, research, tree)) {
    for (const c of await candidatesFor(projectPath, research, tree, subjectId, input)) {
      const below = typeof from === "number" && c.birthYear < from;
      const above = typeof to === "number" && c.birthYear > to;
      if (!below && !above) continue;
      out.push({ subjectId, recordId: c.recordId, personName: c.personName, birthYear: c.birthYear, logId: c.logId });
    }
  }
  return out;
}

export function candidateExclusionMessage(
  input: CandidateExclusionInput,
  excluded: ExcludedCandidate[],
): string {
  const range = `${input.birthYearFrom ?? "…"}–${input.birthYearTo ?? "…"}`;
  const named = excluded
    .map((c) => `${c.personName ?? "a record"} (${c.recordId}), born ${c.birthYear}, from ${c.logId}`)
    .join("; ");
  const years = [...new Set(excluded.map((c) => c.birthYear))].sort((a, b) => a - b).join(", ");
  const subjects = [...new Set(excluded.map((c) => c.subjectId))].join(", ");
  const inferred = input.subjectId
    ? ""
    : ` This call names no subjectId; its range includes ${subjects}'s tree birth year, so it is judged as a search for ${subjects}.`;
  return (
    `Refused: the birth range ${range} excludes a candidate an earlier search for ` +
    `${subjects} already returned: ${named}. An empty result under this range ` +
    "could not rule that candidate out, and an indexed age can be years off. Search " +
    `again with no birth range, or with one that includes ${years}.${inferred}`
  );
}

/** The refusal for `input`, or null when its birth range excludes no candidate. */
export async function candidateExclusionRefusal(input: CandidateExclusionInput): Promise<string | null> {
  const excluded = await excludedCandidates(input);
  return excluded.length === 0 ? null : candidateExclusionMessage(input, excluded);
}

/** The collection of every row of every logged record_search sidecar, by bare
 *  record id. An unreadable sidecar is skipped. */
async function loggedCollections(projectPath: string, research: any): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const entry of arr(research?.log)) {
    if (entry?.tool !== "record_search" || typeof entry?.results_ref !== "string") continue;
    let sidecar: any;
    try {
      sidecar = await readProjectJson(projectPath, entry.results_ref);
    } catch {
      continue;
    }
    for (const row of arr(sidecar?.payload?.results)) {
      if (typeof row?.recordId === "string" && typeof row?.collectionId === "string") {
        out.set(arkToBareId(row.recordId), row.collectionId);
      }
    }
  }
  return out;
}

/** Whether `research` links `personId`, `probable` or `confident` and not
 *  superseded, in an entry of their own, to a record other than `recordId` in the
 *  same collection (`collectionId`, looked up in `collectionOf`): the subject
 *  found elsewhere in the same record set is what makes the candidate someone
 *  else. A link to a record of another collection says nothing about who the
 *  candidate was, and nor does one naming the subject as a parent, informant,
 *  witness or sponsor of someone else's record (`NOT_OWN_ENTRY_ROLE`). */
function linkedToAnotherRecord(
  research: any,
  personId: string,
  recordId: string,
  collectionId: string | null,
  collectionOf: Map<string, string>,
): boolean {
  const recordOf = new Map<string, string>(
    arr(research?.assertions)
      .filter((a) => typeof a?.id === "string" && typeof a?.record_id === "string")
      .filter((a) => typeof a?.record_role !== "string" || !NOT_OWN_ENTRY_ROLE.test(a.record_role.toLowerCase()))
      .map((a) => [a.id, arkToBareId(a.record_id)]),
  );
  return arr(research?.person_evidence).some((pe) => {
    if (pe?.person_id !== personId || pe?.superseded_by) return false;
    if (pe?.confidence !== "probable" && pe?.confidence !== "confident") return false;
    const rec = recordOf.get(pe?.assertion_id);
    return rec !== undefined && rec !== recordId && collectionOf.get(rec) === collectionId;
  });
}

/** Whether the candidate's own record names a parent whose given name is
 *  unrelated to the tree parent of the same role for `personId` (not the same, a
 *  match, or a variant or nickname): the record is of another family. A record
 *  parent is compared only with the tree parents of its own gender (with any,
 *  when either side gives none), so a record mother is never read against a tree
 *  father, and one whose role the tree holds no one in rules nothing out. */
function otherParents(c: Candidate, tree: any, personId: string): boolean {
  if (c.parents.length === 0) return false;
  const treeParents = arr(tree?.relationships)
    .filter((r) => r?.type === "ParentChild" && r?.child === personId && typeof r?.parent === "string")
    .map((r) => ({
      words: subjectGivenWords(tree, r.parent),
      gender: genderOf(arr(tree?.persons).find((p) => p?.id === r.parent)),
    }))
    .filter((t) => t.words.length > 0);
  return c.parents.some((p) => {
    const sameRole = treeParents.filter((t) => p.gender === null || t.gender === null || t.gender === p.gender);
    if (sameRole.length === 0) return false;
    return !sameRole.some((t) =>
      t.words.some((w) => givenMatches(w, p.given) || givenNamesRelated(w, p.given) !== "different"),
    );
  });
}

/** Whether `place`, a row's indexed birthplace, names another country, US state
 *  or Canadian province than the tree's birth of `personId`. */
function birthPlaceContradicts(place: string | null, tree: any, personId: string): boolean {
  if (place === null) return false;
  const person = arr(tree?.persons).find((p) => p?.id === personId);
  const birth = arr(person?.facts).find(
    (f) => f?.type === "Birth" && (typeof f?.place === "string" || typeof f?.standard_place === "string"),
  );
  if (!birth) return false;
  if (birthCountriesDiffer({ place }, birth)) return true;
  const where = typeof birth.standard_place === "string" ? birth.standard_place : birth.place;
  return typeof where === "string" && divisionContradiction(place, where);
}

/** One refused namesake op: its index in the call, and the message. */
export interface NamesakeCandidateRefusal {
  opIndex: number;
  message: string;
}

/**
 * The `namesakes` rows a research_append call writes that name a candidate of
 * their own person, judged against the project as it stood before the call
 * (`before`). A row may still name a candidate when the candidate's birth date is
 * a full day-month-year date (a precise date, not an age), when its indexed
 * birthplace names another country, US state or Canadian province than the
 * person's tree birth, when the project links the person `probable` or
 * `confident`, in an entry of their own and not as a parent, informant, witness
 * or sponsor, to another record of the candidate's own collection (the subject is
 * found elsewhere in the same record set), or when the candidate's own record
 * names a parent whose given name is unrelated to the person's tree parent of the
 * same role (the record is of another family). Otherwise the
 * row would drop a record the search found for the subject on its birth year
 * alone, and an indexed age can be years off.
 *
 * `rows` is each row the call appended or updated, as it stands after the call,
 * with the index of the op that wrote it; `after` is the research as it stands
 * after the call, which the link exception reads. A record a row named before the
 * call is no candidate (`before`'s namesakes release it), so only what the call
 * adds is judged.
 */
export async function namesakeCandidateRefusals(
  projectPath: string,
  before: any,
  after: any,
  tree: any,
  rows: ReadonlyArray<{ opIndex: number; row: any }>,
): Promise<NamesakeCandidateRefusal[]> {
  const out: NamesakeCandidateRefusal[] = [];
  const byPerson = new Map<string, Candidate[]>();
  let collectionOf: Map<string, string> | undefined;
  for (const { opIndex, row } of rows) {
    const personId = row?.person_id;
    if (typeof personId !== "string") continue;
    if (!byPerson.has(personId)) byPerson.set(personId, await candidatesFor(projectPath, before, tree, personId));
    const candidates = byPerson.get(personId)!;
    if (candidates.length === 0) continue;
    const named = new Set(arr(row?.record_ids).filter((id) => typeof id === "string").map((id: string) => arkToBareId(id)));
    collectionOf ??= await loggedCollections(projectPath, after);
    const hit = candidates.filter((c) => {
      const id = arkToBareId(c.recordId);
      if (!named.has(id)) return false;
      if (isPerfectStandardDate(stdDate(c.birthDate))) return false;
      if (birthPlaceContradicts(c.birthPlace, tree, personId)) return false;
      if (otherParents(c, tree, personId)) return false;
      return !linkedToAnotherRecord(after, personId, id, c.collectionId, collectionOf!);
    });
    if (hit.length === 0) continue;
    const list = hit
      .map((c) => `${c.personName ?? "a record"} (${c.recordId}), born ${c.birthDate}, from ${c.logId}`)
      .join("; ");
    out.push({
      opIndex,
      message:
        `namesake row for '${personId}' names a candidate a search for '${personId}' returned: ${list}. ` +
        "Nothing in the project rules it out but its birth year, which an indexed age can put years off, " +
        "so it may still be the subject and is not recorded as a namesake. Leave it out of the row and " +
        "report it as needs-review, the subject or a relative, naming the disagreement and the record that " +
        "would settle it; do not call it probably or likely someone else. A row may " +
        `name it once '${personId}' is linked probable or confident, in an entry of their own and not as a ` +
        "parent, informant, witness or sponsor, to another record of the same collection, when its birth " +
        "date is a full day-month-year date, when its birthplace names another country or state than " +
        `'${personId}''s, or when its record names a parent unrelated to '${personId}''s tree parent of ` +
        "the same role.",
    });
  }
  return out;
}

/**
 * record_search's refusal of a birth range that excludes a candidate an earlier
 * search for the same subject already returned (issue #4580).
 *
 * In the reported session `log_099` returned an 1870 household headed by
 * "Antoine Tyler", born 1833, for a subject born about 1853. The next search,
 * `log_100`, kept birth 1848–1858, came back nil, and the nil was reported as a
 * finding. The search-records agent body already says not to do this, and the
 * agent kept doing it (4 of 5 runs of `ut_search_records_035` with the prose
 * alone, 2026-11-23).
 * Whether a range excludes a row already found is decidable from the project's
 * own logged sidecars, so per ADR-0011 the tool refuses it rather than the body
 * asking the model to remember.
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
 * name (a surname sweep of households), finds no candidates for the subject. The
 * row's first given name must match what that search asked for. The call being
 * judged is checked the same way: one whose given name is not the subject's is a
 * search for someone else, and the subject's candidates do not bind its range. A
 * subject the tree does not hold, or holds with no given name, allows the call. A
 * row whose record the researcher rejected for the subject (`rejected_links`) or
 * recorded as a namesake of the subject (`namesakes`) is not a candidate either.
 * A refusal never blocks the search itself: dropping the range, or widening it to
 * the named years, is always accepted.
 *
 * Reads only; every failure to read project state allows the search, because a
 * refusal built on a document it could not read would be a guess.
 */

import { arkToBareId } from "./ark.js";
import { yearsIn } from "./attached-births.js";
import { readProjectJson } from "./project-io.js";
import { diceCoefficient, normalizeString } from "./string-similarity.js";

/** Most rows a logged page may hold for its rows to count as candidates. */
export const CANDIDATE_PAGE_MAX = 5;

export interface CandidateExclusionInput {
  projectPath?: string;
  subjectId?: string;
  givenName?: string;
  givenNameAlt?: string;
  birthYearFrom?: number;
  birthYearTo?: number;
}

export interface ExcludedCandidate {
  recordId: string;
  personName: string | null;
  birthYear: number;
  logId: string;
}

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/** Dice cutoff for two given names to be the same name (MobWarnings' DICE_CUTOFF). */
const GIVEN_NAME_DICE = 0.66;

/** Records ruled not to be the subject: rejected links and recorded namesakes. */
function ruledOutRecordIds(research: any, subjectId: string): Set<string> {
  const rejected = new Set(
    arr(research?.rejected_links)
      .filter((r) => r?.person_id === subjectId && typeof r?.assertion_id === "string")
      .map((r) => r.assertion_id as string),
  );
  const out = new Set<string>();
  for (const a of arr(research?.assertions)) {
    if (rejected.has(a?.id) && typeof a?.record_id === "string") out.add(arkToBareId(a.record_id));
  }
  for (const n of arr(research?.namesakes)) {
    if (n?.person_id !== subjectId) continue;
    for (const id of arr(n?.record_ids)) if (typeof id === "string") out.add(arkToBareId(id));
  }
  return out;
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

/** Whether a query's given name is one of the subject's given names. */
function queryIsForSubject(query: any, subjectWords: string[]): boolean {
  return queryGivenWords(query).some((word) => subjectWords.some((s) => givenMatches(s, word)));
}

/** Every candidate the call's birth range excludes, oldest log entry first. */
export async function excludedCandidates(input: CandidateExclusionInput): Promise<ExcludedCandidate[]> {
  const { projectPath, subjectId, birthYearFrom: from, birthYearTo: to } = input;
  if (!projectPath || !subjectId) return [];
  if (typeof from !== "number" && typeof to !== "number") return [];

  let research: any;
  try {
    research = await readProjectJson(projectPath, "research.json");
  } catch {
    return [];
  }
  let tree: any;
  try {
    tree = await readProjectJson(projectPath, "tree.gedcomx.json");
  } catch {
    return [];
  }
  const subjectWords = subjectGivenWords(tree, subjectId);
  if (subjectWords.length === 0) return [];
  if (queryGivenWords(input).length > 0 && !queryIsForSubject(input, subjectWords)) return [];

  const ruledOut = ruledOutRecordIds(research, subjectId);
  const out: ExcludedCandidate[] = [];
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
      if (seen.has(id) || ruledOut.has(id) || !rowMatchesQueryGiven(row, payload.query)) continue;
      const [birthYear] = yearsIn(row.birthDate);
      if (birthYear === undefined) continue;
      const below = typeof from === "number" && birthYear < from;
      const above = typeof to === "number" && birthYear > to;
      if (!below && !above) continue;
      seen.add(id);
      out.push({
        recordId: row.recordId,
        personName: typeof row.personName === "string" ? row.personName : null,
        birthYear,
        logId: typeof entry.id === "string" ? entry.id : entry.results_ref,
      });
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
  return (
    `Refused: the birth range ${range} excludes a candidate an earlier search for ` +
    `${input.subjectId} already returned: ${named}. An empty result under this range ` +
    "could not rule that candidate out, and an indexed age can be years off. Search " +
    `again with no birth range, or with one that includes ${years}.`
  );
}

/** The refusal for `input`, or null when its birth range excludes no candidate. */
export async function candidateExclusionRefusal(input: CandidateExclusionInput): Promise<string | null> {
  const excluded = await excludedCandidates(input);
  return excluded.length === 0 ? null : candidateExclusionMessage(input, excluded);
}

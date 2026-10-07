import type { Principal } from "../auth/principal.js";
import { getProjectStore } from "../store/project-store.js";
import { scorePair } from "../utils/match-engine.js";
import { mapWithConcurrency, withRetry } from "../utils/place-resolver.js";
import { assertInsideProject, isInsideProject } from "../utils/project-io.js";
import { readStagedResults } from "../utils/results-staging.js";
import { relationshipCategory } from "../utils/relationship-category.js";
import { sourceAttachmentsTool } from "./source-attachments.js";
import { getDayRange } from "../utils/date-helpers.js";
import { stdDate } from "../utils/date-standardize.js";
import { MODIFIERS, MONTHS, normalizeAccents } from "../utils/date-constants.js";
import { gatherRelatives } from "../utils/relatives.js";
import type { SimplifiedGedcomX, SimplifiedPerson } from "../types/gedcomx.js";
import type { RecordSearchResult } from "../types/record-search.js";
import type {
  RankSearchMatchesInput,
  RankSearchMatchesResult,
  RankedMatch,
} from "../types/rank-search-matches.js";

/** Match-score fan-out concurrency (deliberately higher than same_person's
 *  conservative PAIR_CONCURRENCY=5; confirmed with the matchTwoExamples dev). */
const SCORE_CONCURRENCY = 10;
/** A subject whose every score sits at or below this floor is unresolvable. */
const DEGENERATE_FLOOR = 0.01;
/** Append-only calibration log; a `.jsonl` name stays clear of the results
 *  orphan validator (which scans results/ non-recursively for top-level *.json). */
const SCORE_LOG_REL = "results/match-scores.jsonl";

interface ScoredCandidate {
  result: RecordSearchResult;
  /** 1-based original staged position. */
  searchRank: number;
  matchScore: number | null;
  matchConfidence?: number;
  /** True only when an FS call was attempted and kept failing after retries. */
  errored: boolean;
}

export async function rankSearchMatches(
  input: RankSearchMatchesInput,
  principal: Principal,
): Promise<RankSearchMatchesResult> {
  const { projectPath, stagedResultsRef, subjectId } = input;

  // `top` is range-checked HERE, which since #2657 dropped the parameter from
  // `record_search` is the only place it is checked at all. This tool is
  // advertised in the manifest and dispatched with an unchecked cast, so a
  // caller reaches it directly. Unguarded, `scored.slice(0, input.top)` treats a
  // negative as an offset from the end: `top: -1` against 5 candidates returned
  // 4 of them and reported `returnedCount: 4`, silently dropping the last and
  // describing the truncation as the whole answer.
  if (input.top !== undefined) {
    if (!Number.isInteger(input.top) || input.top < 1) {
      throw new Error("top must be a positive integer.");
    }
  }

  // ── 1. Read the staged (or finalized) results file (read-only) ─────────────
  const results = (await readStagedResults(
    projectPath,
    stagedResultsRef,
  )) as RecordSearchResult[];

  // ── 2. Build the subject doc: tree person + the project's own evidence ─────
  const subject = await buildSubjectDoc(projectPath, subjectId);
  const subjectDoc = subject.doc;

  // Empty staged set: nothing to score, nothing to log — not an error.
  if (results.length === 0) {
    return {
      subjectId,
      scoredCount: 0,
      returnedCount: 0,
      scoringErrors: 0,
      scoreLogError: null,
      ...tooThinField(subject),
      matches: [],
    };
  }

  // ── 3. Score every candidate (bounded fan-out, retried) ────────────────────
  const scored = await mapWithConcurrency(
    results,
    SCORE_CONCURRENCY,
    async (result, index): Promise<ScoredCandidate> => {
      const searchRank = index + 1;
      // Skip candidates with no gedcomx or no primaryId: a person-less doc is a
      // certain-400 and must not burn three retries. matchScore null, no FS call.
      if (!result.gedcomx || !result.primaryId) {
        return { result, searchRank, matchScore: null, errored: false };
      }
      try {
        const res = await withRetry(() =>
          scorePair(
            result.gedcomx as SimplifiedGedcomX,
            result.primaryId as string,
            subjectDoc,
            subjectId,
            principal,
          ),
        );
        const out: ScoredCandidate = {
          result,
          searchRank,
          matchScore: res.score,
          errored: false,
        };
        if (res.confidence !== undefined) out.matchConfidence = res.confidence;
        return out;
      } catch {
        // A pair that still fails after retries is kept, never dropped.
        return { result, searchRank, matchScore: null, errored: true };
      }
    },
  );

  const scoringErrors = scored.filter((s) => s.errored).length;

  // ── 4. Rank: sort by matchScore desc, nulls last (stable) ──────────────────
  scored.sort((a, b) => {
    if (a.matchScore === null && b.matchScore === null) return 0;
    if (a.matchScore === null) return 1;
    if (b.matchScore === null) return -1;
    return b.matchScore - a.matchScore;
  });

  // ── 5. Write the full scored set to the calibration log (best-effort) ──────
  const scoreLogError = await appendScoreLog(
    projectPath,
    input,
    scored,
  );

  // No score clears the degenerate floor. Two very different situations share
  // this signature, and they need opposite responses from the caller:
  //   (a) the SUBJECT carries no dated or placed fact — the ranking is noise;
  //   (b) the subject is fine and genuinely nothing in this pool matches — a
  //       real, useful negative ("not here; page deeper or narrow").
  // Inferring from the score distribution alone conflates them. Disambiguate by
  // looking at the subject document we actually sent.
  const noSignal = !scored.some(
    (s) => s.matchScore !== null && s.matchScore > DEGENERATE_FLOOR,
  );
  const noDatedOrPlacedFact = subject.discriminatingFacts === 0;

  // ── 6+7. Build the stubs; fold in attachments if requested ────────────────
  // Every scored candidate, not a fixed top-N (#1212). `top` narrows only when
  // the caller asks for it: a host-side cap that discards rows the caller paid
  // to search and score is the caller's decision, not this tool's.
  //
  // On the STANDALONE tool this list IS the caller's view, so a row cut here is
  // one they never see. The folded `record_search` path passes no `top` at all
  // (#2657 removed the parameter there), so every scored row is annotated onto
  // `results`, which is never truncated.
  const matches: RankedMatch[] =
    input.top === undefined
      ? scored.map((s, i) => toStub(s, i + 1))
      : scored.slice(0, input.top).map((s, i) => toStub(s, i + 1));

  if (input.checkAttachments && matches.length > 0) {
    await applyAttachments(matches, subjectId, principal);
  }

  const out: RankSearchMatchesResult = {
    subjectId,
    scoredCount: scored.length,
    returnedCount: matches.length,
    scoringErrors,
    scoreLogError,
    ...tooThinField(subject),
    matches,
  };
  if (subject.enrichedFacts > 0) out.subjectEnrichedFacts = subject.enrichedFacts;
  if (subject.enrichedNames > 0) out.subjectEnrichedNames = subject.enrichedNames;

  if (noSignal && noDatedOrPlacedFact) {
    // Withhold the ranking rather than flag it. Returning a ranked-LOOKING
    // top-10 that is really search order is the silent-degradation path: the
    // caller cannot tell noise from signal, and FamilySearch's own search order
    // is known-unreliable (a live probe found the top 21 hits sharing one
    // score). Say what is missing instead, so the caller can enrich the subject
    // or narrow the query.
    out.matches = [];
    out.returnedCount = 0;
    out.subjectResolvable = false;
    out.diagnostic =
      `Subject '${subjectId}' carries no fact with a date or place, so ` +
      `FamilySearch's matcher cannot discriminate it from any same-named ` +
      `person and every candidate scored at or below ${DEGENERATE_FLOOR}. The ` +
      `ranking would be search order wearing match scores, so it is withheld. ` +
      `Give the subject at least one dated or placed fact — record it on the ` +
      `tree person, or extract and link an assertion via person_evidence — ` +
      `then rank again. Meanwhile, narrow the search (collection, place, ` +
      `date range) rather than triaging this pool by hand.`;
  } else if (noSignal) {
    // Subject is fine; the pool genuinely holds no match. That IS the finding.
    out.subjectResolvable = false;
    out.diagnostic =
      `Subject '${subjectId}' is scoreable (${subject.discriminatingFacts} ` +
      `dated/placed fact(s)), but no candidate in this pool scored above ` +
      `${DEGENERATE_FLOOR}. Treat that as a real negative for this query — ` +
      `page deeper (offset) or narrow the query; do not hand-triage the stubs.`;
  }

  // Built from `out.matches`, not `matches` — the withheld branch above empties
  // it, and a note about records that were not returned is the false
  // confirmation this field exists to prevent. Built here, after that branch,
  // so `returnedCount: 0` can never ship alongside "of the 2 matches returned".
  const relativeTermNote = buildRelativeTermNote(out.matches);
  if (relativeTermNote) out.relativeTermNote = relativeTermNote;

  return out;
}

// readStagedResults was lifted to utils/results-staging.ts so record_read's
// sidecar mode shares the exact same dual-location read (staged handle OR
// finalized results/<log_id>.json). Imported above; callers cast the elements.

// ─── Subject-doc assembly ────────────────────────────────────────────────────

/** Assertion `fact_type` (snake_case, research.json) → simplified-GedcomX fact
 *  `type` (TitleCase, tree.gedcomx.json). Types absent here are deliberately not
 *  projected onto the person: `relationship`, `marital_status` and
 *  `cause_of_death` say nothing the matcher scores a *person* on. */
const ASSERTION_FACT_TYPE_TO_TREE: Record<string, string> = {
  birth: "Birth",
  christening: "Christening",
  baptism: "Baptism",
  death: "Death",
  burial: "Burial",
  residence: "Residence",
  occupation: "Occupation",
  marriage: "Marriage",
  immigration: "Immigration",
  military_service: "MilitaryService",
};

/** First 4-digit year in a free-text assertion value ("born 1829" → "1829").
 *  Dates are the highest-signal discriminator the matcher has, so it is worth
 *  recovering one from prose when `structured_value` carries none. */
function yearFromText(text: unknown): string | undefined {
  if (typeof text !== "string") return undefined;
  const m = text.match(/\b(1[5-9]\d{2}|20\d{2})\b/);
  return m ? m[1] : undefined;
}

/** How many facts on a person discriminate one human from another with the
 *  same name — i.e. carry a date or a place. A name alone does not. Used only
 *  for the unresolvable-subject diagnostic. */
function discriminatingFactCount(person: { facts?: any[] }): number {
  return (person.facts ?? []).filter(
    (f) => f && (f.date || f.standard_date || f.place || f.standard_place),
  ).length;
}

/** A bare year spans 364 days in `getDayRange`'s 365-day calendar; any date
 *  whose span is shorter carries a month, quarter or day. */
const BARE_YEAR_SPAN_DAYS = 364;

/** Month words that are also common names or words ("May", "Gen", "Mars",
 *  "Jan", "June"): read as a month in prose only when a day number sits beside
 *  them. */
const AMBIGUOUS_MONTHS = new Set([
  "may", "mai", "mei", "mag", "gen", "mars", "jan", "june",
]);

/** `MODIFIERS` words that in prose usually mean something else: "Int." before
 *  a burial date is "interred", not "interpreted". */
const PROSE_NON_MODIFIERS = new Set(["int"]);

/** Qualifiers whose bounds a single prose date cannot carry. */
const RANGE_MODIFIERS = new Set(["Bet", "From", "To"]);

const dayToken = (t: string | undefined) => {
  const m = t?.match(/^(\d{1,2})(?:st|nd|rd|th)?$/);
  return m && Number(m[1]) >= 1 && Number(m[1]) <= 31 ? m[1] : undefined;
};
const yearToken = (t: string | undefined) =>
  t !== undefined && /^\d{4}$/.test(t) ? t : undefined;
const monthToken = (t: string | undefined) =>
  t !== undefined ? MONTHS.get(t) : undefined;

/** Day- or month-precise dates written in an assertion's prose value
 *  ("born 4 Dec 1917", "baptized March 3rd, 1850", "1917-12-04"), each with
 *  the qualifier written before it ("abt.", "before") so it is measured the
 *  way a structured date is. A date inside a written range ("between …",
 *  "4 Dec or 5 Dec 1917") is dropped, since its bounds are not recoverable. */
function datesInText(text: unknown): string[] {
  if (typeof text !== "string") return [];
  const norm = normalizeAccents(text).toLowerCase();
  const re = /[\p{L}\p{N}~<>&]+/gu;
  const tokens: string[] = [];
  // A comma or semicolon between two adjacent tokens is a clause boundary:
  // "aged 4, March 1850" is "age 4; the month March 1850", not a day-month-year.
  const commaBefore: boolean[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(norm)) !== null) {
    tokens.push(m[0]);
    commaBefore.push(/[,;]/.test(norm.slice(last, m.index)));
    last = m.index + m[0].length;
  }
  const out: string[] = [];
  const isDatePart = (t: string | undefined) =>
    t !== undefined && (/^\d/.test(t) || MONTHS.has(t));
  for (let i = 0; i < tokens.length; i++) {
    let date: string | undefined;
    let end = i;
    const [t0, t1, t2] = [tokens[i], tokens[i + 1], tokens[i + 2]];
    // A comma in the day-month gap or month-year gap breaks a Day-Month-Year
    // or Month-Year date. A comma between day and year in Month-Day-Year is
    // the US convention ("March 3, 1850") and does not break the date.
    const comma01 = commaBefore[i + 1];
    const comma12 = commaBefore[i + 2];
    if (!comma01 && !comma12 && dayToken(t0) && monthToken(t1) && yearToken(t2)) {
      date = `${dayToken(t0)} ${monthToken(t1)} ${t2}`;
      end = i + 2;
    } else if (!comma01 && monthToken(t0) && dayToken(t1) && yearToken(t2)) {
      date = `${dayToken(t1)} ${monthToken(t0)} ${t2}`;
      end = i + 2;
    } else if (!comma01 && !comma12 && yearToken(t0) && /^\d{1,2}$/.test(t1 ?? "") && /^\d{1,2}$/.test(t2 ?? "")
        && Number(t1) >= 1 && Number(t1) <= 12) {
      date = `+${t0}-${t1!.padStart(2, "0")}-${t2!.padStart(2, "0")}`;
      end = i + 2;
    } else if (!comma01 && monthToken(t0) && !AMBIGUOUS_MONTHS.has(t0) && yearToken(t1)
        && !dayToken(tokens[i - 1])) {
      date = `${monthToken(t0)} ${t1}`;
      end = i + 1;
    }
    if (!date) continue;
    const prevWord = tokens[i - 1] ?? "";
    const prev = PROSE_NON_MODIFIERS.has(prevWord) ? undefined : MODIFIERS.get(prevWord);
    const next = MODIFIERS.get(tokens[end + 1] ?? "");
    const inRange =
      (prev !== undefined && RANGE_MODIFIERS.has(prev)) ||
      ((prev === "and" || prev === "or" || prev === "To") && isDatePart(tokens[i - 2])) ||
      ((next === "and" || next === "or" || next === "To") && isDatePart(tokens[end + 2]));
    if (!inRange) out.push(prev && prev !== "and" && prev !== "or" ? `${prev} ${date}` : date);
    i = end;
  }
  return out;
}

/** GedcomX formal forms `stdDate` reads too generously or not at all:
 *  an open range ("/+1917-12-04", "+1917-12-04/") is unbounded on one side, so
 *  it becomes Bef/Aft; a closed range ("+A/+B") becomes "Bet A and B". */
function formalRangeAsQualified(raw: string): string {
  const t = raw.trim();
  const parts = t.split("/");
  if (parts.length !== 2 || !/^[+-]\d/.test(parts[0] || parts[1])) return t;
  const [a, b] = parts;
  if (!a) return `Bef ${b}`;
  if (!b) return `Aft ${a}`;
  const [sa, sb] = [stdDate(a), stdDate(b)];
  return sa && sb ? `Bet ${sa} and ${sb}` : t;
}

/** Day span of a date string, or null when it does not parse. An alternative
 *  ("Dec 1917 or Jan 1918") spans both sides. */
function dateSpanDays(raw: string): number | null {
  const range = getDayRange(stdDate(formalRangeAsQualified(raw)));
  if (range) return range.max - range.min;
  const sides = raw.split(/\s+or\s+/i);
  if (sides.length < 2) return null;
  const ranges = sides.map((x) => getDayRange(stdDate(x)));
  if (ranges.some((r) => r === null)) return null;
  return Math.max(...ranges.map((r) => r!.max)) - Math.min(...ranges.map((r) => r!.min));
}

/** True when `raw` is a date more specific than a year. Precision is the
 *  date's day span, so qualified years ("Abt 1829", "Bef 1855",
 *  "Bet 1917 and 1918") count as year-level or wider, and an unparseable date
 *  counts as no date. */
function isDateNarrowerThanYear(raw: unknown): boolean {
  if (typeof raw !== "string" || !raw.trim()) return false;
  const span = dateSpanDays(raw);
  return span !== null && span < BARE_YEAR_SPAN_DAYS;
}

/** True when at least one fact carries a date more specific than a year, in
 *  either its `standard_date` or its `date`. */
function hasDateNarrowerThanYear(facts: any[]): boolean {
  return facts.some(
    (f) => isDateNarrowerThanYear(f?.standard_date) || isDateNarrowerThanYear(f?.date),
  );
}

/** An assertion's `date_certainty` as the qualifier `stdDate` reads. */
const CERTAINTY_MODIFIER: Record<string, string> = {
  approximate: "Abt", estimated: "Est", calculated: "Cal",
  before: "Bef", after: "Aft", between: "Bet",
};

/** A date string prefixed with its assertion's `date_certainty` qualifier.
 *  Applied to EVERY date read off an assertion — the top-level `date`,
 *  `structured_value.date`, and each prose date — so a weakly-dated assertion
 *  does not clear the thinness flag through its back door. */
function qualifyDate(date: unknown, cert: unknown): unknown {
  if (typeof date !== "string") return date;
  const mod = typeof cert === "string" && Object.hasOwn(CERTAINTY_MODIFIER, cert)
    ? CERTAINTY_MODIFIER[cert]
    : undefined;
  return mod ? `${mod} ${date}` : date;
}

/** An assertion's top-level `date`, qualified by its `date_certainty`. */
function certainDate(a: any): unknown {
  return qualifyDate(a?.date, a?.date_certainty);
}

/** Given-name words that record a missing name rather than a name, compared
 *  after lower-casing and dropping dots ("N. N." → "nn"). "Unnamed" is the
 *  tree-edit convention here; "ignoto"/"ignota" are the Italian form. */
const PLACEHOLDER_GIVEN = new Set([
  "unknown", "unk", "unkn", "nn", "fnu", "lnu", "living", "private",
  "mr", "mrs", "miss", "ms", "infant", "baby", "child", "stillborn",
  "son", "daughter", "wife", "husband", "boy", "girl", "male", "female",
  "unnamed", "ignoto", "ignota",
]);

/** A given name is real when, with dots and brackets dropped, neither the whole
 *  name ("N. N.", "[Unknown]") nor every word of it ("Infant Son") is a
 *  placeholder — AND, when `selfGiven` is passed, what remains after dropping
 *  placeholder words is not the subject's own given name ("Mrs. Ugo" is a
 *  spouse placeholder when the subject is Ugo). */
function isRealGivenName(given: unknown, selfGiven?: Set<string>): boolean {
  if (typeof given !== "string") return false;
  const words = given.toLowerCase().replace(/[.[\]]/g, " ").split(/\s+/).filter(Boolean);
  if (PLACEHOLDER_GIVEN.has(words.join(""))) return false;
  const realWords = words.filter((w) => /\p{L}/u.test(w) && !PLACEHOLDER_GIVEN.has(w));
  if (realWords.length === 0) return false;
  if (selfGiven && selfGiven.has(realWords.join(" "))) return false;
  return true;
}

/** A full name's given part is every word before the last, so "Blyeberg"
 *  alone is a surname-only stub with no given name. A trailing generational
 *  suffix is NOT the surname — "Junior" in "Ugo Stella Junior" — so it is
 *  stripped first; otherwise "Junior" would masquerade as the surname and
 *  "Ugo Stella" would read as a real given name regardless of the subject. */
function fullNameHasRealGiven(name: unknown, selfGiven?: Set<string>): boolean {
  if (typeof name !== "string") return false;
  const words = name.trim().split(/\s+/);
  while (words.length > 1 && GENERATIONAL_SUFFIXES.has(words[words.length - 1].toLowerCase().replace(/\./g, ""))) {
    words.pop();
  }
  return isRealGivenName(words.slice(0, -1).join(" "), selfGiven);
}

/** A relative separates namesakes only through a real given name: a
 *  surname-only stub repeats what the subject's own name already says. */
function hasRealGivenName(person: SimplifiedPerson, selfGiven?: Set<string>): boolean {
  const names = Array.isArray(person?.names) ? person.names : [];
  return names.some((n) => isRealGivenName((n as any)?.given, selfGiven));
}

/** True when the tree records a spouse, parent or child of `subjectId` with a
 *  real given name. */
function hasNamedRelative(
  tree: SimplifiedGedcomX,
  subjectId: string,
  selfGiven: Set<string>,
): boolean {
  const { parent, spouse, child } = gatherRelatives(tree, subjectId);
  return [...parent, ...spouse, ...child].some((p) => hasRealGivenName(p, selfGiven));
}

/** Generational suffixes that attach to a full name without identifying a
 *  separate person — "Ugo Stella Junior" is the subject Ugo Stella, not a son
 *  of his, so the subject-own check must see through them. */
const GENERATIONAL_SUFFIXES = new Set([
  "jr", "junior", "sr", "senior", "ii", "iii", "iv",
]);

/** Named-relative relationship types reach the subject through a parent,
 *  spouse or child — not a sibling, uncle or godparent. Not a hand-list:
 *  `research-append.ts` already maps every role word to a category, and the
 *  types that are not role words (`parent_child`/`ParentChild`, `couple`,
 *  `step_*`) are added here. */
const EXTRA_NEAR_TYPES = new Set([
  "parent_child", "parentchild", "couple",
  "step_parent", "step_mother", "step_father",
  "step_son", "step_daughter", "step_child",
]);

function isNearRelationshipType(rel: unknown): boolean {
  if (typeof rel !== "string") return false;
  const t = rel.toLowerCase().trim().replace(/_inferred$/, "");
  if (EXTRA_NEAR_TYPES.has(t)) return true;
  const cat = relationshipCategory(t);
  return cat === "parent" || cat === "child" || cat === "spouse";
}

/** Structured-value keys that carry a relative's full name. */
const RELATIVE_NAME_KEYS = ["related_person_name", "father", "mother", "spouse"];

/** The name after "<role> of" in the extraction house form, as capitalized or
 *  bracketed words ("child of Dorothea [Gajdosch]"). */
const OF_NAME = /\bof\s+((?:\[?\p{Lu}[\p{L}'.-]*\]?\s*)+)/u;

const nameKey = (x: unknown) =>
  typeof x === "string"
    ? normalizeAccents(x).toLowerCase().replace(/[.[\]]/g, " ").split(/\s+/).filter(Boolean).join(" ")
    : "";

/** The subject's own names, so an assertion linked to both parties of a
 *  relationship does not count the subject as their own relative: "child of
 *  Thomas Flynn" is linked to Thomas too. */
interface SubjectNames {
  given: Set<string>;
  full: Set<string>;
}

function subjectNames(names: unknown): SubjectNames {
  const out: SubjectNames = { given: new Set(), full: new Set() };
  for (const n of Array.isArray(names) ? names : []) {
    const given = nameKey((n as any)?.given);
    if (!given) continue;
    out.given.add(given);
    const surname = nameKey((n as any)?.surname);
    if (surname) out.full.add(`${given} ${surname}`);
  }
  return out;
}

/** The full-name key with any trailing generational suffix tokens removed, so
 *  "Ugo Stella Junior" compares equal to the subject's own "Ugo Stella". */
function stripGenerationalSuffix(key: string): string {
  const words = key.split(" ").filter(Boolean);
  while (words.length > 0 && GENERATIONAL_SUFFIXES.has(words[words.length - 1])) {
    words.pop();
  }
  return words.join(" ");
}

/** True when a full name ("Given … Surname") names someone other than the
 *  subject with a real given name. */
function namesOther(name: unknown, self: SubjectNames): boolean {
  if (!fullNameHasRealGiven(name, self.given)) return false;
  const key = nameKey(name);
  if (self.full.has(key)) return false;
  if (self.full.has(stripGenerationalSuffix(key))) return false;
  return true;
}

/** True when a research.json assertion linked to the subject names a spouse,
 *  parent or child other than the subject with a real given name — a
 *  marriage's `spouse_given`, or a parent/spouse/child relationship through a
 *  structured name key or a value in the house form "<role> of <Given>
 *  <Surname>". The tree lags the evidence, so a relative the project knows of
 *  may not be a tree person yet. */
function assertionNamesRelative(a: any, self: SubjectNames): boolean {
  const sv = a?.structured_value;
  if (typeof sv !== "object" || sv === null) return false;
  if (a?.fact_type === "marriage") {
    return (
      (isRealGivenName(sv.spouse_given, self.given) && !self.given.has(nameKey(sv.spouse_given))) ||
      namesOther(sv.spouse, self)
    );
  }
  if (a?.fact_type !== "relationship") return false;
  if (!isNearRelationshipType(sv.relationship_type)) return false;
  if (RELATIVE_NAME_KEYS.some((k) => namesOther(sv[k], self))) return true;
  const m = typeof a?.value === "string" ? a.value.match(OF_NAME) : null;
  return m !== null && namesOther(m[1], self);
}

/** The assertions a live `person_evidence` row links to the subject.
 *  Superseded links and negative evidence ("not found in …") say nothing about
 *  this person — a superseded link is usually one already shown to belong to a
 *  namesake. */
function liveLinkedAssertions(research: any, subjectId: string): any[] {
  const peList = Array.isArray(research?.person_evidence) ? research.person_evidence : [];
  const linkedIds = new Set(
    peList
      .filter((pe: any) => pe?.person_id === subjectId && pe?.superseded_by == null)
      .map((pe: any) => pe.assertion_id),
  );
  const all = Array.isArray(research?.assertions) ? research.assertions : [];
  return all.filter(
    (a: any) =>
      linkedIds.has(a?.id) && a?.record_basis !== "absent",
  );
}

/** The narrow-date and named-relative evidence the subject's live linked
 *  assertions carry. Each assertion is read on its own, so one malformed entry
 *  cannot hide the rest. */
function linkedEvidence(
  research: any,
  subjectId: string,
  names: unknown,
): { narrowDate: boolean; namedRelative: boolean } {
  const out = { narrowDate: false, namedRelative: false };
  const self = subjectNames(names);
  for (const a of liveLinkedAssertions(research, subjectId)) {
    try {
      const cert = a?.date_certainty;
      // A relationship value routinely carries another person's date
      // ("son of Mario (d. 4 Dec 1890)") — it is not the subject's, so prose
      // dates on a relationship assertion say nothing about the subject.
      const prose = a?.fact_type === "relationship" ? [] : datesInText(a?.value);
      const dates = [
        certainDate(a),
        qualifyDate(a?.structured_value?.date, cert),
        ...prose.map((d) => qualifyDate(d, cert)),
      ];
      if (dates.some(isDateNarrowerThanYear)) out.narrowDate = true;
      if (assertionNamesRelative(a, self)) out.namedRelative = true;
    } catch {
      // A malformed assertion contributes nothing; the others still count.
    }
  }
  return out;
}

/** Facts on the subject's own Couple and ParentChild relationships — a
 *  marriage date separates namesakes even when the spouse is unnamed. */
function subjectRelationshipFacts(
  tree: SimplifiedGedcomX,
  subjectId: string,
): any[] {
  return (tree.relationships ?? [])
    .filter((r) => [r.person1, r.person2, r.parent, r.child].includes(subjectId))
    .flatMap((r) => (Array.isArray(r.facts) ? r.facts : []));
}

/** The tree with non-object person and relationship entries dropped, so the
 *  relative walk cannot throw on a hand-edited or legacy file. */
function wellFormedTree(tree: SimplifiedGedcomX): SimplifiedGedcomX {
  const isObj = (x: unknown) => typeof x === "object" && x !== null;
  return {
    ...tree,
    persons: (Array.isArray(tree.persons) ? tree.persons : []).filter(isObj),
    relationships: (Array.isArray(tree.relationships) ? tree.relationships : []).filter(isObj),
  };
}

/** The response's `subjectTooThin` field: present only when true. */
function tooThinField(subject: SubjectDoc): { subjectTooThin?: true } {
  return subject.subjectTooThin ? { subjectTooThin: true } : {};
}

interface SubjectDoc {
  doc: SimplifiedGedcomX;
  /** Facts carrying a date or place, after enrichment. */
  discriminatingFacts: number;
  /** How many facts enrichment contributed on top of the bare tree person. */
  enrichedFacts: number;
  /** How many alternate names enrichment contributed. Counted separately
   *  because it is NOT a rounding error: in the probe run behind this design,
   *  every assertion linked to the subject was a name variant ("James L.",
   *  "J.L."), which added zero facts and still lifted the top candidate 5.9×
   *  (0.0082 → 0.0482). A facts-only counter reports 0 here and reads as "did
   *  nothing", which is wrong. */
  enrichedNames: number;
  /** True when enrichment supplied a gender the tree person lacked. */
  enrichedGender: boolean;
  /** #2811: true when the subject has no date narrower than a year AND no named
   *  spouse, parent or child — nothing that separates this person from any
   *  same-named individual. Independent of `discriminatingFacts` (a city-only
   *  residence has a place but no narrow date and no relative). */
  subjectTooThin: boolean;
}

// Exported for dev/probe-rank-enrichment.ts, which A/Bs the enriched subject
// against the bare tree person on live FamilySearch scores.
export async function buildSubjectDoc(
  projectPath: string,
  subjectId: string,
): Promise<SubjectDoc> {
  let tree: SimplifiedGedcomX;
  try {
    tree = JSON.parse(await getProjectStore().readText(projectPath, "tree.gedcomx.json"));
  } catch {
    throw new Error(
      `Could not read tree.gedcomx.json in project '${projectPath}'. ` +
        `rank_search_matches needs the project tree to build the subject document.`,
    );
  }

  const subject = (tree.persons ?? []).find((p) => p.id === subjectId);
  if (!subject) {
    throw new Error(
      `subjectId '${subjectId}' not found in tree.gedcomx.json. ` +
        `Pass a persons[].id that exists in the project tree.`,
    );
  }

  // FamilySearch's matcher is excellent when both documents carry information
  // and near-random when either is starved — and the tree person is routinely a
  // local `I*` stub with `ark: null` and one or two facts, which scores
  // uniformly near-zero against every candidate. The candidate side we cannot
  // change; this side we can. The project already holds far more about this
  // human than the tree person does (assertions extracted from records, linked
  // to the person through person_evidence), so fold that in before scoring.
  //
  // Enrichment is additive and best-effort: a missing or malformed research.json
  // degrades to the bare tree person (the previous behavior), never an error.
  const enriched = JSON.parse(JSON.stringify(subject)) as typeof subject & {
    names?: any[];
    facts?: any[];
    gender?: string;
  };
  const before = (enriched.facts ?? []).length;
  const namesBefore = (enriched.names ?? []).length;
  const hadGender = Boolean(enriched.gender);
  let research: any = null;
  try {
    research = JSON.parse(await getProjectStore().readText(projectPath, "research.json"));
  } catch {
    // No research.json or unreadable — the bare tree person stands alone.
  }

  try {
    const assertions = liveLinkedAssertions(research, subjectId);

    // Dedupe against what the tree already says, so enrichment never restates
    // a fact the subject carries (which would weight it twice).
    const existing = new Set(
      (enriched.facts ?? []).map((f: any) =>
        JSON.stringify([f?.type, f?.date ?? null, f?.place ?? null]),
      ),
    );
    const existingNames = new Set(
      (enriched.names ?? []).map((n: any) =>
        JSON.stringify([n?.given ?? null, n?.surname ?? null]),
      ),
    );

    for (const a of assertions) {
      const sv = a?.structured_value ?? {};

      if (a?.fact_type === "name") {
        const given = sv.given ?? undefined;
        const surname = sv.surname ?? undefined;
        if (!given && !surname) continue;
        const key = JSON.stringify([given ?? null, surname ?? null]);
        if (existingNames.has(key)) continue;
        existingNames.add(key);
        (enriched.names ??= []).push({ given, surname, type: "AlsoKnownAs" });
        continue;
      }

      if (a?.fact_type === "sex" && !enriched.gender) {
        const v = String(a.value ?? "").trim().toLowerCase();
        if (v === "male" || v === "female") {
          enriched.gender = v === "male" ? "Male" : "Female";
        }
        continue;
      }

      // hasOwn, not a bare index: `fact_type` is an OPEN enum, so a schema-valid
      // assertion can carry any string — including `constructor`, which indexes
      // out `Object` and sails past `!treeType` (a function is truthy), pushing a
      // fact whose `type` disappears on serialization.
      const treeType = Object.hasOwn(ASSERTION_FACT_TYPE_TO_TREE, a?.fact_type)
        ? ASSERTION_FACT_TYPE_TO_TREE[a.fact_type]
        : undefined;
      if (!treeType) continue;

      const rawDate = sv.date ?? sv.year ?? yearFromText(a?.value);
      // The subject's enriched facts flow back into the thinness check, so an
      // "Abt 1871-03" assertion must materialize qualified — not as a bare
      // day-precise fact that would clear the flag through its back door.
      const date = qualifyDate(rawDate, a?.date_certainty);
      const place = sv.place ?? undefined;
      if (!date && !place) continue; // nothing that discriminates — skip

      const key = JSON.stringify([treeType, date ?? null, place ?? null]);
      if (existing.has(key)) continue;
      existing.add(key);

      const fact: Record<string, unknown> = { type: treeType };
      if (date) fact.date = String(date);
      if (place) fact.place = String(place);
      (enriched.facts ??= []).push(fact);
    }
  } catch {
    // No research.json, unreadable, or an unexpected shape — fall back to the
    // bare tree person rather than failing the whole ranking call.
  }

  // The mint-hardening in match-engine synthesizes a conforming Persistent id
  // for the ark-less subject, so scoring stays deterministic.
  // #2811: a subject is "too thin" when it has no date narrower than a year AND
  // no named relative — nothing that separates it from any same-named person.
  let tooThin: boolean;
  try {
    const safeTree = wellFormedTree(tree);
    const self = subjectNames(enriched.names);
    const evidence = linkedEvidence(research, subjectId, enriched.names);
    tooThin =
      !hasDateNarrowerThanYear([
        ...(Array.isArray(enriched.facts) ? enriched.facts : []),
        ...subjectRelationshipFacts(safeTree, subjectId),
      ]) &&
      !evidence.narrowDate &&
      !evidence.namedRelative &&
      !hasNamedRelative(safeTree, subjectId, self.given);
  } catch {
    // An advisory flag never fails the ranking; unflagged is the prior behavior.
    tooThin = false;
  }

  return {
    doc: { persons: [enriched] },
    discriminatingFacts: discriminatingFactCount(enriched),
    enrichedFacts: (enriched.facts ?? []).length - before,
    enrichedNames: (enriched.names ?? []).length - namesBefore,
    enrichedGender: Boolean(enriched.gender) && !hadGender,
    subjectTooThin: tooThin,
  };
}

// ─── Stub projection ─────────────────────────────────────────────────────────

/**
 * Say, in words, that some of these high-scoring matches do not carry the
 * relative the search was anchored on.
 *
 * The score cannot say it. `matchScore` measures name/date/place agreement
 * between the subject and the candidate; it never looks at whether the record
 * names the father you searched for. So a record that is merely *consistent*
 * with William — because FamilySearch keeps records that do not contradict him
 * — can outrank one that actually names him, and arrive at the top of the list
 * looking like the best-evidenced hit on the page. That is the exact confusion
 * `relativeTerms` exists to remove, and it is worst here.
 *
 * Counts only `absent`, never `unknown`: "we could not tell" is not a finding
 * to warn about, and warning on it would train the caller to ignore the note.
 */
function buildRelativeTermNote(matches: RankedMatch[]): string | undefined {
  const absentByPrefix = new Map<string, number>();
  for (const m of matches) {
    for (const [prefix, finding] of Object.entries(m.relativeTerms ?? {})) {
      if (finding.status === "absent") {
        absentByPrefix.set(prefix, (absentByPrefix.get(prefix) ?? 0) + 1);
      }
    }
  }
  if (absentByPrefix.size === 0) return undefined;

  const parts = [...absentByPrefix.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([prefix, n]) => `${n} name no ${prefix}`);
  return (
    `Of the ${matches.length} matches returned, ${parts.join(", ")} ` +
    `(\`relativeTerms\`). The match score does not account for this — it ` +
    `measures name, date and place agreement only. Those records are ` +
    `CONSISTENT with the relative you searched for, not evidence of them, so ` +
    `do not write them up as confirming the relationship.`
  );
}

function toStub(s: ScoredCandidate, matchRank: number): RankedMatch {
  const r = s.result;
  const stub: RankedMatch = {
    matchRank,
    searchRank: s.searchRank,
    recordId: r.recordId,
    matchScore: s.matchScore,
  };
  if (r.primaryId) stub.primaryId = r.primaryId;
  if (r.personName) stub.personName = r.personName;
  if (r.sex) stub.sex = r.sex;
  if (r.birthDate) stub.birthDate = r.birthDate;
  if (r.birthPlace) stub.birthPlace = r.birthPlace;
  if (r.deathDate) stub.deathDate = r.deathDate;
  if (r.deathPlace) stub.deathPlace = r.deathPlace;
  if (r.collectionTitle) stub.collectionTitle = r.collectionTitle;
  if (r.recordArk) stub.recordArk = r.recordArk;
  // Carried through, not recomputed: the staged row already holds the answer and
  // the ranker has no business re-deriving it. Without this the top-ranked stub
  // is exactly where a "father absent" hit looks most confirmed (#1324).
  if (r.relativeTerms) stub.relativeTerms = r.relativeTerms;
  // Same carry-through, same reason: the staged row holds it and the ranker has
  // nothing to add. Unlike `relativeTerms` this gets no advisory note — a batch
  // number is a lookup key for the next search, not a caveat on this score.
  if (r.batchNumber) stub.batchNumber = r.batchNumber;
  // `events`, `collectionId`, `recordTitle` and `treeMatches` are NOT carried.
  // They were added only so the stub could stand in for the search row while
  // `ranked` replaced `results`. Under the #1212 ruling the row IS the row —
  // annotated in place — so duplicating its fields onto the stub is the
  // duplication the ruling removed. FamilySearch's `score`/`confidence` are
  // likewise not carried: `matchScore` supersedes them.
  if (s.matchConfidence !== undefined) stub.matchConfidence = s.matchConfidence;
  // Candidate-side thinness — reported alongside the score so a caller can see
  // that a 0.09 on a dateless stub and a 0.09 on a rich record mean different
  // things. Counted off the staged row's own fields (the sidecar keeps them).
  const evented = (r.events ?? []).filter((e) => e && (e.date || e.place)).length;
  stub.candidateFactCount =
    evented + (r.birthDate || r.birthPlace ? 1 : 0) + (r.deathDate || r.deathPlace ? 1 : 0);
  return stub;
}

// ─── Calibration score log (append-only, best-effort) ────────────────────────

async function appendScoreLog(
  projectPath: string,
  input: RankSearchMatchesInput,
  scored: ScoredCandidate[],
): Promise<string | null> {
  // One JSON line per scored candidate (ALL of them, not just the returned top).
  const performed = new Date().toISOString();
  const body = scored
    .map((s, i) => {
      const r = s.result;
      const line = {
        performed,
        subject_id: input.subjectId,
        staged_results_ref: input.stagedResultsRef,
        search_rank: s.searchRank,
        match_rank: i + 1,
        // Verbatim ARK — the calibration join arkToBareId-normalizes both sides,
        // so do NOT pre-normalize/shorten here.
        record_id: r.recordId,
        person_name: r.personName ?? null,
        birth_date: r.birthDate ?? null,
        death_date: r.deathDate ?? null,
        collection_title: r.collectionTitle ?? null,
        match_score: s.matchScore,
        match_confidence: s.matchConfidence ?? null,
      };
      return JSON.stringify(line) + "\n";
    })
    .join("");

  try {
    await getProjectStore().appendText(projectPath, SCORE_LOG_REL, body);
    return null;
  } catch (error) {
    // Best-effort: a score-log write failure never fails a successful rank call.
    return error instanceof Error ? error.message : String(error);
  }
}

// ─── Attachments (optional) ──────────────────────────────────────────────────

async function applyAttachments(
  matches: RankedMatch[],
  subjectId: string,
  principal: Principal,
): Promise<void> {
  const uris = matches.map((m) => m.recordId);
  try {
    const att = await sourceAttachmentsTool({ uris }, principal);
    for (const stub of matches) {
      const persons = att.attachments[stub.recordId] ?? [];
      // subjectId is the tree person's FamilySearch PID; source_attachments
      // keys attached persons by entity PID, so match on it directly.
      stub.attachedToSubject = persons.some((p) => p.personId === subjectId);
      stub.attachedToOther = persons.some((p) => p.personId !== subjectId);
    }
  } catch {
    // Best-effort: an attachments failure must not fail the rank. Leave the
    // attachedTo* fields unset rather than asserting a wrong answer.
  }
}

// ─── MCP schema ──────────────────────────────────────────────────────────────

export const rankSearchMatchesSchema = {
  name: "rank_search_matches",
  description:
    "Re-rank a staged `record_search` result set by MATCH SCORE against a tree " +
    "subject, replacing FamilySearch's unreliable search ranker with its " +
    "authoritative person matcher. Reads the host-side staged results (from a " +
    "`record_search` that returned a `staged.resultsRef`), scores every " +
    "candidate against the subject person, and returns every scored candidate " +
    "sorted by match score — no bulk gedcomx crosses the wire. Treat the result " +
    "as a REVIEW SURFACE (confirm with role/age cross-checks), not an " +
    "accept/reject. When `subjectResolvable` is false, READ THE `diagnostic` " +
    "FIELD — it means one of two opposite things. Either the subject carries no " +
    "dated or placed fact, so the scores are noise and `matches` is withheld " +
    "deliberately (give the subject a dated/placed fact, or narrow the query — " +
    "do NOT hand-triage the stubs, and do NOT re-score with `same_person` " +
    "against that same subject, which fails identically); or the subject is " +
    "fine and nothing in this pool matched, which is a real negative worth " +
    "acting on (page deeper or narrow). Most searches are ranked for you by " +
    "`record_search` itself when you pass it a `subjectId` — call this tool " +
    "directly only to re-rank a finalized `results/<log_id>.json` or to rank " +
    "against a different subject than the one searched for. Requires " +
    "authentication — call the login tool first if not logged in.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectPath: {
        type: "string",
        description: "Absolute path to the active project directory.",
      },
      stagedResultsRef: {
        type: "string",
        description:
          "The `staged.resultsRef` handle returned by `record_search` " +
          "(e.g. 'results/.staging/<uuid>.json'). A finalized " +
          "'results/<log_id>.json' ref is also accepted.",
      },
      subjectId: {
        type: "string",
        description:
          "A `persons[].id` in the project's tree.gedcomx.json — the research " +
          "subject to match every staged candidate against.",
      },
      top: {
        type: "number",
        description:
          "Optional cap on how many top-ranked stubs to return. Omit to get " +
          "every scored candidate, which is the default. A fixed count, not a " +
          "score threshold. " +
          "There is ONE row list: `matches` comes back annotated with the match score and ordered best first, so `top` shortens that list from the bottom — the rows it cuts are the worst-scoring ones, not a second hidden copy.",
      },
      checkAttachments: {
        type: "boolean",
        description:
          "Default false. When true, fold one batch source_attachments call in " +
          "to set `attachedToSubject` / `attachedToOther` on the returned stubs.",
      },
    },
    required: ["projectPath", "stagedResultsRef", "subjectId"],
    additionalProperties: false,
  },
};

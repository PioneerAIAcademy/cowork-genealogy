import { readFile, appendFile, mkdir } from "fs/promises";
import { join, resolve, dirname } from "path";
import { getValidToken } from "../auth/refresh.js";
import { scorePair } from "../utils/match-engine.js";
import { mapWithConcurrency, withRetry } from "../utils/place-resolver.js";
import { assertInsideProject, isInsideProject } from "../utils/project-io.js";
import { readStagedResults } from "../utils/results-staging.js";
import { sourceAttachmentsTool } from "./source-attachments.js";
import type { SimplifiedGedcomX } from "../types/gedcomx.js";
import type { RecordSearchResult } from "../types/record-search.js";
import type {
  RankSearchMatchesInput,
  RankSearchMatchesResult,
  RankedMatch,
} from "../types/rank-search-matches.js";

/** Match-score fan-out concurrency (deliberately higher than same_person's
 *  conservative PAIR_CONCURRENCY=5; confirmed with the matchTwoExamples dev). */
const SCORE_CONCURRENCY = 10;
/** Default number of top-ranked stubs returned. */
const DEFAULT_TOP = 10;
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
): Promise<RankSearchMatchesResult> {
  const { projectPath, stagedResultsRef, subjectId } = input;

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
      matches: [],
    };
  }

  // ── 3. Score every candidate (one token, bounded fan-out, retried) ─────────
  const token = await getValidToken();
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
            token,
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
  //   (a) the SUBJECT is too thin to score — the ranking is noise;
  //   (b) the subject is fine and genuinely nothing in this pool matches — a
  //       real, useful negative ("not here; page deeper or narrow").
  // Inferring from the score distribution alone conflates them. Disambiguate by
  // looking at the subject document we actually sent.
  const noSignal = !scored.some(
    (s) => s.matchScore !== null && s.matchScore > DEGENERATE_FLOOR,
  );
  const subjectTooThin = subject.discriminatingFacts === 0;

  // ── 6+7. Build the top-`top` stubs; fold in attachments if requested ───────
  const top = input.top ?? DEFAULT_TOP;
  const matches: RankedMatch[] = scored
    .slice(0, top)
    .map((s, i) => toStub(s, i + 1));

  if (input.checkAttachments && matches.length > 0) {
    await applyAttachments(matches, subjectId);
  }

  const out: RankSearchMatchesResult = {
    subjectId,
    scoredCount: scored.length,
    returnedCount: matches.length,
    scoringErrors,
    scoreLogError,
    matches,
  };
  if (subject.enrichedFacts > 0) out.subjectEnrichedFacts = subject.enrichedFacts;
  if (subject.enrichedNames > 0) out.subjectEnrichedNames = subject.enrichedNames;

  if (noSignal && subjectTooThin) {
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
}

// Exported for dev/probe-rank-enrichment.ts, which A/Bs the enriched subject
// against the bare tree person on live FamilySearch scores.
export async function buildSubjectDoc(
  projectPath: string,
  subjectId: string,
): Promise<SubjectDoc> {
  const treePath = join(projectPath, "tree.gedcomx.json");
  let tree: SimplifiedGedcomX;
  try {
    tree = JSON.parse(await readFile(treePath, "utf-8"));
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

  try {
    const research = JSON.parse(
      await readFile(join(projectPath, "research.json"), "utf-8"),
    );
    const linkedIds = new Set(
      (research.person_evidence ?? [])
        .filter((pe: any) => pe?.person_id === subjectId)
        .map((pe: any) => pe.assertion_id),
    );
    const assertions = (research.assertions ?? []).filter((a: any) =>
      linkedIds.has(a?.id),
    );

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

      const treeType = ASSERTION_FACT_TYPE_TO_TREE[a?.fact_type];
      if (!treeType) continue;

      const date = sv.date ?? sv.year ?? yearFromText(a?.value);
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
  return {
    doc: { persons: [enriched] },
    discriminatingFacts: discriminatingFactCount(enriched),
    enrichedFacts: (enriched.facts ?? []).length - before,
    enrichedNames: (enriched.names ?? []).length - namesBefore,
    enrichedGender: Boolean(enriched.gender) && !hadGender,
  };
}

// ─── Stub projection ─────────────────────────────────────────────────────────

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
    await mkdir(join(projectPath, "results"), { recursive: true });
    await appendFile(join(projectPath, SCORE_LOG_REL), body, "utf-8");
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
): Promise<void> {
  const uris = matches.map((m) => m.recordId);
  try {
    const att = await sourceAttachmentsTool({ uris });
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
    "candidate against the subject person, and returns the top-N compact stubs " +
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
          "How many top-ranked stubs to return. Default 10. A fixed count, not " +
          "a score threshold.",
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

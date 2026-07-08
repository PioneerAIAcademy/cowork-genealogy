import { readFile, appendFile, mkdir } from "fs/promises";
import { join, resolve, dirname } from "path";
import { getValidToken } from "../auth/refresh.js";
import { scorePair } from "../utils/match-engine.js";
import { mapWithConcurrency, withRetry } from "../utils/place-resolver.js";
import { assertInsideProject, isInsideProject } from "../utils/project-io.js";
import { STAGING_SUBDIR } from "../utils/results-staging.js";
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
  const results = await readStagedResults(projectPath, stagedResultsRef);

  // ── 2. Build the subject doc from tree.gedcomx.json ────────────────────────
  const subjectDoc = await buildSubjectDoc(projectPath, subjectId);

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

  // Thin / unresolvable subject: no score clears the degenerate floor.
  const subjectResolvable = scored.some(
    (s) => s.matchScore !== null && s.matchScore > DEGENERATE_FLOOR,
  );

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
  if (!subjectResolvable) out.subjectResolvable = false;
  return out;
}

// ─── Staged-file read (dual-location, read-only) ─────────────────────────────

async function readStagedResults(
  projectPath: string,
  stagedResultsRef: string,
): Promise<RecordSearchResult[]> {
  // Traversal guard, then require EITHER a staged handle under results/.staging/
  // OR a finalized top-level results/<log_id>.json sidecar. Looser than
  // finalizeStagedResults (which hard-rejects anything outside .staging/); we
  // reuse assertInsideProject but write the dual-location check here and never
  // call finalize's guard.
  const abs = assertInsideProject(projectPath, stagedResultsRef);
  const stagingDir = join(projectPath, STAGING_SUBDIR);
  const resultsDir = resolve(projectPath, "results");
  const underStaging = isInsideProject(stagingDir, abs);
  const topLevelSidecar =
    dirname(abs) === resultsDir && abs.endsWith(".json");
  if (!underStaging && !topLevelSidecar) {
    throw new Error(
      `stagedResultsRef '${stagedResultsRef}' must be a staged handle under ` +
        `${STAGING_SUBDIR}/ or a finalized results/<log_id>.json sidecar.`,
    );
  }

  // Read-only; NEVER unlink (so research_log_append can still finalize a staged
  // handle after ranking).
  let envelope: { payload?: { results?: unknown[] } };
  try {
    envelope = JSON.parse(await readFile(abs, "utf-8"));
  } catch {
    throw new Error(
      `stagedResultsRef '${stagedResultsRef}' does not exist or is invalid JSON.`,
    );
  }

  // Both envelope shapes expose payload.results (staged and finalized sidecar).
  const results = envelope?.payload?.results;
  if (!Array.isArray(results)) {
    throw new Error(
      `stagedResultsRef '${stagedResultsRef}' envelope has no payload.results array.`,
    );
  }
  return results as RecordSearchResult[];
}

// ─── Subject-doc assembly ────────────────────────────────────────────────────

async function buildSubjectDoc(
  projectPath: string,
  subjectId: string,
): Promise<SimplifiedGedcomX> {
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

  // v1: the minimal subject-only document. The mint-hardening in match-engine
  // synthesizes a conforming Persistent id for the ark-less subject, so scoring
  // is deterministic. (Future: enrich with 1-hop relatives — deferred.)
  return { persons: [subject] };
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
    "accept/reject. If `subjectResolvable` is false, the subject is too sparse " +
    "to rank — fall back to manual `same_person` cross-checks. Requires " +
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

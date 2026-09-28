// match-scores — the `same_person` attestation: a project-local record of a
// score the tool actually computed, keyed by (record, assertion, tree person).
//
// Step 2 of issue #1731's 2026-09-07 lead ruling: "the tool writes its score to
// a project-local record keyed by (persona, tree person) — shape is the
// implementer's, but the writer must be able to read it — so a `match_score` on
// a link is checked against a call that happened rather than trusted."
//
// WHY A SIDECAR, NOT A research.json SECTION. `RESEARCH_SHAPES.document`
// (validation/validator.ts) is a closed key set, so an unlisted top-level key
// makes every writer tool reject the whole document, and adding one drags in an
// ownership.json row, both schema trees, the packages/schema web mirror and
// research-query.ts's SECTION_FILTERS — priced at 23 files and rejected by the
// lead for this artifact (#1731, 2026-09-10). A project-folder sidecar staged
// host-side by the tool that produced it is the pattern architecture.md §6.1
// already carries for results/<log_id>.json, and its whole point is that the
// payload never round-trips through the model ON THE LEGITIMATE PATH, which is
// the thing `match_score` alone never was (ADR-0009 constraint 2).
//
// IT IS NOT YET UNFORGEABLE, and step 3 must not assume it is.
// `guard_project_files.py`'s PROTECTED_PROJECT_FILES covers research.json,
// tree.gedcomx.json and starting-tree.gedcomx.json only, so a raw Write to
// results/.scores/ from inside the VM is unguarded: the model cannot produce
// the payload, but it can author the file. Extending that list touches
// ADR-0005, which owns it. This was written as a PRECONDITION for the refusal
// step; that step shipped on 2026-09-24 without it, deliberately and with the
// threat model scoped instead (ADR-0009 constraint 2: the hook binds in Cowork
// and on the hosted path, the hosted store is `PgS3ProjectStore` which no
// file-write tool reaches, and the residual surface is the desktop `.mcpb` main
// thread and the Cowork main thread). Read the ADR, not this paragraph, for
// what was actually decided.
//
// WHY UNDER results/.scores/ AND NOT results/*.json. The validator's orphan
// check lists results/ NON-recursively and errors on any top-level *.json no log
// entry references (validator.ts, "orphan sidecar"). Both store backends list
// direct children only, so a dot-directory is invisible to it — the same trick
// results/.staging/ uses. Unlike .staging, nothing prunes this: an attestation
// outlives the session that made it.
//
// WHY THE MAP IS KEYED ON (assertion, tree person) AND NOT ON THE PARTY.
// The party component is NOT stable across the two routes: `recordPersonaId` is
// a caller override, and on the FETCHED route the tool resolves a real
// persons[].id for a party whose assertion carries `record_persona_id: null`.
// Keying on it therefore filed a score under what was RESOLVED while every
// reader computes the key from what the ASSERTION carries, so a legitimate score
// written by the successful fetch could never be found again -- the gate refused
// exactly the links whose call had been made (#1731 step 3, caught in review
// before it shipped). `(assertion_id, tree_person_id)` is the one pair BOTH
// sides always hold: `same_person`'s project-relative arm is called with them,
// and a `person_evidence` entry carries them as `(assertion_id, person_id)`.
//
// It keeps ADR-0009 constraint 3 (persona granularity) because an assertion IS a
// (record, party) pair -- it carries one `record_role` and one
// `record_persona_id` -- so a second persona of an already-linked record is a
// DIFFERENT assertion and needs its own score. BOTH halves are load-bearing and
// they carry different cases: the assertion gives persona granularity, while the
// tree person is what separates the 1,505 corpus assertions (of 7,684) linked to
// more than one tree person -- the two parties of a relationship assertion.
// Assertion alone would merge those.
//
// Spec: docs/specs/same-person-tool-spec.md ("The recorded score").

import { createHash } from "node:crypto";
import { getProjectStore } from "../store/project-store.js";
import { toArk } from "./ark.js";

/** The dot-directory attestations live in, relative to the project root. */
export const SCORES_SUBDIR = "results/.scores";

/** One recorded score. snake_case — it is a persisted project document
 *  (CLAUDE.md, "Identifier casing"). */
export interface RecordedMatchScore {
  record_id: string;
  /** The record party this score is about: its persona id when the record named
   *  one, else the `record_role` the assertion carries. */
  record_persona_id: string | null;
  record_role: string | null;
  tree_person_id: string;
  /** 0-1 from FamilySearch. The number a `match_score` is checked against. */
  score: number;
  /** 1-10 bucket; absent when the API treats the pair as a non-match. */
  confidence?: number;
  matched: boolean;
  /** The assertion the call was made for. Half the map key, with
   *  `tree_person_id` -- see the header. Null only on the explicit
   *  two-document arm, which records nothing. */
  assertion_id: string | null;
  /** Which route assembled the record side, so a reader can tell a fetched
   *  persona from a projected one without re-deriving it. */
  record_source: "record_read" | "projection";
  computed: string;
}

/** The persisted per-record envelope. */
export interface MatchScoreFile {
  record_id: string;
  /** `<assertion_id>|<tree_person_id>` -> the score. */
  scores: Record<string, RecordedMatchScore>;
}

/**
 * The project-relative ref for a record's attestation file.
 *
 * Hashes the CANONICAL ARK: `record_id` is stored as a resolver URL on part of
 * the corpus and as a bare `ark:` on the rest, and those must not become two
 * files for one record. `toArk` unifies those two spellings and returns
 * anything it cannot parse unchanged, so a bare non-ARK id keys on itself.
 *
 * **Deliberately NOT `arkToBareId`**, which drops the `n:n:` type segment.
 * `1:1:M8GR-TJY` (a record persona), `1:2:M8GR-TJY` (a record source) and
 * `3:1:M8GR-TJY` (an image) are DIFFERENT entities that share an id tail;
 * `record-read.ts` documents the case at length (#2061: "a real person, real
 * census, wrong continent, returned as a clean success"). Collapsing the
 * segment here would file their scores together, so an attestation for one
 * would answer a lookup for another. `record_read`'s own sidecar join may use
 * the lenient form because it compares within a single sidecar, where two
 * entities sharing a tail cannot both be present; this key is project-wide,
 * where they can. The corpus carries 542 `3:1:` and 65 `1:2:` record ids.
 */
export function scoresRef(recordId: string): string {
  const norm = toArk(String(recordId ?? "")).trim().toLowerCase();
  return `${SCORES_SUBDIR}/${createHash("sha256").update(norm).digest("hex")}.json`;
}

/** The map key for one pairing: the assertion the score was computed for, and
 *  the tree person it was computed against. Both sides of the contract hold
 *  these two tokens verbatim, which is the whole point -- see the header. */
export function scoreKey(assertionId: string, treePersonId: string): string {
  return `${assertionId}|${treePersonId}`;
}

/** Read a record's attestation file, or null when there is none. Never throws:
 *  an unreadable or corrupt file means "no attestation", which is the same
 *  answer a reader acts on. */
export async function readMatchScores(
  projectPath: string,
  recordId: string,
): Promise<MatchScoreFile | null> {
  try {
    const text = await getProjectStore().readText(projectPath, scoresRef(recordId));
    const parsed = JSON.parse(text) as MatchScoreFile;
    // `typeof null === "object"`, so a file whose `scores` is literally null
    // slips a bare typeof check and then throws inside `Object.values` in
    // `findRecordedScore`. An attestation file is on disk and can be corrupt or
    // hand-edited, and this function's whole contract is that an unusable file
    // reads as "no attestation" rather than an exception.
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      parsed.scores === null ||
      typeof parsed.scores !== "object" ||
      Array.isArray(parsed.scores)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * The recorded score for one pairing: an exact lookup on
 * `(assertion_id, tree_person_id)`.
 *
 * There is deliberately no looser arm. The persona-id/role arms this used to
 * carry could not see a score written by the fetched route, and the
 * tree-person-only arm that covered for them returned ANY entry for that person
 * -- which is ADR-0009 constraint 3 verbatim: a second persona of an
 * already-linked record attaching unscored. Both failure modes are removed by
 * keying on the pair both sides actually hold.
 */
export function findRecordedScore(
  file: MatchScoreFile | null,
  assertionId: string | null,
  treePersonId: string,
): RecordedMatchScore | null {
  // Defensive on the same shape the reader above rejects, because callers may
  // hand this a file object they built themselves rather than one it returned.
  if (!file || file.scores === null || typeof file.scores !== "object") return null;
  if (typeof assertionId !== "string" || assertionId === "") return null;
  return file.scores[scoreKey(assertionId, treePersonId)] ?? null;
}

/**
 * Record one computed score, merging into the record's existing file.
 *
 * Read-modify-write, so the caller must hold the project lock. A later score for
 * the same pairing REPLACES the earlier one: the newest call is the one made
 * against the most current tree person, and keeping a stale score alongside it
 * would leave a reader choosing between two answers with no rule for which.
 * (Whether a score recorded in an earlier session still satisfies a future gate
 * is the score-TTL question #1731 leaves open for the lead; nothing here decides
 * it, and `computed` is retained so whatever is decided can be applied.)
 */
export async function recordMatchScore(
  projectPath: string,
  entry: RecordedMatchScore,
): Promise<void> {
  const assertionId = entry.assertion_id;
  if (typeof assertionId !== "string" || assertionId === "") {
    // The explicit two-document arm has no assertion, so nothing could look this
    // up again. Silently skipping beats writing a record no reader can find.
    return;
  }
  const existing = await readMatchScores(projectPath, entry.record_id);
  const file: MatchScoreFile = existing ?? { record_id: entry.record_id, scores: {} };
  file.record_id = entry.record_id;
  file.scores[scoreKey(assertionId, entry.tree_person_id)] = entry;
  await getProjectStore().writeJson(projectPath, scoresRef(entry.record_id), file);
}

import type { SimplifiedGedcomX } from "./gedcomx.js";

// ─── Tool input/output ───────────────────────────────────────────────────────

export interface SamePersonInput {
  /** First record's full simplified-GedcomX document. */
  gedcomx1: SimplifiedGedcomX;
  /** The `id` of the focus person in `gedcomx1` (must match a persons[].id). */
  primaryId1: string;
  /** Second record's full simplified-GedcomX document. */
  gedcomx2: SimplifiedGedcomX;
  /** The `id` of the focus person in `gedcomx2`. */
  primaryId2: string;
  /**
   * When `false`/omitted: today's single-pair behavior — score the two focus
   * persons. When `true`: instead match the focus persons' relatives (parents,
   * spouses, children) and return a list of `(targetId, candidateId, score)`
   * triples. The two modes return different result shapes; callers discriminate
   * on the `matchRelatives` field present on the relatives result.
   */
  matchRelatives?: boolean;
}

export interface SamePersonResult {
  /** True when the API returned a `confidence` field on the entry. */
  matched: boolean;
  /** Integer 1-10 bucket. Omitted when the API treats the pair as a non-match. */
  confidence?: number;
  /** Float 0-1, fine-grained match score from the API's algorithm. */
  score: number;
  /** Canonical ARK of the focus person in gedcomx1 (parsed from response title). */
  queryArk: string;
  /** Canonical ARK of the matched person in gedcomx2 (from response entries[0].id). */
  candidateArk: string;
  /** Raw response title (e.g. "Matches for ark:/61903/4:1:KGS8-LY1"). */
  apiTitle: string;
  /** ISO timestamp from the API response. */
  updated: string;
}

/** One scored relative pairing returned by `matchRelatives: true` mode. */
export interface SamePersonRelativeMatch {
  /** Which relationship role this pair was matched under. */
  role: "parent" | "spouse" | "child";
  /** persons[].id of the relative in gedcomx1 (the target side). */
  targetId: string;
  /** persons[].id of the relative in gedcomx2 (the candidate side). */
  candidateId: string;
  /** Float 0-1 from FamilySearch — the real answer. */
  score: number;
  /** Integer 1-10 bucket from FamilySearch. Omitted on a no-match. */
  confidence?: number;
  /** The local heuristic score that selected this pair (transparency/debugging). */
  preScore: number;
}

/** Result shape for `matchRelatives: true` mode. */
export interface SamePersonRelativesResult {
  /** Discriminant so callers can tell the two modes apart. */
  matchRelatives: true;
  /** Scored relative pairings, sorted by role then score descending. */
  matches: SamePersonRelativeMatch[];
  /** Present and > 0 only when MAX_PAIR_CALLS truncated the work list. */
  droppedForCap?: number;
}

// ─── Raw upstream API response shape (internal use) ──────────────────────────
// The upstream FamilySearch endpoint is literally named `matchTwoExamples`;
// this is its response shape.

export interface SamePersonApiResponse {
  entries: Array<{
    confidence?: number;
    id: string;
    score: number;
  }>;
  links?: { self?: { href?: string } };
  results: number;
  title: string;
  updated: string;
}

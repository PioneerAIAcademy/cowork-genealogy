import type { SimplifiedGedcomX } from "./gedcomx.js";

// ─── Tool input/output ───────────────────────────────────────────────────────

export interface MatchTwoExamplesInput {
  /** First record's full simplified-GedcomX document. */
  gedcomx1: SimplifiedGedcomX;
  /** The `id` of the focus person in `gedcomx1` (must match a persons[].id). */
  primaryId1: string;
  /** Second record's full simplified-GedcomX document. */
  gedcomx2: SimplifiedGedcomX;
  /** The `id` of the focus person in `gedcomx2`. */
  primaryId2: string;
}

export interface MatchTwoExamplesResult {
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

// ─── Raw upstream API response shape (internal use) ──────────────────────────

export interface MatchTwoExamplesApiResponse {
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

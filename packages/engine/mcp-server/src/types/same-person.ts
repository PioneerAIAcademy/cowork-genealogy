import type { SimplifiedGedcomX } from "./gedcomx.js";

// ─── Tool input/output ───────────────────────────────────────────────────────

/**
 * The project-relative arm (issue #1731 step 1). The caller names references the
 * project already holds and the tool assembles BOTH documents itself: the record
 * side from the record's own GedcomX where one is reachable and from the
 * assertions otherwise, the tree side as the candidate's matching mob.
 *
 * It exists because the explicit form below costs the model a hand-assembled
 * pair of record-sized documents per link, and it was measurably not paying it:
 * 7,526 `person_evidence` links across 151 corpus runs against 91 `same_person`
 * calls in total. Identity was asserted and never scored.
 */
export interface SamePersonProjectInput {
  /** The research project directory. */
  projectPath: string;
  /** The assertion the `person_evidence` link will cite. Resolves the record,
   *  the party and the retrieval route in one hop. */
  assertionId: string;
  /** The candidate tree person's id in `tree.gedcomx.json`. */
  treePersonId: string;
  /** Override: score a DIFFERENT party of the same record than the one the
   *  assertion's own `record_role` names — the second party of a relationship
   *  or marriage assertion, which gets its own link. */
  recordRole?: string;
  /** Override: name the record persona directly, when the caller knows it and
   *  the assertion does not carry it. */
  recordPersonaId?: string;
  /** As on the explicit form. Unavailable when the record side had to be
   *  projected from assertions, which carries no relationships. */
  matchRelatives?: boolean;
}

export interface SamePersonExplicitInput {
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

/** Either arm. Discriminated on `projectPath`, which only the project arm has. */
export type SamePersonInput = SamePersonExplicitInput | SamePersonProjectInput;

export function isProjectForm(
  input: SamePersonInput,
): input is SamePersonProjectInput {
  return typeof (input as SamePersonProjectInput)?.projectPath === "string";
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
  /** Project arm only: how the record side was assembled. Optional so the
   *  explicit form's committed fixtures stay valid. */
  recordSource?: "record_read" | "projection";
  /** Project arm only: true when the score was recorded to the project's
   *  attestation sidecar. The explicit form records nothing — it has no project
   *  and no record identity. */
  recorded?: boolean;
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
  /** Set when relatives mode could not run because the record side carries no
   *  relationships — the projected route. Distinguishes "nothing to pair" from
   *  "paired and found nothing", which an empty `matches` cannot. Optional so
   *  the committed fixtures stay valid. */
  note?: string;
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

/**
 * Read a question's stop decision, understanding documents written before
 * the rename (issue #2539, 2026-10-07).
 *
 * `exhaustive_declaration` (`{declared: boolean, ...}`) became `search_stop`
 * (`{stopped_because: enum | null, ..., not_reached: []}`) in this PR. The
 * schema change is handled for legacy documents by `validation/introduced-errors.ts`
 * (#1572), which demotes pre-existing validation errors to warnings so a drifted
 * project is not frozen. That tolerance says nothing about code that reads a VALUE.
 *
 * Every gate that previously tested `exhaustive_declaration.declared === true`
 * now calls `isStopGateSatisfied(question)`. Every gate that previously tested
 * `exhaustive_declaration.declared !== true` (or `=== false`) calls
 * `!isStopGateSatisfied(question)`.
 *
 * Read-only by design: nothing here rewrites the document, matching how #1572
 * treats the other legacy drift keys — tolerate and warn, never silently rewrite
 * the researcher's file.
 */

/** The five `stopped_because` values. The first three are stop-gate values
 *  that permit `status: "exhaustive_declared"` and a proof tier. */
export type StoppedBecause =
  | "question_answered"
  | "record_exhausted"
  | "nothing_further_reachable"
  | "resources_spent"
  | "blocked_by_conflict";

/** Sentinel returned when a legacy `declared: true` is read. Treated as a
 *  satisfied stop gate with an unknown `stopped_because` value. */
export const LEGACY_STOP_GATE = "LEGACY_STOP_GATE" as const;
export type LegacyStopGate = typeof LEGACY_STOP_GATE;

const STOP_GATE_VALUES = new Set<string>([
  "question_answered",
  "record_exhausted",
  "nothing_further_reachable",
]);

const ALL_STOPPED_BECAUSE = new Set<string>([
  "question_answered",
  "record_exhausted",
  "nothing_further_reachable",
  "resources_spent",
  "blocked_by_conflict",
]);

/**
 * The question's `stopped_because`, or `LEGACY_STOP_GATE` for an old
 * `declared: true`, or `null` when the question has no stop decision yet.
 *
 * `null` means "not stopped". `LEGACY_STOP_GATE` means "stopped, value unknown
 * (old document, stop gate was satisfied)". An unrecognized value in either field
 * also yields `null` — it is a document defect the validator already reports.
 */
export function getStoppedBecause(
  question: unknown
): StoppedBecause | LegacyStopGate | null {
  if (question === null || typeof question !== "object") return null;
  const q = question as Record<string, unknown>;

  // New shape: search_stop.stopped_because
  const ss = q.search_stop;
  if (ss !== null && typeof ss === "object") {
    const sb = (ss as Record<string, unknown>).stopped_because;
    if (sb === null || sb === undefined) return null;
    if (typeof sb === "string" && ALL_STOPPED_BECAUSE.has(sb)) {
      return sb as StoppedBecause;
    }
    return null; // unrecognized value
  }

  // Legacy shape: exhaustive_declaration.declared
  const ed = q.exhaustive_declaration;
  if (ed !== null && typeof ed === "object") {
    const declared = (ed as Record<string, unknown>).declared;
    if (declared === true) return LEGACY_STOP_GATE;
    if (declared === false) return null;
  }

  return null;
}

/**
 * True when the question's stop gate is satisfied — i.e. the three gateway
 * values (`question_answered`, `record_exhausted`, `nothing_further_reachable`)
 * or a legacy `declared: true`.
 *
 * Only a satisfied stop gate permits `status: "exhaustive_declared"` and a
 * proof tier. The two non-gate values (`resources_spent`, `blocked_by_conflict`)
 * keep the question `in_progress`.
 */
export function isStopGateSatisfied(question: unknown): boolean {
  const sb = getStoppedBecause(question);
  if (sb === null) return false;
  if (sb === LEGACY_STOP_GATE) return true;
  return STOP_GATE_VALUES.has(sb);
}

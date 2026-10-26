// Types for the `person_warnings` MCP tool.
// See `docs/specs/person-warnings-tool-spec.md`.

export interface PersonWarningsInput {
  /** Absolute path to the project directory holding `tree.gedcomx.json`. */
  projectPath: string;
  /** One anchor id, or a list of up to 50 (a JSON-array string is accepted as one). */
  personId: string | string[];
}

/**
 * One fact a check examined. `date` is the fact's raw `date`, falling back to
 * `standard_date`, and `null` when it has neither.
 *
 * Do not reach for `getStandardDate()` to populate it: that helper reads
 * `standard_date` FIRST and then normalizes `date` through `stdDate()`, so the
 * `~1818` a record actually carries comes back as `Abt 1818`. Both are
 * defensible; they are different strings, and the spec, the fixtures and the
 * rubrics all quote the one emitted here.
 */
export interface WarningFact {
  id: string;
  type: string;
  date: string | null;
}

export interface PersonWarning {
  scoreType: string;
  issueType: string;
  severity: "contradiction" | "implausible";
  personId: string;
  personName: string;
  message: string;
  /**
   * Optional. Java's MobWarnings emits only the warning tag (`issueType`) —
   * specific facts aren't carried through. Our TS port attaches the
   * contributing facts where they're cheaply retrievable.
   *
   * Entries carry the resolved fact, not a bare id, because an id is not
   * something a reader can act on: handed `["F3"]` and told to be useful, the
   * skill went to the tree for the date it had not been given and was marked
   * down for inventing it. `id` stays first, and stays present, because the
   * cluster rule reasons over overlapping vs disjoint fact sets.
   *
   * Three fields exactly — no place, no sources. `hasEventAfterDeath1` cites
   * every self fact, and `merge_warnings` multiplies that by mob size.
   */
  facts?: WarningFact[];
  relatedPersonId?: string;
  /**
   * Optional. Merge-mode only (`merge_warnings`). Which mob surfaced the
   * warning, so the coherence gate can phrase "merging would introduce …".
   * Single-anchor `person_warnings` never sets this (target === candidate ===
   * merged). See `docs/specs/match-merge-workflow-spec.md` §7.5.
   */
  mobRole?: "target" | "candidate" | "merged" | "relative";
}

export interface PersonWarningsFound {
  warningCount: number;
  warnings: PersonWarning[];
}

/** Whether the online birthplace-distance check ran for one anchor of a list call:
 *  `checked`; `not_checked` (a place it needed could not be looked up, or the
 *  call's shared lookup budget ran out); `not_applicable` (no dated birthplace
 *  with a parent residence near it in time). */
export type BirthplaceCheck = "checked" | "not_checked" | "not_applicable";

/** One anchor of a list call. `warnings` holds only warnings no earlier anchor in
 *  the same call already reported (overlapping relative circles surface the same
 *  warning twice); `alreadyReported` counts the ones left out. `error` replaces the
 *  rest when the id could not be resolved, so one bad id never sinks the batch. */
export interface PersonWarningsListEntry {
  personId: string;
  warningCount?: number;
  warnings?: PersonWarning[];
  alreadyReported?: number;
  birthplaceCheck?: BirthplaceCheck;
  error?: string;
}

/** A list call's answer: one entry per distinct requested id, in request order.
 *  `warningCount` counts distinct warnings across every entry. */
export interface PersonWarningsList {
  warningCount: number;
  results: PersonWarningsListEntry[];
}

/** Unlike every other tool here this one has no `ok` field on success, so the
 *  no-project answer is a genuine second arm rather than an optional field.
 *  Discriminate with `"ok" in result`; a list call answers `results`. */
export type PersonWarningsResult =
  | PersonWarningsFound
  | PersonWarningsList
  | { ok: false; reason: "no_project"; errors: string[] };

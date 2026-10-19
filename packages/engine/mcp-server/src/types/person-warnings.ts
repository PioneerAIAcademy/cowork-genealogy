// Types for the `person_warnings` MCP tool.
// See `docs/specs/person-warnings-tool-spec.md`.

export interface PersonWarningsInput {
  /** Absolute path to the project directory holding `tree.gedcomx.json`. */
  projectPath: string;
  personId: string;
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

/** Unlike every other tool here this one has no `ok` field on success, so the
 *  no-project answer is a genuine second arm rather than an optional field.
 *  Discriminate with `"ok" in result`. */
export type PersonWarningsResult =
  | PersonWarningsFound
  | { ok: false; reason: "no_project"; errors: string[] };

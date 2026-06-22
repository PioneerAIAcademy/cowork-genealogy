// Types for the `merge_warnings` MCP tool.
// See `docs/specs/match-merge-workflow-spec.md` §7.

import type { SimplifiedGedcomX } from "./gedcomx.js";
import type { PersonWarning } from "./person-warnings.js";

export interface MergeWarningsInput {
  projectPath: string;
  candidateGedcomx: SimplifiedGedcomX;
  /** `[treeId, candidateId]` pairs — the same shape merge_record_into_tree takes. */
  merges: Array<[string, string]>;
}

export interface MergeWarningsSuccess {
  ok: true;
  warningCount: number;
  warnings: PersonWarning[];
}

export interface MergeWarningsFailure {
  ok: false;
  errors: string[];
}

export type MergeWarningsResult = MergeWarningsSuccess | MergeWarningsFailure;

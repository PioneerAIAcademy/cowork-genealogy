// Types for the `merge_warnings` MCP tool.
// See `docs/specs/match-merge-workflow-spec.md` §7.

import type { SimplifiedGedcomX } from "./gedcomx.js";
import type { PersonWarning } from "./person-warnings.js";

export interface MergeWarningsInput {
  projectPath: string;
  candidateGedcomx: SimplifiedGedcomX;
  /** `[treeId, candidateId]` pairs for the proposed cross-document merge. */
  merges: Array<[string, string]>;
}

export interface MergeWarningsSuccess {
  ok: true;
  warningCount: number;
  warnings: PersonWarning[];
  /** What sanitation did (candidate strips, legacy-tree heals) — surfaced at
   *  the dry-run so data drops are known BEFORE the write decision. */
  sanitizeWarnings: string[];
}

export interface MergeWarningsFailure {
  ok: false;
  errors: string[];
  /** Marks the one ok:false that is an answer rather than a failure — the user
   *  is not in a research project (see `noProjectResult`). Optional so every
   *  existing `if (!r.ok) r.errors…` keeps narrowing as it does today. */
  reason?: "no_project";
}

export type MergeWarningsResult = MergeWarningsSuccess | MergeWarningsFailure;

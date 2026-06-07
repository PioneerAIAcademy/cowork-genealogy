// Types for the `person_warnings` MCP tool.
// See `docs/specs/person-warnings-tool-spec.md`.

export interface PersonWarningsInput {
  projectPath: string;
  personId: string;
}

export interface PersonWarning {
  scoreType: string;
  issueType: string;
  severity: "error" | "warning";
  personId: string;
  personName: string;
  message: string;
  /**
   * Optional. Java's MobWarnings emits only the warning tag (`issueType`) —
   * specific facts aren't carried through. Our TS port may attach the
   * contributing facts when they're cheaply retrievable, for UI highlighting.
   */
  factIds?: string[];
  relatedPersonId?: string;
}

export interface PersonWarningsResult {
  warningCount: number;
  warnings: PersonWarning[];
}

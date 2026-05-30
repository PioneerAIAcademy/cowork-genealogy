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
  factIds: string[];
  relatedPersonId?: string;
}

export interface PersonWarningsResult {
  warningCount: number;
  warnings: PersonWarning[];
}

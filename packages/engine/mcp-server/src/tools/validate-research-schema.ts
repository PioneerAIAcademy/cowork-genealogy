import { validateProject } from "../validation/validator.js";
import {
  classifyProjectPath,
  missingProjectDirMessage,
  noProjectResult,
  type NoProjectResult,
} from "../utils/project-io.js";

export interface ValidateResearchSchemaInput {
  projectPath: string;
}

export interface ValidateResearchSchemaResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  message: string;
}

export async function validateResearchSchema(
  input: ValidateResearchSchemaInput
): Promise<ValidateResearchSchemaResult | NoProjectResult> {
  const { projectPath } = input;

  if (!projectPath || typeof projectPath !== "string") {
    throw new Error("projectPath is required");
  }

  switch (await classifyProjectPath(projectPath)) {
    case "no_project":
      return noProjectResult("read");
    case "missing_dir":
      throw new Error(missingProjectDirMessage(projectPath));
  }

  try {
    const result = await validateProject(projectPath);

    // Format errors and warnings as strings
    const errors = result.errors.map(e => `${e.path}: ${e.message}`);
    const warnings = result.warnings.map(w => `${w.path}: ${w.message}`);

    let message: string;
    if (result.valid) {
      message = "Both project files pass all validation checks.";
    } else {
      message = `Validation failed: ${errors.length} error(s), ${warnings.length} warning(s)`;
    }

    return {
      valid: result.valid,
      errors,
      warnings,
      message,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      valid: false,
      errors: [`Validation error: ${errorMessage}`],
      warnings: [],
      message: `Validation error: ${errorMessage}`,
    };
  }
}

export const validateResearchSchemaSchema = {
  name: "validate_research_schema",
  description:
    "Validates research.json and tree.gedcomx.json files against their published schemas. " +
    "This ensures data integrity and catches structural errors, missing required fields, " +
    "invalid enums, and broken cross-references. Invoke this after writing to either file. " +
    "Returns validation errors and warnings.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectPath: {
        type: "string",
        description:
          "Absolute path to the directory containing research.json and tree.gedcomx.json",
      },
    },
    required: ["projectPath"],
  },
};

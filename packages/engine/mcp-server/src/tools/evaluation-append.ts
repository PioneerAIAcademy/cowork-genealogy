// evaluation_append — research_append restricted to the `evaluations` section,
// for the gps-mentor agent.
//
// WHY A SECOND TOOL RATHER THAN A PARAMETER (ADR-0006): gps-mentor is the most
// prompt-exposed agent in the system — a delegation can tell it anything. Prose
// in its body keeping it to `evaluations` loses to a caller that prompts past
// it, and a `section` parameter on the tool input is forgeable by that caller. A
// lane expressed as tool IDENTITY is not: gps-mentor's frontmatter omits the
// broad `research_append` (the omission is what binds under bypassPermissions),
// and holds only this tool, which can write nothing but `evaluations`.
//
// The restriction is passed as a second function argument to `researchAppend`,
// NOT as a field on the tool input — `ResearchAppendOptions.allowedSections` is
// where a tool caller structurally cannot reach, because dispatch builds only
// the first argument from tool input. Everything else — validation, id
// assignment, the `verdict` composite persist, atomic write — is `researchAppend`'s.
// ADR-0006, "Restrict capability by tool identity, not by prompt or parameter".

import {
  researchAppend,
  researchAppendSchema,
  type ResearchAppendInput,
  type ResearchAppendResult,
} from "./research-append.js";

/** The one section this tool may write. */
const EVALUATION_SECTIONS: ReadonlySet<string> = new Set(["evaluations"]);

export async function evaluationAppend(
  input: ResearchAppendInput,
): Promise<ResearchAppendResult> {
  return researchAppend(input, {
    allowedSections: EVALUATION_SECTIONS,
    toolName: "evaluation_append",
  });
}

const _base = researchAppendSchema.inputSchema;

/** `research_append`'s input schema with `section` narrowed to `["evaluations"]`
 *  on both the top-level field and each `ops[]` item, so the model is never
 *  offered another section. The runtime lane gate (`allowedSections`) enforces
 *  the same restriction; this just keeps the advertised surface honest. */
export const evaluationAppendSchema = {
  name: "evaluation_append",
  description:
    "Append or update an entry in research.json's `evaluations` section — the " +
    "gps-mentor agent's GPS-review verdicts. This is research_append scoped to " +
    "`evaluations` by tool identity (ADR-0006); it can write no other section, " +
    "and no other agent holds it. Supply the entry in snake_case WITHOUT an id " +
    "(the tool assigns `ev_NNN`); pass the structured verdict body as `verdict` " +
    "and the tool writes it to a sidecar file and stamps `file_path` — never " +
    "write that file or set file_path yourself. Retire a superseded evaluation " +
    "by pointing its `superseded_by` at the replacement, never by deletion.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectPath: _base.properties.projectPath,
      section: {
        ..._base.properties.section,
        enum: ["evaluations"],
        description: "Always 'evaluations' — the only section this tool writes.",
      },
      op: _base.properties.op,
      entry: _base.properties.entry,
      entryId: _base.properties.entryId,
      fields: _base.properties.fields,
      verdict: _base.properties.verdict,
      ops: {
        ..._base.properties.ops,
        items: {
          type: "object" as const,
          properties: {
            section: {
              type: "string",
              enum: ["evaluations"],
              description: "Always 'evaluations' — the only section this tool writes.",
            },
            op: _base.properties.ops.items.properties.op,
            entry: _base.properties.ops.items.properties.entry,
            entryId: _base.properties.ops.items.properties.entryId,
            fields: _base.properties.ops.items.properties.fields,
          },
          required: ["section", "op"],
        },
      },
    },
    required: ["projectPath"],
  },
};

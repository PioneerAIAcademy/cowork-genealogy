// extraction_append — the record-extraction lane's writer for research.json.
//
// Same machinery as `research_append`, restricted to the two sections the
// record-extractor legitimately owns: `sources` and `assertions`. Everything
// else — `person_evidence` above all — is not reachable from this tool.
//
// WHY A SECOND TOOL RATHER THAN A PARAMETER (issue #695): in the birkeland run
// the router's delegation message instructed the extractor to write
// `person_evidence` entries at `confident`, against the agent body's prose lane
// rule, and the agent complied — fabricating a match_score no tool had computed.
// A lane expressed as prose loses to a caller that prompts against it, and a
// lane expressed as a tool PARAMETER is forgeable by the caller. A lane
// expressed as tool identity is not: the agent's `tools:` frontmatter simply
// omits the broad writer, so there is no call it can emit. See
// docs/plan/person-evidence-append-tool-plan.md §D1-D2.
//
// The restriction is passed as a second function argument to `researchAppend`,
// NOT as a field on the tool input — see `ResearchAppendOptions` for why that
// distinction is what makes it unforgeable, and why the gate lives in the module
// rather than in the `index.ts` dispatch layer.

import {
  researchAppend,
  researchAppendSchema,
  type ResearchAppendInput,
  type ResearchAppendResult,
} from "./research-append.js";

/** The record-extraction lane: one record's source plus its assertions. */
export const EXTRACTION_SECTIONS: ReadonlySet<string> = new Set([
  "sources",
  "assertions",
]);

const EXTRACTION_SECTION_LIST = ["sources", "assertions"];

export async function extractionAppend(
  input: ResearchAppendInput,
): Promise<ResearchAppendResult> {
  return researchAppend(input, {
    allowedSections: EXTRACTION_SECTIONS,
    toolName: "extraction_append",
  });
}

/** The input surface is `research_append`'s with the two `section` enums
 *  narrowed. DERIVED rather than copied so the shared fields — `ops`,
 *  `sourceDescription`, `projectPath`, the place-resolution echoes — cannot
 *  drift between the two tools as either evolves. */
function narrowedInputSchema() {
  const base = researchAppendSchema.inputSchema as any;
  const sectionDescription =
    "The research.json section this op writes. This tool writes the " +
    "record-extraction lane only: `sources` (the record's source entry) and " +
    "`assertions` (one per extracted fact).";

  const properties: any = { ...base.properties };

  properties.section = {
    ...base.properties.section,
    enum: [...EXTRACTION_SECTION_LIST],
    description: sectionDescription,
  };

  properties.ops = {
    ...base.properties.ops,
    items: {
      ...base.properties.ops.items,
      properties: {
        ...base.properties.ops.items.properties,
        section: {
          ...base.properties.ops.items.properties.section,
          enum: [...EXTRACTION_SECTION_LIST],
          description: sectionDescription,
        },
      },
    },
  };

  return { ...base, properties };
}

export const extractionAppendSchema = {
  name: "extraction_append",
  description:
    "Persist ONE extracted record to research.json — its source entry plus one " +
    "assertion per extracted fact. This is the record-extraction lane's writer: " +
    "it writes `sources` and `assertions` and nothing else.\n" +
    "\n" +
    "Supply each entry in its persisted snake_case shape WITHOUT an id; the tool " +
    "assigns the next `<prefix>NNN`, stamps tool-owned timestamps, validates the " +
    "whole project, and writes atomically. Returns a compact summary; on any " +
    "failure nothing is written.\n" +
    "\n" +
    "To persist a whole record in ONE call, pass an `ops` array (each op is " +
    "`{ section, op, entry?/entryId?/fields? }`): one sources append plus one " +
    "assertions append per fact, with the top-level `sourceDescription: { title, " +
    "author?, url? }`. The tool then creates the tree.gedcomx.json source " +
    "description (assigning the S id), stamps the source op's " +
    "`gedcomx_source_description_id` and every assertion's `source_id`, " +
    "auto-fills/verifies `record_persona_id` and canonicalizes `record_id` " +
    "against the log entry's results sidecar, resolves `standard_place` for " +
    "assertion places (echoed in `resolvedPlaces`), validates ONCE, and writes " +
    "tree.gedcomx.json + research.json together. Source reuse is auto-detected: " +
    "when the batch's assertions cite a record_id an existing source already " +
    "covers, the tool updates that source in place (same repository) or reuses " +
    "its S entry (different repository) instead of duplicating — always supply " +
    "`sourceDescription` and relay the echoed `sourceReuse` " +
    "({ action: created | updated_existing | new_source_reused_s, srcId, sId }). " +
    "To cite a specific known S entry explicitly, omit `sourceDescription` and " +
    "set the sources op's `gedcomx_source_description_id` to that S id. Batches " +
    "are all-or-nothing: on failure nothing is written and errors name the " +
    "failing ops (`ops[i]: <msg>`) plus `opsReceived` so you can confirm no op " +
    "was dropped.\n" +
    "\n" +
    "Identity links (`person_evidence`) are NOT written here — record a persona↔" +
    "person question in your return summary and let person-evidence resolve it.",
  inputSchema: narrowedInputSchema(),
};

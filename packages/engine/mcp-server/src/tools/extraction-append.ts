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
// omits the broad writer, so there is no call it can emit. The durable record
// of that reasoning is ADR-0006, "Restrict capability by tool identity, not by
// prompt or parameter", whose `Applies to:` names this file.
//
// The restriction is passed as a second function argument to `researchAppend`,
// NOT as a field on the tool input — see `ResearchAppendOptions` for why that
// distinction is what makes it unforgeable, and why the gate lives in the module
// rather than in the `index.ts` dispatch layer.

import {
  researchAppend,
  researchAppendSchema,
  type ResearchAppendInput,
  type ResearchAppendOp,
  type ResearchAppendResult,
} from "./research-append.js";
import {
  extractRecord,
  collectionTitle,
  EXTRACTED_SOURCE_CLASSIFICATION,
  type ExtractDocument,
  type ExtractResult,
} from "../utils/record-extract.js";
import { readProjectJson } from "../utils/project-io.js";
import { readStagedResults } from "../utils/results-staging.js";
import { arkToBareId } from "../utils/ark.js";
import type { SimplifiedGedcomX } from "../types/gedcomx.js";

/** The record-extraction lane: one record's source plus its assertions. */
export const EXTRACTION_SECTIONS: ReadonlySet<string> = new Set([
  "sources",
  "assertions",
]);

const EXTRACTION_SECTION_LIST = ["sources", "assertions"];

export async function extractionAppend(
  input: ResearchAppendInput & Partial<ExtractionModeInput>,
): Promise<ResearchAppendResult> {
  // EXTRACTOR MODE is entered on the presence of `logEntryId`. Supplying `ops`
  // as well is a precondition error naming both: the two describe the same
  // write from opposite ends, and silently preferring one would make the
  // ignored half invisible.
  if (input.logEntryId !== undefined) {
    if (input.ops !== undefined) {
      return {
        ok: false,
        errors: [
          "extraction_append received BOTH `logEntryId` (extractor mode, which " +
            "builds the ops itself from the record's sidecar) and `ops` (the " +
            "hand-built form). Send one: `logEntryId` + `recordId` to extract a " +
            "FamilySearch record in code, or `ops` to write assertions you " +
            "composed yourself.",
        ],
        opsReceived: input.ops.length,
      } as ResearchAppendResult;
    }
    return extractorMode(input as ResearchAppendInput & ExtractionModeInput);
  }
  return researchAppend(input, {
    allowedSections: EXTRACTION_SECTIONS,
    toolName: "extraction_append",
  });
}

/** Resolve the record document out of the log entry's sidecar, extract it, and
 *  persist the whole batch through the ordinary writer. */
async function extractorMode(
  input: ResearchAppendInput & ExtractionModeInput,
): Promise<ResearchAppendResult> {
  const fail = (msg: string): ResearchAppendResult =>
    ({ ok: false, errors: [msg] }) as ResearchAppendResult;

  let research: any;
  try {
    research = await readProjectJson(input.projectPath, "research.json");
  } catch (e) {
    return fail(`could not read research.json: ${e instanceof Error ? e.message : String(e)}`);
  }

  const logEntry = (Array.isArray(research.log) ? research.log : []).find(
    (e: any) => e && e.id === input.logEntryId,
  );
  if (!logEntry) {
    return fail(
      `log entry '${input.logEntryId}' does not exist. Extractor mode reads the ` +
        "record out of that entry's results sidecar, so the search or read must be " +
        "logged with `research_log_append` first.",
    );
  }
  const ref = logEntry.results_ref;
  if (typeof ref !== "string" || ref === "") {
    return fail(
      `log entry '${input.logEntryId}' has no results sidecar (results_ref is null), ` +
        "so there is no record document to extract. Re-read the record with " +
        "`record_read({ recordId, projectPath })` — a LIVE read, with `resultsRef` " +
        "omitted, since passing one resolves from the search sidecar and stages " +
        "nothing — then log it with that `staged.resultsRef`.",
    );
  }

  let results: unknown[];
  try {
    results = await readStagedResults(input.projectPath, ref);
  } catch (e) {
    return fail(`could not read sidecar '${ref}': ${e instanceof Error ? e.message : String(e)}`);
  }

  const key = arkToBareId(String(input.recordId ?? ""));
  const match = results.find((r: any) => {
    const id = r?.recordId ?? r?.id;
    return typeof id === "string" && arkToBareId(id) === key;
  }) as ExtractDocument | undefined;
  if (!match) {
    const known = results
      .map((r: any) => r?.recordId ?? r?.id)
      .filter((x: unknown): x is string => typeof x === "string")
      .slice(0, 5)
      .join(", ");
    return fail(
      `record '${input.recordId}' is not in sidecar '${ref}' — expected one of: ${known}`,
    );
  }

  if (!match.indexFields && (match.gedcomx?.persons ?? []).length > 1) {
    // Not fatal — a non-census record legitimately carries none — but a
    // multi-person record with no index fields is almost always a `record_search`
    // sidecar, where only the searched persona has them. Roles would be assigned
    // from names and ages alone, silently, for the whole household.
    // Warned rather than refused: the caller may be extracting a record type
    // that has no index data at all.
  }

  const { ops, sourceDescription, extraction } = buildExtractionOps(
    { recordId: match.recordId ?? input.recordId, gedcomx: match.gedcomx ?? {}, indexFields: match.indexFields },
    input,
    logEntry,
  );

  const result = await researchAppend(
    { ...input, ops, sourceDescription, logEntryId: undefined } as ResearchAppendInput,
    { allowedSections: EXTRACTION_SECTIONS, toolName: "extraction_append" },
  );

  if (!result.ok) return result;

  // Hand back WHAT WAS EXTRACTED, not just that it worked: the caller reports
  // this and cannot see the record itself. The defaulted classifications ride
  // on `validation.warnings` because an `unknown` proximity switches off
  // `contradictionIsCredible`, and a missing table row must be visible rather
  // than quietly weakening a guard.
  return {
    ...result,
    extraction: {
      recordType: extraction.recordType,
      ...(extraction.censusStatesRelationships !== undefined
        ? { censusStatesRelationships: extraction.censusStatesRelationships }
        : {}),
      assertionCount: extraction.assertions.length,
      roles: [...new Set(extraction.assertions.map((a) => a.record_role))],
      notes: extraction.notes,
    },
    validation: {
      ...result.validation,
      warnings: [
        ...result.validation.warnings,
        ...extraction.defaultedClassifications,
        ...extraction.notes,
      ],
    },
  } as ResearchAppendResult;
}

// ─── extractor mode (issue #2937) ───────────────────────────────────────────

/**
 * Extractor-mode input. camelCase — these are MCP tool parameters, which sit on
 * the API side of the casing seam (CLAUDE.md, "Identifier casing").
 *
 * Entered when `logEntryId` is present. Everything here is what the record
 * CANNOT supply: which questions the extraction serves and who was expected but
 * absent are both relative to the research question, not to the document.
 */
export interface ExtractionModeInput {
  projectPath: string;
  /** The log entry whose `results_ref` sidecar holds the record. */
  logEntryId: string;
  /** Which record in that sidecar. Matched ARK-insensitively. */
  recordId: string;
  /** Open questions this extraction serves. */
  questionIds?: string[];
  /** Persons expected in this record and NOT found. The extractor never emits
   *  the literal `record_role: "absent"`; negative evidence is a claim about
   *  what the record does not contain, which no document can supply. */
  absentPersons?: {
    name: string;
    factType?: string;
    note?: string;
  }[];
  /** Overrides the derived citation when the caller has a better one. */
  citation?: string;
}

/** Today, as `YYYY-MM-DD`. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Build the whole `ops` batch for one record: its source entry plus one
 * assertion per extracted fact, plus any caller-supplied negative evidence.
 *
 * Kept separate from the dispatch below so the batch can be asserted directly in
 * tests without a project on disk.
 */
export function buildExtractionOps(
  doc: ExtractDocument,
  input: ExtractionModeInput,
  logEntry: { id: string; performed?: string },
): {
  ops: ResearchAppendOp[];
  sourceDescription: { title: string; url?: string };
  extraction: ExtractResult;
} {
  const extraction = extractRecord(doc, {
    logEntryId: input.logEntryId,
    questionIds: input.questionIds ?? [],
  });

  const gx = doc.gedcomx ?? {};
  const recordSd = (gx.sources ?? []).find((s) =>
    /record/i.test(String(s.resource_type ?? "")),
  );
  const collection = collectionTitle(gx);
  const title = recordSd?.title ?? collection ?? `Record ${doc.recordId}`;
  const url = recordSd?.url;
  const accessed = todayIso();

  // The citation FamilySearch itself printed, when it printed one. A derived
  // citation is a working citation; the `citation` skill refines it later
  // (GPS step 2), and this tool deliberately does not attempt Evidence
  // Explained form.
  const citation =
    input.citation ??
    recordSd?.citation ??
    `${title}, FamilySearch (${url ?? doc.recordId} : accessed ${accessed}).`;

  const sourceEntry: Record<string, unknown> = {
    citation,
    citation_detail: {
      who: extraction.recordType === "census" ? "the enumerated household" : "the record's parties",
      what: title,
      when_created: eventYear(gx) ?? "unknown",
      when_accessed: accessed,
      where: collection ?? "FamilySearch",
      where_within: doc.recordId,
    },
    // `derivative`, always: what was read is FamilySearch's INDEX of the record,
    // not the schedule or register. See EXTRACTED_SOURCE_CLASSIFICATION.
    source_classification: EXTRACTED_SOURCE_CLASSIFICATION,
    repository: "FamilySearch",
    access_date: accessed,
    log_entry_id: input.logEntryId,
    ...(url ? { url } : {}),
  };

  const ops: ResearchAppendOp[] = [
    { section: "sources", op: "append", entry: sourceEntry },
    ...extraction.assertions.map((a) => ({
      section: "assertions" as const,
      op: "append" as const,
      entry: a as unknown as Record<string, unknown>,
    })),
    ...(input.absentPersons ?? []).map((p) => ({
      section: "assertions" as const,
      op: "append" as const,
      entry: {
        record_id: doc.recordId,
        // The literal token, which downstream validators key on. Supplied by
        // the caller and never minted by the extractor.
        record_role: "absent",
        fact_type: p.factType ?? "name",
        value: p.note ?? `${p.name} was expected in this record and is not present`,
        information_quality: "indeterminate",
        informant: "the researcher",
        informant_proximity: "researcher",
        record_basis: "absent",
        log_entry_id: input.logEntryId,
        extracted_for_question_ids: [...(input.questionIds ?? [])],
      } as Record<string, unknown>,
    })),
  ];

  return { ops, sourceDescription: url ? { title, url } : { title }, extraction };
}

/** The record's own event year, for `citation_detail.when_created`. */
function eventYear(gx: SimplifiedGedcomX): string | undefined {
  for (const p of gx.persons ?? []) {
    for (const f of p.facts ?? []) {
      const y = String(f.standard_date ?? f.date ?? "").match(/\d{4}/)?.[0];
      if (y) return y;
    }
  }
  for (const r of gx.relationships ?? []) {
    for (const f of r.facts ?? []) {
      const y = String(f.standard_date ?? f.date ?? "").match(/\d{4}/)?.[0];
      if (y) return y;
    }
  }
  return undefined;
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

  // EXTRACTOR MODE's inputs, added to (not replacing) the derived surface.
  // `required` is deliberately untouched — it names only `projectPath`, and
  // both call shapes are legal.
  properties.logEntryId = {
    type: "string",
    description:
      "EXTRACTOR MODE. The research-log entry whose results sidecar holds the " +
      "record to extract. Supplying this switches the tool into extractor mode: " +
      "roles, classifications and assertions are decided in CODE from the " +
      "record, and you supply none of them. Requires `recordId`. Do not send " +
      "`ops` as well — that is the hand-built form and the two are refused " +
      "together. The sidecar must come from a LIVE `record_read` " +
      "(`{ recordId, projectPath }`, with `resultsRef` OMITTED): passing " +
      "`resultsRef` resolves the record from the search sidecar and stages " +
      "nothing, and a search sidecar carries per-person index fields for the " +
      "searched persona only, so household roles cannot be assigned from it.",
  };
  properties.recordId = {
    type: "string",
    description:
      "EXTRACTOR MODE. Which record in that sidecar. Any ARK form is accepted.",
  };
  properties.questionIds = {
    type: "array",
    items: { type: "string" },
    description:
      "EXTRACTOR MODE. The open questions this extraction serves. Yours to " +
      "decide — it is relative to the research question, not to the record — " +
      "and stamped on every assertion written.",
  };
  properties.absentPersons = {
    type: "array",
    items: {
      type: "object",
      properties: {
        name: { type: "string", description: "Who was expected." },
        factType: { type: "string", description: "Defaults to `name`." },
        note: {
          type: "string",
          description:
            "The assertion's value. Keep the person's identity in it rather " +
            "than a generic phrase shared across several people.",
        },
      },
      required: ["name"],
    },
    description:
      "EXTRACTOR MODE. Persons expected in this record and NOT found, written " +
      "as negative evidence (`record_role: \"absent\"`). Yours to supply: the " +
      "extractor never mints an absence, because a claim about who is MISSING " +
      "cannot be read off the document.",
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
    "it writes the `sources` and `assertions` SECTIONS and no others.\n" +
    "\n" +
    "TWO CALL SHAPES.\n" +
    "\n" +
    "1. EXTRACTOR MODE — the normal path for a FamilySearch record. Send " +
    "`logEntryId` + `recordId` (plus `questionIds`, and `absentPersons` if any). " +
    "The tool reads the record out of that log entry's sidecar and decides the " +
    "roles, the three classification layers and every assertion IN CODE; you " +
    "compose nothing. It returns an `extraction` echo — record type, assertion " +
    "count, the roles assigned, and any notes — which is what you report, since " +
    "you never see the record yourself. Anything it had to default lands in " +
    "`validation.warnings` and is worth repeating to the user. The sidecar must " +
    "come from a LIVE `record_read({ recordId, projectPath })` with " +
    "`resultsRef` OMITTED.\n" +
    "\n" +
    "2. OPS FORM — for a record no sidecar covers (an image, full text, an " +
    "external site, pasted prose). Supply the entries yourself, as below. " +
    "Sending `logEntryId` and `ops` together is refused.\n" +
    "\n" +
    "THE OPS FORM. Correcting " +
    "an assertion's place/standard_place/date/value also updates the tree fact " +
    "materialized from it.\n" +
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

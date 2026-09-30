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
import type { Principal } from "../auth/principal.js";
import { recordReadTool } from "./record-read.js";
import type { RecordReadInput, RecordReadResult } from "../types/record-read.js";
import { researchLogAppend } from "./research-log-append.js";
import { mapWithConcurrency } from "../utils/place-resolver.js";
import { sourceIdsForRecordIds } from "./research-append.js";
import { summarizeExtraction } from "../utils/record-extract.js";

/** The record-extraction lane: one record's source plus its assertions. */
export const EXTRACTION_SECTIONS: ReadonlySet<string> = new Set([
  "sources",
  "assertions",
]);

const EXTRACTION_SECTION_LIST = ["sources", "assertions"];

type BatchCall = ExtractionBatchInput & ({ recordIds: string[] } | { absences: AbsenceInput[] });
type AnyCall = ResearchAppendInput & Partial<ExtractionModeInput> & Partial<ExtractionBatchInput>;

export function extractionAppend(
  input: ResearchAppendInput & Partial<ExtractionModeInput>,
  principal: Principal,
): Promise<ResearchAppendResult>;
export function extractionAppend(input: BatchCall, principal: Principal): Promise<ExtractionBatchResult>;
export async function extractionAppend(
  input: AnyCall,
  principal: Principal,
): Promise<ResearchAppendResult | ExtractionBatchResult> {
  return runExtractionAppend(input, DEFAULT_DEPS, principal);
}

/** `extractionAppend` with its record reader injected. The harness and the tests
 *  call this; production goes through `extractionAppend`. */
export function runExtractionAppend(
  input: ResearchAppendInput & Partial<ExtractionModeInput>,
  deps: ExtractionAppendDeps,
  principal: Principal,
): Promise<ResearchAppendResult>;
export function runExtractionAppend(
  input: BatchCall,
  deps: ExtractionAppendDeps,
  principal: Principal,
): Promise<ExtractionBatchResult>;
export async function runExtractionAppend(
  input: AnyCall,
  deps: ExtractionAppendDeps,
  principal: Principal,
): Promise<ResearchAppendResult | ExtractionBatchResult> {
  // Exactly one call shape. Two together describe the same write from different
  // ends, and silently preferring one would make the ignored half invisible.
  const shapes = (["recordIds", "absences", "logEntryId", "ops"] as const).filter(
    (k) => (input as any)[k] !== undefined,
  );
  if (shapes.length > 1 && !(shapes.length === 2 && shapes.includes("logEntryId") && shapes.includes("ops"))) {
    return {
      ok: false,
      errors: [
        `extraction_append received ${shapes.map((k) => `\`${k}\``).join(" and ")} together. Send one: ` +
          "`recordIds` to extract FamilySearch records in code, or `absences` to record people a " +
          "search did not find.",
      ],
    } as ResearchAppendResult;
  }
  if (input.recordIds !== undefined) return recordIdsMode(input as ExtractionBatchInput, deps, principal);
  if (input.absences !== undefined) return absencesMode(input as ExtractionBatchInput);
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

  // Not fatal — a non-census record legitimately carries no index fields — but a
  // multi-person record with none is almost always a `record_search` sidecar,
  // where only the searched persona has them. Roles would then be assigned from
  // names and ages alone, silently, for the whole household. Warned rather than
  // refused, because the caller may legitimately be extracting a record type
  // that has no index data at all.
  const sidecarWarnings: string[] = [];
  if (!match.indexFields && (match.gedcomx?.persons ?? []).length > 1) {
    sidecarWarnings.push(
      `record '${input.recordId}' has ${(match.gedcomx?.persons ?? []).length} personas and NO ` +
        "per-person index fields. That is the shape of a `record_search` sidecar, which carries " +
        "them for the searched persona only — roles for the other personas are then assigned " +
        "from names and ages with nothing to say so. If this is a FamilySearch record, re-read it " +
        "live with `record_read({ recordId, projectPath })`, `resultsRef` OMITTED, and log that " +
        "read. If it is a record type that simply carries no index data, this is expected.",
    );
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
        ...sidecarWarnings,
        ...extraction.defaultedClassifications,
        ...extraction.notes,
      ],
    },
  } as ResearchAppendResult;
}

// ─── batch modes: `recordIds` and `absences` (issues #2937 / #2939) ─────────

/**
 * What the record reader must do. Production passes `recordReadTool` (a LIVE
 * read with `projectPath`, which stages the record exactly as `record_read`
 * does); the eval harness passes one that serves its `record_read` fixtures.
 * A function parameter, not a schema field or an env var, so no model can reach
 * it.
 */
export interface ExtractionAppendDeps {
  readRecord: (input: RecordReadInput, principal: Principal) => Promise<RecordReadResult>;
}

const DEFAULT_DEPS: ExtractionAppendDeps = { readRecord: recordReadTool };

/** One expected-but-absent person, found by a search that returned no record. */
export interface AbsenceInput {
  /** The collection searched (its title), e.g. "United States Census, 1870". */
  collection: string;
  /** Where the search was scoped, e.g. "Schuylkill, Pennsylvania". */
  place?: string;
  /** Who was expected. */
  name: string;
  /** The assertion's value. Defaults to a sentence naming the person. */
  note?: string;
  /** The nil search's own log entry. Not written again. */
  logEntryId: string;
  questionIds?: string[];
  /** Defaults to FamilySearch. */
  repository?: string;
  /** What was searched (genealogist ruling, 2026-09-30, option B): `derivative`
   *  for an index search (the default), `original` when the images themselves
   *  were browsed page by page, which is stronger negative evidence. */
  sourceClassification?: "original" | "derivative" | "authored";
}

export interface ExtractionBatchInput {
  projectPath: string;
  recordIds?: string[];
  absences?: AbsenceInput[];
  questionIds?: string[];
  /** Expected-but-absent persons for a record in `recordIds`, keyed by its id. */
  absentPersons?: { recordId?: string; name: string; factType?: string; note?: string }[];
}

export type RecordOutcomeStatus = "extracted" | "already_extracted" | "read_failed" | "refused";

export interface RecordOutcome {
  recordId: string;
  status: RecordOutcomeStatus;
  srcId?: string;
  logId?: string;
  /** Code-written, for the caller to relay verbatim. */
  summary: string;
  errors?: string[];
  warnings?: string[];
}

export interface ExtractionBatchResult {
  ok: boolean;
  records: RecordOutcome[];
  errors?: string[];
}

const READ_CONCURRENCY = 4;

function srcIdOf(result: ResearchAppendResult): string | undefined {
  if (!result.ok || !("results" in result)) return undefined;
  return result.results.find((r) => r.section === "sources")?.entryId;
}

/**
 * `recordIds`: read each FamilySearch record live, log every read in ONE
 * `research_log_append` batch, then persist each record with its OWN
 * `research_append` call. `research_append` takes exactly one sources append per
 * call, so a batch-wide write is not available; a refusal on record k leaves the
 * records before it written, and the resend skip below makes a corrected resend
 * of the whole batch safe.
 */
async function recordIdsMode(
  input: ExtractionBatchInput,
  deps: ExtractionAppendDeps,
  principal: Principal,
): Promise<ExtractionBatchResult> {
  const ids = input.recordIds ?? [];
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((r) => typeof r !== "string" || r.trim() === "")) {
    return { ok: false, records: [], errors: ["`recordIds` must be a non-empty list of record ids (any ARK form)."] };
  }

  let research: any;
  try {
    research = await readProjectJson(input.projectPath, "research.json");
  } catch (e) {
    return { ok: false, records: [], errors: [`could not read research.json: ${e instanceof Error ? e.message : String(e)}`] };
  }

  // One outcome per DISTINCT record: a repeated id in the call is one record.
  const seen = new Set<string>();
  const outcomes: (RecordOutcome & { stagedRef?: string })[] = [];
  for (const raw of ids) {
    const bare = arkToBareId(raw.trim());
    if (seen.has(bare)) continue;
    seen.add(bare);
    outcomes.push({ recordId: raw.trim(), status: "extracted", summary: "" });
  }

  // 1. Resend skip, FIRST — before any read or log write — by the same
  //    record-id -> source mapping research_append's reuse detection uses.
  for (const o of outcomes) {
    const existing = sourceIdsForRecordIds(research, new Set([arkToBareId(o.recordId)]));
    if (existing.size > 0) {
      const srcId = [...existing][0];
      o.status = "already_extracted";
      o.srcId = srcId;
      o.summary = `${o.recordId}: already extracted as ${srcId}; nothing written.`;
    }
  }

  // 2. Reads, in parallel. An error or an unstaged read is reported and skipped.
  const toRead = outcomes.filter((o) => o.status === "extracted");
  await mapWithConcurrency(toRead, READ_CONCURRENCY, async (o) => {
    try {
      const r = await deps.readRecord({ recordId: o.recordId, projectPath: input.projectPath }, principal);
      if (!r.staged) {
        o.status = "read_failed";
        o.summary = `${o.recordId}: read, but not staged, so it cannot be extracted: ${r.stagingError ?? "no staging handle returned"}.`;
      } else {
        o.stagedRef = r.staged.resultsRef;
      }
    } catch (e) {
      o.status = "read_failed";
      o.summary = `${o.recordId}: could not be read: ${e instanceof Error ? e.message : String(e)}.`;
    }
  });

  const staged = outcomes.filter((o) => o.status === "extracted" && o.stagedRef);
  if (staged.length > 0) {
    // 3. ONE log batch for every read.
    const logged = await researchLogAppend({
      projectPath: input.projectPath,
      ops: staged.map((o) => ({
        tool: "record_read",
        query: { recordId: o.recordId },
        outcome: "positive",
        resultsExamined: 1,
        stagedResultsRef: o.stagedRef!,
      })),
    });
    if (!logged.ok || !("results" in logged)) {
      const errs = (logged as any).errors ?? ["research_log_append refused the batch"];
      for (const o of staged) {
        o.status = "refused";
        o.errors = errs;
        o.summary = `${o.recordId}: not extracted, because logging the read was refused: ${errs.join("; ")}.`;
      }
    } else {
      logged.results.forEach((lr, i) => {
        staged[i].logId = lr.logId;
        staged[i].stagedRef = lr.resultsRef ?? staged[i].stagedRef;
      });

      // 4. One research_append per record.
      for (const o of staged) {
        let doc: ExtractDocument | undefined;
        try {
          const rows = await readStagedResults(input.projectPath, o.stagedRef!);
          const key = arkToBareId(o.recordId);
          doc = rows.find((r: any) => {
            const id = r?.recordId ?? r?.id;
            return typeof id === "string" && arkToBareId(id) === key;
          }) as ExtractDocument | undefined;
        } catch (e) {
          o.status = "refused";
          o.summary = `${o.recordId}: logged as ${o.logId}, but its sidecar could not be read: ${e instanceof Error ? e.message : String(e)}.`;
          continue;
        }
        if (!doc) {
          o.status = "refused";
          o.summary = `${o.recordId}: logged as ${o.logId}, but its sidecar does not hold that record.`;
          continue;
        }
        const absent = (input.absentPersons ?? []).filter(
          (p) => p.recordId !== undefined && arkToBareId(p.recordId) === arkToBareId(o.recordId),
        );
        const { ops, sourceDescription, extraction } = buildExtractionOps(
          { recordId: doc.recordId ?? o.recordId, gedcomx: doc.gedcomx ?? {}, indexFields: doc.indexFields },
          {
            projectPath: input.projectPath,
            logEntryId: o.logId!,
            recordId: o.recordId,
            questionIds: input.questionIds,
            absentPersons: absent,
          },
          { id: o.logId! },
        );
        const written = await researchAppend(
          { projectPath: input.projectPath, ops, sourceDescription } as ResearchAppendInput,
          { allowedSections: EXTRACTION_SECTIONS, toolName: "extraction_append" },
        );
        if (!written.ok) {
          o.status = "refused";
          o.errors = written.errors;
          o.summary = `${o.recordId}: read and logged as ${o.logId}, but the write was refused: ${written.errors.join("; ")}.`;
          continue;
        }
        o.srcId = srcIdOf(written);
        o.summary = summarizeExtraction(doc, extraction);
        o.warnings = [...written.validation.warnings, ...extraction.defaultedClassifications];
      }
    }
  }

  return {
    ok: outcomes.some((o) => o.status === "extracted" || o.status === "already_extracted"),
    records: outcomes.map(({ stagedRef: _s, ...rest }) => rest),
  };
}

/**
 * `absences`: negative evidence from a search that returned no record (the
 * genealogist's ruling A, 2026-09-30). Code writes the collection as a source
 * and one negative assertion per person, with the fixed classification a
 * negative always takes. The log entry is the nil search's own and is not
 * written again.
 */
async function absencesMode(input: ExtractionBatchInput): Promise<ExtractionBatchResult> {
  const absences = input.absences ?? [];
  const CLASSES = new Set(["original", "derivative", "authored"]);
  const bad = absences
    .map((a, i) =>
      !a ||
      typeof a.collection !== "string" ||
      !a.collection.trim() ||
      typeof a.name !== "string" ||
      !a.name.trim() ||
      typeof a.logEntryId !== "string" ||
      !a.logEntryId.trim() ||
      (a.sourceClassification !== undefined && !CLASSES.has(a.sourceClassification))
        ? i
        : -1,
    )
    .filter((i) => i >= 0);
  if (absences.length === 0 || bad.length > 0) {
    return {
      ok: false,
      records: [],
      errors: [
        absences.length === 0
          ? "`absences` must be a non-empty list."
          : `absences[${bad.join(", ")}]: each needs \`collection\`, \`name\` and \`logEntryId\` (the nil search's log entry), and \`sourceClassification\`, if given, is original, derivative or authored.`,
      ],
    };
  }
  let research: any;
  try {
    research = await readProjectJson(input.projectPath, "research.json");
  } catch (e) {
    return { ok: false, records: [], errors: [`could not read research.json: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const logIds = new Set((Array.isArray(research.log) ? research.log : []).map((e: any) => e?.id));
  const missing = [...new Set(absences.map((a) => a.logEntryId).filter((id) => !logIds.has(id)))];
  if (missing.length > 0) {
    return {
      ok: false,
      records: [],
      errors: [`log entr${missing.length === 1 ? "y" : "ies"} ${missing.join(", ")} not found. Log the nil search with \`research_log_append\` first, then pass its logId.`],
    };
  }

  // One source per (collection, log entry): each nil search is its own source.
  // The log entry rides in `record_id`, because research_append's source-reuse
  // detection keys on record_id: keyed on the collection alone, an index search
  // and a later image browse would merge, and the second would overwrite the
  // first's source_classification. One search cannot be two kinds of search.
  const groups = new Map<string, AbsenceInput[]>();
  for (const a of absences) {
    const k = `${a.collection.trim()}|${a.logEntryId}`;
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  for (const group of groups.values()) {
    const kinds = new Set(group.map((a) => a.sourceClassification ?? "derivative"));
    if (kinds.size > 1) {
      return {
        ok: false,
        records: [],
        errors: [
          `absences for ${group[0].collection} under ${group[0].logEntryId} give ${[...kinds].join(" and ")}. ` +
            "One search is one kind of search: log an image browse as its own search, with its own logEntryId.",
        ],
      };
    }
  }
  const records: RecordOutcome[] = [];
  const accessed = todayIso();
  for (const group of groups.values()) {
    const first = group[0];
    const collection = first.collection.trim();
    const names = group.map((a) => a.name.trim());
    const sourceEntry: Record<string, unknown> = {
      citation: `${collection}${first.place ? `, ${first.place}` : ""}, searched without a match for ${names.join(", ")} (accessed ${accessed}).`,
      citation_detail: {
        who: "the searched collection",
        what: collection,
        when_created: "unknown",
        when_accessed: accessed,
        where: first.place ?? collection,
        where_within: "searched without a match",
      },
      source_classification: first.sourceClassification ?? EXTRACTED_SOURCE_CLASSIFICATION,
      repository: first.repository ?? "FamilySearch",
      access_date: accessed,
      log_entry_id: first.logEntryId,
    };
    const ops: ResearchAppendOp[] = [
      { section: "sources", op: "append", entry: sourceEntry },
      ...group.map((a) => ({
        section: "assertions" as const,
        op: "append" as const,
        entry: {
          record_id: `${collection} [${a.logEntryId}]`,
          record_role: "absent",
          fact_type: "name",
          value:
            a.note ??
            `${a.name.trim()} was expected in ${collection}${a.place ? ` (${a.place})` : ""} and is not present`,
          information_quality: "indeterminate",
          informant: "the researcher",
          informant_proximity: "researcher",
          record_basis: "absent",
          log_entry_id: a.logEntryId,
          extracted_for_question_ids: [...(a.questionIds ?? input.questionIds ?? [])],
        } as Record<string, unknown>,
      })),
    ];
    const written = await researchAppend(
      { projectPath: input.projectPath, ops, sourceDescription: { title: collection } } as ResearchAppendInput,
      { allowedSections: EXTRACTION_SECTIONS, toolName: "extraction_append" },
    );
    if (!written.ok) {
      records.push({
        recordId: collection,
        status: "refused",
        errors: written.errors,
        summary: `${collection}: the absence of ${names.join(", ")} was not written: ${written.errors.join("; ")}.`,
      });
      continue;
    }
    records.push({
      recordId: collection,
      status: "extracted",
      srcId: srcIdOf(written),
      logId: first.logEntryId,
      summary:
        `${collection}${first.place ? ` (${first.place})` : ""}: searched without a match. ` +
        `Recorded as negative evidence: ${names.join(", ")} expected and not present.`,
    });
  }
  return { ok: records.some((r) => r.status === "extracted"), records };
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
    recordSd?.citation ??
    `${title}, FamilySearch (${url ?? doc.recordId} : accessed ${accessed}).`;

  const sourceEntry: Record<string, unknown> = {
    citation,
    citation_detail: {
      who: extraction.recordType === "census" ? "the enumerated household" : "the record's parties",
      what: title,
      when_created: eventYear(gx, extraction.recordType) ?? "unknown",
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

/**
 * The year the RECORD was created, for `citation_detail.when_created`.
 *
 * Keyed on the record's own event type, not on the first dated fact found. A
 * first-fact scan is wrong on essentially every record, because `Birth` sorts
 * early and rides along on all of them: on the committed fixtures it dated a
 * 1910 marriage to 1889, an 1870 census to 1845 and an 1879 death to 1854 —
 * each the subject's birth year, and each written into a required citation
 * field as the year the record was made.
 *
 * A marriage's event fact is on the COUPLE, so relationship facts are searched
 * for the event type too. Falls back to any dated fact only when the record
 * carries none of its own event type, which is better than `unknown` and is the
 * only case where the old behaviour was right.
 */
const RECORD_EVENT_FACT: Record<string, RegExp> = {
  census: /census/i,
  marriage: /marriage/i,
  death: /death/i,
  burial: /burial|cremation/i,
  christening: /christening|baptism/i,
  birth: /birth/i,
  draft_registration: /draft|militaryservice/i,
  land: /land|property/i,
};

function eventYear(gx: SimplifiedGedcomX, recordType: string): string | undefined {
  const wanted = RECORD_EVENT_FACT[recordType];
  const year = (f: { date?: string; standard_date?: string; type?: string }) =>
    String(f.standard_date ?? f.date ?? "").match(/\d{4}/)?.[0];

  const allFacts: { type?: string; date?: string; standard_date?: string }[] = [
    ...(gx.persons ?? []).flatMap((p) => p.facts ?? []),
    ...(gx.relationships ?? []).flatMap((r) => r.facts ?? []),
  ];

  if (wanted) {
    for (const f of allFacts) {
      if (wanted.test(String(f.type ?? "")) ) {
        const y = year(f);
        if (y) return y;
      }
    }
  }
  for (const f of allFacts) {
    const y = year(f);
    if (y) return y;
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

  // BATCH MODES (issues #2937 / #2939).
  properties.recordIds = {
    type: "array",
    items: { type: "string" },
    description:
      "FAMILYSEARCH RECORDS. The records to extract, any ARK form. The tool " +
      "reads each one live, logs every read, decides roles, classifications and " +
      "assertions IN CODE, and returns a summary per record for you to relay " +
      "verbatim. A record already extracted is skipped and named. Send with " +
      "`questionIds` and, for a person expected on one of these records and not " +
      "found, `absentPersons` with that record's `recordId`.",
  };
  properties.absences = {
    type: "array",
    items: {
      type: "object",
      properties: {
        collection: { type: "string", description: "The collection searched, by title." },
        place: { type: "string", description: "Where the search was scoped." },
        name: { type: "string", description: "Who was expected and not found." },
        note: { type: "string", description: "The assertion's value; defaults to a sentence naming the person." },
        logEntryId: { type: "string", description: "The nil search's own log entry." },
        questionIds: { type: "array", items: { type: "string" } },
        repository: { type: "string", description: "Defaults to FamilySearch." },
        sourceClassification: {
          type: "string",
          enum: ["original", "derivative", "authored"],
          description:
            "What was searched. `derivative` (the default) for an index search; " +
            "`original` when the page images themselves were browsed.",
        },
      },
      required: ["collection", "name", "logEntryId"],
    },
    description:
      "NEGATIVE EVIDENCE FROM A NIL SEARCH. People a search expected and did not " +
      "find, when there is no record to extract. Each is written in code as a " +
      "negative assertion against the collection searched. Log the nil search " +
      "with `research_log_append` first and pass its `logEntryId`.",
  };
  properties.absentPersons = {
    ...properties.absentPersons,
    items: {
      ...properties.absentPersons.items,
      properties: {
        ...properties.absentPersons.items.properties,
        recordId: {
          type: "string",
          description: "With `recordIds`: which of those records this person was expected on.",
        },
      },
    },
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

// extraction_append — extraction in code, for research.json's `sources` and
// `assertions` sections.
//
// Three call shapes, exactly one per call: `recordIds` (FamilySearch records,
// read live and extracted from the index), `documents` (any other source,
// structured by the record-structurer agent), and `absences` (negative evidence
// from a nil search). In every shape the roles and the three classification
// layers are decided HERE, from the extraction table; no caller supplies them,
// and the input has nowhere to put them.
//
// WHY A SECOND TOOL RATHER THAN A PARAMETER (issue #695): in the birkeland run
// the router's delegation message instructed the extractor to write
// `person_evidence` entries at `confident`, against the agent body's prose lane
// rule, and the agent complied — fabricating a match_score no tool had computed.
// A lane expressed as prose loses to a caller that prompts against it, and a
// lane expressed as a tool PARAMETER is forgeable by the caller. A lane
// expressed as tool identity is not. The durable record of that reasoning is
// ADR-0006, "Restrict capability by tool identity, not by prompt or parameter",
// whose `Applies to:` names this file.
//
// The section restriction is passed as a second function argument to
// `researchAppend`, NOT as a field on the tool input — see
// `ResearchAppendOptions` for why that distinction is what makes it unforgeable.
// It is chosen per call (ADR-0006, amended 2026-10-20). Beyond the extraction
// write, code composes two more: a re-found record's assertions gain the
// caller's question ids, and the plan item behind an extracted record moves
// from `in_progress` to `completed` in a `plan_items`-only call.

import {
  researchAppend,
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
import { readProjectJson, NoProjectError, noProjectResult } from "../utils/project-io.js";
import { readStagedResults, STAGING_SUBDIR } from "../utils/results-staging.js";
import { arkToBareId } from "../utils/ark.js";
import type { SimplifiedGedcomX } from "../types/gedcomx.js";
import { VALIDATOR_ENUMS } from "../validation/validator.js";
import type { Principal } from "../auth/principal.js";
import { recordReadTool } from "./record-read.js";
import type { RecordReadInput, RecordReadResult } from "../types/record-read.js";
import { researchLogAppend } from "./research-log-append.js";
import { mapWithConcurrency } from "../utils/place-resolver.js";
import { sourceIdsForRecordIds, activePlanItems } from "./research-append.js";
import { summarizeExtraction, censusStatedRelationships, detectRecordType } from "../utils/record-extract.js";
import {
  validateStructuredDocument,
  documentToExtract,
  type StructuredDocument,
} from "../utils/structured-document.js";

/** The sections extraction writes: one record's source plus its assertions, and
 *  the question ids a re-found record gains. */
export const EXTRACTION_SECTIONS: ReadonlySet<string> = new Set([
  "sources",
  "assertions",
]);

/** The one section the plan-item completion write reaches. Code composes the
 *  whole op (`in_progress` → `completed`), so no input field reaches it
 *  (ADR-0006, amended 2026-10-20). */
export const PLAN_COMPLETION_SECTIONS: ReadonlySet<string> = new Set(["plan_items"]);

type BatchCall = ExtractionBatchInput &
  ({ recordIds: string[] } | { absences: AbsenceInput[] } | { documents: DocumentInput[] });

export async function extractionAppend(
  input: BatchCall,
  principal: Principal,
): Promise<ExtractionBatchResult> {
  return runExtractionAppend(input, DEFAULT_DEPS, principal);
}

/** `extractionAppend` with its record reader injected. The harness and the tests
 *  call this; production goes through `extractionAppend`. */
export async function runExtractionAppend(
  input: BatchCall,
  deps: ExtractionAppendDeps,
  principal: Principal,
): Promise<ExtractionBatchResult> {
  const MODES = ["recordIds", "documents", "absences"] as const;
  const got = MODES.filter((k) => (input as any)?.[k] !== undefined);
  // The hand-built forms, in both spellings (`ops`, and one flat op), and the
  // one-record extractor mode (`logEntryId` + `recordId`).
  const retired = (["ops", "section", "op", "entry", "entryId", "fields", "logEntryId", "recordId"] as const).filter((k) => (input as any)?.[k] !== undefined);
  if (retired.length > 0) {
    return {
      ok: false,
      records: [],
      errors: [
        `extraction_append no longer takes ${retired.map((k) => `\`${k}\``).join(" or ")}: roles and ` +
          "classifications are decided in code, so there is nothing for a caller to compose. Send " +
          "`recordIds` for FamilySearch records, `documents` (from the record-structurer agent) for " +
          "any other source, or `absences` for people a search did not find. Correcting an " +
          "existing assertion is not an extraction and is not done here.",
      ],
    };
  }
  if (got.length !== 1) {
    return {
      ok: false,
      records: [],
      errors: [
        (got.length === 0
          ? "extraction_append received none of `recordIds`, `documents` or `absences`. "
          : `extraction_append received ${got.map((k) => `\`${k}\``).join(" and ")} together. `) +
          "Send exactly one: `recordIds` to extract FamilySearch records, `documents` for any other " +
          "source, or `absences` to record people a search did not find.",
      ],
    };
  }
  // Both documents, before any read or write: a folder that is not a project is
  // an answer (`reason: "no_project"`), and half a project stays loud, as on
  // every other writer.
  try {
    await readProjectJson(input.projectPath, "research.json");
    await readProjectJson(input.projectPath, "tree.gedcomx.json");
  } catch (e) {
    if (e instanceof NoProjectError) return { ...noProjectResult(), records: [] };
    return { ok: false, records: [], errors: [e instanceof Error ? e.message : String(e)] };
  }
  if (input.recordIds !== undefined) return recordIdsMode(input, deps, principal);
  if (input.absences !== undefined) return absencesMode(input);
  return documentsMode(input);
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

/** One unindexed source the record-structurer agent read (spec §11.7). */
export interface DocumentInput {
  /** `capture:<descriptive>`, `ancestry:<collection>:<id>`, or an ARK. */
  recordId: string;
  document: StructuredDocument;
  /** The `results/` ref of the StagedTranscription the agent read. */
  transcriptionRef?: string;
  /** `image_transcribe`'s imageRef. The source's image_filename comes from the
   *  staged transcription's `image_ref` when it has one; this is the fallback. */
  imageFilename?: string;
}

export interface ExtractionBatchInput {
  projectPath: string;
  recordIds?: string[];
  absences?: AbsenceInput[];
  documents?: DocumentInput[];
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
  /** The one `ok: false` that is an answer: `projectPath` is not a project. */
  reason?: "no_project";
  /** Plan items this call completed, present only when it touched one. */
  planItems?: PlanItemsOutcome;
}

const READ_CONCURRENCY = 4;

function srcIdOf(result: ResearchAppendResult): string | undefined {
  if (!result.ok || !("results" in result)) return undefined;
  return result.results.find((r) => r.section === "sources")?.entryId;
}

/**
 * The log entry this record already has, which extraction cites instead of
 * logging a second one. Two kinds, the first found wins:
 *
 * - `hint`: the entry an accepted FamilySearch hint left. That is the LATEST
 *   `person_record_matches` verdict naming the record's ark, when it is
 *   positive and no assertion cites it yet; a later negative verdict rejects
 *   the hint. `search-hints` logs it with no sidecar, because the hint stages
 *   nothing, so the record is still read live and only the entry is reused.
 *   Without that the hint's own entry stays unreferenced and the router sends
 *   the record back to extraction on every pass.
 * - `read`: the latest uncited `record_read` of this record whose sidecar still
 *   holds it. The read is reused rather than repeated. A census row is reused
 *   only when it carries `indexFields`, the per-persona index data an older
 *   read did not stage. Any doubt about the sidecar falls back to a live read.
 */
async function reusableLogEntry(
  projectPath: string,
  research: any,
  bareId: string,
  citedLogIds: ReadonlySet<unknown>,
): Promise<{ logId: string; resultsRef: string | null; kind: "hint" | "read" } | undefined> {
  const log: any[] = Array.isArray(research.log) ? research.log : [];
  const verdicts = log.filter(
    (e) =>
      e?.tool === "person_record_matches" &&
      typeof e?.query?.recordId === "string" &&
      arkToBareId(e.query.recordId) === bareId,
  );
  const latest = verdicts[verdicts.length - 1];
  if (latest?.outcome === "positive" && !citedLogIds.has(latest.id) && typeof latest.id === "string") {
    return { logId: latest.id, resultsRef: null, kind: "hint" };
  }
  const reads = log.filter(
    (e) =>
      e?.tool === "record_read" &&
      typeof e?.id === "string" &&
      typeof e?.results_ref === "string" &&
      typeof e?.query?.recordId === "string" &&
      arkToBareId(e.query.recordId) === bareId &&
      !citedLogIds.has(e.id),
  );
  for (const e of reads.reverse()) {
    try {
      const rows = await readStagedResults(projectPath, e.results_ref);
      const row: any = rows.find((r: any) => typeof r?.recordId === "string" && arkToBareId(r.recordId) === bareId);
      if (!row?.gedcomx) continue;
      if (detectRecordType(row.gedcomx) === "census" && !row.indexFields) continue;
      return { logId: e.id, resultsRef: e.results_ref, kind: "read" };
    } catch {
      continue;
    }
  }
  return undefined;
}

/**
 * A question claims a record extracted before it existed (lead, 2026-10-20):
 * the ids are appended to every assertion of that record that lacks one, and
 * never removed. The update arm validates the merged entry, so an assertion
 * written before a later rule refuses the batch; each is then tried alone and
 * the ones still refused are named.
 */
async function tieRecordToQuestions(
  projectPath: string,
  research: any,
  bareId: string,
  questionIds: readonly string[],
): Promise<{ tied: string[]; warnings: string[] }> {
  const ops: ResearchAppendOp[] = [];
  for (const a of Array.isArray(research.assertions) ? research.assertions : []) {
    if (!a || typeof a.id !== "string" || typeof a.record_id !== "string" || arkToBareId(a.record_id) !== bareId) continue;
    const have: string[] = Array.isArray(a.extracted_for_question_ids) ? a.extracted_for_question_ids : [];
    const add = questionIds.filter((q) => !have.includes(q));
    if (add.length === 0) continue;
    ops.push({ section: "assertions", op: "update", entryId: a.id, fields: { extracted_for_question_ids: [...have, ...add] } });
  }
  if (ops.length === 0) return { tied: [], warnings: [] };
  const opts = { allowedSections: EXTRACTION_SECTIONS, toolName: "extraction_append" };
  const whole = await researchAppend({ projectPath, ops } as ResearchAppendInput, opts);
  if (whole.ok) return { tied: ops.map((o) => o.entryId!), warnings: [] };
  const tied: string[] = [];
  const warnings: string[] = [];
  for (const op of ops) {
    const one = await researchAppend({ projectPath, ops: [op] } as ResearchAppendInput, opts);
    if (one.ok) tied.push(op.entryId!);
    else warnings.push(`${op.entryId} was not tied to ${questionIds.join(", ")}: ${one.errors.join("; ")}`);
  }
  return { tied, warnings };
}

/** What `completePlanItems` did, for the result. */
export interface PlanItemsOutcome {
  completed: string[];
  errors?: string[];
}

/**
 * Completes the plan item behind a record this call extracted or re-sent. An
 * `in_progress` item on an active plan completes once ANY of its plan-tied
 * positive or partial `record_search` entries lists, in its sidecar, a record
 * that now has an assertion (lead, 2026-10-19: "every entry" left 124 of 617
 * previously-completed FamilySearch items stuck, and one extraction already
 * puts "the plan item's evidence in hand", lead, 2026-08-23). Read off the
 * saved results, so a reused read, a re-send and a record two items both found
 * are covered alike (lead, 2026-10-20). Only `record_search` sidecars: a
 * full-text result names an image, never a record. Each item is its own write,
 * because one refused item fails a whole batch; a refusal is reported and
 * never fails the extraction.
 */
async function completePlanItems(
  projectPath: string,
  bareIds: ReadonlySet<string>,
): Promise<PlanItemsOutcome | undefined> {
  if (bareIds.size === 0) return undefined;
  let research: any;
  try {
    research = await readProjectJson(projectPath, "research.json");
  } catch {
    return undefined;
  }
  const log: any[] = Array.isArray(research.log) ? research.log : [];
  const extracted = [...bareIds].filter((b) => sourceIdsForRecordIds(research, new Set([b])).size > 0);
  if (extracted.length === 0) return undefined;
  const sidecarCache = new Map<string, Set<string>>();
  const listed = async (ref: string): Promise<Set<string>> => {
    let ids = sidecarCache.get(ref);
    if (!ids) {
      ids = new Set<string>();
      try {
        for (const r of (await readStagedResults(projectPath, ref)) as any[]) {
          if (typeof r?.recordId === "string") ids.add(arkToBareId(r.recordId));
        }
      } catch {
        // An unreadable sidecar lists nothing; the item stays as it is.
      }
      sidecarCache.set(ref, ids);
    }
    return ids;
  };
  const completed: string[] = [];
  const errors: string[] = [];
  for (const item of activePlanItems(research, () => true)) {
    const searches = log.filter(
      (e) =>
        e?.plan_item_id === item.itemId &&
        e?.tool === "record_search" &&
        (e?.outcome === "positive" || e?.outcome === "partial") &&
        typeof e?.results_ref === "string",
    );
    let hit = false;
    for (const e of searches) {
      const ids = await listed(e.results_ref);
      if (extracted.some((b) => ids.has(b))) {
        hit = true;
        break;
      }
    }
    if (!hit) continue;
    const written = await researchAppend(
      {
        projectPath,
        ops: [{ section: "plan_items", op: "update", planId: item.planId, entryId: item.itemId, fields: { status: "completed" } }],
      } as ResearchAppendInput,
      { allowedSections: PLAN_COMPLETION_SECTIONS, toolName: "extraction_append" },
    );
    if (written.ok) completed.push(item.itemId);
    else errors.push(`${item.itemId} was not completed: ${written.errors.join("; ")}`);
  }
  if (completed.length === 0 && errors.length === 0) return undefined;
  return errors.length > 0 ? { completed, errors } : { completed };
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
  const outcomes: (RecordOutcome & { stagedRef?: string; hintLogId?: string })[] = [];
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
      await tieOutcome(o, input.projectPath, research, input.questionIds);
    }
  }

  // 2. The entry a record nothing has extracted yet already has. A reused read
  //    is neither read nor logged again. An accepted hint keeps precedence; it
  //    has no sidecar, so the record is still read and only its entry is cited.
  const assertionLogIds = new Set(
    (Array.isArray(research.assertions) ? research.assertions : []).map((a: any) => a?.log_entry_id),
  );
  for (const o of outcomes) {
    if (o.status !== "extracted") continue;
    const reused = await reusableLogEntry(input.projectPath, research, arkToBareId(o.recordId), assertionLogIds);
    if (reused?.kind === "hint") {
      o.hintLogId = reused.logId;
    } else if (reused) {
      o.logId = reused.logId;
      o.stagedRef = reused.resultsRef!;
    }
  }

  // 3. Reads, in parallel. An error or an unstaged read is reported and skipped.
  const toRead = outcomes.filter((o) => o.status === "extracted" && !o.logId);
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
    // 4. ONE log batch for every fresh read, except a record an accepted hint
    //    already logged: that entry is the record's own and is reused, never a
    //    second. A reused read (step 2) already carries its entry.
    const reusedHint = new Set<string>();
    for (const o of staged) {
      if (o.logId || !o.hintLogId) continue;
      o.logId = o.hintLogId;
      reusedHint.add(o.recordId);
    }
    const fresh = staged.filter((o) => !o.logId);
    const logged = fresh.length === 0
      ? { ok: true as const, results: [] as { logId: string; resultsRef?: string | null }[] }
      : await researchLogAppend({
          projectPath: input.projectPath,
          ops: fresh.map((o) => ({
            tool: "record_read",
            query: { recordId: o.recordId },
            outcome: "positive",
            resultsExamined: 1,
            stagedResultsRef: o.stagedRef!,
          })),
        });
    if (!logged.ok || !("results" in logged)) {
      const errs = (logged as any).errors ?? ["research_log_append refused the batch"];
      for (const o of fresh) {
        o.status = "refused";
        o.errors = errs;
        o.summary = `${o.recordId}: not extracted, because logging the read was refused: ${errs.join("; ")}.`;
      }
    } else {
      logged.results.forEach((lr, i) => {
        fresh[i].logId = lr.logId;
        fresh[i].stagedRef = lr.resultsRef ?? fresh[i].stagedRef;
      });
    }

    // 5. One research_append per logged record. A record reusing a hint's or
    //    a read's entry does not depend on the batch above, so a refused batch
    //    leaves it to be written.
    for (const o of staged) {
      if (o.status !== "extracted" || !o.logId) continue;
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
        { logEntryId: o.logId!, questionIds: input.questionIds, absentPersons: absent },
      );
      // A hint's log entry keeps no sidecar, and a persona id must resolve
      // against one: an assertion under it carries none.
      if (reusedHint.has(o.recordId)) {
        for (const op of ops as any[]) if (op?.entry && "record_persona_id" in op.entry) op.entry.record_persona_id = null;
      }
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

  const planItems = await completePlanItems(input.projectPath, landedBareIds(outcomes));
  return {
    ok: outcomes.some((o) => o.status === "extracted" || o.status === "already_extracted"),
    records: outcomes.map(({ stagedRef: _s, hintLogId: _h, ...rest }) => rest),
    ...(planItems ? { planItems } : {}),
  };
}

/** The records this call extracted or found already extracted. */
function landedBareIds(outcomes: readonly RecordOutcome[]): Set<string> {
  return new Set(
    outcomes
      .filter((o) => o.status === "extracted" || o.status === "already_extracted")
      .map((o) => arkToBareId(o.recordId)),
  );
}

/** The resend skip's question tie, folded into the record's outcome. */
async function tieOutcome(
  o: RecordOutcome,
  projectPath: string,
  research: any,
  questionIds: readonly string[] | undefined,
): Promise<void> {
  if (!questionIds || questionIds.length === 0) return;
  const { tied, warnings } = await tieRecordToQuestions(projectPath, research, arkToBareId(o.recordId), questionIds);
  if (tied.length > 0) o.summary = `${o.recordId}: already extracted as ${o.srcId}; tied to ${questionIds.join(", ")}.`;
  if (warnings.length > 0) o.warnings = [...(o.warnings ?? []), ...warnings];
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
  const CLASSES = new Set<string>(VALIDATOR_ENUMS.source_classification);
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

// ─── documents (issue #2939, spec §11.7) ───────────────────────────────────

const FORM_NOTE: Record<string, string> = {
  page_image: "read from a machine transcription of the page image",
  verbatim_transcript: "read from a transcript of the record",
  index_entry: "read from an index entry",
  abstract: "read from an abstract",
  compiled_work: "read from a compiled work",
};

/** The source entry for a document. `derivative` for everything but a compiled
 *  work (genealogist ruling, 2026-09-30): nothing on this path is `original`. */
function buildDocumentSource(
  d: DocumentInput,
  logEntryId: string,
  transcription: string | undefined,
  stagedImageRef: string | undefined,
): Record<string, unknown> {
  const src = d.document.source;
  // Derived at the write boundary, like transcription_truncated: the scan the
  // staged text was read from beats whatever the agent relayed.
  const imageFilename = stagedImageRef ?? d.imageFilename;
  const accessed = todayIso();
  const head = [src.title, src.creator, src.created, src.locator].filter(Boolean).join(", ");
  return {
    citation: `${head} (${src.url ? `${src.url} : ` : ""}accessed ${accessed}).`,
    citation_detail: {
      who: src.creator ?? "the record's parties",
      what: src.title,
      when_created: src.created ?? "unknown",
      when_accessed: accessed,
      where: src.repository,
      where_within: src.locator ?? d.recordId,
    },
    source_classification: d.document.documentForm === "compiled_work" ? "authored" : "derivative",
    repository: src.repository,
    access_date: accessed,
    log_entry_id: logEntryId,
    notes: [FORM_NOTE[d.document.documentForm], src.notes].filter(Boolean).join(". "),
    ...(src.url ? { url: src.url } : {}),
    ...(transcription ? { transcription } : {}),
    ...(imageFilename ? { image_filename: imageFilename } : {}),
  };
}

/**
 * `documents`: every document is validated before anything is written, so one
 * malformed document refuses the batch and writes nothing. Then, as for
 * `recordIds`: the resend skip, one log batch, and one research_append per
 * source.
 */
async function documentsMode(input: ExtractionBatchInput): Promise<ExtractionBatchResult> {
  const docs = input.documents ?? [];
  const errors: string[] = [];
  if (!Array.isArray(docs) || docs.length === 0) errors.push("`documents` must be a non-empty list.");
  (Array.isArray(docs) ? docs : []).forEach((d, i) => {
    if (!d || typeof d.recordId !== "string" || d.recordId.trim() === "") errors.push(`documents[${i}].recordId: required`);
    if (d?.transcriptionRef !== undefined && (typeof d.transcriptionRef !== "string" || !d.transcriptionRef.startsWith("results/"))) {
      errors.push(`documents[${i}].transcriptionRef: must be a results/ ref`);
    }
    // A person the text gives no facts for may omit `facts`: absent means none.
    // Only a missing list is filled in; anything else still goes to the validator.
    for (const p of Array.isArray(d?.document?.persons) ? d.document.persons : []) {
      if (p && typeof p === "object" && (p as { facts?: unknown }).facts === undefined) {
        (p as { facts: unknown[] }).facts = [];
      }
    }
    errors.push(...validateStructuredDocument(d?.document, `documents[${i}].document`));
  });
  if (errors.length > 0) return { ok: false, records: [], errors };

  let research: any;
  try {
    research = await readProjectJson(input.projectPath, "research.json");
  } catch (e) {
    return { ok: false, records: [], errors: [`could not read research.json: ${e instanceof Error ? e.message : String(e)}`] };
  }

  type DocOutcome = RecordOutcome & { d: DocumentInput };
  const outcomes: DocOutcome[] = docs.map((d) => ({
    recordId: d.recordId.trim(),
    status: "extracted",
    summary: "",
    d,
  }));
  for (const o of outcomes) {
    const existing = sourceIdsForRecordIds(research, new Set([arkToBareId(o.recordId)]));
    if (existing.size > 0) {
      o.status = "already_extracted";
      o.srcId = [...existing][0];
      o.summary = `${o.recordId}: already extracted as ${o.srcId}; nothing written.`;
      await tieOutcome(o, input.projectPath, research, input.questionIds);
    }
  }

  // A transcription already finalized under its own log entry (a
  // `results/<log_id>.json`) is cited, not logged a second time as a
  // `user_provided` entry, which would drop the scan's text from the source.
  const log: any[] = Array.isArray(research.log) ? research.log : [];
  const cited = new Map<DocOutcome, { logId: string; resultsRef: string }>();
  for (const o of outcomes) {
    const ref = o.d.transcriptionRef;
    if (o.status !== "extracted" || !ref || ref.startsWith(`${STAGING_SUBDIR}/`)) continue;
    const entry = log.find((e) => e?.results_ref === ref && typeof e?.id === "string");
    if (entry) {
      cited.set(o, { logId: entry.id, resultsRef: ref });
    } else {
      o.status = "refused";
      o.summary = `${o.recordId}: its transcriptionRef ${ref} is a finalized result no log entry names, so it cannot be cited.`;
    }
  }

  const todo = outcomes.filter((o) => o.status === "extracted");
  if (todo.length > 0) {
    const toLog = todo.filter((o) => !cited.has(o));
    const logged = toLog.length === 0
      ? { ok: true as const, results: [] as { logId: string; resultsRef?: string | null }[] }
      : await researchLogAppend({
          projectPath: input.projectPath,
          ops: toLog.map((o) =>
            o.d.transcriptionRef
              ? { tool: "image_transcribe", query: { recordId: o.recordId }, outcome: "positive", resultsExamined: 1, stagedResultsRef: o.d.transcriptionRef }
              : { tool: "user_provided", query: { recordId: o.recordId }, outcome: "positive", resultsExamined: 1 },
          ),
        });
    const logRefused = !logged.ok || !("results" in logged);
    if (logRefused) {
      const errs = (logged as any).errors ?? ["research_log_append refused the batch"];
      for (const o of toLog) {
        o.status = "refused";
        o.errors = errs;
        o.summary = `${o.recordId}: not extracted, because logging it was refused: ${errs.join("; ")}.`;
      }
    }
    {
      const loggedResults = logRefused ? [] : (logged as { results: { logId: string; resultsRef?: string | null }[] }).results;
      for (const o of todo) {
        if (o.status !== "extracted") continue;
        const c = cited.get(o);
        const lr = c ? { logId: c.logId, resultsRef: c.resultsRef } : loggedResults[toLog.indexOf(o)];
        o.logId = lr.logId;
        let transcription: string | undefined;
        let stagedImageRef: string | undefined;
        if (o.d.transcriptionRef && lr.resultsRef) {
          try {
            const rows = await readStagedResults(input.projectPath, lr.resultsRef);
            const row = (rows as any[]).find((r) => typeof r?.transcription === "string");
            if (row?.transcription) transcription = row.transcription;
            if (typeof row?.image_ref === "string" && row.image_ref) stagedImageRef = row.image_ref;
          } catch {
            // The transcription is a copy for the viewer; its absence is not a
            // reason to refuse the extraction. §5.4's warning still fires.
          }
        }
        const { extract, mode } = documentToExtract(o.recordId, o.d.document, censusStatedRelationships);
        const extraction = extractRecord(extract, { logEntryId: lr.logId, questionIds: input.questionIds ?? [], mode });
        const ops: ResearchAppendOp[] = [
          { section: "sources", op: "append", entry: buildDocumentSource(o.d, lr.logId, transcription, stagedImageRef) },
          ...extraction.assertions.map((a) => ({
            section: "assertions" as const,
            op: "append" as const,
            entry: a as unknown as Record<string, unknown>,
          })),
          ...(o.d.document.absentPersons ?? []).map((p) => ({
            section: "assertions" as const,
            op: "append" as const,
            entry: {
              record_id: o.recordId,
              record_role: "absent",
              fact_type: p.factType ?? "name",
              value: p.note ?? `${p.name} was expected in this record and is not present`,
              information_quality: "indeterminate",
              informant: "the researcher",
              informant_proximity: "researcher",
              record_basis: "absent",
              log_entry_id: lr.logId,
              extracted_for_question_ids: [...(input.questionIds ?? [])],
            } as Record<string, unknown>,
          })),
        ];
        const src = o.d.document.source;
        const written = await researchAppend(
          {
            projectPath: input.projectPath,
            ops,
            sourceDescription: src.url ? { title: src.title, url: src.url } : { title: src.title },
          } as ResearchAppendInput,
          { allowedSections: EXTRACTION_SECTIONS, toolName: "extraction_append" },
        );
        if (!written.ok) {
          o.status = "refused";
          o.errors = written.errors;
          o.summary = `${o.recordId}: logged as ${lr.logId}, but the write was refused: ${written.errors.join("; ")}.`;
          continue;
        }
        o.srcId = srcIdOf(written);
        o.summary = summarizeExtraction(extract, extraction);
        o.warnings = [...written.validation.warnings, ...extraction.defaultedClassifications];
      }
    }
  }
  const planItems = await completePlanItems(input.projectPath, landedBareIds(outcomes));
  return {
    ok: outcomes.some((o) => o.status === "extracted" || o.status === "already_extracted"),
    records: outcomes.map(({ d: _d, ...rest }) => rest),
    ...(planItems ? { planItems } : {}),
  };
}

// ─── one FamilySearch record's ops ──────────────────────────────────────────

/** What `buildExtractionOps` needs beyond the record: which log entry read it,
 *  which questions it serves, and who was expected on it and absent. */
interface ExtractionOpsInput {
  logEntryId: string;
  questionIds?: string[];
  /** Persons expected in this record and NOT found. The extractor never emits
   *  the literal `record_role: "absent"` itself; negative evidence is a claim
   *  about what the record does not contain, which no document can supply. */
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
  input: ExtractionOpsInput,
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


const QUESTION_IDS = {
  type: "array",
  items: { type: "string" },
  description:
    "The open questions this extraction serves. Yours to decide — it is relative to " +
    "the research question, not to the record — and stamped on every assertion written.",
};

export const extractionAppendSchema = {
  name: "extraction_append",
  description:
    "Extract records into research.json IN CODE: each record's source entry plus " +
    "one assertion per fact, with roles and the three classification layers " +
    "decided from the extraction table. You compose none of them, and the input " +
    "has no field for them. Writes the `sources` and `assertions` sections, and " +
    "completes the in-progress plan item whose search found a record it " +
    "extracts.\n" +
    "\n" +
    "Send EXACTLY ONE of:\n" +
    "- `recordIds` — FamilySearch records, any ARK form. Each is extracted from " +
    "the index: read live and logged, or, when an earlier read of it is on file, " +
    "that read is reused. A " +
    "record already extracted is skipped and named, and tied to `questionIds`.\n" +
    "- `documents` — any other source (a transcription, an upload, pasted text), " +
    "as structured by the record-structurer agent. Every document is validated " +
    "before anything is written; an unknown key is refused.\n" +
    "- `absences` — people a search expected and did not find, when there is no " +
    "record to extract. Log the nil search with `research_log_append` first.\n" +
    "\n" +
    "Returns one outcome per record, each with a code-written `summary`: relay " +
    "it verbatim, since you do not see the record yourself. Identity links " +
    "(`person_evidence`) are NOT written here; a correction to an existing " +
    "assertion goes through `research_append`.",
  inputSchema: {
    type: "object",
    properties: {
      projectPath: {
        type: "string",
        description: "Absolute path to the project folder holding research.json.",
      },
      recordIds: {
        type: "array",
        items: { type: "string" },
        description:
          "FAMILYSEARCH RECORDS. The records to extract, any ARK form. Send with " +
          "`questionIds` and, for a person expected on one of these records and not " +
          "found, `absentPersons` with that record's `recordId`.",
      },
      questionIds: QUESTION_IDS,
      absentPersons: {
        type: "array",
        items: {
          type: "object",
          properties: {
            recordId: {
              type: "string",
              description: "Which of the `recordIds` this person was expected on.",
            },
            name: { type: "string", description: "Who was expected." },
            factType: { type: "string", description: "Defaults to `name`." },
            note: {
              type: "string",
              description:
                "The assertion's value. Keep the person's identity in it rather " +
                "than a generic phrase shared across several people.",
            },
          },
          required: ["recordId", "name"],
        },
        description:
          "With `recordIds`: persons expected on one of those records and NOT found, " +
          "written as negative evidence. Yours to supply, because a claim about who " +
          "is MISSING cannot be read off the record.",
      },
      documents: {
        type: "array",
        items: {
          type: "object",
          properties: {
            recordId: {
              type: "string",
              description:
                "`capture:<descriptive>`, `ancestry:<collection>:<id>`, or the source's ARK.",
            },
            document: {
              type: "object",
              description:
                "The structured document, in the shape the record-structurer agent's " +
                "instructions give. Validated in code; any other key is refused.",
            },
            transcriptionRef: {
              type: "string",
              description: "The `results/` ref of the transcription the document was read from.",
            },
            imageFilename: {
              type: "string",
              description: "`image_transcribe`'s imageRef, when the source is a page image.",
            },
          },
          required: ["recordId", "document"],
        },
        description:
          "ANY OTHER SOURCE. One entry per source, each written as its own source " +
          "entry and log entry. Send with `questionIds`.",
      },
      absences: {
        type: "array",
        items: {
          type: "object",
          properties: {
            collection: { type: "string", description: "The collection searched, by title." },
            place: { type: "string", description: "Where the search was scoped." },
            name: { type: "string", description: "Who was expected and not found." },
            note: {
              type: "string",
              description: "The assertion's value; defaults to a sentence naming the person.",
            },
            logEntryId: { type: "string", description: "The nil search's own log entry." },
            questionIds: QUESTION_IDS,
            repository: { type: "string", description: "Defaults to FamilySearch." },
            sourceClassification: {
              type: "string",
              enum: [...VALIDATOR_ENUMS.source_classification],
              description:
                "What was searched. `derivative` (the default) for an index search; " +
                "`original` when the page images themselves were browsed.",
            },
          },
          required: ["collection", "name", "logEntryId"],
        },
        description:
          "NEGATIVE EVIDENCE FROM A NIL SEARCH. Each person is written in code as a " +
          "negative assertion against the collection searched.",
      },
    },
    required: ["projectPath"],
  },
};

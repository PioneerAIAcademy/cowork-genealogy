// research_log_append — append one entry to research.json `log[]` and, when a
// search retained raw results, finalize its results/<log_id>.json sidecar —
// atomically and schema-valid. Append-only by GPS rule (no update/delete).
//
// The tool owns the clerical work the four writing skills do by hand today: id
// assignment, timestamping, the three-way results_ref↔log_id↔filename wiring,
// returned_count integrity, camelCase→snake_case rename, and the atomic write.
// The raw payload reaches disk via host-side staging (search-result-staging-
// spec.md) — it never round-trips through the model. Spec: research-log-editor-spec.md.
//
// Batch form (`ops[]`, added 2026-07-26): mirrors research_append/tree_edit/
// materialize_facts's ops[] convention — validate-once/write-once/all-or-
// nothing on research.json. One wrinkle those tools don't have: a sidecar
// finalization is a REAL file write that happens as each op is applied, not a
// pure in-memory mutation deferred to the final commit — so a batch tracks
// every sidecar it creates and unlinks all of them (not just the failing op's)
// on any later failure, exactly mirroring the single-call path's existing
// orphan-cleanup behavior, just extended to a list.

import { join } from "path";
import { readFile, unlink } from "fs/promises";
import { validateParsed } from "../validation/validator.js";
import { sanitizeTree } from "../validation/tree-sanitize.js";
import type { ValidationError } from "../validation/types.js";
import { atomicWriteJson } from "../utils/project-io.js";
import { finalizeStagedResults } from "../utils/results-staging.js";
import { coerceJsonArg } from "../utils/coerce-json-arg.js";

const EXTERNAL_SITE_VALUES = new Set([
  "ancestry",
  "myheritage",
  "findmypast",
  "findagrave",
  "newspapers",
  "familysearch_web",
]);
const OUTCOME_VALUES = new Set(["positive", "negative", "partial", "error"]);

export interface ResearchLogAppendExternalSite {
  site: string;
  urlGenerated: string;
  captureReceived: boolean;
  captureFilename?: string | null;
}

/** One log entry — the body of a single call, or one element of a batch `ops`. */
export interface ResearchLogAppendOp {
  tool: string;
  query: unknown;
  outcome: string;
  resultsExamined: number;
  planItemId?: string | null;
  resultsAvailable?: number | null;
  notes?: string | null;
  externalSite?: ResearchLogAppendExternalSite | null;
  stagedResultsRef?: string | null;
}

export interface ResearchLogAppendInput extends Partial<ResearchLogAppendOp> {
  projectPath: string;
  // Batch form — supply ops; when present the single-op fields above are
  // ignored. Every op applies to one in-memory research.json (log ids assigned
  // in order), validates ONCE, and writes research.json ONCE (all-or-nothing).
  // Each op's sidecar (if it stages results) is still written as that op is
  // applied — see the module comment on why that's the one place this tool's
  // batching isn't purely in-memory, and how failure cleanup handles it.
  ops?: ResearchLogAppendOp[];
}

/** The per-entry result payload — the body of a single call's success, or one
 *  element of a batch `results`. */
export interface ResearchLogAppendOpResult {
  logId: string;
  performed: string;
  resultsRef: string | null;
  returnedCount: number | null;
}

export type ResearchLogAppendResult =
  | ({
      ok: true;
      filesWritten: string[];
      validation: { valid: true; warnings: string[] };
    } & ResearchLogAppendOpResult)
  | {
      ok: true;
      /** One entry per `ops[]` element, in order — the batch form. */
      results: ResearchLogAppendOpResult[];
      filesWritten: string[];
      validation: { valid: true; warnings: string[] };
    }
  | { ok: false; errors: string[] };

/** Raised for expected input problems; turned into `{ ok: false }`. */
class LogAppendError extends Error {}

/**
 * Coerce an object-typed tool argument that a model emitted as a JSON string
 * back into an object. Some models stringify nested-object params (observed
 * with `externalSite`: the call arrives as `"{\"site\":...}"` rather than an
 * object, so a downstream `value.site` reads `undefined` and the call fails
 * opaquely). No-op for non-string values (object/null/undefined pass through);
 * throws `LogAppendError` when a string is present but isn't a JSON object.
 */
function coerceObjectArg(value: unknown, field: string): unknown {
  if (typeof value !== "string") return value;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new LogAppendError(
      `${field} must be an object, not a string (received unparseable text)`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new LogAppendError(`${field} must be a JSON object`);
  }
  return parsed;
}

function formatIssues(issues: ValidationError[]): string[] {
  return issues.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message));
}

async function readProjectJson(projectPath: string, filename: string): Promise<any> {
  let text: string;
  try {
    text = await readFile(join(projectPath, filename), "utf-8");
  } catch {
    throw new LogAppendError(`${filename} not found in projectPath`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new LogAppendError(`${filename} is not valid JSON`);
  }
}

/** Next `log_NNN` id above the current max (max + 1, not count + 1). */
function nextLogId(log: any[]): string {
  let max = 0;
  for (const e of log) {
    const m =
      e && typeof e.id === "string" ? e.id.match(/^log_(\d+)$/) : null;
    if (m) {
      const n = Number(m[1]);
      if (n > max) max = n;
    }
  }
  return `log_${String(max + 1).padStart(3, "0")}`;
}

/** Unlink every sidecar this call created, best-effort — used on any failure
 *  path (a later op in a batch throws, or the final validation fails) so no
 *  orphan sidecar survives a call that ultimately writes nothing. */
async function cleanupSidecars(projectPath: string, resultsRefs: string[]): Promise<void> {
  for (const ref of resultsRefs) {
    await unlink(join(projectPath, ref)).catch(() => {});
  }
}

/**
 * Apply one log entry to the shared in-memory `research` document: validates
 * the op's own input consistency, assigns the next log id (reading the
 * CURRENT `research.log`, so ids sequence correctly across a batch), finalizes
 * a staged sidecar if one was supplied (a REAL file write — pushed onto
 * `sidecarsCreated` so a later failure in this same call can unwind it), and
 * pushes the entry. Throws `LogAppendError` on any input problem — the caller
 * (single-op or batch) decides how to report it.
 */
async function applyLogAppendOp(
  research: any,
  op: ResearchLogAppendOp,
  projectPath: string,
  sidecarsCreated: string[],
): Promise<ResearchLogAppendOpResult> {
  // 0. Coerce object-typed args a model may have stringified. Some models
  //    emit `externalSite` / `query` as a JSON string instead of a nested
  //    object; without this they reach the checks below as strings and fail
  //    opaquely ("externalSite.site 'undefined' is not a valid site").
  const externalSite = coerceObjectArg(op.externalSite, "externalSite") as
    | ResearchLogAppendExternalSite
    | null
    | undefined;
  const query = coerceObjectArg(op.query, "query");

  // 0b. Map the literal string "null" back to null for nullable scalar args.
  //     Some models emit `planItemId: "null"` (the string) instead of JSON
  //     null; stored verbatim it becomes a bogus id reference that fails
  //     validation ("plan_item_id 'null' not found"). "null" is never a
  //     valid pli_ id, so this coercion is safe.
  let planItemId = op.planItemId;
  if ((planItemId as unknown) === "null") planItemId = null;

  // 0c. planItemId must be a plan-item id (^pli_) from the active plan, or
  //     null for an opportunistic/ad-hoc search. Models sometimes stuff a
  //     question id (q_...) or free text into this slot — which persists
  //     silently (validate_research_schema historically didn't check it) and
  //     then hard-fails the JSON-Schema validator downstream. Reject it here
  //     with an actionable error so the caller can correct it, rather than
  //     silently nulling it (which would discard the caller's expressed
  //     intent) or persisting an invalid reference.
  if (planItemId != null && !(typeof planItemId === "string" && planItemId.startsWith("pli_"))) {
    throw new LogAppendError(
      `planItemId '${planItemId}' is not a plan-item id. It must start ` +
        `with 'pli_' (a plan item from the active research plan) or be null ` +
        `for an opportunistic search with no plan item. A question id ` +
        `(q_...) is not a plan-item id — supply the pli_ item under that ` +
        `question, or null.`,
    );
  }

  // 1. Input-consistency checks (external_site ↔ tool, enums).
  const isExternal = op.tool === "external_site";
  if (isExternal && (externalSite === undefined || externalSite === null)) {
    throw new LogAppendError("tool is 'external_site' but externalSite is missing");
  }
  if (!isExternal && externalSite !== undefined && externalSite !== null) {
    throw new LogAppendError("externalSite provided but tool is not 'external_site'");
  }
  if (externalSite && !EXTERNAL_SITE_VALUES.has(externalSite.site)) {
    throw new LogAppendError(`externalSite.site '${externalSite.site}' is not a valid site`);
  }
  if (!OUTCOME_VALUES.has(op.outcome)) {
    throw new LogAppendError(`outcome '${op.outcome}' is not one of positive/negative/partial/error`);
  }

  if (!Array.isArray(research.log)) {
    throw new LogAppendError("research.json `log` is missing or not an array");
  }
  const log: any[] = research.log;

  // 2. Assign the id and timestamp; build the snake_case entry.
  const logId = nextLogId(log);
  const performed = new Date().toISOString();
  const entry: any = {
    id: logId,
    plan_item_id: planItemId ?? null,
    performed,
    tool: op.tool,
    query,
    outcome: op.outcome,
    results_examined: op.resultsExamined,
    external_site: externalSite
      ? {
          site: externalSite.site,
          url_generated: externalSite.urlGenerated,
          capture_received: externalSite.captureReceived,
          ...(externalSite.captureFilename !== undefined
            ? { capture_filename: externalSite.captureFilename }
            : {}),
        }
      : null,
    results_ref: null,
  };
  if (op.resultsAvailable !== undefined && op.resultsAvailable !== null) {
    entry.results_available = op.resultsAvailable;
  }
  if (op.notes !== undefined && op.notes !== null) {
    entry.notes = op.notes;
  }

  // 3. Finalize a staged sidecar if results were retained. A REAL file write —
  //    unlike every other op in this tool family, this is not undone just by
  //    skipping the final research.json write, so record it for cleanup.
  let resultsRef: string | null = null;
  let returnedCount: number | null = null;
  if (op.stagedResultsRef !== undefined && op.stagedResultsRef !== null) {
    let fin: { resultsRef: string; returnedCount: number };
    try {
      fin = await finalizeStagedResults({
        projectPath,
        stagedResultsRef: op.stagedResultsRef,
        logId,
        expectedTool: op.tool,
      });
    } catch (e) {
      throw new LogAppendError(e instanceof Error ? e.message : String(e));
    }
    resultsRef = fin.resultsRef;
    returnedCount = fin.returnedCount;
    entry.results_ref = resultsRef;
    sidecarsCreated.push(resultsRef);
  }

  // 4. Append (append-only — existing entries are never touched).
  log.push(entry);

  return { logId, performed, resultsRef, returnedCount };
}

export async function researchLogAppend(
  input: ResearchLogAppendInput,
): Promise<ResearchLogAppendResult> {
  const { projectPath } = input;

  // Recover a batch `ops` array the model serialized as a JSON string (see
  // coerceJsonArg) before any shape checks.
  input.ops = coerceJsonArg(input.ops) as ResearchLogAppendOp[] | undefined;

  try {
    // Read project files once (research mutated in memory only; tree read for
    // cross-file checks during validation).
    const research = await readProjectJson(projectPath, "research.json");
    const { tree } = sanitizeTree(
      await readProjectJson(projectPath, "tree.gedcomx.json"),
    );
    const sidecarsCreated: string[] = [];

    // ─── Batch form: apply every op in-memory, then validate + write once ────
    if (input.ops !== undefined) {
      if (!Array.isArray(input.ops) || input.ops.length === 0) {
        return { ok: false, errors: ["`ops` must be a non-empty array"] };
      }
      const results: ResearchLogAppendOpResult[] = [];
      for (let i = 0; i < input.ops.length; i++) {
        try {
          results.push(await applyLogAppendOp(research, input.ops[i], projectPath, sidecarsCreated));
        } catch (e) {
          await cleanupSidecars(projectPath, sidecarsCreated);
          if (e instanceof LogAppendError) return { ok: false, errors: [`ops[${i}]: ${e.message}`] };
          throw e;
        }
      }

      const validation = await validateParsed(research, tree, { projectPath });
      if (!validation.valid) {
        await cleanupSidecars(projectPath, sidecarsCreated);
        return { ok: false, errors: formatIssues(validation.errors) };
      }
      await atomicWriteJson(join(projectPath, "research.json"), research);
      return {
        ok: true,
        results,
        filesWritten: ["research.json", ...sidecarsCreated],
        validation: { valid: true, warnings: formatIssues(validation.warnings) },
      };
    }

    // ─── Single-op form (behavior unchanged) ─────────────────────────────────
    const result = await applyLogAppendOp(
      research,
      {
        tool: input.tool!,
        query: input.query,
        outcome: input.outcome!,
        resultsExamined: input.resultsExamined!,
        planItemId: input.planItemId,
        resultsAvailable: input.resultsAvailable,
        notes: input.notes,
        externalSite: input.externalSite,
        stagedResultsRef: input.stagedResultsRef,
      },
      projectPath,
      sidecarsCreated,
    );

    const validation = await validateParsed(research, tree, { projectPath });
    if (!validation.valid) {
      await cleanupSidecars(projectPath, sidecarsCreated);
      return { ok: false, errors: formatIssues(validation.errors) };
    }
    await atomicWriteJson(join(projectPath, "research.json"), research);

    return {
      ok: true,
      ...result,
      filesWritten: result.resultsRef ? ["research.json", result.resultsRef] : ["research.json"],
      validation: { valid: true, warnings: formatIssues(validation.warnings) },
    };
  } catch (e) {
    if (e instanceof LogAppendError) return { ok: false, errors: [e.message] };
    throw e;
  }
}

// ─── MCP schema ──────────────────────────────────────────────────────────────

export const researchLogAppendSchema = {
  name: "research_log_append",
  description:
    "Append one entry to the research log (research.json `log[]`) and, when a " +
    "search retained raw results, write its results/<log_id>.json sidecar — " +
    "atomically and schema-valid. Use this after every search (per the research-" +
    "log protocol: even nil searches are logged). The log is append-only — this " +
    "tool only appends; there is no update or delete.\n" +
    "\n" +
    "The tool assigns the log id, the `performed` timestamp, `results_ref`, and " +
    "the whole sidecar envelope (including a recomputed `returned_count`) — you " +
    "never supply them. To retain a search's results, pass the `staged.resultsRef` " +
    "the search tool returned (when you called it with `projectPath`) as " +
    "`stagedResultsRef`; the host finalizes that staged file into the sidecar " +
    "without you re-serializing the payload. Omit `stagedResultsRef` for nil " +
    "searches and external-site searches.\n" +
    "\n" +
    "Returns a compact summary (logId, resultsRef, returnedCount, filesWritten) — " +
    "never the payload. On a validation failure nothing is written and " +
    "`{ ok: false, errors }` is returned.\n" +
    "\n" +
    "To log several searches at once, pass an `ops` array instead of the " +
    "top-level tool/query/outcome/... fields: each op is the same per-entry " +
    "shape. The tool applies all ops to one in-memory research.json, validates " +
    "ONCE, and writes ONCE — all-or-nothing (on any op's failure nothing is " +
    "written, including any sidecar an earlier op in the batch staged, and the " +
    "error is `ops[i]: <msg>`). Log ids are assigned in order. Returns " +
    "`results: [{ logId, performed, resultsRef, returnedCount }]`, one entry " +
    "per op, in order.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectPath: {
        type: "string",
        description: "Absolute path to the project directory holding research.json and results/.",
      },
      tool: {
        type: "string",
        description:
          "The tool/source that produced this entry, e.g. 'record_search', " +
          "'fulltext_search', 'external_links_search', 'image_search', 'person_read', or " +
          "'external_site'. Must match the staged file's tool when stagedResultsRef is given.",
      },
      query: {
        type: "object",
        description: "Freeform object capturing enough of the search to reproduce it.",
      },
      outcome: {
        type: "string",
        enum: ["positive", "negative", "partial", "error"],
        description: "Your analytical judgment of the search outcome.",
      },
      resultsExamined: {
        type: "number",
        description: "How many results you examined (0 for a nil search).",
      },
      planItemId: {
        type: ["string", "null"],
        description: "The `pli_` plan-item this search served, or null for an ad-hoc search.",
      },
      resultsAvailable: {
        type: ["number", "null"],
        description: "Total results the search reported as available, if known.",
      },
      notes: {
        type: ["string", "null"],
        description: "Optional analytical note (e.g. why a negative result is meaningful).",
      },
      externalSite: {
        type: ["object", "null"],
        description:
          "REQUIRED when tool === 'external_site'; otherwise omit or pass null.",
        properties: {
          site: {
            type: "string",
            enum: [
              "ancestry",
              "myheritage",
              "findmypast",
              "findagrave",
              "newspapers",
              "familysearch_web",
            ],
          },
          urlGenerated: { type: "string" },
          captureReceived: { type: "boolean" },
          captureFilename: { type: ["string", "null"] },
        },
        required: ["site", "urlGenerated", "captureReceived"],
      },
      stagedResultsRef: {
        type: ["string", "null"],
        description:
          "The `staged.resultsRef` handle returned by record_search / fulltext_search " +
          "(when called with projectPath). Omit/null for nil and external-site searches.",
      },
      ops: {
        type: "array",
        description:
          "Batch form: log several searches in one validate-once/write-once call " +
          "(all-or-nothing). When present, the top-level tool/query/outcome/... fields " +
          "are ignored. Each op is the same per-entry shape the single form takes.",
        items: {
          type: "object",
          properties: {
            tool: { type: "string" },
            query: { type: "object" },
            outcome: { type: "string", enum: ["positive", "negative", "partial", "error"] },
            resultsExamined: { type: "number" },
            planItemId: { type: ["string", "null"] },
            resultsAvailable: { type: ["number", "null"] },
            notes: { type: ["string", "null"] },
            externalSite: { type: ["object", "null"] },
            stagedResultsRef: { type: ["string", "null"] },
          },
          required: ["tool", "query", "outcome", "resultsExamined"],
        },
      },
    },
    required: ["projectPath"],
  },
};

// research_log_append — append one entry to research.json `log[]` and, when a
// search retained raw results, finalize its results/<log_id>.json sidecar —
// atomically and schema-valid. Append-only by GPS rule (no update/delete).
//
// The tool owns the clerical work the four writing skills do by hand today: id
// assignment, timestamping, the three-way results_ref↔log_id↔filename wiring,
// returned_count integrity, camelCase→snake_case rename, and the atomic write.
// The raw payload reaches disk via host-side staging (search-result-staging-
// spec.md) — it never round-trips through the model. Spec: research-log-editor-spec.md.

import { join } from "path";
import { readFile, unlink } from "fs/promises";
import { validateParsed } from "../validation/validator.js";
import type { ValidationError } from "../validation/types.js";
import { atomicWriteJson } from "../utils/project-io.js";
import { finalizeStagedResults } from "../utils/results-staging.js";

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

export interface ResearchLogAppendInput {
  projectPath: string;
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

export type ResearchLogAppendResult =
  | {
      ok: true;
      logId: string;
      performed: string;
      resultsRef: string | null;
      returnedCount: number | null;
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

export async function researchLogAppend(
  input: ResearchLogAppendInput,
): Promise<ResearchLogAppendResult> {
  const { projectPath } = input;

  try {
    // 0. Coerce object-typed args a model may have stringified. Some models
    //    emit `externalSite` / `query` as a JSON string instead of a nested
    //    object; without this they reach the checks below as strings and fail
    //    opaquely ("externalSite.site 'undefined' is not a valid site").
    input.externalSite = coerceObjectArg(input.externalSite, "externalSite") as
      | ResearchLogAppendExternalSite
      | null
      | undefined;
    input.query = coerceObjectArg(input.query, "query");

    // 0b. Map the literal string "null" back to null for nullable scalar args.
    //     Some models emit `planItemId: "null"` (the string) instead of JSON
    //     null; stored verbatim it becomes a bogus id reference that fails
    //     validation ("plan_item_id 'null' not found"). "null" is never a
    //     valid pli_ id, so this coercion is safe.
    if ((input.planItemId as unknown) === "null") input.planItemId = null;

    // 1. Input-consistency checks (external_site ↔ tool, enums).
    const isExternal = input.tool === "external_site";
    if (isExternal && (input.externalSite === undefined || input.externalSite === null)) {
      return { ok: false, errors: ["tool is 'external_site' but externalSite is missing"] };
    }
    if (!isExternal && input.externalSite !== undefined && input.externalSite !== null) {
      return { ok: false, errors: ["externalSite provided but tool is not 'external_site'"] };
    }
    if (input.externalSite && !EXTERNAL_SITE_VALUES.has(input.externalSite.site)) {
      return {
        ok: false,
        errors: [`externalSite.site '${input.externalSite.site}' is not a valid site`],
      };
    }
    if (!OUTCOME_VALUES.has(input.outcome)) {
      return {
        ok: false,
        errors: [
          `outcome '${input.outcome}' is not one of positive/negative/partial/error`,
        ],
      };
    }

    // 2. Read project files (research mutated in memory only; tree read for
    //    cross-file checks during validation).
    const research = await readProjectJson(projectPath, "research.json");
    const tree = await readProjectJson(projectPath, "tree.gedcomx.json");
    if (!Array.isArray(research.log)) {
      return { ok: false, errors: ["research.json `log` is missing or not an array"] };
    }
    const log: any[] = research.log;

    // 3. Assign the id and timestamp; build the snake_case entry.
    const logId = nextLogId(log);
    const performed = new Date().toISOString();
    const entry: any = {
      id: logId,
      plan_item_id: input.planItemId ?? null,
      performed,
      tool: input.tool,
      query: input.query,
      outcome: input.outcome,
      results_examined: input.resultsExamined,
      external_site: input.externalSite
        ? {
            site: input.externalSite.site,
            url_generated: input.externalSite.urlGenerated,
            capture_received: input.externalSite.captureReceived,
            ...(input.externalSite.captureFilename !== undefined
              ? { capture_filename: input.externalSite.captureFilename }
              : {}),
          }
        : null,
      results_ref: null,
    };
    if (input.resultsAvailable !== undefined && input.resultsAvailable !== null) {
      entry.results_available = input.resultsAvailable;
    }
    if (input.notes !== undefined && input.notes !== null) {
      entry.notes = input.notes;
    }

    // 4. Finalize a staged sidecar if results were retained.
    let resultsRef: string | null = null;
    let returnedCount: number | null = null;
    let sidecarPath: string | null = null;
    if (input.stagedResultsRef !== undefined && input.stagedResultsRef !== null) {
      try {
        const fin = await finalizeStagedResults({
          projectPath,
          stagedResultsRef: input.stagedResultsRef,
          logId,
          expectedTool: input.tool,
        });
        resultsRef = fin.resultsRef;
        returnedCount = fin.returnedCount;
        sidecarPath = join(projectPath, fin.resultsRef);
        entry.results_ref = resultsRef;
      } catch (e) {
        return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
      }
    }

    // 5. Append (append-only — existing entries are never touched).
    log.push(entry);

    // 6. Validate the would-be-committed state. The sidecar is on disk, so the
    //    sidecar checks (returned_count, log_id match, orphan, D5) all run.
    const validation = await validateParsed(research, tree, { projectPath });
    if (!validation.valid) {
      // Unlink the sidecar just written so no orphan remains; research.json
      // is untouched on disk.
      if (sidecarPath) await unlink(sidecarPath).catch(() => {});
      return { ok: false, errors: formatIssues(validation.errors) };
    }

    // 7. Commit research.json atomically.
    await atomicWriteJson(join(projectPath, "research.json"), research);

    return {
      ok: true,
      logId,
      performed,
      resultsRef,
      returnedCount,
      filesWritten: resultsRef ? ["research.json", resultsRef] : ["research.json"],
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
    "`{ ok: false, errors }` is returned.",
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
          "'fulltext_search', 'image_search', 'person_read', or 'external_site'. " +
          "Must match the staged file's tool when stagedResultsRef is given.",
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
    },
    required: ["projectPath", "tool", "query", "outcome", "resultsExamined"],
  },
};

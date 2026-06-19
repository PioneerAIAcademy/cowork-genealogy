// research_append — structured writer for the mutable research.json sections
// (everything except the append-only `log`, which is research_log_append's job).
//
// One tool with a `section` + `op` discriminator. The LLM supplies the analytical
// content; the tool assigns the section's prefix id, stamps tool-owned timestamps,
// enforces supersede-not-delete (no delete op), runs the section invariants as
// preconditions, validates the whole project, and writes research.json atomically.
//
// Phased per docs/specs/research-append-tool-spec.md §7. This file implements
// Phase 1 (sources, assertions, person_evidence) plus the framework; phases 2–3
// extend SECTIONS.

import { join } from "path";
import { readFile } from "fs/promises";
import { validateParsed } from "../validation/validator.js";
import type { ValidationError } from "../validation/types.js";
import { atomicWriteJson } from "../utils/project-io.js";

// ─── Section configuration (the per-section table phases 2–3 extend) ─────────

interface SectionConfig {
  /** id prefix, including the trailing underscore (e.g. "src_"). */
  prefix: string;
  /** Set `created` = today on append when the entry omits it (tool-owned). */
  stampCreated?: boolean;
}

const SECTIONS: Record<string, SectionConfig> = {
  sources: { prefix: "src_" },
  assertions: { prefix: "a_" },
  person_evidence: { prefix: "pe_", stampCreated: true },
};

export type ResearchAppendSection = keyof typeof SECTIONS | string;

export interface ResearchAppendInput {
  projectPath: string;
  section: ResearchAppendSection;
  op: "append" | "update";
  entry?: Record<string, unknown>; // op = append (no id — the tool assigns it)
  entryId?: string; // op = update
  fields?: Record<string, unknown>; // op = update (shallow-merged; id immutable)
}

export type ResearchAppendResult =
  | {
      ok: true;
      section: string;
      op: "append" | "update";
      entryId: string;
      filesWritten: string[];
      validation: { valid: true; warnings: string[] };
    }
  | { ok: false; errors: string[] };

class ResearchAppendError extends Error {}

function formatIssues(issues: ValidationError[]): string[] {
  return issues.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message));
}

async function readJson(projectPath: string, filename: string): Promise<any> {
  let text: string;
  try {
    text = await readFile(join(projectPath, filename), "utf-8");
  } catch {
    throw new ResearchAppendError(`${filename} not found in projectPath`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ResearchAppendError(`${filename} is not valid JSON`);
  }
}

/** Next `<prefix>NNN` id (max + 1, zero-padded to 3) for a research section. */
function nextResearchId(entries: any[], prefix: string): string {
  let max = 0;
  const re = new RegExp(`^${prefix}(\\d+)$`);
  for (const e of entries) {
    const m = e && typeof e.id === "string" ? e.id.match(re) : null;
    if (m) {
      const n = Number(m[1]);
      if (n > max) max = n;
    }
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function researchAppend(
  input: ResearchAppendInput,
): Promise<ResearchAppendResult> {
  const { projectPath, section, op } = input;

  try {
    const config = SECTIONS[section];
    if (!config) {
      return {
        ok: false,
        errors: [
          `section '${section}' is not supported by research_append (supported: ${Object.keys(SECTIONS).join(", ")})`,
        ],
      };
    }

    const research = await readJson(projectPath, "research.json");
    const tree = await readJson(projectPath, "tree.gedcomx.json");

    const array = research[section];
    if (!Array.isArray(array)) {
      return { ok: false, errors: [`research.json '${section}' is missing or not an array`] };
    }

    let entryId: string;

    if (op === "append") {
      const entry = input.entry;
      if (!entry || typeof entry !== "object") {
        return { ok: false, errors: ["append requires an `entry` object"] };
      }
      if (entry.id !== undefined && entry.id !== null) {
        return { ok: false, errors: ["append `entry` must not carry an id — the tool assigns it"] };
      }
      entryId = nextResearchId(array, config.prefix);
      // Strip any id key before assigning so the spread can never clobber it.
      const rest: Record<string, unknown> = { ...entry };
      delete rest.id;
      const newEntry: Record<string, unknown> = { id: entryId, ...rest };
      if (config.stampCreated && newEntry.created === undefined) {
        newEntry.created = today();
      }
      array.push(newEntry);
    } else if (op === "update") {
      if (!input.entryId) {
        return { ok: false, errors: ["update requires an `entryId`"] };
      }
      if (!input.entryId.startsWith(config.prefix)) {
        return {
          ok: false,
          errors: [`entryId '${input.entryId}' does not match section '${section}' (prefix ${config.prefix})`],
        };
      }
      if (!input.fields || typeof input.fields !== "object") {
        return { ok: false, errors: ["update requires a `fields` object"] };
      }
      if ("id" in input.fields && input.fields.id !== input.entryId) {
        return { ok: false, errors: ["update `fields` must not change the entry id"] };
      }
      const existing = array.find((e) => e && e.id === input.entryId);
      if (!existing) {
        return { ok: false, errors: [`entryId '${input.entryId}' not found in '${section}'`] };
      }
      for (const [k, v] of Object.entries(input.fields)) {
        if (k === "id") continue;
        existing[k] = v;
      }
      entryId = input.entryId;
    } else {
      return { ok: false, errors: [`unknown op '${op}' (expected 'append' or 'update')`] };
    }

    const validation = await validateParsed(research, tree, { projectPath });
    if (!validation.valid) {
      return { ok: false, errors: formatIssues(validation.errors) };
    }

    await atomicWriteJson(join(projectPath, "research.json"), research);

    return {
      ok: true,
      section,
      op,
      entryId,
      filesWritten: ["research.json"],
      validation: { valid: true, warnings: formatIssues(validation.warnings) },
    };
  } catch (e) {
    if (e instanceof ResearchAppendError) return { ok: false, errors: [e.message] };
    throw e;
  }
}

// ─── MCP schema ──────────────────────────────────────────────────────────────

export const researchAppendSchema = {
  name: "research_append",
  description:
    "Write a structured entry to a mutable research.json section — append a new " +
    "entry (the tool assigns the id) or update an existing one in place (preserving " +
    "its id; there is no delete — supersede via a status/`superseded_by` field). Use " +
    "this for the analytical sections; use research_log_append for the research log, " +
    "and the merge / tree_edit tools for tree.gedcomx.json.\n" +
    "\n" +
    "Supply the entry in its persisted snake_case shape WITHOUT an id; the tool " +
    "assigns the next `<prefix>NNN`, stamps tool-owned timestamps, validates the " +
    "whole project, and writes research.json atomically. To revise a person_evidence " +
    "link, append the new entry then update the old one's `superseded_by`. Returns a " +
    "compact summary; on a validation failure nothing is written.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectPath: {
        type: "string",
        description: "Absolute path to the project directory holding research.json.",
      },
      section: {
        type: "string",
        // Phase 1 sections only; phases 2–3 extend this enum.
        enum: ["sources", "assertions", "person_evidence"],
        description: "The research.json section to write.",
      },
      op: {
        type: "string",
        enum: ["append", "update"],
        description: "append a new entry (tool assigns the id) or update an existing one by id.",
      },
      entry: {
        type: "object",
        description: "append: the new entry in snake_case, WITHOUT an id (the tool assigns it).",
      },
      entryId: {
        type: "string",
        description: "update: the id of the existing entry to modify (must match the section's prefix).",
      },
      fields: {
        type: "object",
        description: "update: the fields to shallow-merge onto the existing entry (the id is immutable).",
      },
    },
    required: ["projectPath", "section", "op"],
  },
};

// research_query — filtered read of one research.json array section.
//
// The read-side companion project_context doesn't cover: project_context is a
// fixed, unfiltered orientation snapshot for one consumer (the record-extractor's
// fresh-context startup) and deliberately excludes assertion bodies and any
// query surface (project-context-tool-spec.md §3: "a projection, not a query
// language... rejected: jq-style path parameters"). This tool exists for a
// different, later-observed need: a skill mid-session (person-evidence,
// proof-conclusion, research-exhaustiveness) checking specific accumulated
// state — "every assertion for this persona," "every proof_summary for this
// question" — without re-reading (and, once the file is large enough,
// manually paginating through) the whole growing research.json. Evidence: a
// wilkins-marriage e2e run made 53 Read calls on research.json, including
// hand-paginated reads (offset 850/1500/2000/2500) immediately before the
// run's single longest generation gap (385s) — measured in the 2026-07-26
// batching-work verification run; see docs/specs/research-query-tool-spec.md.
//
// Deliberately NOT a generic filter (an arbitrary `{field: value}` object) —
// that is exactly the "jq-style," "open-ended context cost, un-promptable"
// shape project_context's spec already rejected. Instead, each section
// exposes a SMALL, fixed, named set of well-known filter parameters (mirrors
// record_search's structured-params-not-free-text-query design), validated
// against a per-section allow-list — supplying a filter a section doesn't
// support is a clear error, not a silent no-op.

import { join } from "path";
import { readFile } from "fs/promises";

const MAX_ITEMS = 50;

export const RESEARCH_QUERY_SECTIONS = [
  "questions",
  "plans",
  "log",
  "sources",
  "assertions",
  "person_evidence",
  "conflicts",
  "hypotheses",
  "timelines",
  "proof_summaries",
  "evaluations",
] as const;

export type ResearchQuerySection = (typeof RESEARCH_QUERY_SECTIONS)[number];

export interface ResearchQueryInput {
  projectPath: string;
  section: ResearchQuerySection;
  recordId?: string;
  recordRole?: string;
  sourceId?: string;
  questionId?: string;
  personId?: string;
  assertionId?: string;
  planItemId?: string;
  status?: string;
}

export type ResearchQueryResult =
  | {
      ok: true;
      section: ResearchQuerySection;
      /** Total matches (before the MAX_ITEMS cap). */
      count: number;
      items: any[];
      /** true when `count` exceeds MAX_ITEMS and `items` was capped — narrow
       *  the filter rather than relying on this being everything. */
      truncated: boolean;
    }
  | { ok: false; errors: string[] };

class ResearchQueryError extends Error {}

type FilterKey =
  | "recordId"
  | "recordRole"
  | "sourceId"
  | "questionId"
  | "personId"
  | "assertionId"
  | "planItemId"
  | "status";

/** One filter's match rule: `field` (or the first-matching of `fields`) on
 *  each item, compared by `mode` — `exact` equality, or `contains` /
 *  `contains-any` when the item's field is an array (e.g. an assertion's
 *  `extracted_for_question_ids`, a hypothesis's `supporting_assertion_ids`). */
interface FilterRule {
  field?: string;
  fields?: string[];
  mode: "exact" | "contains" | "contains-any";
}

/** Per-section allow-list of supported filter keys — the whole point of not
 *  being a generic `{field: value}` query: only these named, documented
 *  parameters are accepted, and only on the sections where they mean
 *  something. Supplying `recordId` against `section: "proof_summaries"` is a
 *  clear error, not a silently-ignored no-op. */
const SECTION_FILTERS: Record<ResearchQuerySection, Partial<Record<FilterKey, FilterRule>>> = {
  questions: {
    questionId: { field: "id", mode: "exact" },
    status: { field: "status", mode: "exact" },
  },
  plans: {
    questionId: { field: "question_id", mode: "exact" },
    status: { field: "status", mode: "exact" },
  },
  log: {
    planItemId: { field: "plan_item_id", mode: "exact" },
  },
  sources: {
    sourceId: { field: "id", mode: "exact" },
  },
  assertions: {
    recordId: { field: "record_id", mode: "exact" },
    recordRole: { field: "record_role", mode: "exact" },
    sourceId: { field: "source_id", mode: "exact" },
    questionId: { field: "extracted_for_question_ids", mode: "contains" },
  },
  person_evidence: {
    personId: { field: "person_id", mode: "exact" },
    assertionId: { field: "assertion_id", mode: "exact" },
  },
  conflicts: {
    assertionId: { field: "competing_assertion_ids", mode: "contains" },
    questionId: { field: "blocks_question_ids", mode: "contains" },
    status: { field: "status", mode: "exact" },
  },
  hypotheses: {
    questionId: { field: "related_question_ids", mode: "contains" },
    assertionId: {
      fields: ["supporting_assertion_ids", "contradicting_assertion_ids"],
      mode: "contains-any",
    },
    status: { field: "status", mode: "exact" },
  },
  timelines: {
    personId: { field: "person_ids", mode: "contains" },
  },
  proof_summaries: {
    questionId: { field: "question_id", mode: "exact" },
    assertionId: { field: "supporting_assertion_ids", mode: "contains" },
  },
  evaluations: {},
};

const FILTER_KEYS: FilterKey[] = [
  "recordId",
  "recordRole",
  "sourceId",
  "questionId",
  "personId",
  "assertionId",
  "planItemId",
  "status",
];

function matches(item: any, rule: FilterRule, value: string): boolean {
  const fields = rule.fields ?? (rule.field ? [rule.field] : []);
  if (rule.mode === "exact") {
    return item && item[fields[0]] === value;
  }
  if (rule.mode === "contains") {
    const arr = item?.[fields[0]];
    return Array.isArray(arr) && arr.includes(value);
  }
  // contains-any
  return fields.some((f) => {
    const arr = item?.[f];
    return Array.isArray(arr) && arr.includes(value);
  });
}

export async function researchQuery(input: ResearchQueryInput): Promise<ResearchQueryResult> {
  const { projectPath, section } = input;

  try {
    if (!RESEARCH_QUERY_SECTIONS.includes(section)) {
      throw new ResearchQueryError(
        `section '${section}' is not one of: ${RESEARCH_QUERY_SECTIONS.join(", ")}`,
      );
    }

    const allowed = SECTION_FILTERS[section];
    const activeFilters: { key: FilterKey; rule: FilterRule; value: string }[] = [];
    for (const key of FILTER_KEYS) {
      const value = input[key];
      if (value === undefined) continue;
      const rule = allowed[key];
      if (!rule) {
        const supported = Object.keys(allowed);
        throw new ResearchQueryError(
          `'${key}' is not a supported filter for section '${section}'` +
            (supported.length > 0 ? ` (supported: ${supported.join(", ")})` : " (this section takes no filters)"),
        );
      }
      activeFilters.push({ key, rule, value });
    }

    let text: string;
    try {
      text = await readFile(join(projectPath, "research.json"), "utf-8");
    } catch {
      throw new ResearchQueryError("research.json not found in projectPath");
    }
    let research: any;
    try {
      research = JSON.parse(text);
    } catch {
      throw new ResearchQueryError("research.json is not valid JSON");
    }

    const arr = research?.[section];
    if (!Array.isArray(arr)) {
      throw new ResearchQueryError(`research.json '${section}' is missing or not an array`);
    }

    const filtered = arr.filter(
      (item) => activeFilters.every(({ rule, value }) => matches(item, rule, value)),
    );

    return {
      ok: true,
      section,
      count: filtered.length,
      items: filtered.slice(0, MAX_ITEMS),
      truncated: filtered.length > MAX_ITEMS,
    };
  } catch (e) {
    if (e instanceof ResearchQueryError) return { ok: false, errors: [e.message] };
    throw e;
  }
}

// ─── MCP schema ──────────────────────────────────────────────────────────────

export const researchQuerySchema = {
  name: "research_query",
  description:
    "Filtered read of one research.json array section — check specific accumulated " +
    "research state (which assertions exist for a persona, which proof_summary covers " +
    "a question, which person_evidence links a person has, ...) without reading (or " +
    "paginating through) the whole growing research.json. Read-only; writes nothing.\n" +
    "\n" +
    "Pick `section` and, optionally, the well-known filter fields that section " +
    "supports (below) — passing a filter a section doesn't support is an error, not " +
    "a silent no-op. Omit all filters to get the whole section (capped at 50 items; " +
    "check `truncated` and narrow the filter if you need more).\n" +
    "\n" +
    "Supported filters per section: `questions` (questionId, status), `plans` " +
    "(questionId, status), `log` (planItemId), `sources` (sourceId), `assertions` " +
    "(recordId, recordRole, sourceId, questionId — matches extracted_for_question_ids), " +
    "`person_evidence` (personId, assertionId), `conflicts` (assertionId — matches " +
    "competing_assertion_ids, questionId — matches blocks_question_ids, status), " +
    "`hypotheses` (questionId — matches " +
    "related_question_ids, assertionId — matches supporting/contradicting_assertion_ids, " +
    "status), `timelines` (personId — matches person_ids), `proof_summaries` " +
    "(questionId, assertionId — matches supporting_assertion_ids), `evaluations` " +
    "(no filters — always returns everything, capped).\n" +
    "\n" +
    "Returns `{ section, count, items, truncated }` — `count` is the total match " +
    "count before the 50-item cap; `items` is camelCase-untouched (the section's " +
    "native snake_case fields, verbatim) since this is a read projection, not a " +
    "persisted document.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectPath: {
        type: "string",
        description: "Absolute path to the project directory holding research.json.",
      },
      section: {
        type: "string",
        enum: [...RESEARCH_QUERY_SECTIONS],
        description: "Which research.json array section to query.",
      },
      recordId: { type: "string", description: "assertions: matches record_id." },
      recordRole: { type: "string", description: "assertions: matches record_role." },
      sourceId: {
        type: "string",
        description: "sources: matches id. assertions: matches source_id.",
      },
      questionId: {
        type: "string",
        description:
          "questions/plans/proof_summaries: matches question_id (or id, for questions itself). " +
          "assertions: matches extracted_for_question_ids (contains). hypotheses: matches " +
          "related_question_ids (contains). conflicts: matches blocks_question_ids (contains).",
      },
      personId: {
        type: "string",
        description: "person_evidence: matches person_id. timelines: matches person_ids (contains).",
      },
      assertionId: {
        type: "string",
        description:
          "person_evidence: matches assertion_id. proof_summaries: matches " +
          "supporting_assertion_ids (contains). conflicts: matches competing_assertion_ids " +
          "(contains). hypotheses: matches supporting_assertion_ids OR " +
          "contradicting_assertion_ids (contains either).",
      },
      planItemId: { type: "string", description: "log: matches plan_item_id." },
      status: {
        type: "string",
        description: "questions/plans/conflicts/hypotheses: matches status.",
      },
    },
    required: ["projectPath", "section"],
  },
};

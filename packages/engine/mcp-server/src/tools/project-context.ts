// project_context — compact read-only projection of the project state.
//
// The read-side companion of the structured writers (research_append,
// tree_edit): where those removed "re-serialize large JSON to write," this
// removes "re-read large JSON to think." One call returns the judgment-
// relevant projection of research.json + tree.gedcomx.json — open questions,
// tree persons with their cited S ids, sources with their record ids — so a
// fresh-context agent (the record-extractor) never opens either file.
// Spec: docs/specs/project-context-tool-spec.md.

import { join } from "path";
import { readFile } from "fs/promises";

const QUESTION_TRUNCATE_AT = 140;

export interface ProjectContextInput {
  projectPath: string;
}

export interface ProjectContextQuestion {
  id: string;
  question: string;
}

export interface ProjectContextPerson {
  id: string;
  name: string | null;
  gender: string | null;
  sourceRefs: string[];
}

export interface ProjectContextSource {
  id: string;
  repository: string | null;
  gedcomxSourceDescriptionId: string | null;
  recordIds: string[];
  assertionCount: number;
}

export type ProjectContextResult =
  | {
      ok: true;
      projectStatus: string | null;
      openQuestions: ProjectContextQuestion[];
      persons: ProjectContextPerson[];
      sources: ProjectContextSource[];
    }
  | { ok: false; errors: string[] };

async function readJson(projectPath: string, filename: string): Promise<any> {
  let text: string;
  try {
    text = await readFile(join(projectPath, filename), "utf-8");
  } catch {
    throw new Error(`${filename} not found in projectPath`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${filename} is not valid JSON`);
  }
}

function truncateQuestion(text: string): string {
  if (text.length <= QUESTION_TRUNCATE_AT) return text;
  return `${text.slice(0, QUESTION_TRUNCATE_AT - 1)}…`;
}

/** Preferred names entry (first entry when none is flagged) as "given surname". */
function preferredDisplayName(person: any): string | null {
  const names = Array.isArray(person?.names) ? person.names.filter((n: any) => n && typeof n === "object") : [];
  if (names.length === 0) return null;
  const preferred = names.find((n: any) => n.preferred === true) ?? names[0];
  const parts = [preferred.given, preferred.surname].filter(
    (p: unknown): p is string => typeof p === "string" && p.trim() !== "",
  );
  return parts.length > 0 ? parts.join(" ") : null;
}

/** Distinct S ids cited anywhere on the person — person-level `sources`,
 *  each fact's `sources`, each name's `sources` — in first-seen order. */
function collectSourceRefs(person: any): string[] {
  const refs: string[] = [];
  const take = (sources: unknown): void => {
    if (!Array.isArray(sources)) return;
    for (const s of sources) {
      const ref = s && typeof s === "object" ? (s as any).ref : undefined;
      if (typeof ref === "string" && ref !== "" && !refs.includes(ref)) refs.push(ref);
    }
  };
  take(person?.sources);
  for (const f of Array.isArray(person?.facts) ? person.facts : []) take(f?.sources);
  for (const n of Array.isArray(person?.names) ? person.names : []) take(n?.sources);
  return refs;
}

export async function projectContext(input: ProjectContextInput): Promise<ProjectContextResult> {
  let research: any;
  let tree: any;
  try {
    research = await readJson(input.projectPath, "research.json");
    tree = await readJson(input.projectPath, "tree.gedcomx.json");
  } catch (e) {
    return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
  }

  // Open questions: everything not yet resolved (open / in_progress /
  // exhaustive_declared), in array order. Text truncated — the id is the
  // handle; the text is a reminder, not the record.
  const openQuestions: ProjectContextQuestion[] = [];
  for (const q of Array.isArray(research?.questions) ? research.questions : []) {
    if (!q || typeof q !== "object" || typeof q.id !== "string") continue;
    if (q.status === "resolved" || q.status === "superseded") continue;
    openQuestions.push({ id: q.id, question: truncateQuestion(typeof q.question === "string" ? q.question : "") });
  }

  const persons: ProjectContextPerson[] = [];
  for (const p of Array.isArray(tree?.persons) ? tree.persons : []) {
    if (!p || typeof p !== "object" || typeof p.id !== "string") continue;
    persons.push({
      id: p.id,
      name: preferredDisplayName(p),
      gender: typeof p.gender === "string" ? p.gender : null,
      sourceRefs: collectSourceRefs(p),
    });
  }

  // Per-source assertion rollup: distinct record_id values (verbatim,
  // first-seen order) + assertion count.
  const bySource = new Map<string, { recordIds: string[]; count: number }>();
  for (const a of Array.isArray(research?.assertions) ? research.assertions : []) {
    if (!a || typeof a !== "object" || typeof a.source_id !== "string") continue;
    let bucket = bySource.get(a.source_id);
    if (!bucket) {
      bucket = { recordIds: [], count: 0 };
      bySource.set(a.source_id, bucket);
    }
    bucket.count += 1;
    if (typeof a.record_id === "string" && a.record_id !== "" && !bucket.recordIds.includes(a.record_id)) {
      bucket.recordIds.push(a.record_id);
    }
  }
  const sources: ProjectContextSource[] = [];
  for (const s of Array.isArray(research?.sources) ? research.sources : []) {
    if (!s || typeof s !== "object" || typeof s.id !== "string") continue;
    const bucket = bySource.get(s.id);
    sources.push({
      id: s.id,
      repository: typeof s.repository === "string" ? s.repository : null,
      gedcomxSourceDescriptionId:
        typeof s.gedcomx_source_description_id === "string" ? s.gedcomx_source_description_id : null,
      recordIds: bucket ? bucket.recordIds : [],
      assertionCount: bucket ? bucket.count : 0,
    });
  }

  const projectStatus =
    research?.project && typeof research.project === "object" && typeof research.project.status === "string"
      ? research.project.status
      : null;

  return { ok: true, projectStatus, openQuestions, persons, sources };
}

// ─── MCP schema ──────────────────────────────────────────────────────────────

export const projectContextSchema = {
  name: "project_context",
  description:
    "Read-only compact projection of the project state — call this INSTEAD of " +
    "reading research.json or tree.gedcomx.json. Returns projectStatus; " +
    "openQuestions [{id, question}] (unresolved only, text truncated); persons " +
    "[{id, name, gender, sourceRefs}] — every tree person with the distinct S ids " +
    "it already cites; and sources [{id, repository, " +
    "gedcomxSourceDescriptionId, recordIds, assertionCount}] — every research " +
    "source with the record ids its assertions cover. One call gives the context " +
    "for extraction judgment calls (which questions an assertion bears on, " +
    "whether a record persona is already in the tree, which sources cover a " +
    "record); the writer tools handle every mechanical lookup themselves. Writes " +
    "nothing.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectPath: {
        type: "string",
        description: "Absolute path to the project directory holding research.json and tree.gedcomx.json.",
      },
    },
    required: ["projectPath"],
  },
};

// project_list — which projects this server keeps, and where a new one goes.
//
// The file backend keeps each project in a folder the caller names, so it lists
// none and says so. A hosted store names the paths it answers for: each holding a
// research.json is a project, and the first holding none is where a new project
// goes. A signed-in user's listing bounds each entry, because the documents it
// reads can run to megabytes. Spec: docs/specs/project-list-tool-spec.md.

import { getProjectStore } from "../store/project-store.js";
import { START_PROJECT_RULE } from "../utils/project-io.js";
import { preferredDisplayName } from "./project-context.js";

export interface ProjectListSubject {
  id: string;
  name: string | null;
}

export interface ProjectListEntry {
  projectPath: string;
  objective: string | null;
  subjects: ProjectListSubject[];
  /** How many subjects were left out of a bounded entry; absent when none were. */
  moreSubjects?: number;
  status: string | null;
  updated: string | null;
}

export interface ProjectListResult {
  mode: "folder" | "hosted";
  /** Hosted only: an empty list on the file store would read as "no project". */
  projects?: ProjectListEntry[];
  /** More projects exist than `projects` names; absent when it names them all. */
  truncated?: true;
  newProjectPath?: string;
  message: string;
}

/** Above the longest objective in the eval corpus (341): only an abuse is cut. */
export const MAX_OBJECTIVE_CHARS = 400;
/** A subject's id and name, a status, a date. */
export const MAX_FIELD_CHARS = 100;
export const MAX_LISTED_SUBJECTS = 5;

interface EntryBounds {
  objective: number;
  field: number;
  subjects: number;
}

const VERBATIM: EntryBounds = { objective: Infinity, field: Infinity, subjects: Infinity };
const USER_LISTING: EntryBounds = {
  objective: MAX_OBJECTIVE_CHARS,
  field: MAX_FIELD_CHARS,
  subjects: MAX_LISTED_SUBJECTS,
};

const FOLDER_MESSAGE =
  "The task's working folder is the project: pass its absolute path as projectPath. " +
  "This answer does not say whether the folder holds a project yet: call project_context " +
  "with that path before routing, and route on what it returns. " +
  START_PROJECT_RULE;

/** Parsed JSON at `ref`, or null when it is absent or not JSON. Any other failure
 *  rejects: nulls would read as a project about nobody. */
async function readJson(projectPath: string, ref: string): Promise<any> {
  try {
    return JSON.parse(await getProjectStore().readText(projectPath, ref));
  } catch (e: any) {
    if (e instanceof SyntaxError || e?.code === "ENOENT") return null;
    throw e;
  }
}

/** `s`, or its first `max` characters and an ellipsis. The trip through a Buffer
 *  copies them: a V8 slice keeps its whole parent alive, so every entry would hold
 *  the text this cut lets go. It also turns a pair the cut split into U+FFFD, since
 *  half a pair is invalid in the JSON a client sends on to its model. */
function cut(s: string, max: number): string {
  return s.length <= max ? s : `${Buffer.from(s.slice(0, max)).toString()}…`;
}

const text = (v: unknown, max: number): string | null => (typeof v === "string" ? cut(v, max) : null);

/** What an entry keeps of research.json, already bounded. A call of its own so the
 *  document is gone before the tree read: that read queues behind every other call
 *  on the pool, and each of a caller's concurrent listings would hold it there. */
async function projectFields(projectPath: string, bounds: EntryBounds) {
  const project = (await readJson(projectPath, "research.json"))?.project;
  const ids: unknown[] = Array.isArray(project?.subject_person_ids) ? project.subject_person_ids : [];
  const subjectIds = ids.filter((id): id is string => typeof id === "string");
  return {
    objective: text(project?.objective, bounds.objective),
    subjectIds: subjectIds.slice(0, bounds.subjects).map((id) => cut(id, bounds.field)),
    left: subjectIds.length - bounds.subjects,
    status: text(project?.status, bounds.field),
    updated: text(project?.updated, bounds.field),
  };
}

async function entry(projectPath: string, bounds: EntryBounds): Promise<ProjectListEntry> {
  const { objective, subjectIds, left, status, updated } = await projectFields(projectPath, bounds);
  const tree = await readJson(projectPath, "tree.gedcomx.json");
  const persons: any[] = Array.isArray(tree?.persons) ? tree.persons : [];
  const personWith = (id: string) => persons.find((p) => typeof p?.id === "string" && cut(p.id, bounds.field) === id);
  return {
    projectPath,
    objective,
    subjects: subjectIds.map((id) => ({
      id,
      name: text(preferredDisplayName(personWith(id)), bounds.field),
    })),
    ...(left > 0 ? { moreSubjects: left } : {}),
    status,
    updated,
  };
}

function hostedMessage(listed: number, hasNew: boolean, truncated: boolean): string {
  const parts: string[] = [];
  if (listed > 0) parts.push("Pass a listed project's projectPath to continue it.");
  if (hasNew) {
    parts.push(
      listed > 0 || truncated
        ? "To start a project for a person none of them is about, pass newProjectPath as projectPath."
        : `No project yet: pass newProjectPath as projectPath to start one. ${START_PROJECT_RULE}`,
    );
  } else {
    parts.push("No other project can be started here.");
  }
  if (truncated) {
    parts.push(
      "More projects exist than are listed, and the most recently updated come first, so a " +
        "person none of them is about may already have one: ask the researcher before starting a new project.",
    );
  }
  return parts.join(" ");
}

export async function projectList(): Promise<ProjectListResult> {
  const store = getProjectStore();
  const listing = await store.listProjects();
  if (listing.mode === "folder") return { mode: "folder", message: FOLDER_MESSAGE };

  const bounds = listing.mode === "owned" ? USER_LISTING : VERBATIM;
  const truncated = listing.mode === "owned" && listing.truncated;
  const projects: ProjectListEntry[] = [];
  let newProjectPath: string | undefined;
  for (const projectPath of listing.projectPaths) {
    if (await store.exists(projectPath, "research.json")) projects.push(await entry(projectPath, bounds));
    else newProjectPath ??= projectPath;
  }
  return {
    mode: "hosted",
    projects,
    ...(truncated ? { truncated: true as const } : {}),
    ...(newProjectPath !== undefined ? { newProjectPath } : {}),
    message: hostedMessage(projects.length, newProjectPath !== undefined, truncated),
  };
}

// ─── MCP schema ──────────────────────────────────────────────────────────────

export const projectListSchema = {
  name: "project_list",
  description:
    "Call first, before any other genealogy tool, when the conversation names no projectPath. " +
    "Returns mode and message. mode \"folder\": the task's working folder is the project; pass " +
    "its absolute path as projectPath and call project_context with it before routing, since this answer " +
    "does not say whether a project exists there. mode \"hosted\": projects [{projectPath, " +
    "objective, subjects [{id, name}], moreSubjects, status, updated}] are the caller's projects, " +
    "and newProjectPath, when present, is where a new project goes. A signed-in user's list is " +
    "bounded: a text ending in … was cut, moreSubjects counts subjects left out, and truncated: " +
    "true means more projects exist than are listed, so a person not listed may still have one. " +
    "Writes nothing.",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
};

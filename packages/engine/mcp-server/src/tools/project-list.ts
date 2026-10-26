// project_list — which projects this server keeps, and where a new one goes.
//
// The file backend keeps each project in a folder the caller names, so it lists
// none and says so. A hosted store names the paths it answers for: each holding a
// research.json is a project, and the first holding none is where a new project
// goes. Spec: docs/specs/project-list-tool-spec.md.

import { getProjectStore } from "../store/project-store.js";
import { preferredDisplayName } from "./project-context.js";

export interface ProjectListSubject {
  id: string;
  name: string | null;
}

export interface ProjectListEntry {
  projectPath: string;
  objective: string | null;
  subjects: ProjectListSubject[];
  status: string | null;
  updated: string | null;
  /** The project's viewer page, when the server knows its public URL. */
  projectUrl?: string;
}

export interface ProjectListResult {
  mode: "folder" | "hosted";
  /** Hosted only: an empty list on the file store would read as "no project". */
  projects?: ProjectListEntry[];
  newProjectPath?: string;
  message: string;
}

const FOLDER_MESSAGE =
  "The task's working folder is the project: pass its absolute path as projectPath, " +
  "and read what it holds with project_context.";

/** Parsed JSON at `ref`, or null when it is absent, unreadable or not JSON. */
async function readJson(projectPath: string, ref: string): Promise<any> {
  try {
    return JSON.parse(await getProjectStore().readText(projectPath, ref));
  } catch {
    return null;
  }
}

const text = (v: unknown): string | null => (typeof v === "string" ? v : null);

async function entry(projectPath: string): Promise<ProjectListEntry> {
  const project = (await readJson(projectPath, "research.json"))?.project;
  const tree = await readJson(projectPath, "tree.gedcomx.json");
  const persons: any[] = Array.isArray(tree?.persons) ? tree.persons : [];
  const ids: unknown[] = Array.isArray(project?.subject_person_ids) ? project.subject_person_ids : [];
  return {
    projectPath,
    objective: text(project?.objective),
    subjects: ids
      .filter((id): id is string => typeof id === "string")
      .map((id) => ({ id, name: preferredDisplayName(persons.find((p) => p?.id === id)) })),
    status: text(project?.status),
    updated: text(project?.updated),
  };
}

function hostedMessage(listed: number, hasNew: boolean): string {
  const parts: string[] = [];
  if (listed > 0) parts.push("Pass a listed project's projectPath to continue it.");
  if (hasNew) {
    parts.push(
      listed > 0
        ? "To start a project for a person none of them is about, pass newProjectPath as projectPath."
        : "No project yet: pass newProjectPath as projectPath to start one.",
    );
  } else {
    parts.push("No other project can be started here.");
  }
  return parts.join(" ");
}

export async function projectList(): Promise<ProjectListResult> {
  const store = getProjectStore();
  const listing = await store.listProjects();
  if (listing.mode === "folder") return { mode: "folder", message: FOLDER_MESSAGE };

  const projects: ProjectListEntry[] = [];
  let newProjectPath: string | undefined;
  for (const projectPath of listing.projectPaths) {
    if (await store.exists(projectPath, "research.json")) projects.push(await entry(projectPath));
    else newProjectPath ??= projectPath;
  }
  return {
    mode: "hosted",
    projects,
    ...(newProjectPath !== undefined ? { newProjectPath } : {}),
    message: hostedMessage(projects.length, newProjectPath !== undefined),
  };
}

// ─── MCP schema ──────────────────────────────────────────────────────────────

export const projectListSchema = {
  name: "project_list",
  description:
    "Call first, before any other genealogy tool, when the conversation names no projectPath. " +
    "Returns mode and message. mode \"folder\": the task's working folder is the project; pass " +
    "its absolute path as projectPath and read it with project_context. mode \"hosted\": projects [{projectPath, " +
    "objective, subjects [{id, name}], status, updated}] are the caller's projects, and " +
    "newProjectPath, when present, is where a new project goes. Writes nothing.",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
};

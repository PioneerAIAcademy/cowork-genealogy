// Which project a call means, and whether this server may read it. Both tools
// and the image route go through here, so one rule holds everywhere. Refusals
// name a folder by its name: the absolute path of the root never reaches a caller.
import { realpath } from "node:fs/promises";
import { basename, isAbsolute, join, relative } from "node:path";
import { getProjectStore } from "../src/store/project-store.js";
import { classifyProjectPath, isInsideProject, NO_PROJECT_MESSAGE_READ } from "../src/utils/project-io.js";

export interface ProjectRef {
  /** The realpath the store reads. */
  real: string;
  /** `real` relative to the root; empty when the root is the project. */
  rel: string;
}

/** `candidate`'s real path when it stays inside the root, else null. */
async function contained(rootReal: string, candidate: string): Promise<ProjectRef | null> {
  let real: string;
  try {
    real = await realpath(candidate);
  } catch {
    return null;
  }
  return isInsideProject(rootReal, real) ? { real, rel: relative(rootReal, real) } : null;
}

/** The names under the root that hold a project this server would open. */
async function projectFolders(rootReal: string): Promise<string[]> {
  const names: string[] = [];
  for (const { name } of await getProjectStore().list(rootReal, ".")) {
    const folder = await contained(rootReal, join(rootReal, name));
    if (folder && (await classifyProjectPath(folder.real)) === "project") names.push(name);
  }
  return names;
}

async function rootAsProject(rootReal: string): Promise<ProjectRef> {
  const root = await contained(rootReal, rootReal);
  if (!root) throw unreachable(rootReal);
  if (await getProjectStore().exists(root.real, "research.json")) return root;
  const names = await projectFolders(rootReal);
  throw new Error(
    names.length > 0
      ? `No projectPath was given and the root is not a project. Project folders: ${names.join(", ")}.`
      : "No projectPath was given, the root is not a project, and it holds no project folders.",
  );
}

function isBareName(name: string): boolean {
  return name !== "" && name !== "." && name !== ".." && !/[/\\]/.test(name);
}

/** The same refusal for a folder that is missing, outside the root or not a
 *  folder, so a caller cannot use it to learn what exists outside the root. */
function unreachable(candidate: string): Error {
  return new Error(`No project folder "${basename(candidate)}" can be reached from this viewer.`);
}

export async function resolveProject(rootReal: string, projectPath: unknown): Promise<ProjectRef> {
  if (projectPath === undefined) return rootAsProject(rootReal);
  if (typeof projectPath !== "string") throw new Error("projectPath must be a string.");
  if (!isAbsolute(projectPath) && !isBareName(projectPath)) {
    throw new Error(`projectPath must be an absolute path or one folder name, not "${projectPath}".`);
  }
  const candidate = isAbsolute(projectPath) ? projectPath : join(rootReal, projectPath);
  const project = await contained(rootReal, candidate);
  if (!project) throw unreachable(candidate);
  switch (await classifyProjectPath(project.real)) {
    case "project":
      return project;
    case "no_project":
      throw new Error(NO_PROJECT_MESSAGE_READ);
    default:
      throw unreachable(candidate);
  }
}

/** A signed `rel` resolved again, since the folder can change after signing.
 *  Null unless it still lands on the same place inside the root. */
export async function reopenProject(rootReal: string, rel: string): Promise<ProjectRef | null> {
  const project = await contained(rootReal, join(rootReal, rel));
  return project?.rel === rel ? project : null;
}

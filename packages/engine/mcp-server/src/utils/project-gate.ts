// The one gate that keeps a call with no project out of every tool (lead,
// 2026-11-19). Every activity starts a project, so every tool requires
// `projectPath` and refuses when no project is there, except the six that manage
// projects or sign-in and `tree_gaps`, which tree-survey runs in folder mode before any
// project exists (lead, 2026-11-21: a folder holds one project, so the survey must not
// create one there). It reads FamilySearch only and writes nothing. No tool is classified by what it reads: a new tool needs no
// judgment call, only a `projectPath` in `required` (tests/packaging/
// project-gate.test.ts fails when it is missing).
//
// `server.ts` calls `projectGateRefusal` once, beside `rejectUnknownArgs`, before
// any tool arm runs. The connector-only tools (`show_project`, `read_project_view`)
// are dispatched before it and are outside it on purpose: they resolve the project
// themselves.

import { NO_PROJECT_REFUSAL, classifyProjectPath } from "./project-io.js";

/** Tools that run with no project: they create or list projects, sign in, or (tree_gaps) only read the FamilySearch tree. */
export const PROJECT_EXEMPT_TOOLS: ReadonlySet<string> = new Set([
  "project_create",
  "project_list",
  "project_context",
  "login",
  "logout",
  "auth_status",
  "tree_gaps",
]);

/** The refusal for a call to `tool`, or `null` when the call may run. A missing
 *  `projectPath` is checked from the arguments alone, before any store is asked:
 *  a connector call that names no project holds a store that cannot classify. */
export async function projectGateRefusal(tool: string, args: unknown): Promise<string | null> {
  if (PROJECT_EXEMPT_TOOLS.has(tool)) return null;
  const projectPath = (args as { projectPath?: unknown } | null | undefined)?.projectPath;
  if (typeof projectPath !== "string" || projectPath.trim() === "") return NO_PROJECT_REFUSAL;
  try {
    return (await classifyProjectPath(projectPath)) === "project" ? null : NO_PROJECT_REFUSAL;
  } catch {
    return NO_PROJECT_REFUSAL;
  }
}

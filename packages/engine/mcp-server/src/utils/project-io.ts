// project-io — the shared read/write layer for the MCP server's project files
// (research.json / tree.gedcomx.json and their siblings).
//
// Until the merge and research-log tools landed, the server only ever *read*
// the project files (validate_research_schema, person_warnings); the only
// writeFile calls anywhere were auth tokens. These tools are the first to
// overwrite the user's irreplaceable research, so their write primitives live
// here as independently unit-tested utils rather than being reimplemented per
// tool. Spec: docs/specs/validate-project-refactor-spec.md §10.
//
// Nothing here touches the filesystem. Every read and write goes through the
// active `ProjectStore` (src/store/), which is the file backend on the desktop
// and in the harnesses and something else in a hosted deployment; the utils
// keep the classification, the error wording and the no-project contract, and
// the store keeps the I/O. Refs are project-relative (`results/log_001.json`),
// never absolute paths, so a caller cannot name a file outside the project.

import type { ValidationError } from "../validation/types.js";
import { getProjectStore } from "../store/project-store.js";
import type {
  JsonWrite,
  ProjectPathClass,
  WriteJsonBothOptions,
} from "../store/project-store.js";

export { isInsideProject, assertInsideProject } from "../store/paths.js";
export type { ProjectPathClass } from "../store/project-store.js";

/**
 * Run `fn` while holding this project's write lock, serializing it against every
 * other `withProjectLock` call for the same project. Wrap the ENTIRE tool body —
 * from the first read to the last write — so the read-modify-write window
 * cannot interleave with another writer's (issue #1715; the race and the
 * residual are documented on `FsProjectStore`).
 *
 * NOT reentrant: a locked function must never call another locked function for
 * the same project (it would deadlock, waiting on a lock it holds). This is why
 * the two shared cores are locked and their thin wrappers are not —
 * extraction_append → researchAppend and tree_correct → executeTreeOps lock only
 * the inner function. A same-project re-acquire is rejected synchronously with a
 * message naming the key, so the trap surfaces as a thrown error rather than a
 * silent hang.
 *
 * On a database backend this is the transaction that also holds the project's
 * advisory lock, which is why the validate step runs inside it and not after.
 */
export function withProjectLock<T>(projectPath: string, fn: () => Promise<T>): Promise<T> {
  return getProjectStore().withTransaction(projectPath, fn);
}

// The user is not in a research project. Not a failure — these are relayed to a
// person unedited, so they are worded for a reader rather than for a log.
//
// Two variants because four of the twelve tools that return this are NOT
// writers: `research_query` and `project_context` are reads, and
// `person_warnings` / `merge_warnings` are previews. Telling someone who asked
// "where are we?" in a non-project folder that their work was not saved is both
// wrong and alarming.
const NO_PROJECT_BASE = "This folder is not a research project — there is no research.json here.";

export const NO_PROJECT_MESSAGE_WRITE =
  `${NO_PROJECT_BASE} Nothing was saved; the answer stands, only the record of it is missing.`;

export const NO_PROJECT_MESSAGE_READ =
  `${NO_PROJECT_BASE} There is no project state to read — anything you are working on is standalone.`;

/** Which of the two sentences a tool's no-project answer carries. */
export type NoProjectKind = "write" | "read";

export const MISSING_PROJECT_PATH_MESSAGE = "projectPath is required";

/** The second sentence a person reads out of `classifyProjectPath`'s loud rows,
 *  and the one that takes an argument. A function rather than a constant so the
 *  single-phrasing packaging guard can hold it to the same rule as the others —
 *  `person_warnings` classifies the directory itself and would otherwise carry
 *  its own copy. */
export const missingProjectDirMessage = (projectPath: unknown): string =>
  `projectPath does not exist: ${projectPath}`;

/**
 * Raised by `readProjectJson` when `projectPath` is a real directory holding
 * neither project file. Tools re-raise this class UNCHANGED (rather than
 * flattening it into their own error class) so their outer catch can return
 * `noProjectResult()` instead of a failure.
 */
export class NoProjectError extends Error {
  constructor() {
    super(NO_PROJECT_BASE);
    this.name = "NoProjectError";
  }
}

export type NoProjectResult = {
  ok: false;
  reason: "no_project";
  errors: string[];
};

/**
 * The one place the no-project answer is constructed.
 *
 * `ok: false` because nothing was written, `errors` retained so every existing
 * consumer keeps working — `reason` is the sole discriminator, and it is what
 * `writerToolResult` reads to leave `isError` unset. A caller that only reads
 * `errors` still relays a sentence that reads as an answer.
 */
export function noProjectResult(kind: NoProjectKind = "write"): NoProjectResult {
  return {
    ok: false,
    reason: "no_project",
    errors: [kind === "read" ? NO_PROJECT_MESSAGE_READ : NO_PROJECT_MESSAGE_WRITE],
  };
}

/**
 * Classify `projectPath` itself — deliberately independent of any filename.
 *
 * Six of the twelve project-reading tools read `tree.gedcomx.json` FIRST, so a
 * verdict derived from the file the current read wanted would hand those six a
 * `tree.gedcomx.json not found` message in a folder that simply is not a
 * project. The state of the directory is the same question whichever file the
 * caller asked for, so it is answered here once.
 *
 * `"project"` covers both-files-present AND exactly-one-present: a folder
 * holding one half of a project is a BROKEN project, not a missing one, and
 * must stay loud — otherwise a write against a project whose `research.json`
 * was deleted is dropped with a cheerful message.
 */
export function classifyProjectPath(projectPath: unknown): Promise<ProjectPathClass> {
  return getProjectStore().classifyProject(projectPath);
}

/**
 * The project a new project at `projectPath` would end up nested inside —
 * the nearest ancestor holding `research.json` — or `null`. Only the file
 * backend has ancestors; see `FsProjectStore.findNestingAncestor` for the
 * realpath contract behind the reported path.
 */
export function findNestingAncestor(projectPath: string): Promise<string | null> {
  return getProjectStore().findNestingAncestor(projectPath);
}

/**
 * Read and parse one of the project's JSON documents.
 *
 * Throws:
 *   - `NoProjectError` — the directory exists and holds neither project file.
 *     Re-raise this class unchanged; it is an answer, not a failure.
 *   - a plain Error with `projectPath is required`, `projectPath does not
 *     exist: <path>`, `<filename> not found in projectPath`, or `<filename> is
 *     not valid JSON`.
 *
 * Every project-file read goes through this helper. The caller maps its plain
 * Error onto its own result shape (typically `{ ok: false, errors }` via a
 * tool-specific error class wrapper — see tree-forget.ts for the pattern).
 */
export async function readProjectJson(projectPath: string, filename: string): Promise<any> {
  switch (await classifyProjectPath(projectPath)) {
    case "missing_arg":
      throw new Error(MISSING_PROJECT_PATH_MESSAGE);
    case "missing_dir":
      throw new Error(missingProjectDirMessage(projectPath));
    case "no_project":
      throw new NoProjectError();
  }
  let text: string;
  try {
    text = await getProjectStore().readText(projectPath, filename);
  } catch {
    throw new Error(`${filename} not found in projectPath`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${filename} is not valid JSON`);
  }
}

/** Format validator issues as flat strings for the tool's error/warning lists. */
export function formatIssues(issues: ValidationError[]): string[] {
  return issues.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message));
}

/**
 * True if `ref` exists in the project. Exposed because the restore-file
 * semantics in `tree_forget` turn on "already there?" rather than on an
 * overwrite.
 */
export function fileExists(projectPath: string, ref: string): Promise<boolean> {
  return getProjectStore().exists(projectPath, ref);
}

/**
 * Atomically write `obj` as JSON at the project-relative `ref`: a reader never
 * observes a partially written document (temp-write + rename on the file
 * backend). Creates missing parent directories.
 */
export function atomicWriteJson(projectPath: string, ref: string, obj: unknown): Promise<void> {
  return getProjectStore().writeJson(projectPath, ref, obj);
}

export type AtomicWrite = JsonWrite;

export type AtomicWriteBothOptions = WriteJsonBothOptions;

/**
 * Write two (or more) JSON documents both-or-neither, committed in the order
 * given (the merge tools pass [tree, research]). On the file backend two
 * renames are NOT truly atomic on POSIX — a crash between them leaves the
 * earlier file new and the later one old — but writing all temps up front (so
 * a write/serialize failure aborts before any rename) and renaming
 * back-to-back shrinks the inconsistency window to microseconds, with
 * validate-on-next-open as the backstop.
 *
 * Spec: docs/specs/validate-project-refactor-spec.md §10.
 */
export function atomicWriteBoth(
  projectPath: string,
  writes: AtomicWrite[],
  options?: AtomicWriteBothOptions,
): Promise<void> {
  return getProjectStore().writeJsonBoth(projectPath, writes, options);
}

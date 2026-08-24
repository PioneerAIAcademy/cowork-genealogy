// project-io — the shared write layer for the MCP server's first writers of
// research.json / tree.gedcomx.json.
//
// Until the merge and research-log tools landed, the server only ever *read*
// the project files (validate_research_schema, person_warnings); the only
// writeFile calls anywhere were auth tokens. These tools are the first to
// overwrite the user's irreplaceable research, so their write primitives live
// here as independently unit-tested utils rather than being reimplemented per
// tool. Spec: docs/specs/validate-project-refactor-spec.md §10.

import { writeFile, readFile, rename, mkdir, unlink, copyFile, access, stat } from "fs/promises";
import { realpathSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { dirname, join, resolve, relative, isAbsolute } from "path";
import { randomUUID } from "node:crypto";
import type { ValidationError } from "../validation/types.js";

/**
 * True if `ref` (relative or absolute) resolves to a path inside `projectPath`.
 *
 * This is the single source of the path-traversal guard logic. The project
 * validator's sidecar pass uses this predicate to report an escape via its own
 * `addError`; the staging / log-append finalize guards use `assertInsideProject`
 * (below) to reject outright. Both share this one implementation.
 */
export function isInsideProject(projectPath: string, ref: string): boolean {
  const relToProject = relative(resolve(projectPath), resolve(projectPath, ref));
  return !(relToProject.startsWith("..") || isAbsolute(relToProject));
}

/**
 * Resolve `ref` against `projectPath`, throwing if it escapes the project
 * directory. Returns the absolute resolved path on success (so callers that
 * guard then read a file get the path in one step).
 */
export function assertInsideProject(projectPath: string, ref: string): string {
  if (!isInsideProject(projectPath, ref)) {
    throw new Error(`path '${ref}' escapes the project directory`);
  }
  return resolve(projectPath, ref);
}

// ─── Per-project write serialization (issue #1715) ──────────────────────────
//
// Every writer tool (research_append, research_log_append, tree_edit,
// materialize_facts, merge_tree_persons, tree_forget) is a read-modify-write:
// it reads research.json / tree.gedcomx.json, allocates ids as "highest + 1"
// from what it read, mutates in memory, then writes atomically. Two of these
// running concurrently against one project both read the pre-write state, both
// allocate the same next id, and the losing write is silently lost — the losing
// caller still gets a success naming ids that ended up belonging to the other
// writer's record, and `validate_research_schema` passes afterward because a
// lost update leaves a perfectly consistent file that merely omits a record.
//
// `withProjectLock` closes that window by serializing the WHOLE tool body —
// acquire before the first read, release after the last write — keyed on the
// resolved project path. One lock per project, not per file: materialize_facts
// writes the tree while research_append's composite path writes tree + research
// together, so a per-file lock would still lose one of them.
//
// Residual (stated in docs/specs/research-append-tool-spec.md): this binds only
// within one MCP server process. Every deployment we run is one server per
// session, so it holds there; whether two Cowork desktop sessions on the same
// folder share one .mcpb process is unverified, and if they do not the lock does
// not bind across them. The change is strictly better than today either way.

/** A FIFO async mutex: `run` queues its callback behind every earlier one and
 *  releases the next only after this one settles (resolve OR reject). */
class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.tail;
    let release!: () => void;
    // Reassigned synchronously, before the first await below, so callers arriving
    // in the same tick chain in arrival order rather than racing on `tail`.
    this.tail = new Promise<void>((resolve) => (release = resolve));
    return prev.then(fn).finally(release);
  }
}

// Keyed by resolved project path. One entry per distinct project seen this
// process — bounded (a session works one project) and never evicted: deleting a
// mutex a queued caller still holds a reference to would reintroduce the race.
const projectLocks = new Map<string, AsyncMutex>();

// The set of lock keys held by the current async execution context. Because the
// mutex is NOT reentrant, a locked writer that re-acquires the same project's
// lock — directly or through a call chain — would wait forever on a lock it
// already holds. This turns that hang into an immediate, named throw. It is a
// guard for future writers, not a behavior change for correct callers: no
// locked tool cross-calls another today (spec §4.1), so the set never contains
// a key on the fast path.
const heldLockKeys = new AsyncLocalStorage<Set<string>>();

/**
 * Run `fn` while holding this project's write lock, serializing it against every
 * other `withProjectLock` call for the same resolved `projectPath`. Wrap the
 * ENTIRE tool body — from the first read to the last write — so the
 * read-modify-write window cannot interleave with another writer's.
 *
 * NOT reentrant: a locked function must never call another locked function for
 * the same project (it would deadlock, waiting on a lock it holds). This is why
 * the two shared cores are locked and their thin wrappers are not —
 * extraction_append → researchAppend and tree_correct → executeTreeOps lock only
 * the inner function. A same-project re-acquire is rejected synchronously with a
 * message naming the key, so the trap surfaces as a thrown error rather than a
 * silent hang.
 */
/** The lock's identity. `resolve` alone is not enough: two callers can name one
 *  project through different symlinks — and on macOS `/tmp` IS a symlink to
 *  `/private/tmp` — which would hand them separate mutexes and silently unlock
 *  the very race this exists to stop. `realpathSync.native` also folds the
 *  case-insensitive spellings a Windows caller can produce. Falls back to the
 *  resolved path when the project directory does not exist yet, since the
 *  caller's own read is the right place for that to fail. */
function lockKey(projectPath: string): string {
  // A missing/blank projectPath is the caller's read's job to reject loudly
  // (readProjectJson → "projectPath is required"). resolve() would throw a raw
  // TypeError here and pre-empt that loud answer, so fall back to a stable key
  // and let the body's read fail as designed.
  if (typeof projectPath !== "string" || projectPath.trim() === "") {
    return String(projectPath);
  }
  const resolved = resolve(projectPath);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

export function withProjectLock<T>(projectPath: string, fn: () => Promise<T>): Promise<T> {
  const key = lockKey(projectPath);
  const held = heldLockKeys.getStore();
  if (held?.has(key)) {
    return Promise.reject(
      new Error(
        `withProjectLock re-entered for '${key}': a locked writer called another ` +
          `locked writer for the same project. The mutex is not reentrant and this ` +
          `would deadlock — lock only the outermost writer (see project-io.ts §1715).`,
      ),
    );
  }
  let mutex = projectLocks.get(key);
  if (!mutex) {
    mutex = new AsyncMutex();
    projectLocks.set(key, mutex);
  }
  // Record this key as held for the duration of `fn`, carrying forward any keys
  // an outer lock already holds so nested locks on *different* projects are
  // still allowed (only same-key re-entry deadlocks).
  const nextHeld = new Set(held);
  nextHeld.add(key);
  return mutex.run(() => heldLockKeys.run(nextHeld, fn));
}

/** Serialize an object to pretty JSON, matching the on-disk project format. */
function serialize(obj: unknown): string {
  return JSON.stringify(obj, null, 2);
}

/** What `projectPath` actually points at, decided WITHOUT reference to which
 *  file the caller wanted. See `classifyProjectPath`. */
export type ProjectPathClass = "missing_arg" | "missing_dir" | "no_project" | "project";

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
export async function classifyProjectPath(projectPath: unknown): Promise<ProjectPathClass> {
  // Checked before any stat: `stat(undefined)` throws ERR_INVALID_ARG_TYPE
  // rather than the ENOENT the "missing directory" branch expects.
  if (typeof projectPath !== "string" || projectPath.trim() === "") return "missing_arg";
  try {
    if (!(await stat(projectPath)).isDirectory()) return "missing_dir";
  } catch {
    return "missing_dir";
  }
  // NOT `fileExists`, which swallows every access() failure as "absent". A real
  // project directory that has lost its execute bit (mode 600 — restored from a
  // backup, copied from a restrictive archive, an odd sandbox mount) stats fine
  // as a directory while both probes throw EACCES. Read as "absent" that becomes
  // `no_project`, and a write against a genuine project is dropped with a
  // cheerful message — the exact silent loss the half-a-project rule exists to
  // prevent. Anything that is not a clean ENOENT stays "project" so the read
  // below fails loudly.
  const [research, tree] = await Promise.all([
    fileState(join(projectPath, "research.json")),
    fileState(join(projectPath, "tree.gedcomx.json")),
  ]);
  return research === "absent" && tree === "absent" ? "no_project" : "project";
}

/** Three-way, unlike `fileExists`: an unreadable path is not an absent one. */
async function fileState(path: string): Promise<"present" | "absent" | "unreadable"> {
  try {
    await access(path);
    return "present";
  } catch (e: any) {
    return e?.code === "ENOENT" ? "absent" : "unreadable";
  }
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

/** Format validator issues as flat strings for the tool's error/warning lists. */
export function formatIssues(issues: ValidationError[]): string[] {
  return issues.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message));
}

/**
 * True if `path` exists. Exposed because the restore-file semantics in
 * `tree_forget` turn on "already there?" rather than on an overwrite.
 */
export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy `path` to `path.bak` if it exists — a one-deep backup before an
 * irreversible overwrite (the merge and tree-edit tools call this; the
 * append-only writers do not). No-op when `path` doesn't exist yet.
 */
export async function backupIfExists(path: string): Promise<void> {
  try {
    await access(path);
  } catch {
    return;
  }
  await copyFile(path, `${path}.bak`);
}

/**
 * Atomically write `obj` as JSON to `path`: write a sibling temp file, then
 * rename it over the target. The rename is atomic on a POSIX filesystem, so a
 * reader never observes a partially written file.
 */
export async function atomicWriteJson(path: string, obj: unknown): Promise<void> {
  const tmp = `${path}.tmp-${randomUUID()}`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(tmp, serialize(obj), "utf-8");
  try {
    await rename(tmp, path);
  } catch (error) {
    await unlink(tmp).catch(() => {});
    throw error;
  }
}

export interface AtomicWrite {
  path: string;
  data: unknown;
}

export interface AtomicWriteBothOptions {
  /**
   * Test-only seam: invoked after the first rename and before the second. A
   * throw here simulates a crash *between* the two renames, leaving the first
   * file committed (new) and the second still at its old content — the residual
   * window the two-rename contract documents.
   */
  onBeforeSecondRename?: () => void | Promise<void>;
}

/**
 * Write two (or more) JSON files both-or-neither: write every temp first, then
 * rename them back-to-back. Two renames are NOT truly atomic on POSIX — a crash
 * between them leaves the earlier file new and the later one old — but writing
 * all temps up front (so a write/serialize failure aborts before any rename)
 * and renaming back-to-back shrinks the inconsistency window to microseconds,
 * with validate-on-next-open as the backstop. Order matters: pass the writes in
 * the order you want them committed (the merge tools pass [tree, research]).
 *
 * Spec: docs/specs/validate-project-refactor-spec.md §10.
 */
export async function atomicWriteBoth(
  writes: AtomicWrite[],
  options?: AtomicWriteBothOptions,
): Promise<void> {
  // Phase 1 — write every temp. Any failure here aborts before a single rename,
  // so all targets keep their old content.
  const temps: Array<{ tmp: string; path: string }> = [];
  try {
    for (const w of writes) {
      const tmp = `${w.path}.tmp-${randomUUID()}`;
      await mkdir(dirname(w.path), { recursive: true });
      await writeFile(tmp, serialize(w.data), "utf-8");
      temps.push({ tmp, path: w.path });
    }
  } catch (error) {
    await Promise.all(temps.map((t) => unlink(t.tmp).catch(() => {})));
    throw error;
  }

  // Phase 2 — rename back-to-back.
  for (let i = 0; i < temps.length; i++) {
    if (i > 0 && options?.onBeforeSecondRename) {
      await options.onBeforeSecondRename();
    }
    await rename(temps[i].tmp, temps[i].path);
  }
}

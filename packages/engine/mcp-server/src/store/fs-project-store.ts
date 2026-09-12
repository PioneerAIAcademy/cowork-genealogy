// FsProjectStore — project state as files under the project directory. This is
// the filesystem code that lived in utils/project-io.ts, utils/results-staging.ts,
// utils/image-store.ts and validation/validator.ts, moved here so that every
// caller reaches disk through one seam (`ProjectStore`) and none of them imports
// `fs`. The bodies are unchanged; the utils keep their names and messages and
// delegate here. Write-path contract: docs/specs/validate-project-refactor-spec.md
// §10.

import {
  access,
  appendFile,
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { realpathSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { assertInsideProject } from "./paths.js";
import type {
  JsonWrite,
  ProjectDirState,
  ProjectEntry,
  ProjectPathClass,
  ProjectStore,
  WriteJsonBothOptions,
} from "./project-store.js";

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
// `withTransaction` closes that window by serializing the WHOLE tool body —
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

/** Serialize an object to pretty JSON, matching the on-disk project format. */
function serialize(obj: unknown): string {
  return JSON.stringify(obj, null, 2);
}

/**
 * Temp-file name for an atomic write: a **dot-prefixed** sibling of the target.
 * A crash between write and rename then leaves `.<file>.tmp-<uuid>`, which the
 * feedback bundler skips along with every other dotfile — rather than a
 * readable, unredacted tree copy it would ship (issue #2333's leak class, the
 * same reason `tree_forget` dot-prefixes its restore file).
 */
function tmpSibling(path: string): string {
  return join(dirname(path), `.${basename(path)}.tmp-${randomUUID()}`);
}

/** Three-way, unlike `exists`: an unreadable path is not an absent one. */
async function fileState(path: string): Promise<"present" | "absent" | "unreadable"> {
  try {
    await access(path);
    return "present";
  } catch (e: any) {
    return e?.code === "ENOENT" ? "absent" : "unreadable";
  }
}

export class FsProjectStore implements ProjectStore {
  // Keyed by resolved project path. One entry per distinct project seen this
  // process — bounded (a session works one project) and never evicted: deleting a
  // mutex a queued caller still holds a reference to would reintroduce the race.
  private readonly projectLocks = new Map<string, AsyncMutex>();

  // The set of lock keys held by the current async execution context. Because the
  // mutex is NOT reentrant, a locked writer that re-acquires the same project's
  // lock — directly or through a call chain — would wait forever on a lock it
  // already holds. This turns that hang into an immediate, named throw. It is a
  // guard for future writers, not a behavior change for correct callers: no
  // locked tool cross-calls another today (spec §4.1), so the set never contains
  // a key on the fast path.
  private readonly heldLockKeys = new AsyncLocalStorage<Set<string>>();

  /** Absolute path for a ref, refusing one that escapes the project. Every
   *  ref-taking method resolves through here, so the traversal guard holds at
   *  the seam even for a caller that forgot its own. */
  private abs(projectPath: string, ref: string): string {
    return assertInsideProject(projectPath, ref);
  }

  withTransaction<T>(projectPath: string, fn: () => Promise<T>): Promise<T> {
    const key = lockKey(projectPath);
    const held = this.heldLockKeys.getStore();
    if (held?.has(key)) {
      return Promise.reject(
        new Error(
          `withProjectLock re-entered for '${key}': a locked writer called another ` +
            `locked writer for the same project. The mutex is not reentrant and this ` +
            `would deadlock — lock only the outermost writer (see project-io.ts §1715).`,
        ),
      );
    }
    let mutex = this.projectLocks.get(key);
    if (!mutex) {
      mutex = new AsyncMutex();
      this.projectLocks.set(key, mutex);
    }
    // Record this key as held for the duration of `fn`, carrying forward any keys
    // an outer lock already holds so nested locks on *different* projects are
    // still allowed (only same-key re-entry deadlocks).
    const nextHeld = new Set(held);
    nextHeld.add(key);
    return mutex.run(() => this.heldLockKeys.run(nextHeld, fn));
  }

  async classifyProject(projectPath: unknown): Promise<ProjectPathClass> {
    // Checked before any stat: `stat(undefined)` throws ERR_INVALID_ARG_TYPE
    // rather than the ENOENT the "missing directory" branch expects.
    if (typeof projectPath !== "string" || projectPath.trim() === "") return "missing_arg";
    try {
      if (!(await stat(projectPath)).isDirectory()) return "missing_dir";
    } catch {
      return "missing_dir";
    }
    // NOT `exists`, which swallows every access() failure as "absent". A real
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

  async projectDirState(projectPath: string): Promise<ProjectDirState> {
    let st;
    try {
      st = await stat(projectPath);
    } catch {
      return "missing";
    }
    return st.isDirectory() ? "directory" : "not_directory";
  }

  /**
   * Walk from `projectPath`'s PARENT up to the filesystem root, returning the
   * first ancestor directory holding `research.json` — the project a new
   * project at `projectPath` would end up nested inside. `null` when no
   * ancestor holds one.
   *
   * Each candidate ancestor is realpath'd as the walk reaches it — not once at
   * the start, on `projectPath` itself. `projectPath` normally doesn't exist
   * yet (this runs before `project_create` writes anything), so realpath'ing
   * it always throws and falls back to the raw resolved form; canonicalizing
   * the *ancestors* instead is what actually matters, since this value is
   * returned to the caller in the refusal message and compared against real
   * paths, not just used internally. `fileState`'s `access()` already resolves
   * symlinks in every path component regardless of canonicalization, so that
   * is not what realpath buys here — what it buys is the *reported* path: on
   * Windows, a temp path with an 8.3-shortened component (e.g. a username with
   * a space) would otherwise surface the short form in the error message
   * instead of the one the user actually navigated to.
   *
   * Treats "unreadable" the same as "present" (only a clean ENOENT counts as
   * absent), matching `classifyProject`'s posture: a `research.json` that
   * exists but cannot be read (a permissions issue, a restrictive mount) still
   * makes that ancestor a project, not an empty folder to nest inside.
   */
  async findNestingAncestor(projectPath: string): Promise<string | null> {
    let dir = dirname(resolve(projectPath));
    for (;;) {
      let real = dir;
      try {
        real = realpathSync.native(dir);
      } catch {
        // Not created yet; compare lexically and keep walking.
      }
      if ((await fileState(join(real, "research.json"))) !== "absent") {
        return real;
      }
      const parent = dirname(dir);
      if (parent === dir) return null; // reached the filesystem root
      dir = parent;
    }
  }

  async exists(projectPath: string, ref: string): Promise<boolean> {
    try {
      await access(this.abs(projectPath, ref));
      return true;
    } catch {
      return false;
    }
  }

  async readText(projectPath: string, ref: string): Promise<string> {
    return readFile(this.abs(projectPath, ref), "utf-8");
  }

  async list(projectPath: string, dirRef: string): Promise<ProjectEntry[]> {
    const dir = this.abs(projectPath, dirRef);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return [];
    }
    const entries: ProjectEntry[] = [];
    await Promise.all(
      names.map(async (name) => {
        try {
          const s = await stat(join(dir, name));
          entries.push({ name, mtimeMs: s.mtimeMs });
        } catch {
          // best-effort: ignore ENOENT / races / stat failures
        }
      }),
    );
    // readdir order is filesystem-defined; callers that care sort by mtime.
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return entries;
  }

  /**
   * Atomically write `data` as JSON: write a sibling temp file, then rename it
   * over the target. The rename is atomic on a POSIX filesystem, so a reader
   * never observes a partially written file.
   */
  async writeJson(projectPath: string, ref: string, data: unknown): Promise<void> {
    const path = this.abs(projectPath, ref);
    const tmp = tmpSibling(path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(tmp, serialize(data), "utf-8");
    try {
      await rename(tmp, path);
    } catch (error) {
      await unlink(tmp).catch(() => {});
      throw error;
    }
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
  async writeJsonBoth(
    projectPath: string,
    writes: JsonWrite[],
    options?: WriteJsonBothOptions,
  ): Promise<void> {
    // Phase 1 — write every temp. Any failure here aborts before a single rename,
    // so all targets keep their old content.
    const temps: Array<{ tmp: string; path: string }> = [];
    try {
      for (const w of writes) {
        const path = this.abs(projectPath, w.ref);
        const tmp = tmpSibling(path);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(tmp, serialize(w.data), "utf-8");
        temps.push({ tmp, path });
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

  async writeBytes(projectPath: string, ref: string, bytes: Uint8Array): Promise<void> {
    const path = this.abs(projectPath, ref);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, Buffer.from(bytes));
  }

  async appendText(projectPath: string, ref: string, text: string): Promise<void> {
    const path = this.abs(projectPath, ref);
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, text, "utf-8");
  }

  async remove(projectPath: string, ref: string): Promise<void> {
    await unlink(this.abs(projectPath, ref)).catch(() => {});
  }
}

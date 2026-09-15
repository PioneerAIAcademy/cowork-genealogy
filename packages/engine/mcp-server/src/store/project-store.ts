// ProjectStore — the one seam between the tools and wherever project state lives.
//
// Every read and write of a project's documents (research.json,
// tree.gedcomx.json, the starting-tree baseline, evaluation verdicts), its
// sidecars (results/), its staging area (results/.staging/) and its retained
// scans (images/) goes through the active store. The desktop .mcpb and both eval
// harnesses run `FsProjectStore`, which is the filesystem code the utils used to
// hold, moved there verbatim. A hosted deployment installs a different backend
// with `setProjectStore()` and no tool changes. What makes that true is
// tests/packaging/no-fs-outside-store.test.ts: no module outside this directory
// (plus auth, which owns per-user files, and the bundled-data reader) may import
// `fs`, so a tool cannot reach the filesystem around the store.
//
// Vocabulary: `projectPath` is the project's identity exactly as the tools
// receive it — a directory on the file backend, an opaque key elsewhere. A `ref`
// is a project-relative POSIX path (`results/log_001.json`, `images/x.jpg`);
// a store rejects one that escapes the project.

import { FsProjectStore } from "./fs-project-store.js";

/** What `projectPath` actually points at, decided WITHOUT reference to which
 *  file the caller wanted. See `classifyProject`. */
export type ProjectPathClass = "missing_arg" | "missing_dir" | "no_project" | "project";

/** Finer than `ProjectPathClass` for the two producers (staging, images) whose
 *  refusal messages distinguish a missing project from a non-directory. */
export type ProjectDirState = "directory" | "not_directory" | "missing";

/** One entry of a project subdirectory listing. `mtimeMs` is what the TTL
 *  sweeps compare against; a backend without a real mtime reports the write time. */
export interface ProjectEntry {
  name: string;
  mtimeMs: number;
}

export interface JsonWrite {
  ref: string;
  data: unknown;
}

export interface WriteJsonBothOptions {
  /**
   * Test-only seam, honoured by the file backend: invoked after the first
   * rename and before the second. A throw here simulates a crash *between* the
   * two renames, leaving the first file committed (new) and the second still at
   * its old content — the residual window the two-rename contract documents.
   * A transactional backend has no such window and ignores it.
   */
  onBeforeSecondRename?: () => void | Promise<void>;
}

export interface ProjectStore {
  /**
   * Run `fn` serialized against every other writer for the same project. Wrap
   * the ENTIRE tool body — first read to last write — so a read-modify-write
   * cannot interleave with another writer's. On the file backend this is the
   * in-process FIFO mutex (issue #1715); on a database backend it is one
   * connection holding the project's advisory lock for the whole callback,
   * which is why the validate step must run inside it too.
   *
   * NOT reentrant: a locked function must never call another locked function
   * for the same project. A same-project re-acquire is rejected with a thrown
   * error naming the key rather than hanging.
   */
  withTransaction<T>(projectPath: string, fn: () => Promise<T>): Promise<T>;

  /** Classify `projectPath` itself, independent of any filename — see the
   *  docstring on `classifyProjectPath` in utils/project-io.ts. */
  classifyProject(projectPath: unknown): Promise<ProjectPathClass>;

  /** Whether `projectPath` names an existing project container. */
  projectDirState(projectPath: string): Promise<ProjectDirState>;

  /**
   * The nearest ancestor project a new project at `projectPath` would nest
   * inside, or `null`. Only the file backend has a notion of nesting; a
   * database backend returns `null`.
   */
  findNestingAncestor(projectPath: string): Promise<string | null>;

  /** True if `ref` exists in the project. */
  exists(projectPath: string, ref: string): Promise<boolean>;

  /** Read `ref` as UTF-8 text. Throws when it is absent or unreadable — the
   *  caller owns the message, since every caller words it differently. */
  readText(projectPath: string, ref: string): Promise<string>;

  /** List the entries directly under `dirRef`. An absent directory lists as
   *  empty. Entries that cannot be described are skipped, never fatal. */
  list(projectPath: string, dirRef: string): Promise<ProjectEntry[]>;

  /** Write `data` as pretty JSON at `ref`, atomically: a reader never observes
   *  a partial document. Creates missing parents. */
  writeJson(projectPath: string, ref: string, data: unknown): Promise<void>;

  /**
   * Write two (or more) JSON refs both-or-neither, committed in the order given
   * (the merge tools pass [tree, research]). On the file backend this is
   * write-every-temp then rename-back-to-back, with the residual window the
   * docstring on `atomicWriteBoth` records; a transactional backend commits
   * them in one transaction.
   */
  writeJsonBoth(projectPath: string, writes: JsonWrite[], options?: WriteJsonBothOptions): Promise<void>;

  /** Write raw bytes at `ref` (retained page scans). Creates missing parents. */
  writeBytes(projectPath: string, ref: string, bytes: Uint8Array): Promise<void>;

  /** Append `text` to `ref`, creating it and its parents if absent (the
   *  rank_search_matches score log). */
  appendText(projectPath: string, ref: string, text: string): Promise<void>;

  /** Remove `ref`, best-effort: an absent ref or a lost race is not an error. */
  remove(projectPath: string, ref: string): Promise<void>;
}

let active: ProjectStore | null = null;

/** The store every util and tool reads and writes through. Defaults to the
 *  file backend on first use. */
export function getProjectStore(): ProjectStore {
  if (!active) active = new FsProjectStore();
  return active;
}

/** Install a backend for this process (the hosted entrypoint; tests). `null`
 *  restores the default file backend on the next `getProjectStore()`. */
export function setProjectStore(store: ProjectStore | null): void {
  active = store;
}

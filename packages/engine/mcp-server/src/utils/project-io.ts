// project-io — the shared write layer for the MCP server's first writers of
// research.json / tree.gedcomx.json.
//
// Until the merge and research-log tools landed, the server only ever *read*
// the project files (validate_research_schema, person_warnings); the only
// writeFile calls anywhere were auth tokens. These tools are the first to
// overwrite the user's irreplaceable research, so their write primitives live
// here as independently unit-tested utils rather than being reimplemented per
// tool. Spec: docs/specs/validate-project-refactor-spec.md §10.

import { writeFile, rename, mkdir, unlink } from "fs/promises";
import { dirname, resolve, relative, isAbsolute } from "path";
import { randomUUID } from "node:crypto";

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

/** Serialize an object to pretty JSON, matching the on-disk project format. */
function serialize(obj: unknown): string {
  return JSON.stringify(obj, null, 2);
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

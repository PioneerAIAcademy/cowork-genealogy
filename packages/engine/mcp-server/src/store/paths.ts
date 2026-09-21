// Project-relative path safety. Shared by every store backend and by the utils
// that guard a model-supplied ref before handing it to the store, so there is
// one implementation of "does this ref stay inside the project" — the traversal
// guard research-log-editor-spec.md §8 and search-result-staging-spec.md §6 both
// describe.

import { isAbsolute, posix, relative, resolve } from "node:path";

/**
 * True if `ref` (relative or absolute) resolves to a path inside `projectPath`.
 *
 * The project validator's sidecar pass uses this predicate to report an escape
 * via its own `addError`; the staging / log-append finalize guards use
 * `assertInsideProject` (below) to reject outright. Both share this one
 * implementation.
 */
export function isInsideProject(projectPath: string, ref: string): boolean {
  const relToProject = relative(resolve(projectPath), resolve(projectPath, ref));
  return !(relToProject.startsWith("..") || isAbsolute(relToProject));
}

/**
 * A ref that leaves the project — by traversal in the string, or by a symlink
 * that resolves outside it. Its own class so a caller that rewrites every other
 * read failure to "not found" (`readProjectJson`) can let this one through:
 * the file exists, it is refused, and "not found" would be the wrong report.
 */
export class ProjectEscapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectEscapeError";
  }
}

/**
 * Resolve `ref` against `projectPath`, throwing if it escapes the project
 * directory. Returns the absolute resolved path on success (so callers that
 * guard then read a file get the path in one step).
 */
export function assertInsideProject(projectPath: string, ref: string): string {
  if (!isInsideProject(projectPath, ref)) {
    throw new ProjectEscapeError(`path '${ref}' escapes the project directory`);
  }
  return resolve(projectPath, ref);
}

/**
 * Normalise a project-relative ref without touching any filesystem, throwing
 * `ProjectEscapeError` ("escapes the project") when it could name anything
 * outside the project: an absolute path (POSIX or a Windows drive), a `..`
 * segment anywhere, an empty ref, or one that normalises to the root or above
 * it. Backslashes are read as separators so a Windows-spelled traversal cannot
 * slip past as a literal filename. Returns the POSIX form with `./`, repeated
 * and trailing slashes folded (`./results//x.json/` → `results/x.json`).
 *
 * This is the guard for a backend that has no directory to resolve against —
 * the Postgres/S3 store keys rows by ref — so it decides on the string alone;
 * the file backend's `assertInsideProject` additionally resolves against the
 * project directory.
 */
export function assertRelativeRef(ref: unknown): string {
  const escape = (why: string): never => {
    throw new ProjectEscapeError(`ref '${String(ref)}' escapes the project: ${why}`);
  };
  if (typeof ref !== "string" || ref === "") escape("a ref must be a non-empty project-relative path");
  const raw = ref as string;
  if (raw.includes("\u0000")) escape("it contains a NUL character");
  const slashed = raw.split("\\").join("/");
  if (posix.isAbsolute(slashed) || /^[A-Za-z]:/.test(slashed)) escape("it is an absolute path");
  if (slashed.split("/").includes("..")) escape("it contains a '..' segment");
  const normalised = posix.normalize(slashed).replace(/\/+$/, "");
  if (normalised === "" || normalised === "." || normalised === ".." || normalised.startsWith("../")) {
    escape("it resolves to the project root or above it");
  }
  return normalised;
}

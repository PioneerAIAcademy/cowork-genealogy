// Build stamp shared by the artifact builders (build-mcpb.mjs, package-plugin.mjs,
// write-build-info.mjs). Issue #2126: every version field in the repo was frozen
// at the value it was created with, so nothing identified which build of the
// .mcpb or the plugin a tester had installed. The stamp is the git sha plus the
// build date (lead ruling 2026-09-07), carried as semver BUILD METADATA so
// `mcpb validate` still accepts the manifest:
//
//     0.1.0+2026-09-17.abc12345          clean checkout
//     0.1.0+2026-09-17.abc12345.dirty    uncommitted changes in the tree
//     0.1.0+dev                          no git / no .git / no commits
//
// Never throws on a git failure — a build outside a checkout (or with no git on
// PATH) still produces an artifact, it just says `dev`. Same posture as
// eval/harness/e2e/provenance.py::git_sha and apps/server/app/config.py's "dev".
// The stamp is written only to STAGED / ZIPPED copies and to the gitignored
// build/build-info.json — never to a tracked file, which would dirty the tree
// on every build and refreeze the moment nobody re-ran it.
import { execFileSync } from "node:child_process";

/** The shape every check accepts: base semver + `dev`, or date.sha[.dirty]. */
export const BUILD_VERSION_RE =
  /^\d+\.\d+\.\d+\+(dev|\d{4}-\d{2}-\d{2}\.[0-9a-f]{7,40}(\.dirty)?)$/;

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 10_000,
  }).trim();
}

/**
 * `{ sha, dirty, date }` for the checkout at `cwd`. `sha` is null (and `dirty`
 * false) when git cannot answer: not installed, not a repository, no commits.
 * `date` is always the UTC build date, YYYY-MM-DD.
 */
export function gitStamp(cwd = process.cwd()) {
  const date = new Date().toISOString().slice(0, 10);
  try {
    const sha = git(["rev-parse", "--short=8", "HEAD"], cwd);
    if (!/^[0-9a-f]{7,40}$/.test(sha)) return { sha: null, dirty: false, date };
    let dirty = false;
    try {
      dirty = git(["status", "--porcelain"], cwd) !== "";
    } catch {
      // A sha we could read but a status we could not: report the sha and
      // assume dirty — a clean sha that lies is worse than no sha.
      dirty = true;
    }
    return { sha, dirty, date };
  } catch {
    return { sha: null, dirty: false, date };
  }
}

/**
 * `base` (`x.y.z`, the tracked version) plus the stamp as build metadata.
 * Throws only on a non-semver base — that is a programming error in the
 * caller, not a git condition, and must not be papered over with `dev`.
 */
export function buildVersion(base, stamp) {
  if (typeof base !== "string" || !/^\d+\.\d+\.\d+$/.test(base)) {
    throw new Error(`buildVersion: base must be x.y.z, got ${JSON.stringify(base)}`);
  }
  if (!stamp || !stamp.sha) return `${base}+dev`;
  return `${base}+${stamp.date}.${stamp.sha}${stamp.dirty ? ".dirty" : ""}`;
}

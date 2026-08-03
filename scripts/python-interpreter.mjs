// Locating a usable Python 3 on the machine running a build or a test.
//
// Two callers need this and disagree about what "no Python" means, so the
// resolver reports and lets each decide:
//   - scripts/package-plugin.mjs  -> warns and skips frontmatter validation
//   - packages/engine/mcp-server/tests/packaging/plugin-hooks.test.ts
//                                 -> fails loudly; the guard script IS the test
//
// Never hardcode the interpreter name. `python3` does not exist on stock
// Windows: the name resolves to a Microsoft Store "App Execution Alias" that
// prints an install advert and exits 49 instead of running Python. A hardcoded
// "python3" therefore fails on exactly the platform the genealogist team runs.
// `python` alone is no better -- on macOS/Linux it is frequently absent, or is
// Python 2.

import { execFileSync } from "node:child_process";

/**
 * Candidate invocations in preference order, each `[cmd, ...prefixArgs]`.
 * `py -3` is the official Windows launcher; `uv run python` covers checkouts
 * where the only Python is the one uv manages for the eval harness.
 */
export const PYTHON_CANDIDATES = [
  ["python3"],
  ["python"],
  ["py", "-3"],
  ["uv", "run", "python"],
];

/**
 * First candidate that actually launches, as `[cmd, ...prefixArgs]` -- append
 * your script path and its arguments. Returns `null` when none is installed.
 *
 * The `--version` probe is load-bearing, not a sanity check: running the
 * candidate is the only way to tell a real interpreter from the Store alias,
 * which is present on PATH and looks installed until you execute it.
 */
export function resolvePython() {
  for (const candidate of PYTHON_CANDIDATES) {
    const [cmd, ...pre] = candidate;
    try {
      execFileSync(cmd, [...pre, "--version"], { stdio: "ignore" });
    } catch {
      continue; // not installed, or the Store alias -- try the next
    }
    return candidate;
  }
  return null;
}

/** Human-readable candidate list, for error messages. */
export function describePythonCandidates() {
  return PYTHON_CANDIDATES.map((c) => c.join(" ")).join(", ");
}

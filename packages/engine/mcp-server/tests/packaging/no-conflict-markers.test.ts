import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

// A merge that left `<<<<<<<` in a file reaches main unless something greps for
// it. Nothing did outside `.ann.json`: check_runlogs.py guards annotations
// only, and a spec shipped three markers in its error table past a green PR —
// markdown is not compiled, so vitest and tsc never read it.
//
// The markers are built here rather than written out, so this file is scanned
// like every other and still passes. A guard that has to exempt its own tree is
// one of the three ways a check silently reads as coverage.
const OPEN = "<".repeat(7);
const CLOSE = ">".repeat(7);

// Anchored, and a label (or end of line) must follow. `check_runlogs.py` and
// its test both hold marker text inside string literals, mid-line, and must
// keep passing. A bare `=======` line is deliberately not matched: that is a
// markdown setext H1 underline, and the two bracketing markers already catch
// every conflict without it.
const MARKER = new RegExp(String.raw`^(?:${OPEN}|${CLOSE})(?: |$)`, "m");

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..", "..");

// `.claude` holds worktrees — full copies of this repo, whose own run of this
// test covers them.
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".claude", "build", "dist", "coverage",
  "releases", ".venv", "venv", "__pycache__", ".turbo", ".next", ".pytest_cache",
]);

const SCANNED = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".py",
  ".yml", ".yaml", ".sh", ".txt", ".html", ".css", ".toml",
]);

function collect(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (SCANNED.has(entry.slice(entry.lastIndexOf(".")))) out.push(full);
  }
  return out;
}

describe("no unresolved conflict markers", () => {
  it("no tracked text file carries a conflict marker at line start", () => {
    const offenders = collect(repoRoot)
      .filter((f) => MARKER.test(readFileSync(f, "utf8")))
      .map((f) => relative(repoRoot, f));
    expect(
      offenders,
      `unresolved git conflict marker(s) — finish the merge:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

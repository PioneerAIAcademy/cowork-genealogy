import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// PR #1238 deleted 134 .transcript.md files and removed the writer code.
// 11 re-landed on main via PRs whose branches were cut before that deletion
// (issue #1342). This test blocks them from returning.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..", "..");
const e2eRunlogs = join(repoRoot, "eval", "runlogs", "e2e");

function findTranscriptFiles(): string[] {
  // TRACKED files only. `nudge_report.py`'s docstring says the transcript
  // fallback is "retained for any local copies that may still exist on
  // developer machines" — and `.gitignore` makes such a copy untracked. A
  // working-tree scan forbade exactly the state that docstring blesses, so a
  // developer holding one could not run this suite green (#2204 review).
  // What must never come back is a COMMITTED transcript, which is what #1342
  // was: files that re-landed on main through stale-base merges.
  const out = execFileSync(
    "git",
    ["ls-files", "-z", "--", "eval/runlogs/e2e/**/*.transcript.md"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  return out.split("\0").filter(Boolean).sort();
}

describe(".transcript.md files must not exist (issue #1342)", () => {
  it("eval/runlogs/e2e/ directory exists", () => {
    expect(
      existsSync(e2eRunlogs),
      "eval/runlogs/e2e/ not found — test cannot scan",
    ).toBe(true);
  });

  it("no .transcript.md files under eval/runlogs/e2e/", () => {
    const files = findTranscriptFiles();
    expect(
      files,
      [
        "PR #1238 deleted all .transcript.md files and removed the writer.",
        "These re-landed via a stale-base merge. Click 'Update branch' on",
        "the PR page and drop these files.",
        "",
        "Found:",
        ...files.map((f) => `  ${f}`),
      ].join("\n"),
    ).toEqual([]);
  });
});

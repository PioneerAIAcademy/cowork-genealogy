import { describe, it, expect } from "vitest";
import { readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// PR #1238 deleted 134 .transcript.md files and removed the writer code.
// 11 re-landed on main via PRs whose branches were cut before that deletion
// (issue #1342). This test blocks them from returning.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..", "..");
const e2eRunlogs = join(repoRoot, "eval", "runlogs", "e2e");

function findTranscriptFiles(): string[] {
  if (!existsSync(e2eRunlogs)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(e2eRunlogs, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const slugDir = join(e2eRunlogs, entry.name);
    for (const file of readdirSync(slugDir)) {
      if (file.endsWith(".transcript.md")) {
        found.push(`eval/runlogs/e2e/${entry.name}/${file}`);
      }
    }
  }
  return found.sort();
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

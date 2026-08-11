import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// A UTF-8 BOM sits before the first character of a file, and is invisible in an
// editor and in a diff. Before a SKILL.md's opening `---` it stops the YAML
// frontmatter parsing, so the skill loads with no allowed-tools; the eval
// harness then denies every genealogy tool it didn't grant, and the run
// completes having made zero tool calls while reporting that its tools are
// gated (PR #1461). In a JSON fixture it breaks json.loads the same way.
// A Windows "UTF-8 with BOM" save is all it takes, and the whole genealogist
// team is on Windows.
//
// Compared as bytes, not as a "﻿" string literal, so this file cannot carry
// an invisible copy of the character it checks for.
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, "..", "..", "..", "..", "..");

// Tracked files only: `git ls-files` already excludes node_modules, build
// output, and other worktrees, so this needs no skip list of its own. A new
// file is checked from the moment it is `git add`ed.
const files = execFileSync("git", ["ls-files", "-z"], {
  cwd: projectRoot,
  maxBuffer: 64 * 1024 * 1024,
})
  .toString("utf8")
  .split("\0")
  .filter(Boolean);

describe("no UTF-8 BOM in tracked files", () => {
  // A walk that matches nothing would pass forever and read as coverage.
  it("finds the repo's files to check", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain("packages/engine/plugin/skills/search-records/SKILL.md");
  });

  it("finds no file starting with a BOM", () => {
    const offenders = files.filter((f) =>
      readFileSync(join(projectRoot, f)).subarray(0, 3).equals(BOM),
    );
    expect(offenders).toEqual([]);
  });
});

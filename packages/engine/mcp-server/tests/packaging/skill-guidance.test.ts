import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Drift lint for shared skill guidance. Claude Code can't reliably load a
// reference doc across skills (issue #17741), so the canonical places guidance
// is duplicated into each place-using skill's references/ folder. This test
// fails if any copy drifts from the canonical source — keeping the duplicates
// in sync the same way the manifest test keeps the tool list in sync.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const canonicalPath = join(repoRoot, "plugin", "references", "places-guidance.md");

// Skills that carry a copy of the canonical places guidance. Add a skill here
// (and copy the file) when it starts using place tools or writing places.
const SKILLS_WITH_PLACES_GUIDANCE = [
  "locality-guide",
  "research-plan",
  "historical-context",
  "search-external-sites",
  "timeline",
  "conflict-resolution",
  "record-extraction",
  "tree-edit",
  "init-project",
];

describe("places-guidance drift lint", () => {
  const canonical = readFileSync(canonicalPath, "utf8");

  it("canonical source exists and is non-empty", () => {
    expect(canonical.trim().length).toBeGreaterThan(0);
  });

  for (const skill of SKILLS_WITH_PLACES_GUIDANCE) {
    it(`${skill} carries an in-sync copy of places-guidance.md`, () => {
      const copyPath = join(
        repoRoot,
        "plugin",
        "skills",
        skill,
        "references",
        "places-guidance.md"
      );
      expect(existsSync(copyPath), `missing copy: ${copyPath}`).toBe(true);
      const copy = readFileSync(copyPath, "utf8");
      // Byte-identical: edit the canonical, then re-copy into every skill.
      expect(copy).toBe(canonical);
    });
  }
});

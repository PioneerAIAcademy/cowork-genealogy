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

// Skills that carry a byte-identical copy of the canonical places guidance. Add
// a skill here (and copy the file) when it starts using place tools or writing
// places.
const SKILLS_WITH_PLACES_GUIDANCE = [
  "locality-guide",
  "historical-context",
  "search-external-sites",
  "timeline",
  "conflict-resolution",
  "record-extraction",
  "tree-edit",
  "init-project",
];

// Skills whose copy is deliberately specialized, so byte-identical is the wrong
// contract for them. Each needs a reason — this list is not an escape hatch for
// "the lint is inconvenient," and a copy that merely drifted belongs above.
//
// The guidance names the tools to call. When a skill's own allowed-tools is a
// strict subset, the canonical text tells it to call tools it cannot call, and
// re-syncing would be actively wrong rather than merely noisy.
const SKILLS_WITH_SPECIALIZED_COPY: Array<{ skill: string; why: string }> = [
  {
    skill: "research-plan",
    // 8bf43be2 (2026-07-20) split place work by function: locality-guide owns
    // the place FACTS, research-plan owns record DISCOVERY. It dropped
    // wiki_search / wiki_place_page / place_population from research-plan's
    // allowed-tools (place_distance was never there), so its copy reframes
    // those four as "locality-guide's tools — you read their findings from the
    // localities entry, you do not call them here."
    why: "delegates place-fact fetching to locality-guide; canonical names four tools it cannot call",
  },
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

  // The specialized copies get the weaker check the byte-identical one can't
  // give them: the file is still there and still says something. Drift within a
  // specialized copy is not caught — see docs/TODOs.md.
  for (const { skill, why } of SKILLS_WITH_SPECIALIZED_COPY) {
    it(`${skill} carries a specialized copy of places-guidance.md (${why})`, () => {
      const copyPath = join(
        repoRoot,
        "plugin",
        "skills",
        skill,
        "references",
        "places-guidance.md"
      );
      expect(existsSync(copyPath), `missing copy: ${copyPath}`).toBe(true);
      expect(readFileSync(copyPath, "utf8").trim().length).toBeGreaterThan(0);
    });

    it(`${skill} is listed in exactly one of the two lists`, () => {
      expect(SKILLS_WITH_PLACES_GUIDANCE).not.toContain(skill);
    });
  }
});

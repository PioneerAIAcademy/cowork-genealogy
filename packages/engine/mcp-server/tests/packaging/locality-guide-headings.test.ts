/**
 * The locality-guide template still carries every heading `research_append`
 * requires of a saved guide (research-append-tool-spec §5.14).
 *
 * The three headings live in three places: the agent's output template
 * (`agents/locality-guide.md`, "Locality Guide Output Format"), the eval
 * validator that grades the saved guide (`_heading()` in
 * `eval/harness/validators/test_locality_guide.py`), and the engine's
 * `LOCALITY_GUIDE_HEADINGS`. A template rename the engine did not follow would
 * make `research_append` refuse every guide the agent writes, in every project,
 * with CI green; this is the check that goes red instead. A rename the validator
 * did not follow fails the locality-guide eval suite, which owes a re-run on any
 * template edit, so that pair needs nothing here.
 *
 * The check is the engine's own matcher run on the template block, so it holds
 * exactly when a guide written from the template passes the writer.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LOCALITY_GUIDE_HEADINGS, missingGuideHeadings } from "../../src/tools/research-append.js";

const here = dirname(fileURLToPath(import.meta.url));
const AGENT = join(here, "..", "..", "..", "plugin", "agents", "locality-guide.md");

/** The fenced markdown block under `## Locality Guide Output Format`, or null. */
function templateBlock(body: string): string | null {
  const lines = body.split("\n");
  const section = lines.findIndex((l) => l.trim() === "## Locality Guide Output Format");
  if (section < 0) return null;
  const open = lines.findIndex((l, i) => i > section && l.trim() === "```markdown");
  if (open < 0) return null;
  const close = lines.findIndex((l, i) => i > open && l.trim() === "```");
  if (close < 0) return null;
  return lines.slice(open + 1, close).join("\n");
}

describe("the locality-guide template carries the headings research_append requires", () => {
  const block = templateBlock(readFileSync(AGENT, "utf8"));

  it("finds the template block", () => {
    expect(
      block,
      "no ```markdown block under '## Locality Guide Output Format' in agents/locality-guide.md. " +
        "If the template moved, point templateBlock() at it.",
    ).not.toBeNull();
    expect(block!.trimStart().startsWith("# Locality Guide:")).toBe(true);
  });

  it("every engine heading appears in the template as a '## ' line", () => {
    expect(
      missingGuideHeadings(block ?? ""),
      "the locality-guide template no longer carries a heading research_append refuses a guide " +
        "without. Rename it in LOCALITY_GUIDE_HEADINGS (research-append.ts), the eval validator's " +
        "_heading() titles and research-append-tool-spec §5.14 together, or restore the heading.",
    ).toEqual([]);
  });

  it.each([...LOCALITY_GUIDE_HEADINGS])("a template without '## %s' fails the check", (title) => {
    // The check above must be able to fail: rename one heading in a copy of the block.
    const renamed = (block ?? "").replace(new RegExp(`^## ${title}$`, "m"), "## Where to look for copies");
    expect(renamed).not.toBe(block);
    expect(missingGuideHeadings(renamed)).toEqual([title]);
  });
});

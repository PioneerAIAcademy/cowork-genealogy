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
 * with CI green; this is the check that goes red instead. The validator's title
 * tuple is read too, so a rename there that the engine did not follow goes red
 * here rather than only in a paid eval run.
 *
 * The check is the engine's own matcher run on the template block, so it holds
 * exactly when a guide written from the template passes the writer.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LOCALITY_GUIDE_HEADINGS, missingGuideHeadings } from "../../src/tools/research-append.js";
import { LOCALITY_GUIDE_OUTLINE } from "../../src/utils/locality-guide-sections.js";

const here = dirname(fileURLToPath(import.meta.url));
const AGENT = join(here, "..", "..", "..", "plugin", "agents", "locality-guide.md");
const VALIDATOR = join(here, "..", "..", "..", "..", "..", "eval", "harness", "validators", "test_locality_guide.py");

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
    // Matched as loosely as the rule matches, so a suffix or a case change the rule
    // accepts in the template does not read as a missing heading here.
    const renamed = (block ?? "").replace(new RegExp(`^##[ \\t]+${title}.*$`, "im"), "## Where to look for copies");
    expect(renamed).not.toBe(block);
    expect(missingGuideHeadings(renamed)).toEqual([title]);
  });

  it("the eval validator grades the same three titles", () => {
    // The third copy: `_GUIDE_HEADINGS` in the validator is built from a literal tuple.
    // Its regex is pinned by the twin parity tables (research-append.test.ts and
    // eval/harness/tests/unit/test_locality_guide_validators.py).
    const validator = readFileSync(VALIDATOR, "utf8");
    const tuple = /_GUIDE_HEADINGS = \{[^}]*?for title in \(([^)]*)\)/s.exec(validator);
    expect(tuple, "could not find _GUIDE_HEADINGS's title tuple in the validator; update this parser").not.toBeNull();
    const titles = [...tuple![1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
    expect(titles.length, "no quoted titles in _GUIDE_HEADINGS's tuple; update this parser").toBeGreaterThan(0);
    expect(
      titles,
      "the eval validator's heading titles differ from LOCALITY_GUIDE_HEADINGS (research-append.ts). " +
        "Change both, the agent template and research-append-tool-spec §5.14 together.",
    ).toEqual([...LOCALITY_GUIDE_HEADINGS]);
  });
});

/**
 * `research_append` places a guide section sent alone by the template's order
 * (`LOCALITY_GUIDE_OUTLINE`, research-append-tool-spec §5.14). A template heading
 * the outline does not carry is saved after the ones it does, so a guide would come
 * out in an order the template never had, with CI green.
 */
describe("the engine's guide outline is the template's headings, in order", () => {
  const block = templateBlock(readFileSync(AGENT, "utf8")) ?? "";
  /** `[["Jurisdiction overview", []], ["Available record types", ["Vital records (civil registration)", ...]], ...]` */
  const outlineOf = (markdown: string): [string, string[]][] => {
    const out: [string, string[]][] = [];
    for (const line of markdown.split("\n")) {
      const m = /^(#{2,3})[ \t]+(\S.*?)[ \t]*$/.exec(line);
      if (!m) continue;
      if (m[1].length === 2) out.push([m[2], []]);
      else out[out.length - 1]?.[1].push(m[2]);
    }
    return out;
  };
  /** A template heading matches an outline title when it begins with it, as a sent heading does. */
  const mismatches = (template: [string, string[]][]): string[] => {
    const begins = (heading: string | undefined, title: string) =>
      heading !== undefined && heading.toLowerCase().startsWith(title.toLowerCase());
    const out: string[] = [];
    const n = Math.max(template.length, LOCALITY_GUIDE_OUTLINE.length);
    for (let i = 0; i < n; i++) {
      const [heading, subs] = template[i] ?? [undefined, [] as string[]];
      const [title, subTitles] = LOCALITY_GUIDE_OUTLINE[i] ?? [undefined, [] as readonly string[]];
      if (title === undefined || !begins(heading, title)) {
        out.push(`section ${i + 1}: template '## ${heading ?? "(none)"}', outline '${title ?? "(none)"}'`);
        continue;
      }
      const m = Math.max(subs.length, subTitles.length);
      for (let j = 0; j < m; j++) {
        if (subTitles[j] === undefined || !begins(subs[j], subTitles[j])) {
          out.push(`${title}, subsection ${j + 1}: template '### ${subs[j] ?? "(none)"}', outline '${subTitles[j] ?? "(none)"}'`);
        }
      }
    }
    return out;
  };

  it("every template heading is in the outline, at the same place", () => {
    expect(outlineOf(block).length).toBeGreaterThan(0);
    expect(
      mismatches(outlineOf(block)),
      "the locality-guide template's '## ' and '### ' headings differ from LOCALITY_GUIDE_OUTLINE " +
        "(src/utils/locality-guide-sections.ts). Change both together.",
    ).toEqual([]);
  });

  it.each([
    ["a renamed section", (b: string) => b.replace("## Boundary changes", "## Border changes")],
    ["a renamed subsection", (b: string) => b.replace("### Tax records", "### Taxation")],
    ["a subsection added", (b: string) => b.replace("### Tax records", "### School records\n### Tax records")],
    ["a section removed", (b: string) => b.replace("## Records NOT online", "Records NOT online")],
    ["two sections swapped", (b: string) =>
      b.replace("## Known record losses", "## TEMP").replace("## Research tips", "## Known record losses").replace("## TEMP", "## Research tips")],
  ])("a template with %s fails the check", (_label, change) => {
    const changed = change(block);
    expect(changed).not.toBe(block);
    expect(mismatches(outlineOf(changed))).not.toEqual([]);
  });

  it("a template heading with a suffix or another case still matches", () => {
    const changed = block.replace("## Research tips", "## RESEARCH TIPS (for this county)");
    expect(changed).not.toBe(block);
    expect(mismatches(outlineOf(changed))).toEqual([]);
  });
});

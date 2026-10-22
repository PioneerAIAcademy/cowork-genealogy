import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ATTACHMENT_LINK_RATIONALE } from "../../src/utils/tree-person.js";

/**
 * Cross-language drift lint for the attachment-link rationale (issue #3516).
 *
 * `extraction_append({ personId })` stamps `ATTACHMENT_LINK_RATIONALE` on every
 * link it makes from a FamilySearch attachment, and the eval harness recognises
 * those links by the same text: `is_attachment_link` in
 * `eval/harness/harness/skill_invocation.py`, which the unit-plane ownership arm
 * and `find_effects_without_invocation` both use. The harness cannot import the
 * engine (CLAUDE.md, "Don't try to share code at runtime"), so the text exists
 * twice. A reworded constant on either side would make the harness stop seeing
 * attachment links, silently: the ownership arm would refuse every one and the
 * effects check would count them as identity work. This pins the two together.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..", "..");
const SKILL_INVOCATION = join(repoRoot, "eval", "harness", "harness", "skill_invocation.py");

/** The Python literal, read off its assignment line. */
export function pythonRationale(source: string): string | null {
  const m = /^ATTACHMENT_LINK_RATIONALE\s*=\s*"([^"\n]*)"\s*$/m.exec(source);
  return m ? m[1] : null;
}

describe("ATTACHMENT_LINK_RATIONALE drift", () => {
  it("skill_invocation.py carries the engine's rationale verbatim", () => {
    const literal = pythonRationale(readFileSync(SKILL_INVOCATION, "utf-8"));
    expect(literal, "no ATTACHMENT_LINK_RATIONALE assignment found in skill_invocation.py").not.toBeNull();
    expect(literal).toBe(ATTACHMENT_LINK_RATIONALE);
  });

  it("fails on a reworded copy, and on a missing one", () => {
    const reworded = `ATTACHMENT_LINK_RATIONALE = "Linked because FamilySearch attached this record; not verified."\n`;
    expect(pythonRationale(reworded)).not.toBe(ATTACHMENT_LINK_RATIONALE);
    expect(pythonRationale("# ATTACHMENT_LINK_RATIONALE moved elsewhere\n")).toBeNull();
    // The legitimate shape still parses, extra spacing included.
    expect(pythonRationale(`ATTACHMENT_LINK_RATIONALE  =  "${ATTACHMENT_LINK_RATIONALE}"\n`)).toBe(ATTACHMENT_LINK_RATIONALE);
  });
});

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
const PERSON_EVIDENCE = join(repoRoot, "packages", "engine", "plugin", "agents", "person-evidence.md");
const SCENARIOS = join(repoRoot, "eval", "fixtures", "scenarios");
// The scenarios that hold attachment links written by `extraction_append`
// (issue #3516 PR D): their rows must carry the engine's text, or the tests
// built on them grade links the engine would not recognise.
const ATTACHMENT_SCENARIOS = ["becker-attachment-links", "becker-attachment-links-question", "becker-timeline-no-questions"];

/** The Python literal, read off its assignment line. */
export function pythonRationale(source: string): string | null {
  const m = /^ATTACHMENT_LINK_RATIONALE\s*=\s*"([^"\n]*)"\s*$/m.exec(source);
  return m ? m[1] : null;
}

const collapse = (s: string) => s.replace(/\s+/g, " ");

/** person-evidence.md quotes the rationale so the agent can tell an attachment
 *  link apart; a wrapped line is the same quote. */
export function quotesRationale(body: string, rationale: string): boolean {
  return collapse(body).includes(collapse(rationale));
}

/** Every unscored speculative `person_evidence` row's rationale: the shape an
 *  attachment link takes. */
export function speculativeUnscoredRationales(research: any): string[] {
  return ((research?.person_evidence ?? []) as any[])
    .filter((pe) => pe?.confidence === "speculative" && pe?.match_score == null)
    .map((pe) => String(pe?.rationale));
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

  it("person-evidence.md quotes the engine's rationale", () => {
    expect(quotesRationale(readFileSync(PERSON_EVIDENCE, "utf-8"), ATTACHMENT_LINK_RATIONALE)).toBe(true);
  });

  it("the quote check fails on a reworded quote and passes a reflowed one", () => {
    const words = ATTACHMENT_LINK_RATIONALE.split(" ");
    const reflowed = `the rationale "${words.slice(0, 7).join(" ")}\n${words.slice(7).join(" ")}" is`;
    expect(quotesRationale(reflowed, ATTACHMENT_LINK_RATIONALE)).toBe(true);
    const reworded = ATTACHMENT_LINK_RATIONALE.replace("not verified", "unverified");
    expect(quotesRationale(`the rationale "${reworded}" is`, ATTACHMENT_LINK_RATIONALE)).toBe(false);
  });

  it.each(ATTACHMENT_SCENARIOS)("every attachment-shaped row in %s carries the engine's rationale", (scenario) => {
    const research = JSON.parse(readFileSync(join(SCENARIOS, scenario, "research.json"), "utf-8"));
    const rationales = speculativeUnscoredRationales(research);
    expect(rationales.length, `${scenario} holds no attachment-shaped person_evidence row`).toBeGreaterThan(0);
    expect(rationales.filter((r) => r !== ATTACHMENT_LINK_RATIONALE)).toEqual([]);
  });

  it("the row check fails on a row reworded at its first word, and on no rows", () => {
    const row = { confidence: "speculative", match_score: null, rationale: ATTACHMENT_LINK_RATIONALE };
    const reworded = { ...row, rationale: ATTACHMENT_LINK_RATIONALE.replace(/^Linked/, "Attached") };
    const rationales = speculativeUnscoredRationales({ person_evidence: [row, reworded] });
    expect(rationales.filter((r) => r !== ATTACHMENT_LINK_RATIONALE)).toHaveLength(1);
    expect(speculativeUnscoredRationales({ person_evidence: [] })).toHaveLength(0);
    // A scored or non-speculative row is not attachment-shaped and is not read.
    expect(speculativeUnscoredRationales({ person_evidence: [{ ...row, match_score: 0.9 }, { ...row, confidence: "probable" }] })).toHaveLength(0);
  });
});

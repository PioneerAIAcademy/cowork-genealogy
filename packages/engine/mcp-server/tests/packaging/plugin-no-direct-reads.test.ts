/**
 * No plugin agent or skill body may instruct a direct read of a project file.
 *
 * Cowork's VM cannot see the connected folder, and a project served by a remote
 * MCP server has no folder at all, so a `Read` of `research.json`,
 * `tree.gedcomx.json` or a staged `results/` file returns a stale copy or
 * nothing. Every project read goes through `project_context`, `research_query`,
 * `tree_query`, `sidecar_read` or `image_transcribe`. A prohibition ("Do not
 * read research.json") is fine; an instruction is not.
 *
 * Three things are flagged (frontmatter is out of scope):
 *   - a read verb followed, in the same sentence, by `research.json`,
 *     `tree.gedcomx.json`, `resultsRef` or `results/`, unless a prohibition word
 *     precedes the verb or a backticked reading tool names the read first.
 *     Sentences are read across soft-wrapped lines (a paragraph or one list
 *     item), so a sentence wrapped mid-way is still one sentence (#4311);
 *   - the snake_case `narration_guidance` (the tool's field is
 *     `narrationGuidance`) on a line that does not name `project_context`;
 *   - "working directory" (projectPath is only what the caller gave).
 *
 * The anti-vacuity arm asserts the scan reaches both trees and that the
 * detector fires on planted lines, so a renamed directory or a regex that
 * matches nothing cannot leave this green.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(here, "..", "..", "..", "plugin");
const skillsRoot = join(pluginRoot, "skills");
const agentsRoot = join(pluginRoot, "agents");

const READ_VERB =
  /\b(?:read|reads|reading|re-read|re-reads|open|opens|grep|glob|scan|scans|cat|load|loads|loading|parse|parses|parsing|look|looks|looking|check|checks|checking|inspect|inspects|inspecting|consult|consults|view|views)\b(?!-only)/gi;
const PROJECT_FILE = /(?:research|tree)\.(?:gedcomx\.)?json|resultsRef|results\//;
/** A sentence that routes the read through a reading tool is the tool-based wording. */
const READING_TOOL = /`(?:sidecar_read|image_transcribe)\b/;
/** A line that starts its own block: blank, list item, table row, heading, quote or fence. */
/** "the scan", "a reading": an article makes the verb a noun. */
const ARTICLE_BEFORE = /\b(?:the|a|an|each|this|that)\s+$/i;
/** "…reads `tree.gedcomx.json` via `person_warnings`": the read is the tool's. */
const VIA_TOOL = /^`?\s+(?:via|through)\s+`/;
const BLOCK_START = /^\s*(?:$|[-*+]\s|\d+\.\s|\||#|>|```)/;
const NOUN_AMBIGUOUS = /^(?:check|checks|view|views|look|looks)$/i;
/** A prohibition counts only when it governs the verb: at most two words sit between them. */
const PROHIBITION =
  /\b(?:never|do not|does not|don't|must not|should not|cannot|can't|without|instead of|rather than|no need to|replaces)[\s`"'*(]+(?:[\w-]+[\s`"'*(]+){0,2}$/i;
/** A tool or server describing its own read is not an instruction to the agent. */
const TOOL_SUBJECT = /\b(?:tool|itself|server|hook)\b/i;

/** The body: everything after the closing `---` of the frontmatter. */
export function bodyOf(text: string): string {
  const norm = text.replace(/\r\n/g, "\n");
  const m = /^---\n[\s\S]*?\n---\n/.exec(norm);
  return m ? norm.slice(m[0].length) : norm;
}

/** Each offending line of a body, with its 1-based body line number. */
export function directReadViolations(body: string): { line: number; text: string }[] {
  const lines = body.split("\n");
  const bad = new Set<number>();
  // Join each block's soft-wrapped lines, remembering where each line starts.
  let block = "";
  let starts: { at: number; line: number }[] = [];
  const flush = () => {
    let offset = 0;
    for (const sentence of block.split(/(?<=[.!?:;])\s+/)) {
      const at = block.indexOf(sentence, offset);
      offset = at + sentence.length;
      const verb = directReadVerbAt(sentence);
      if (verb >= 0) bad.add([...starts].reverse().find((s) => s.at <= at + verb)!.line);
    }
    block = "";
    starts = [];
  };
  lines.forEach((text, i) => {
    if (BLOCK_START.test(text) && block) flush();
    if (text.trim() === "") return;
    starts.push({ at: block ? block.length + 1 : 0, line: i });
    block = block ? `${block} ${text.trim()}` : text.trim();
    if (/narration_guidance/.test(text) && !/project_context/.test(text)) bad.add(i);
    if (/working directory/i.test(text)) bad.add(i);
  });
  if (block) flush();
  return [...bad].sort((a, b) => a - b).map((i) => ({ line: i + 1, text: lines[i].trim().slice(0, 160) }));
}

/** Where the offending read verb sits in a sentence, or -1. */
function directReadVerbAt(sentence: string): number {
  for (const m of sentence.matchAll(READ_VERB)) {
    const after = sentence.slice(m.index! + m[0].length);
    const before = sentence.slice(0, m.index);
    // The verb's object ends at the clause: "when you read pages, and never pass `x.resultsRef`".
    const clause = after.slice(0, 120).split(/,\s/)[0];
    const file = PROJECT_FILE.exec(clause);
    if (!file) continue;
    if (ARTICLE_BEFORE.test(before)) continue;
    if (VIA_TOOL.test(clause.slice(file.index + file[0].length))) continue;
    // "…a well-formedness check ("is research.json valid?")": the noun, with the file inside a quoted example.
    if (NOUN_AMBIGUOUS.test(m[0]) && /^[*\s]*\(\s*["“]/.test(after)) continue;
    if (PROHIBITION.test(before) || TOOL_SUBJECT.test(before)) continue;
    if (READING_TOOL.test(sentence.slice(0, m.index! + m[0].length + file.index))) continue;
    return m.index!;
  }
  return -1;
}

function bodies(): { name: string; body: string }[] {
  const agents = readdirSync(agentsRoot)
    .filter((n) => n.endsWith(".md"))
    .sort()
    .map((n) => ({ name: `agents/${n}`, body: bodyOf(readFileSync(join(agentsRoot, n), "utf8")) }));
  const skills = readdirSync(skillsRoot)
    .sort()
    .map((n) => ({ n, abs: join(skillsRoot, n, "SKILL.md") }))
    .filter(({ abs }) => existsSync(abs))
    .map(({ n, abs }) => ({ name: `skills/${n}/SKILL.md`, body: bodyOf(readFileSync(abs, "utf8")) }));
  return [...agents, ...skills];
}

describe("plugin bodies never instruct a direct read of a project file", () => {
  const all = bodies();

  it("scans both agents and skills", () => {
    expect(all.filter((b) => b.name.startsWith("agents/")).length).toBeGreaterThan(20);
    expect(all.filter((b) => b.name.startsWith("skills/")).length).toBeGreaterThan(0);
  });

  it("finds no direct-read instruction in any shipped body", () => {
    const found = all.flatMap(({ name, body }) =>
      directReadViolations(body).map((v) => `${name}:${v.line}: ${v.text}`),
    );
    expect(
      found,
      "A body tells the agent to read a project file directly. Serve the read through " +
        "project_context, research_query or tree_query (see docs/specs/tree-query-tool-spec.md).",
    ).toEqual([]);
  });

  describe("the detector", () => {
    const flagged = (line: string) => directReadViolations(line).length > 0;

    it("fires on planted direct reads", () => {
      expect(flagged("Read `research.json` and find the plan.")).toBe(true);
      expect(flagged("Then open tree.gedcomx.json to get the birth date.")).toBe(true);
      expect(flagged("Use Grep to scan research.json for the source.")).toBe(true);
      expect(flagged("**Narration:** Read `researcher_profile.narration_guidance` and apply it.")).toBe(true);
      expect(flagged("Step 1 reads research.json to find the plan.")).toBe(true);
      expect(flagged("Load research.json and find the plan.")).toBe(true);
      expect(flagged("Parse tree.gedcomx.json for the birth date.")).toBe(true);
      expect(flagged("Check research.json for an open question.")).toBe(true);
      expect(flagged("If you do not have the plan, read research.json for it.")).toBe(true);
      expect(flagged("We are not sure, so open tree.gedcomx.json.")).toBe(true);
      expect(flagged("Check (briefly) research.json for the plan.")).toBe(true);
      expect(flagged("Check the \"plans\" section of research.json.")).toBe(true);
      expect(flagged("Default projectPath to the current working directory.")).toBe(true);
      expect(flagged("Open results/log_007.json for the transcript.")).toBe(true);
      expect(flagged("Read the hit out of `staged.resultsRef`.")).toBe(true);
      expect(flagged("Read results/log_007.json, then call `sidecar_read`.")).toBe(true);
    });

    it("reads a sentence across soft-wrapped lines (#4311)", () => {
      const wrapped =
        "  the terms are bare. Verify against the original image (see the verification\n" +
        "  note above), or `Read` the single result you are chasing out of\n" +
        "  `staged.resultsRef`.";
      expect(directReadViolations(wrapped).map((v) => v.line)).toEqual([2]);
      expect(flagged("Then open\ntree.gedcomx.json to get the birth date.")).toBe(true);
      // A list item, a table row or a blank line starts a new block, so no sentence spans them.
      expect(flagged("- Read the first item.\n- `staged.resultsRef` is the handle.")).toBe(false);
      expect(flagged("Read the image.\n\n`staged.resultsRef` is the handle.")).toBe(false);
    });

    it("accepts the tool-based and prohibition wordings", () => {
      expect(flagged("Call `research_query({ projectPath, section: \"plans\" })`.")).toBe(false);
      expect(flagged("Call `tree_query({ projectPath, personIds })` for the birth date.")).toBe(false);
      expect(flagged("Do not read research.json; query it.")).toBe(false);
      expect(flagged("Never open tree.gedcomx.json directly.")).toBe(false);
      expect(flagged("Writes go through research_append, which persists to research.json.")).toBe(false);
      expect(flagged("Apply `narrationGuidance` from `project_context({ projectPath })`.")).toBe(false);
      expect(flagged("Read the image file the user gave.")).toBe(false);
      expect(flagged("The tool reads `tree.gedcomx.json` itself and returns warnings.")).toBe(false);
      expect(flagged("This path is read-only. tree.gedcomx.json is not uploaded.")).toBe(false);
      expect(flagged("Replaces reading `research.json`.")).toBe(false);
      expect(flagged("Never `Read` research.json directly.")).toBe(false);
      expect(flagged("You must not load tree.gedcomx.json yourself.")).toBe(false);
      expect(flagged("Work without reading research.json.")).toBe(false);
      expect(flagged("A well-formedness check (\"is research.json valid?\") is validate-schema's.")).toBe(false);
      expect(
        flagged(
          "  note above), or read the one hit you are chasing with\n" +
            "  `sidecar_read({ projectPath, ref: \"<staged.resultsRef>#<hit id>\" })`; a ref",
        ),
      ).toBe(false);
      expect(flagged("| `sidecar_read` | `projectPath`, `ref` | Read a staged page's text by its `staged.resultsRef` |")).toBe(false);
      expect(flagged("It reads\n`tree.gedcomx.json` via `person_warnings` and `census_children_gap`.")).toBe(false);
      expect(flagged("It OCRs the scan host-side,\nstages the page, and returns `staged.resultsRef`.")).toBe(false);
      expect(flagged("A reading the user gives goes to the agent with that `staged.resultsRef`.")).toBe(false);
      expect(flagged("`tool: \"image_search\"` even when you read pages, and never pass a page's\n`staged.resultsRef` as `stagedResultsRef`:")).toBe(false);
    });

    it("only reads a sentence at a time", () => {
      expect(flagged("Read the single hit. The research.json log is written by the tool.")).toBe(false);
    });
  });
});

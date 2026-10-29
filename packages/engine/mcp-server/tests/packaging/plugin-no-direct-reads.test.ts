/**
 * No plugin agent or skill body may instruct a direct read of a project file.
 *
 * Cowork's VM cannot see the connected folder, and a project served by a remote
 * MCP server has no folder at all, so a `Read` of `research.json` or
 * `tree.gedcomx.json` returns a stale copy or nothing. Every project read goes
 * through `project_context`, `research_query` or `tree_query`. A prohibition
 * ("Do not read research.json") is fine; an instruction is not.
 *
 * Three things are flagged, per body line (frontmatter is out of scope):
 *   - a read verb followed, in the same sentence, by `research.json` or
 *     `tree.gedcomx.json`, unless a prohibition word precedes the verb;
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

const READ_VERB = /\b(?:read|reads|reading|re-read|re-reads|open|opens|grep|glob|scan|scans|cat)\b(?!-only)/gi;
const PROJECT_FILE = /(?:research|tree)\.(?:gedcomx\.)?json/;
const PROHIBITION = /\b(?:never|not|don't|without|instead of|rather than|no need to|replaces)\b/i;
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
  const out: { line: number; text: string }[] = [];
  body.split("\n").forEach((text, i) => {
    let bad = false;
    for (const sentence of text.split(/(?<=[.!?:;])\s+/)) {
      for (const m of sentence.matchAll(READ_VERB)) {
        const after = sentence.slice(m.index! + m[0].length);
        const before = sentence.slice(0, m.index);
        if (!PROJECT_FILE.test(after.slice(0, 120))) continue;
        if (PROHIBITION.test(before) || TOOL_SUBJECT.test(before)) continue;
        bad = true;
      }
    }
    if (/narration_guidance/.test(text) && !/project_context/.test(text)) bad = true;
    if (/working directory/i.test(text)) bad = true;
    if (bad) out.push({ line: i + 1, text: text.trim().slice(0, 160) });
  });
  return out;
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
      expect(flagged("Default projectPath to the current working directory.")).toBe(true);
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
    });

    it("only reads a sentence at a time", () => {
      expect(flagged("Read the single hit. The research.json log is written by the tool.")).toBe(false);
    });
  });
});

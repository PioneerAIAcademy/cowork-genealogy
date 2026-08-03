import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ADR staleness lint.
 *
 * ADRs are read *at the moment of work* by developers (and by Claude) who
 * treat them as authoritative. Classic ADR practice freezes the whole file,
 * which is right for an archive and wrong for us: a stale path is not a
 * curiosity, it is a wrong answer someone will act on.
 *
 * So `docs/adrs/README.md` splits each ADR in two — Context / Decision /
 * Alternatives / Consequences are frozen history, while **Applies to** and
 * **Enforcement** are live pointers into a moving codebase. This test is what
 * makes the live half true: every repo path cited in those two places must
 * resolve. Move the code and CI fails until the ADR is updated or superseded.
 *
 * Without this the set is trustworthy for about two months.
 *
 * Scope note: a path is any backticked token containing "/" that starts with a
 * known top-level directory. That deliberately excludes bare filenames
 * (`research.json`), tool names (`mcp__genealogy__record_read`), and prose, so
 * the lint has no false positives to train people to ignore.
 */

const here = dirname(fileURLToPath(import.meta.url));
const engineRoot = join(here, "..", "..", ".."); // packages/engine/
const projectRoot = join(engineRoot, "..", ".."); // repo root
const adrDir = join(projectRoot, "docs", "adrs");

/** Top-level dirs a cited path may start with. */
const REPO_ROOTS = [
  "docs/",
  "packages/",
  "apps/",
  "eval/",
  "scripts/",
  ".github/",
  ".claude/",
];

/** Sections whose paths must resolve. The rest of an ADR is frozen history. */
const LIVE_SECTIONS = ["Applies to", "Enforcement"];

const ADR_FILE = /^ADR-(\d{4})-[a-z0-9-]+\.md$/;

function adrFiles(): string[] {
  if (!existsSync(adrDir)) return [];
  return readdirSync(adrDir)
    .filter((f) => f.endsWith(".md") && f !== "README.md" && f !== "_template.md")
    .sort();
}

/**
 * Pull the text of the live sections: the `**Applies to:**` header line, and
 * the `## Enforcement` section up to the next `## `.
 */
function liveSectionText(body: string): string {
  const parts: string[] = [];

  const appliesTo = body.match(/^\s*-\s*\*\*Applies to:\*\*(.*)$/m);
  if (appliesTo) parts.push(appliesTo[1]);

  const enforcement = body.match(/^## Enforcement\s*$([\s\S]*?)(?=^## |\Z)/m);
  if (enforcement) parts.push(enforcement[1]);

  return parts.join("\n");
}

/**
 * Backticked tokens that look like repo paths.
 *
 * The scope note above is the contract: no false positives, or the lint gets
 * ignored. So four shapes are not paths and never resolve —
 *   - `docs/specs/<tool>-tool-spec.md`  a template the reader substitutes into
 *   - `eval/fixtures/mcp/record-search-*.json`  a glob
 *   - `scripts/setup-feedback-case.sh <zip>`  a command line
 *   - `eval/tests/unit/$ARGUMENTS/rubric.md`  a slash-command substitution
 * — and are skipped rather than allowlisted, because each is correct prose that
 * would otherwise have to be rewritten to satisfy a linter.
 */
function citedPaths(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const token = m[1].trim();
    if (!token.includes("/")) continue;
    if (!REPO_ROOTS.some((r) => token.startsWith(r))) continue;
    if (/[<>*\s$]/.test(token)) continue;
    // Strip a trailing line/anchor reference: path.ts:123 or path.md#section
    found.add(token.replace(/[:#].*$/, ""));
  }
  return [...found];
}

describe("ADR hygiene", () => {
  const files = adrFiles();

  it("has a template and a README explaining the convention", () => {
    expect(existsSync(join(adrDir, "_template.md"))).toBe(true);
    expect(existsSync(join(adrDir, "README.md"))).toBe(true);
  });

  it("names every ADR ADR-NNNN-slug.md with a unique, zero-padded number", () => {
    const seen = new Map<string, string>();
    for (const f of files) {
      expect(f, `${f} must match ADR-NNNN-slug.md`).toMatch(ADR_FILE);
      const num = f.match(ADR_FILE)![1];
      expect(
        seen.has(num),
        `ADR number ${num} is used by both ${seen.get(num)} and ${f} — numbers are never reused`,
      ).toBe(false);
      seen.set(num, f);
    }
  });

  it.each(files)("%s carries every required field", (file) => {
    const body = readFileSync(join(adrDir, file), "utf8");

    for (const field of [
      "Read before you:",
      "**Status:**",
      "**Decided:**",
      "**Recorded:**",
      "**Applies to:**",
    ]) {
      expect(body, `${file} is missing "${field}"`).toContain(field);
    }

    for (const heading of [
      "## Context",
      "## Decision",
      "## Alternatives considered",
      "## Consequences",
      "## Enforcement",
      "## Revisit when",
    ]) {
      expect(body, `${file} is missing "${heading}"`).toContain(heading);
    }

    // An ADR is a decision with a rejected alternative. Require at least one
    // real table row rather than an empty section.
    const alts = body.match(/^## Alternatives considered\s*$([\s\S]*?)(?=^## )/m);
    const rows = (alts?.[1] ?? "")
      .split("\n")
      .filter((l) => l.trim().startsWith("|") && !/^\|[\s|:-]+\|$/.test(l.trim()));
    expect(
      rows.length,
      `${file} lists no rejected alternative. If nothing was rejected it is not a decision — put it in docs/architecture.md instead.`,
    ).toBeGreaterThanOrEqual(2); // header row + at least one option

    // Costs are not optional; an ADR with no cost was not a tradeoff.
    expect(
      body,
      `${file} must state "Costs, knowingly accepted" — if nothing was given up, reconsider whether this is an ADR`,
    ).toContain("Costs, knowingly accepted");
  });

  it.each(files)("%s cites only paths that still exist", (file) => {
    const body = readFileSync(join(adrDir, file), "utf8");
    const missing = citedPaths(liveSectionText(body)).filter(
      (p) => !existsSync(join(projectRoot, p)),
    );

    expect(
      missing,
      `${file} cites paths that no longer exist: ${missing.join(", ")}\n` +
        `Fix the "Applies to" / "Enforcement" pointers in the same PR that moved the code, ` +
        `or supersede the ADR. Do not edit its Context/Decision/Alternatives — those are frozen history.`,
    ).toEqual([]);
  });

  it("is indexed in docs/architecture.md", () => {
    const guide = join(projectRoot, "docs", "architecture.md");
    if (!existsSync(guide)) return; // guide lands on its own branch
    const text = readFileSync(guide, "utf8");
    const index = text.match(
      /<!-- ADR-INDEX-START -->([\s\S]*?)<!-- ADR-INDEX-END -->/,
    );
    expect(index, "docs/architecture.md has lost its ADR-INDEX markers").not.toBeNull();

    const missing = files.filter((f) => !index![1].includes(f));
    expect(
      missing,
      `these ADRs are not in the docs/architecture.md index, so nobody will find them: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});

/**
 * The same staleness lint, scoped to the project's Claude Code skills, subagents
 * and slash commands — the ones under `.claude/`, not the shipped plugin.
 *
 * These have the ADR problem in a harsher form. An ADR is read by a human who
 * can notice a path is wrong; a skill body is read by a model that will act on
 * it. The `triage-standup` skill instructed the model to read the repo's
 * staging-queue file for a day after that file was retired (#1163), and nothing
 * could catch it — the skill lived outside the repo.
 *
 * Unlike an ADR there is no frozen-history half to exempt: everything in a
 * skill body is an instruction. So every cited path must resolve, and history
 * that no longer has a file ("the retired to-do queue") is written without a
 * path. That is also why these bodies should carry no rationale prose — they
 * are billed prompt tokens on every invocation.
 */
describe(".claude skill, agent and command path hygiene", () => {
  const claudeDir = join(projectRoot, ".claude");

  /** Every .md under the linted .claude/ subtrees, recursively. */
  function claudeMarkdown(dir: string): string[] {
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...claudeMarkdown(full));
      else if (entry.endsWith(".md")) out.push(full);
    }
    return out;
  }

  const files = [
    ...claudeMarkdown(join(claudeDir, "skills")),
    ...claudeMarkdown(join(claudeDir, "agents")),
    ...claudeMarkdown(join(claudeDir, "commands")),
  ].sort();

  /**
   * Invented identifiers inside a worked example. These are indistinguishable
   * from a real path by shape, so each needs a line here with a reason.
   *
   * Empty, and worth keeping that way: the fix for a worked example is a
   * `<slug>` placeholder, which the skip rules above handle without an entry
   * and which also stops the example naming a fixture that does not exist.
   */
  const EXAMPLE_PATHS = new Set<string>([]);

  it("finds the skills, agents and commands to lint", () => {
    expect(files.length, ".claude/{skills,agents,commands} are all empty").toBeGreaterThan(0);
  });

  it.each(files.map((f) => relative(projectRoot, f)))(
    "%s cites only paths that still exist",
    (rel) => {
      const body = readFileSync(join(projectRoot, rel), "utf8");
      const missing = citedPaths(body)
        .filter((p) => !EXAMPLE_PATHS.has(p))
        .filter((p) => !existsSync(join(projectRoot, p)));

      expect(
        missing,
        `${rel} cites paths that no longer exist: ${missing.join(", ")}\n` +
          `A skill body is an instruction a model will act on, so a stale path is a wrong ` +
          `answer, not a curiosity. Fix the pointer in the same PR that moved the code. ` +
          `If the path is history rather than a pointer, write it without a path — or drop ` +
          `it, since rationale prose in a skill body is billed on every invocation.`,
      ).toEqual([]);
    },
  );
});

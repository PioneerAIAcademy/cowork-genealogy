import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { citedPaths, pathResolves } from "./repo-paths.js";

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
 * the lint has no false positives to train people to ignore. The extraction
 * rule lives in `./repo-paths.ts` and is shared with `doc-links.test.ts`,
 * which applies it to `docs/task-lifecycle.md` and the `.claude/` tooling.
 */

const here = dirname(fileURLToPath(import.meta.url));
const engineRoot = join(here, "..", "..", ".."); // packages/engine/
const projectRoot = join(engineRoot, "..", ".."); // repo root
const adrDir = join(projectRoot, "docs", "adrs");

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
      (p) => !pathResolves(projectRoot, p),
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

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Length lint for skill and plugin-agent descriptions. The description drives
// triggering (skills) and orchestrator auto-delegation (agents), and the
// runtime caps it at 1024 characters — over the cap the entry fails to load,
// silently. Most descriptions here sit within a few dozen characters of the
// cap, so a one-word edit can push one over; this test catches that in CI
// instead of at install time.

const MAX_DESCRIPTION_LENGTH = 1024;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const skillsDir = join(repoRoot, "plugin", "skills");
const agentsDir = join(repoRoot, "plugin", "agents");

/**
 * Pull the `description` value out of YAML frontmatter and return it as the
 * runtime's YAML parser would — the string whose length is capped.
 *
 * Deliberately minimal rather than a YAML dependency: it covers the two forms
 * these files use — a plain scalar continued across indented lines, and a
 * `>-` folded block. Both fold to a space-joined single line, so the two
 * cases differ only in how the first line is read.
 */
function extractDescription(text: string): string {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!frontmatter) throw new Error("no YAML frontmatter");

  const lines = frontmatter[1].split(/\r?\n/);
  const start = lines.findIndex((l) => /^description:/.test(l));
  if (start === -1) throw new Error("no description key");

  const first = lines[start].slice("description:".length).trim();

  // Continuation lines run until the next top-level key (column 0).
  const continuation: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break;
    continuation.push(lines[i].trim());
  }

  // Block scalar: `>`/`|` with optional chomping indicator. The indicator line
  // carries no content, so the value is the continuation lines alone.
  if (/^[>|][-+]?$/.test(first)) {
    const literal = first.startsWith("|");
    return foldLines(continuation, literal).trim();
  }

  const plain = foldLines([first, ...continuation], false).trim();
  // Strip surrounding quotes on a quoted scalar.
  return plain.length >= 2 && plain[0] === plain[plain.length - 1] && /["']/.test(plain[0])
    ? plain.slice(1, -1)
    : plain;
}

/** Join per YAML block semantics: literal keeps newlines, folded joins with a
 *  space and turns a blank line into a newline. */
function foldLines(lines: string[], literal: boolean): string {
  if (literal) return lines.join("\n");
  return lines.reduce((acc, line) => {
    if (acc === "") return line;
    if (line === "") return acc + "\n";
    return acc.endsWith("\n") ? acc + line : acc + " " + line;
  }, "");
}

const targets: Array<{ label: string; path: string }> = [
  ...readdirSync(skillsDir)
    .map((name) => ({ label: `skills/${name}`, path: join(skillsDir, name, "SKILL.md") }))
    .filter((t) => existsSync(t.path)),
  ...readdirSync(agentsDir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => ({ label: `agents/${name}`, path: join(agentsDir, name) })),
];

describe("skill and agent description length", () => {
  it("finds skills and agents to check", () => {
    expect(targets.length).toBeGreaterThan(0);
  });

  for (const { label, path } of targets) {
    it(`${label} description is within ${MAX_DESCRIPTION_LENGTH} characters`, () => {
      const description = extractDescription(readFileSync(path, "utf8"));
      expect(description.length, `${label} description is ${description.length} chars`).
        toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
    });
  }
});

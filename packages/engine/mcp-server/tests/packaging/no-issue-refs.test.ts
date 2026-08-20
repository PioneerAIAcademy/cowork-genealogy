/**
 * No issue references in model-visible SKILL.md / agent body text.
 *
 * CLAUDE.md: "No explanatory prose in a SKILL.md or an agent .md. Every line in
 * those files is a billed prompt token on every invocation. No comments, no
 * rationale, no note of what was tried before." A `(issue #1471)` is a billed
 * token that tells the model nothing — the reason belongs in the skill's spec
 * or rubric, where a human reads it and no inference pays for it.
 *
 * A manual pass is not enough, which is the argument for this file: a careful
 * reader scanned all 27 skill bodies and 4 agent bodies by hand and reported
 * nine of the eleven hits present that day.
 *
 * ─── Two decisions recorded at the site, so nobody re-derives them ───
 *
 * **Historical narration is deliberately NOT checked here.** It was in the
 * original ask and was dropped. The phrasings that would catch it also match
 * legitimate present-tense instruction (`project-status/SKILL.md`,
 * `conflict-resolution/SKILL.md` both read naturally that way), so the only
 * safe form would be a warn-only assertion. The alternative it beat: a
 * warn-only vitest expectation, rejected because nobody reads vitest stdout in
 * CI, so it cannot fail — and CLAUDE.md's "a new lint must be proven to fail"
 * rules that a check which cannot fail reads as coverage and is worse than
 * none. Narration stays unguarded and known-unguarded.
 *
 * **Scope is bodies only — not `references/`.** `gps-terminology.test.ts`'s
 * `discoverPluginFiles()` also walks `plugin/references/` and
 * `skills/<name>/references/`, and it is deliberately not reused. Ten copies of
 * `places-guidance.md` each cite upstream Claude Code issue #17741, and they
 * are byte-identical-pinned by `skill-guidance.test.ts`, so widening the scan
 * would turn this into an eleven-file coordinated edit plus a sha256 re-pin.
 * The CLAUDE.md rule quoted above covers skill and agent *bodies*; that is what
 * this checks.
 *
 * ─── Why entries are keyed on text, not line number ───
 *
 * `gps-terminology.test.ts` keys its allow-list on `lineNo`. That is wrong for
 * these files: measured across five days, the two `init-project` hits moved
 * 122 → 153 → 157 and 206 → 245 → 251 while their text never changed. A
 * line-keyed entry fails an unrelated PR twice — once for the "new" violation
 * and once for the stale entry it made stale. Keys are (relPath, trimmed line
 * text).
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const engineRoot = join(here, "..", "..", "..");
const pluginRoot = join(engineRoot, "plugin");

/**
 * `#1234`, `issue #1234`, `(#1234)`, and bare GitHub issue URLs.
 *
 * The 3+ digit floor is what keeps this off markdown headings (`### Step`) and
 * off `#1` style ordinals; every issue in this repo is 3-5 digits.
 */
const ISSUE_REF =
  /(?:issue\s+)?#\d{3,5}|github\.com\/[^\s)]*issues\/\d+/i;

interface Match {
  relPath: string;
  lineNo: number;
  text: string;
}

/** Skill and agent BODIES only. See the scope note above. */
function discoverBodies(): { abs: string; rel: string }[] {
  const files: { abs: string; rel: string }[] = [];

  const agentsDir = join(pluginRoot, "agents");
  if (existsSync(agentsDir)) {
    for (const f of readdirSync(agentsDir).sort()) {
      if (f.endsWith(".md")) {
        files.push({ abs: join(agentsDir, f), rel: `agents/${f}` });
      }
    }
  }

  const skillsDir = join(pluginRoot, "skills");
  if (existsSync(skillsDir)) {
    for (const skill of readdirSync(skillsDir).sort()) {
      const abs = join(skillsDir, skill, "SKILL.md");
      if (existsSync(abs)) {
        files.push({ abs, rel: `skills/${skill}/SKILL.md` });
      }
    }
  }

  return files;
}

/**
 * The 1-based line on which YAML frontmatter closes, or 0 when the file has
 * none.
 *
 * Frontmatter is parsed as YAML before the body ever reaches the model, so a
 * `#`-comment in it costs nothing at inference. Five such comments carry the
 * load-bearing warnings about listing every tool under all three server
 * spellings, and about a deny that fails open — they must survive this lint.
 *
 * Computing the boundary (rather than skipping the whole file) is the point: an
 * agent whose frontmatter is exempt must still be scanned below it, or the lint
 * goes dark for exactly the files that carry the most prose.
 */
function frontmatterEnd(lines: string[]): number {
  if (lines[0]?.trim() !== "---") return 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") return i + 1;
  }
  return 0; // unterminated — treat the whole file as body rather than skip it
}

function findMatchesInFile(abs: string, rel: string): Match[] {
  const lines = readFileSync(abs, "utf8").split(/\r?\n/);
  const bodyStart = frontmatterEnd(lines);
  const out: Match[] = [];
  for (let i = bodyStart; i < lines.length; i++) {
    if (ISSUE_REF.test(lines[i])) {
      out.push({ relPath: rel, lineNo: i + 1, text: lines[i].trim() });
    }
  }
  return out;
}

// ─── Allow-list ────────────────────────────────────────────────────
//
// The violations that existed when this lint landed. Each one leaves when its
// own skill next takes a paid `make eval-skill` run — editing a SKILL.md body
// flips that skill's run log inactive, so removing the prose here would buy a
// paid re-run and an annotation pass per skill. Delete the prose and its row
// together, in the PR that is already paying for that skill's run.
//
// This is not an escape hatch for "the lint is inconvenient": a new violation
// belongs in the spec or rubric, not here.
const ALLOWLIST: Array<{ relPath: string; text: string; reason: string }> = [
  {
    relPath: "skills/init-project/SKILL.md",
    text: "Call `person_read({ personId: \"<id>\", relatives: true, sourceDescriptions: true })`. **Both flags are required** — they default to `false`, and without them the call returns ONLY the subject's own facts (`relationships: []`, `sources: []`), which imports a subject-only tree with no spouse, children, or sources (issue #1475). With the flags it returns simplified GedcomX: person (name, gender, facts), relatives with IDs, relationships, and source descriptions. Auth error → tell user to log in.",
    reason:
      "pre-existing; leaves with init-project's next paid eval run. The parenthetical is the citation only — the instruction either side of it stays.",
  },
  {
    relPath: "skills/init-project/SKILL.md",
    text: "(issue #1471). Recording and testing the doubt is question-selection's job —",
    reason: "pre-existing; leaves with init-project's next paid eval run",
  },
  {
    relPath: "skills/question-selection/SKILL.md",
    text: "for its own conclusion (issue #1471). Under `--autonomous` (no user to answer),",
    reason:
      "pre-existing; leaves with question-selection's next paid eval run (its slot is held by an open PR today)",
  },
];

const allFiles = discoverBodies();
const allMatches: Match[] = allFiles.flatMap(({ abs, rel }) =>
  findMatchesInFile(abs, rel),
);

function isAllowed(m: Match): boolean {
  return ALLOWLIST.some((a) => a.relPath === m.relPath && a.text === m.text);
}

describe("no issue references in skill/agent bodies", () => {
  it("scans every skill body and every agent body", () => {
    // A lint that silently scanned nothing would read as coverage. Both
    // directories are asserted because a glob that quietly misses `agents/` is
    // one of the two traps this check was written against.
    const agents = allFiles.filter((f) => f.rel.startsWith("agents/"));
    const skills = allFiles.filter((f) => f.rel.startsWith("skills/"));
    expect(agents.length, "agent bodies scanned").toBeGreaterThan(0);
    expect(skills.length, "skill bodies scanned").toBeGreaterThan(0);
  });

  it("finds no issue reference in model-visible body text", () => {
    const offenders = allMatches
      .filter((m) => !isAllowed(m))
      .map((m) => `${m.relPath}:${m.lineNo} — ${m.text}`);

    expect(
      offenders,
      "an issue number is a billed token that tells the model nothing. Put the " +
        "reason in the skill's spec or rubric and state the mechanism here, or " +
        "add a reasoned allow-list entry if it is pre-existing",
    ).toEqual([]);
  });

  describe("allow-list entries are still needed", () => {
    for (const { relPath, text, reason } of ALLOWLIST) {
      it(`${relPath} still contains its allowed line (${reason})`, () => {
        const stillMatches = allMatches.some(
          (m) => m.relPath === relPath && m.text === text,
        );
        expect(
          stillMatches,
          `allow-list entry for ${relPath} no longer matches any line — the ` +
            "prose was removed or reworded, so delete the stale entry",
        ).toBe(true);
      });
    }
  });
});

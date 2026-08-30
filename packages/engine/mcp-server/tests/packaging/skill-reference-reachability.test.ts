import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Every file under a skill's references/ folder must be named by something that
// skill can actually read.
//
// Nothing lists a references/ folder at runtime — a reference is loaded because
// the SKILL.md names it (or because a reference the body names links on to it).
// A file nothing names is therefore unreachable in every environment: it costs
// no prompt tokens and carries the full maintenance and drift cost of a live
// file. Eleven such files shipped for months, nine of them copies of one
// `validation-protocol.md`, three of those carrying a doctrine the writer tools
// had already retired and one contradicting its own skill body.
//
// This is a REACHABILITY check, not a content check. Whether an unreached file's
// text is right, and whether it should be deleted or wired up, is the
// adjudication issue #1112 owns. What this stops is a twelfth one appearing
// while that is pending.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const skillsDir = join(repoRoot, "plugin", "skills");

// Files that are unreachable today and whose fate is a content decision, not a
// mechanical one. Every entry was measured: each carries substantial unique
// craft guidance its SKILL.md does not already state, so deleting it would lose
// real content and wiring it up changes what the skill does — a behavioural
// change owing a paid eval run. That is why they are pending rather than fixed.
//
// This list may only SHRINK. Removing an entry means the file was deleted or
// wired into its SKILL.md; adding one means shipping a file nothing can read,
// which is the thing this test exists to prevent.
const UNREACHED_PENDING_ADJUDICATION: Array<{ path: string; why: string }> = [
  {
    path: "convert-dates/references/calendar-conflicts.md",
    why: "172 lines on identifying and resolving calendar-based date conflicts; none of its 19 headings/terms appear in the body",
  },
  {
    path: "init-project/references/research-process-init.md",
    why: "151 lines of init decision rules and vague-data interpretation; 4 of 23 terms in the body",
  },
  {
    path: "record-extraction/references/information-classification-at-extraction.md",
    why: "147 lines of informant analysis incl. the three-informant death-certificate worked example; 2 of 22 terms in the body",
  },
  {
    path: "record-extraction/references/note-taking-standards.md",
    why: "151 lines mapping GPS note-taking standards 25-33 to assertion extraction; 0 of 18 terms in the body",
  },
  {
    path: "record-extraction/references/source-classification-guide.md",
    why: "95 lines on original/derivative/authored classification per record; 4 of 14 terms in the body",
  },
  {
    path: "record-extraction/references/places-guidance.md",
    why: "byte-identical copy pinned by skill-guidance.test.ts — deleting it fails that lint, so the two must be resolved together",
  },
  {
    path: "research-plan/references/locality-survey-guide.md",
    why: "79 lines of locality-survey methodology and its research.json mapping; 1 of 22 terms in the body",
  },
];

const EXEMPT = new Set(UNREACHED_PENDING_ADJUDICATION.map((e) => e.path));

function listSkills(): string[] {
  return readdirSync(skillsDir).filter((name) =>
    statSync(join(skillsDir, name)).isDirectory()
  );
}

/**
 * Names of reference files reachable from `skill`'s SKILL.md, following one hop
 * through references the body itself names. A body can name `warning-checks.md`
 * which in turn names `assumption-categories.md`; the second is reachable.
 */
function reachableRefs(skill: string): Set<string> {
  const refsDir = join(skillsDir, skill, "references");
  if (!existsSync(refsDir)) return new Set();
  const present = readdirSync(refsDir).filter((f) => f.endsWith(".md"));

  const bodyPath = join(skillsDir, skill, "SKILL.md");
  const body = existsSync(bodyPath) ? readFileSync(bodyPath, "utf8") : "";

  const reachable = new Set(present.filter((f) => body.includes(f)));

  // Transitive closure: a reachable reference may name further ones.
  let grew = true;
  while (grew) {
    grew = false;
    for (const name of [...reachable]) {
      const text = readFileSync(join(refsDir, name), "utf8");
      for (const candidate of present) {
        if (candidate !== name && !reachable.has(candidate) && text.includes(candidate)) {
          reachable.add(candidate);
          grew = true;
        }
      }
    }
  }
  return reachable;
}

describe("skill references are reachable", () => {
  for (const skill of listSkills()) {
    const refsDir = join(skillsDir, skill, "references");
    if (!existsSync(refsDir)) continue;

    it(`${skill}: every references/ file is named by something the skill reads`, () => {
      const present = readdirSync(refsDir).filter((f) => f.endsWith(".md"));
      const reachable = reachableRefs(skill);
      const unreached = present
        .filter((f) => !reachable.has(f))
        .map((f) => `${skill}/references/${f}`)
        .filter((rel) => !EXEMPT.has(rel));

      expect(
        unreached,
        `These files are named by no SKILL.md and by no reference it reads, so ` +
          `no session can load them. Name the file in ${skill}/SKILL.md, or ` +
          `delete it. Do NOT add it to UNREACHED_PENDING_ADJUDICATION — that ` +
          `list only shrinks.`
      ).toEqual([]);
    });
  }

  it("every pending-adjudication entry still exists and is still unreached", () => {
    const stale: string[] = [];
    for (const { path: rel } of UNREACHED_PENDING_ADJUDICATION) {
      const [skill, , file] = rel.split("/");
      const full = join(skillsDir, skill, "references", file);
      if (!existsSync(full)) {
        stale.push(`${rel}: file is gone — drop this entry`);
        continue;
      }
      if (reachableRefs(skill).has(file)) {
        stale.push(`${rel}: now reachable — drop this entry`);
      }
    }
    // Without this the list would silently outlive the problem, and a reader
    // would take a resolved file for an open one.
    expect(stale, "UNREACHED_PENDING_ADJUDICATION has stale entries").toEqual([]);
  });

  it("every pending-adjudication entry carries a reason", () => {
    for (const { path: rel, why } of UNREACHED_PENDING_ADJUDICATION) {
      expect(why.trim().length, `${rel} needs a reason`).toBeGreaterThan(20);
    }
  });
});

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// A skill's references/ folder and its SKILL.md must agree in both directions:
// every file present is named by something the skill reads, and every file the
// body names is present.
//
// Nothing lists a references/ folder at runtime — a reference is loaded because
// the SKILL.md names it (or because a reference the body names links on to it).
// A file nothing names is therefore unreachable in every environment: it costs
// no prompt tokens and carries the full maintenance and drift cost of a live
// file. Eleven such files shipped for months, nine of them copies of one
// `validation-protocol.md`, three of those carrying a doctrine the writer tools
// had already retired and one contradicting its own skill body.
//
// The mirror failure is a body naming a file that is not there — the agent is
// told to read something it cannot open and improvises instead. `project-status`
// does that today for a file that has never existed in this repo.
//
// This is a REACHABILITY check, not a content check. Whether an unreached file's
// text is right, whether it should be deleted or wired up, and what a missing
// one should say, are the adjudications issue #1112 owns. What this stops is a
// twelfth orphan or a second dangling pointer appearing while that is pending.

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

// The mirror failure: a SKILL.md naming a references/ file that is not there.
// The body tells the agent to read a file it cannot open, and the agent
// improvises. Same shrink-only rule as the list above.
const MISSING_PENDING_ADJUDICATION: Array<{ path: string; why: string }> = [
  {
    path: "project-status/references/output-formats.md",
    why: "named twice as the render source for both summaries; never existed in this repo's history, so writing it decides what the skill outputs and owes a paid eval run",
  },
];

const MISSING_EXEMPT = new Set(MISSING_PENDING_ADJUDICATION.map((e) => e.path));

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

/**
 * `references/<file>.md` paths a skill's own SKILL.md names that are not on
 * disk. The lookbehind drops a cross-skill citation
 * (`check-warnings/references/assumption-categories.md`), which names another
 * skill's file — real, and not this skill's to hold.
 */
function namedButMissing(skill: string): string[] {
  const bodyPath = join(skillsDir, skill, "SKILL.md");
  if (!existsSync(bodyPath)) return [];
  const refsDir = join(skillsDir, skill, "references");
  const present = new Set(existsSync(refsDir) ? readdirSync(refsDir) : []);
  const body = readFileSync(bodyPath, "utf8");
  const named = new Set<string>();
  for (const m of body.matchAll(
    /(?<![A-Za-z0-9._-]\/)references\/([A-Za-z0-9._-]+\.md)/g
  )) {
    named.add(m[1]);
  }
  return [...named]
    .filter((f) => !present.has(f))
    .map((f) => `${skill}/references/${f}`);
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

  it("every references/ file a SKILL.md names is on disk", () => {
    const missing = listSkills()
      .flatMap((skill) => namedButMissing(skill))
      .filter((rel) => !MISSING_EXEMPT.has(rel));

    expect(
      missing,
      `A SKILL.md names a references/ file that does not exist, so the agent is ` +
        `told to read a file it cannot open. Create the file, or drop the ` +
        `pointer. Do NOT add it to MISSING_PENDING_ADJUDICATION — that list ` +
        `only shrinks.`
    ).toEqual([]);
  });

  it("every missing-reference exemption is still named and still missing", () => {
    const stale: string[] = [];
    for (const { path: rel } of MISSING_PENDING_ADJUDICATION) {
      const [skill, , file] = rel.split("/");
      if (existsSync(join(skillsDir, skill, "references", file))) {
        stale.push(`${rel}: file now exists — drop this entry`);
      } else if (!namedButMissing(skill).includes(rel)) {
        stale.push(`${rel}: no longer named by ${skill}/SKILL.md — drop this entry`);
      }
    }
    expect(stale, "MISSING_PENDING_ADJUDICATION has stale entries").toEqual([]);
  });

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
    for (const { path: rel, why } of [
      ...UNREACHED_PENDING_ADJUDICATION,
      ...MISSING_PENDING_ADJUDICATION,
    ]) {
      expect(why.trim().length, `${rel} needs a reason`).toBeGreaterThan(20);
    }
  });
});

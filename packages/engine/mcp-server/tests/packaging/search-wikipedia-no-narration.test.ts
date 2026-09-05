/**
 * `search-wikipedia/SKILL.md` must carry no `**Narration:**` line.
 *
 * Every other skill opens with one, so the natural thing for a
 * skill-authoring PR to do is "fix" the one that doesn't. That would
 * permanently disarm the only validator watching this behaviour.
 *
 * The Narration line's own fallback is "a one-line preamble per action". All
 * 12 of this skill's tests run with no scenario, so the
 * `researcher_profile.narration_guidance` lookup always misses and always
 * lands on that fallback — and a preamble is exactly what
 * `test_reply_does_not_narrate_pending_step`
 * (`eval/harness/validators/test_search_wikipedia.py`) fails the skill for.
 * Adding the line makes the collision worse, not better.
 *
 * Three prose files assert this (`CLAUDE.md`, `docs/skill-authoring-guide.md`,
 * `docs/deep-dives/search-wikipedia-prohibition-list.md`); this is the anchor
 * that makes it fail rather than be read past.
 *
 * The complement is asserted too — that every OTHER skill carries the line.
 * Without it, a rename of the skill directory (or a glob that quietly matches
 * nothing) would leave this file green while scanning zero skills, which is
 * CLAUDE.md's "a check that cannot fail reads as coverage".
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const skillsRoot = join(here, "..", "..", "..", "plugin", "skills");

/** The exception. Keep in sync with the three prose sites named above. */
const EXEMPT = "search-wikipedia";

const NARRATION = /\*\*Narration/;

function skillBodies(): { name: string; text: string }[] {
  return readdirSync(skillsRoot)
    .sort()
    .map((name) => ({ name, abs: join(skillsRoot, name, "SKILL.md") }))
    .filter(({ abs }) => existsSync(abs))
    .map(({ name, abs }) => ({ name, text: readFileSync(abs, "utf8") }));
}

describe("the search-wikipedia Narration exception", () => {
  const bodies = skillBodies();

  it("scans every skill body", () => {
    expect(bodies.length, "skill bodies found").toBeGreaterThan(20);
    expect(
      bodies.map((b) => b.name),
      `${EXEMPT} was not found — if the skill was renamed, update EXEMPT and ` +
        "the three prose sites named in this file's header",
    ).toContain(EXEMPT);
  });

  it(`${EXEMPT} carries no **Narration:** line`, () => {
    const body = bodies.find((b) => b.name === EXEMPT);
    const hit = body && NARRATION.exec(body.text);
    expect(
      hit?.[0],
      "search-wikipedia must NOT carry a Narration line: the line's fallback " +
        "is 'a one-line preamble per action', and that preamble is what " +
        "test_reply_does_not_narrate_pending_step fails this skill for. See " +
        "this file's header and CLAUDE.md's 'Researcher profile' section.",
    ).toBeUndefined();
  });

  it("every other skill does carry one", () => {
    const missing = bodies
      .filter((b) => b.name !== EXEMPT && !NARRATION.test(b.text))
      .map((b) => b.name);
    expect(
      missing,
      "a skill lost its **Narration:** line. Only search-wikipedia is exempt " +
        "(docs/skill-authoring-guide.md §4); restore the line, or, if a second " +
        "exception is genuinely intended, widen EXEMPT here and say why in " +
        "all three prose sites",
    ).toEqual([]);
  });
});

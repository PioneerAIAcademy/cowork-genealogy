/**
 * `agents/search-wikipedia.md` must carry no `**Narration:**` line.
 *
 * Every skill body opens with one, so the natural thing for an authoring PR to
 * do is "fix" the agent that doesn't. That would permanently disarm the only
 * validator watching this behaviour. (Not every *agent* carries the line --
 * `gps-mentor`, `image-reader` and `record-extractor` do not. What makes
 * `search-wikipedia` different is that its absence is a RULE, pinned here.)
 *
 * The Narration line's own fallback is "a one-line preamble per action". All of
 * this agent's tests run with no scenario, so the
 * `researcher_profile.narration_guidance` lookup always misses and always
 * lands on that fallback — and a preamble is exactly what
 * `test_reply_does_not_narrate_pending_step`
 * (`eval/harness/validators/test_search_wikipedia.py`) fails the subject for.
 * Adding the line makes the collision worse, not better.
 *
 * The exception used to live on `skills/search-wikipedia/SKILL.md`. Issue #2795
 * replaced that skill with the agent above and deleted the directory, which is
 * why the subject moved: the rule is about the body the validator grades, and
 * that body is now an agent. The complement moved with it — with the skill gone
 * EVERY shipped skill carries the line, so the skill arm is an unconditional
 * floor rather than an all-but-one one.
 *
 * Three prose files assert this (`CLAUDE.md`, `docs/skill-authoring-guide.md`,
 * `docs/deep-dives/search-wikipedia-prohibition-list.md`); this is the anchor
 * that makes it fail rather than be read past.
 *
 * Two anti-vacuity arms sit under it: every skill carries the line, and at
 * least one OTHER agent does. Without them a rename of the exempt file (or a
 * glob that quietly matches nothing) would leave this file green while scanning
 * nothing, which is CLAUDE.md's "a check that cannot fail reads as coverage".
 * The agent-side arm is deliberately "some other agent", not "every other
 * agent": three carry no line, so the stronger claim would be a lint failing on
 * the corpus it ships with.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(here, "..", "..", "..", "plugin");
const skillsRoot = join(pluginRoot, "skills");
const agentsRoot = join(pluginRoot, "agents");

/** The exception. Keep in sync with the three prose sites named above. */
const EXEMPT = "search-wikipedia.md";

const NARRATION = /\*\*Narration/;

function skillBodies(): { name: string; text: string }[] {
  return readdirSync(skillsRoot)
    .sort()
    .map((name) => ({ name, abs: join(skillsRoot, name, "SKILL.md") }))
    .filter(({ abs }) => existsSync(abs))
    .map(({ name, abs }) => ({ name, text: readFileSync(abs, "utf8") }));
}

function agentBodies(): { name: string; text: string }[] {
  return readdirSync(agentsRoot)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => ({ name, text: readFileSync(join(agentsRoot, name), "utf8") }));
}

describe("the search-wikipedia Narration exception", () => {
  const skills = skillBodies();
  const agents = agentBodies();

  it("scans every skill and agent body", () => {
    // A floor against an empty scan, not a count: every skill-to-agent conversion
    // shrinks the set, and research, record-extraction and forget-and-rederive
    // stay skills (lead ruling 2026-09-22).
    expect(skills.length, "skill bodies found").toBeGreaterThanOrEqual(3);
    expect(agents.length, "agent bodies found").toBeGreaterThan(5);
    expect(
      agents.map((a) => a.name),
      `${EXEMPT} was not found — if the agent was renamed, update EXEMPT and ` +
        "the three prose sites named in this file's header",
    ).toContain(EXEMPT);
  });

  it(`agents/${EXEMPT} carries no **Narration:** line`, () => {
    const body = agents.find((a) => a.name === EXEMPT);
    const hit = body && NARRATION.exec(body.text);
    expect(
      hit?.[0],
      "search-wikipedia must NOT carry a Narration line: the line's fallback " +
        "is 'a one-line preamble per action', and that preamble is what " +
        "test_reply_does_not_narrate_pending_step fails this agent for. See " +
        "this file's header and CLAUDE.md's 'Researcher profile' section.",
    ).toBeUndefined();
  });

  it("the agent-side scan is not vacuous", () => {
    // NOT "every other agent carries one": three do not (gps-mentor,
    // image-reader, record-extractor), and asserting otherwise would be a lint
    // that fails on the corpus it ships with. What this arm has to rule out is
    // the silent zero — an EXEMPT that matches nothing, or a NARRATION regex
    // that stopped matching agent bodies — so it asserts the scanner finds the
    // line in some OTHER agent. If that ever drops to zero, the exemption above
    // is unfalsifiable and this fails before it can read as coverage.
    const carrying = agents.filter((a) => a.name !== EXEMPT && NARRATION.test(a.text));
    expect(
      carrying.map((a) => a.name),
      "no agent other than the exempt one carries a **Narration:** line, so the " +
        "exempt-agent assertion above would pass even if NARRATION matched nothing. " +
        "Either the line moved out of the agent bodies (update this file and the " +
        "three prose sites) or the regex has rotted.",
    ).not.toEqual([]);
  });

  it("every skill carries one", () => {
    // Unconditional since #2795 deleted skills/search-wikipedia/: the exemption
    // no longer lives on this side at all, so a skill missing the line is a
    // defect with no exception to appeal to.
    const missing = skills.filter((s) => !NARRATION.test(s.text)).map((s) => s.name);
    expect(
      missing,
      "a skill lost its **Narration:** line. No skill is exempt — the one " +
        "exception is the search-wikipedia AGENT (docs/skill-authoring-guide.md " +
        "§4). Restore the line.",
    ).toEqual([]);
  });
});

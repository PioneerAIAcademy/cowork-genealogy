import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The narrative-craft doctrine in gps-mentor's on-demand mode (spec §6.4) is
// load-bearing prose, and prose has no compiler. These assertions pin the few
// clauses whose silent deletion would be invisible until a user hit it:
//
//   1. The required scope sentence. A craft read that does not say it skipped
//      the evidence check lets a researcher mistake a style pass for an audit
//      — the one harm the whole section exists to prevent. Spec §6.4 mandates
//      it as required text precisely because "the agent will probably mention
//      it" is how it gets dropped under prompt pressure.
//   2. The refusal row. Without it a craft request against a project with no
//      written prose improvises generic writing advice instead of naming
//      proof-conclusion.
//   3. Severity. Craft findings are advisory; the single carried-over GPS
//      check (§6.3 check 3) is the only must-address route. An edit that turns
//      style opinions into blockers would make the mentor refuse to let a
//      researcher move on over a matter of taste.
//
// This does not test agent BEHAVIOR — nothing here can. The eval harness keys
// every unit test to a skill directory and gps-mentor is an agent, so it has
// no suite (see docs/testing-guides/gps-mentor-agent-testing-guide.md). This
// guards the instructions only.

const here = dirname(fileURLToPath(import.meta.url));
const AGENT = join(here, "..", "..", "..", "plugin", "agents", "gps-mentor.md");

describe("gps-mentor narrative-craft doctrine (spec §6.4)", () => {
  const body = readFileSync(AGENT, "utf8");

  it("keeps the craft section reachable from the frontmatter description", () => {
    const description = body.slice(0, body.indexOf("\n---", 4));
    // The description is the only text Cowork's router matches on, so a craft
    // phrase must live there or the section is unreachable in production.
    expect(description).toMatch(/is this a good read/i);
  });

  it("mandates the scope sentence as required text, not a suggestion", () => {
    expect(body).toMatch(/this is required text/i);
    // And states where it goes: above the heading, so it is read before praise.
    expect(body).toMatch(/above.*# Mentor review:/is);
  });

  it("keeps craft findings advisory and names the single must-address route", () => {
    expect(body).toMatch(/craft findings are advisory, always/i);
    expect(body).toMatch(/the one carry-over/i);
  });

  it("carries a refusal path for a craft request with nothing written yet", () => {
    // The refusal must name the skill that produces prose, not just decline.
    const refusalRow = body
      .split("\n")
      .find((l) => l.includes("craft request") && l.includes("|"));
    expect(refusalRow, "no craft row in the refusal table").toBeDefined();
    expect(refusalRow).toMatch(/proof-conclusion/);
  });

  it("does not leak an internal axis name into user-facing instructions", () => {
    // §6.4 forbids the agent saying "audience calibration" to a researcher.
    // The phrase may appear as a heading or in the `standard` convention, but
    // never inside an instruction about what to tell the user.
    const offending = body
      .split("\n")
      .filter((l) => /audience calibration/i.test(l))
      .filter((l) => /\btell\b|\bsay\b|narrative_for_user/i.test(l))
      .filter((l) => !/never|not|must not|don't/i.test(l));
    expect(offending).toEqual([]);
  });
});

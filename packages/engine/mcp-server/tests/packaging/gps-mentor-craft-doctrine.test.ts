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
    // And states where it goes. Anchored to the sentence that says it — an
    // unanchored /above.*# Mentor review:/s matches any "above" anywhere in the
    // file followed by the heading 200 lines later, which is always true.
    const positioning = body
      .split("\n\n")
      .find((p) => /scope sentence/i.test(p) && /# Mentor review:/.test(p));
    expect(positioning, "no paragraph positions the scope sentence").toBeDefined();
    expect(positioning).toMatch(/\babove\b/i);
  });

  it("keeps craft findings advisory and names the single must-address route", () => {
    // Pin the RULE, not just the bold label: a body rewritten to "checks 1-5 may
    // produce a must-address item" under an unchanged heading must fail.
    const severity = body
      .split("\n\n")
      .find((p) => /craft findings are advisory/i.test(p));
    expect(severity, "no craft severity paragraph").toBeDefined();
    expect(severity).toMatch(/never produce a\s+must-address item/i);
    expect(body).toMatch(/the one carry-over/i);
  });

  it("marks a craft verdict so supersession can identify it later", () => {
    // focus is "on-demand" for both craft and evidentiary reads, so the sidecar
    // flag is the only discriminator §12.3 has.
    expect(body).toMatch(/"craft":\s*true/);
  });

  it("carries a refusal path for a craft request with nothing written yet", () => {
    // The refusal must name the skill that produces prose, not just decline.
    const refusalRow = body
      .split("\n")
      .find((l) => l.includes("craft request") && l.includes("|"));
    expect(refusalRow, "no craft row in the refusal table").toBeDefined();
    expect(refusalRow).toMatch(/proof-conclusion/);
  });

  it("carries the prohibition on speaking internal axis names to the user", () => {
    // The earlier form of this test scanned for a *violating* instruction and
    // so passed on any text that did not contain one — including a body with
    // the whole craft section deleted. Assert the prohibition is PRESENT
    // instead: that is the thing whose deletion is invisible at runtime.
    const prohibition = body
      .split("\n\n")
      .find((p) => /axis names/i.test(p) && /\bnever\b|\bdo not\b|\bdon't\b/i.test(p));
    expect(prohibition, "no paragraph forbids speaking the axis names").toBeDefined();
    // And it must name the register to use instead, or it is unactionable.
    expect(prohibition).toMatch(/cousin|out loud|colleague/i);
  });
});

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
//   4. The `craft: true` marker, which is the only thing separating a craft
//      verdict from an evidentiary one in the audit trail (§12.3) — both carry
//      `focus: "on-demand"`.
//
// **Everything is asserted against CRAFT_SECTION, not the whole body.** The
// first version of this file scanned the whole file, and PR review showed why
// that is worthless: `"craft": true` and the scope-sentence rule each appeared
// twice — once as the operative instruction inside the craft rubric, once as an
// incidental restatement elsewhere — so a global `toMatch` stayed green after
// the operative instruction was deleted, and a `.split("\n\n").find(...)`
// returned the incidental paragraph and tested only that one. Slicing the
// section first means an incidental mention elsewhere cannot satisfy anything
// here.
//
// This does not test agent BEHAVIOR — nothing here can. The eval harness keys
// every unit test to a skill directory and gps-mentor is an agent, so it has
// no suite (issue #1253). This guards the instructions only.

const here = dirname(fileURLToPath(import.meta.url));
const AGENT = join(here, "..", "..", "..", "plugin", "agents", "gps-mentor.md");

const body = readFileSync(AGENT, "utf8");

/** The craft rubric only — from its heading to the next top-level section. */
function craftSection(text: string): string {
  const start = text.indexOf("#### When the ask is about how it reads");
  if (start === -1) return "";
  const end = text.indexOf("\n## ", start);
  return text.slice(start, end === -1 ? undefined : end);
}

describe("gps-mentor narrative-craft doctrine (spec §6.4)", () => {
  const CRAFT = craftSection(body);

  it("has a craft section at all (every assertion below scopes to it)", () => {
    expect(CRAFT, "craft rubric heading not found in the agent body").not.toBe("");
    // Guards against the slice silently collapsing to a few lines and making
    // every other assertion here vacuous.
    expect(CRAFT.length).toBeGreaterThan(1000);
  });

  it("keeps the craft section reachable from the frontmatter description", () => {
    const description = body.slice(0, body.indexOf("\n---", 4));
    // The description is the only text Cowork's router matches on, so a craft
    // phrase must live there or the section is unreachable in production.
    expect(description).toMatch(/is this a good read/i);
  });

  it("mandates the scope sentence as required text, and puts it before the heading", () => {
    expect(CRAFT).toMatch(/this is required text/i);
    // "Before the `# Mentor review:` heading" — the position is the point. An
    // edit to "after the heading" must fail, so assert the ordering word inside
    // the sentence that carries the rule, not anywhere in the section.
    const rule = CRAFT.split("\n\n").find((p) => /required text/i.test(p));
    expect(rule, "no paragraph carries the required-text rule").toBeDefined();
    expect(rule).toMatch(/\bbefore\b[\s\S]{0,40}# Mentor review:/i);
    expect(rule).not.toMatch(/\bafter\b[\s\S]{0,40}# Mentor review:/i);
  });

  it("keeps craft findings advisory and names the single must-address route", () => {
    // Pin the RULE, not just the bold label: a body rewritten to "checks 1-5 may
    // produce a must-address item" under an unchanged heading must fail.
    const severity = CRAFT.split("\n\n").find((p) =>
      /craft findings are advisory/i.test(p),
    );
    expect(severity, "no craft severity paragraph").toBeDefined();
    expect(severity).toMatch(/never produce a\s+must-address item/i);
    expect(CRAFT).toMatch(/the one carry-over/i);
  });

  it("marks a craft verdict so supersession can identify it later", () => {
    // Must be the operative instruction inside the craft rubric. The Output
    // protocol also mentions the field; that mention is documentation and does
    // not tell the agent to set it.
    expect(CRAFT).toMatch(/"craft":\s*true/);
  });

  it("carries a refusal path for a craft request with nothing written yet", () => {
    // Lives in the refusal table, outside the craft section by design — so this
    // one assertion scans the whole body on purpose.
    const refusalRow = body
      .split("\n")
      .find((l) => l.includes("craft request") && l.includes("|"));
    expect(refusalRow, "no craft row in the refusal table").toBeDefined();
    expect(refusalRow).toMatch(/proof-conclusion/);
  });

  it("carries the prohibition on speaking internal axis names to the user", () => {
    // An earlier form scanned for a *violating* instruction and so passed on any
    // text without one — including a body with the whole craft section deleted.
    // Assert the prohibition is PRESENT: that is what silently disappears.
    const prohibition = CRAFT.split("\n\n").find((p) => /axis names/i.test(p));
    expect(prohibition, "no paragraph mentions the axis names").toBeDefined();
    // The negation has to bind to the axis names themselves. Looking for a
    // negation anywhere in the paragraph is not enough — the worked example
    // ("their cousin who has never used a genealogy site") supplies a stray
    // "never", so an inverted rule kept every predicate satisfied and passed.
    expect(prohibition).toMatch(/\b(never|do not|don't|must not)\b[^.]{0,30}axis names/i);
    expect(prohibition).not.toMatch(/\b(always|feel free to|you may|you can)\b[^.]{0,30}axis names/i);
    // And it must name the register to use instead, or it is unactionable.
    expect(prohibition).toMatch(/cousin|out loud|colleague/i);
  });
});

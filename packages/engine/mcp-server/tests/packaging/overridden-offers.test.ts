import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Since phase 1 a hosted turn runs continuously: the Stop hook vetoes the model's voluntary
// yield until `project.status` is `completed`. So a body that ends a reply with an offer gets
// the offer overridden and answers its own question in the same turn — the reader sees
// "Shall I continue?" followed by the agent continuing.
//
// Each of these is a paid eval slot to fix, so this guard is a LEDGER, not a blanket ban: it
// pins the exact set that still carries one, and fails when the set changes in either
// direction. Removing an offer without clearing its row here fails just as loudly as adding a
// new one, which is what keeps the ledger honest as the slots are worked through.
//
// Ownership as of 2026-09-28, because a collision costs two paid slots:
//   search-records/SKILL.md      — PR #2971
//   agents/person-evidence.md    — PR #2992
const PLUGIN = join(__dirname, "..", "..", "..", "plugin");

/** Phrases that read as "I am waiting for your answer" at the end of a reply. */
const OFFER = /(Would you like me to|Shall I continue|Let the user confirm|Would you like to)/;

/** Bodies that still end a reply with an offer the run overrides, and why each is still here. */
const KNOWN: Record<string, string> = {
  "skills/search-records/SKILL.md": "PR #2971 owns this file; batched behind it",
  "skills/search-external-sites/SKILL.md": "batched with phase 3's errand — same passage (R5)",
  "skills/search-full-text/SKILL.md": "batched with the search-records slot",
  "skills/conflict-resolution/SKILL.md": "batched; a conflict fork becomes the decision exit",
  "agents/person-evidence.md": "PR #2992 owns this file; batched behind it",
};

function bodies(): string[] {
  const out: string[] = [];
  for (const dir of readdirSync(join(PLUGIN, "skills"))) {
    out.push(`skills/${dir}/SKILL.md`);
  }
  for (const f of readdirSync(join(PLUGIN, "agents"))) {
    if (f.endsWith(".md")) out.push(`agents/${f}`);
  }
  return out;
}

describe("offers the continuous run overrides", () => {
  it("is exactly the set the ledger names, in both directions", () => {
    const found: string[] = [];
    for (const rel of bodies()) {
      let text: string;
      try {
        text = readFileSync(join(PLUGIN, rel), "utf8");
      } catch {
        continue;
      }
      if (OFFER.test(text)) found.push(rel);
    }
    const known = Object.keys(KNOWN).sort();
    expect(found.sort()).toEqual(known);
  });

  it("research-plan states the next step instead of offering to start", () => {
    const text = readFileSync(join(PLUGIN, "skills/research-plan/SKILL.md"), "utf8");
    // The offer nobody answers, in the spellings it has actually been written in.
    // Asserted by meaning, not by our sentence: rewording the close must stay green.
    // Lines that FORBID the offer are not the offer -- the body carries one such rule
    // ("do not ask 'would you like me to start?' first"), and a bare match flags it.
    const OFFER = /Would you like me to|Shall I start|Do you want me to start/i;
    const NEGATED = /do not ask|don't ask|never ask|rather than asking|instead of asking/i;
    const offering = text.split("\n").filter((l) => OFFER.test(l) && !NEGATED.test(l));
    expect(offering).toEqual([]);
    // The handoff stays GATED on the invoking message authorizing execution. Without
    // this, "Create the first research plan for q_001" would execute the plan it was
    // asked to write -- which is what made 22 unit tests need callee stubs.
    expect(text).toMatch(/already authorized execution/);
  });
});

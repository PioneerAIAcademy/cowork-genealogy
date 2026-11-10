import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Step mode removed the Stop veto (PR #4146 hosted, PR #4206 e2e): a turn is one step, and an
// offer at the end of a reply is where that step stops, so an offer is no longer overridden.
// This ledger now only pins which bodies end a reply on an offer, and fails when the set
// changes in either direction, so adding or removing one is a deliberate, reviewed edit.
//
// Ownership as of 2026-09-28, because a collision costs two paid slots:
//   agents/person-evidence.md    — PR #2992
const PLUGIN = join(__dirname, "..", "..", "..", "plugin");

/** Phrases that read as "I am waiting for your answer" at the end of a reply. */
const OFFER = /(Would you like me to|Shall I continue|Let the user confirm|Would you like to)/;

/** Bodies that end a reply on an offer, and why each does. */
const KNOWN: Record<string, string> = {
  "agents/search-records.md": "step mode: offers the next plan item, by design",
  "agents/research-plan.md": "step mode: offers to start the searches, by design",
  "agents/search-external-sites.md": "batched with phase 3's errand — same passage (R5); an agent since the main merge",
  // MEASURED 2026-09-29: these two offers are load-bearing STOPS, not politeness.
  // Removing the question let each skill run on into the next skill's work, and
  // the eval caught it three ways in one run (v1_2026-09-29_15-00-30):
  //   ut_search_full_text_013  ownership validator — wrote `assertions`,
  //     `sources` and tree `persons`/`sources`, all record-extraction's.
  //   ut_search_full_text_006  performed question-selection's task itself.
  //   ut_conflict_resolution_015  fabricated and resolved a conflict on a
  //     fixture whose per-test context says no conflict exists.
  // All three passed before the edit and failed after, so the offer is what was
  // holding the boundary. Reverted; removing either needs a replacement stop
  // rather than a reworded closing line, and that is its own paid slot.
  "agents/search-full-text.md": "offer is a load-bearing stop — see note above; an agent since the main merge",
  "agents/conflict-resolution.md": "offer is a load-bearing stop — see note above; an agent since the main merge",
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

describe("bodies that end a reply on an offer", () => {
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

});

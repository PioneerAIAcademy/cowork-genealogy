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
  // research-plan's offer showed NO boundary defect (19-20 pass, zero fails across
  // three runs). It is reverted for a different, measured reason: the gate needs a
  // red-free run of a suite whose longest tests stall. `sdk_stream_silence` is 100%
  // research-plan corpus-wide, and it lands on the top-ranked tests by duration --
  // wzk (424s, rank 1 of 23), 005 (rank 2), 014 (rank 3), 002 (rank 5). Five runs
  // failed to produce a clean log for a one-line prose change. Fix the stall first.
  "skills/research-plan/SKILL.md": "reverted — gate blocked by duration-linked stalls, not by the edit",
  "skills/search-full-text/SKILL.md": "offer is a load-bearing stop — see note above",
  "skills/conflict-resolution/SKILL.md": "offer is a load-bearing stop — see note above",
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

});

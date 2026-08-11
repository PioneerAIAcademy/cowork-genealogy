/// <reference types="node" />
/**
 * Evidence probe: does `same_person` score a LOCALLY-MINTED tree person, or is
 * the result a degenerate artifact of the missing FamilySearch ARK?
 *
 * Why this exists. Two sources in the repo disagree, and a guardrail decision
 * rests on which is right:
 *
 *  - `packages/engine/plugin/skills/person-evidence/SKILL.md` (2026-07-02):
 *    "When the tree candidate is a local stub, or a tree id `same_person`
 *    cannot resolve to a full FamilySearch ARK, the tool may return a near-zero
 *    score (e.g. `0.005`) that reflects the missing ARK, not a real mismatch.
 *    Treat that as **no score available**."
 *  - `src/utils/match-engine.ts` (mint-hardening, 2026-07-07 — five days LATER):
 *    "The score is unaffected — FS matches on the document content", and the
 *    focus person "must ALWAYS carry a valid-format Persistent id so
 *    matchTwoExamples scores on document CONTENT rather than merely tolerating
 *    a missing/malformed id."
 *
 * If the code comment is right, the skill's guidance is stale and a
 * newly-minted person CAN be meaningfully scored — which decides whether the
 * §8 provenance guardrail is asking for something achievable
 * (docs/specs/guardrail-enforcement-spec.md §4/§10).
 *
 * Method — one variable, four calls. The record side (`gedcomx1`) and every
 * fact on the tree side are held identical to `try-same-person.ts`'s
 * known-good Hufenreuter pair; only the tree side's `ark` fields change:
 *
 *   A   control      tree focus keeps its real ARK
 *   B1  the case     tree focus ARK removed -> local id only (a minted person)
 *   B2  the case     identical to B1, re-run: `randomFsId()` mints a FRESH id
 *                    per call, so B1 == B2 shows the minted id does not move
 *                    the score
 *   C   fullest      every ARK on the tree side removed (a whole new subtree)
 *
 * Requires a valid FS session (`npx tsx dev/try-login.ts <clientId>`).
 *
 * Usage:
 *   npx tsx dev/probe-same-person-local-id.ts
 */
import { samePerson } from "../src/tools/same-person.js";
import type { SimplifiedGedcomX } from "../src/types/gedcomx.js";

/** Record side — held constant across every arm. */
const gedcomx1: SimplifiedGedcomX = {
  persons: [
    {
      id: "I1",
      ark: "ark:/61903/4:1:KGS8-LY1",
      gender: "Male",
      names: [{ preferred: true, type: "BirthName", given: "Johann Georg", surname: "Hufenreuter" }],
      facts: [{ type: "Birth", date: "11Jan1758", place: "Biesenrode, Schsn, Prss" }],
    },
    {
      id: "I2",
      ark: "ark:/61903/4:1:KGS8-LY7",
      gender: "Male",
      names: [{ preferred: true, type: "BirthName", given: "Johann Tobias", surname: "Hufenreuter" }],
      facts: [{ type: "Birth", date: "16Mar1721", place: "Biesenrode, Schsn, Prss" }],
    },
  ],
  relationships: [{ type: "ParentChild", parent: "I2", child: "I1" }],
};

/** Tree side, arm A: real ARKs, exactly as `try-same-person.ts` sends them. */
function treeWithArks(): SimplifiedGedcomX {
  return {
    persons: [
      {
        id: "I1",
        ark: "ark:/61903/4:1:KCWM-J9H",
        gender: "Male",
        names: [{ preferred: true, type: "BirthName", given: "Johann Georg", surname: "Hufenreuter" }],
        facts: [{ type: "Birth", date: "11Jan1758", place: "Biesenrode, Schsn, Prss" }],
      },
      {
        id: "I2",
        ark: "ark:/61903/4:1:KDBD-Y1Q",
        gender: "Male",
        names: [{ preferred: true, type: "BirthName", given: "Johann Tobias", surname: "Hufenreuter" }],
        facts: [{ type: "Birth", date: "16Mar1721", place: "Biesenrode, Schsn, Prss" }],
      },
    ],
    relationships: [{ type: "ParentChild", parent: "I2", child: "I1" }],
  };
}

/** Same tree, with `ark` deleted from the focus person only (arm B) or from
 *  everyone (arm C). Facts, names, gender and relationships are untouched, so
 *  any score movement is attributable to the ARK and nothing else. */
function stripArks(tree: SimplifiedGedcomX, which: "focus" | "all"): SimplifiedGedcomX {
  return {
    ...tree,
    persons: (tree.persons ?? []).map((p) =>
      which === "all" || p.id === "I1" ? { ...p, ark: undefined } : { ...p },
    ),
  };
}

type Arm = { label: string; tree: SimplifiedGedcomX };

const arms: Arm[] = [
  { label: "A  control     (tree focus has a real ARK)", tree: treeWithArks() },
  { label: "B1 minted      (focus ARK removed, local id 'I1')", tree: stripArks(treeWithArks(), "focus") },
  { label: "B2 minted      (identical to B1 — fresh random mint)", tree: stripArks(treeWithArks(), "focus") },
  { label: "C  all-minted  (every tree ARK removed)", tree: stripArks(treeWithArks(), "all") },
];

const scores: Record<string, number | null> = {};

for (const arm of arms) {
  try {
    const result = await samePerson({
      gedcomx1,
      primaryId1: "I1",
      gedcomx2: arm.tree,
      primaryId2: "I1",
    });
    const score = "score" in result ? (result.score as number) : null;
    scores[arm.label] = score;
    console.log(`${arm.label}  ->  score=${score}`);
  } catch (e) {
    scores[arm.label] = null;
    console.log(`${arm.label}  ->  ERROR ${(e as Error).message}`);
  }
}

console.log("\n--- reading ---");
const a = scores[arms[0].label];
const b1 = scores[arms[1].label];
const b2 = scores[arms[2].label];
console.log(
  b1 !== null && b1 === b2
    ? "B1 == B2: the randomly minted id does NOT move the score."
    : "B1 != B2: the minted id DOES affect the score — investigate before trusting either.",
);
console.log(
  a !== null && b1 !== null && Math.abs(a - b1) < 0.05
    ? "B ~= A: an ARK-less focus person scores on document content. SKILL.md's\n" +
      "  degenerate-score guidance is STALE — a minted person can be scored."
    : "B << A: the missing ARK degrades the score. SKILL.md's guidance HOLDS —\n" +
      "  scoring a freshly minted person is not meaningful.",
);

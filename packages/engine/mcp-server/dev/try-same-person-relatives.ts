/// <reference types="node" />
/**
 * Smoke test for same_person's matchRelatives mode — exercises the
 * relatives path end-to-end against the live FamilySearch API.
 *
 * This is the §2 "load-bearing assumption" sanity check from
 * docs/specs/same-person-match-relatives-spec.md: does matchTwoExamples score
 * correctly when the sourceDescription anchor points at a RELATIVE (here, each
 * side's father I2) rather than the document's focus person (I1)?
 *
 * It reuses the real-ARK Hufenreuter payloads from try-same-person.ts. Each
 * side carries focus child "Johann Georg" (I1) and father "Johann Tobias"
 * (I2). With matchRelatives:true the heuristic pairs the two fathers and fires
 * exactly ONE FS call anchored on the father — if that returns a sane,
 * high-ish score, the assumption holds and the feature is sound. If it errors
 * or returns nonsense, STOP and raise it before relying on the heuristic.
 *
 * Requires a valid FS session (run `login` first, or set FS_ACCESS_TOKEN
 * in the environment if you want to bypass tokens.json).
 *
 * Usage:
 *   npx tsx dev/try-same-person-relatives.ts
 */
import { samePerson } from "../src/tools/same-person.js";
import type { SimplifiedGedcomX } from "../src/types/gedcomx.js";

const gedcomx1: SimplifiedGedcomX = {
  persons: [
    {
      id: "I1",
      ark: "ark:/61903/4:1:KGS8-LY1",
      gender: "Male",
      names: [{
        preferred: true,
        type: "BirthName",
        given: "Johann Georg",
        surname: "Hufenreuter",
      }],
      facts: [{
        type: "Birth",
        date: "11Jan1758",
        place: "Biesenrode, Schsn, Prss",
      }],
    },
    {
      id: "I2",
      ark: "ark:/61903/4:1:KGS8-LY7",
      gender: "Male",
      names: [{
        preferred: true,
        type: "BirthName",
        given: "Johann Tobias",
        surname: "Hufenreuter",
      }],
      facts: [{
        type: "Birth",
        date: "16Mar1721",
        place: "Biesenrode, Schsn, Prss",
      }],
    },
  ],
  relationships: [
    { type: "ParentChild", parent: "I2", child: "I1" },
  ],
};

const gedcomx2: SimplifiedGedcomX = {
  persons: [
    {
      id: "I1",
      ark: "ark:/61903/4:1:KCWM-J9H",
      gender: "Male",
      names: [{
        preferred: true,
        type: "BirthName",
        given: "Johann Georg",
        surname: "Hufenreuter",
      }],
      facts: [{
        type: "Birth",
        date: "11Jan1758",
        place: "Biesenrode, Schsn, Prss",
      }],
    },
    {
      id: "I2",
      ark: "ark:/61903/4:1:KDBD-Y1Q",
      gender: "Male",
      names: [{
        preferred: true,
        type: "BirthName",
        given: "Johann Tobias",
        surname: "Hufenreuter",
      }],
      facts: [{
        type: "Birth",
        date: "16Mar1721",
        place: "Biesenrode, Schsn, Prss",
      }],
    },
  ],
  relationships: [
    { type: "ParentChild", parent: "I2", child: "I1" },
  ],
};

// Baseline: the existing focus-person (I1) single-pair match, for comparison.
const focus = await samePerson({
  gedcomx1,
  primaryId1: "I1",
  gedcomx2,
  primaryId2: "I1",
});
console.log("=== focus single-pair (anchor on I1, the child) ===");
console.log(JSON.stringify(focus, null, 2));

// The sanity check: relatives mode anchors on the FATHER (I2) of each side.
const relatives = await samePerson({
  gedcomx1,
  primaryId1: "I1",
  gedcomx2,
  primaryId2: "I1",
  matchRelatives: true,
});
console.log("\n=== matchRelatives:true (anchors on the relatives) ===");
console.log(JSON.stringify(relatives, null, 2));
console.log(
  "\nExpect one parent match (I2↔I2, the two fathers) with a sane score. " +
  "A high score confirms matchTwoExamples respects a relative anchor.",
);

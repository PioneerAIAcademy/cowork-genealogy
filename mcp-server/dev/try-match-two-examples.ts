/// <reference types="node" />
/**
 * Smoke test for matchTwoExamples — exercises the tool end-to-end against
 * the live FamilySearch API using the Hufenreuter example payloads.
 *
 * Requires a valid FS session (run `login` first, or set FS_ACCESS_TOKEN
 * in the environment if you want to bypass tokens.json).
 *
 * Usage:
 *   npx tsx dev/try-match-two-examples.ts
 */
import { matchTwoExamples } from "../src/tools/match-two-examples.js";
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

const result = await matchTwoExamples({
  gedcomx1,
  primaryId1: "I1",
  gedcomx2,
  primaryId2: "I1",
});

console.log(JSON.stringify(result, null, 2));

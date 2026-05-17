/// <reference types="node" />
/**
 * Round-trip the issue's raw GedcomX through the simplifier and back.
 *
 *   raw GedcomX  →  toSimplified  →  Simplified  →  toGedcomX  →  raw GedcomX'
 *
 * Goal: see exactly what the simplifier preserves, drops, and changes
 * for a matchTwoExamples-shaped payload. Critical to know before we
 * design the MCP tool, because:
 *   - If toGedcomX outputs something the FS API accepts as-is, we just
 *     post-process the sourceDescription and we're done.
 *   - If it drops fields the API needs, our tool has to compensate.
 */
import { toSimplified, toGedcomX } from "../src/utils/gedcomx-convert.js";
import type { GedcomX } from "../src/types/gedcomx.js";

// Entry 1 from the matchTwoExamples issue — Johann Georg + parents.
const rawGedcomX: GedcomX = {
  persons: [
    {
      id: "id1",
      gender: { type: "http://gedcomx.org/Male" },
      names: [{
        preferred: true,
        type: "http://gedcomx.org/BirthName",
        nameForms: [{
          fullText: "Johann Georg Hufenreuter",
          parts: [
            { type: "http://gedcomx.org/Given", value: "Johann Georg" },
            { type: "http://gedcomx.org/Surname", value: "Hufenreuter" }
          ]
        }]
      }],
      facts: [{
        type: "http://gedcomx.org/Birth",
        date: { original: "11Jan1758", formal: "+1758-01-11" },
        place: { original: "Biesenrode, Schsn, Prss" }
      }],
      identifiers: {
        "http://gedcomx.org/Persistent": [
          "https://familysearch.org/ark:/61903/4:1:KGS8-LY1"
        ]
      }
    } as any,
    {
      id: "ark:/61903/4:1:KGS8-LY7",
      gender: { type: "http://gedcomx.org/Male" },
      names: [{
        preferred: true,
        type: "http://gedcomx.org/BirthName",
        nameForms: [{
          fullText: "Johann Tobias Hufenreuter",
          parts: [
            { type: "http://gedcomx.org/Given", value: "Johann Tobias" },
            { type: "http://gedcomx.org/Surname", value: "Hufenreuter" }
          ]
        }]
      }],
      facts: [{
        type: "http://gedcomx.org/Birth",
        date: { original: "16Mar1721", formal: "+1721-03-16" },
        place: { original: "Biesenrode, Schsn, Prss" }
      }],
      identifiers: {
        "http://gedcomx.org/Persistent": [
          "https://familysearch.org/ark:/61903/4:1:KGS8-LY7"
        ]
      }
    } as any,
    {
      id: "ark:/61903/4:1:KGS8-LYC",
      gender: { type: "http://gedcomx.org/Female" },
      names: [{
        preferred: true,
        type: "http://gedcomx.org/BirthName",
        nameForms: [{
          fullText: "Elisabeth Henrica Dorothea",
          parts: [
            { type: "http://gedcomx.org/Given", value: "Elisabeth Henrica Dorothea" }
          ]
        }]
      }],
      facts: [
        {
          type: "http://gedcomx.org/Birth",
          date: { original: "1720", formal: "+1720" },
          place: { original: "Biesenrode, Schsn, Prss" }
        },
        {
          type: "http://gedcomx.org/Burial",
          date: { original: "16May1780", formal: "+1780-05-16" },
          place: { original: "Biesenrode, Schsn, Prss" }
        }
      ],
      identifiers: {
        "http://gedcomx.org/Persistent": [
          "https://familysearch.org/ark:/61903/4:1:KGS8-LYC"
        ]
      }
    } as any,
  ],
  relationships: [
    {
      type: "http://gedcomx.org/ParentChild",
      person1: { resource: "#ark:/61903/4:1:KGS8-LY7", resourceId: "KGS8-LY7" } as any,
      person2: { resource: "#id1", resourceId: "id1" } as any,
    },
    {
      type: "http://gedcomx.org/ParentChild",
      person1: { resource: "#ark:/61903/4:1:KGS8-LYC", resourceId: "KGS8-LYC" } as any,
      person2: { resource: "#id1", resourceId: "id1" } as any,
    },
  ],
};

console.log("══════════════════════════════════════════════════════════════════");
console.log("STEP 1 — ORIGINAL raw GedcomX (3 persons + 2 ParentChild rels)");
console.log("══════════════════════════════════════════════════════════════════");
console.log(JSON.stringify(rawGedcomX, null, 2));

const simplified = toSimplified(rawGedcomX);
console.log("\n══════════════════════════════════════════════════════════════════");
console.log("STEP 2 — SIMPLIFIED (after toSimplified)");
console.log("══════════════════════════════════════════════════════════════════");
console.log(JSON.stringify(simplified, null, 2));

const roundtripped = toGedcomX(simplified);
console.log("\n══════════════════════════════════════════════════════════════════");
console.log("STEP 3 — ROUND-TRIPPED back to GedcomX (after toGedcomX)");
console.log("══════════════════════════════════════════════════════════════════");
console.log(JSON.stringify(roundtripped, null, 2));

console.log("\n══════════════════════════════════════════════════════════════════");
console.log("Things to compare yourself:");
console.log("  • Does step 3 still contain `identifiers` with the ARKs?");
console.log("  • Did `id1` get renamed (to I1 or similar)?");
console.log("  • Are relationships using the right resource references?");
console.log("  • Is there a `sourceDescriptions` array at all?");
console.log("══════════════════════════════════════════════════════════════════");

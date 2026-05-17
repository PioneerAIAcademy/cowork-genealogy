/// <reference types="node" />
/**
 * Definitive test: does the simplifier round-trip preserve the two
 * fields matchTwoExamples actually cares about?
 *
 *   1. persons[].identifiers["http://gedcomx.org/Persistent"]  (the ARK URLs)
 *   2. sourceDescriptions[].about: "#primaryPerson"            (the anchor)
 *
 * If both survive → no post-processing needed.
 * If neither survives → we post-process both (current plan).
 * If one survives → post-process only the missing one.
 *
 * Plus a live POST at the end to see the actual API response with the
 * round-tripped payload.
 */
import { toSimplified, toGedcomX } from "../src/utils/gedcomx-convert.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";
import type { GedcomX } from "../src/types/gedcomx.js";

const TOKEN_RAW = process.env.FS_ACCESS_TOKEN;
if (!TOKEN_RAW) {
  console.error("Set FS_ACCESS_TOKEN");
  process.exit(1);
}
const TOKEN = TOKEN_RAW.startsWith("Bearer ") ? TOKEN_RAW.slice(7) : TOKEN_RAW;

const URL =
  "https://www.familysearch.org/service/search/record/collections/match/matchTwoExamples?minConfidence=2";

// Build a single matchTwoExamples entry — focus-only (no parents, same as
// we know works) — with BOTH critical fields populated.
function buildEntry(ark: string): GedcomX {
  return {
    sourceDescriptions: [
      { id: "mainSrc", about: "#primaryPerson" } as any,
    ],
    persons: [{
      id: "primaryPerson",
      gender: { type: "http://gedcomx.org/Male" },
      names: [{
        preferred: true,
        type: "http://gedcomx.org/BirthName",
        nameForms: [{
          fullText: "Johann Georg Hufenreuter",
          parts: [
            { type: "http://gedcomx.org/Given",   value: "Johann Georg" },
            { type: "http://gedcomx.org/Surname", value: "Hufenreuter" },
          ],
        }],
      }],
      facts: [{
        type: "http://gedcomx.org/Birth",
        date: { original: "11Jan1758", formal: "+1758-01-11" },
        place: { original: "Biesenrode, Schsn, Prss" },
      }],
      identifiers: {
        "http://gedcomx.org/Persistent": [ark],
      },
    } as any],
  };
}

const queryRaw     = buildEntry("https://familysearch.org/ark:/61903/4:1:KGS8-LY1");
const candidateRaw = buildEntry("https://familysearch.org/ark:/61903/4:1:KCWM-J9H");

// Round-trip both
const queryRT     = toGedcomX(toSimplified(queryRaw));
const candidateRT = toGedcomX(toSimplified(candidateRaw));

console.log("══ ROUND-TRIP RESULT (query entry only — candidate is symmetric)");
console.log("═══════════════════════════════════════════════════════════════");
console.log("ORIGINAL:");
console.log(JSON.stringify(queryRaw, null, 2));
console.log("\nSIMPLIFIED:");
console.log(JSON.stringify(toSimplified(queryRaw), null, 2));
console.log("\nROUND-TRIPPED:");
console.log(JSON.stringify(queryRT, null, 2));

// What survived?
console.log("\n══ VERDICT — did the two matchTwoExamples-critical fields survive?");
console.log("═══════════════════════════════════════════════════════════════");
const arkSurvived = (queryRT.persons?.[0] as any)?.identifiers
  ?.["http://gedcomx.org/Persistent"]?.length > 0;
const sourceDescSurvived = Array.isArray(queryRT.sourceDescriptions) && queryRT.sourceDescriptions.length > 0;
const aboutSurvived = queryRT.sourceDescriptions?.[0]?.about === "#primaryPerson";

console.log(`  identifiers["...Persistent"] preserved: ${arkSurvived ? "✅ YES" : "❌ NO"}`);
console.log(`  sourceDescriptions present:             ${sourceDescSurvived ? "✅ YES" : "❌ NO"}`);
console.log(`  about: "#primaryPerson" anchor exact:   ${aboutSurvived ? "✅ YES" : "❌ NO"}`);
if (queryRT.sourceDescriptions?.[0]?.about) {
  console.log(`     actual about value:                  "${queryRT.sourceDescriptions[0].about}"`);
}

// Live POST the round-tripped payload to see if FS returns real ARKs
console.log("\n══ LIVE POST — using the round-tripped payload");
console.log("═══════════════════════════════════════════════════════════════");
const res = await fetch(URL, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": BROWSER_USER_AGENT,
  },
  body: JSON.stringify({
    entries: [
      { content: { gedcomx: queryRT } },
      { content: { gedcomx: candidateRT } },
    ],
  }),
});
console.log(`Status: ${res.status}`);
console.log(await res.text());
console.log("\n──── Look at entries[].id and title in the response above:");
console.log("       real ARK    → round-trip preserved enough");
console.log("       MMMM-MMM    → round-trip dropped something critical");

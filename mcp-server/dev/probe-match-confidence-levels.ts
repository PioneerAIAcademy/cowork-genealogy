/// <reference types="node" />
/**
 * Probe — minConfidence variations.
 *
 * Same Hufenreuter focus pair (baseline payload). Hits the endpoint
 * with minConfidence=0, 2, 5, 10. Tells us:
 *   - Whether the same match always returns (yes if it scores ≥
 *     minConfidence each time, no if minConfidence exceeds its bucket)
 *   - How `confidence` and `score` interact (does minConfidence filter
 *     by `confidence` bucket?)
 *   - What's the max valid minConfidence value (10? more?)
 */
import { BROWSER_USER_AGENT } from "../src/constants.js";

const TOKEN_RAW = process.env.FS_ACCESS_TOKEN;
if (!TOKEN_RAW) {
  console.error("Set FS_ACCESS_TOKEN");
  process.exit(1);
}
const TOKEN = TOKEN_RAW.startsWith("Bearer ") ? TOKEN_RAW.slice(7) : TOKEN_RAW;

const BASE_URL =
  "https://www.familysearch.org/service/search/record/collections/match/matchTwoExamples";

const BODY = JSON.stringify({
  entries: [
    { content: { gedcomx: {
      sourceDescriptions: [{ id: "mainSrc", about: "#primaryPerson" }],
      persons: [{
        id: "primaryPerson",
        gender: { type: "http://gedcomx.org/Male" },
        names: [{ preferred: true, type: "http://gedcomx.org/BirthName",
          nameForms: [{ fullText: "Johann Georg Hufenreuter",
            parts: [
              { type: "http://gedcomx.org/Given", value: "Johann Georg" },
              { type: "http://gedcomx.org/Surname", value: "Hufenreuter" }
            ]}]}],
        facts: [{ type: "http://gedcomx.org/Birth",
          date: { original: "11Jan1758", formal: "+1758-01-11" },
          place: { original: "Biesenrode, Schsn, Prss" }}],
        identifiers: { "http://gedcomx.org/Persistent":
          ["https://familysearch.org/ark:/61903/4:1:KGS8-LY1"] }
      }]
    }}},
    { content: { gedcomx: {
      sourceDescriptions: [{ id: "mainSrc", about: "#primaryPerson" }],
      persons: [{
        id: "primaryPerson",
        gender: { type: "http://gedcomx.org/Male" },
        names: [{ preferred: true, type: "http://gedcomx.org/BirthName",
          nameForms: [{ fullText: "Johann Georg Hufenreuter",
            parts: [
              { type: "http://gedcomx.org/Given", value: "Johann Georg" },
              { type: "http://gedcomx.org/Surname", value: "Hufenreuter" }
            ]}]}],
        facts: [{ type: "http://gedcomx.org/Birth",
          date: { original: "11Jan1758", formal: "+1758-01-11" },
          place: { original: "Biesenrode, Schsn, Prss" }}],
        identifiers: { "http://gedcomx.org/Persistent":
          ["https://familysearch.org/ark:/61903/4:1:KCWM-J9H"] }
      }]
    }}}
  ]
});

for (const mc of [0, 2, 5, 6, 10, 20]) {
  console.log(`\n==== minConfidence=${mc}`);
  const res = await fetch(`${BASE_URL}?minConfidence=${mc}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": BROWSER_USER_AGENT,
    },
    body: BODY,
  });
  console.log(`Status: ${res.status}`);
  console.log(await res.text());
}

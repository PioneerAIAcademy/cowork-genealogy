/// <reference types="node" />
/**
 * Probe — non-match case.
 *
 * Entry 1: Johann Georg Hufenreuter (b. 1758, Biesenrode).
 * Entry 2: Mary Smith (b. 1850, London) — completely unrelated.
 *
 * Expected: empty `entries[]` or `results: 0`. Tells us the response
 * shape when nothing matches.
 */
const TOKEN_RAW = process.env.FS_ACCESS_TOKEN;
if (!TOKEN_RAW) {
  console.error("Set FS_ACCESS_TOKEN");
  process.exit(1);
}
const TOKEN = TOKEN_RAW.startsWith("Bearer ") ? TOKEN_RAW.slice(7) : TOKEN_RAW;

const URL =
  "https://www.familysearch.org/service/search/record/collections/match/matchTwoExamples?minConfidence=2";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

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
        gender: { type: "http://gedcomx.org/Female" },
        names: [{ preferred: true, type: "http://gedcomx.org/BirthName",
          nameForms: [{ fullText: "Mary Smith",
            parts: [
              { type: "http://gedcomx.org/Given", value: "Mary" },
              { type: "http://gedcomx.org/Surname", value: "Smith" }
            ]}]}],
        facts: [{ type: "http://gedcomx.org/Birth",
          date: { original: "15 March 1850", formal: "+1850-03-15" },
          place: { original: "London, England" }}],
        identifiers: { "http://gedcomx.org/Persistent":
          ["https://familysearch.org/ark:/61903/4:1:NONMATCH-TEST"] }
      }]
    }}}
  ]
});

const res = await fetch(URL, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": UA,
  },
  body: BODY,
});
console.log(`Status: ${res.status}`);
console.log(await res.text());

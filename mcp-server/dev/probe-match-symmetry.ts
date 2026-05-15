/// <reference types="node" />
/**
 * Probe — symmetry test.
 *
 * Sends two POSTs back-to-back with the same Hufenreuter pair, just
 * swapped: A = [entry1, entry2], B = [entry2, entry1].
 *
 * Things to compare:
 *   - `title` (always references entries[0]) — should flip
 *   - `entries[].id` (the candidate ARK) — should flip
 *   - `score` and `confidence` — same or different?
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

function hufenreuter(ark: string) {
  return {
    content: { gedcomx: {
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
          [`https://familysearch.org/ark:/61903/4:1:${ark}`] }
      }]
    }}
  };
}

async function call(label: string, entries: object[]): Promise<void> {
  console.log(`\n==== ${label}`);
  const res = await fetch(URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": UA,
    },
    body: JSON.stringify({ entries }),
  });
  console.log(`Status: ${res.status}`);
  console.log(await res.text());
}

await call("A — [LY1, J9H] original order", [hufenreuter("KGS8-LY1"), hufenreuter("KCWM-J9H")]);
await call("B — [J9H, LY1] swapped",         [hufenreuter("KCWM-J9H"), hufenreuter("KGS8-LY1")]);

/// <reference types="node" />
/**
 * Probe — focus-only (no parent context).
 *
 * Same Hufenreuter pair as baseline but with parents and ParentChild
 * relationships removed. Each entry contains ONLY the focus person.
 *
 * Question: does the API still match? If yes, how much does the
 * confidence/score drop compared to the baseline (which includes
 * parent context)?
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

function focusOnly(ark: string) {
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
      // NO relationships, NO parents
    }}
  };
}

const res = await fetch(URL, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": UA,
  },
  body: JSON.stringify({ entries: [focusOnly("KGS8-LY1"), focusOnly("KCWM-J9H")] }),
});
console.log(`Status: ${res.status}`);
console.log(await res.text());

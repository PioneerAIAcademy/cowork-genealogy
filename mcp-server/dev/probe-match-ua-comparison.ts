/// <reference types="node" />
/**
 * Back-to-back A/B confirmation: identical request, only the User-Agent
 * differs. Proves the UA is the sole variable controlling WAF behavior.
 */
import { BROWSER_USER_AGENT } from "../src/constants.js";

const TOKEN = process.env.FS_ACCESS_TOKEN;
if (!TOKEN) {
  console.error("Set FS_ACCESS_TOKEN");
  process.exit(1);
}

const URL =
  "https://www.familysearch.org/service/search/record/collections/match/matchTwoExamples?minConfidence=2";

const ISSUE_UA = "fs-search-agent";

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

async function call(ua: string, label: string): Promise<void> {
  console.log(`\n==== ${label}`);
  console.log(`User-Agent: ${ua}`);
  const res = await fetch(URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": ua,
    },
    body: BODY,
  });
  const text = await res.text();
  console.log(`Status: ${res.status} ${res.statusText}`);
  console.log(`Body (${text.length} bytes):`);
  console.log(text.slice(0, 500));
}

// A: the UA the issue suggested
await call(ISSUE_UA, "A — UA = 'fs-search-agent'");
// B: the UA collections/search use today in production
await call(BROWSER_USER_AGENT, "B — UA = Mozilla browser");

/// <reference types="node" />
/**
 * A/B test: does the simplifier's lossy round-trip still produce a payload
 * the matchTwoExamples API accepts?
 *
 *   Call A — POST the raw round-trip output (no identifiers, no
 *            sourceDescriptions). Tells us if the losses matter.
 *
 *   Call B — POST the round-trip + minimal enrichment
 *            (add identifiers back + add sourceDescription with about
 *            anchor). Should reproduce our baseline result.
 *
 * Compare with the original baseline:
 *   entries[0]: { confidence: 5, id: ".../KCWM-J9H", score: ~0.9998 }
 *   title: "Matches for ark:/61903/4:1:KGS8-LY1"
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

// ── Helpers ────────────────────────────────────────────────────────────────

function makePerson(opts: {
  id: string;
  ark: string;
  given: string;
  surname?: string;
  gender: "Male" | "Female";
  birthDate: { original: string; formal: string };
  birthPlace: string;
  burialDate?: { original: string; formal: string };
  burialPlace?: string;
}): any {
  const facts: any[] = [
    {
      type: "http://gedcomx.org/Birth",
      date: opts.birthDate,
      place: { original: opts.birthPlace },
    },
  ];
  if (opts.burialDate && opts.burialPlace) {
    facts.push({
      type: "http://gedcomx.org/Burial",
      date: opts.burialDate,
      place: { original: opts.burialPlace },
    });
  }
  const parts: any[] = [
    { type: "http://gedcomx.org/Given", value: opts.given },
  ];
  if (opts.surname) {
    parts.push({ type: "http://gedcomx.org/Surname", value: opts.surname });
  }
  return {
    id: opts.id,
    gender: { type: `http://gedcomx.org/${opts.gender}` },
    names: [{
      preferred: true,
      type: "http://gedcomx.org/BirthName",
      nameForms: [{
        fullText: `${opts.given}${opts.surname ? " " + opts.surname : ""}`,
        parts,
      }],
    }],
    facts,
    identifiers: { "http://gedcomx.org/Persistent": [opts.ark] },
  };
}

// Build raw GedcomX for one entry (focus + parents).
function buildEntry(focusArk: string, fatherArk: string, motherArk: string): GedcomX {
  return {
    persons: [
      makePerson({
        id: "primary", ark: focusArk, given: "Johann Georg", surname: "Hufenreuter",
        gender: "Male",
        birthDate: { original: "11Jan1758", formal: "+1758-01-11" },
        birthPlace: "Biesenrode, Schsn, Prss",
      }),
      makePerson({
        id: "father", ark: fatherArk, given: "Johann Tobias", surname: "Hufenreuter",
        gender: "Male",
        birthDate: { original: "16Mar1721", formal: "+1721-03-16" },
        birthPlace: "Biesenrode, Schsn, Prss",
      }),
      makePerson({
        id: "mother", ark: motherArk, given: "Elisabeth Henrica Dorothea",
        gender: "Female",
        birthDate: { original: "1720", formal: "+1720" },
        birthPlace: "Biesenrode, Schsn, Prss",
        burialDate: { original: "16May1780", formal: "+1780-05-16" },
        burialPlace: "Biesenrode, Schsn, Prss",
      }),
    ],
    relationships: [
      {
        type: "http://gedcomx.org/ParentChild",
        person1: { resource: "#father" } as any,
        person2: { resource: "#primary" } as any,
      },
      {
        type: "http://gedcomx.org/ParentChild",
        person1: { resource: "#mother" } as any,
        person2: { resource: "#primary" } as any,
      },
    ],
  };
}

// Round-trip the GedcomX through the simplifier. Returns the lossy output.
function roundTrip(raw: GedcomX): GedcomX {
  return toGedcomX(toSimplified(raw));
}

// Enrich the round-tripped GedcomX: re-add identifiers per person + add
// the matchTwoExamples-style sourceDescription anchor.
function enrich(
  gedcomx: GedcomX,
  arksById: Record<string, string>,
  primaryId: string,
): GedcomX {
  const out = JSON.parse(JSON.stringify(gedcomx)) as any;
  if (Array.isArray(out.persons)) {
    for (const p of out.persons) {
      const ark = arksById[p.id];
      if (ark) {
        p.identifiers = { "http://gedcomx.org/Persistent": [ark] };
      }
    }
  }
  out.sourceDescriptions = [
    { id: "mainSrc", about: "#" + primaryId },
  ];
  return out;
}

// POST a {entries: [...]} body and print the response.
async function callApi(label: string, entries: object[]): Promise<void> {
  console.log(`\n══════════════════════════════════════════════════════════════════`);
  console.log(label);
  console.log(`══════════════════════════════════════════════════════════════════`);
  const res = await fetch(URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": BROWSER_USER_AGENT,
    },
    body: JSON.stringify({ entries }),
  });
  console.log(`Status: ${res.status}`);
  console.log(await res.text());
}

// ── Build the entries ──────────────────────────────────────────────────────

const QUERY_ARK   = "https://familysearch.org/ark:/61903/4:1:KGS8-LY1";
const QUERY_FATHER = "https://familysearch.org/ark:/61903/4:1:KGS8-LY7";
const QUERY_MOTHER = "https://familysearch.org/ark:/61903/4:1:KGS8-LYC";

const CAND_ARK    = "https://familysearch.org/ark:/61903/4:1:KCWM-J9H";
const CAND_FATHER = "https://familysearch.org/ark:/61903/4:1:KDBD-Y1Q";
const CAND_MOTHER = "https://familysearch.org/ark:/61903/4:1:KH11-B46";

const rawQuery     = buildEntry(QUERY_ARK,    QUERY_FATHER, QUERY_MOTHER);
const rawCandidate = buildEntry(CAND_ARK,     CAND_FATHER,  CAND_MOTHER);

const arksQuery = {
  primary: QUERY_ARK, father: QUERY_FATHER, mother: QUERY_MOTHER,
};
const arksCand = {
  primary: CAND_ARK, father: CAND_FATHER, mother: CAND_MOTHER,
};

// Round-tripped (lossy) versions
const rtQuery     = roundTrip(rawQuery);
const rtCandidate = roundTrip(rawCandidate);

// Enriched versions (round-trip + identifiers + sourceDescriptions added back)
const enrichedQuery     = enrich(rtQuery,     arksQuery, "primary");
const enrichedCandidate = enrich(rtCandidate, arksCand,  "primary");

// ── Run the two calls ──────────────────────────────────────────────────────

await callApi(
  "CALL A — round-trip only (NO identifiers, NO sourceDescriptions)",
  [
    { content: { gedcomx: rtQuery } },
    { content: { gedcomx: rtCandidate } },
  ],
);

await callApi(
  "CALL B — round-trip + enrichment (identifiers + sourceDescriptions added)",
  [
    { content: { gedcomx: enrichedQuery } },
    { content: { gedcomx: enrichedCandidate } },
  ],
);

console.log(`\n══════════════════════════════════════════════════════════════════`);
console.log("BASELINE for comparison (from our earlier original-payload probe):");
console.log('  entries[0]: { confidence: 5, id: "...KCWM-J9H", score: ~0.9998 }');
console.log('  title: "Matches for ark:/61903/4:1:KGS8-LY1"');
console.log(`══════════════════════════════════════════════════════════════════`);

/// <reference types="node" />
/**
 * Round-trip a richer GedcomX payload through the simplifier.
 *
 * This input has:
 *   - 3 persons with short IDs (I1, I2, I3)
 *   - Names with source references and qualifiers
 *   - Facts with source references
 *   - Two ParentChild relationships and one Couple (with marriage fact)
 *   - 3 sourceDescriptions with titles + citations
 *
 * Question: when the input is structurally rich, what does the simplifier
 * preserve, drop, and transform?
 *
 * NOTE: this input has NO `identifiers["http://gedcomx.org/Persistent"]`
 *       (ARK URLs) and NO `sourceDescriptions[].about` anchor — different
 *       from a matchTwoExamples-style payload. So it tells us about source
 *       plumbing round-trip, not about matchTwoExamples-specific fields.
 */
import { toSimplified, toGedcomX } from "../src/utils/gedcomx-convert.js";
import type { GedcomX } from "../src/types/gedcomx.js";

const raw: GedcomX = {
  persons: [
    {
      id: "I1",
      gender: { type: "http://gedcomx.org/Male" },
      names: [
        {
          id: "N1",
          preferred: true,
          type: "http://gedcomx.org/BirthName",
          nameForms: [{
            fullText: "John Doe",
            parts: [
              { type: "http://gedcomx.org/Given", value: "John" },
              { type: "http://gedcomx.org/Surname", value: "Doe" },
            ],
          }],
          sources: [{
            description: "#S1",
            qualifiers: [
              { name: "http://gedcomx.org/CitationDetail", value: "1920 Census, Denver, ED 47" },
            ],
          }],
        } as any,
        {
          id: "N2",
          type: "http://gedcomx.org/AlsoKnownAs",
          nameForms: [{
            fullText: "Jonathan Doe",
            parts: [
              { type: "http://gedcomx.org/Given", value: "Jonathan" },
              { type: "http://gedcomx.org/Surname", value: "Doe" },
            ],
          }],
          sources: [{
            description: "#S2",
            qualifiers: [
              { name: "http://gedcomx.org/CitationDetail", value: "Death certificate no. 4521" },
            ],
          }],
        } as any,
      ],
      facts: [{
        id: "F1",
        type: "http://gedcomx.org/Birth",
        date: { original: "1900", formal: "+1900" },
        place: { original: "Denver, Colorado, USA" },
        sources: [{
          description: "#S1",
          qualifiers: [
            { name: "http://gedcomx.org/CitationDetail", value: "1920 Census, Denver, ED 47" },
          ],
        }],
      }] as any,
    } as any,
    {
      id: "I2",
      gender: { type: "http://gedcomx.org/Male" },
      names: [{
        preferred: true,
        nameForms: [{
          fullText: "Frank Doe",
          parts: [
            { type: "http://gedcomx.org/Given", value: "Frank" },
            { type: "http://gedcomx.org/Surname", value: "Doe" },
          ],
        }],
      }],
    } as any,
    {
      id: "I3",
      gender: { type: "http://gedcomx.org/Female" },
      names: [{
        preferred: true,
        nameForms: [{
          fullText: "Sally Smith",
          parts: [
            { type: "http://gedcomx.org/Given", value: "Sally" },
            { type: "http://gedcomx.org/Surname", value: "Smith" },
          ],
        }],
      }],
    } as any,
  ],
  relationships: [
    {
      id: "R1",
      type: "http://gedcomx.org/ParentChild",
      person1: { resource: "#I2" },
      person2: { resource: "#I1" },
      sources: [{
        description: "#S1",
        qualifiers: [
          { name: "http://gedcomx.org/CitationDetail", value: "1920 Census, Denver, ED 47" },
        ],
      }],
    } as any,
    {
      id: "R2",
      type: "http://gedcomx.org/ParentChild",
      person1: { resource: "#I3" },
      person2: { resource: "#I1" },
      sources: [{
        description: "#S1",
        qualifiers: [
          { name: "http://gedcomx.org/CitationDetail", value: "1920 Census, Denver, ED 47" },
        ],
      }],
    } as any,
    {
      id: "R3",
      type: "http://gedcomx.org/Couple",
      person1: { resource: "#I2" },
      person2: { resource: "#I3" },
      facts: [{
        type: "http://gedcomx.org/Marriage",
        date: { original: "1898", formal: "+1898" },
        place: { original: "Denver, Colorado, USA" },
        sources: [{
          description: "#S3",
          qualifiers: [
            { name: "http://gedcomx.org/CitationDetail", value: "Marriage license, Denver County" },
          ],
        }],
      }] as any,
    } as any,
  ],
  sourceDescriptions: [
    {
      id: "S1",
      citations: [{ value: "1910 United States Federal Census. National Archives and Records Administration." }],
      titles: [{ value: "1910 U.S. Federal Census" }],
    } as any,
    {
      id: "S2",
      citations: [{ value: "Utah Death Certificates, 1904-1965. Utah State Archives." }],
      titles: [{ value: "Utah Death Certificates" }],
    } as any,
    {
      id: "S3",
      citations: [{ value: "Denver County Marriage Records. Colorado State Archives." }],
      titles: [{ value: "Denver County Marriage Records" }],
    } as any,
  ],
};

console.log("══ STEP 1 — ORIGINAL GedcomX");
console.log("═══════════════════════════════════════════════════════════════");
console.log(JSON.stringify(raw, null, 2));

const simplified = toSimplified(raw);
console.log("\n══ STEP 2 — SIMPLIFIED");
console.log("═══════════════════════════════════════════════════════════════");
console.log(JSON.stringify(simplified, null, 2));

const rt = toGedcomX(simplified);
console.log("\n══ STEP 3 — ROUND-TRIPPED back to GedcomX");
console.log("═══════════════════════════════════════════════════════════════");
console.log(JSON.stringify(rt, null, 2));

// Verdict
console.log("\n══ VERDICT");
console.log("═══════════════════════════════════════════════════════════════");

const personCount = rt.persons?.length ?? 0;
const namesPreserved = rt.persons?.[0]?.names?.length ?? 0;
const factsPreserved = (rt.persons?.[0] as any)?.facts?.length ?? 0;
const relCount = rt.relationships?.length ?? 0;
const coupleRel = rt.relationships?.find((r: any) => r.type?.endsWith("/Couple"));
const coupleHasFacts = Array.isArray((coupleRel as any)?.facts) && (coupleRel as any).facts.length > 0;
const sourceDescCount = rt.sourceDescriptions?.length ?? 0;
const nameRefsPreserved = (rt.persons?.[0]?.names?.[0] as any)?.sources?.length ?? 0;
const factRefsPreserved = ((rt.persons?.[0] as any)?.facts?.[0] as any)?.sources?.length ?? 0;
const relRefsPreserved = (rt.relationships?.[0] as any)?.sources?.length ?? 0;
const qualifiersPreserved = (rt.persons?.[0]?.names?.[0] as any)?.sources?.[0]?.qualifiers?.length ?? 0;

console.log(`  persons preserved:                   ${personCount} (was 3)`);
console.log(`  I1 names preserved:                  ${namesPreserved} (was 2: BirthName + AlsoKnownAs)`);
console.log(`  I1 facts preserved:                  ${factsPreserved} (was 1: Birth)`);
console.log(`  relationships preserved:             ${relCount} (was 3: 2 ParentChild + 1 Couple)`);
console.log(`  Couple has its own facts preserved:  ${coupleHasFacts ? "✅ YES" : "❌ NO"} (was 1: Marriage)`);
console.log(`  sourceDescriptions preserved:        ${sourceDescCount} (was 3)`);
console.log(`  source-refs on I1's BirthName:       ${nameRefsPreserved}`);
console.log(`  source-refs on I1's Birth fact:      ${factRefsPreserved}`);
console.log(`  source-refs on R1 (parent-child):    ${relRefsPreserved}`);
console.log(`  Citation-detail qualifier preserved: ${qualifiersPreserved > 0 ? "✅ YES" : "❌ NO"}`);

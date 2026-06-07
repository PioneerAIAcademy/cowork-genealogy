import { toGedcomX, toSimplified } from "../src/utils/gedcomx-convert.js";
import type { GedcomX } from "../src/types/gedcomx.js";

// Turner family — the worked example from
// docs/specs/gedcomx-convert-spec.md.
const turner: GedcomX = {
  places: [
    {
      id: "place1",
      names: [{ value: "Liverpool, England, United Kingdom" }],
      latitude: 53.4084,
      longitude: -2.9916,
    },
  ],
  sourceDescriptions: [
    {
      id: "sd1",
      titles: [{ value: "Turner Family Bible" }],
      citations: [{ value: "Turner Family Bible, Liverpool, England, 1900" }],
    },
  ],
  persons: [
    {
      id: "p1",
      gender: { type: "http://gedcomx.org/Male" },
      names: [
        {
          type: "http://gedcomx.org/BirthName",
          nameForms: [{ fullText: "William Turner" }],
        },
      ],
      facts: [
        {
          type: "http://gedcomx.org/Birth",
          date: { original: "15 June 1850", formal: "+1850-06-15" },
          place: { original: "Liverpool, England", description: "#place1" },
        },
      ],
      sources: [{ description: "#sd1" }],
    },
    {
      id: "p2",
      gender: { type: "http://gedcomx.org/Female" },
      names: [
        {
          type: "http://gedcomx.org/BirthName",
          nameForms: [{ fullText: "Elizabeth Turner" }],
        },
      ],
      facts: [
        {
          type: "http://gedcomx.org/Birth",
          date: { original: "3 March 1855", formal: "+1855-03-03" },
          place: { original: "Manchester, England" },
        },
      ],
      sources: [{ description: "#sd1" }],
    },
    {
      id: "p3",
      gender: { type: "http://gedcomx.org/Male" },
      names: [
        {
          type: "http://gedcomx.org/BirthName",
          nameForms: [{ fullText: "James Turner" }],
        },
      ],
      facts: [
        {
          type: "http://gedcomx.org/Birth",
          date: { original: "12 February 1878" },
          place: { original: "Liverpool, England" },
        },
      ],
    },
  ],
  relationships: [
    {
      type: "http://gedcomx.org/Couple",
      person1: { resource: "#p1" },
      person2: { resource: "#p2" },
      facts: [
        {
          type: "http://gedcomx.org/Marriage",
          date: { original: "20 April 1875", formal: "+1875-04-20" },
        },
      ],
    },
    {
      type: "http://gedcomx.org/ParentChild",
      person1: { resource: "#p1" },
      person2: { resource: "#p3" },
      facts: [{ type: "http://gedcomx.org/AdoptiveParent" }],
      notes: [
        { text: "Adoption recorded in parish register, 1879." },
      ],
    },
    {
      type: "http://gedcomx.org/ParentChild",
      person1: { resource: "#p2" },
      person2: { resource: "#p3" },
      facts: [{ type: "http://gedcomx.org/StepParent" }],
    },
  ],
};

const simplified = toSimplified(turner);
const roundTripped = toGedcomX(simplified);

console.log("=== Input GedcomX Raw ===");
console.log(JSON.stringify(turner, null, 2));

console.log("\n=== Simplified GedcomX ===");
console.log(JSON.stringify(simplified, null, 2));

console.log("\n=== Round-tripped GedcomX Raw ===");
console.log(JSON.stringify(roundTripped, null, 2));

import { describe, it, expect } from "vitest";
import { toSimplified, toGedcomX } from "../../src/utils/gedcomx-convert.js";
import type {
  GedcomX,
  SimplifiedGedcomX,
} from "../../src/types/gedcomx.js";

// Turner family — the worked example from the spec.
const turnerGedcomX: GedcomX = {
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
  ],
};

const turnerSimplified: SimplifiedGedcomX = {
  persons: [
    {
      id: "p1",
      gender: "Male",
      names: [
        {
          preferred: true,
          type: "BirthName",
          given: "William",
          surname: "Turner",
        },
      ],
      facts: [
        {
          type: "Birth",
          primary: true,
          date: "15 June 1850",
          place: "Liverpool, England",
        },
      ],
      sources: [{ ref: "sd1" }],
    },
    {
      id: "p2",
      gender: "Female",
      names: [
        {
          preferred: true,
          type: "BirthName",
          given: "Elizabeth",
          surname: "Turner",
        },
      ],
      facts: [
        {
          type: "Birth",
          primary: true,
          date: "3 March 1855",
          place: "Manchester, England",
        },
      ],
      sources: [{ ref: "sd1" }],
    },
  ],
  relationships: [
    {
      type: "Couple",
      person1: "p1",
      person2: "p2",
      facts: [
        {
          type: "Marriage",
          primary: true,
          date: "20 April 1875",
        },
      ],
    },
  ],
  places: [
    {
      id: "place1",
      name: "Liverpool, England, United Kingdom",
      latitude: 53.4084,
      longitude: -2.9916,
    },
  ],
  sources: [
    {
      id: "sd1",
      title: "Turner Family Bible",
      citation: "Turner Family Bible, Liverpool, England, 1900",
    },
  ],
};

describe("gedcomx-convert — worked example", () => {
  // Test 1
  it("toSimplified produces the expected Turner output", () => {
    expect(toSimplified(turnerGedcomX)).toEqual(turnerSimplified);
  });

  // Test 2
  it("toGedcomX(toSimplified(turner)) round-trips surviving fields", () => {
    const roundTripped = toGedcomX(toSimplified(turnerGedcomX));

    expect(roundTripped.persons).toHaveLength(2);
    expect(roundTripped.persons?.[0].id).toBe("p1");
    expect(roundTripped.persons?.[0].gender).toEqual({
      type: "http://gedcomx.org/Male",
    });
    expect(roundTripped.persons?.[0].names?.[0].type).toBe(
      "http://gedcomx.org/BirthName",
    );
    expect(roundTripped.persons?.[0].names?.[0].nameForms?.[0].fullText).toBe(
      "William Turner",
    );
    expect(roundTripped.persons?.[0].facts?.[0].type).toBe(
      "http://gedcomx.org/Birth",
    );
    expect(roundTripped.persons?.[0].facts?.[0].date?.original).toBe(
      "15 June 1850",
    );
    expect(roundTripped.persons?.[0].facts?.[0].date?.formal).toBeUndefined();
    expect(roundTripped.relationships?.[0].type).toBe(
      "http://gedcomx.org/Couple",
    );
    expect(roundTripped.relationships?.[0].person1?.resource).toBe("#p1");
    expect(roundTripped.sourceDescriptions?.[0].id).toBe("sd1");
  });
});

describe("gedcomx-convert — transformation rules", () => {
  // Test 3 — Rule 1: URI prefix
  it("strips http://gedcomx.org/ prefix from type fields", () => {
    const result = toSimplified({
      persons: [
        {
          id: "p1",
          gender: { type: "http://gedcomx.org/Male" },
          names: [
            {
              type: "http://gedcomx.org/BirthName",
              nameForms: [{ fullText: "John Doe" }],
            },
          ],
          facts: [{ type: "http://gedcomx.org/Birth" }],
        },
      ],
      relationships: [
        {
          type: "http://gedcomx.org/ParentChild",
          person1: { resource: "#p2" },
          person2: { resource: "#p1" },
        },
      ],
    });
    expect(result.persons?.[0].gender).toBe("Male");
    expect(result.persons?.[0].names?.[0].type).toBe("BirthName");
    expect(result.persons?.[0].facts?.[0].type).toBe("Birth");
    expect(result.relationships?.[0].type).toBe("ParentChild");
  });

  // Test 4 — Rule 2: Gender Unknown
  it("produces gender 'Unknown' for unrecognized gender URIs", () => {
    const result = toSimplified({
      persons: [
        {
          id: "p1",
          gender: { type: "http://example.org/Other" },
        },
      ],
    });
    expect(result.persons?.[0].gender).toBe("Unknown");
  });

  // Test 5 — Rule 3 primary: parts present
  it("extracts given/surname from nameForms[0].parts when present", () => {
    const result = toSimplified({
      persons: [
        {
          id: "p1",
          names: [
            {
              nameForms: [
                {
                  parts: [
                    { type: "http://gedcomx.org/Given", value: "John" },
                    { type: "http://gedcomx.org/Surname", value: "Doe" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(result.persons?.[0].names?.[0].given).toBe("John");
    expect(result.persons?.[0].names?.[0].surname).toBe("Doe");
  });

  // Test 6 — Rule 3 fallback: fullText only
  it("extracts given/surname from fullText when parts is missing", () => {
    const result = toSimplified({
      persons: [
        {
          id: "p1",
          names: [{ nameForms: [{ fullText: "William Henry Turner" }] }],
        },
      ],
    });
    expect(result.persons?.[0].names?.[0].given).toBe("William Henry");
    expect(result.persons?.[0].names?.[0].surname).toBe("Turner");
  });

  // Test 7 — Rule 3 mononym
  it("handles mononyms — single token goes to surname, given is empty", () => {
    const result = toSimplified({
      persons: [{ id: "p1", names: [{ nameForms: [{ fullText: "Plato" }] }] }],
    });
    expect(result.persons?.[0].names?.[0].given).toBe("");
    expect(result.persons?.[0].names?.[0].surname).toBe("Plato");
  });

  // Test 8 — Rule 4: preferred
  it("only the first name gets preferred: true; others have no preferred field", () => {
    const result = toSimplified({
      persons: [
        {
          id: "p1",
          names: [
            { nameForms: [{ fullText: "John Doe" }] },
            { nameForms: [{ fullText: "Johnny Doe" }] },
            { nameForms: [{ fullText: "J. Doe" }] },
          ],
        },
      ],
    });
    const names = result.persons?.[0].names ?? [];
    expect(names[0].preferred).toBe(true);
    expect("preferred" in names[1]).toBe(false);
    expect("preferred" in names[2]).toBe(false);
  });

  // Test 9 — Rule 5: primary
  it("only the first fact gets primary: true; others have no primary field", () => {
    const result = toSimplified({
      persons: [
        {
          id: "p1",
          facts: [
            { type: "http://gedcomx.org/Birth" },
            { type: "http://gedcomx.org/Death" },
            { type: "http://gedcomx.org/Burial" },
          ],
        },
      ],
    });
    const facts = result.persons?.[0].facts ?? [];
    expect(facts[0].primary).toBe(true);
    expect("primary" in facts[1]).toBe(false);
    expect("primary" in facts[2]).toBe(false);
  });

  // Test 10 — Rule 6: date.formal dropped
  it("drops date.formal; only date.original surfaces as date", () => {
    const result = toSimplified({
      persons: [
        {
          id: "p1",
          facts: [
            {
              type: "http://gedcomx.org/Birth",
              date: { original: "1900", formal: "+1900" },
            },
          ],
        },
      ],
    });
    expect(result.persons?.[0].facts?.[0].date).toBe("1900");
  });

  // Test 11 — Rule 7: place.description dropped
  it("drops place.description on simplification", () => {
    const result = toSimplified({
      persons: [
        {
          id: "p1",
          facts: [
            {
              type: "http://gedcomx.org/Birth",
              place: {
                original: "Denver, Colorado, USA",
                description: "#place1",
              },
            },
          ],
        },
      ],
    });
    expect(result.persons?.[0].facts?.[0].place).toBe(
      "Denver, Colorado, USA",
    );
  });

  // Test 12 — Rule 8: ParentChild round-trip
  it("round-trips ParentChild as parent/child", () => {
    const input: GedcomX = {
      relationships: [
        {
          type: "http://gedcomx.org/ParentChild",
          person1: { resource: "#I2" },
          person2: { resource: "#I1" },
        },
      ],
    };
    const simplified = toSimplified(input);
    expect(simplified.relationships?.[0].type).toBe("ParentChild");
    expect(simplified.relationships?.[0].parent).toBe("I2");
    expect(simplified.relationships?.[0].child).toBe("I1");

    const roundTripped = toGedcomX(simplified);
    expect(roundTripped.relationships?.[0].type).toBe(
      "http://gedcomx.org/ParentChild",
    );
    expect(roundTripped.relationships?.[0].person1?.resource).toBe("#I2");
    expect(roundTripped.relationships?.[0].person2?.resource).toBe("#I1");
  });

  // Test 13 — Rule 9: Couple round-trip
  it("round-trips Couple as person1/person2", () => {
    const input: GedcomX = {
      relationships: [
        {
          type: "http://gedcomx.org/Couple",
          person1: { resource: "#I2" },
          person2: { resource: "#I3" },
        },
      ],
    };
    const simplified = toSimplified(input);
    expect(simplified.relationships?.[0].type).toBe("Couple");
    expect(simplified.relationships?.[0].person1).toBe("I2");
    expect(simplified.relationships?.[0].person2).toBe("I3");

    const roundTripped = toGedcomX(simplified);
    expect(roundTripped.relationships?.[0].person1?.resource).toBe("#I2");
    expect(roundTripped.relationships?.[0].person2?.resource).toBe("#I3");
  });

  // Test 14 — Rule 10: CitationDetail → page; other qualifiers dropped
  it("maps CitationDetail qualifier to page; drops other unknown qualifiers", () => {
    const result = toSimplified({
      persons: [
        {
          id: "p1",
          sources: [
            {
              description: "#S1",
              qualifiers: [
                {
                  name: "http://gedcomx.org/CitationDetail",
                  value: "1920 Census, ED 47",
                },
                {
                  name: "http://example.org/SomeOther",
                  value: "ignored",
                },
              ],
            },
          ],
        },
      ],
    });
    expect(result.persons?.[0].sources?.[0].page).toBe("1920 Census, ED 47");
    expect(result.persons?.[0].sources?.[0].ref).toBe("S1");
  });

  // Test 15 — Rule 10: fsmcp:quality → quality
  it("maps fsmcp:quality qualifier to quality number; omits when absent", () => {
    const withQuality = toSimplified({
      persons: [
        {
          id: "p1",
          sources: [
            {
              description: "#S1",
              qualifiers: [{ name: "fsmcp:quality", value: "3" }],
            },
          ],
        },
      ],
    });
    expect(withQuality.persons?.[0].sources?.[0].quality).toBe(3);

    const withoutQuality = toSimplified({
      persons: [
        {
          id: "p1",
          sources: [{ description: "#S1" }],
        },
      ],
    });
    expect("quality" in (withoutQuality.persons?.[0].sources?.[0] ?? {})).toBe(
      false,
    );
  });

  // Test 16 — Rule 10: quality 0 never defaulted
  it("does not default quality to 0 when fsmcp:quality is absent", () => {
    const result = toSimplified({
      persons: [
        {
          id: "p1",
          sources: [
            {
              description: "#S1",
              qualifiers: [
                {
                  name: "http://gedcomx.org/CitationDetail",
                  value: "page 47",
                },
              ],
            },
          ],
        },
      ],
    });
    const sourceRef = result.persons?.[0].sources?.[0];
    expect(sourceRef?.quality).toBeUndefined();
    expect("quality" in (sourceRef ?? {})).toBe(false);
  });

  // Test 17 — Rule 11: source descriptions round-trip
  it("round-trips source descriptions with title, citation, url", () => {
    const input: GedcomX = {
      sourceDescriptions: [
        {
          id: "S1",
          titles: [{ value: "1910 U.S. Federal Census" }],
          citations: [{ value: "1910 United States Federal Census. NARA." }],
          about: "https://www.archives.gov/example",
        },
      ],
    };
    const simplified = toSimplified(input);
    expect(simplified.sources?.[0]).toEqual({
      id: "S1",
      title: "1910 U.S. Federal Census",
      citation: "1910 United States Federal Census. NARA.",
      url: "https://www.archives.gov/example",
    });

    const roundTripped = toGedcomX(simplified);
    expect(roundTripped.sourceDescriptions?.[0]).toEqual({
      id: "S1",
      titles: [{ value: "1910 U.S. Federal Census" }],
      citations: [{ value: "1910 United States Federal Census. NARA." }],
      about: "https://www.archives.gov/example",
    });
  });

  // Test 18 — Rule 12: places round-trip
  it("round-trips top-level places array", () => {
    const input: GedcomX = {
      places: [
        {
          id: "place1",
          names: [{ value: "Springfield, Illinois, United States" }],
          latitude: 39.7817,
          longitude: -89.6501,
        },
      ],
    };
    const simplified = toSimplified(input);
    expect(simplified.places?.[0]).toEqual({
      id: "place1",
      name: "Springfield, Illinois, United States",
      latitude: 39.7817,
      longitude: -89.6501,
    });

    const roundTripped = toGedcomX(simplified);
    expect(roundTripped.places?.[0]).toEqual({
      id: "place1",
      names: [{ value: "Springfield, Illinois, United States" }],
      latitude: 39.7817,
      longitude: -89.6501,
    });
  });

  // Test 19 — Rule 13: Census mapping
  it("toGedcomX maps Census fact type to Residence with fsmcp:event qualifier", () => {
    const simplified: SimplifiedGedcomX = {
      persons: [
        {
          id: "p1",
          facts: [{ type: "Census", primary: true }],
        },
      ],
    };
    const result = toGedcomX(simplified);
    const fact = result.persons?.[0].facts?.[0];
    expect(fact?.type).toBe("http://gedcomx.org/Residence");
    expect(fact?.sources).toBeUndefined();
    const censusQualifier = fact?.qualifiers?.find(
      (q) => q.name === "fsmcp:event",
    );
    expect(censusQualifier?.value).toBe("Census");
  });

  // Test 20 — Rule 14: IDs pass through verbatim
  it("passes IDs through verbatim and does not generate new ones", () => {
    const result = toSimplified({
      persons: [
        {
          id: "custom-id-99",
          names: [{ id: "name-x", nameForms: [{ fullText: "Joe Smith" }] }],
          facts: [{ id: "fact-z", type: "http://gedcomx.org/Birth" }],
        },
      ],
    });
    expect(result.persons?.[0].id).toBe("custom-id-99");
    expect(result.persons?.[0].names?.[0].id).toBe("name-x");
    expect(result.persons?.[0].facts?.[0].id).toBe("fact-z");

    // No ID generated when missing
    const noIds = toSimplified({
      persons: [
        {
          names: [{ nameForms: [{ fullText: "Anon Person" }] }],
          facts: [{ type: "http://gedcomx.org/Birth" }],
        },
      ],
    });
    expect(noIds.persons?.[0].id).toBeUndefined();
    expect(noIds.persons?.[0].names?.[0].id).toBeUndefined();
    expect(noIds.persons?.[0].facts?.[0].id).toBeUndefined();
  });
});

describe("gedcomx-convert — error handling and edge cases", () => {
  // Test 21
  it("returns {} on null / undefined input", () => {
    expect(toSimplified(null as unknown as GedcomX)).toEqual({});
    expect(toSimplified(undefined as unknown as GedcomX)).toEqual({});
    expect(toGedcomX(null as unknown as SimplifiedGedcomX)).toEqual({});
    expect(toGedcomX(undefined as unknown as SimplifiedGedcomX)).toEqual({});
  });

  // Test 22
  it("preserves persons with no names in the output", () => {
    const result = toSimplified({
      persons: [{ id: "p1", gender: { type: "http://gedcomx.org/Male" } }],
    });
    expect(result.persons).toHaveLength(1);
    expect(result.persons?.[0].id).toBe("p1");
    expect(result.persons?.[0].gender).toBe("Male");
    expect(result.persons?.[0].names).toBeUndefined();
  });

  // Test 23
  it("does not throw on malformed gender (string instead of object)", () => {
    expect(() =>
      toSimplified({
        persons: [
          { id: "p1", gender: "Male" as unknown as { type: string } },
        ],
      }),
    ).not.toThrow();
  });

  // Test 24
  it("omits empty top-level arrays from output", () => {
    const result = toSimplified({
      persons: [],
      relationships: [],
      sourceDescriptions: [],
      places: [],
    });
    expect(result).toEqual({});
  });

  // Test 25
  it("never emits preferred: false or primary: false", () => {
    const json = JSON.stringify(toSimplified(turnerGedcomX));
    expect(json).not.toContain('"preferred":false');
    expect(json).not.toContain('"primary":false');

    // Multi-name / multi-fact case explicit
    const multi = toSimplified({
      persons: [
        {
          id: "p1",
          names: [
            { nameForms: [{ fullText: "A B" }] },
            { nameForms: [{ fullText: "C D" }] },
          ],
          facts: [
            { type: "http://gedcomx.org/Birth" },
            { type: "http://gedcomx.org/Death" },
          ],
        },
      ],
    });
    const multiJson = JSON.stringify(multi);
    expect(multiJson).not.toContain('"preferred":false');
    expect(multiJson).not.toContain('"primary":false');
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { toSimplified, toSimplifiedRecordRead, toGedcomX } from "../../src/utils/gedcomx-convert.js";
import { censusStatedRelationships, extractRecord } from "../../src/utils/record-extract.js";
import type {
  GedcomX,
  GedcomXFact,
  GedcomXPerson,
  SimplifiedFact,
  SimplifiedGedcomX,
} from "../../src/types/gedcomx.js";

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
});

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
        { type: "BirthName", given: "William", surname: "Turner" },
      ],
      facts: [
        {
          type: "Birth",
          date: "15 June 1850",
          standard_date: "15 Jun 1850",
          place: "Liverpool, England",
        },
      ],
      sources: [{ ref: "sd1" }],
    },
    {
      id: "p2",
      gender: "Female",
      names: [
        { type: "BirthName", given: "Elizabeth", surname: "Turner" },
      ],
      facts: [
        {
          type: "Birth",
          date: "3 March 1855",
          standard_date: "3 Mar 1855",
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
      facts: [{ type: "Marriage", date: "20 April 1875", standard_date: "20 Apr 1875" }],
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
});

describe("gedcomx-convert — transformation rules", () => {
  // Test 2 — Rule 1: URI prefix
  it("strips http://gedcomx.org/ prefix from type fields", () => {
    const result = toSimplified({
      persons: [
        {
          id: "p1",
          gender: { type: "http://gedcomx.org/Male" },
          names: [
            {
              type: "http://gedcomx.org/BirthName",
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

  // Test 3 — Rule 2: Gender Unknown
  it("produces gender 'Unknown' for unrecognized gender URIs", () => {
    const result = toSimplified({
      persons: [
        { id: "p1", gender: { type: "http://example.org/Other" } },
      ],
    });
    expect(result.persons?.[0].gender).toBe("Unknown");
  });

  // Test 4 — Rule 3 primary: all four part types
  it("extracts Prefix, Given, Surname, and Suffix from parts when present", () => {
    const result = toSimplified({
      persons: [
        {
          id: "p1",
          names: [
            {
              nameForms: [
                {
                  parts: [
                    { type: "http://gedcomx.org/Prefix", value: "Dr." },
                    { type: "http://gedcomx.org/Given", value: "John" },
                    { type: "http://gedcomx.org/Surname", value: "Doe" },
                    { type: "http://gedcomx.org/Suffix", value: "Jr." },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const name = result.persons?.[0].names?.[0];
    expect(name?.prefix).toBe("Dr.");
    expect(name?.given).toBe("John");
    expect(name?.surname).toBe("Doe");
    expect(name?.suffix).toBe("Jr.");
  });

  // Test 5 — Rule 3: warn on unknown part types
  it("emits a console.warn for unknown namePart.type values", () => {
    toSimplified({
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
                    { type: "http://gedcomx.org/Nickname", value: "Johnny" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(warnSpy).toHaveBeenCalled();
    // Annotated because `warnSpy` is declared `ReturnType<typeof vi.spyOn>`,
    // which erases the call-argument tuple and leaves these implicitly `any`.
    const messages = warnSpy.mock.calls.map((args: unknown[]) => String(args[0]));
    expect(messages.some((m: string) => m.includes("Nickname"))).toBe(true);
  });

  // Test 6 — Rule 3 fallback: fullText only, with warning
  it("extracts given/surname from fullText when parts is missing, with warn", () => {
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
    expect(warnSpy).toHaveBeenCalled();
  });

  // Test 7 — Rule 3 mononym
  it("handles mononyms — single token goes to surname, given is empty", () => {
    const result = toSimplified({
      persons: [{ id: "p1", names: [{ nameForms: [{ fullText: "Plato" }] }] }],
    });
    expect(result.persons?.[0].names?.[0].given).toBe("");
    expect(result.persons?.[0].names?.[0].surname).toBe("Plato");
    expect(warnSpy).toHaveBeenCalled();
  });

  // Test 8 — Rule 4: preferred passes through, never synthesized
  it("preserves preferred: true when set; omits the field when absent", () => {
    const result = toSimplified({
      persons: [
        {
          id: "p1",
          names: [
            {
              preferred: true,
              nameForms: [
                {
                  parts: [
                    { type: "http://gedcomx.org/Given", value: "A" },
                    { type: "http://gedcomx.org/Surname", value: "B" },
                  ],
                },
              ],
            },
            {
              nameForms: [
                {
                  parts: [
                    { type: "http://gedcomx.org/Given", value: "C" },
                    { type: "http://gedcomx.org/Surname", value: "D" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const names = result.persons?.[0].names ?? [];
    expect(names[0].preferred).toBe(true);
    expect("preferred" in names[1]).toBe(false);
  });

  // Test 9 — Rule 4: multiple names can independently be preferred
  it("allows multiple names to each be preferred: true (per-type semantics)", () => {
    const result = toSimplified({
      persons: [
        {
          id: "p1",
          names: [
            {
              preferred: true,
              type: "http://gedcomx.org/BirthName",
              nameForms: [{ parts: [{ type: "http://gedcomx.org/Surname", value: "X" }] }],
            },
            {
              preferred: true,
              type: "http://gedcomx.org/MarriedName",
              nameForms: [{ parts: [{ type: "http://gedcomx.org/Surname", value: "Y" }] }],
            },
          ],
        },
      ],
    });
    const names = result.persons?.[0].names ?? [];
    expect(names[0].preferred).toBe(true);
    expect(names[1].preferred).toBe(true);
  });

  // Test 9b — #1318: the preferred name is moved to names[0] even when
  // FamilySearch lists an alternate (AlsoKnownAs) before it. A wrong primary
  // manufactures a phantom conflict downstream — person_read / person_ancestors
  // read names[0].
  it("puts the preferred name first when GedcomX lists an alternate before it (#1318)", () => {
    const result = toSimplified({
      persons: [
        {
          id: "p1",
          names: [
            {
              type: "http://gedcomx.org/AlsoKnownAs",
              nameForms: [{ parts: [{ type: "http://gedcomx.org/Given", value: "Alternate Given" }] }],
            },
            {
              preferred: true,
              nameForms: [
                {
                  parts: [
                    { type: "http://gedcomx.org/Given", value: "Preferred Given" },
                    { type: "http://gedcomx.org/Surname", value: "Preferred Surname" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const names = result.persons?.[0].names ?? [];
    // The preferred name leads, so every names[0] consumer picks it.
    expect(names[0].preferred).toBe(true);
    expect(names[0].given).toBe("Preferred Given");
    expect(names[0].surname).toBe("Preferred Surname");
    // The alternate is retained, just not first.
    expect(names[1].given).toBe("Alternate Given");
    expect(names[1].type).toBe("AlsoKnownAs");
  });

  // Test 10 — Rule 5: primary passes through, never synthesized from position
  it("preserves primary: true when set; omits the field when absent", () => {
    const result = toSimplified({
      persons: [
        {
          id: "p1",
          facts: [
            { type: "http://gedcomx.org/Birth" },
            { type: "http://gedcomx.org/Death", primary: true },
          ],
        },
      ],
    });
    const facts = result.persons?.[0].facts ?? [];
    expect("primary" in facts[0]).toBe(false);
    expect(facts[1].primary).toBe(true);
  });

  // Test 11 — Rule 5: multiple facts of different types can each be primary
  it("allows independent primary: true across different fact types", () => {
    const result = toSimplified({
      persons: [
        {
          id: "p1",
          facts: [
            { type: "http://gedcomx.org/Birth", primary: true },
            { type: "http://gedcomx.org/Death", primary: true },
            { type: "http://gedcomx.org/Marriage", primary: true },
          ],
        },
      ],
    });
    const facts = result.persons?.[0].facts ?? [];
    expect(facts[0].primary).toBe(true);
    expect(facts[1].primary).toBe(true);
    expect(facts[2].primary).toBe(true);
  });

  // Test 12 — Rule 6: date.formal dropped
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

  // Test 13 — Rule 7: place.description dropped
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

  // Test 14 — Rule 8: ParentChild round-trip
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

  // Test 15 — Rule 9: Couple round-trip
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

  // Test 16 — Rule 10: CitationDetail → page; other (non-quality) qualifiers dropped
  it("maps CitationDetail qualifier to page; drops unknown qualifiers", () => {
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
                { name: "http://example.org/SomeOther", value: "ignored" },
              ],
            },
          ],
        },
      ],
    });
    expect(result.persons?.[0].sources?.[0].page).toBe("1920 Census, ED 47");
    expect(result.persons?.[0].sources?.[0].ref).toBe("S1");
  });

  // Test 17 — Rule 10: fsmcp:quality parses to the integer the tree format
  // requires; non-integer qualifier content is dropped like any other
  // unrecognized qualifier.
  it("maps fsmcp:quality qualifier to quality as an integer; drops non-integer values", () => {
    const numeric = toSimplified({
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
    expect(numeric.persons?.[0].sources?.[0].quality).toBe(3);

    const freeText = toSimplified({
      persons: [
        {
          id: "p1",
          sources: [
            {
              description: "#S1",
              qualifiers: [{ name: "fsmcp:quality", value: "high" }],
            },
          ],
        },
      ],
    });
    expect("quality" in (freeText.persons?.[0].sources?.[0] ?? {})).toBe(false);

    const absent = toSimplified({
      persons: [{ id: "p1", sources: [{ description: "#S1" }] }],
    });
    expect("quality" in (absent.persons?.[0].sources?.[0] ?? {})).toBe(false);
  });

  // Rule 10 reverse: an integer quality (the only form the tree schema
  // accepts) round-trips through the string-valued qualifier — previously it
  // was silently dropped on toGedcomX, losing QUAY data on the upload path.
  it("round-trips integer quality through the fsmcp:quality qualifier", () => {
    const expanded = toGedcomX({
      persons: [{ id: "p1", sources: [{ ref: "S1", quality: 2 }] }],
    });
    expect(expanded.persons?.[0].sources?.[0].qualifiers).toEqual([
      { name: "fsmcp:quality", value: "2" },
    ]);

    const back = toSimplified(expanded);
    expect(back.persons?.[0].sources?.[0].quality).toBe(2);
  });

  // Test 18 — Rule 11: source descriptions round-trip
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

  // Test 19 — Rule 12: places round-trip
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

  // Test 20 — Rule 8: each of the five subtype URIs round-trips
  it("round-trips each recognized parent-child subtype", () => {
    const subtypes: { short: string; uri: string }[] = [
      { short: "Biological", uri: "http://gedcomx.org/BiologicalParent" },
      { short: "Adoptive", uri: "http://gedcomx.org/AdoptiveParent" },
      { short: "Step", uri: "http://gedcomx.org/StepParent" },
      { short: "Foster", uri: "http://gedcomx.org/FosterParent" },
      { short: "Guardian", uri: "http://gedcomx.org/GuardianParent" },
    ];
    for (const { short, uri } of subtypes) {
      const input: GedcomX = {
        relationships: [
          {
            type: "http://gedcomx.org/ParentChild",
            person1: { resource: "#I2" },
            person2: { resource: "#I1" },
            facts: [{ type: uri }],
          },
        ],
      };
      const simplified = toSimplified(input);
      expect(simplified.relationships?.[0].subtype).toBe(short);
      // The subtype-fact must not also appear in simplified facts[].
      expect(simplified.relationships?.[0].facts).toBeUndefined();

      const roundTripped = toGedcomX(simplified);
      expect(roundTripped.relationships?.[0].facts?.[0].type).toBe(uri);
    }
  });

  // Test 21 — Rule 8: subtype lifted, unrelated facts retained in facts[]
  it("lifts subtype from facts[] but preserves unrelated facts on a ParentChild", () => {
    const input: GedcomX = {
      relationships: [
        {
          type: "http://gedcomx.org/ParentChild",
          person1: { resource: "#I2" },
          person2: { resource: "#I1" },
          facts: [
            { type: "http://gedcomx.org/AdoptiveParent" },
            {
              type: "http://gedcomx.org/Adoption",
              date: { original: "1923" },
            },
          ],
        },
      ],
    };
    const simplified = toSimplified(input);
    expect(simplified.relationships?.[0].subtype).toBe("Adoptive");
    expect(simplified.relationships?.[0].facts).toHaveLength(1);
    expect(simplified.relationships?.[0].facts?.[0].type).toBe("Adoption");
    expect(simplified.relationships?.[0].facts?.[0].date).toBe("1923");

    const back = toGedcomX(simplified);
    // Subtype fact prepended at index 0; unrelated fact follows.
    expect(back.relationships?.[0].facts?.[0].type).toBe(
      "http://gedcomx.org/AdoptiveParent",
    );
    expect(back.relationships?.[0].facts?.[1].type).toBe(
      "http://gedcomx.org/Adoption",
    );
  });

  // Test 22 — Rule 8: ParentChild with no recognized subtype-fact
  it("omits subtype when no recognized subtype-fact is present; unrelated facts pass through", () => {
    const result = toSimplified({
      relationships: [
        {
          type: "http://gedcomx.org/ParentChild",
          person1: { resource: "#I2" },
          person2: { resource: "#I1" },
          facts: [{ type: "http://gedcomx.org/Adoption" }],
        },
      ],
    });
    expect("subtype" in (result.relationships?.[0] ?? {})).toBe(false);
    expect(result.relationships?.[0].facts).toHaveLength(1);
    expect(result.relationships?.[0].facts?.[0].type).toBe("Adoption");
  });

  // Test 23 — Rule 13: notes text content preserved; entries missing text dropped
  it("extracts note text on relationships; drops entries with no text", () => {
    const result = toSimplified({
      relationships: [
        {
          type: "http://gedcomx.org/ParentChild",
          person1: { resource: "#I2" },
          person2: { resource: "#I1" },
          notes: [
            { subject: "Adoption", text: "Adopted in 1923.", lang: "en" },
            { subject: "Empty note" }, // no text — must be dropped
            { text: "Plain second note." },
          ],
        },
      ],
    });
    expect(result.relationships?.[0].notes).toEqual([
      "Adopted in 1923.",
      "Plain second note.",
    ]);
  });

  // Test 24 — Rule 13: multiple notes preserve order
  it("preserves the order of notes on relationships", () => {
    const result = toSimplified({
      relationships: [
        {
          type: "http://gedcomx.org/Couple",
          person1: { resource: "#I1" },
          person2: { resource: "#I2" },
          notes: [
            { text: "First." },
            { text: "Second." },
            { text: "Third." },
          ],
        },
      ],
    });
    expect(result.relationships?.[0].notes).toEqual([
      "First.",
      "Second.",
      "Third.",
    ]);
  });

  // Test 25 — Rule 13: empty/missing notes omitted from simplified output
  it("omits empty or missing notes from simplified output", () => {
    const emptyArr = toSimplified({
      relationships: [
        {
          type: "http://gedcomx.org/ParentChild",
          person1: { resource: "#I2" },
          person2: { resource: "#I1" },
          notes: [],
        },
      ],
    });
    expect("notes" in (emptyArr.relationships?.[0] ?? {})).toBe(false);

    const missing = toSimplified({
      relationships: [
        {
          type: "http://gedcomx.org/ParentChild",
          person1: { resource: "#I2" },
          person2: { resource: "#I1" },
        },
      ],
    });
    expect("notes" in (missing.relationships?.[0] ?? {})).toBe(false);
  });

  // Test 34 — Rule 15: the Persistent ARK is lifted to a flat `ark` in the
  // canonical `ark:/61903/...` form (resolver URL stripped); toGedcomX reduces
  // it to the bare 8-char persona id (what FamilySearch's APIs want).
  it("lifts Persistent ARK to a canonical `ark`, then reduces to a bare id on toGedcomX", () => {
    const input: GedcomX = {
      persons: [
        {
          id: "ark:/61903/4:1:KGS8-LY1",
          identifiers: {
            "http://gedcomx.org/Persistent": [
              "https://familysearch.org/ark:/61903/4:1:KGS8-LY1",
            ],
          },
        },
      ],
    };
    const simplified = toSimplified(input);
    expect(simplified.persons?.[0].ark).toBe("ark:/61903/4:1:KGS8-LY1");
    // The map shape must no longer appear on the simplified side.
    expect(
      "identifiers" in (simplified.persons?.[0] ?? {}),
    ).toBe(false);

    const back = toGedcomX(simplified);
    expect(back.persons?.[0].identifiers).toEqual({
      "http://gedcomx.org/Persistent": ["KGS8-LY1"],
    });
  });

  // Test 35 — Rule 15: non-Persistent identifier types are dropped
  it("drops non-Persistent identifier types (Primary, Authority, etc.)", () => {
    const input: GedcomX = {
      persons: [
        {
          id: "p1",
          identifiers: {
            "http://gedcomx.org/Persistent": ["https://example.com/p1-ark"],
            "http://gedcomx.org/Primary": ["primary-id-1"],
            "http://gedcomx.org/Authority": ["authority-id-1"],
          },
        },
      ],
    };
    const simplified = toSimplified(input);
    expect(simplified.persons?.[0].ark).toBe("https://example.com/p1-ark");

    // Only Persistent survives the expand back.
    const back = toGedcomX(simplified);
    expect(back.persons?.[0].identifiers).toEqual({
      "http://gedcomx.org/Persistent": ["https://example.com/p1-ark"],
    });
  });

  // Test 36 — Rule 15: missing identifiers → no ark; missing ark → no identifiers; empty
  // string ark → no identifiers
  it("omits ark when no Persistent identifier; omits identifiers when no ark", () => {
    // Missing identifiers entirely.
    const noIds = toSimplified({ persons: [{ id: "p1" }] });
    expect("ark" in (noIds.persons?.[0] ?? {})).toBe(false);

    // identifiers present but no Persistent key.
    const onlyPrimary = toSimplified({
      persons: [
        {
          id: "p1",
          identifiers: { "http://gedcomx.org/Primary": ["primary-id"] },
        },
      ],
    });
    expect("ark" in (onlyPrimary.persons?.[0] ?? {})).toBe(false);

    // Persistent array empty.
    const emptyArr = toSimplified({
      persons: [
        { id: "p1", identifiers: { "http://gedcomx.org/Persistent": [] } },
      ],
    });
    expect("ark" in (emptyArr.persons?.[0] ?? {})).toBe(false);

    // Missing ark on simplified → no identifiers on toGedcomX.
    const backNoArk = toGedcomX({ persons: [{ id: "p1" }] });
    expect("identifiers" in (backNoArk.persons?.[0] ?? {})).toBe(false);

    // Empty string ark → no identifiers (don't emit a useless entry).
    const backEmptyArk = toGedcomX({ persons: [{ id: "p1", ark: "" }] });
    expect("identifiers" in (backEmptyArk.persons?.[0] ?? {})).toBe(false);
  });

  // Test 37 — Rule 15: multiple Persistent values — first wins (documented loss)
  it("flattens multiple Persistent values to the first; rest dropped", () => {
    const input: GedcomX = {
      persons: [
        {
          id: "p1",
          identifiers: {
            "http://gedcomx.org/Persistent": [
              "https://example.com/ark-1",
              "https://example.com/ark-2",
              "https://example.com/ark-3",
            ],
          },
        },
      ],
    };
    const simplified = toSimplified(input);
    expect(simplified.persons?.[0].ark).toBe("https://example.com/ark-1");

    // Round-trip back surfaces only the first value as a single-element array.
    const back = toGedcomX(simplified);
    expect(back.persons?.[0].identifiers).toEqual({
      "http://gedcomx.org/Persistent": ["https://example.com/ark-1"],
    });
  });

  // Test 26 — Rule 14: IDs pass through verbatim
  it("passes IDs through verbatim and does not generate new ones", () => {
    const result = toSimplified({
      persons: [
        {
          id: "custom-id-99",
          names: [
            {
              id: "name-x",
              nameForms: [
                {
                  parts: [
                    { type: "http://gedcomx.org/Given", value: "Joe" },
                    { type: "http://gedcomx.org/Surname", value: "Smith" },
                  ],
                },
              ],
            },
          ],
          facts: [{ id: "fact-z", type: "http://gedcomx.org/Birth" }],
        },
      ],
    });
    expect(result.persons?.[0].id).toBe("custom-id-99");
    expect(result.persons?.[0].names?.[0].id).toBe("name-x");
    expect(result.persons?.[0].facts?.[0].id).toBe("fact-z");

    const noIds = toSimplified({
      persons: [
        {
          names: [
            {
              nameForms: [
                {
                  parts: [
                    { type: "http://gedcomx.org/Surname", value: "Anon" },
                  ],
                },
              ],
            },
          ],
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
  // Test 27
  it("returns {} on null / undefined input", () => {
    expect(toSimplified(null as unknown as GedcomX)).toEqual({});
    expect(toSimplified(undefined as unknown as GedcomX)).toEqual({});
    expect(toGedcomX(null as unknown as SimplifiedGedcomX)).toEqual({});
    expect(toGedcomX(undefined as unknown as SimplifiedGedcomX)).toEqual({});
  });

  // Test 28
  it("preserves persons with no names in the output", () => {
    const result = toSimplified({
      persons: [{ id: "p1", gender: { type: "http://gedcomx.org/Male" } }],
    });
    expect(result.persons).toHaveLength(1);
    expect(result.persons?.[0].id).toBe("p1");
    expect(result.persons?.[0].gender).toBe("Male");
    expect(result.persons?.[0].names).toBeUndefined();
  });

  // Test 29
  it("does not throw on malformed gender (string instead of object)", () => {
    expect(() =>
      toSimplified({
        persons: [
          { id: "p1", gender: "Male" as unknown as { type: string } },
        ],
      }),
    ).not.toThrow();
  });

  // Test 30
  it("omits empty top-level arrays from output", () => {
    const result = toSimplified({
      persons: [],
      relationships: [],
      sourceDescriptions: [],
      places: [],
    });
    expect(result).toEqual({});
  });

  // Test 31
  it("never emits preferred: false or primary: false", () => {
    // Even if the input asserts the false values explicitly, simplification
    // should omit them (since `false` is the default per schema convention).
    const result = toSimplified({
      persons: [
        {
          id: "p1",
          names: [
            {
              preferred: false,
              nameForms: [
                {
                  parts: [
                    { type: "http://gedcomx.org/Given", value: "A" },
                    { type: "http://gedcomx.org/Surname", value: "B" },
                  ],
                },
              ],
            },
          ],
          facts: [
            { type: "http://gedcomx.org/Birth", primary: false },
          ],
        },
      ],
    });
    const json = JSON.stringify(result);
    expect(json).not.toContain('"preferred":false');
    expect(json).not.toContain('"primary":false');

    // toGedcomX must also never emit false
    const back = toGedcomX(result);
    const backJson = JSON.stringify(back);
    expect(backJson).not.toContain('"preferred":false');
    expect(backJson).not.toContain('"primary":false');
  });
});

describe("gedcomx-convert — identity round-trips", () => {
  // Test 32 — A "clean" raw GedcomX input survives toSimplified → toGedcomX.
  // "Clean" means no fields that are documented as lossy:
  // no date.formal, no place.description, names use parts (not fullText fallback),
  // no qualifiers outside CitationDetail / fsmcp:quality, and the ParentChild
  // subtype-fact is at index 0 of facts[] (round-trip ordering convention).
  it("identity: toGedcomX(toSimplified(raw)) === raw for a clean input", () => {
    const clean: GedcomX = {
      persons: [
        {
          id: "p1",
          gender: { type: "http://gedcomx.org/Male" },
          // `identifiers`/`ark` is intentionally omitted here: toGedcomX reduces
          // the ARK to a bare id (lossy by design — see Test 34), so it is not
          // round-trip-stable. The other fields are.
          names: [
            {
              id: "n1",
              type: "http://gedcomx.org/BirthName",
              preferred: true,
              nameForms: [
                {
                  fullText: "Dr. John Doe Jr.",
                  parts: [
                    { type: "http://gedcomx.org/Prefix", value: "Dr." },
                    { type: "http://gedcomx.org/Given", value: "John" },
                    { type: "http://gedcomx.org/Surname", value: "Doe" },
                    { type: "http://gedcomx.org/Suffix", value: "Jr." },
                  ],
                },
              ],
            },
          ],
          facts: [
            {
              id: "f1",
              type: "http://gedcomx.org/Birth",
              primary: true,
              date: { original: "1900" },
              place: { original: "Denver, Colorado" },
              sources: [
                {
                  description: "#S1",
                  qualifiers: [
                    {
                      name: "http://gedcomx.org/CitationDetail",
                      value: "page 7",
                    },
                    { name: "fsmcp:quality", value: "3" },
                  ],
                },
              ],
            },
          ],
        },
      ],
      relationships: [
        {
          id: "r1",
          type: "http://gedcomx.org/ParentChild",
          person1: { resource: "#p2" },
          person2: { resource: "#p1" },
          facts: [{ type: "http://gedcomx.org/AdoptiveParent" }],
          notes: [
            { text: "Adoption finalized 1923." },
            { text: "Source: county courthouse." },
          ],
        },
      ],
      sourceDescriptions: [
        {
          id: "S1",
          titles: [{ value: "Some Title" }],
          citations: [{ value: "Some Citation" }],
          about: "https://example.org/source",
        },
      ],
      places: [
        {
          id: "place1",
          names: [{ value: "Denver, Colorado" }],
          latitude: 39.7392,
          longitude: -104.9903,
        },
      ],
    };

    expect(toGedcomX(toSimplified(clean))).toEqual(clean);
  });

  // Test 33 — A comprehensive simplified input survives toGedcomX → toSimplified
  // unchanged. Simplified → raw is lossless by construction.
  it("identity: toSimplified(toGedcomX(simplified)) === simplified", () => {
    const simplified: SimplifiedGedcomX = {
      persons: [
        {
          id: "p1",
          // `ark` omitted: toGedcomX reduces it to a bare id (lossy — see
          // Test 34), so it is not round-trip-stable.
          gender: "Female",
          names: [
            {
              id: "n1",
              type: "BirthName",
              preferred: true,
              prefix: "Dr.",
              given: "Jane",
              surname: "Roe",
              suffix: "PhD",
            },
            {
              id: "n2",
              type: "MarriedName",
              given: "Jane",
              surname: "Smith",
            },
          ],
          facts: [
            {
              id: "f1",
              type: "Birth",
              primary: true,
              date: "1950",
              standard_date: "1950",
              place: "Boston",
              sources: [
                { ref: "S1", page: "p. 7", quality: 3 },
              ],
            },
            { id: "f2", type: "Death", date: "2020", standard_date: "2020" },
          ],
          sources: [{ ref: "S1" }],
        },
      ],
      relationships: [
        {
          id: "r1",
          type: "Couple",
          person1: "p1",
          person2: "p2",
          facts: [{ type: "Marriage", primary: true, date: "1975", standard_date: "1975" }],
          notes: ["Married at city hall.", "Witnessed by two neighbors."],
        },
        {
          id: "r2",
          type: "ParentChild",
          parent: "p1",
          child: "p3",
          subtype: "Step",
          notes: ["Step-relationship from p1's second marriage."],
        },
      ],
      sources: [
        {
          id: "S1",
          title: "Some Title",
          citation: "Some Citation",
          url: "https://example.org/source",
        },
      ],
      places: [
        {
          id: "place1",
          name: "Boston, Massachusetts",
          latitude: 42.3601,
          longitude: -71.0589,
        },
      ],
    };

    expect(toSimplified(toGedcomX(simplified))).toEqual(simplified);
  });
});

describe("gedcomx-convert — date standardization on toSimplified", () => {
  it("preserves the original date verbatim and adds standard_date as a sidecar", () => {
    const result = toSimplified({
      persons: [
        {
          id: "p1",
          facts: [
            { type: "http://gedcomx.org/Birth", date: { original: "15 June 1850" } },
            { type: "http://gedcomx.org/Death", date: { original: "about 1920" } },
            { type: "http://gedcomx.org/Burial", date: { original: "BEF OCT 1855" } },
          ],
        },
      ],
    });
    const facts = result.persons?.[0].facts ?? [];
    expect(facts.map((f) => f.date)).toEqual([
      "15 June 1850",
      "about 1920",
      "BEF OCT 1855",
    ]);
    expect(facts.map((f) => f.standard_date)).toEqual([
      "15 Jun 1850",
      "Abt 1920",
      "Bef Oct 1855",
    ]);
  });

  it("omits standard_date when standardization returns empty but still preserves date", () => {
    const result = toSimplified({
      persons: [
        {
          id: "p1",
          facts: [
            { type: "http://gedcomx.org/Birth", date: { original: "garbage that cannot be parsed" } },
          ],
        },
      ],
    });
    const fact = result.persons?.[0].facts?.[0];
    expect(fact?.date).toBe("garbage that cannot be parsed");
    expect(fact?.standard_date).toBeUndefined();
  });

  it("adds standard_date on relationship facts too (Couple/Marriage)", () => {
    const result = toSimplified({
      relationships: [
        {
          type: "http://gedcomx.org/Couple",
          person1: { resource: "#p1" },
          person2: { resource: "#p2" },
          facts: [{ type: "http://gedcomx.org/Marriage", date: { original: "20 April 1875" } }],
        },
      ],
    });
    const fact = result.relationships?.[0].facts?.[0];
    expect(fact?.date).toBe("20 April 1875");
    expect(fact?.standard_date).toBe("20 Apr 1875");
  });

  it("ignores standard_date on the reverse path (simplified → raw)", () => {
    const raw = toGedcomX({
      persons: [
        {
          id: "p1",
          facts: [
            { type: "Birth", date: "15 June 1850", standard_date: "15 Jun 1850" },
          ],
        },
      ],
    });
    const fact = raw.persons?.[0].facts?.[0];
    expect(fact?.date).toEqual({ original: "15 June 1850" });
    // No standard_date should leak into the raw GedcomX output.
    expect((fact as { standard_date?: unknown }).standard_date).toBeUndefined();
  });
});

describe("gedcomx-convert — fact-type URI cleanup on toSimplified", () => {
  it("strips the data:, prefix", () => {
    const result = toSimplified({
      persons: [
        {
          id: "p1",
          facts: [
            { type: "data:,Baptism", date: { original: "1900" } },
            { type: "data:,Census", date: { original: "1940" } },
          ],
        },
      ],
    });
    const types = result.persons?.[0].facts?.map((f) => f.type);
    expect(types).toEqual(["Baptism", "Census"]);
  });

  it("URL-decodes percent-escaped characters in the type", () => {
    const result = toSimplified({
      persons: [
        {
          id: "p1",
          facts: [
            { type: "data:,Military%20Draft%20Registration" },
          ],
        },
      ],
    });
    expect(result.persons?.[0].facts?.[0].type).toBe("Military Draft Registration");
  });

  it("takes the trailing path segment for non-gedcomx http URIs", () => {
    const result = toSimplified({
      persons: [
        {
          id: "p1",
          facts: [{ type: "http://familysearch.org/v1/Foo" }],
        },
      ],
    });
    expect(result.persons?.[0].facts?.[0].type).toBe("Foo");
  });

  it("falls back to the undecoded string when the percent sequence is malformed", () => {
    const result = toSimplified({
      persons: [
        {
          id: "p1",
          facts: [{ type: "data:,Bad%ZZ" }],
        },
      ],
    });
    expect(result.persons?.[0].facts?.[0].type).toBe("Bad%ZZ");
  });

  /** The custom types one live read held (KNDX-MKG and its parents, 2026-10-09). */
  function typesOf(rawTypes: string[]): (string | undefined)[] {
    const result = toSimplified({
      persons: [{ id: "p1", facts: rawTypes.map((type) => ({ type })) }],
    });
    return result.persons?.[0].facts?.map((f) => f.type) ?? [];
  }

  it("reads `+` in a data: label as a space, so both spellings of one label agree", () => {
    expect(typesOf(["data:,Previous+Residence", "data:,Previous%20Residence"])).toEqual([
      "Previous Residence",
      "Previous Residence",
    ]);
    expect(typesOf(["data:,C%2B%2B+Programmer"])).toEqual(["C++ Programmer"]);
  });

  it("raises a lowercase first letter, which the tree refuses", () => {
    expect(typesOf(["data:,will", "data:,scholastic-achievement"])).toEqual([
      "Will",
      "Scholastic-achievement",
    ]);
  });

  it("drops one pair of wrapping quotes and the space around the label", () => {
    expect(typesOf(["data:,%22Presented+to+Society%22", "data:,+%E2%80%9CElected%E2%80%9D+"])).toEqual([
      "Presented to Society",
      "Elected",
    ]);
  });

  it("keeps a label that cannot start with an uppercase letter whole, behind `Custom `", () => {
    expect(typesOf(["data:,100%25+english", "data:,%C3%A9lu", "data:,"])).toEqual([
      "Custom 100% english",
      "Custom élu",
      "Custom",
    ]);
  });

  it("round-trips a prefixed label under http://gedcomx.org/, like any other custom type", () => {
    const simplified = toSimplified({
      persons: [{ id: "p1", facts: [{ type: "data:,100%25+english" }, { type: "data:,will" }] }],
    });
    const back = toGedcomX(simplified);
    expect(back.persons?.[0].facts?.map((f) => f.type)).toEqual([
      "http://gedcomx.org/Custom 100% english",
      "http://gedcomx.org/Will",
    ]);
  });

  it("returns a type the tree accepts for every custom label one live read held", () => {
    const live = [
      "data:,%22Presented+to+Society%22", "data:,100%25+english",
      "data:,87.5%25english%2C+12.5%25+french", "data:,Alt.%20Death",
      "data:,Alternate+death+place", "data:,Held+public+office", "data:,Probate%3B+will",
      "data:,Will+probated", "data:,scholastic-achievement", "data:,will",
    ];
    for (const type of typesOf(live)) expect(type).toMatch(/^[A-Z]/);
  });
});

describe("gedcomx-convert — fact.value preservation", () => {
  it("preserves fact.value on toSimplified for value-bearing fact types", () => {
    const result = toSimplified({
      persons: [
        {
          id: "p1",
          facts: [
            { type: "http://gedcomx.org/Occupation", date: { original: "about 1940" }, value: "Newpaper Editor" },
            { type: "data:,Elected", date: { original: "1774" }, value: "Continental Congress" },
            { type: "http://gedcomx.org/Citizenship", value: "United States" },
          ],
        },
      ],
    });
    const facts = result.persons?.[0].facts ?? [];
    expect(facts[0].value).toBe("Newpaper Editor");
    expect(facts[1].value).toBe("Continental Congress");
    expect(facts[2].value).toBe("United States");
  });

  it("omits fact.value when the raw doesn't have one (e.g. Birth)", () => {
    const result = toSimplified({
      persons: [
        {
          id: "p1",
          facts: [
            { type: "http://gedcomx.org/Birth", date: { original: "1900" } },
          ],
        },
      ],
    });
    expect(result.persons?.[0].facts?.[0].value).toBeUndefined();
  });

  it("preserves fact.value on the reverse path (simplified → raw)", () => {
    const raw = toGedcomX({
      persons: [
        {
          id: "p1",
          facts: [
            { type: "Occupation", date: "about 1940", value: "Newpaper Editor" },
          ],
        },
      ],
    });
    const fact = raw.persons?.[0].facts?.[0];
    expect(fact?.value).toBe("Newpaper Editor");
  });
});

// ────────────────────────────────────────────────────────────────────
// Rule 10 boundaries — QUAY survives the round trip at BOTH ends of the
// range (0 is falsy: the value a truthiness regression silently drops),
// and out-of-range values die at the boundary instead of producing a
// document every validity gate rejects.
// ────────────────────────────────────────────────────────────────────

describe("fsmcp:quality boundaries", () => {
  const refWithQualifier = (value: string) =>
    toSimplified({
      persons: [
        { id: "p1", sources: [{ description: "#S1", qualifiers: [{ name: "fsmcp:quality", value }] }] },
      ],
    }).persons?.[0].sources?.[0];

  it("parses both QUAY boundaries, including falsy 0", () => {
    expect(refWithQualifier("0")?.quality).toBe(0);
    expect(refWithQualifier("3")?.quality).toBe(3);
  });

  it("drops out-of-range and non-decimal qualifier values", () => {
    expect(refWithQualifier("7")?.quality).toBeUndefined();
    expect(refWithQualifier("-1")?.quality).toBeUndefined();
    expect(refWithQualifier("0x1A")?.quality).toBeUndefined();
  });

  it("round-trips quality 0 and refuses to upload an out-of-range integer", () => {
    const zero = toGedcomX({
      persons: [
        {
          id: "I1",
          gender: "Male",
          names: [{ id: "N1", given: "J", surname: "S" }],
          facts: [{ id: "F1", type: "Birth", sources: [{ ref: "S1", quality: 0 }] }],
        },
      ],
      relationships: [],
      sources: [{ id: "S1", title: "T" }],
    } as any);
    const zeroJson = JSON.stringify(zero);
    expect(zeroJson).toContain('"fsmcp:quality"');
    expect(zeroJson).toContain('"value":"0"');

    const seven = toGedcomX({
      persons: [
        {
          id: "I1",
          gender: "Male",
          names: [{ id: "N1", given: "J", surname: "S" }],
          facts: [{ id: "F1", type: "Birth", sources: [{ ref: "S1", quality: 7 }] }],
        },
      ],
      relationships: [],
      sources: [{ id: "S1", title: "T" }],
    } as any);
    expect(JSON.stringify(seven)).not.toContain('"fsmcp:quality"');
  });
});

describe("gedcomx-convert — source description coverage and resource_type", () => {
  it("carries resource_type and coverage through toSimplified", () => {
    const raw: GedcomX = {
      persons: [],
      sourceDescriptions: [
        {
          id: "SD1",
          resourceType: "http://gedcomx.org/DigitalArtifact",
          titles: [{ value: "Some Record" }],
          coverage: [
            {
              spatial: { description: "#12345" },
              temporal: { original: "1850/1860", formal: "+1850/+1860" },
              recordType: "http://gedcomx.org/Census",
            },
          ],
        },
      ],
    };
    const simplified = toSimplified(raw);
    const sd = simplified.sources?.[0];
    expect(sd?.resource_type).toBe("DigitalArtifact");
    expect(sd?.coverage).toEqual({
      place_rep_id: "12345",
      date_range: "1850/1860",
      record_type: "Census",
    });
  });

  it("falls back to temporal.formal when temporal.original is absent", () => {
    const raw: GedcomX = {
      persons: [],
      sourceDescriptions: [
        {
          id: "SD1",
          resourceType: "http://gedcomx.org/DigitalArtifact",
          titles: [{ value: "Some Record" }],
          coverage: [
            {
              spatial: { description: "#12345" },
              temporal: { formal: "+1850/+1860" },
              recordType: "http://gedcomx.org/Census",
            },
          ],
        },
      ],
    };
    const simplified = toSimplified(raw);
    expect(simplified.sources?.[0]?.coverage?.date_range).toBe("+1850/+1860");
  });

  it("omits coverage when absent on raw source description", () => {
    const raw: GedcomX = {
      persons: [],
      sourceDescriptions: [
        {
          id: "SD1",
          titles: [{ value: "Plain Source" }],
        },
      ],
    };
    const simplified = toSimplified(raw);
    expect(simplified.sources?.[0]?.resource_type).toBeUndefined();
    expect(simplified.sources?.[0]?.coverage).toBeUndefined();
  });
});

describe("gedcomx-convert — person principal field", () => {
  it("carries principal: true through toSimplified", () => {
    const raw: GedcomX = {
      persons: [
        {
          id: "P1",
          principal: true,
          gender: { type: "http://gedcomx.org/Male" },
          names: [{ nameForms: [{ fullText: "John Smith" }] }],
        },
      ],
    };
    const simplified = toSimplified(raw);
    expect(simplified.persons?.[0]?.principal).toBe(true);
  });

  it("omits principal when false or absent", () => {
    const raw: GedcomX = {
      persons: [
        {
          id: "P1",
          principal: false,
          gender: { type: "http://gedcomx.org/Female" },
          names: [{ nameForms: [{ fullText: "Jane Doe" }] }],
        },
        {
          id: "P2",
          gender: { type: "http://gedcomx.org/Male" },
          names: [{ nameForms: [{ fullText: "John Doe" }] }],
        },
      ],
    };
    const simplified = toSimplified(raw);
    expect(simplified.persons?.[0]?.principal).toBeUndefined();
    expect(simplified.persons?.[1]?.principal).toBeUndefined();
  });
});

// `simplifySourceRef` prefers `descriptionId` over `description`. It was measured only on
// TREE person refs, but this converter is shared — record_read, record_search,
// person_search and the merge tools all run through it — so the precedence is pinned here
// rather than inferred from the one caller that needed it.
describe("source-reference id precedence", () => {
  it("prefers descriptionId over a full-URL description", () => {
    // The case the preference exists for: a relative's ref is a full URL to a description
    // the body does not contain. A URL never equals the bare id a fetched description
    // carries, so a consumer matching refs against `sources[]` ids by string equality
    // would drop every one of them.
    const out = toSimplified({
      persons: [
        {
          id: "P1",
          sources: [
            {
              description: "https://api.familysearch.org/platform/sources/descriptions/ZZZZ-999",
              descriptionId: "ZZZZ-999",
            },
          ],
        },
      ],
    } as never);
    expect(out.persons?.[0].sources).toEqual([{ ref: "ZZZZ-999" }]);
  });

  it("still strips a leading # when only description is present", () => {
    // The subject's own refs are `#<id>` fragments and carry no `descriptionId`. They
    // produced a bare id before this change and must still.
    const out = toSimplified({
      persons: [{ id: "P1", sources: [{ description: "#OWN-1" }] }],
    } as never);
    expect(out.persons?.[0].sources).toEqual([{ ref: "OWN-1" }]);
  });

  it("keeps page and quality qualifiers alongside the preferred id", () => {
    const out = toSimplified({
      persons: [
        {
          id: "P1",
          sources: [
            {
              description: "https://api.familysearch.org/platform/sources/descriptions/A-1",
              descriptionId: "A-1",
              qualifiers: [
                { name: "http://gedcomx.org/CitationDetail", value: "p. 7" },
                { name: "fsmcp:quality", value: "3" },
              ],
            },
          ],
        },
      ],
    } as never);
    expect(out.persons?.[0].sources).toEqual([{ ref: "A-1", page: "p. 7", quality: 3 }]);
  });
})

describe("gedcomx-convert — non-place phrases keep no standard_place (#1962)", () => {
  it("drops FamilySearch's normalized value for a non-place phrase, keeps it for a real place", () => {
    const result = toSimplified({
      persons: [
        {
          id: "p1",
          facts: [
            {
              type: "http://gedcomx.org/Residence",
              place: { original: "Same House", normalized: [{ value: "Same, Manufahi, Timor-Leste", lang: "en" }] },
            },
            {
              type: "http://gedcomx.org/Residence",
              place: { original: "Wayne, Ohio", normalized: [{ value: "Wayne, Ohio, United States", lang: "en" }] },
            },
          ],
        },
      ],
    });
    const facts = result.persons?.[0].facts ?? [];
    expect(facts[0].place).toBe("Same House");
    expect(facts[0].standard_place).toBeUndefined();
    expect(facts[1].standard_place).toBe("Wayne, Ohio, United States");
  });
});

// Record reads (recapi) carry no `place.normalized`. FamilySearch's standardized
// place is an `Interpreted` value of the place's `Place` field, which only the
// record-read conversion reads. Fixtures are cut from raw recapi persona bodies;
// the record id is in each test name.
const PLACE_FIELD = "http://gedcomx.org/Place";
const PREFERRED = [{ name: "http://familysearch.org/types/qualifiers/Preferred", value: "true" }];
const placeUrl = (id: string) => `https://www.familysearch.org/platform/places/description/${id}`;
const originalValue = (text: string, labelId = "EVENT_PLACE_ORIG") => ({
  type: "http://gedcomx.org/Original",
  labelId,
  text,
});
const interpretedValue = (
  text: string,
  placeId?: string,
  { preferred = false, labelId = "EVENT_PLACE" } = {},
) => ({
  type: "http://gedcomx.org/Interpreted",
  labelId,
  text,
  ...(placeId ? { resource: placeUrl(placeId) } : {}),
  ...(preferred ? { qualifiers: PREFERRED } : {}),
});
type RawPlace = NonNullable<GedcomXFact["place"]>;
const oneFact = (place: RawPlace): GedcomX => ({
  persons: [{ id: "p1", facts: [{ type: "http://gedcomx.org/Birth", place }] }],
});
/** The fact as a record read converts it, the place id exposed for it, and the
 *  place record_read puts back when it cannot name that id. */
const readOnePlace = (
  place: RawPlace,
): { fact: SimplifiedFact; placeId: string | undefined; original: string | undefined } => {
  const { doc, placeIds } = toSimplifiedRecordRead(oneFact(place));
  const fact = doc.persons![0].facts![0];
  return { fact, placeId: placeIds.get(fact)?.placeId, original: placeIds.get(fact)?.original };
};
/** The fact as a search or tree response converts it. */
const simplifyOnePlace = (place: RawPlace): SimplifiedFact =>
  toSimplified(oneFact(place)).persons![0].facts![0];

describe("gedcomx-convert — FamilySearch's standardized place from a record read's Place field", () => {
  it("takes the only Interpreted value that names a place, and exposes its place id (6589-3NS5)", () => {
    const { fact, placeId } = readOnePlace({
      original: "Bolívar, Colombia",
      fields: [
        {
          type: PLACE_FIELD,
          values: [
            originalValue("Bolívar, Colombia", "PR_BIR_PLACE_ORIG"),
            interpretedValue("Bolívar, Colombia", "5775", { labelId: "PR_BIR_PLACE" }),
          ],
        },
      ],
    });
    expect(fact.place).toBe("Bolívar, Colombia");
    expect(fact.standard_place).toBe("Bolívar, Colombia");
    expect(placeId).toBe("5775");
  });

  it("passes the fact's formal date beside its place id, whatever language its original is in (6589-3NS5)", () => {
    const place = {
      original: "Bolívar, Colombia",
      fields: [{ type: PLACE_FIELD, values: [interpretedValue("Bolívar, Colombia", "5775")] }],
    };
    const { doc, placeIds } = toSimplifiedRecordRead({
      persons: [
        {
          id: "p1",
          facts: [
            { type: "http://gedcomx.org/Birth", date: { original: "7 de mayo de 1856", formal: "+1856-05-07" }, place },
            { type: "http://gedcomx.org/BackgroundCheck", date: { original: "1 de febrero de 1873" }, place },
          ],
        },
      ],
    });
    const [birth, check] = doc.persons![0].facts!;
    expect(placeIds.get(birth)).toEqual({ placeId: "5775", original: "Bolívar, Colombia", formal: "+1856-05-07" });
    expect(placeIds.get(check)).toEqual({ placeId: "5775", original: "Bolívar, Colombia" });
  });

  it("prefers the candidate marked Preferred (QLGD-48KS)", () => {
    const { fact, placeId } = readOnePlace({
      original: "Boda, Kopparberg, Sweden",
      fields: [
        {
          type: PLACE_FIELD,
          values: [
            originalValue("Boda, Kopparbergs, Sweden"),
            interpretedValue("Boda, Kopparberg, Sweden", "3461825", { preferred: true }),
            interpretedValue("Boda, Rättvik, Dalarna, Sweden", "6666548"),
            interpretedValue("Boda, Kopparberg, Sweden", "3461825"),
            interpretedValue("Boda, Svärdsjö, Dalarna, Sweden", "6666551"),
          ],
        },
      ],
    });
    expect(fact.place).toBe("Boda, Kopparbergs, Sweden");
    expect(fact.standard_place).toBe("Boda, Kopparberg, Sweden");
    expect(placeId).toBe("3461825");
  });

  // FVFW-Y6P's Place field: place.description names Braunau (11861494), and
  // place.original is the text of the Tobel candidate (11861493).
  const tobelBraunau = (original: string): RawPlace => ({
    original,
    description: "#place_11861494",
    fields: [
      {
        type: PLACE_FIELD,
        values: [
          originalValue("Tobel-Braunau, Thurgau, Switzerland"),
          interpretedValue("Braunau, Thurgau, Switzerland", "11861494"),
          interpretedValue("Braunau, Tobel, Thurgau, Switzerland", "11912912"),
          interpretedValue("Tobel, Thurgau, Switzerland", "3059454"),
          interpretedValue("Braunau, Thurgau, Switzerland", "3057466"),
          interpretedValue("Tobel, Tobel-Tägerschen, Thurgau, Switzerland", "11861493"),
        ],
      },
    ],
  });

  it("takes the candidate place.description names when none is Preferred (FVFW-Y6P's candidates)", () => {
    const { fact, placeId } = readOnePlace(tobelBraunau("Tobel-Braunau, Thurgau, Switzerland"));
    expect(fact.place).toBe("Tobel-Braunau, Thurgau, Switzerland");
    expect(fact.standard_place).toBe("Braunau, Thurgau, Switzerland");
    expect(placeId).toBe("11861494");
  });

  it("yields nothing when place.original is the text of another candidate than the one chosen (FVFW-Y6P)", () => {
    // FamilySearch's own text names Tobel while place.description names Braunau.
    for (const original of [
      "Tobel, Tobel-Tägerschen, Thurgau, Switzerland",
      "Tobel, Tobel-Tägerschen, Thurgau, Switzerland ",
      // Braunau's text, but under two ids: 11861494 and 3057466.
      "Braunau, Thurgau, Switzerland",
    ]) {
      const { fact, placeId } = readOnePlace(tobelBraunau(original));
      expect([fact.place, fact.standard_place, placeId]).toEqual([original, undefined, undefined]);
    }
  });

  it("ignores an Interpreted value that names no place (6CY2-PL2S)", () => {
    const { fact, placeId } = readOnePlace({
      original: "Yabebyry",
      fields: [
        {
          type: PLACE_FIELD,
          values: [
            originalValue("Yabebyry", "PR_BIR_PLACE_ORIG"),
            interpretedValue("Yabebyry", undefined, { labelId: "PR_BIR_PLACE" }),
          ],
        },
      ],
    });
    expect(fact.place).toBe("Yabebyry");
    expect(fact.standard_place).toBeUndefined();
    expect(placeId).toBeUndefined();
  });

  it("counts only a value whose resource is a place description (an authorities place id read as one is another place)", () => {
    // Finland's authorities place id 1927095 is, as a representation id, Mingary, South Australia.
    for (const resource of [
      "#place_1927095",
      "#1927095",
      "https://api.familysearch.org/authorities/v1/place/1927095",
      `${placeUrl("1927095")}?flag=fsh`,
    ]) {
      const { fact, placeId } = readOnePlace({
        original: "Porvoo, Uusimaa, Finland",
        fields: [{ type: PLACE_FIELD, values: [{ type: "http://gedcomx.org/Interpreted", text: "Finland", resource }] }],
      });
      expect([resource, fact.standard_place, placeId]).toEqual([resource, undefined, undefined]);
    }
    const { fact, placeId } = readOnePlace({
      original: "Porvoo, Uusimaa, Finland",
      fields: [{ type: PLACE_FIELD, values: [interpretedValue("Porvoo, Uusimaa, Finland", "436389")] }],
    });
    expect([fact.standard_place, placeId]).toEqual(["Porvoo, Uusimaa, Finland", "436389"]);
  });

  it("passes over a Preferred value that names no place and lets place.description decide (SGZQ-Y3L)", () => {
    const { fact, placeId } = readOnePlace({
      original: "Saint Peter, Carmarthenshire, Wales",
      description: "#place_10579589",
      fields: [
        {
          type: PLACE_FIELD,
          values: [
            interpretedValue("Carmarthen, Carmarthenshire, Wales, United Kingdom", "10579589"),
            interpretedValue("St Peter Carmarthen, Carmarthenshire, Wales, United Kingdom", "10579913"),
            interpretedValue("Carmarthen, Carmarthenshire, Wales, United Kingdom", "10579588"),
            interpretedValue("Saint Peter, Carmarthenshire, Wales", undefined, { preferred: true }),
          ],
        },
        { type: "http://gedcomx.org/Town", values: [originalValue("Carmarthen", "EVENT_TOWN_ORIG")] },
      ],
    });
    expect(fact.place).toBe("Saint Peter, Carmarthenshire, Wales");
    expect(fact.standard_place).toBe("Carmarthen, Carmarthenshire, Wales, United Kingdom");
    expect(placeId).toBe("10579589");
  });

  it("does not count a Preferred Original value that names a place, on a relationship fact too (QK9S-KLJK)", () => {
    // An Original value can carry a place resource (6NG4-MVP3) and be marked
    // Preferred (this record). Only an Interpreted value is a standard.
    const { doc, placeIds } = toSimplifiedRecordRead({
      persons: [{ id: "p1" }, { id: "p2" }],
      relationships: [
        {
          type: "http://gedcomx.org/Couple",
          person1: { resource: "#p1" },
          person2: { resource: "#p2" },
          facts: [
            {
              type: "http://gedcomx.org/Marriage",
              place: {
                original: "Ramore, Ontario, Canada",
                description: "#place_9159962",
                fields: [
                  {
                    type: PLACE_FIELD,
                    values: [
                      {
                        ...originalValue("Ramore, Ontario, Canada"),
                        resource: placeUrl("9159962"),
                        qualifiers: PREFERRED,
                      },
                      interpretedValue("Ramore, Black River-Matheson Township, Cochrane, Ontario, Canada", "9159962"),
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const fact = doc.relationships![0].facts![0];
    expect(fact.place).toBe("Ramore, Ontario, Canada");
    expect(fact.standard_place).toBe("Ramore, Black River-Matheson Township, Cochrane, Ontario, Canada");
    expect(placeIds.get(fact)).toEqual({ placeId: "9159962", original: "Ramore, Ontario, Canada" });
  });

  it("yields nothing when the candidates disagree and nothing chooses between them (65TF-GJMJ without its description)", () => {
    const { fact, placeId } = readOnePlace({
      original: "San Cristóbal",
      fields: [
        {
          type: PLACE_FIELD,
          values: [
            interpretedValue("San Cristóbal, Dominican Republic", "3165"),
            interpretedValue("San Cristóbal, San Cristóbal, Dominican Republic", "448307"),
          ],
        },
      ],
    });
    expect(fact.standard_place).toBeUndefined();
    expect(placeId).toBeUndefined();
  });

  it("yields nothing when two Preferred candidates disagree", () => {
    const { fact } = readOnePlace({
      original: "Boda",
      fields: [
        {
          type: PLACE_FIELD,
          values: [
            interpretedValue("Boda, Kopparberg, Sweden", "3461825", { preferred: true }),
            interpretedValue("Boda, Rättvik, Dalarna, Sweden", "6666548", { preferred: true }),
          ],
        },
      ],
    });
    expect(fact.standard_place).toBeUndefined();
  });

  it("yields nothing when the candidates agree on the name but name two places (SGZQ-Y3L's pair)", () => {
    // record_read names a standard only by its place id, so a name with two ids
    // would keep FamilySearch's own text.
    const { fact, placeId } = readOnePlace({
      original: "Carmarthen",
      fields: [
        {
          type: PLACE_FIELD,
          values: [
            interpretedValue("Carmarthen, Carmarthenshire, Wales, United Kingdom", "10579589"),
            interpretedValue("Carmarthen, Carmarthenshire, Wales, United Kingdom", "10579588"),
          ],
        },
      ],
    });
    expect(fact.place).toBe("Carmarthen");
    expect(fact.standard_place).toBeUndefined();
    expect(placeId).toBeUndefined();
  });

  it("yields nothing when place.description names a place no candidate carries (71LN-7LN2's shape)", () => {
    const { fact, placeId } = readOnePlace({
      original: "Київ, Київська, Российская империя",
      description: "#place_11692585",
      fields: [
        {
          type: PLACE_FIELD,
          values: [interpretedValue("Київ, Київська, Российская империя", "10932640")],
        },
      ],
    });
    expect(fact.standard_place).toBeUndefined();
    expect(placeId).toBeUndefined();
  });

  it("keeps place.normalized ahead of an Interpreted value place.description names, and exposes no place id (71LN-7LN2)", () => {
    const place: RawPlace = {
      original: "Київ, Київська, Российская империя",
      normalized: [{ lang: "en", value: "Kyiv, Kiev Governorate, Russian Empire" }],
      description: "#place_11692585",
      fields: [
        {
          type: PLACE_FIELD,
          values: [interpretedValue("Київ, Київська, Российская империя", "11692585")],
        },
      ],
    };
    const { fact, placeId } = readOnePlace(place);
    expect(fact.place).toBe("Київ, Київська, Российская империя");
    expect(fact.standard_place).toBe("Kyiv, Kiev Governorate, Russian Empire");
    expect(placeId).toBeUndefined();
    // Without `normalized` the same value is chosen, so precedence alone decides.
    const { normalized: _normalized, ...withoutNormalized } = place;
    expect(readOnePlace(withoutNormalized).fact.standard_place).toBe("Київ, Київська, Российская империя");
  });

  it("reads Interpreted values from the Place field only", () => {
    const { fact } = readOnePlace({
      original: "Ramore",
      fields: [{ type: "http://gedcomx.org/City", values: [interpretedValue("Ramore, Ontario, Canada", "9159962")] }],
    });
    expect(fact.standard_place).toBeUndefined();
  });

  it("gives a non-place phrase no standard form from an Interpreted value either", () => {
    const { fact, placeId } = readOnePlace({
      original: "Same House",
      fields: [{ type: PLACE_FIELD, values: [interpretedValue("Same, Manufahi, Timor-Leste", "123")] }],
    });
    expect(fact.place).toBe("Same House");
    expect(fact.standard_place).toBeUndefined();
    expect(placeId).toBeUndefined();
  });
});

describe("gedcomx-convert — a record read's as-written place when place.original holds the standardized text", () => {
  it("takes the Original value when place.original is the Interpreted text, and keeps place.original for record_read (6NG4-MVP3)", () => {
    const { fact, placeId, original } = readOnePlace({
      original: "Faial, Santana, Madeira, Portugal",
      fields: [
        {
          type: PLACE_FIELD,
          values: [
            originalValue("dos Mainhos", "PR_RES_PLACE_ORIG"),
            interpretedValue("Faial, Santana, Madeira, Portugal", "1831208", {
              preferred: true,
              labelId: "PR_RES_PLACE",
            }),
          ],
        },
      ],
    });
    expect(fact.place).toBe("dos Mainhos");
    expect(fact.standard_place).toBe("Faial, Santana, Madeira, Portugal");
    expect(placeId).toBe("1831208");
    expect(original).toBe("Faial, Santana, Madeira, Portugal");
  });

  it("keeps place.original when no standard_place survives, so the standardized text is not lost (NQ2T-HP1)", () => {
    const { fact } = readOnePlace({
      original: "Santiago de Puriscal, Santiago, San José, Costa Rica",
      fields: [
        {
          type: PLACE_FIELD,
          values: [
            originalValue("Santiago, San José, Costa Rica"),
            interpretedValue("Santiago de Puriscal, Santiago, San José, Costa Rica", undefined, { preferred: true }),
          ],
        },
      ],
    });
    expect(fact.place).toBe("Santiago de Puriscal, Santiago, San José, Costa Rica");
    expect(fact.standard_place).toBeUndefined();
  });

  it("keeps place.original when the as-written text is a non-place phrase", () => {
    const { fact } = readOnePlace({
      original: "Salem, Essex, Massachusetts, United States",
      fields: [
        {
          type: PLACE_FIELD,
          values: [
            originalValue("Same House"),
            interpretedValue("Salem, Essex, Massachusetts, United States", "1234"),
          ],
        },
      ],
    });
    expect(fact.place).toBe("Salem, Essex, Massachusetts, United States");
    expect(fact.standard_place).toBeUndefined();
  });

  it("keeps place.original when it is no Interpreted text", () => {
    const { fact } = readOnePlace({
      original: "Salem",
      fields: [
        {
          type: PLACE_FIELD,
          values: [
            originalValue("Salem, Massachusetts"),
            interpretedValue("Salem, Essex, Massachusetts, United States", "1234"),
          ],
        },
      ],
    });
    expect(fact.place).toBe("Salem");
  });

  it("keeps place.original when the Place field holds two different Original texts", () => {
    const { fact } = readOnePlace({
      original: "Salem, Essex, Massachusetts, United States",
      fields: [
        {
          type: PLACE_FIELD,
          values: [
            originalValue("Salem, Massachusetts, United States"),
            originalValue("Salem", "EVENT_TOWN_ORIG"),
            interpretedValue("Salem, Essex, Massachusetts, United States", "1234"),
          ],
        },
      ],
    });
    expect(fact.place).toBe("Salem, Essex, Massachusetts, United States");
  });
});

describe("gedcomx-convert — a record read's as-written place keeps a census's relationship decision", () => {
  // The code extractor decides the relationship column from
  // `standard_place ?? place`. The as-written text here lacks the country the
  // column table reads; the standardized text in place.original carries it.
  const standardized = "Salem, Essex, Massachusetts, United States";
  const asWritten = originalValue("Salem, Massachusetts");
  type PlaceValue = ReturnType<typeof originalValue> | ReturnType<typeof interpretedValue>;
  const census = (values: PlaceValue[]) => {
    const person = (id: string, given: string, gender: string): GedcomXPerson => ({
      id,
      gender: { type: `http://gedcomx.org/${gender}` },
      names: [
        {
          nameForms: [
            {
              parts: [
                { type: "http://gedcomx.org/Given", value: given },
                { type: "http://gedcomx.org/Surname", value: "Ward" },
              ],
            },
          ],
        },
      ],
      facts: [
        {
          type: "http://gedcomx.org/Census",
          date: { original: "1880" },
          place: { original: standardized, fields: [{ type: PLACE_FIELD, values }] },
        },
      ],
    });
    const { doc } = toSimplifiedRecordRead({
      persons: [person("p1", "John", "Male"), person("p2", "Mary", "Female")],
    });
    const out = extractRecord(
      {
        recordId: "ark:/61903/1:1:TEST-SLM1",
        gedcomx: doc,
        indexFields: {
          p1: { relationshipToHead: "Head", householdId: "1" },
          p2: { relationshipToHead: "Wife", householdId: "1" },
        },
      },
      { logEntryId: "l_001", questionIds: ["q_001"] },
    );
    const relationships = out.assertions.filter((a) => a.fact_type === "relationship").map((a) => a.value);
    return { fact: doc.persons![0].facts![0], stated: out.censusStatesRelationships, relationships };
  };

  it("the as-written text alone decides nothing", () => {
    expect(censusStatedRelationships("Salem, Massachusetts", 1880)).toBeNull();
  });

  it("keeps the standardized text and its relationships when FamilySearch's value names no place", () => {
    const { fact, stated, relationships } = census([asWritten, interpretedValue(standardized)]);
    expect(fact.place).toBe(standardized);
    expect(fact.standard_place).toBeUndefined();
    expect(stated).toBe(true);
    expect(relationships).toEqual(["wife of John Ward"]);
  });

  it("keeps the standardized text and its relationships when the candidates are ambiguous", () => {
    const { fact, relationships } = census([
      asWritten,
      interpretedValue(standardized, "1234"),
      interpretedValue("Salem, Salem, Massachusetts, United States", "5678"),
    ]);
    expect(fact.place).toBe(standardized);
    expect(fact.standard_place).toBeUndefined();
    expect(relationships).toEqual(["wife of John Ward"]);
  });

  it("decides from the standard_place when the as-written text takes its place", () => {
    const { fact, relationships } = census([asWritten, interpretedValue(standardized, "1234")]);
    expect(fact.place).toBe("Salem, Massachusetts");
    expect(fact.standard_place).toBe(standardized);
    expect(relationships).toEqual(["wife of John Ward"]);
  });
});

describe("gedcomx-convert — toSimplified (search and tree responses) reads no Place field", () => {
  it("takes no standard_place from an Interpreted value, leaving the fact to the resolver pass (71LN-7LN2)", () => {
    // A search response's Interpreted text is often the as-written text, and a
    // value here would stop record_search's standardizePlaces filling the fact.
    const fact = simplifyOnePlace({
      original: "Київ, Київська, Российская империя",
      description: "#11692585",
      fields: [
        {
          type: PLACE_FIELD,
          values: [interpretedValue("Київ, Київська, Российская империя", "11692585")],
        },
      ],
    });
    expect(fact.place).toBe("Київ, Київська, Российская империя");
    expect(fact.standard_place).toBeUndefined();
  });

  it("keeps place.original where a record read would take the Original value", () => {
    const fact = simplifyOnePlace({
      original: "Faial, Santana, Madeira, Portugal",
      normalized: [{ lang: "en", value: "Faial, Santana, Madeira, Portugal" }],
      fields: [
        {
          type: PLACE_FIELD,
          values: [
            originalValue("dos Mainhos", "PR_RES_PLACE_ORIG"),
            interpretedValue("Faial, Santana, Madeira, Portugal", "1831208", {
              preferred: true,
              labelId: "PR_RES_PLACE",
            }),
          ],
        },
      ],
    });
    expect(fact.place).toBe("Faial, Santana, Madeira, Portugal");
    expect(fact.standard_place).toBe("Faial, Santana, Madeira, Portugal");
  });
});

describe("gedcomx-convert — coverage.standard_place from the response's places[]", () => {
  const coverageSource = (id: string, description: string) => ({
    id,
    resourceType: "http://gedcomx.org/Record",
    coverage: [{ spatial: { description }, recordType: "http://gedcomx.org/Census" }],
  });

  it("names a coverage place that places[] names, by fragment or by URL (search response, 261-…-K28)", () => {
    const out = toSimplified({
      sourceDescriptions: [
        coverageSource("src_r_180787103925", "#10593184"),
        coverageSource("src_r_2", "https://www.familysearch.org/platform/places/description/10593184"),
      ],
      places: [
        {
          id: "10593184",
          names: [{ value: "Rosskeen, Ross-shire, Scotland, United Kingdom" }],
          latitude: 57.7,
          longitude: -4.2,
        },
      ],
    } as GedcomX);
    for (const source of out.sources ?? []) {
      expect(source.coverage).toEqual({
        place_rep_id: "10593184",
        standard_place: "Rosskeen, Ross-shire, Scotland, United Kingdom",
        record_type: "Census",
      });
    }
    expect(out.places?.[0]?.name).toBe("Rosskeen, Ross-shire, Scotland, United Kingdom");
  });

  it("leaves standard_place unset when places[] does not name the coverage place (record read, SGZQ-Y3L)", () => {
    const out = toSimplified({
      sourceDescriptions: [
        coverageSource("src_r_1433233710", placeUrl("10579589")),
        coverageSource("src_r_0", "#0"),
      ],
      places: [{ id: "place_10579589" }],
    } as GedcomX);
    expect(out.sources?.[0]?.coverage).toEqual({ place_rep_id: "10579589", record_type: "Census" });
    expect(out.sources?.[1]?.coverage).toEqual({ place_rep_id: "0", record_type: "Census" });
  });

  it("copies no name from a record read's places[], whose entries are place_<id>: record_read names its coverage by id", () => {
    // Constructed: no record read in the sample names its places[] entries. A
    // name copied here would survive record_read, which clears no coverage name
    // it declines to give (X1SW-6LB's authorities reference).
    const body = {
      sourceDescriptions: [
        coverageSource("src_r_1433233710", placeUrl("10579589")),
        coverageSource("sd_c_1778464", "#place_1927095"),
      ],
      places: [
        { id: "place_10579589", names: [{ value: "Carmarthen, Carmarthenshire, Wales, United Kingdom" }] },
        { id: "place_1927095", names: [{ value: "Finland" }] },
      ],
    } as GedcomX;
    for (const out of [toSimplified(body), toSimplifiedRecordRead(body).doc]) {
      expect(out.sources?.map((s) => s.coverage)).toEqual([
        { place_rep_id: "10579589", record_type: "Census" },
        { place_rep_id: "1927095", record_type: "Census" },
      ]);
    }
  });
});

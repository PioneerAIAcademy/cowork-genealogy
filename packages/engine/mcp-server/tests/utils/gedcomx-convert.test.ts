import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { toSimplified, toGedcomX } from "../../src/utils/gedcomx-convert.js";
import type {
  GedcomX,
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
    const messages = warnSpy.mock.calls.map((args) => String(args[0]));
    expect(messages.some((m) => m.includes("Nickname"))).toBe(true);
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

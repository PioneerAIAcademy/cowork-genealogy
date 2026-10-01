import { LOCAL } from "../../src/auth/principal.js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: vi.fn(),
}));

// Place standardization runs inside the converter now; stub the network
// resolver so these tool tests stay offline and deterministic (no standard_place
// is added — that behavior is covered in gedcomx-standardize.test.ts).
vi.mock("../../src/utils/place-resolver.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/utils/place-resolver.js")>();
  return { ...actual, resolveStandardPlace: vi.fn().mockResolvedValue(null) };
});

import { personReadTool } from "../../src/tools/person-read.js";
import { getValidToken } from "../../src/auth/refresh.js";
import type { FSTreeResponse } from "../../src/types/person-read.js";

const mockedGetValidToken = vi.mocked(getValidToken);
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  mockedGetValidToken.mockReset();
  mockedGetValidToken.mockResolvedValue("test-token");
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The person TREE reads made so far: memories and portrait pages are other
 *  endpoints and are not counted. Sources are always read now, so every
 *  non-living subject also pages its memories; counting those would make each
 *  fan-out assertion depend on the memories leg. */
function treeReads(): string[] {
  return mockFetch.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => /\/tree\/persons\/[^/?]+(\?|$)/.test(u));
}

// ─── Fixtures ─────────────────────────────────────────────────────────────

function mockOk(body: FSTreeResponse): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    headers: new Headers(),
  });
}

function mockStatus(status: number, location?: string): void {
  const headers = new Headers();
  if (location) headers.set("location", location);
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: () => Promise.resolve({}),
    headers,
  });
}

const PERSON_ONLY: FSTreeResponse = {
  persons: [
    {
      id: "KNDX-MKG",
      living: false,
      gender: { type: "http://gedcomx.org/Male" },
      names: [
        {
          nameForms: [
            {
              parts: [
                { type: "http://gedcomx.org/Prefix", value: "President" },
                { type: "http://gedcomx.org/Given", value: "George" },
                { type: "http://gedcomx.org/Surname", value: "Washington" },
                { type: "http://gedcomx.org/Suffix", value: "Jr." },
              ],
            },
          ],
        },
      ],
      facts: [
        {
          type: "http://gedcomx.org/Birth",
          date: { original: "22 February 1732" },
          place: { original: "Westmoreland, Virginia" },
        },
        {
          type: "http://gedcomx.org/Occupation",
          date: { original: "1749" },
          value: "Surveyor",
        },
        { type: "data:,Elected", date: { original: "1774" }, value: "Continental Congress" },
      ],
    },
  ],
};

const WITH_RELATIVES: FSTreeResponse = {
  persons: [
    {
      id: "KNDX-MKG",
      living: false,
      gender: { type: "http://gedcomx.org/Male" },
      names: [
        {
          nameForms: [
            {
              parts: [
                { type: "http://gedcomx.org/Given", value: "George" },
                { type: "http://gedcomx.org/Surname", value: "Washington" },
              ],
            },
          ],
        },
      ],
    },
    {
      id: "KNDX-MFX",
      living: false,
      gender: { type: "http://gedcomx.org/Male" },
      names: [
        {
          nameForms: [
            {
              parts: [
                { type: "http://gedcomx.org/Given", value: "Augustine" },
                { type: "http://gedcomx.org/Surname", value: "Washington" },
                { type: "http://gedcomx.org/Suffix", value: "Sr." },
              ],
            },
          ],
        },
      ],
    },
    {
      id: "KNZC-6QV",
      living: false,
      gender: { type: "http://gedcomx.org/Female" },
      names: [
        {
          nameForms: [
            {
              parts: [
                { type: "http://gedcomx.org/Given", value: "Martha" },
                { type: "http://gedcomx.org/Surname", value: "Dandridge" },
              ],
            },
          ],
        },
      ],
    },
  ],
  // FS includes bare ParentChild entries here (no subtype facts) —
  // the tool drops these and uses the CAPR-derived synthetics instead.
  // Refs use `resourceId` (bare ID), matching the production response
  // shape — the FS tree API does not return `resource` here.
  relationships: [
    {
      type: "http://gedcomx.org/ParentChild",
      person1: { resourceId: "KNDX-MFX" },
      person2: { resourceId: "KNDX-MKG" },
    },
    {
      type: "http://gedcomx.org/Couple",
      person1: { resourceId: "KNDX-MKG" },
      person2: { resourceId: "KNZC-6QV" },
      facts: [
        {
          type: "http://gedcomx.org/Marriage",
          date: { original: "6 January 1759" },
          place: { original: "New Kent, Virginia" },
        },
      ],
    },
  ],
  childAndParentsRelationships: [
    {
      parent1: { resourceId: "KNDX-MFX" },
      child: { resourceId: "KNDX-MKG" },
      parent1Facts: [{ type: "http://gedcomx.org/BiologicalParent" }],
    },
  ],
};

const WITH_SOURCES: FSTreeResponse = {
  persons: [
    {
      id: "KNDX-MKG",
      living: false,
      gender: { type: "http://gedcomx.org/Male" },
      names: [
        {
          nameForms: [
            {
              parts: [
                { type: "http://gedcomx.org/Given", value: "George" },
                { type: "http://gedcomx.org/Surname", value: "Washington" },
              ],
            },
          ],
        },
      ],
    },
  ],
  sourceDescriptions: [
    {
      id: "7X6N-4WR",
      about: "https://familysearch.org/ark:/61903/1:1:QRHS-D1T2",
      titles: [{ value: "Revolutionary War Rosters" }],
      citations: [{ value: "FamilySearch citation text" }],
      notes: [{ value: "Note 1" }, { value: "Note 2" }],
    },
    {
      id: "SD_METADATA_1",
      about: "https://example.com/metadata",
      titles: [{ value: "Metadata entry to filter" }],
    },
    {
      id: "Q1KF-5FS",
      about: "https://www.mountvernon.org/",
      titles: [{ value: "Mount Vernon" }],
    },
  ],
};

// #2002: FS lists an AlsoKnownAs name *before* the preferred BirthName, and
// carries the tree-person ARK as a Persistent identifier resolver URL.
const MULTI_NAME: FSTreeResponse = {
  persons: [
    {
      id: "KNDX-MKG",
      living: false,
      gender: { type: "http://gedcomx.org/Male" },
      identifiers: {
        "http://gedcomx.org/Persistent": [
          "https://familysearch.org/ark:/61903/4:1:KNDX-MKG",
        ],
      },
      names: [
        {
          type: "http://gedcomx.org/AlsoKnownAs",
          nameForms: [
            {
              parts: [
                { type: "http://gedcomx.org/Given", value: "Georgie" },
                { type: "http://gedcomx.org/Surname", value: "Washington" },
              ],
            },
          ],
        },
        {
          id: "name-birth-1",
          type: "http://gedcomx.org/BirthName",
          preferred: true,
          nameForms: [
            {
              parts: [
                { type: "http://gedcomx.org/Prefix", value: "President" },
                { type: "http://gedcomx.org/Given", value: "George" },
                { type: "http://gedcomx.org/Surname", value: "Washington" },
                { type: "http://gedcomx.org/Suffix", value: "Jr." },
              ],
            },
          ],
        },
      ],
    },
  ],
};

// #2002: the real `LZPL-493` payload from
// `dev/explore-preferred-name-relatives.ts` against `LHKH-XKK?relatives=true`.
// FamilySearch puts the initials-only alternate at names[0] and the preferred
// full name last — 8 of the 12 persons in that probe carry an alternate ahead
// of the primary. `LZPL-493` reaches the tool as a RELATIVE, which is the path
// that had no `preferred` coverage at all. The Couple relationship is
// scaffolding to make it a non-anchor person; the probe recorded the names and
// the ARK, not how the two are related. Clorinda's five real names are trimmed
// to two; hers is already preferred-first upstream.
const RELATIVE_INITIALS_ALTERNATE: FSTreeResponse = {
  persons: [
    {
      id: "LHKH-XKK",
      living: false,
      gender: { type: "http://gedcomx.org/Female" },
      identifiers: {
        "http://gedcomx.org/Persistent": [
          "https://familysearch.org/ark:/61903/4:1:LHKH-XKK",
        ],
      },
      names: [
        {
          preferred: true,
          type: "http://gedcomx.org/BirthName",
          nameForms: [
            {
              parts: [
                { type: "http://gedcomx.org/Given", value: "Clorinda" },
                { type: "http://gedcomx.org/Surname", value: "Sleeper" },
              ],
            },
          ],
        },
        {
          type: "http://gedcomx.org/BirthName",
          nameForms: [
            {
              parts: [
                { type: "http://gedcomx.org/Given", value: "C" },
                { type: "http://gedcomx.org/Surname", value: "Sleeper" },
              ],
            },
          ],
        },
      ],
    },
    {
      id: "LZPL-493",
      living: false,
      gender: { type: "http://gedcomx.org/Male" },
      identifiers: {
        "http://gedcomx.org/Persistent": [
          "https://familysearch.org/ark:/61903/4:1:LZPL-493",
        ],
      },
      names: [
        {
          type: "http://gedcomx.org/BirthName",
          nameForms: [
            {
              parts: [
                { type: "http://gedcomx.org/Given", value: "R B" },
                { type: "http://gedcomx.org/Surname", value: "Torrance" },
              ],
            },
          ],
        },
        {
          type: "http://gedcomx.org/BirthName",
          nameForms: [
            {
              parts: [
                { type: "http://gedcomx.org/Given", value: "Blake" },
                { type: "http://gedcomx.org/Surname", value: "Torrance" },
              ],
            },
          ],
        },
        {
          preferred: true,
          type: "http://gedcomx.org/BirthName",
          nameForms: [
            {
              parts: [
                { type: "http://gedcomx.org/Given", value: "Robert Blake" },
                { type: "http://gedcomx.org/Surname", value: "Torrance" },
              ],
            },
          ],
        },
      ],
    },
  ],
  relationships: [
    {
      type: "http://gedcomx.org/Couple",
      person1: { resourceId: "LZPL-493" },
      person2: { resourceId: "LHKH-XKK" },
    },
  ],
};

// ─── Tests ────────────────────────────────────────────────────────────────

describe("personReadTool", () => {
  // 1. Returns simplified person for valid ID
  it("returns simplified person for a valid ID", async () => {
    mockOk(PERSON_ONLY);
    const result = await personReadTool({ personId: "KNDX-MKG" }, LOCAL);
    expect(result.persons).toHaveLength(1);
    expect(result.persons[0].id).toBe("KNDX-MKG");
    expect(result.persons[0].gender).toBe("Male");
    expect(result.persons[0].living).toBe(false);
    expect(result.persons[0].names[0].given).toBe("George");
    expect(result.persons[0].names[0].surname).toBe("Washington");
  });

  // 2. Includes relatives in persons[] and relationships[] when flag set
  it("includes relatives when relatives flag is set", async () => {
    mockOk(WITH_RELATIVES);
    const result = await personReadTool({ personId: "KNDX-MKG", relatives: true }, LOCAL);
    expect(result.persons.length).toBeGreaterThan(1);
    expect(result.relationships.length).toBeGreaterThan(0);
    // The relatives flag must be encoded into the request URL.
    expect(String(mockFetch.mock.calls[0][0])).toContain("relatives=true");
  });

  // 3. Includes sources[] when flag set
  it("includes sources when sourceDescriptions flag is set", async () => {
    mockOk(WITH_SOURCES);
    const result = await personReadTool({ personId: "KNDX-MKG", sourceDescriptions: true }, LOCAL);
    expect(result.sources.length).toBeGreaterThan(0);
    // The sourceDescriptions flag must be encoded into the request URL.
    expect(String(mockFetch.mock.calls[0][0])).toContain(
      "sourceDescriptions=true",
    );
  });

  // 3b. The flags are ignored: a caller cannot suppress relatives or sources
  it.each([
    [{}],
    [{ relatives: false, sourceDescriptions: false }],
  ])("a caller cannot suppress relatives or sources (%j)", async (flags) => {
    mockOk({ ...WITH_RELATIVES, sourceDescriptions: WITH_SOURCES.sourceDescriptions });
    const result = await personReadTool({ personId: "KNDX-MKG", ...flags }, LOCAL);
    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).toContain("relatives=true");
    expect(url).toContain("sourceDescriptions=true");
    expect(result.relationships.length).toBeGreaterThan(0);
    expect(result.sources.length).toBeGreaterThan(0);
  });

  // 4. Returns both when both flags set
  it("returns both family and sources when both flags set", async () => {
    const combined: FSTreeResponse = {
      ...WITH_RELATIVES,
      sourceDescriptions: WITH_SOURCES.sourceDescriptions,
    };
    mockOk(combined);
    const result = await personReadTool({
      personId: "KNDX-MKG",
      relatives: true,
      sourceDescriptions: true,
    }, LOCAL);
    expect(result.persons.length).toBeGreaterThan(1);
    expect(result.relationships.length).toBeGreaterThan(0);
    expect(result.sources.length).toBeGreaterThan(0);
  });

  // 5. Returns empty relationships/sources when flags are false
  it("returns empty relationships and sources when flags are unset", async () => {
    mockOk(PERSON_ONLY);
    const result = await personReadTool({ personId: "KNDX-MKG" }, LOCAL);
    expect(result.relationships).toEqual([]);
    expect(result.sources).toEqual([]);
  });

  // 6. Strips URI prefixes from fact types
  it("strips URI prefixes from fact types", async () => {
    mockOk(PERSON_ONLY);
    const result = await personReadTool({ personId: "KNDX-MKG" }, LOCAL);
    const facts = result.persons[0].facts ?? [];
    expect(facts.find((f) => f.type === "Birth")).toBeDefined();
    expect(facts.find((f) => f.type === "Occupation")).toBeDefined();
  });

  // 7. Handles data: prefix custom fact types
  it("strips data:, prefix from custom fact types", async () => {
    mockOk(PERSON_ONLY);
    const result = await personReadTool({ personId: "KNDX-MKG" }, LOCAL);
    const facts = result.persons[0].facts ?? [];
    expect(facts.find((f) => f.type === "Elected")).toBeDefined();
    expect(facts.find((f) => f.type.startsWith("data:,"))).toBeUndefined();
  });

  // 8. Extracts given/surname from name parts
  it("extracts given and surname from name parts", async () => {
    mockOk(PERSON_ONLY);
    const result = await personReadTool({ personId: "KNDX-MKG" }, LOCAL);
    expect(result.persons[0].names[0].given).toBe("George");
    expect(result.persons[0].names[0].surname).toBe("Washington");
  });

  // 9. Handles missing given or surname gracefully
  it("falls back to empty string when given or surname is missing", async () => {
    const onlySurname: FSTreeResponse = {
      persons: [
        {
          id: "X",
          living: false,
          gender: { type: "http://gedcomx.org/Unknown" },
          names: [
            {
              nameForms: [
                {
                  parts: [{ type: "http://gedcomx.org/Surname", value: "Flynn" }],
                },
              ],
            },
          ],
        },
      ],
    };
    mockOk(onlySurname);
    const result = await personReadTool({ personId: "X" }, LOCAL);
    expect(result.persons[0].names[0].surname).toBe("Flynn");
    expect(result.persons[0].names[0].given).toBe("");
  });

  // 10. Filters SD_* metadata from sources
  it("filters out SD_* metadata source entries", async () => {
    mockOk(WITH_SOURCES);
    const result = await personReadTool({
      personId: "KNDX-MKG",
      sourceDescriptions: true,
    }, LOCAL);
    const sdIds = result.sources.filter((s) => s.id.startsWith("SD_"));
    expect(sdIds).toHaveLength(0);
    expect(result.sources).toHaveLength(2);
  });

  // 11. Flattens source title/citation/url correctly
  it("flattens source title, citation, and url", async () => {
    mockOk(WITH_SOURCES);
    const result = await personReadTool({
      personId: "KNDX-MKG",
      sourceDescriptions: true,
    }, LOCAL);
    const s = result.sources.find((x) => x.id === "7X6N-4WR");
    expect(s).toBeDefined();
    expect(s?.title).toBe("Revolutionary War Rosters");
    expect(s?.citation).toBe("FamilySearch citation text");
    expect(s?.url).toBe("https://familysearch.org/ark:/61903/1:1:QRHS-D1T2");
  });

  // 12. Converts childAndParentsRelationships to ParentChild
  it("converts childAndParentsRelationships to ParentChild entries", async () => {
    mockOk(WITH_RELATIVES);
    const result = await personReadTool({ personId: "KNDX-MKG", relatives: true }, LOCAL);
    const pc = result.relationships.filter((r) => r.type === "ParentChild");
    expect(pc.length).toBeGreaterThan(0);
    const aug = pc.find(
      (r) => r.parent === "KNDX-MFX" && r.child === "KNDX-MKG",
    );
    expect(aug).toBeDefined();
  });

  // 13. Converts couple relationships with marriage facts
  it("converts couple relationships with marriage facts", async () => {
    mockOk(WITH_RELATIVES);
    const result = await personReadTool({ personId: "KNDX-MKG", relatives: true }, LOCAL);
    const couples = result.relationships.filter((r) => r.type === "Couple");
    expect(couples).toHaveLength(1);
    expect(couples[0].person1).toBe("KNDX-MKG");
    expect(couples[0].person2).toBe("KNZC-6QV");
    expect(couples[0].facts).toBeDefined();
    expect(couples[0].facts?.[0].type).toBe("Marriage");
    expect(couples[0].facts?.[0].date).toBe("6 January 1759");
    expect(couples[0].facts?.[0].standard_date).toBe("6 Jan 1759");
  });

  // 14. Keeps all relationships (no focal-person filtering)
  it("keeps all relationships even when not involving the focal person", async () => {
    // The intent of this test is that a relationship BETWEEN OTHER RETURNED
    // PEOPLE is kept — it is not about the focal person at all. It originally
    // expressed that with two ids absent from persons[], which conflated
    // "not involving the focal person" with "dangling". Both endpoints are now
    // returned persons, so it tests the thing it names; the dangling case is
    // asserted separately below.
    const withExtra: FSTreeResponse = {
      ...WITH_RELATIVES,
      childAndParentsRelationships: [
        ...(WITH_RELATIVES.childAndParentsRelationships ?? []),
        {
          parent1: { resourceId: "KNDX-MFX" },
          child: { resourceId: "KNZC-6QV" },
        },
      ],
    };
    mockOk(withExtra);
    const result = await personReadTool({ personId: "KNDX-MKG", relatives: true }, LOCAL);
    const extraneous = result.relationships.find(
      (r) =>
        r.type === "ParentChild" &&
        r.parent === "KNDX-MFX" &&
        r.child === "KNZC-6QV",
    );
    expect(extraneous).toBeDefined();
  });

  it("drops a relationship whose endpoint is not a returned person", async () => {
    // FamilySearch's relationship arrays reach one hop further than persons[].
    // An unresolvable endpoint is a HARD validator error and project_create —
    // which never calls sanitizeTree — refuses the ENTIRE write, so the edge
    // cannot be passed through.
    const withDangling: FSTreeResponse = {
      ...WITH_RELATIVES,
      childAndParentsRelationships: [
        ...(WITH_RELATIVES.childAndParentsRelationships ?? []),
        { parent1: { resourceId: "OTHR-PRT" }, child: { resourceId: "OTHR-CHD" } },
      ],
    };
    mockOk(withDangling);
    const result = await personReadTool({ personId: "KNDX-MKG", relatives: true }, LOCAL);
    const ids = new Set(result.persons.map((p) => p.id));
    for (const r of result.relationships) {
      for (const endpoint of [r.parent, r.child, r.person1, r.person2]) {
        if (endpoint !== undefined) expect(ids.has(endpoint)).toBe(true);
      }
    }
    expect(
      result.relationships.some((r) => r.parent === "OTHR-PRT"),
    ).toBe(false);
  });

  // 15. Extracts subtype from parent facts
  it("extracts subtype from parent facts (Biological, Step, etc.)", async () => {
    mockOk(WITH_RELATIVES);
    const result = await personReadTool({ personId: "KNDX-MKG", relatives: true }, LOCAL);
    const aug = result.relationships.find(
      (r) =>
        r.type === "ParentChild" &&
        r.parent === "KNDX-MFX" &&
        r.child === "KNDX-MKG",
    );
    expect(aug?.subtype).toBe("Biological");
  });

  // 16. Omits subtype when parent facts are absent
  it("omits subtype when parent facts are absent", async () => {
    const noFacts: FSTreeResponse = {
      persons: [
        { id: "P", living: false, gender: { type: "http://gedcomx.org/Male" }, names: [{ nameForms: [{ parts: [{ type: "http://gedcomx.org/Given", value: "P" }, { type: "http://gedcomx.org/Surname", value: "X" }] }] }] },
        { id: "C", living: false, gender: { type: "http://gedcomx.org/Male" }, names: [{ nameForms: [{ parts: [{ type: "http://gedcomx.org/Given", value: "C" }, { type: "http://gedcomx.org/Surname", value: "X" }] }] }] },
      ],
      childAndParentsRelationships: [
        { parent1: { resourceId: "P" }, child: { resourceId: "C" } },
      ],
    };
    mockOk(noFacts);
    const result = await personReadTool({ personId: "C", relatives: true }, LOCAL);
    const pc = result.relationships.find((r) => r.type === "ParentChild");
    expect(pc?.subtype).toBeUndefined();
  });

  // 17. Extracts prefix and suffix from name parts
  it("extracts prefix and suffix from name parts", async () => {
    mockOk(PERSON_ONLY);
    const result = await personReadTool({ personId: "KNDX-MKG" }, LOCAL);
    expect(result.persons[0].names[0].prefix).toBe("President");
    expect(result.persons[0].names[0].suffix).toBe("Jr.");
  });

  // 18. Includes notes on sources when present
  it("collects notes onto sources when present", async () => {
    mockOk(WITH_SOURCES);
    const result = await personReadTool({
      personId: "KNDX-MKG",
      sourceDescriptions: true,
    }, LOCAL);
    const s = result.sources.find((x) => x.id === "7X6N-4WR");
    expect(s?.notes).toEqual(["Note 1", "Note 2"]);
    // Source without notes shouldn't have the field at all.
    const noNotes = result.sources.find((x) => x.id === "Q1KF-5FS");
    expect(noNotes?.notes).toBeUndefined();
  });

  // 19. Throws auth error when not authenticated
  it("propagates auth errors from getValidToken", async () => {
    mockedGetValidToken.mockRejectedValueOnce(
      new Error("Call the login tool to authenticate."),
    );
    await expect(personReadTool({ personId: "X" }, LOCAL)).rejects.toThrow(
      /login tool/,
    );
  });

  // 20. Throws on 404
  it("throws on 404 person-not-found", async () => {
    mockStatus(404);
    await expect(personReadTool({ personId: "ZZZZ-ZZZ" }, LOCAL)).rejects.toThrow(
      /not found in the FamilySearch Family Tree/,
    );
  });

  // 21. Throws on 410
  it("throws on 410 person-deleted", async () => {
    mockStatus(410);
    await expect(personReadTool({ personId: "X" }, LOCAL)).rejects.toThrow(
      /has been deleted/,
    );
  });

  // 22. Throws on 403 restricted
  it("throws on 403 restricted person", async () => {
    mockStatus(403);
    await expect(personReadTool({ personId: "X" }, LOCAL)).rejects.toThrow(
      /restricted and cannot be viewed/,
    );
  });

  // 23. Follows 301 redirect
  it("follows 301 redirect to the new person ID", async () => {
    mockStatus(
      301,
      "https://api.familysearch.org/platform/tree/persons/GDZW-NZZ",
    );
    mockOk({
      persons: [
        {
          id: "GDZW-NZZ",
          living: false,
          gender: { type: "http://gedcomx.org/Male" },
          names: [
            {
              nameForms: [
                {
                  parts: [
                    { type: "http://gedcomx.org/Given", value: "Resolved" },
                    { type: "http://gedcomx.org/Surname", value: "Person" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const result = await personReadTool({ personId: "K2QT-J56" }, LOCAL);
    expect(result.persons[0].id).toBe("GDZW-NZZ");
    // The 301 and the redirected read; the memories leg is another endpoint.
    expect(treeReads()).toHaveLength(2);
  });

  // 24. Returns living=true on 204 response
  it("returns a stub person with living:true on 204", async () => {
    mockStatus(204);
    const result = await personReadTool({ personId: "PQD1-2T4" }, LOCAL);
    expect(result.persons).toHaveLength(1);
    expect(result.persons[0].id).toBe("PQD1-2T4");
    expect(result.persons[0].living).toBe(true);
    expect(result.persons[0].facts).toBeUndefined();
    expect(result.relationships).toEqual([]);
    expect(result.sources).toEqual([]);
  });

  // 25. Throws on 401 with re-authentication guidance
  it("throws on 401 with login guidance", async () => {
    mockStatus(401);
    await expect(personReadTool({ personId: "X" }, LOCAL)).rejects.toThrow(/login tool/);
  });

  // 25a. Recovery: 429 then 200 → returns the successful result
  it("recovers from a transient 429 and returns the person", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        json: () => Promise.resolve({}),
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(PERSON_ONLY),
        headers: new Headers(),
      });
    const result = await personReadTool({ personId: "KNDX-MKG" }, LOCAL);
    expect(result.persons[0].id).toBe("KNDX-MKG");
    // The 429 and its retry.
    expect(treeReads()).toHaveLength(2);
  });

  // 26. Rejects an empty personId before making any request
  it("rejects an empty personId without fetching", async () => {
    await expect(personReadTool({ personId: "  " }, LOCAL)).rejects.toThrow(
      /non-empty personId/,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // 27. Surfaces the canonical ARK lifted from the Persistent identifier
  it("surfaces ark from the Persistent identifier", async () => {
    mockOk(MULTI_NAME);
    const result = await personReadTool({ personId: "KNDX-MKG" }, LOCAL);
    expect(result.persons[0].ark).toBe("ark:/61903/4:1:KNDX-MKG");
  });

  // 28. Omits ark entirely when FS supplies no Persistent identifier
  it("omits ark when no Persistent identifier is present", async () => {
    mockOk(PERSON_ONLY);
    const result = await personReadTool({ personId: "KNDX-MKG" }, LOCAL);
    expect(result.persons[0].ark).toBeUndefined();
    expect("ark" in result.persons[0]).toBe(false);
  });

  // 29. Keeps every name FS returned, not just the first
  it("keeps all names rather than collapsing to the first", async () => {
    mockOk(MULTI_NAME);
    const result = await personReadTool({ personId: "KNDX-MKG" }, LOCAL);
    expect(result.persons[0].names).toHaveLength(2);
    expect(result.persons[0].names.map((n) => n.given)).toEqual([
      "George",
      "Georgie",
    ]);
  });

  // 30. Preferred name lands first and keeps its flag; alternates do not
  it("orders the preferred name first and flags only it", async () => {
    mockOk(MULTI_NAME);
    const [person] = (await personReadTool({ personId: "KNDX-MKG" }, LOCAL)).persons;
    expect(person.names[0].preferred).toBe(true);
    expect(person.names[0].type).toBe("BirthName");
    expect(person.names[1].preferred).toBeUndefined();
    expect(person.names[1].type).toBe("AlsoKnownAs");
  });

  // 31. Prefix/suffix are carried per name, not only on the first
  it("carries prefix and suffix on the name that has them", async () => {
    mockOk(MULTI_NAME);
    const [person] = (await personReadTool({ personId: "KNDX-MKG" }, LOCAL)).persons;
    expect(person.names[0].prefix).toBe("President");
    expect(person.names[0].suffix).toBe("Jr.");
    expect(person.names[1].prefix).toBeUndefined();
    expect(person.names[1].suffix).toBeUndefined();
  });

  // 32. Name id carries through (the name subschema requires it), and is
  // omitted rather than faked when FS supplies none.
  it("carries the name id through, omitting it when absent", async () => {
    mockOk(MULTI_NAME);
    const [person] = (await personReadTool({ personId: "KNDX-MKG" }, LOCAL)).persons;
    expect(person.names[0].id).toBe("name-birth-1");
    expect(person.names[1].id).toBeUndefined();
    expect("id" in person.names[1]).toBe(false);
  });

  // 33. names is required with minItems 1 — a nameless person keeps the stub
  it("falls back to one empty name when FS returns none", async () => {
    const nameless: FSTreeResponse = {
      persons: [
        { id: "X", living: false, gender: { type: "http://gedcomx.org/Unknown" } },
      ],
    };
    mockOk(nameless);
    const result = await personReadTool({ personId: "X" }, LOCAL);
    expect(result.persons[0].names).toEqual([{ given: "", surname: "" }]);
  });

  // 34. #2002 acceptance: a RELATIVE whose initials-only alternate precedes the
  // preferred full name keeps the full name at names[0]. Guards the #1318
  // reorder at the tool layer, which had no coverage — without it the tool
  // returns "R B Torrance", the exact symptom the alpha tester reported.
  it("keeps the preferred full name first for a relative with an initials alternate", async () => {
    mockOk(RELATIVE_INITIALS_ALTERNATE);
    const result = await personReadTool({
      personId: "LHKH-XKK",
      relatives: true,
    }, LOCAL);
    const rel = result.persons.find((p) => p.id === "LZPL-493");
    expect(rel).toBeDefined();
    expect(rel!.names[0].given).toBe("Robert Blake");
    expect(rel!.names[0].surname).toBe("Torrance");
    expect(rel!.names[0].preferred).toBe(true);
  });

  // 35. The alternates are kept, not discarded — including the initials form
  // the tester saw. Relative order within the non-preferred group is stable.
  it("keeps a relative's initials alternate behind the preferred name", async () => {
    mockOk(RELATIVE_INITIALS_ALTERNATE);
    const result = await personReadTool({
      personId: "LHKH-XKK",
      relatives: true,
    }, LOCAL);
    const rel = result.persons.find((p) => p.id === "LZPL-493")!;
    expect(rel.names).toHaveLength(3);
    expect(rel.names.map((n) => n.given)).toEqual([
      "Robert Blake",
      "R B",
      "Blake",
    ]);
    // Only the FS-preferred name carries the flag.
    expect(rel.names.filter((n) => n.preferred === true)).toHaveLength(1);
  });

  // 36. A relative carries its own ark — the only field that survives the
  // caller's re-ID to local ids still pointing at the FamilySearch person.
  it("emits ark for a relative, not just the anchor", async () => {
    mockOk(RELATIVE_INITIALS_ALTERNATE);
    const result = await personReadTool({
      personId: "LHKH-XKK",
      relatives: true,
    }, LOCAL);
    expect(result.persons.find((p) => p.id === "LHKH-XKK")!.ark).toBe(
      "ark:/61903/4:1:LHKH-XKK",
    );
    expect(result.persons.find((p) => p.id === "LZPL-493")!.ark).toBe(
      "ark:/61903/4:1:LZPL-493",
    );
  });

  // 37. An anchor already preferred-first is left alone — the reorder is
  // stable, not an unconditional rotation.
  it("leaves an already-preferred-first anchor in place", async () => {
    mockOk(RELATIVE_INITIALS_ALTERNATE);
    const result = await personReadTool({
      personId: "LHKH-XKK",
      relatives: true,
    }, LOCAL);
    const anchor = result.persons.find((p) => p.id === "LHKH-XKK")!;
    expect(anchor.names.map((n) => n.given)).toEqual(["Clorinda", "C"]);
    expect(anchor.names[0].preferred).toBe(true);
  });
});

// ─── Sibling fan-out (issue #1689 Half 1) ─────────────────────────────────

/**
 * Siblings are a SECOND hop — FamilySearch returns a person's parents but not
 * their brothers and sisters, so each parent must be read. One test per trap
 * the card names, plus the two the mapping turned up: a Couple edge fails
 * project_create the same way a ParentChild one does, and a child can have
 * more than two parents.
 *
 * Routing is by URL, never by call order: the parent reads run concurrently.
 */
describe("personReadTool — sibling fan-out", () => {
  const SUBJECT = "KNDX-MKG";
  const DAD = "DAD-001";
  const MUM = "MUM-002";

  const person = (id: string, name: string, living = false) => ({
    id,
    living,
    names: [{ nameForms: [{ fullText: name }] }],
    facts: [],
  });

  const capr = (child: string, parent1?: string, parent2?: string) => ({
    ...(parent1 ? { parent1: { resourceId: parent1 } } : {}),
    ...(parent2 ? { parent2: { resourceId: parent2 } } : {}),
    child: { resourceId: child },
  });

  /** The subject's own read: subject plus both parents. */
  const subjectBody = (parents: string[] = [DAD, MUM]): FSTreeResponse => ({
    persons: [
      person(SUBJECT, "Subject Person"),
      ...parents.map((p) => person(p, `Parent ${p}`)),
    ],
    relationships: [],
    childAndParentsRelationships: [capr(SUBJECT, parents[0], parents[1])],
  });

  /** Route by URL so concurrent parent reads cannot be order-dependent. */
  function route(bodies: Record<string, FSTreeResponse | number>) {
    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      for (const [pid, body] of Object.entries(bodies)) {
        if (!u.includes(`/${pid}`)) continue;
        if (typeof body === "number") {
          return Promise.resolve({
            ok: body >= 200 && body < 300,
            status: body,
            json: () => Promise.reject(new Error("no body")),
            headers: new Headers(),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(body),
          headers: new Headers(),
        });
      }
      return Promise.reject(new TypeError(`unrouted ${u}`));
    });
  }

  it("makes ZERO extra calls when the subject has no parents", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            persons: [person(SUBJECT, "Orphan Person")],
            relationships: [],
            childAndParentsRelationships: [],
          }),
        headers: new Headers(),
      }),
    );
    const out = await personReadTool(
      { personId: SUBJECT, relatives: true },
      LOCAL,
    );
    expect(out.persons.map((p) => p.id)).toEqual([SUBJECT]);
    expect(treeReads()).toHaveLength(1);
  });

  it("relatives: false does not suppress the fan-out", async () => {
    route({ [SUBJECT]: subjectBody() });
    await personReadTool({ personId: SUBJECT, relatives: false }, LOCAL);
    const reads = treeReads();
    expect(reads.some((u) => u.includes(`/${DAD}`))).toBe(true);
    expect(reads.some((u) => u.includes(`/${MUM}`))).toBe(true);
  });

  it("imports full siblings and links them to both parents", async () => {
    const sib = "SIB-100";
    route({
      [SUBJECT]: subjectBody(),
      [DAD]: {
        persons: [person(DAD, "Dad"), person(sib, "Full Sibling"), person(SUBJECT, "Subject Person")],
        relationships: [],
        childAndParentsRelationships: [capr(sib, DAD, MUM), capr(SUBJECT, DAD, MUM)],
      },
      [MUM]: {
        persons: [person(MUM, "Mum"), person(sib, "Full Sibling")],
        relationships: [],
        childAndParentsRelationships: [capr(sib, DAD, MUM)],
      },
    });
    const out = await personReadTool(
      { personId: SUBJECT, relatives: true },
      LOCAL,
    );
    expect(out.persons.map((p) => p.id).sort()).toEqual([DAD, MUM, SUBJECT, sib].sort());
    const edges = out.relationships
      .filter((r) => r.type === "ParentChild" && r.child === sib)
      .map((r) => r.parent)
      .sort();
    expect(edges).toEqual([DAD, MUM].sort());
  });

  it("dedupes a sibling reachable through BOTH parents", async () => {
    const sib = "SIB-100";
    route({
      [SUBJECT]: subjectBody(),
      [DAD]: {
        persons: [person(DAD, "Dad"), person(sib, "Shared Sibling")],
        relationships: [],
        childAndParentsRelationships: [capr(sib, DAD, MUM)],
      },
      [MUM]: {
        persons: [person(MUM, "Mum"), person(sib, "Shared Sibling")],
        relationships: [],
        childAndParentsRelationships: [capr(sib, DAD, MUM)],
      },
    });
    const out = await personReadTool(
      { personId: SUBJECT, relatives: true },
      LOCAL,
    );
    expect(out.persons.filter((p) => p.id === sib)).toHaveLength(1);
    expect(
      out.relationships.filter((r) => r.type === "ParentChild" && r.child === sib),
    ).toHaveLength(2); // one per parent, not four
  });

  it("does NOT import grandparents, other spouses, or step-parents", async () => {
    const gran = "GRAN-900";
    const otherWife = "WIFE2-901";
    const halfSib = "HALF-902";
    route({
      [SUBJECT]: subjectBody([DAD]),
      [DAD]: {
        persons: [
          person(DAD, "Dad"),
          person(gran, "Grandparent"),
          person(otherWife, "Dad's other wife"),
          person(halfSib, "Half Sibling"),
        ],
        relationships: [],
        childAndParentsRelationships: [
          capr(DAD, gran),                 // the grandparent link
          capr(halfSib, DAD, otherWife),   // half-sibling via a co-parent
        ],
      },
    });
    const out = await personReadTool(
      { personId: SUBJECT, relatives: true },
      LOCAL,
    );
    const ids = out.persons.map((p) => p.id);
    expect(ids).toContain(halfSib);
    expect(ids).not.toContain(gran);
    expect(ids).not.toContain(otherWife);
  });

  it("links a half-sibling to the SHARED parent only, leaving no dangling edge", async () => {
    const otherWife = "WIFE2-901";
    const halfSib = "HALF-902";
    route({
      [SUBJECT]: subjectBody([DAD]),
      [DAD]: {
        persons: [person(DAD, "Dad"), person(otherWife, "Other wife"), person(halfSib, "Half Sibling")],
        relationships: [],
        childAndParentsRelationships: [capr(halfSib, DAD, otherWife)],
      },
    });
    const out = await personReadTool(
      { personId: SUBJECT, relatives: true },
      LOCAL,
    );
    const ids = new Set(out.persons.map((p) => p.id));
    // THE RULE, and its exact scope: every endpoint of every edge THE FAN-OUT
    // ADDS is in persons[]. validator.ts:1751/1756 make a dangling one a hard
    // error and project_create — which never calls sanitizeTree — refuses the
    // whole write. The subject's OWN edges are not covered by this and can
    // still dangle; that is pre-existing and separately tested.
    //
    // Scoped by child id rather than by looping every relationship: the loop
    // form read as a whole-output guarantee it does not make, and every fixture
    // in this block sets `relationships: []`, so the person1/person2 half of it
    // never evaluated anything at all.
    const fanOutEdges = out.relationships.filter(
      (r) => r.child === halfSib || r.parent === halfSib,
    );
    expect(fanOutEdges.length).toBeGreaterThan(0);
    for (const r of fanOutEdges) {
      for (const endpoint of [r.parent, r.child, r.person1, r.person2]) {
        if (endpoint !== undefined) expect(ids.has(endpoint)).toBe(true);
      }
    }
    const halfEdges = out.relationships.filter(
      (r) => r.type === "ParentChild" && r.child === halfSib,
    );
    expect(halfEdges.map((r) => r.parent)).toEqual([DAD]);
  });

  it("fans out to THREE parents, not just two", async () => {
    const third = "ADOPT-003";
    const sib = "SIB-100";
    route({
      [SUBJECT]: {
        persons: [SUBJECT, DAD, MUM, third].map((id) => person(id, `P ${id}`)),
        relationships: [],
        childAndParentsRelationships: [capr(SUBJECT, DAD, MUM), capr(SUBJECT, third)],
      },
      [DAD]: { persons: [person(DAD, "Dad")], relationships: [], childAndParentsRelationships: [] },
      [MUM]: { persons: [person(MUM, "Mum")], relationships: [], childAndParentsRelationships: [] },
      [third]: {
        persons: [person(third, "Adoptive"), person(sib, "Adoptive Sibling")],
        relationships: [],
        childAndParentsRelationships: [capr(sib, third)],
      },
    });
    const out = await personReadTool(
      { personId: SUBJECT, relatives: true },
      LOCAL,
    );
    expect(out.persons.map((p) => p.id)).toContain(sib);
    // 1 subject read + 3 parent reads
    expect(treeReads()).toHaveLength(4);
  });

  for (const status of [204, 403, 404, 410, 429]) {
    it(`degrades to no siblings when a parent read returns ${status}`, async () => {
      route({ [SUBJECT]: subjectBody([DAD]), [DAD]: status });
      const out = await personReadTool(
        { personId: SUBJECT, relatives: true },
        LOCAL,
      );
      expect(out.persons.map((p) => p.id).sort()).toEqual([DAD, SUBJECT].sort());
    });
  }

  it("degrades to no siblings when a parent read throws", async () => {
    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes(`/${DAD}`)) return Promise.reject(new TypeError("network down"));
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(subjectBody([DAD])),
        headers: new Headers(),
      });
    });
    const out = await personReadTool(
      { personId: SUBJECT, relatives: true },
      LOCAL,
    );
    expect(out.persons.map((p) => p.id)).toContain(SUBJECT);
  });

  it("drops a Couple whose partner the response never returned", async () => {
    // Every other fixture in this block sets `relationships: []`, so nothing
    // here exercised a Couple at all. This one does, and it pins the honest
    // contract rather than the one the old loop appeared to assert: the
    // fan-out does not touch the subject's Couples, so a Couple naming a
    // person FamilySearch did not return still comes back dangling.
    const spouse = "SPOUSE-700";
    route({
      [SUBJECT]: {
        persons: [person(SUBJECT, "Subject Person"), person(DAD, "Dad")],
        relationships: [
          {
            type: "http://gedcomx.org/Couple",
            person1: { resourceId: SUBJECT },
            person2: { resourceId: spouse },
          },
        ],
        childAndParentsRelationships: [capr(SUBJECT, DAD)],
      },
      [DAD]: { persons: [person(DAD, "Dad")], relationships: [], childAndParentsRelationships: [] },
    });
    const out = await personReadTool(
      { personId: SUBJECT, relatives: true },
      LOCAL,
    );
    // The spouse was never returned as a person, so the Couple would dangle —
    // and a dangling Couple fails project_create exactly as a dangling
    // ParentChild does (validator.ts:1777/1782). It is dropped.
    expect(out.persons.map((p) => p.id)).not.toContain(spouse);
    expect(out.relationships.some((r) => r.person2 === spouse)).toBe(false);
  });

  it("emits ONE edge per parent-child pair when a sibling carries two CAPRs", async () => {
    // A biological record plus an adoptive one name the same parent in two
    // differently-shaped CAPRs. Deduping per CAPR is the wrong granularity:
    // synthesizeParentChild expands one CAPR into one edge PER PARENT, so
    // {DAD,MUM} and {DAD} have distinct CAPR keys and emitted DAD->SIB twice.
    const sib = "SIB-100";
    route({
      [SUBJECT]: subjectBody(),
      [DAD]: {
        persons: [person(DAD, "Dad"), person(sib, "Sibling")],
        relationships: [],
        childAndParentsRelationships: [capr(sib, DAD, MUM), capr(sib, DAD)],
      },
      [MUM]: { persons: [person(MUM, "Mum")], relationships: [], childAndParentsRelationships: [] },
    });
    const out = await personReadTool(
      { personId: SUBJECT, relatives: true },
      LOCAL,
    );
    const edges = out.relationships
      .filter((r) => r.type === "ParentChild" && r.child === sib)
      .map((r) => `${r.parent}->${r.child}`);
    expect(edges.filter((e) => e === `${DAD}->${sib}`)).toHaveLength(1);
    expect(edges.sort()).toEqual([`${DAD}->${sib}`, `${MUM}->${sib}`].sort());
  });

  it("strands NO person when the dropped edge came from the subject's own read", async () => {
    // @clack391 on #2593: `parentIdsOf` stops the FAN-OUT producing an
    // unattached person, but the fan-out is not the only source. Here the
    // subject's own read carries a Couple to a partner it never returned. The
    // edge is dropped by endpoint closure, and before `dropStrandedPersons` the
    // partner's spouse stayed in persons[] attached to nothing --
    // `validate_research_schema` checks edges against persons and has no
    // persons-to-edges rule, so nothing downstream objected.
    const SPOUSE = "SPOUSE-500";
    const GHOST = "NEVER-RETURNED-9";
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve({
        ok: true, status: 200, headers: new Headers(),
        json: () => Promise.resolve({
          persons: [person(SUBJECT, "Subject Person"), person(SPOUSE, "Spouse")],
          relationships: [
            { type: "http://gedcomx.org/Couple", person1: { resourceId: SPOUSE }, person2: { resourceId: GHOST } },
          ],
          childAndParentsRelationships: [],
        }),
      }),
    );
    const out = await personReadTool(
      { personId: SUBJECT, relatives: true },
      LOCAL,
    );
    const linked = new Set<string>();
    for (const r of out.relationships) {
      for (const e of [r.parent, r.child, r.person1, r.person2]) if (e) linked.add(e);
    }
    expect(
      out.persons.map((p) => p.id).filter((id) => id !== SUBJECT && !linked.has(id)),
    ).toEqual([]);
    // the SUBJECT survives even with no relationships at all: an isolated
    // person is a valid read and returning nothing for them is the worse bug
    expect(out.persons.map((p) => p.id)).toContain(SUBJECT);
  });

  it("says so in notes[] when endpoint closure drops the subject's own parentage", async () => {
    // @chesworthrm's merge condition on #2593: endpoint closure replaced a loud
    // `project_create` refusal with a quiet partial loss, and "a quiet partial
    // loss of the subject's own parentage is worse than the refusal it replaces
    // if nobody can see it happened." COP is named as Patrick's parent in the
    // CAPR and has no person record, so that edge cannot be emitted.
    const COP = "COPARENT-900";
    route({
      [SUBJECT]: {
        persons: [person(SUBJECT, "Subject Person"), person(DAD, "Dad")],
        relationships: [],
        childAndParentsRelationships: [capr(SUBJECT, DAD, COP)],
      },
      [DAD]: { persons: [person(DAD, "Dad")], relationships: [], childAndParentsRelationships: [] },
    });
    const out = await personReadTool(
      { personId: SUBJECT, relatives: true },
      LOCAL,
    );
    expect(out.notes).toBeDefined();
    expect(out.notes!.join(" ")).toContain("1 ParentChild");
    // the second line is the one that matters: it is the SUBJECT's parent, not
    // some distant relative's, so the caller is told the parentage is missing
    expect(out.notes!.join(" ")).toContain("parent of the requested person");
    // and the dropped edge really is absent
    expect(out.relationships.some((r) => r.parent === COP)).toBe(false);
  });

  it("omits notes[] entirely on a clean read", async () => {
    // The key is absent, not empty: every caller that never triggers a drop
    // sees the unchanged three-key shape.
    route({
      [SUBJECT]: subjectBody(),
      [DAD]: { persons: [person(DAD, "Dad")], relationships: [], childAndParentsRelationships: [] },
      [MUM]: { persons: [person(MUM, "Mum")], relationships: [], childAndParentsRelationships: [] },
    });
    const out = await personReadTool(
      { personId: SUBJECT, relatives: true },
      LOCAL,
    );
    expect(out.notes).toBeUndefined();
    expect(Object.keys(out).sort()).toEqual(["persons", "relationships", "sources"]);
  });

  it("holds the fan-out at FOUR parent reads in flight, and still reads all five", async () => {
    // SIBLING_FANOUT_CONCURRENCY = 4 is justified by a corpus measurement (4
    // children with 3 parents, 3 with 4) and, as @aghadiayeamayanvboernest
    // said on #2593 and the self-review restated, NOTHING drove it: 4 -> 2 and
    // even 4 -> 1 passed the whole 3961-test suite. A cap cannot be caught by
    // asserting on output -- lowering it serialises the same reads and returns
    // the same tree -- so this measures the only thing a cap changes, which is
    // PEAK CONCURRENCY. Five parents, so the cap has something to bite on.
    const PARENTS = ["P-1", "P-2", "P-3", "P-4", "P-5"];
    let inFlight = 0;
    let peak = 0;
    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes(`/${SUBJECT}`)) {
        return Promise.resolve({
          ok: true, status: 200, headers: new Headers(),
          json: () => Promise.resolve({
            persons: [person(SUBJECT, "Subject Person"), ...PARENTS.map((x) => person(x, `P ${x}`))],
            relationships: [],
            childAndParentsRelationships: [
              capr(SUBJECT, PARENTS[0], PARENTS[1]),
              capr(SUBJECT, PARENTS[2], PARENTS[3]),
              capr(SUBJECT, PARENTS[4]),
            ],
          }),
        });
      }
      const pid = PARENTS.find((x) => u.includes(`/${x}`));
      if (!pid) {
        return Promise.resolve({
          ok: true, status: 200, headers: new Headers(),
          json: () => Promise.resolve({ persons: [], relationships: [], childAndParentsRelationships: [] }),
        });
      }
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return new Promise((resolve) => {
        setTimeout(() => {
          inFlight -= 1;
          resolve({
            ok: true, status: 200, headers: new Headers(),
            json: () => Promise.resolve({
              persons: [person(pid, `P ${pid}`)],
              relationships: [],
              childAndParentsRelationships: [],
            }),
          });
        }, 5);
      });
    });
    await personReadTool({ personId: SUBJECT, relatives: true }, LOCAL);
    for (const pid of PARENTS) {
      expect(mockFetch.mock.calls.some(([u]) => String(u).includes(`/${pid}`))).toBe(true);
    }
    expect(peak).toBe(4);
  });

  it("adds NO person the fan-out cannot link — a co-parent with no person record", async () => {
    // Reported on #2593 review, 2026-09-21, and reproduced before fixing.
    // FamilySearch names a parent in a CAPR without returning their person
    // record. The fan-out read that parent anyway, imported their OTHER
    // children, and `pruneCaprs` then dropped every edge from them for want of
    // the parent endpoint -- while the children STAYED. `dropDanglingEdges`
    // filters relationships and never removes a person, and the validator has
    // no persons->edges rule, so real half-siblings carrying real arks landed
    // in the user's tree attached to nobody. Observed exactly:
    //   persons  ["KNDX-MKG","DAD-001","HALF-100","HALF-101"]
    //   edges    [DAD-001 -> KNDX-MKG]
    //   orphans  ["HALF-100","HALF-101"]
    const COP = "COPARENT-900";
    route({
      [SUBJECT]: {
        // DAD has a person record; COP is named in the CAPR and has none.
        persons: [person(SUBJECT, "Subject Person"), person(DAD, "Dad")],
        relationships: [],
        childAndParentsRelationships: [capr(SUBJECT, DAD, COP)],
      },
      [DAD]: { persons: [person(DAD, "Dad")], relationships: [], childAndParentsRelationships: [] },
      [COP]: {
        persons: [person(COP, "Co-parent"), person("HALF-100", "Half A"), person("HALF-101", "Half B")],
        relationships: [],
        childAndParentsRelationships: [capr("HALF-100", COP), capr("HALF-101", COP)],
      },
    });
    const out = await personReadTool(
      { personId: SUBJECT, relatives: true },
      LOCAL,
    );
    const linked = new Set<string>();
    for (const r of out.relationships) {
      for (const e of [r.parent, r.child, r.person1, r.person2]) if (e) linked.add(e);
    }
    const orphans = out.persons
      .map((p) => p.id)
      .filter((id) => id !== SUBJECT && !linked.has(id));
    expect(orphans).toEqual([]);
    // and the pointless request is not made at all
    expect(mockFetch.mock.calls.some(([u]) => String(u).includes(`/${COP}`))).toBe(false);
  });

  it("follows a merged parent's 301 instead of losing every sibling behind it", async () => {
    // The subject's own read follows 301 (`fetchAndConvert`); the fan-out
    // treated `status !== 200` as "no siblings from this parent", so a merged
    // parent -- routine, and absent from the spec's 403/404/410/429/204 list --
    // silently yielded none. #2593 review, 2026-09-21.
    const OLD_DAD = "DAD-001";
    const NEW_DAD = "DAD-NEW-7";
    const sib = "SIB-301";
    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes(`/${SUBJECT}`)) {
        return Promise.resolve({
          ok: true, status: 200, headers: new Headers(),
          json: () => Promise.resolve({
            persons: [person(SUBJECT, "Subject Person"), person(OLD_DAD, "Dad")],
            relationships: [],
            childAndParentsRelationships: [capr(SUBJECT, OLD_DAD)],
          }),
        });
      }
      if (u.includes(`/${NEW_DAD}`)) {
        return Promise.resolve({
          ok: true, status: 200, headers: new Headers(),
          json: () => Promise.resolve({
            persons: [person(NEW_DAD, "Dad"), person(sib, "Sibling")],
            relationships: [],
            childAndParentsRelationships: [capr(sib, NEW_DAD), capr(SUBJECT, NEW_DAD)],
          }),
        });
      }
      if (u.includes(`/${OLD_DAD}`)) {
        return Promise.resolve({
          ok: false, status: 301,
          headers: new Headers({ location: `https://api.familysearch.org/platform/tree/persons/${NEW_DAD}` }),
          json: () => Promise.reject(new Error("no body on a 301")),
        });
      }
      return Promise.resolve({
        ok: true, status: 200, headers: new Headers(),
        json: () => Promise.resolve({ persons: [], relationships: [], childAndParentsRelationships: [] }),
      });
    });
    const out = await personReadTool(
      { personId: SUBJECT, relatives: true },
      LOCAL,
    );
    // Present is not enough: the merged body's CAPRs name the SURVIVING id
    // while `known` is keyed on the id the subject's read used, so without the
    // remap the sibling arrives with its edge pruned -- i.e. as exactly the
    // orphan the test above forbids. Assert the LINK, not the person.
    expect(out.persons.map((p) => p.id)).toContain(sib);
    expect(
      out.relationships.some(
        (r) => r.type === "ParentChild" && r.parent === OLD_DAD && r.child === sib,
      ),
    ).toBe(true);
    const linked = new Set<string>();
    for (const r of out.relationships) {
      for (const e of [r.parent, r.child, r.person1, r.person2]) if (e) linked.add(e);
    }
    expect(
      out.persons.map((p) => p.id).filter((id) => id !== SUBJECT && !linked.has(id)),
    ).toEqual([]);
  });

  it("does not re-emit a SIBLING edge the subject's own read already carried", async () => {
    // `pruneCaprs` seeds its `seen` set from `edgeKeysOf(body)`. Nothing drove
    // that seeding: emptying it (`new Set<string>()`) left all 58 tests green.
    // The sibling case below is what it is actually for, and it is reachable --
    // `childAndParentsRelationships` reaches ONE HOP FURTHER than `persons[]`,
    // so the subject's own read can already name a sibling's parentage, which
    // the parent read then names again. The neighbouring test does not cover
    // it: there the echoed CAPR has `child === pid`, which the merge loop
    // skips outright, so the dedup never runs at all.
    const sib = "SIB-200";
    route({
      [SUBJECT]: {
        persons: [SUBJECT, DAD, MUM, sib].map((id) => person(id, `P ${id}`)),
        relationships: [],
        childAndParentsRelationships: [capr(SUBJECT, DAD, MUM), capr(sib, DAD, MUM)],
      },
      [DAD]: {
        persons: [person(DAD, "Dad"), person(sib, "Sibling")],
        relationships: [],
        childAndParentsRelationships: [capr(sib, DAD, MUM)],
      },
      [MUM]: { persons: [person(MUM, "Mum")], relationships: [], childAndParentsRelationships: [] },
    });
    const out = await personReadTool(
      { personId: SUBJECT, relatives: true },
      LOCAL,
    );
    const edges = out.relationships
      .filter((r) => r.type === "ParentChild" && r.child === sib)
      .map((r) => `${r.parent}->${r.child}`);
    expect(edges.filter((e) => e === `${DAD}->${sib}`)).toHaveLength(1);
    expect(edges.sort()).toEqual([`${DAD}->${sib}`, `${MUM}->${sib}`].sort());
  });

  it("does not re-emit an edge the subject's own read already carried", async () => {
    route({
      [SUBJECT]: subjectBody([DAD]),
      [DAD]: {
        persons: [person(DAD, "Dad"), person(SUBJECT, "Subject Person")],
        relationships: [],
        // the subject's own parentage, echoed back by the parent's read
        childAndParentsRelationships: [capr(SUBJECT, DAD)],
      },
    });
    const out = await personReadTool(
      { personId: SUBJECT, relatives: true },
      LOCAL,
    );
    expect(
      out.relationships.filter(
        (r) => r.type === "ParentChild" && r.child === SUBJECT && r.parent === DAD,
      ),
    ).toHaveLength(1);
  });

  it("harvests a child of THIS parent only — not one the other parent's read owns", async () => {
    // Discriminates isChildOf from pruneCaprs, which otherwise masks it: a
    // maternal half-sibling appears in Dad's payload as a CAPR naming Mum, and
    // Mum's own read FAILS. Harvesting them from Dad's body would claim a
    // sibling on the strength of a read that never succeeded — and the edge
    // would survive pruning, because Mum IS in persons[].
    const mumOnlyChild = "MUMKID-500";
    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes(`/${MUM}`)) return Promise.resolve({
        ok: false, status: 403, json: () => Promise.reject(new Error("restricted")), headers: new Headers(),
      });
      if (u.includes(`/${DAD}`)) return Promise.resolve({
        ok: true, status: 200, headers: new Headers(),
        json: () => Promise.resolve({
          persons: [person(DAD, "Dad"), person(MUM, "Mum"), person(mumOnlyChild, "Mum's child by another")],
          relationships: [],
          // child of MUM, NOT of DAD
          childAndParentsRelationships: [capr(mumOnlyChild, MUM)],
        }),
      });
      return Promise.resolve({
        ok: true, status: 200, headers: new Headers(),
        json: () => Promise.resolve(subjectBody()),
      });
    });

    const out = await personReadTool(
      { personId: SUBJECT, relatives: true },
      LOCAL,
    );
    expect(out.persons.map((p) => p.id)).not.toContain(mumOnlyChild);
  });

  it("skips a sibling whose person record the parent response omitted", async () => {
    const ghost = "GHOST-777";
    route({
      [SUBJECT]: subjectBody([DAD]),
      [DAD]: {
        persons: [person(DAD, "Dad")], // no record for the ghost child
        relationships: [],
        childAndParentsRelationships: [capr(ghost, DAD)],
      },
    });
    const out = await personReadTool(
      { personId: SUBJECT, relatives: true },
      LOCAL,
    );
    expect(out.persons.map((p) => p.id)).not.toContain(ghost);
    expect(
      out.relationships.some((r) => r.child === ghost || r.parent === ghost),
    ).toBe(false);
  });
});


describe("personReadTool — staging the read (#2944)", () => {
  let dir: string;
  beforeEach(async () => {
    const { mkdtemp } = await import("fs/promises");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    dir = await mkdtemp(join(tmpdir(), "person-read-stage-"));
  });
  afterEach(async () => {
    const { rm } = await import("fs/promises");
    await rm(dir, { recursive: true, force: true });
  });

  async function envelopeOf(ref: string) {
    const { readFile } = await import("fs/promises");
    const { join } = await import("path");
    return JSON.parse(await readFile(join(dir, ref), "utf8"));
  }

  it("stages the read when projectPath is given, and the staged document is what was returned", async () => {
    mockOk(WITH_RELATIVES);
    const out = await personReadTool(
      { personId: " KNDX-MKG ", relatives: true, projectPath: dir },
      LOCAL,
    );
    expect(out.staged).not.toBeNull();
    expect(out.staged!.resultsRef).toMatch(/^results\/\.staging\/[0-9a-f-]+\.json$/);
    expect(out.staged!.returnedCount).toBe(1);
    expect(out.stagingError).toBeUndefined();

    const envelope = await envelopeOf(out.staged!.resultsRef);
    expect(envelope.tool).toBe("person_read");
    expect(envelope.returned_count).toBe(1);
    expect(envelope.payload.query).toEqual({
      personId: "KNDX-MKG",
      relatives: true,
      sourceDescriptions: true,
    });
    expect(envelope.payload.results).toHaveLength(1);
    expect(envelope.payload.results[0].personId).toBe("KNDX-MKG");
    const { staged: _s, stagingError: _e, ...returned } = out;
    expect(envelope.payload.results[0].gedcomx).toEqual(returned);
  });

  it("does not stage without projectPath", async () => {
    mockOk(PERSON_ONLY);
    const out = await personReadTool({ personId: "KNDX-MKG" }, LOCAL);
    expect("staged" in out).toBe(false);
    expect("stagingError" in out).toBe(false);
  });

  it.each(["", "   "])("does not stage for a blank projectPath (%j)", async (blank) => {
    mockOk(PERSON_ONLY);
    const out = await personReadTool({ personId: "KNDX-MKG", projectPath: blank }, LOCAL);
    expect("staged" in out).toBe(false);
    expect("stagingError" in out).toBe(false);
  });

  it("a staging failure is non-fatal: the person still returns, with staged: null and the reason", async () => {
    const { writeFile } = await import("fs/promises");
    const { join } = await import("path");
    await writeFile(join(dir, "results"), "not a directory");
    mockOk(PERSON_ONLY);
    const out = await personReadTool({ personId: "KNDX-MKG", projectPath: dir }, LOCAL);
    expect(out.persons[0].id).toBe("KNDX-MKG");
    expect(out.staged).toBeNull();
    expect(out.stagingError).toMatch(/ENOTDIR|not a directory|EEXIST/i);
  });

  it("a projectPath that does not exist is a staging failure, not a scaffolded folder", async () => {
    const { join } = await import("path");
    const { existsSync } = await import("fs");
    const missing = join(dir, "no-such-project");
    mockOk(PERSON_ONLY);
    const out = await personReadTool({ personId: "KNDX-MKG", projectPath: missing }, LOCAL);
    expect(out.persons[0].id).toBe("KNDX-MKG");
    expect(out.staged).toBeNull();
    expect(out.stagingError).toMatch(/does not exist/);
    expect(existsSync(missing)).toBe(false);
  });

  it("keys the staged element by the post-redirect id for a merged person", async () => {
    mockStatus(301, "https://api.familysearch.org/platform/tree/persons/GDZW-NZZ");
    mockOk({
      persons: [
        {
          id: "GDZW-NZZ",
          living: false,
          gender: { type: "http://gedcomx.org/Male" },
          names: [{ nameForms: [{ parts: [{ type: "http://gedcomx.org/Given", value: "Resolved" }] }] }],
        },
      ],
    });
    const out = await personReadTool({ personId: "K2QT-J56", projectPath: dir }, LOCAL);
    const envelope = await envelopeOf(out.staged!.resultsRef);
    expect(envelope.payload.query.personId).toBe("K2QT-J56");
    expect(envelope.payload.results[0].personId).toBe("GDZW-NZZ");
  });
});

describe("personReadTool — person-level source refs (#2696)", () => {
  const TAG = (t: string) => ({ resource: `http://gedcomx.org/${t}` });
  /** Subject + one child. The subject's refs are `#` fragments (what FS sends
   *  for descriptions in this body); the child's is a full URL to a
   *  description FS does not return, measured live 2026-09-30. */
  const body = (): FSTreeResponse =>
    ({
      persons: [
        {
          ...WITH_SOURCES.persons![0],
          sources: [
            { description: "#7X6N-4WR", descriptionId: "7X6N-4WR", tags: [TAG("Name"), TAG("Birth")] },
            { description: "#Q1KF-5FS", descriptionId: "Q1KF-5FS" },
            { description: "#SD_METADATA_1", descriptionId: "SD_METADATA_1" },
          ],
        },
        {
          id: "KID-0001",
          living: false,
          gender: { type: "http://gedcomx.org/Female" },
          names: [{ nameForms: [{ fullText: "Kid Washington" }] }],
          sources: [
            {
              description: "https://api.familysearch.org/platform/sources/descriptions/ZZZZ-999",
              descriptionId: "ZZZZ-999",
            },
          ],
        },
      ],
      childAndParentsRelationships: [
        { parent1: { resourceId: "KNDX-MKG" }, child: { resourceId: "KID-0001" } },
      ],
      sourceDescriptions: WITH_SOURCES.sourceDescriptions,
    }) as unknown as FSTreeResponse;

  it("carries the subject's person-level sources, dropping refs to descriptions not returned", async () => {
    mockOk(body());
    const out = await personReadTool({ personId: "KNDX-MKG" }, LOCAL);
    const subject = out.persons.find((p) => p.id === "KNDX-MKG")!;
    // SD_* is filtered out of sources[], so its ref would dangle: dropped.
    expect(subject.sources).toEqual([{ ref: "7X6N-4WR" }, { ref: "Q1KF-5FS" }]);
    // The child's only ref points at a description not in this body.
    const kid = out.persons.find((p) => p.id === "KID-0001")!;
    expect(kid).toBeDefined();
    expect("sources" in kid).toBe(false);
    // Every person-level ref resolves in sources[].
    const ids = new Set(out.sources.map((s) => s.id));
    for (const p of out.persons) for (const r of p.sources ?? []) expect(ids.has(r.ref)).toBe(true);
  });

  it("never carries FamilySearch's tags or attribution onto a ref", async () => {
    mockOk(body());
    const out = await personReadTool({ personId: "KNDX-MKG" }, LOCAL);
    for (const p of out.persons) {
      for (const r of p.sources ?? []) {
        expect(Object.keys(r).every((k) => ["ref", "page", "quality"].includes(k))).toBe(true);
      }
    }
  });

  it("the living 204 stub is unchanged: no sources key on the person", async () => {
    mockStatus(204);
    const out = await personReadTool({ personId: "LIVE-001" }, LOCAL);
    expect(out.persons).toHaveLength(1);
    expect("sources" in out.persons[0]).toBe(false);
    expect(out.relationships).toEqual([]);
    expect(out.sources).toEqual([]);
  });
});

// ─── Issue #1689 Half 3 — relatives' attached sources ───────────────────────
//
// A relative arrives from the tree read with source REFS but no descriptions: the ref
// is a full URL to a description the body does not contain, so
// `keepResolvablePersonSourceRefs` drops it. Half 3 fetches those descriptions and
// keeps the refs.
//
// WHY THESE TESTS EXIST AS A SEPARATE BLOCK. `mockOk` is `mockResolvedValueOnce`, so
// the relative-sources fetch in every OTHER test in this file falls through to an
// unmocked `fetch`, fail-softs, and changes nothing — which is correct, and is why all
// 76 of them stayed green when this feature landed. Green there is not evidence the
// feature works; only a test that mocks the second endpoint is.

describe("personReadTool relatives' attached sources (#1689 Half 3)", () => {
  /** A tree body whose child carries a URL-form ref to a description not in the body. */
  function bodyWithRelativeRef() {
    return {
      persons: [
        {
          id: "SUBJ-001",
          // LIVING on purpose. The memories phase runs only for a non-living subject,
          // and it would consume the next queued mock before the relative-sources
          // fetch ever reaches it — which is what made the first draft of these tests
          // fail with "res.text is not a function". Marking the subject living skips
          // that phase so each test's extra mocks belong to the feature under test.
          living: true,
          names: [{ nameForms: [{ parts: [{ type: "http://gedcomx.org/Given", value: "Ann" }] }] }],
          sources: [{ description: "#SUBJ-SRC", descriptionId: "SUBJ-SRC" }],
        },
        {
          id: "KID-0001",
          living: false,
          gender: { type: "http://gedcomx.org/Female" },
          names: [{ nameForms: [{ fullText: "Bea Child" }] }],
          sources: [
            {
              description: "https://api.familysearch.org/platform/sources/descriptions/REL-9AA",
              descriptionId: "REL-9AA",
            },
          ],
        },
      ],
      // `childAndParentsRelationships`, not `relationships` — the converter builds
      // ParentChild edges from the former, and a child reachable by neither is dropped
      // as stranded. The first draft used the latter and the child vanished before the
      // code under test ever saw it.
      childAndParentsRelationships: [
        { parent1: { resourceId: "SUBJ-001" }, child: { resourceId: "KID-0001" } },
      ],
      sourceDescriptions: [{ id: "SUBJ-SRC", titles: [{ value: "Subject's own source" }] }],
    } as never;
  }

  /** The per-person endpoint's answer for one relative. */
  function mockRelativeSources(descriptions: unknown[]): void {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ sourceDescriptions: descriptions }),
      headers: new Headers(),
    });
  }

  it("30. fetches a relative's descriptions and KEEPS the ref that used to be dropped", async () => {
    mockOk(bodyWithRelativeRef());
    mockRelativeSources([
      {
        id: "REL-9AA",
        titles: [{ value: "Marriage, of Liberty, Amite, Mississippi" }],
        // REALISTIC, not minimal. Live descriptions carry these, and an earlier version
        // of this test mocked neither -- so it could not see that the entries were being
        // built with `resource_type`/`coverage`, which are not allowed tree-source
        // fields and made `project_create` refuse the whole project.
        resourceType: "http://gedcomx.org/Record",
        coverage: [{ temporal: { original: "1860" } }],
      },
    ]);
    const out = await personReadTool({ personId: "SUBJ-001" }, LOCAL);

    // The description arrived as an ORDINARY sources[] entry — no discriminator.
    const rel = out.sources.find((s) => s.id === "REL-9AA");
    expect(rel).toBeDefined();
    expect(rel!.title).toMatch(/Mississippi/);

    // And the child's ref now resolves, where before this change it was dropped.
    const kid = out.persons.find((p) => p.id === "KID-0001")!;
    expect(kid.sources).toEqual([{ ref: "REL-9AA" }]);

    // Every person-level ref still resolves — the invariant test 29 protects.
    const ids = new Set(out.sources.map((s) => s.id));
    for (const p of out.persons) for (const r of p.sources ?? []) expect(ids.has(r.ref)).toBe(true);
  });

  it("31. the top level is still exactly {persons, relationships, sources}", async () => {
    // The 2026-08-21 no-discriminator ruling. A new key here is the thing the whole
    // "ordinary entries" shape exists to prevent.
    mockOk(bodyWithRelativeRef());
    mockRelativeSources([{ id: "REL-9AA", titles: [{ value: "x" }] }]);
    const out = await personReadTool({ personId: "SUBJ-001" }, LOCAL);
    expect(Object.keys(out).sort()).toEqual(["persons", "relationships", "sources"]);
  });

  it("32. a failed relative fetch returns the tree read unchanged, and does not throw", async () => {
    // Acceptance #5: fail-soft, silent to the agent. This is what test 29 has been
    // exercising since the feature landed — the fetch falls through and nothing changes.
    mockOk(bodyWithRelativeRef());
    mockFetch.mockRejectedValueOnce(new Error("upstream down"));
    const out = await personReadTool({ personId: "SUBJ-001" }, LOCAL);
    expect(out.sources.map((s) => s.id)).toEqual(["SUBJ-SRC"]);
    const kid = out.persons.find((p) => p.id === "KID-0001")!;
    expect("sources" in kid).toBe(false);
  });

  it("33. a relative with no attached sources costs no call", async () => {
    // Only persons carrying a ref are worth a request; a tree of unsourced relatives
    // must not pay one each to discover that.
    const body = bodyWithRelativeRef();
    (body as { persons: Array<{ sources?: unknown }> }).persons[1].sources = undefined;
    mockOk(body);
    await personReadTool({ personId: "SUBJ-001" }, LOCAL);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("34. a source shared by two relatives appears once", async () => {
    // Measured on a real subject (1 of 79 on KNDX-MKG). A repeated id in sources[]
    // breaks the tree write.
    const body = bodyWithRelativeRef() as { persons: Array<Record<string, unknown>>; relationships: unknown[] };
    body.persons.push({
      id: "KID-0002",
      living: false,
      gender: { type: "http://gedcomx.org/Male" },
      names: [{ nameForms: [{ fullText: "Cal Child" }] }],
      sources: [
        {
          description: "https://api.familysearch.org/platform/sources/descriptions/REL-9AA",
          descriptionId: "REL-9AA",
        },
      ],
    });
    (body as unknown as { childAndParentsRelationships: unknown[] }).childAndParentsRelationships.push({
      parent1: { resourceId: "SUBJ-001" },
      child: { resourceId: "KID-0002" },
    });
    mockOk(body as never);
    mockRelativeSources([{ id: "REL-9AA", titles: [{ value: "shared" }] }]);
    mockRelativeSources([{ id: "REL-9AA", titles: [{ value: "shared" }] }]);
    const out = await personReadTool({ personId: "SUBJ-001" }, LOCAL);
    expect(out.sources.filter((s) => s.id === "REL-9AA")).toHaveLength(1);
  });

  it("35. the subject's own sources are not re-fetched", async () => {
    // They are already in the tree body and resolve from it (17/17, 24/24 measured).
    // One relative carries a ref, so exactly one extra call — not two.
    mockOk(bodyWithRelativeRef());
    mockRelativeSources([{ id: "REL-9AA", titles: [{ value: "x" }] }]);
    await personReadTool({ personId: "SUBJ-001" }, LOCAL);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const urls = mockFetch.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("KID-0001/sources"))).toBe(true);
    expect(urls.some((u) => u.includes("SUBJ-001/sources"))).toBe(false);
  });
});

// The inner fail-soft, tested directly. Through `personReadTool` it is invisible:
// `mergeRelativeSources` wraps the whole call in its own try/catch, so removing
// `fetchOne`'s catch leaves every test green (mutation-checked). What the inner one
// actually buys is PARTIAL success — one unreachable relative must not cost the
// sources of the others, which the outer catch alone would throw away.
describe("fetchRelativeSources partial failure (#1689 Half 3)", () => {
  it("36. one relative failing does not lose the others' sources", async () => {
    mockFetch.mockRejectedValueOnce(new Error("first relative unreachable"));
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ sourceDescriptions: [{ id: "GOOD-1", titles: [{ value: "kept" }] }] }),
      headers: new Headers(),
    });
    const { fetchRelativeSources } = await import("../../src/utils/relative-sources.js");
    const out = await fetchRelativeSources(["BAD-0001", "OK-0002"], LOCAL, Date.now() + 30_000);
    expect(out.descriptions.map((d) => d.id)).toEqual(["GOOD-1"]);
    expect(out.skipped).toEqual(["BAD-0001"]);
  });

  it("37. a relative past the deadline is skipped, not awaited", async () => {
    const { fetchRelativeSources } = await import("../../src/utils/relative-sources.js");
    const out = await fetchRelativeSources(["A", "B"], LOCAL, Date.now() - 1);
    expect(out.descriptions).toEqual([]);
    expect(out.skipped.sort()).toEqual(["A", "B"]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// The shape that reaches `project_create`. These exist because tests 30-37 could not see
// the defect that mattered most: relatives' descriptions were being built with
// `simplifySourceDescription` alone, which emits `resource_type` and `coverage` and may
// omit `title`. `project_create` validates WITHOUT sanitizing, so one stray key refuses
// the whole project -- 180 validation errors on a real subject, and every mock passed.
describe("relatives' sources are shaped for the tree write (#1689 Half 3)", () => {
  function relativeBody() {
    return {
      persons: [
        {
          id: "SUBJ-001",
          living: true,
          names: [{ nameForms: [{ fullText: "Ann Subject" }] }],
          sources: [{ description: "#SUBJ-SRC", descriptionId: "SUBJ-SRC" }],
        },
        {
          id: "KID-0001",
          living: false,
          gender: { type: "http://gedcomx.org/Female" },
          names: [{ nameForms: [{ fullText: "Bea Child" }] }],
          sources: [
            {
              description: "https://api.familysearch.org/platform/sources/descriptions/REL-9AA",
              descriptionId: "REL-9AA",
            },
          ],
        },
      ],
      childAndParentsRelationships: [
        { parent1: { resourceId: "SUBJ-001" }, child: { resourceId: "KID-0001" } },
      ],
      sourceDescriptions: [{ id: "SUBJ-SRC", titles: [{ value: "Subject's own source" }] }],
    } as never;
  }

  it("38. carries no field the tree schema forbids", async () => {
    mockOk(relativeBody());
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          sourceDescriptions: [
            {
              id: "REL-9AA",
              titles: [{ value: "Marriage" }],
              resourceType: "http://gedcomx.org/Record",
              coverage: [{ temporal: { original: "1860" } }],
              citations: [{ value: "a citation" }],
              about: "https://familysearch.org/ark:/x",
            },
          ],
        }),
      headers: new Headers(),
    });
    const out = await personReadTool({ personId: "SUBJ-001" }, LOCAL);
    const rel = out.sources.find((s) => s.id === "REL-9AA")!;
    expect(rel).toBeDefined();
    // Exactly the keys `shapeSources` emits. `resource_type` and `coverage` are the two
    // that broke the write; asserting the whole key set catches the next one too.
    expect(Object.keys(rel).sort()).toEqual(["citation", "id", "title", "url"]);
  });

  it("39. gives a title-less description the empty-string title the write requires", async () => {
    mockOk(relativeBody());
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ sourceDescriptions: [{ id: "REL-9AA" }] }),
      headers: new Headers(),
    });
    const out = await personReadTool({ personId: "SUBJ-001" }, LOCAL);
    expect(out.sources.find((s) => s.id === "REL-9AA")!.title).toBe("");
  });

  it("40. drops an SD_* metadata entry a relative's read returns", async () => {
    mockOk(relativeBody());
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          sourceDescriptions: [
            { id: "SD_METADATA_9", titles: [{ value: "FS metadata" }] },
            { id: "REL-9AA", titles: [{ value: "Marriage" }] },
          ],
        }),
      headers: new Headers(),
    });
    const out = await personReadTool({ personId: "SUBJ-001" }, LOCAL);
    expect(out.sources.map((s) => s.id)).not.toContain("SD_METADATA_9");
    expect(out.sources.map((s) => s.id)).toContain("REL-9AA");
  });

  it("41. a source the subject already carries is not added twice", async () => {
    // The common case: a marriage record attached to both the subject and the spouse.
    mockOk(relativeBody());
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          sourceDescriptions: [{ id: "SUBJ-SRC", titles: [{ value: "Subject's own source" }] }],
        }),
      headers: new Headers(),
    });
    const out = await personReadTool({ personId: "SUBJ-001" }, LOCAL);
    expect(out.sources.filter((s) => s.id === "SUBJ-SRC")).toHaveLength(1);
  });
});

// A NON-LIVING subject, which is the real case: the memories phase runs, and it shares
// one deadline with this one. Run in sequence, memories can consume the whole budget --
// OCR waits it out -- after which every relative is skipped and the loss shows only on
// stderr. The relative read is therefore STARTED before the memories merge is awaited,
// so the two overlap. Every other test here uses a living subject precisely to keep the
// memories phase out of the way, which is why this one exists.
describe("relatives' sources on a non-living subject (#1689 Half 3)", () => {
  it("42. still arrive when the memories phase also runs", async () => {
    mockOk({
      persons: [
        {
          id: "DEAD-001",
          living: false,
          gender: { type: "http://gedcomx.org/Male" },
          names: [{ nameForms: [{ fullText: "Olde Subject" }] }],
          sources: [{ description: "#OWN-1", descriptionId: "OWN-1" }],
        },
        {
          id: "KID-0001",
          living: false,
          gender: { type: "http://gedcomx.org/Female" },
          names: [{ nameForms: [{ fullText: "Bea Child" }] }],
          sources: [
            {
              description: "https://api.familysearch.org/platform/sources/descriptions/REL-9AA",
              descriptionId: "REL-9AA",
            },
          ],
        },
      ],
      childAndParentsRelationships: [
        { parent1: { resourceId: "DEAD-001" }, child: { resourceId: "KID-0001" } },
      ],
      sourceDescriptions: [{ id: "OWN-1", titles: [{ value: "His own" }] }],
    } as never);
    // The relative read is issued before the memories merge is awaited, so it is the
    // next request out.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ sourceDescriptions: [{ id: "REL-9AA", titles: [{ value: "Marriage" }] }] }),
      headers: new Headers(),
    });
    // Whatever the memories phase then does, it fails soft and must not take the
    // relatives with it.
    mockFetch.mockRejectedValue(new Error("memories unavailable"));

    const out = await personReadTool({ personId: "DEAD-001" }, LOCAL);
    expect(out.sources.map((s) => s.id).sort()).toEqual(["OWN-1", "REL-9AA"]);
    const kid = out.persons.find((p) => p.id === "KID-0001")!;
    expect(kid.sources).toEqual([{ ref: "REL-9AA" }]);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: vi.fn(),
}));

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

// ─── Tests ────────────────────────────────────────────────────────────────

describe("personReadTool", () => {
  // 1. Returns simplified person for valid ID
  it("returns simplified person for a valid ID", async () => {
    mockOk(PERSON_ONLY);
    const result = await personReadTool({ personId: "KNDX-MKG" });
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
    const result = await personReadTool({ personId: "KNDX-MKG", relatives: true });
    expect(result.persons.length).toBeGreaterThan(1);
    expect(result.relationships.length).toBeGreaterThan(0);
    // The relatives flag must be encoded into the request URL.
    expect(String(mockFetch.mock.calls[0][0])).toContain("relatives=true");
  });

  // 3. Includes sources[] when flag set
  it("includes sources when sourceDescriptions flag is set", async () => {
    mockOk(WITH_SOURCES);
    const result = await personReadTool({ personId: "KNDX-MKG", sourceDescriptions: true });
    expect(result.sources.length).toBeGreaterThan(0);
    // The sourceDescriptions flag must be encoded into the request URL.
    expect(String(mockFetch.mock.calls[0][0])).toContain(
      "sourceDescriptions=true",
    );
  });

  // 3b. Omits flags from the URL when not requested
  it("omits flags from the request URL when not set", async () => {
    mockOk(PERSON_ONLY);
    await personReadTool({ personId: "KNDX-MKG" });
    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).not.toContain("relatives=true");
    expect(url).not.toContain("sourceDescriptions=true");
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
    });
    expect(result.persons.length).toBeGreaterThan(1);
    expect(result.relationships.length).toBeGreaterThan(0);
    expect(result.sources.length).toBeGreaterThan(0);
  });

  // 5. Returns empty relationships/sources when flags are false
  it("returns empty relationships and sources when flags are unset", async () => {
    mockOk(PERSON_ONLY);
    const result = await personReadTool({ personId: "KNDX-MKG" });
    expect(result.relationships).toEqual([]);
    expect(result.sources).toEqual([]);
  });

  // 6. Strips URI prefixes from fact types
  it("strips URI prefixes from fact types", async () => {
    mockOk(PERSON_ONLY);
    const result = await personReadTool({ personId: "KNDX-MKG" });
    const facts = result.persons[0].facts ?? [];
    expect(facts.find((f) => f.type === "Birth")).toBeDefined();
    expect(facts.find((f) => f.type === "Occupation")).toBeDefined();
  });

  // 7. Handles data: prefix custom fact types
  it("strips data:, prefix from custom fact types", async () => {
    mockOk(PERSON_ONLY);
    const result = await personReadTool({ personId: "KNDX-MKG" });
    const facts = result.persons[0].facts ?? [];
    expect(facts.find((f) => f.type === "Elected")).toBeDefined();
    expect(facts.find((f) => f.type.startsWith("data:,"))).toBeUndefined();
  });

  // 8. Extracts given/surname from name parts
  it("extracts given and surname from name parts", async () => {
    mockOk(PERSON_ONLY);
    const result = await personReadTool({ personId: "KNDX-MKG" });
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
    const result = await personReadTool({ personId: "X" });
    expect(result.persons[0].names[0].surname).toBe("Flynn");
    expect(result.persons[0].names[0].given).toBe("");
  });

  // 10. Filters SD_* metadata from sources
  it("filters out SD_* metadata source entries", async () => {
    mockOk(WITH_SOURCES);
    const result = await personReadTool({
      personId: "KNDX-MKG",
      sourceDescriptions: true,
    });
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
    });
    const s = result.sources.find((x) => x.id === "7X6N-4WR");
    expect(s).toBeDefined();
    expect(s?.title).toBe("Revolutionary War Rosters");
    expect(s?.citation).toBe("FamilySearch citation text");
    expect(s?.url).toBe("https://familysearch.org/ark:/61903/1:1:QRHS-D1T2");
  });

  // 12. Converts childAndParentsRelationships to ParentChild
  it("converts childAndParentsRelationships to ParentChild entries", async () => {
    mockOk(WITH_RELATIVES);
    const result = await personReadTool({ personId: "KNDX-MKG", relatives: true });
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
    const result = await personReadTool({ personId: "KNDX-MKG", relatives: true });
    const couples = result.relationships.filter((r) => r.type === "Couple");
    expect(couples).toHaveLength(1);
    expect(couples[0].person1).toBe("KNDX-MKG");
    expect(couples[0].person2).toBe("KNZC-6QV");
    expect(couples[0].facts).toBeDefined();
    expect(couples[0].facts?.[0].type).toBe("Marriage");
    expect(couples[0].facts?.[0].date).toBe("6 January 1759");
  });

  // 14. Keeps all relationships (no focal-person filtering)
  it("keeps all relationships even when not involving the focal person", async () => {
    // Add an extra relationship that doesn't involve KNDX-MKG.
    const withExtra: FSTreeResponse = {
      ...WITH_RELATIVES,
      childAndParentsRelationships: [
        ...(WITH_RELATIVES.childAndParentsRelationships ?? []),
        // Augustine's other family (not involving KNDX-MKG directly as
        // child or parent)
        {
          parent1: { resourceId: "OTHR-PRT" },
          child: { resourceId: "OTHR-CHD" },
        },
      ],
    };
    mockOk(withExtra);
    const result = await personReadTool({ personId: "KNDX-MKG", relatives: true });
    const extraneous = result.relationships.find(
      (r) => r.type === "ParentChild" && r.parent === "OTHR-PRT",
    );
    expect(extraneous).toBeDefined();
  });

  // 15. Extracts subtype from parent facts
  it("extracts subtype from parent facts (Biological, Step, etc.)", async () => {
    mockOk(WITH_RELATIVES);
    const result = await personReadTool({ personId: "KNDX-MKG", relatives: true });
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
    const result = await personReadTool({ personId: "C", relatives: true });
    const pc = result.relationships.find((r) => r.type === "ParentChild");
    expect(pc?.subtype).toBeUndefined();
  });

  // 17. Extracts prefix and suffix from name parts
  it("extracts prefix and suffix from name parts", async () => {
    mockOk(PERSON_ONLY);
    const result = await personReadTool({ personId: "KNDX-MKG" });
    expect(result.persons[0].names[0].prefix).toBe("President");
    expect(result.persons[0].names[0].suffix).toBe("Jr.");
  });

  // 18. Includes notes on sources when present
  it("collects notes onto sources when present", async () => {
    mockOk(WITH_SOURCES);
    const result = await personReadTool({
      personId: "KNDX-MKG",
      sourceDescriptions: true,
    });
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
    await expect(personReadTool({ personId: "X" })).rejects.toThrow(
      /login tool/,
    );
  });

  // 20. Throws on 404
  it("throws on 404 person-not-found", async () => {
    mockStatus(404);
    await expect(personReadTool({ personId: "ZZZZ-ZZZ" })).rejects.toThrow(
      /not found in the FamilySearch Family Tree/,
    );
  });

  // 21. Throws on 410
  it("throws on 410 person-deleted", async () => {
    mockStatus(410);
    await expect(personReadTool({ personId: "X" })).rejects.toThrow(
      /has been deleted/,
    );
  });

  // 22. Throws on 403 restricted
  it("throws on 403 restricted person", async () => {
    mockStatus(403);
    await expect(personReadTool({ personId: "X" })).rejects.toThrow(
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
    const result = await personReadTool({ personId: "K2QT-J56" });
    expect(result.persons[0].id).toBe("GDZW-NZZ");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  // 24. Returns living=true on 204 response
  it("returns a stub person with living:true on 204", async () => {
    mockStatus(204);
    const result = await personReadTool({ personId: "PQD1-2T4" });
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
    await expect(personReadTool({ personId: "X" })).rejects.toThrow(/login tool/);
  });

  // 26. Rejects an empty personId before making any request
  it("rejects an empty personId without fetching", async () => {
    await expect(personReadTool({ personId: "  " })).rejects.toThrow(
      /non-empty personId/,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

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
  return {
    ...actual,
    resolveStandardPlace: vi.fn().mockResolvedValue(null),
    repIdToStandardPlace: vi.fn().mockResolvedValue(null),
    repIdToStandardPlaceAt: vi.fn().mockResolvedValue(null),
  };
});

vi.mock("../../src/utils/place-api.js");

import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  recordReadTool,
  recordReadDocument,
  extractEntityId,
  extractImageArk,
} from "../../src/tools/record-read.js";
import { getValidToken } from "../../src/auth/refresh.js";
import { repIdToStandardPlace, repIdToStandardPlaceAt } from "../../src/utils/place-resolver.js";
import { getPlaceById, getPlaceReps } from "../../src/utils/place-api.js";
import { toSimplified } from "../../src/utils/gedcomx-convert.js";
import { stageSearchResults } from "../../src/utils/results-staging.js";
import type { GedcomX } from "../../src/types/gedcomx.js";

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

function mockOk(body: GedcomX): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    headers: new Headers(),
  });
}

function mockStatus(status: number): void {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: () => Promise.resolve({}),
    headers: new Headers(),
  });
}

const MINIMAL_RECORD: GedcomX = {
  persons: [
    {
      id: "QVS9-DHDB",
      gender: { type: "http://gedcomx.org/Male" },
      names: [
        {
          nameForms: [
            {
              parts: [
                { type: "http://gedcomx.org/Given", value: "John" },
                { type: "http://gedcomx.org/Surname", value: "Smith" },
              ],
            },
          ],
        },
      ],
      facts: [
        {
          type: "http://gedcomx.org/Birth",
          date: { original: "1 January 1850" },
          place: { original: "Ohio, United States" },
        },
      ],
    },
  ],
};

const WITH_RELATIONSHIPS: GedcomX = {
  persons: [
    {
      id: "QVS9-DHDB",
      gender: { type: "http://gedcomx.org/Male" },
      names: [
        {
          nameForms: [
            {
              parts: [
                { type: "http://gedcomx.org/Given", value: "John" },
                { type: "http://gedcomx.org/Surname", value: "Smith" },
              ],
            },
          ],
        },
      ],
    },
    {
      id: "QVS9-DHHH",
      gender: { type: "http://gedcomx.org/Female" },
      names: [
        {
          nameForms: [
            {
              parts: [
                { type: "http://gedcomx.org/Given", value: "Jane" },
                { type: "http://gedcomx.org/Surname", value: "Doe" },
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
      person1: { resource: "#QVS9-DHDB" },
      person2: { resource: "#QVS9-DHHH" },
    },
  ],
};

// ─── extractEntityId unit tests ───────────────────────────────────────────

describe("extractEntityId", () => {
  it("returns a bare ID unchanged", () => {
    expect(extractEntityId("QVS9-DHDB")).toBe("QVS9-DHDB");
  });

  it("extracts the entity ID from a full ARK", () => {
    expect(extractEntityId("ark:/61903/1:1:QVS9-DHDB")).toBe("QVS9-DHDB");
  });

  it("handles an ARK with two-segment path after slash", () => {
    expect(extractEntityId("ark:/61903/1:1:ABCD-1234")).toBe("ABCD-1234");
  });

  // Regression guards for the shapes that must keep working. A check anchored on
  // a literal "ark:/" prefix would silently break the resolver-URL form, which
  // works today via the old last-colon split (2 occurrences in eval/runlogs).
  it("accepts a resolver URL wrapping a persona ARK", () => {
    expect(
      extractEntityId("https://www.familysearch.org/ark:/61903/1:1:QVS9-DHDB"),
    ).toBe("QVS9-DHDB");
  });

  it("accepts a bare type-prefixed persona id", () => {
    expect(extractEntityId("1:1:QVS9-DHDB")).toBe("QVS9-DHDB");
  });

  // The bug this guard exists for (#2061). Before the fix these two ARKs both
  // collapsed to "M8GR-TJY", so asking for the 1920 Detroit household returned
  // persona 1:1:M8GR-TJY — Isaac Tremble, 1880 census, Richmond, Georgia — as a
  // clean success. Captured in
  // eval/runlogs/e2e/mary-mcandrew-son/run-2026-08-05_20-48-08.json.
  it("rejects a 1:2: record ARK rather than resolving it to a different entity", () => {
    expect(() => extractEntityId("ark:/61903/1:2:M8GR-TJY")).toThrow(
      /1:2: record ARK/i,
    );
  });

  it("names the field to use instead when given a 1:2: ARK", () => {
    expect(() => extractEntityId("ark:/61903/1:2:M8GR-TJY")).toThrow(/recordId/);
  });

  it("does not confuse a 1:2: ARK with the persona sharing its id suffix", () => {
    // The suffixes are identical; only the type segment tells them apart.
    expect(extractEntityId("ark:/61903/1:1:M8GR-TJY")).toBe("M8GR-TJY");
    expect(() => extractEntityId("ark:/61903/1:2:M8GR-TJY")).toThrow();
  });

  it("rejects a 3:1: document-image ARK and points at the image tools", () => {
    expect(() => extractEntityId("ark:/61903/3:1:3Q9M-CSNL-S98H-M")).toThrow(
      /image_read|image_transcribe/,
    );
  });

  it("rejects a 3:2: document-image ARK", () => {
    expect(() => extractEntityId("ark:/61903/3:2:3Q9M-CSNL-S98H-M")).toThrow(
      /document-image ARK/i,
    );
  });
});

// ─── recordReadTool tests ─────────────────────────────────────────────────

describe("recordReadTool", () => {
  // 1. Happy path: returns simplified GEDCOMX for a valid bare ID
  it("returns simplified GEDCOMX for a valid bare record ID", async () => {
    mockOk(MINIMAL_RECORD);
    const result = await recordReadTool({ recordId: "QVS9-DHDB" }, LOCAL);
    expect(result.persons).toBeDefined();
    expect(result.persons!.length).toBeGreaterThan(0);
    const person = result.persons![0];
    expect(person.names?.[0]?.given).toBe("John");
    expect(person.names?.[0]?.surname).toBe("Smith");
  });

  // 2. Happy path: accepts a full ARK and resolves to the entity ID
  it("accepts a full ARK and calls the correct URL", async () => {
    mockOk(MINIMAL_RECORD);
    await recordReadTool({ recordId: "ark:/61903/1:1:QVS9-DHDB" }, LOCAL);
    const calledUrl = String(mockFetch.mock.calls[0][0]);
    expect(calledUrl).toContain("QVS9-DHDB");
    expect(calledUrl).not.toContain("ark");
  });

  // 2b. The #2061 guard at the tool boundary. Refusing without fetching is the
  // point: the old behaviour spent a live round-trip and came back with a
  // well-formed record for the wrong person. Mirrors the image_read precedent
  // in image-read.test.ts, which refuses a 1:2: ARK the same way.
  it("refuses a 1:2: record ARK without fetching", async () => {
    await expect(
      recordReadTool({ recordId: "ark:/61903/1:2:M8GR-TJY" }, LOCAL),
    ).rejects.toThrow(/1:2: record ARK/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("refuses a 3:1: document-image ARK without fetching", async () => {
    await expect(
      recordReadTool({ recordId: "ark:/61903/3:1:3Q9M-CSNL-S98H-M" }, LOCAL),
    ).rejects.toThrow(/image_read|image_transcribe/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // 3. URL construction: bare ID is included in the path
  it("constructs the recapi URL correctly for a bare ID", async () => {
    mockOk(MINIMAL_RECORD);
    await recordReadTool({ recordId: "QVS9-DHDB" }, LOCAL);
    const calledUrl = String(mockFetch.mock.calls[0][0]);
    expect(calledUrl).toContain("/records/persona/QVS9-DHDB.json");
  });

  // 4. Auth header: Bearer token is sent
  it("sends the Bearer token in the Authorization header", async () => {
    mockedGetValidToken.mockResolvedValue("my-secret-token");
    mockOk(MINIMAL_RECORD);
    await recordReadTool({ recordId: "QVS9-DHDB" }, LOCAL);
    const callOptions = mockFetch.mock.calls[0][1] as RequestInit;
    const headers = new Headers(callOptions.headers as HeadersInit);
    expect(headers.get("Authorization")).toBe("Bearer my-secret-token");
  });

  // 5. Relationships: simplified relationships are returned when present
  it("returns relationships when the record includes them", async () => {
    mockOk(WITH_RELATIONSHIPS);
    const result = await recordReadTool({ recordId: "QVS9-DHDB" }, LOCAL);
    expect(result.relationships).toBeDefined();
    expect(result.relationships!.length).toBeGreaterThan(0);
  });

  // 6. Error: throws on empty recordId before fetching
  it("throws on empty recordId without fetching", async () => {
    await expect(recordReadTool({ recordId: "  " }, LOCAL)).rejects.toThrow(
      /non-empty recordId/,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // 7. Error: 401 → login guidance
  it("throws on 401 with login guidance", async () => {
    mockStatus(401);
    await expect(recordReadTool({ recordId: "QVS9-DHDB" }, LOCAL)).rejects.toThrow(
      /login tool/,
    );
  });

  // 8. Error: 403 → restricted message
  it("throws on 403 with restricted-record message", async () => {
    mockStatus(403);
    await expect(recordReadTool({ recordId: "QVS9-DHDB" }, LOCAL)).rejects.toThrow(
      /restricted and cannot be viewed/,
    );
  });

  // 9. Error: 404 → not found message
  it("throws on 404 with not-found message", async () => {
    mockStatus(404);
    await expect(recordReadTool({ recordId: "QVS9-DHDB" }, LOCAL)).rejects.toThrow(
      /not found in FamilySearch/,
    );
  });

  // 10a. Recovery: 429 then 200 → returns the successful result
  it("recovers from a transient 429 and returns the record", async () => {
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
        json: () => Promise.resolve(MINIMAL_RECORD),
        headers: new Headers(),
      });
    const result = await recordReadTool({ recordId: "QVS9-DHDB" }, LOCAL);
    expect(result.persons).toBeDefined();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  // 10b. Error: 429 → retried then returned, hits dedicated rate-limit branch
  it("throws on 429 with rate-limit message after retry exhaustion", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      json: () => Promise.resolve({}),
      headers: new Headers(),
    });
    await expect(recordReadTool({ recordId: "QVS9-DHDB" }, LOCAL)).rejects.toThrow(
      /rate limit/,
    );
  });

  // 11. Error: generic non-OK → includes status code (500 is retried then returned)
  it("throws on unexpected non-OK status with code in message", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: () => Promise.resolve({}),
      headers: new Headers(),
    });
    await expect(recordReadTool({ recordId: "QVS9-DHDB" }, LOCAL)).rejects.toThrow(
      /500/,
    );
  });

  // 12. Error: auth failure propagates from getValidToken
  it("propagates auth errors from getValidToken", async () => {
    mockedGetValidToken.mockRejectedValueOnce(
      new Error("Call the login tool to authenticate."),
    );
    await expect(recordReadTool({ recordId: "QVS9-DHDB" }, LOCAL)).rejects.toThrow(
      /login tool/,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // 13. Fact type: URI prefixes stripped in simplified output
  it("strips URI prefixes from fact types", async () => {
    mockOk(MINIMAL_RECORD);
    const result = await recordReadTool({ recordId: "QVS9-DHDB" }, LOCAL);
    const facts = result.persons?.[0]?.facts ?? [];
    expect(facts.find((f) => f.type === "Birth")).toBeDefined();
    expect(facts.find((f) => f.type?.startsWith("http://"))).toBeUndefined();
  });

  // 14. Empty record: handles a response with no persons gracefully
  it("handles a record response with no persons without throwing", async () => {
    mockOk({});
    const result = await recordReadTool({ recordId: "QVS9-DHDB" }, LOCAL);
    // toSimplified returns an empty object for empty input — no throw
    expect(result).toBeDefined();
  });

  it("does not re-standardize places on a live read (uses FS's provided data only)", async () => {
    const { resolveStandardPlace } = await import("../../src/utils/place-resolver.js");
    mockOk({
      persons: [
        {
          facts: [
            { type: "Residence", date: { original: "1940" }, place: { original: "Southampton, New York" } },
          ],
        },
      ],
    } as unknown as GedcomX);
    await recordReadTool({ recordId: "QVS9-DHDB" }, LOCAL);
    // toSimplifiedStandardized would have resolved the place name (and mis-placed
    // it — this mock response carries no `normalized` place); toSimplified must not
    // touch the resolver at all.
    expect(vi.mocked(resolveStandardPlace)).not.toHaveBeenCalled();
  });

  it("keeps the place FamilySearch chose in the record's Place field, named by its id, with no resolver call (6NG4-MVP3)", async () => {
    const { resolveStandardPlace } = await import("../../src/utils/place-resolver.js");
    vi.mocked(repIdToStandardPlaceAt).mockImplementation(async (id: string) =>
      id === "1831208" ? "Faial, Santana, Madeira, Portugal" : null,
    );
    const placeUrl = "https://www.familysearch.org/platform/places/description/1831208";
    const preferred = [{ name: "http://familysearch.org/types/qualifiers/Preferred", value: "true" }];
    mockOk({
      persons: [
        {
          id: "p_296514286894",
          facts: [
            {
              type: "http://gedcomx.org/Christening",
              date: { original: "junho de 1860", formal: "+1860-06" },
              place: {
                original: "Faial, Santana, Madeira, Portugal",
                description: "#place_1831208",
                fields: [
                  {
                    type: "http://gedcomx.org/Place",
                    values: [
                      { type: "http://gedcomx.org/Original", labelId: "EVENT_PLACE_ORIG", text: "Faial, Santana, Madeira, Portugal", resource: placeUrl },
                      { type: "http://gedcomx.org/Interpreted", labelId: "EVENT_PLACE", text: "Faial, Santana, Madeira, Portugal", resource: placeUrl },
                    ],
                  },
                ],
              },
            },
            {
              type: "http://gedcomx.org/Residence",
              place: {
                original: "Faial, Santana, Madeira, Portugal",
                fields: [
                  {
                    type: "http://gedcomx.org/Place",
                    values: [
                      { type: "http://gedcomx.org/Original", labelId: "PR_RES_PLACE_ORIG", text: "dos Mainhos" },
                      { type: "http://gedcomx.org/Interpreted", labelId: "PR_RES_PLACE", text: "Faial, Santana, Madeira, Portugal", resource: placeUrl, qualifiers: preferred },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
      places: [{ id: "place_1831208" }],
    } as unknown as GedcomX);
    const out = await recordReadTool({ recordId: "6NG4-MVP3" }, LOCAL);
    // The residence is undated, so it keeps what toSimplified gives it.
    expect(out.persons?.[0].facts?.map((f) => [f.place, f.standard_place])).toEqual([
      ["Faial, Santana, Madeira, Portugal", "Faial, Santana, Madeira, Portugal"],
      ["Faial, Santana, Madeira, Portugal", undefined],
    ]);
    expect(vi.mocked(resolveStandardPlace)).not.toHaveBeenCalled();
  });
});

// ─── Sidecar mode (resultsRef) — no network ────────────────────────────────

describe("recordReadTool — sidecar mode (resultsRef)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "record-read-sidecar-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const stagedResponse = () => ({
    results: [
      {
        recordId: "ark:/61903/1:1:MXHY-TP4",
        collectionTitle: "United States Census, 1850",
        gedcomx: {
          persons: [
            {
              id: "p1",
              names: [{ given: "Patrick", surname: "Flynn" }],
              facts: [
                { type: "Residence", date: "1850", place: "Branch Township, Schuylkill, Pennsylvania" },
              ],
            },
            { id: "p2", names: [{ given: "Thomas", surname: "Flynn" }], facts: [] },
          ],
          relationships: [{ type: "ParentChild", parent: "p2", child: "p1" }],
        },
      },
      {
        recordId: "ark:/61903/1:1:OTHER-REC",
        gedcomx: { persons: [{ id: "p9", names: [{ given: "Someone", surname: "Else" }] }] },
      },
    ],
  });

  it("resolves a record (with household + relationships) from the sidecar and makes NO live fetch", async () => {
    const handle = await stageSearchResults({
      projectPath: dir,
      tool: "record_search",
      response: stagedResponse(),
    });
    const out = await recordReadTool({
      recordId: "ark:/61903/1:1:MXHY-TP4",
      resultsRef: handle!.resultsRef,
      projectPath: dir,
    }, LOCAL);
    expect(out.persons).toHaveLength(2);
    expect(out.persons!.map((p) => p.names![0].given)).toEqual(["Patrick", "Thomas"]);
    expect(out.relationships).toHaveLength(1);
    expect(mockFetch).not.toHaveBeenCalled();
    // The sidecar returns the staged record as-is — it must NOT re-standardize
    // places through the resolver (the staged data already carries the search
    // stage's standardized places). Pins the rule the three comments state.
    const { resolveStandardPlace } = await import("../../src/utils/place-resolver.js");
    expect(vi.mocked(resolveStandardPlace)).not.toHaveBeenCalled();
  });

  it("matches by bare entity id when the caller passes a full ark result (and vice-versa)", async () => {
    const handle = await stageSearchResults({
      projectPath: dir,
      tool: "record_search",
      response: stagedResponse(),
    });
    const out = await recordReadTool({
      recordId: "MXHY-TP4",
      resultsRef: handle!.resultsRef,
      projectPath: dir,
    }, LOCAL);
    expect(out.persons).toHaveLength(2);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("errors clearly (pointing at a live read) when the record is not in the sidecar", async () => {
    const handle = await stageSearchResults({
      projectPath: dir,
      tool: "record_search",
      response: stagedResponse(),
    });
    await expect(
      recordReadTool({ recordId: "NOPE-99", resultsRef: handle!.resultsRef, projectPath: dir }, LOCAL),
    ).rejects.toThrow(/not found in staged results/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("requires projectPath when resultsRef is given", async () => {
    await expect(
      recordReadTool({ recordId: "MXHY-TP4", resultsRef: "results/.staging/x.json" }, LOCAL),
    ).rejects.toThrow(/requires `projectPath`/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("reads from a finalized results/<log_id>.json sidecar too", async () => {
    // Finalized sidecar shape: { log_id, tool, retrieved, returned_count, payload }
    const { mkdir, writeFile } = await import("fs/promises");
    await mkdir(join(dir, "results"), { recursive: true });
    await writeFile(
      join(dir, "results", "log_001.json"),
      JSON.stringify({
        log_id: "log_001",
        tool: "record_search",
        retrieved: "2026-07-07T00:00:00.000Z",
        returned_count: 2,
        payload: stagedResponse(),
      }),
      "utf-8",
    );
    const out = await recordReadTool({
      recordId: "MXHY-TP4",
      resultsRef: "results/log_001.json",
      projectPath: dir,
    }, LOCAL);
    expect(out.persons).toHaveLength(2);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("record_read names FamilySearch's standards in English for each fact's date", () => {
  const mockedRepIdToStandardPlace = vi.mocked(repIdToStandardPlace);
  const mockedRepIdToStandardPlaceAt = vi.mocked(repIdToStandardPlaceAt);
  const placeUrl = (id: string) => `https://www.familysearch.org/platform/places/description/${id}`;
  const placeField = (asWritten: string, standard: string, placeId: string) => ({
    original: standard,
    description: `#place_${placeId}`,
    fields: [
      {
        type: "http://gedcomx.org/Place",
        values: [
          { type: "http://gedcomx.org/Original", labelId: "EVENT_PLACE_ORIG", text: asWritten },
          { type: "http://gedcomx.org/Interpreted", labelId: "EVENT_PLACE", text: standard, resource: placeUrl(placeId) },
        ],
      },
    ],
  });
  const fact = (type: string, date: { original?: string; formal?: string } | undefined, place?: object) => ({
    type: `http://gedcomx.org/${type}`,
    ...(date ? { date } : {}),
    ...(place ? { place } : {}),
  });
  const onePerson = (...facts: object[]) =>
    ({ persons: [{ id: "p1", principal: true, facts }] }) as unknown as GedcomX;
  const year = (from: number, to = from) => ({ from, to });
  // 6B9K-FXBZ: FamilySearch's standard names come in the record's language.
  const brazilianDeath = {
    persons: [
      {
        id: "p_304762108450",
        principal: true,
        facts: [
          fact("Death", { original: "September 1980", formal: "+1980-09" }, placeField("Bela Vista", "Bela Vista, São Paulo, Brasil", "10979131")),
          fact("Birth", { original: "6 January 1905", formal: "+1905-01-06" }, placeField("Liro, Piaui", "Piauí, Brasil", "5736")),
        ],
      },
    ],
    sourceDescriptions: [
      {
        id: "src_r_180229827330",
        resourceType: "http://gedcomx.org/Record",
        coverage: [
          {
            spatial: { original: "Bela Vista, São Paulo, Brasil", description: placeUrl("10979131") },
            temporal: { original: "23 de setembro de 1980", formal: "+1980-09-23" },
            recordType: "http://gedcomx.org/Death",
          },
        ],
      },
    ],
    places: [{ id: "place_10979131" }, { id: "place_5736" }],
  } as unknown as GedcomX;
  const factPlaces = (out: { persons?: { facts?: { place?: string; standard_place?: string }[] }[] }) =>
    out.persons?.[0].facts?.map((f) => [f.place, f.standard_place]);

  beforeEach(() => {
    mockedRepIdToStandardPlace.mockReset();
    mockedRepIdToStandardPlace.mockResolvedValue(null);
    mockedRepIdToStandardPlaceAt.mockReset();
    mockedRepIdToStandardPlaceAt.mockResolvedValue(null);
  });

  afterEach(() => {
    mockedRepIdToStandardPlace.mockReset();
    mockedRepIdToStandardPlace.mockResolvedValue(null);
    mockedRepIdToStandardPlaceAt.mockReset();
    mockedRepIdToStandardPlaceAt.mockResolvedValue(null);
  });

  it("names each by its place id for FamilySearch's formal date, else gives it what toSimplified gives (6B9K-FXBZ)", async () => {
    const { resolveStandardPlace } = await import("../../src/utils/place-resolver.js");
    mockedRepIdToStandardPlaceAt.mockImplementation(async (id) => (id === "5736" ? "Piauí, Brazil" : null));
    mockOk(brazilianDeath);
    const out = await recordReadTool({ recordId: "6B9K-FXBZ" }, LOCAL);
    expect(mockedRepIdToStandardPlaceAt).toHaveBeenCalledWith("10979131", year(1980), "Bela Vista");
    expect(mockedRepIdToStandardPlaceAt).toHaveBeenCalledWith("5736", year(1905), "Liro, Piaui");
    expect(factPlaces(out)).toEqual([
      ["Bela Vista, São Paulo, Brasil", undefined],
      ["Liro, Piaui", "Piauí, Brazil"],
    ]);
    expect(out.persons?.[0].facts?.[0]).toEqual(toSimplified(brazilianDeath).persons?.[0].facts?.[0]);
    expect(vi.mocked(resolveStandardPlace)).not.toHaveBeenCalled();
  });

  it("gives every fact what toSimplified gives when no name is found (6B9K-FXBZ)", async () => {
    mockOk(brazilianDeath);
    const out = await recordReadTool({ recordId: "6B9K-FXBZ" }, LOCAL);
    expect(factPlaces(out)).toEqual([
      ["Bela Vista, São Paulo, Brasil", undefined],
      ["Piauí, Brasil", undefined],
    ]);
    expect(out.persons?.[0].facts).toEqual(toSimplified(brazilianDeath).persons?.[0].facts);
  });

  it("reads the fact's formal date, not its original (WS89-MGMM's baptism written in Polish)", async () => {
    mockOk(
      onePerson(
        fact("Baptism", { original: "4 sierpnia 1794", formal: "+1794-08-04" }, placeField("Caracas", "Caracas, Distrito Federal, Venezuela", "2241910")),
        fact("Birth", { original: "28 lipca 1794", formal: "+1794-07-28" }),
        fact("Marriage", { original: "1770", formal: "+1770" }),
      ),
    );
    await recordReadTool({ recordId: "WS89-MGMM" }, LOCAL);
    expect(mockedRepIdToStandardPlaceAt.mock.calls).toEqual([["2241910", year(1794), "Caracas"]]);
  });

  it("reads the original as stdDate does when FamilySearch sends no formal date (QK9S-KLJK)", async () => {
    mockOk(onePerson(fact("Marriage", { original: "20 Aug 1922" }, placeField("Ramore, Ontario, Canada", "Ramore, Black River-Matheson Township, Cochrane, Ontario, Canada", "9159962"))));
    await recordReadTool({ recordId: "QK9S-KLJK" }, LOCAL);
    expect(mockedRepIdToStandardPlaceAt).toHaveBeenCalledWith("9159962", year(1922), "Ramore, Ontario, Canada");
  });

  it("reads a before or after date as open on that side (a fact with no formal date)", async () => {
    mockOk(
      onePerson(
        fact("Death", { original: "Bef 1900" }, placeField("Königsberg", "Königsberg, Preußen", "7786039")),
        fact("Burial", { original: "Aft 1850" }, placeField("Königsberg", "Königsberg, Preußen", "7786039")),
      ),
    );
    await recordReadTool({ recordId: "TEST-KOENIGSBERG" }, LOCAL);
    expect(mockedRepIdToStandardPlaceAt.mock.calls).toEqual([
      ["7786039", { from: -Infinity, to: 1900 }, "Königsberg"],
      ["7786039", { from: 1850, to: Infinity }, "Königsberg"],
    ]);
  });

  it("names no fact whose date it cannot read, and looks nothing up for it (65TF-GJMJ's death \"ayer\", QVJ8-W8BD's undated registration)", async () => {
    mockedRepIdToStandardPlaceAt.mockResolvedValue("San Cristóbal, Dominican Republic");
    const body = onePerson(
      fact("Death", { original: "ayer" }, placeField("San Cristóbal", "San Cristóbal, Maimón, Puerto Plata, Puerto Plata, Dominican Republic", "3165")),
      fact("Birth", { original: "1883", formal: "+1883" }),
      fact("BirthRegistration", undefined, placeField("Aguada", "Aguada, Puerto Rico, Estados Unidos de América", "384242")),
    );
    mockOk(body);
    const out = await recordReadTool({ recordId: "65TF-GJMJ" }, LOCAL);
    expect(mockedRepIdToStandardPlaceAt).not.toHaveBeenCalled();
    expect(out.persons?.[0].facts).toEqual(toSimplified(body).persons?.[0].facts);
  });

  it("names two facts at one place in different eras each for its own date (Olne 1790 and 1874)", async () => {
    mockedRepIdToStandardPlaceAt.mockImplementation(async (id, years) =>
      id !== "418460" ? null : years.to <= 1795 ? "Olne, Prince-Bishopric of Liège, Holy Roman Empire" : "Olne, Liège, Belgium",
    );
    mockOk(
      onePerson(
        fact("Baptism", { original: "1790", formal: "+1790" }, placeField("Olne", "Olne, Liège, Belgique", "418460")),
        fact("Death", { original: "3 Apr 1874", formal: "+1874-04-03" }, placeField("Olne", "Olne, Liège, Belgique", "418460")),
      ),
    );
    const out = await recordReadTool({ recordId: "6J8F-6678" }, LOCAL);
    expect(factPlaces(out)).toEqual([
      ["Olne", "Olne, Prince-Bishopric of Liège, Holy Roman Empire"],
      ["Olne", "Olne, Liège, Belgium"],
    ]);
  });

  it("names two facts at one place and date each for its own place text (Bela Vista and Echaporã in 1980)", async () => {
    mockedRepIdToStandardPlaceAt.mockImplementation(async (_id, _years, text) =>
      text === "Bela Vista" ? null : "Echaporã, São Paulo, Brazil",
    );
    mockOk(
      onePerson(
        fact("Death", { formal: "+1980-09" }, placeField("Bela Vista", "Bela Vista, São Paulo, Brasil", "10979131")),
        fact("Burial", { formal: "+1980-09" }, placeField("Echaporã", "Bela Vista, São Paulo, Brasil", "10979131")),
      ),
    );
    const out = await recordReadTool({ recordId: "6B9K-FXBZ" }, LOCAL);
    expect(factPlaces(out)).toEqual([
      ["Bela Vista, São Paulo, Brasil", undefined],
      ["Echaporã", "Echaporã, São Paulo, Brazil"],
    ]);
  });

  it("drops a name that contradicts the fact's place as written (an 1820 Olne record written as Belgium)", async () => {
    // Olne was in the Netherlands 1815-1830. research_append refuses a
    // standard_place naming another country than its place text, and
    // extraction_append then refuses the whole record.
    mockedRepIdToStandardPlaceAt.mockResolvedValue("Olne, Liège, Netherlands");
    mockOk(onePerson(fact("Death", { original: "1820", formal: "+1820" }, placeField("Olne, Liège, Belgique", "Olne, Liège", "418460"))));
    const out = await recordReadTool({ recordId: "TEST-OLNE" }, LOCAL);
    expect(mockedRepIdToStandardPlaceAt).toHaveBeenCalledWith("418460", year(1820), "Olne, Liège, Belgique");
    expect(factPlaces(out)).toEqual([["Olne, Liège", undefined]]);
  });

  it("keeps a name that only FamilySearch's own text contradicts, since the fact's place is the record's", async () => {
    mockedRepIdToStandardPlaceAt.mockResolvedValue("Olne, Liège, Netherlands");
    mockOk(onePerson(fact("Death", { original: "1820", formal: "+1820" }, placeField("Olne", "Olne, Liège, Belgique", "418460"))));
    const out = await recordReadTool({ recordId: "TEST-OLNE" }, LOCAL);
    expect(factPlaces(out)).toEqual([["Olne", "Olne, Liège, Netherlands"]]);
  });

  it("names every coverage place by its id's own name, whatever its dates: the volume, not the event (6J8F-6678)", async () => {
    mockedRepIdToStandardPlaceAt.mockResolvedValue("Olne, Liège, Belgium");
    mockedRepIdToStandardPlace.mockImplementation(async (id) =>
      id === "418460" ? "Olne, Prince-Bishopric of Liège, Holy Roman Empire" : id === "65" ? "Dominican Republic" : null,
    );
    mockOk({
      persons: [{ id: "p1", principal: true }],
      sourceDescriptions: [
        {
          id: "src_r_176388631086",
          resourceType: "http://gedcomx.org/Record",
          coverage: [{ spatial: { original: "Olne, Liège, Belgique", description: placeUrl("418460") }, temporal: { original: "3 Apr 1874", formal: "+1874-04-03" } }],
        },
        {
          id: "sd_da1",
          resourceType: "http://gedcomx.org/DigitalArtifact",
          coverage: [{ spatial: { original: "title:Belgium, Liège, Olne", description: placeUrl("418460") }, temporal: { original: "1871-1882", formal: "+1871-01-01T00:00:00Z/+1882-12-31T23:59:59Z" } }],
        },
        {
          id: "sd_c_1",
          resourceType: "http://gedcomx.org/Collection",
          coverage: [{ spatial: { original: "Dominican Republic", description: placeUrl("65") } }],
        },
        {
          id: "sd_c_2",
          resourceType: "http://gedcomx.org/Collection",
          coverage: [{ spatial: { description: placeUrl("77") }, temporal: { original: "en el siglo XIX" } }],
        },
      ],
    } as unknown as GedcomX);
    const out = await recordReadTool({ recordId: "6J8F-6678" }, LOCAL);
    expect(out.sources?.map((s) => s.coverage?.standard_place)).toEqual([
      "Olne, Prince-Bishopric of Liège, Holy Roman Empire",
      "Olne, Prince-Bishopric of Liège, Holy Roman Empire",
      "Dominican Republic",
      undefined,
    ]);
    expect(mockedRepIdToStandardPlaceAt).not.toHaveBeenCalled();
    expect(mockedRepIdToStandardPlace.mock.calls).toEqual([["418460"], ["418460"], ["65"], ["77"]]);
  });

  it("names only a coverage place whose reference resolves to a place description (X1SW-6LB's Finland collection, X7S5-8J2Z's Florence)", async () => {
    // Read as a representation id, Finland's authorities place id 1927095 is
    // Mingary, South Australia, and Florence's 1942949 a village in Myanmar.
    mockedRepIdToStandardPlace.mockImplementation(async (id) => `Place ${id}`);
    const covering = (id: string, description: string) => ({
      id,
      resourceType: "http://gedcomx.org/Collection",
      coverage: [{ spatial: { description } }],
    });
    mockOk({
      persons: [{ id: "p1", principal: true }],
      sourceDescriptions: [
        covering("sd_c_1778464", "#place_1927095"),
        covering("src_r_563438096", "#place_436389"),
        covering("sd_c_2", "#place_7344713"),
        covering("sd_c_3", placeUrl("422758")),
        covering("sd_c_4", "https://api.familysearch.org/authorities/v1/place/1927095"),
        covering("sd_c_5", "#place_1927178-1930189-1942949"),
        covering("sd_c_6", "#12345"),
        covering("sd_c_7", "#place_8"),
        covering("sd_c_8", "#place_1927096"),
      ],
      places: [
        { place: { resource: placeUrl("436389"), resourceId: "place_436389" } },
        { id: "place_1927095", identifiers: { "http://gedcomx.org/Primary": ["https://api.familysearch.org/authorities/v1/place/1927095"] } },
        { id: "place_7344713", identifiers: { "http://gedcomx.org/Primary": [placeUrl("7344713")] } },
        {
          id: "place_1927178-1930189-1942949",
          identifiers: { "http://gedcomx.org/Primary": ["https://api.familysearch.org/authorities/v1/place/1942949?context=1927178-1930189"] },
        },
        { id: "place_8", identifiers: { "http://gedcomx.org/Primary": [placeUrl("9")] } },
        // Constructed: an entry whose own identifier is an authorities place is
        // not named for a place description it also references.
        {
          id: "place_1927096",
          identifiers: { "http://gedcomx.org/Primary": ["https://api.familysearch.org/authorities/v1/place/1927096"] },
          place: { resource: placeUrl("1927096"), resourceId: "place_1927096" },
        },
      ],
    } as unknown as GedcomX);
    const out = await recordReadTool({ recordId: "X1SW-6LB" }, LOCAL);
    expect(out.sources?.map((s) => [s.coverage?.place_rep_id, s.coverage?.standard_place])).toEqual([
      ["1927095", undefined],
      ["436389", "Place 436389"],
      ["7344713", "Place 7344713"],
      ["422758", "Place 422758"],
      ["1927095", undefined],
      ["1942949", undefined],
      ["12345", undefined],
      ["8", undefined],
      ["1927096", undefined],
    ]);
    expect(mockedRepIdToStandardPlace.mock.calls).toEqual([["436389"], ["7344713"], ["422758"]]);
  });

  it("returns exactly recordReadDocument's document, plus imageArk/viewerUrl", async () => {
    mockOk(brazilianDeath);
    const { imageArk: _imageArk, viewerUrl: _viewerUrl, ...out } = await recordReadTool({ recordId: "6B9K-FXBZ" }, LOCAL);
    expect(out).toEqual(await recordReadDocument(brazilianDeath));
  });

  describe("with the Places API answering as it did on 2026-10-26", () => {
    // Live answers (Accept-Language: en): place 6283855 is Bela Vista
    // 1938-1944 and Echaporã from 1944; place 1959431 is Olne, Belgium from 1830.
    const reps: Record<string, { fullName: string; placeId: string; dateRange?: string }> = {
      "11261236": { fullName: "Catequese, Campos Novos, São Paulo, Brazil", placeId: "6283855", dateRange: "+1928/+1937" },
      "11818622": { fullName: "Bela Vista, Campos Novos, São Paulo, Brazil", placeId: "6283855", dateRange: "+1937/+1938" },
      "10979131": { fullName: "Bela Vista, São Paulo, Brazil", placeId: "6283855", dateRange: "+1938/+1944" },
      "3052592": { fullName: "Echaporã, São Paulo, Brazil", placeId: "6283855", dateRange: "+1944/" },
      "5736": { fullName: "Piauí, Brazil", placeId: "1929896", dateRange: "+1889/" },
      "418460": { fullName: "Olne, Prince-Bishopric of Liège, Holy Roman Empire", placeId: "1959431", dateRange: "/+1795" },
      "12441859": { fullName: "Olne, L'Ourthe, France", placeId: "1959431", dateRange: "+1795/+1815" },
      "12441860": { fullName: "Olne, Liège, Netherlands", placeId: "1959431", dateRange: "+1815/+1830" },
      "12441861": { fullName: "Olne, Liège, Belgium", placeId: "1959431", dateRange: "+1830/" },
      "10579232": { fullName: "Aberayron, Cardiganshire, Wales, United Kingdom", placeId: "6256682", dateRange: "+1801/" },
      "3040252": { fullName: "Aberayron, Cardiganshire, Wales", placeId: "6256682", dateRange: "/+1801" },
    };
    const placeReps: Record<string, string[]> = {
      "6283855": ["3052592", "10979131", "11818622", "11261236"],
      "1929896": ["5736"],
      "1959431": ["12441861", "12441860", "12441859", "418460"],
      "6256682": ["10579232", "3040252"],
    };

    beforeEach(async () => {
      const actual = await vi.importActual<typeof import("../../src/utils/place-resolver.js")>(
        "../../src/utils/place-resolver.js",
      );
      actual.__clearPlaceResolverCachesForTests();
      mockedRepIdToStandardPlace.mockImplementation(actual.repIdToStandardPlace);
      mockedRepIdToStandardPlaceAt.mockImplementation(actual.repIdToStandardPlaceAt);
      vi.mocked(getPlaceById).mockImplementation(async (id: string) => {
        const rep = reps[id];
        return rep
          ? ({ placeRepId: id, name: rep.fullName.split(",")[0], type: "City", ...rep } as Awaited<ReturnType<typeof getPlaceById>>)
          : null;
      });
      // Each representation's names in the listing are its own name.
      vi.mocked(getPlaceReps).mockImplementation(async (pid: string) =>
        (placeReps[pid] ?? []).map((id) => ({
          placeRepId: id,
          fullName: reps[id].fullName,
          dateRange: reps[id].dateRange,
          names: [reps[id].fullName.split(",")[0]],
        })),
      );
    });

    afterEach(() => {
      vi.mocked(getPlaceById).mockReset();
      vi.mocked(getPlaceReps).mockReset();
    });

    it("keeps no standard where the place was renamed since the name the record wrote, and names its coverage by the id's own name (6B9K-FXBZ)", async () => {
      mockOk(brazilianDeath);
      const out = await recordReadTool({ recordId: "6B9K-FXBZ" }, LOCAL);
      expect(factPlaces(out)).toEqual([
        ["Bela Vista, São Paulo, Brasil", undefined],
        ["Liro, Piaui", "Piauí, Brazil"],
      ]);
      expect(out.sources?.[0].coverage?.standard_place).toBe("Bela Vista, São Paulo, Brazil");
    });

    it("keeps no standard where the record's own text names none of the place's names (Q2W9-1GVF's census, given the town of Aberayron)", async () => {
      const census = (written?: string) =>
        fact("Census", { original: "1881", formal: "+1881" }, {
          ...(written !== undefined ? { original: written } : {}),
          description: "#place_10579232",
          fields: [
            { type: "http://gedcomx.org/District", values: [{ type: "http://gedcomx.org/Original", labelId: "EVENT_DISTRICT_ORIG", text: "Aberayron" }] },
            {
              type: "http://gedcomx.org/Place",
              values: [
                ...(written !== undefined ? [{ type: "http://gedcomx.org/Original", labelId: "EVENT_PLACE_ORIG", text: written }] : []),
                { type: "http://gedcomx.org/Interpreted", labelId: "EVENT_PLACE", text: "Aberayron, Cardiganshire, Wales, United Kingdom", resource: placeUrl("10579232") },
              ],
            },
          ],
        });
      const body = onePerson(census("Llanbadarn-Tref-Eglwys, Cardiganshire, Wales"), census("Aberayron, Cardiganshire, Wales"), census());
      mockOk(body);
      const out = await recordReadTool({ recordId: "Q2W9-1GVF" }, LOCAL);
      expect(out.persons?.[0].facts?.map((f) => [f.place, f.standard_place])).toEqual([
        ["Llanbadarn-Tref-Eglwys, Cardiganshire, Wales", undefined],
        ["Aberayron, Cardiganshire, Wales", "Aberayron, Cardiganshire, Wales, United Kingdom"],
        // A fact with no place text of its own names none either.
        [undefined, undefined],
      ]);
    });

    it("names a fact for its date and its coverages by the id's own name (6J8F-6678)", async () => {
      mockOk({
        persons: [
          {
            id: "p_296982812853",
            principal: true,
            facts: [fact("DeathRegistration", { original: "3 Apr 1874", formal: "+1874-04-03" }, placeField("Olne, Liège, Belgique", "Olne, Liège, Belgique", "418460"))],
          },
        ],
        sourceDescriptions: [
          {
            id: "src_r_176388631086",
            resourceType: "http://gedcomx.org/Record",
            coverage: [{ spatial: { original: "Olne, Liège, Belgique", description: placeUrl("418460") }, temporal: { original: "3 Apr 1874", formal: "+1874-04-03" } }],
          },
          {
            id: "sd_da1",
            resourceType: "http://gedcomx.org/DigitalArtifact",
            coverage: [{ spatial: { original: "title:Belgium, Liège, Olne", description: placeUrl("418460") }, temporal: { original: "1871-1882", formal: "+1871-01-01T00:00:00Z/+1882-12-31T23:59:59Z" } }],
          },
        ],
      } as unknown as GedcomX);
      const out = await recordReadTool({ recordId: "6J8F-6678" }, LOCAL);
      expect(out.persons?.[0].facts?.[0].standard_place).toBe("Olne, Liège, Belgium");
      expect(out.sources?.map((s) => s.coverage?.standard_place)).toEqual([
        "Olne, Prince-Bishopric of Liège, Holy Roman Empire",
        "Olne, Prince-Bishopric of Liège, Holy Roman Empire",
      ]);
    });
  });
});

describe("#2367 resolveCoveragePlaces", () => {
  const mockedRepIdToStandardPlace = vi.mocked(repIdToStandardPlace);

  const recordWithCoverage: GedcomX = {
    persons: [
      {
        id: "P1",
        principal: true,
        gender: { type: "http://gedcomx.org/Male" },
        names: [{ nameForms: [{ fullText: "John Smith" }] }],
      },
    ],
    sourceDescriptions: [
      {
        id: "SD1",
        resourceType: "http://gedcomx.org/DigitalArtifact",
        titles: [{ value: "Alabama Deaths" }],
        coverage: [
          {
            spatial: { description: "https://www.familysearch.org/platform/places/description/12345" },
            temporal: { original: "1850/1860", formal: "+1850/+1860" },
            recordType: "http://gedcomx.org/Census",
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    mockedRepIdToStandardPlace.mockReset();
    mockedRepIdToStandardPlace.mockResolvedValue(null);
  });

  it("resolves coverage place_rep_id to standard_place via repIdToStandardPlace", async () => {
    mockedRepIdToStandardPlace.mockResolvedValueOnce("Talladega, Alabama, United States");
    mockOk(recordWithCoverage);
    const out = await recordReadTool({ recordId: "P1" }, LOCAL);
    expect(mockedRepIdToStandardPlace).toHaveBeenCalledWith("12345");
    const sd = out.sources?.find((s: any) => s.coverage);
    expect(sd?.coverage?.standard_place).toBe("Talladega, Alabama, United States");
  });

  it("leaves standard_place absent when repIdToStandardPlace returns null", async () => {
    mockedRepIdToStandardPlace.mockResolvedValueOnce(null);
    mockOk(recordWithCoverage);
    const out = await recordReadTool({ recordId: "P1" }, LOCAL);
    const sd = out.sources?.find((s: any) => s.coverage);
    expect(sd?.coverage?.standard_place).toBeUndefined();
  });
});

// ─── extractImageArk unit tests ──────────────────────────────────────────

describe("extractImageArk", () => {
  it("returns the ark from a DigitalArtifact source with a 3:1: url", () => {
    expect(
      extractImageArk({
        sources: [
          {
            id: "sd_da1",
            resource_type: "DigitalArtifact",
            url: "https://www.familysearch.org/ark:/61903/3:1:9Q97-YSRZ-GWP",
          },
        ],
      }),
    ).toBe("ark:/61903/3:1:9Q97-YSRZ-GWP");
  });

  it("returns the ark from a DigitalArtifact source with a 3:2: url", () => {
    expect(
      extractImageArk({
        sources: [
          {
            id: "sd_da1",
            resource_type: "DigitalArtifact",
            url: "https://www.familysearch.org/ark:/61903/3:2:77TJ-PXCN",
          },
        ],
      }),
    ).toBe("ark:/61903/3:2:77TJ-PXCN");
  });

  it("returns undefined when no sources are present", () => {
    expect(extractImageArk({})).toBeUndefined();
    expect(extractImageArk({ sources: [] })).toBeUndefined();
  });

  it("returns undefined when no DigitalArtifact source exists", () => {
    expect(
      extractImageArk({
        sources: [
          { id: "sd_c_1", resource_type: "Collection", url: "https://example.com" },
          { id: "src_r_1", title: "Record", url: "https://example.com/1:2:X" },
        ],
      }),
    ).toBeUndefined();
  });

  it("returns undefined when the DigitalArtifact source has no url", () => {
    expect(
      extractImageArk({
        sources: [{ id: "sd_da1", resource_type: "DigitalArtifact" }],
      }),
    ).toBeUndefined();
  });

  // The shape record_search ACTUALLY stages. `simplifySourceDescription`
  // (gedcomx-convert.ts) sets `resource_type` only when the upstream carries
  // `resourceType`, and a search-response source description does not — every
  // sd_da1 in eval/runlogs/e2e/pedro-chaves-spouse and in
  // eval/fixtures/mcp/record-search-whitfield-1850-household.json is bare
  // `{ id, url }`. All 8 record_read calls in that run went through the
  // sidecar, so requiring the label dropped the ark on the one path the
  // motivating failure used.
  it("returns the ark when the source carries NO resource_type (the staged sidecar shape)", () => {
    expect(
      extractImageArk({
        sources: [
          {
            id: "sd_da1",
            url: "https://www.familysearch.org/ark:/61903/3:1:9Q97-YSRZ-GWP",
          },
        ],
      }),
    ).toBe("ark:/61903/3:1:9Q97-YSRZ-GWP");
  });

  // FamilySearch's own vocabulary variant. `replace(/.*\//, "")` leaves the
  // fragment on, so an exact !== "DigitalArtifact" test dropped it. Seen in a
  // FamilySearch collection-detail response (the retired collection_read fixture).
  it("returns the ark for the DigitalArtifact#FamilySearch vocabulary variant", () => {
    expect(
      extractImageArk({
        sources: [
          {
            id: "sd_da1",
            resource_type: "DigitalArtifact#FamilySearch",
            url: "https://www.familysearch.org/ark:/61903/3:1:9Q97-YSRZ-GWP",
          },
        ],
      }),
    ).toBe("ark:/61903/3:1:9Q97-YSRZ-GWP");
  });

  // The other direction: dropping the label requirement must not start
  // returning arks off a source that is explicitly something else.
  it("still skips a source whose resource_type names a different type", () => {
    expect(
      extractImageArk({
        sources: [
          {
            id: "sd_r_1",
            resource_type: "Record",
            url: "https://www.familysearch.org/ark:/61903/3:1:9Q97-YSRZ-GWP",
          },
        ],
      }),
    ).toBeUndefined();
  });

  // 22 of the 538 document-image source urls in the corpus carry a context
  // param (mostly cc=). toArk() strips the query, and a waypoint ark that
  // loses its context can resolve to a NEIGHBOURING page with no error — the
  // agent then OCRs the wrong scan. image_read/image_transcribe accept the
  // full URL and already fall back to the bare ark.
  it("preserves i=/cc=/groupId= context params from the source url", () => {
    expect(
      extractImageArk({
        sources: [
          {
            id: "sd_da1",
            url: "https://familysearch.org/ark:/61903/3:1:3QS7-89G8-388L?cc=1473014&lang=en",
          },
        ],
      }),
    ).toBe("ark:/61903/3:1:3QS7-89G8-388L?cc=1473014");
  });

  it("returns a bare ark when the source url carries no context params", () => {
    expect(
      extractImageArk({
        sources: [
          {
            id: "sd_da1",
            url: "https://familysearch.org/ark:/61903/3:1:3QS7-89G8-388L?lang=en",
          },
        ],
      }),
    ).toBe("ark:/61903/3:1:3QS7-89G8-388L");
  });

  // A household spanning two scans. The corpus carries sd_da2 (55), sd_da3
  // (26), sd_da4 and one sd_da8, so "several page images on one record" is
  // real, not hypothetical. Document-order "first" hands a co-resident on
  // page 2 the ark for page 1 — and nothing errors, so the agent OCRs a scan
  // its person is not on.
  const TWO_PAGE_HOUSEHOLD = {
    persons: [
      { id: "PAGE1-PERSON", sources: [{ ref: "sd_da1" }] },
      { id: "PAGE2-PERSON", sources: [{ ref: "sd_da2" }] },
    ],
    sources: [
      {
        id: "sd_da1",
        resource_type: "DigitalArtifact",
        url: "https://www.familysearch.org/ark:/61903/3:1:PAGE-ONE",
      },
      {
        id: "sd_da2",
        resource_type: "DigitalArtifact",
        url: "https://www.familysearch.org/ark:/61903/3:1:PAGE-TWO",
      },
    ],
  };

  it("returns the page the REQUESTED persona is on, not document-order first", () => {
    expect(extractImageArk(TWO_PAGE_HOUSEHOLD, "PAGE2-PERSON")).toBe(
      "ark:/61903/3:1:PAGE-TWO",
    );
    expect(extractImageArk(TWO_PAGE_HOUSEHOLD, "PAGE1-PERSON")).toBe(
      "ark:/61903/3:1:PAGE-ONE",
    );
  });

  it("matches the persona by ARK as well as by bare id", () => {
    expect(
      extractImageArk(TWO_PAGE_HOUSEHOLD, "ark:/61903/1:1:PAGE2-PERSON"),
    ).toBe("ark:/61903/3:1:PAGE-TWO");
  });

  it("falls back to document order when the persona has no source refs", () => {
    expect(extractImageArk(TWO_PAGE_HOUSEHOLD, "NOT-IN-THIS-RECORD")).toBe(
      "ark:/61903/3:1:PAGE-ONE",
    );
    expect(extractImageArk(TWO_PAGE_HOUSEHOLD)).toBe("ark:/61903/3:1:PAGE-ONE");
  });

  // A persona ref pointing at a NON-image source must not short-circuit the
  // search and return nothing.
  it("skips a persona ref that names a non-image source and keeps looking", () => {
    expect(
      extractImageArk(
        {
          persons: [
            { id: "P1", sources: [{ ref: "sd_r_1" }, { ref: "sd_da1" }] },
          ],
          sources: [
            {
              id: "sd_r_1",
              resource_type: "Record",
              url: "https://www.familysearch.org/ark:/61903/1:2:SOME-RECORD",
            },
            {
              id: "sd_da1",
              resource_type: "DigitalArtifact",
              url: "https://www.familysearch.org/ark:/61903/3:1:REAL-PAGE",
            },
          ],
        },
        "P1",
      ),
    ).toBe("ark:/61903/3:1:REAL-PAGE");
  });

  it("skips a DigitalArtifact whose url is not a 3:1:/3:2: ark", () => {
    expect(
      extractImageArk({
        sources: [
          {
            id: "sd_da1",
            resource_type: "DigitalArtifact",
            url: "https://www.familysearch.org/ark:/61903/1:2:HSJG-CLNF",
          },
        ],
      }),
    ).toBeUndefined();
  });

  it("returns the first matching ark when multiple DigitalArtifact sources exist", () => {
    expect(
      extractImageArk({
        sources: [
          {
            id: "sd_da1",
            resource_type: "DigitalArtifact",
            url: "https://www.familysearch.org/ark:/61903/3:1:AAAA-BBBB",
          },
          {
            id: "sd_da2",
            resource_type: "DigitalArtifact",
            url: "https://www.familysearch.org/ark:/61903/3:1:CCCC-DDDD",
          },
        ],
      }),
    ).toBe("ark:/61903/3:1:AAAA-BBBB");
  });
});

// ─── imageArk integration (live path) ────────────────────────────────────

const RECORD_WITH_IMAGE_SOURCE: GedcomX = {
  persons: [
    {
      id: "P1",
      gender: { type: "http://gedcomx.org/Male" },
      names: [{ nameForms: [{ fullText: "Pedro Chaves" }] }],
    },
  ],
  sourceDescriptions: [
    {
      id: "src_r_1",
      titles: [{ value: "Buenos Aires Church Records" }],
      about: "https://www.familysearch.org/ark:/61903/1:2:QJRM-GV8V",
    },
    {
      id: "sd_da1",
      resourceType: "http://gedcomx.org/DigitalArtifact",
      about: "https://www.familysearch.org/ark:/61903/3:1:9Q97-YSRZ-GWP",
    },
  ],
};

describe("recordReadTool — imageArk field", () => {

  it("surfaces imageArk and viewerUrl when the record has a DigitalArtifact source", async () => {
    mockOk(RECORD_WITH_IMAGE_SOURCE);
    const result = await recordReadTool({ recordId: "P1" }, LOCAL);
    expect(result.imageArk).toBe("ark:/61903/3:1:9Q97-YSRZ-GWP");
    expect(result.viewerUrl).toBe(
      "https://www.familysearch.org/ark:/61903/3:1:9Q97-YSRZ-GWP"
    );
  });

  it("omits imageArk and viewerUrl when no DigitalArtifact source is present", async () => {
    mockOk(MINIMAL_RECORD);
    const result = await recordReadTool({ recordId: "QVS9-DHDB" }, LOCAL);
    expect(result.imageArk).toBeUndefined();
    expect(result.viewerUrl).toBeUndefined();
  });
});

describe("recordReadTool — staging on a live read (#2048 / #2489)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "record-read-stage-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("stages the live record when projectPath is given, and record_read reads it back from the sidecar", async () => {
    mockOk(MINIMAL_RECORD);
    const live = await recordReadTool({ recordId: "ark:/61903/1:1:QVS9-DHDB", projectPath: dir }, LOCAL);
    expect(live.staged).not.toBeNull();
    expect(live.staged!.returnedCount).toBe(1);
    expect(live.stagingError).toBeUndefined();

    const { readFile } = await import("fs/promises");
    const envelope = JSON.parse(await readFile(join(dir, live.staged!.resultsRef), "utf8"));
    expect(envelope.tool).toBe("record_read");
    expect(envelope.returned_count).toBe(1);
    expect(envelope.payload.query).toEqual({ recordId: "ark:/61903/1:1:QVS9-DHDB" });
    expect(envelope.payload.results[0].recordId).toBe("ark:/61903/1:1:QVS9-DHDB");
    expect(envelope.payload.results[0].gedcomx.persons?.[0]?.id).toBe("QVS9-DHDB");

    // Sidecar mode finds it by the same id, with no second fetch.
    const again = await recordReadTool(
      { recordId: "QVS9-DHDB", resultsRef: live.staged!.resultsRef, projectPath: dir },
      LOCAL,
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(again.persons?.[0]?.id).toBe("QVS9-DHDB");
    expect(again.staged).toBeUndefined(); // a sidecar read stages nothing
  });

  it("does not stage without projectPath", async () => {
    mockOk(MINIMAL_RECORD);
    const live = await recordReadTool({ recordId: "QVS9-DHDB" }, LOCAL);
    expect("staged" in live).toBe(false);
  });

  it("a staging failure is non-fatal: the record still returns, with staged: null and the reason", async () => {
    const { writeFile } = await import("fs/promises");
    await writeFile(join(dir, "results"), "not a directory");
    mockOk(MINIMAL_RECORD);
    const live = await recordReadTool({ recordId: "QVS9-DHDB", projectPath: dir }, LOCAL);
    expect(live.persons?.[0]?.id).toBe("QVS9-DHDB");
    expect(live.staged).toBeNull();
    expect(live.stagingError).toMatch(/ENOTDIR|not a directory|EEXIST/i);
  });

  // imageArk and staging were built independently and met at a merge. They ride
  // on the same return, so a record that has both a DigitalArtifact source and a
  // projectPath must carry both — and what is STAGED stays the plain document,
  // since the sidecar path re-derives imageArk on the way back out.
  it("carries imageArk alongside staged, and stages the document without it", async () => {
    mockOk(RECORD_WITH_IMAGE_SOURCE);
    const live = await recordReadTool({ recordId: "P1", projectPath: dir }, LOCAL);

    expect(live.imageArk).toBe("ark:/61903/3:1:9Q97-YSRZ-GWP");
    expect(live.staged).not.toBeNull();

    const { readFile } = await import("fs/promises");
    const envelope = JSON.parse(
      await readFile(join(dir, live.staged!.resultsRef), "utf8"),
    );
    expect(envelope.payload.results[0].gedcomx.imageArk).toBeUndefined();

    // ...and the sidecar read re-derives both imageArk and viewerUrl from the
    // staged document (issue #2854 — the sidecar path must also return viewerUrl).
    const again = await recordReadTool(
      { recordId: "P1", resultsRef: live.staged!.resultsRef, projectPath: dir },
      LOCAL,
    );
    expect(again.imageArk).toBe("ark:/61903/3:1:9Q97-YSRZ-GWP");
    expect(again.viewerUrl).toBe(
      "https://www.familysearch.org/ark:/61903/3:1:9Q97-YSRZ-GWP"
    );
  });
});

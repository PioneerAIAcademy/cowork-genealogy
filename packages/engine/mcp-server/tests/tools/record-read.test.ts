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

import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { recordReadTool, extractEntityId } from "../../src/tools/record-read.js";
import { getValidToken } from "../../src/auth/refresh.js";
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
});

// ─── recordReadTool tests ─────────────────────────────────────────────────

describe("recordReadTool", () => {
  // 1. Happy path: returns simplified GEDCOMX for a valid bare ID
  it("returns simplified GEDCOMX for a valid bare record ID", async () => {
    mockOk(MINIMAL_RECORD);
    const result = await recordReadTool({ recordId: "QVS9-DHDB" });
    expect(result.persons).toBeDefined();
    expect(result.persons!.length).toBeGreaterThan(0);
    const person = result.persons![0];
    expect(person.names?.[0]?.given).toBe("John");
    expect(person.names?.[0]?.surname).toBe("Smith");
  });

  // 2. Happy path: accepts a full ARK and resolves to the entity ID
  it("accepts a full ARK and calls the correct URL", async () => {
    mockOk(MINIMAL_RECORD);
    await recordReadTool({ recordId: "ark:/61903/1:1:QVS9-DHDB" });
    const calledUrl = String(mockFetch.mock.calls[0][0]);
    expect(calledUrl).toContain("QVS9-DHDB");
    expect(calledUrl).not.toContain("ark");
  });

  // 3. URL construction: bare ID is included in the path
  it("constructs the recapi URL correctly for a bare ID", async () => {
    mockOk(MINIMAL_RECORD);
    await recordReadTool({ recordId: "QVS9-DHDB" });
    const calledUrl = String(mockFetch.mock.calls[0][0]);
    expect(calledUrl).toContain("/records/persona/QVS9-DHDB.json");
  });

  // 4. Auth header: Bearer token is sent
  it("sends the Bearer token in the Authorization header", async () => {
    mockedGetValidToken.mockResolvedValue("my-secret-token");
    mockOk(MINIMAL_RECORD);
    await recordReadTool({ recordId: "QVS9-DHDB" });
    const callOptions = mockFetch.mock.calls[0][1] as RequestInit;
    const headers = callOptions.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer my-secret-token");
  });

  // 5. Relationships: simplified relationships are returned when present
  it("returns relationships when the record includes them", async () => {
    mockOk(WITH_RELATIONSHIPS);
    const result = await recordReadTool({ recordId: "QVS9-DHDB" });
    expect(result.relationships).toBeDefined();
    expect(result.relationships!.length).toBeGreaterThan(0);
  });

  // 6. Error: throws on empty recordId before fetching
  it("throws on empty recordId without fetching", async () => {
    await expect(recordReadTool({ recordId: "  " })).rejects.toThrow(
      /non-empty recordId/,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // 7. Error: 401 → login guidance
  it("throws on 401 with login guidance", async () => {
    mockStatus(401);
    await expect(recordReadTool({ recordId: "QVS9-DHDB" })).rejects.toThrow(
      /login tool/,
    );
  });

  // 8. Error: 403 → restricted message
  it("throws on 403 with restricted-record message", async () => {
    mockStatus(403);
    await expect(recordReadTool({ recordId: "QVS9-DHDB" })).rejects.toThrow(
      /restricted and cannot be viewed/,
    );
  });

  // 9. Error: 404 → not found message
  it("throws on 404 with not-found message", async () => {
    mockStatus(404);
    await expect(recordReadTool({ recordId: "QVS9-DHDB" })).rejects.toThrow(
      /not found in FamilySearch/,
    );
  });

  // 10. Error: 429 → rate-limit message
  it("throws on 429 with rate-limit message", async () => {
    mockStatus(429);
    await expect(recordReadTool({ recordId: "QVS9-DHDB" })).rejects.toThrow(
      /rate limit/,
    );
  });

  // 11. Error: generic non-OK → includes status code
  it("throws on unexpected non-OK status with code in message", async () => {
    mockStatus(500);
    await expect(recordReadTool({ recordId: "QVS9-DHDB" })).rejects.toThrow(
      /500/,
    );
  });

  // 12. Error: auth failure propagates from getValidToken
  it("propagates auth errors from getValidToken", async () => {
    mockedGetValidToken.mockRejectedValueOnce(
      new Error("Call the login tool to authenticate."),
    );
    await expect(recordReadTool({ recordId: "QVS9-DHDB" })).rejects.toThrow(
      /login tool/,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // 13. Fact type: URI prefixes stripped in simplified output
  it("strips URI prefixes from fact types", async () => {
    mockOk(MINIMAL_RECORD);
    const result = await recordReadTool({ recordId: "QVS9-DHDB" });
    const facts = result.persons?.[0]?.facts ?? [];
    expect(facts.find((f) => f.type === "Birth")).toBeDefined();
    expect(facts.find((f) => f.type?.startsWith("http://"))).toBeUndefined();
  });

  // 14. Empty record: handles a response with no persons gracefully
  it("handles a record response with no persons without throwing", async () => {
    mockOk({});
    const result = await recordReadTool({ recordId: "QVS9-DHDB" });
    // toSimplified returns an empty object for empty input — no throw
    expect(result).toBeDefined();
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
    });
    expect(out.persons).toHaveLength(2);
    expect(out.persons!.map((p) => p.names![0].given)).toEqual(["Patrick", "Thomas"]);
    expect(out.relationships).toHaveLength(1);
    expect(mockFetch).not.toHaveBeenCalled();
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
    });
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
      recordReadTool({ recordId: "NOPE-99", resultsRef: handle!.resultsRef, projectPath: dir }),
    ).rejects.toThrow(/not found in staged results/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("requires projectPath when resultsRef is given", async () => {
    await expect(
      recordReadTool({ recordId: "MXHY-TP4", resultsRef: "results/.staging/x.json" }),
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
    });
    expect(out.persons).toHaveLength(2);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

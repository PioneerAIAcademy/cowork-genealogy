import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: vi.fn(),
}));

import { personAncestorsTool } from "../../src/tools/person-ancestors.js";
import { getValidToken } from "../../src/auth/refresh.js";
import type { FSAncestryResponse } from "../../src/types/person-ancestors.js";

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

// ─── Response mocks ─────────────────────────────────────────────────────────

function mockOk(body: FSAncestryResponse): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    headers: new Headers(),
  });
}

function mockStatus(status: number, location?: string, body: unknown = {}): void {
  const headers = new Headers();
  if (location) headers.set("location", location);
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: () => Promise.resolve(body),
    headers,
  });
}

function lastCall(): [string, { headers: Record<string, string> }] {
  const call = mockFetch.mock.calls.at(-1);
  return call as [string, { headers: Record<string, string> }];
}
function lastUrl(): string {
  return lastCall()[0];
}
function lastHeaders(): Record<string, string> {
  return lastCall()[1].headers;
}

// ─── Fixtures (verified against the live LZJW-C31 ancestry, probe 2026-06-02) ─

const G = "http://gedcomx.org/";

function names(prefix: string | null, given: string, surname: string) {
  const parts: { type: string; value: string }[] = [];
  if (prefix) parts.push({ type: G + "Prefix", value: prefix });
  parts.push({ type: G + "Given", value: given });
  parts.push({ type: G + "Surname", value: surname });
  return [{ preferred: true, nameForms: [{ parts }] }];
}

function rawPerson(
  id: string,
  asc: string,
  prefix: string | null,
  given: string,
  surname: string,
  genderType: string,
  extra: Record<string, unknown> = {},
): FSAncestryResponse["persons"] extends (infer P)[] ? P : never {
  return {
    id,
    living: false,
    gender: { type: genderType },
    names: names(prefix, given, surname),
    display: { ascendancyNumber: asc, name: `${given} ${surname}` },
    ...extra,
  };
}

function leanResponse(): FSAncestryResponse {
  return {
    persons: [
      rawPerson("LZJW-C31", "1", "President", "Abraham", "Lincoln", G + "Male"),
      rawPerson("LCHV-P5R", "1-S", null, "Mary Ann", "Todd", G + "Female"),
      rawPerson("9VMF-H1F", "2", null, "Thomas Herring", "Lincoln", G + "Male"),
      rawPerson("KN6W-CSY", "3", null, "Nancy Elizabeth", "Hanks", G + "Female"),
    ],
  };
}

const THOMAS_FACTS = [
  {
    type: G + "Birth",
    date: { original: "6 January 1778" },
    place: { original: "Rockingham, Virginia, United States" },
  },
];
// Dangling source refs (no top-level sourceDescriptions in an ancestry response).
const THOMAS_SOURCES = [
  {
    id: "feaaf802-7bd2-4745-ab37-e39abf488271",
    description:
      "https://api.familysearch.org/platform/sources/descriptions/7SDM-WXR",
    descriptionId: "7SDM-WXR",
  },
];

function detailedResponse(): FSAncestryResponse {
  const r = leanResponse();
  const thomas = r.persons!.find((p) => p.id === "9VMF-H1F")!;
  (thomas as Record<string, unknown>).facts = THOMAS_FACTS;
  (thomas as Record<string, unknown>).sources = THOMAS_SOURCES;
  return r;
}

const RELATIONSHIPS = [
  {
    id: "93NL-RJ2",
    type: G + "Couple",
    person1: {
      resource: "https://api.familysearch.org/platform/tree/persons/9VMF-H1F",
      resourceId: "9VMF-H1F",
    },
    person2: {
      resource: "https://api.familysearch.org/platform/tree/persons/KN6W-CSY",
      resourceId: "KN6W-CSY",
    },
    facts: [
      {
        type: G + "Marriage",
        date: { original: "12 June 1806" },
        place: { original: "Washington, Kentucky, United States" },
      },
    ],
  },
];

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("person_ancestors", () => {
  // 1
  it("returns { persons } for a valid personId (default generations)", async () => {
    mockOk(leanResponse());
    const r = await personAncestorsTool({ personId: "LZJW-C31" });
    expect(Array.isArray(r.persons)).toBe(true);
    expect(r.persons.length).toBe(4);
  });

  // 2
  it("re-attaches ascendancyNumber and carries name prefixes", async () => {
    mockOk(leanResponse());
    const r = await personAncestorsTool({ personId: "LZJW-C31" });
    const byId = Object.fromEntries(r.persons.map((p) => [p.id, p.ascendancyNumber]));
    expect(byId["LZJW-C31"]).toBe("1");
    expect(byId["LCHV-P5R"]).toBe("1-S");
    expect(byId["9VMF-H1F"]).toBe("2");
    expect(byId["KN6W-CSY"]).toBe("3");
    const root = r.persons.find((p) => p.id === "LZJW-C31");
    expect(root?.names?.[0]?.prefix).toBe("President");
    expect(root?.names?.[0]?.given).toBe("Abraham");
  });

  // 3
  it("returns the simplified graph directly with no envelope", async () => {
    mockOk(leanResponse());
    const r = await personAncestorsTool({ personId: "LZJW-C31" });
    expect(Object.keys(r)).toEqual(["persons"]);
    expect(r).not.toHaveProperty("personId");
    expect(r).not.toHaveProperty("generations");
    expect(r).not.toHaveProperty("ancestorCount");
    expect(r.persons.length).toBe(4);
  });

  // 4
  it("throws when personId is missing or empty (no fetch)", async () => {
    await expect(
      personAncestorsTool({ personId: "" } as never),
    ).rejects.toThrow(/non-empty personId/);
    await expect(personAncestorsTool({} as never)).rejects.toThrow(
      /non-empty personId/,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // 5
  it("throws when generations is 0, 9, or non-integer (no fetch)", async () => {
    for (const g of [0, 9, 3.5]) {
      await expect(
        personAncestorsTool({ personId: "LZJW-C31", generations: g }),
      ).rejects.toThrow(/between 1 and 8/);
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // 6
  it("maps every input to its API parameter, omitting absent ones", async () => {
    mockOk(leanResponse());
    await personAncestorsTool({
      personId: "LZJW-C31",
      generations: 4,
      spouse: "LCHV-P5R",
      personDetails: true,
      marriageDetails: true,
      descendants: true,
    });
    const url = lastUrl();
    expect(url).toContain("person=LZJW-C31");
    expect(url).toContain("generations=4");
    expect(url).toContain("spouse=LCHV-P5R");
    expect(url).toContain("personDetails=true");
    expect(url).toContain("marriageDetails=true");
    expect(url).toContain("descendants=true");

    mockOk(leanResponse());
    await personAncestorsTool({ personId: "LZJW-C31" });
    const lean = lastUrl();
    expect(lean).not.toContain("spouse=");
    expect(lean).not.toContain("personDetails=");
    expect(lean).not.toContain("marriageDetails=");
    expect(lean).not.toContain("descendants=");
  });

  // 7
  it("defaults generations to 3 in the URL when not supplied", async () => {
    mockOk(leanResponse());
    await personAncestorsTool({ personId: "LZJW-C31" });
    expect(lastUrl()).toContain("generations=3");
  });

  // 8
  it("sends Accept fs-v1 + Authorization, and no User-Agent / Accept-Language", async () => {
    mockOk(leanResponse());
    await personAncestorsTool({ personId: "LZJW-C31" });
    const headers = lastHeaders();
    expect(headers.Accept).toBe("application/x-fs-v1+json");
    expect(headers.Authorization).toBe("Bearer test-token");
    expect("User-Agent" in headers).toBe(false);
    expect("Accept-Language" in headers).toBe(false);
  });

  // 9
  it("includes facts only when the response carries them (personDetails)", async () => {
    mockOk(leanResponse());
    const lean = await personAncestorsTool({ personId: "LZJW-C31" });
    expect(lean.persons.find((p) => p.id === "9VMF-H1F")?.facts).toBeUndefined();

    mockOk(detailedResponse());
    const rich = await personAncestorsTool({
      personId: "LZJW-C31",
      personDetails: true,
    });
    const thomas = rich.persons.find((p) => p.id === "9VMF-H1F");
    expect(thomas?.facts?.some((f) => f.type === "Birth")).toBe(true);
  });

  // 10
  it("strips dangling per-person sources", async () => {
    mockOk(detailedResponse());
    const r = await personAncestorsTool({
      personId: "LZJW-C31",
      personDetails: true,
    });
    for (const p of r.persons) expect(p.sources).toBeUndefined();
  });

  // 11
  it("shapes Couple relationships with bare IDs under marriageDetails; omits otherwise", async () => {
    mockOk({ ...detailedResponse(), relationships: RELATIONSHIPS });
    const r = await personAncestorsTool({
      personId: "LZJW-C31",
      marriageDetails: true,
    });
    expect(r.relationships?.length).toBe(1);
    const rel = r.relationships![0];
    expect(rel.type).toBe("Couple");
    expect(rel.person1).toBe("9VMF-H1F");
    expect(rel.person2).toBe("KN6W-CSY");
    expect(rel.facts?.some((f) => f.type === "Marriage")).toBe(true);

    mockOk(leanResponse());
    const r2 = await personAncestorsTool({ personId: "LZJW-C31" });
    expect(r2).not.toHaveProperty("relationships");
  });

  // 12
  it("preserves real FamilySearch IDs (no I1/N1 renumbering)", async () => {
    mockOk(leanResponse());
    const r = await personAncestorsTool({ personId: "LZJW-C31" });
    expect(r.persons.map((p) => p.id)).toContain("9VMF-H1F");
    expect(r.persons.every((p) => !/^[INF]\d+$/.test(p.id!))).toBe(true);
  });

  // 13
  it("returns { persons: [] } on 204", async () => {
    mockStatus(204);
    const r = await personAncestorsTool({ personId: "LZJW-C31" });
    expect(r).toEqual({ persons: [] });
  });

  // 14a
  it("follows a 301 to the merged-to person", async () => {
    mockStatus(
      301,
      "https://api.familysearch.org/platform/tree/ancestry?person=WXYZ-789&generations=3",
    );
    mockOk(leanResponse());
    const r = await personAncestorsTool({ personId: "ABCD-123" });
    expect(r.persons.length).toBe(4);
    expect(mockFetch.mock.calls[1][0] as string).toContain("person=WXYZ-789");
  });

  // 14b
  it("throws on a redirect loop (second 301)", async () => {
    mockStatus(301, "https://x/platform/tree/ancestry?person=A-1");
    mockStatus(301, "https://x/platform/tree/ancestry?person=B-2");
    await expect(
      personAncestorsTool({ personId: "ABCD-123" }),
    ).rejects.toThrow(/redirect loop/);
  });

  // 15
  it("propagates the auth error when not authenticated (no fetch)", async () => {
    mockedGetValidToken.mockReset();
    mockedGetValidToken.mockRejectedValueOnce(
      new Error("Call the login tool to authenticate."),
    );
    await expect(
      personAncestorsTool({ personId: "LZJW-C31" }),
    ).rejects.toThrow(/login tool/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // 16
  it("throws specific messages for 401/403/404/410/429", async () => {
    const cases: [number, RegExp][] = [
      [401, /401|re-authenticate/i],
      [403, /restricted/i],
      [404, /not found/i],
      [410, /deleted/i],
      [429, /rate limit/i],
    ];
    for (const [status, re] of cases) {
      mockStatus(status);
      await expect(
        personAncestorsTool({ personId: "LZJW-C31" }),
      ).rejects.toThrow(re);
    }
  });

  // 17
  it("surfaces the upstream 400 errors[0].message", async () => {
    mockStatus(400, undefined, {
      errors: [
        {
          code: 400,
          message: "readAncestry.generations: must be less than or equal to 8",
        },
      ],
    });
    await expect(
      personAncestorsTool({ personId: "LZJW-C31", generations: 8 }),
    ).rejects.toThrow(/must be less than or equal to 8/);
  });
});

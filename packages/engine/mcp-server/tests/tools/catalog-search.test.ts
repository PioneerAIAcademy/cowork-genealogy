/**
 * `catalog_search`. Every fixture shape here is one dev/probe-catalog.ts
 * measured against the live service; the traps each test pins are the ones
 * issue #2547 names, each of which gives a wrong answer with everything green.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LOCAL } from "../../src/auth/principal.js";

vi.mock("../../src/auth/refresh.js", () => ({ getValidToken: vi.fn() }));

const mockStandardPlaceToRepId = vi.hoisted(() => vi.fn());
vi.mock("../../src/utils/place-resolver.js", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("../../src/utils/place-resolver.js")>();
  return { ...real, standardPlaceToRepId: mockStandardPlaceToRepId };
});

import { catalogSearchTool } from "../../src/tools/catalog-search.js";
import { getValidToken } from "../../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../../src/constants.js";

const ITEM = "https://www.familysearch.org/service/search/catalog/item/";
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

/** One search hit, in the shape the service returns. */
function hit(id: string, title = "A register"): unknown {
  return {
    metadataHit: {
      metadata: {
        title: [{ value: title }],
        identifier: { value: `${ITEM}${id}` },
        repositoryCalls: [{ title: "FamilySearch Library" }],
      },
    },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Search answers first, then one item response per subsequent call. */
function respond(searchBody: unknown, ...items: unknown[]): void {
  mockFetch.mockReset();
  mockFetch.mockResolvedValueOnce(json(searchBody));
  for (const i of items) mockFetch.mockResolvedValueOnce(json(i));
  // mockImplementation, NOT mockResolvedValue: the latter installs ONE
  // Response instance and a body can be read once, so the second and later
  // item calls threw "Body is unusable" into the tool's catch and reported
  // `hydrated: false` as if the item had no detail. Measured: three targets
  // against one shared fallback gave t1:true t2:false t3:false.
  mockFetch.mockImplementation(async () => json({ source: {} }));
}

const searchUrl = (): string => String(mockFetch.mock.calls[0][0]);

beforeEach(() => {
  vi.mocked(getValidToken).mockResolvedValue("tok");
  mockStandardPlaceToRepId.mockReset();
  mockStandardPlaceToRepId.mockResolvedValue("333");
  mockFetch.mockReset();
});
afterEach(() => {
  // Trap 2 holds for every search this suite makes, not just the one test
  // that names it: without the flag the service ORs the terms and answers
  // 2,046,826 hits where the same query should answer 12,344. calls[0] is
  // always the search; a test that refuses before fetching makes none.
  const search = mockFetch.mock.calls[0];
  if (search) {
    const p = new URL(String(search[0])).searchParams;
    expect(p.get("m.queryRequireDefault")).toBe("on");
  }
  vi.restoreAllMocks();
});

describe("catalog_search — the query", () => {
  it("sends the place REP id, not the place id", async () => {
    // standardPlaceToPlaceId("Maine, United States") is 16, which the Catalog
    // reads as Timor-Leste and ANSWERS with — a wrong answer, not an error.
    respond({ totalHits: 803, searchHits: [] });
    await catalogSearchTool({ standardPlace: "Maine, United States" }, LOCAL);

    // Asserted as the WHOLE argument list, not `expect.anything()` for the
    // opts: `contextName` is a parent PLACE, and any other value there
    // suppresses the context the resolver derives from the input, which is
    // what resolved "Paris, Idaho, United States" to Paris, France.
    expect(mockStandardPlaceToRepId).toHaveBeenCalledWith("Maine, United States");
    expect(new URL(searchUrl()).searchParams.get("q.placeId")).toBe("333");
  });

  it("always sends m.queryRequireDefault=on", async () => {
    // Without it `lutheran` is 2,046,826 hits instead of 12,344.
    respond({ totalHits: 1, searchHits: [] });
    await catalogSearchTool({ keywords: "lutheran" }, LOCAL);
    expect(new URL(searchUrl()).searchParams.get("m.queryRequireDefault")).toBe("on");
  });

  it("never sends offset", async () => {
    // Under load a deep offset stops erroring and is silently ignored — 200
    // with page one — so a pager loops over page one forever.
    respond({ totalHits: 9999, searchHits: [] });
    await catalogSearchTool({ keywords: "x", count: 200 }, LOCAL);
    expect(new URL(searchUrl()).searchParams.has("offset")).toBe(false);
  });

  it("sends Accept: application/json and the browser user-agent", async () => {
    // Without Accept the service answers 200 with XML, so a JSON parse fails
    // on a response that looked successful.
    respond({ totalHits: 0, searchHits: [] });
    await catalogSearchTool({ keywords: "x" }, LOCAL);
    const headers = new Headers(
      (mockFetch.mock.calls[0][1] as RequestInit).headers as HeadersInit,
    );
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("User-Agent")).toBe(BROWSER_USER_AGENT);
    expect(headers.get("Authorization")).toBe("Bearer tok");
  });

  it("falls back to matching the place by name when it does not resolve", async () => {
    mockStandardPlaceToRepId.mockResolvedValue(null);
    respond({ totalHits: 2, searchHits: [] });
    const r = await catalogSearchTool({ standardPlace: "Nowhere" }, LOCAL);
    const p = new URL(searchUrl()).searchParams;
    expect(p.get("q.place")).toBe("Nowhere");
    expect(p.has("q.placeId")).toBe(false);
    expect(r.placeResolved).toBe(false);
  });

  it("refuses a query with nothing searchable in it", async () => {
    await expect(catalogSearchTool({ count: 10 }, LOCAL)).rejects.toThrow(
      /at least one of standardPlace/,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("catalog_search — hydration", () => {
  it("fetches identifier.value verbatim, including an olib hit", async () => {
    // `id` is DERIVED from identifier.value (url.slice(prefix)), so no fixture
    // can make the two disagree while the tool reads them this way — this
    // pins that an `olib:`-namespaced identifier is fetched as given and
    // hydrates, and it is the test that reds if a future change ever
    // reconstructs the URL from a parsed id instead.
    const olib = `${ITEM}olib:2333650`;
    respond(
      {
        totalHits: 2,
        searchHits: [hit("koha:1"), { metadataHit: { metadata: {
          title: [{ value: "An olib item" }],
          identifier: { value: olib },
          repositoryCalls: [],
        } } }],
      },
      { source: { note: { text: "n1" } } },
      { source: { note: { text: "n2" } } },
    );
    const r = await catalogSearchTool({ keywords: "x", hydrate: 2 }, LOCAL);

    const fetched = mockFetch.mock.calls.slice(1).map((c) => String(c[0]));
    expect(fetched).toContain(olib);
    expect(r.hits.every((h) => h.hydrated)).toBe(true);
  });

  it("never fetches an off-host identifier, and marks it unhydrated", async () => {
    // fsFetch attaches the user's bearer to whatever URL it is handed, and
    // this one arrived inside a response body. A catalogue identifier is
    // routinely an EXTERNAL resource id, so this needs no attacker.
    respond({
      totalHits: 1,
      searchHits: [{ metadataHit: { metadata: {
        title: [{ value: "Off-host" }],
        identifier: { value: "https://evil.example/service/search/catalog/item/koha:1" },
        repositoryCalls: [],
      } } }],
    });
    const r = await catalogSearchTool({ keywords: "x" }, LOCAL);

    expect(mockFetch).toHaveBeenCalledTimes(1); // the search only
    expect(r.hits[0].hydrated).toBe(false);
    expect(r.hits[0].url).toBeUndefined();
  });

  it("normalizes a repeated field from one value, several, and absent", async () => {
    // note/author/subject/film_note are XML-collapsed: an object for one, an
    // array for several, absent for none.
    respond(
      { totalHits: 3, searchHits: [hit("koha:1"), hit("koha:2"), hit("koha:3")] },
      // one value: a bare object
      {
        source: {
          film_note: { filmno: "111", digital_film_no: "999" },
          note: { text: "n1" },
          author: { value: "a1" },
          subject: { value: "s1" },
        },
      },
      // several: an array
      {
        source: {
          film_note: [{ filmno: "222" }, { filmno: "333" }],
          note: [{ text: "n1" }, { text: "n2" }],
          author: [{ value: "a1" }, { value: "a2" }],
          subject: [{ value: "s1" }, { value: "s2" }],
        },
      },
      // none: the key is absent entirely
      { source: {} },
    );
    const r = await catalogSearchTool({ keywords: "x", hydrate: 3 }, LOCAL);

    expect(r.hits[0].filmNotes).toHaveLength(1);
    expect(r.hits[0].filmNotes?.[0].imageGroupNumber).toBe("999");
    expect(r.hits[1].filmNotes).toHaveLength(2);
    expect(r.hits[2].filmNotes).toEqual([]);

    expect(r.hits[0].notes).toEqual(["n1"]);
    expect(r.hits[1].notes).toEqual(["n1", "n2"]);
    expect(r.hits[2].notes).toEqual([]);

    expect(r.hits[0].authors).toEqual(["a1"]);
    expect(r.hits[1].authors).toEqual(["a1", "a2"]);
    expect(r.hits[2].authors).toEqual([]);

    expect(r.hits[0].subjects).toEqual(["s1"]);
    expect(r.hits[1].subjects).toEqual(["s1", "s2"]);
    expect(r.hits[2].subjects).toEqual([]);
  });

  it("maps every film-note field to its own key", async () => {
    // Seven fields written as seven near-identical spreads, where one
    // mistyped repeat would be invisible; only two were asserted.
    respond(
      { totalHits: 1, searchHits: [hit("koha:1")] },
      { source: { film_note: {
        filmno: "111",
        digital_film_no: "999",
        fs_indexed: "Yes",
        shelf: "US/CAN Film",
        copy_location: "Granite Mountain Record Vault",
        text: "Baptisms 1750-1790",
        item_image_start_no: "42",
      } } },
    );
    const r = await catalogSearchTool({ keywords: "x" }, LOCAL);
    expect(r.hits[0].filmNotes?.[0]).toEqual({
      filmNumber: "111",
      imageGroupNumber: "999",
      indexed: "Yes",
      shelf: "US/CAN Film",
      copyLocation: "Granite Mountain Record Vault",
      text: "Baptisms 1750-1790",
      imageStartNumber: "42",
    });
  });

  it("surfaces digital_film_no as imageGroupNumber", async () => {
    // That is image_search's and fulltext_search's parameter name, so a
    // Catalog item hands them their input rather than leaving a film number.
    respond(
      { totalHits: 1, searchHits: [hit("koha:1")] },
      { source: { film_note: { filmno: "1416754", digital_film_no: "8941965" } } },
    );
    const r = await catalogSearchTool({ keywords: "x" }, LOCAL);
    expect(r.hits[0].filmNotes?.[0]).toMatchObject({
      filmNumber: "1416754",
      imageGroupNumber: "8941965",
    });
  });

  it("dedupes repositoryCalls, which repeat once per copy", async () => {
    respond({
      totalHits: 1,
      searchHits: [{ metadataHit: { metadata: {
        title: [{ value: "Six reels" }],
        identifier: { value: `${ITEM}koha:1` },
        repositoryCalls: [
          { title: "Granite Mountain Record Vault" },
          { title: "FamilySearch Library" },
          { title: "Granite Mountain Record Vault" },
          { title: "FamilySearch Library" },
          { title: "Online" },
        ],
      } } }],
    }, { source: {} });
    const r = await catalogSearchTool({ keywords: "x" }, LOCAL);
    expect(r.hits[0].repositoryCalls).toEqual([
      "Granite Mountain Record Vault",
      "FamilySearch Library",
      "Online",
    ]);
  });

  it("keeps the search successful when one item call fails", async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce(
      json({ totalHits: 2, searchHits: [hit("koha:1"), hit("koha:2")] }),
    );
    mockFetch.mockRejectedValueOnce(new Error("upstream exploded"));
    mockFetch.mockResolvedValueOnce(json({ source: { note: { text: "ok" } } }));

    const r = await catalogSearchTool({ keywords: "x", hydrate: 2 }, LOCAL);
    expect(r.returned).toBe(2);
    expect(r.hits.filter((h) => h.hydrated)).toHaveLength(1);
    // A failed item is NOT a timeout — the two want different things from the
    // caller: retry later, versus that item has no detail.
    expect(r.hydrationTimedOut).toBe(false);
  });

  it("holds all hydrate item calls in flight at once", async () => {
    // The budget arithmetic assumes it. At a fixed concurrency of 1 the same
    // ten degraded calls take 110s and the only symptom is a timeout flag.
    let inFlight = 0;
    let peak = 0;
    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce(
      json({ totalHits: 4, searchHits: [1, 2, 3, 4].map((n) => hit(`koha:${n}`)) }),
    );
    mockFetch.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return json({ source: {} });
    });
    await catalogSearchTool({ keywords: "x", hydrate: 4 }, LOCAL);
    expect(peak).toBe(4);
  });
});

describe("catalog_search — the budget", () => {
  it("abandons hydration at the deadline and flags it", async () => {
    // The mock RESOLVES at 90s rather than never resolving: with the deadline
    // removed a never-resolving mock hangs to the vitest timeout instead of
    // failing this assertion.
    vi.useFakeTimers();
    try {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(
        json({ totalHits: 1, searchHits: [hit("koha:1")] }),
      );
      mockFetch.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(json({ source: {} })), 90_000),
          ),
      );
      const promise = catalogSearchTool({ keywords: "x" }, LOCAL);
      await vi.advanceTimersByTimeAsync(120_000);
      const r = await promise;

      expect(r.hydrationTimedOut).toBe(true);
      expect(r.hits[0].hydrated).toBe(false);
      expect(r.returned).toBe(1); // the search still answered
    } finally {
      vi.useRealTimers();
    }
  });

  it("spends a slow search out of the budget hydration draws on", async () => {
    // The anchor is tool ENTRY: a search costing 45 s leaves hydration 5 s,
    // not a fresh 50 s. Re-anchored at the hydration phase, the item
    // resolving 10 s later would land and both assertions below invert —
    // which is what makes this the test for the anchor.
    vi.useFakeTimers();
    try {
      mockFetch.mockReset();
      mockFetch.mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () => resolve(json({ totalHits: 1, searchHits: [hit("koha:1")] })),
              45_000,
            ),
          ),
      );
      mockFetch.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(json({ source: { note: { text: "n" } } })), 10_000),
          ),
      );
      const promise = catalogSearchTool({ keywords: "x" }, LOCAL);
      await vi.advanceTimersByTimeAsync(120_000);
      const r = await promise;

      expect(r.hits[0].hydrated).toBe(false);
      expect(r.hydrationTimedOut).toBe(true);
      expect(r.returned).toBe(1); // the search itself still answered
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("catalog_search — shapes the service actually returns", () => {
  // Each of these returned a wrong answer with every test green.
  it("survives a search body whose repeated fields collapsed to one object", async () => {
    // `(m.repositoryCalls ?? []).map` threw TypeError out of the hits mapping
    // and failed the WHOLE search, rather than degrading one hit.
    respond({
      totalHits: 1,
      searchHits: [{ metadataHit: { metadata: {
        title: { value: "Collapsed" },
        identifier: { value: `${ITEM}koha:1` },
        repositoryCalls: { title: "Online" },
      } } }],
    });
    const r = await catalogSearchTool({ keywords: "x" }, LOCAL);
    expect(r.hits[0].title).toBe("Collapsed");
    expect(r.hits[0].repositoryCalls).toEqual(["Online"]);
  });

  it("reads a film number that arrived unquoted", async () => {
    // A JSON number yielded a film note of {} with hydrated: true — the hit
    // claimed a film and named neither it nor the DGS image_search needs.
    respond(
      { totalHits: 1, searchHits: [hit("koha:1")] },
      { source: { film_note: { filmno: 1416754, digital_film_no: 8941965 } } },
    );
    const r = await catalogSearchTool({ keywords: "x" }, LOCAL);
    expect(r.hits[0].filmNotes?.[0].filmNumber).toBe("1416754");
    expect(r.hits[0].filmNotes?.[0].imageGroupNumber).toBe("8941965");
  });

  it("keeps a note that collapsed to a bare string", async () => {
    // Text content with no attributes collapses to a string, which is the
    // ordinary shape of a free-text <note>; dropping it read as "no notes".
    respond(
      { totalHits: 1, searchHits: [hit("koha:1")] },
      { source: { note: ["a bare string note", { text: "obj" }] } },
    );
    const r = await catalogSearchTool({ keywords: "x" }, LOCAL);
    expect(r.hits[0].notes).toEqual(["a bare string note", "obj"]);
  });

  it.each([
    [true, true],
    [false, false],
    ["Y", true],
    ["N", false],
  ])("reads available_online of %s as %s", async (raw, expected) => {
    respond(
      { totalHits: 1, searchHits: [hit("koha:1")] },
      { source: { available_online: raw } },
    );
    const r = await catalogSearchTool({ keywords: "x" }, LOCAL);
    expect(r.hits[0].availableOnline).toBe(expected);
  });
});

describe("catalog_search — shapes the second review found", () => {
  it("answers a one-hit search whose searchHits collapsed to an object", async () => {
    // A precise query (a film number) is the ordinary way to get one hit,
    // and `.map` on the collapsed object threw the whole search away.
    mockFetch.mockReset();
    mockFetch.mockImplementation(async () =>
      json({ totalHits: 1, searchHits: hit("koha:1") }),
    );
    const r = await catalogSearchTool({ keywords: "x", hydrate: 0 }, LOCAL);
    expect(r.returned).toBe(1);
    expect(r.hits[0].title).toBe("A register");
  });

  it("finds the item url when it is not the first identifier", async () => {
    // A catalogue entry routinely carries an external id beside its item
    // URL; reading only [0] cost the hit its url, its id and its hydration.
    respond(
      {
        totalHits: 1,
        searchHits: [{ metadataHit: { metadata: {
          title: [{ value: "T" }],
          identifier: [{ value: "urn:isbn:0123456789" }, { value: `${ITEM}koha:1` }],
          repositoryCalls: [],
        } } }],
      },
      { source: { note: { text: "n" } } },
    );
    const r = await catalogSearchTool({ keywords: "x" }, LOCAL);
    expect(r.hits[0].url).toBe(`${ITEM}koha:1`);
    expect(r.hits[0].id).toBe("koha:1");
    expect(r.hits[0].hydrated).toBe(true);
  });

  it("still refuses an off-host identifier when several are present", async () => {
    // The other direction: widening the search over identifiers must not
    // weaken the host check.
    respond({
      totalHits: 1,
      searchHits: [{ metadataHit: { metadata: {
        title: [{ value: "T" }],
        identifier: [
          { value: "urn:isbn:1" },
          { value: "https://evil.example/service/search/catalog/item/koha:1" },
        ],
        repositoryCalls: [],
      } } }],
    });
    const r = await catalogSearchTool({ keywords: "x" }, LOCAL);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(r.hits[0].url).toBeUndefined();
  });

  it("reads a title, repository and identifier that collapsed to bare strings", async () => {
    // asArray preserves a bare string as { text }; a reader checking only
    // .value lost exactly the shape asArray went to the trouble of keeping.
    respond(
      {
        totalHits: 1,
        searchHits: [{ metadataHit: { metadata: {
          title: "A bare string title",
          identifier: `${ITEM}koha:1`,
          repositoryCalls: "Online",
        } } }],
      },
      { source: {} },
    );
    const r = await catalogSearchTool({ keywords: "x" }, LOCAL);
    expect(r.hits[0].title).toBe("A bare string title");
    expect(r.hits[0].repositoryCalls).toEqual(["Online"]);
    expect(r.hits[0].url).toBe(`${ITEM}koha:1`);
  });
});

describe("catalog_search — inputs the MCP boundary does not validate", () => {
  // server.ts casts `arguments` with `as unknown as CatalogSearchInput`, so
  // inputSchema constrains nothing at runtime and every shape below is a
  // plausible LLM call.
  it("accepts a film number that arrived unquoted", async () => {
    // The emptiness guard checked presence while buildQuery checked type, so
    // this passed the guard, was dropped by buildQuery, and went out as a
    // query with NO q.* filter — the top 25 of the whole catalogue returned
    // as if they answered the question.
    respond({ totalHits: 1, searchHits: [] });
    await catalogSearchTool({ filmNumber: 568142 } as never, LOCAL);
    expect(new URL(searchUrl()).searchParams.get("q.filmNumber")).toBe("568142");
  });

  it.each([
    ["a null place", { standardPlace: null }],
    ["blank keywords", { keywords: "   " }],
    ["an empty-object field", { title: {} }],
  ])("refuses %s rather than searching unfiltered", async (_label, input) => {
    await expect(catalogSearchTool(input as never, LOCAL)).rejects.toThrow(
      /at least one of standardPlace/,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([Number.NaN, 18.5])("refuses year %s before fetching", async (year) => {
    await expect(
      catalogSearchTool({ keywords: "x", year } as never, LOCAL),
    ).rejects.toThrow(/whole year/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("carries the upstream explanation into a 401 and a 403", async () => {
    // The detail was parsed and then discarded on exactly the two statuses
    // most likely to carry one.
    for (const [status, pattern] of [
      [401, /session not accepted.*Upstream said: Token expired/s],
      [403, /rate limiting or IP reputation.*Upstream said: Token expired/s],
    ] as [number, RegExp][]) {
      mockFetch.mockReset();
      mockFetch.mockImplementation(async () =>
        json({ detail: "Token expired" }, status),
      );
      await expect(catalogSearchTool({ keywords: "x" }, LOCAL)).rejects.toThrow(
        pattern,
      );
    }
  });

  it("does not state the 403's cause as fact", async () => {
    // A 403 alone cannot be told from a missing Catalog entitlement, which
    // waiting will never clear — so "wait and retry" must not be asserted as
    // the answer.
    mockFetch.mockReset();
    mockFetch.mockImplementation(async () => json({}, 403));
    await expect(catalogSearchTool({ keywords: "x" }, LOCAL)).rejects.toThrow(
      /USUALLY rate limiting.*entitlement/s,
    );
  });

  it("does not tell the agent to send a header the tool already sends", async () => {
    // The old 403 named an action nobody can take: HEADERS always sets the
    // browser UA, so the agent could only retry identically or misreport.
    mockFetch.mockReset();
    mockFetch.mockImplementation(async () => json({}, 403));
    await expect(catalogSearchTool({ keywords: "x" }, LOCAL)).rejects.toThrow(
      /already sent/,
    );
  });

  it("names the type when a bound is given as a string", async () => {
    // `count is 10` read as a value that already satisfied the stated rule.
    await expect(
      catalogSearchTool({ keywords: "x", count: "10" } as never, LOCAL),
    ).rejects.toThrow(/count is "10"/);
  });
});

describe("catalog_search — request volume", () => {
  it("does not retry an item call", async () => {
    // fetchWithRetry defaults to 3 attempts and retries every 429/5xx, which
    // is what the service answers once volume degrades it — turning the cap
    // of 25 into as many as 75 requests, under the exact condition the cap
    // was sized against.
    mockFetch.mockReset();
    mockFetch.mockImplementationOnce(async () =>
      json({ totalHits: 1, searchHits: [hit("koha:1")] }),
    );
    mockFetch.mockImplementation(async () => json({}, 503));
    const r = await catalogSearchTool({ keywords: "x", hydrate: 1 }, LOCAL);

    expect(mockFetch).toHaveBeenCalledTimes(2); // the search, then ONE item try
    expect(r.hits[0].hydrated).toBe(false);
  });

  it("hydrates every target when more than one shares the fallback fixture", async () => {
    // Guards the test helper itself: a single shared Response instance can be
    // read once, so later item calls failed into `hydrated: false` and any
    // future test would have been written against that wrong baseline.
    respond({
      totalHits: 3,
      searchHits: [hit("koha:1"), hit("koha:2"), hit("koha:3")],
    });
    const r = await catalogSearchTool({ keywords: "x", hydrate: 3 }, LOCAL);
    expect(r.hits.map((h) => h.hydrated)).toEqual([true, true, true]);
  });

  it("does not let an off-host hit consume a hydration slot", async () => {
    // hydrateRequested is documented as "the first N that carry a usable
    // url", not the first N positions.
    const off = (n: string) => ({ metadataHit: { metadata: {
      title: [{ value: n }], identifier: { value: `https://evil.example/${n}` },
      repositoryCalls: [],
    } } });
    respond(
      { totalHits: 3, searchHits: [off("a"), off("b"), hit("koha:1")] },
      { source: {} },
    );
    const r = await catalogSearchTool({ keywords: "x", hydrate: 1 }, LOCAL);
    expect(r.hits[2].hydrated).toBe(true);
    expect(r.hydrateRequested).toBe(1);
  });
});

describe("catalog_search — the place input", () => {
  it.each([
    ["an object", {}],
    ["an array", ["Maine", "United States"]],
    ["a blank string", "   "],
  ])("refuses standardPlace given as %s", async (_label, value) => {
    // Every other field is type-guarded; this one was read raw, so an
    // object/array/number reached normalizeKey and surfaced the internal
    // `s.trim is not a function` to the agent.
    await expect(
      catalogSearchTool({ keywords: "x", standardPlace: value } as never, LOCAL),
    ).rejects.toThrow(/standardPlace is .*non-blank string/s);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("treats an unquoted place as its text rather than crashing", async () => {
    // `searchableValue` coerces a number for the same reason `str` does
    // (unquoted film numbers), so this resolves as the name "1850" and comes
    // back unresolved — the point is that it no longer surfaces the
    // resolver's internal `s.trim is not a function` to the agent.
    mockStandardPlaceToRepId.mockResolvedValue(null);
    respond({ totalHits: 0, searchHits: [] });
    const r = await catalogSearchTool(
      { standardPlace: 1850 } as never,
      LOCAL,
    );
    expect(mockStandardPlaceToRepId).toHaveBeenCalledWith("1850");
    expect(r.placeResolved).toBe(false);
  });

  it("trims the place before it reaches the query", async () => {
    // A blank place the emptiness guard calls unsearchable still went out as
    // `q.place=+++`, filtering the Catalog on nothing.
    mockStandardPlaceToRepId.mockResolvedValue(null);
    respond({ totalHits: 0, searchHits: [] });
    await catalogSearchTool({ standardPlace: "  Maine, United States  " }, LOCAL);
    expect(mockStandardPlaceToRepId).toHaveBeenCalledWith("Maine, United States");
    expect(new URL(searchUrl()).searchParams.get("q.place")).toBe(
      "Maine, United States",
    );
  });

  it("reports placeResolved false when the rep id is empty", async () => {
    // buildQuery branches on `if (repId)`, so an empty rep id takes the name
    // fallback; `repId !== null` called that resolved.
    mockStandardPlaceToRepId.mockResolvedValue("");
    respond({ totalHits: 0, searchHits: [] });
    const r = await catalogSearchTool({ standardPlace: "Nowhere" }, LOCAL);
    expect(new URL(searchUrl()).searchParams.has("q.placeId")).toBe(false);
    expect(r.placeResolved).toBe(false);
  });
});

describe("catalog_search — reader consistency", () => {
  it("keeps a note element that collapsed to a bare number", async () => {
    // `str` carries a number branch for unquoted film numbers; the same
    // collapse one level up was dropped, reporting "no notes".
    respond(
      { totalHits: 1, searchHits: [hit("koha:1")] },
      { source: { note: 1416754 } },
    );
    const r = await catalogSearchTool({ keywords: "x" }, LOCAL);
    expect(r.hits[0].notes).toEqual(["1416754"]);
  });

  it("reads .value before .text identically for notes, authors and subjects", async () => {
    // notes read .text first while authors/subjects/title read .value first,
    // so one element carrying both was read two different ways.
    const both = { value: "from-value", text: "from-text" };
    respond(
      { totalHits: 1, searchHits: [hit("koha:1")] },
      { source: { note: both, author: both, subject: both } },
    );
    const r = await catalogSearchTool({ keywords: "x" }, LOCAL);
    expect(r.hits[0].notes).toEqual(["from-value"]);
    expect(r.hits[0].authors).toEqual(["from-value"]);
    expect(r.hits[0].subjects).toEqual(["from-value"]);
  });

  it("takes only the item segment as id", async () => {
    // Everything after the prefix carried a query string into a citation.
    respond(
      {
        totalHits: 1,
        searchHits: [{ metadataHit: { metadata: {
          title: [{ value: "T" }],
          identifier: { value: `${ITEM}koha:3308785?lang=en` },
          repositoryCalls: [],
        } } }],
      },
      { source: {} },
    );
    const r = await catalogSearchTool({ keywords: "x" }, LOCAL);
    expect(r.hits[0].id).toBe("koha:3308785");
  });

  it("drains a failed item response", async () => {
    // Under the degraded regime a hydrate of 25 produced 25 unconsumed undici
    // bodies per call, each holding its socket until GC.
    mockFetch.mockReset();
    mockFetch.mockImplementationOnce(async () =>
      json({ totalHits: 1, searchHits: [hit("koha:1")] }),
    );
    const body = JSON.stringify({ error: "upstream" });
    const res = new Response(body, { status: 503 });
    mockFetch.mockImplementation(async () => res);
    const r = await catalogSearchTool({ keywords: "x", hydrate: 1 }, LOCAL);
    expect(r.hits[0].hydrated).toBe(false);
    expect(res.bodyUsed).toBe(true);
  });
});

describe("catalog_search — numbers the suite never looked at", () => {
  it("reports totalHits and returned as different numbers", async () => {
    // EVERY fixture set totalHits === searchHits.length, the one combination
    // that cannot tell the two apart — and a combination never true in
    // production, which is the whole reason `count` exists. Swapping the two
    // fields left all 74 tests green.
    respond(
      { totalHits: 803, searchHits: [hit("koha:1"), hit("koha:2")] },
      { source: {} },
      { source: {} },
    );
    const r = await catalogSearchTool({ keywords: "x" }, LOCAL);
    expect(r.totalHits).toBe(803);
    expect(r.returned).toBe(2);
  });

  it.each([
    ["absent", undefined, 1],
    ["a quoted number", "803", 803],
    ["smaller than the hits beside it", 0, 1],
  ])("never contradicts the hits when totalHits is %s", async (_l, raw, want) => {
    respond(
      { ...(raw === undefined ? {} : { totalHits: raw }), searchHits: [hit("koha:1")] },
      { source: {} },
    );
    const r = await catalogSearchTool({ keywords: "x" }, LOCAL);
    expect(r.totalHits).toBe(want);
    expect(typeof r.totalHits).toBe("number");
  });

  it("defaults count to 25 and hydrate to 10", async () => {
    // Both constants were pinned by nothing: every test passed them
    // explicitly, so changing DEFAULT_HYDRATE to 25 left the suite green —
    // the one number the spec defends hardest.
    respond({
      totalHits: 40,
      searchHits: Array.from({ length: 40 }, (_, i) => hit(`koha:${i}`)),
    });
    const r = await catalogSearchTool({ keywords: "x" }, LOCAL);
    expect(new URL(searchUrl()).searchParams.get("count")).toBe("25");
    expect(mockFetch.mock.calls.length - 1).toBe(10); // item calls
    expect(r.hydrateRequested).toBe(10);
  });

  it("reports hydrateRequested as asked, not as attempted", async () => {
    // Both existing assertions used hydrate: 1 against exactly one usable
    // target, where `hydrate` and `targets.length` coincide; they differ
    // whenever fewer hits come back than were asked for, which is the common
    // case with the defaults.
    respond({ totalHits: 1, searchHits: [hit("koha:1")] }, { source: {} });
    const r = await catalogSearchTool({ keywords: "x", hydrate: 5 }, LOCAL);
    expect(r.hydrateRequested).toBe(5);
    expect(r.hits).toHaveLength(1);
  });

  it("caps each leg's timeout at the remaining budget", async () => {
    // The spec calls both load-bearing; neither was observed, because the
    // budget tests' mocks ignore the abort signal entirely. Dropping either
    // argument falls back to the 30s default and left the suite green.
    const spy = vi.spyOn(AbortSignal, "timeout");
    respond({ totalHits: 1, searchHits: [hit("koha:1")] }, { source: {} });
    await catalogSearchTool({ keywords: "x", hydrate: 1 }, LOCAL);
    const budgets = spy.mock.calls.map((c) => c[0]);
    expect(budgets).toHaveLength(2); // search, then one item
    // Both are the remaining budget, not the 30s default.
    for (const b of budgets) expect(b).toBeGreaterThan(30_000);
    expect(budgets[0]).toBeLessThanOrEqual(50_000);
    expect(budgets[1]).toBeLessThanOrEqual(budgets[0]);
  });

  it("returns the creator from a search hit, in every collapse shape", async () => {
    // `creator` is one quarter of the pre-hydration answer and the string
    // never appeared in this file; deleting its spread left the suite green.
    respond({
      totalHits: 3,
      searchHits: [
        { metadataHit: { metadata: { title: [{ value: "A" }], creator: [{ value: "Smith, John" }], identifier: { value: `${ITEM}koha:1` }, repositoryCalls: [] } } },
        { metadataHit: { metadata: { title: [{ value: "B" }], creator: "Bare String", identifier: { value: `${ITEM}koha:2` }, repositoryCalls: [] } } },
        { metadataHit: { metadata: { title: [{ value: "C" }], identifier: { value: `${ITEM}koha:3` }, repositoryCalls: [] } } },
      ],
    });
    const r = await catalogSearchTool({ keywords: "x", hydrate: 0 }, LOCAL);
    expect(r.hits[0].creator).toBe("Smith, John");
    expect(r.hits[1].creator).toBe("Bare String");
    expect(r.hits[2].creator).toBeUndefined();
  });
});

describe("catalog_search — shapes found by the fourth review", () => {
  it("hydrates from a source that collapsed to an array", async () => {
    // `source` is the PARENT of the four fields already defended against
    // this collapse. It reported hydrated: true with every field empty —
    // "not filmed, not online, no notes" — with the film number sitting in
    // the payload.
    respond(
      { totalHits: 1, searchHits: [hit("koha:1")] },
      { source: [{ note: { text: "n1" }, film_note: { filmno: "111" } }] },
    );
    const r = await catalogSearchTool({ keywords: "x" }, LOCAL);
    expect(r.hits[0].filmNotes?.[0].filmNumber).toBe("111");
    expect(r.hits[0].notes).toEqual(["n1"]);
  });

  it("does not claim hydration from a source that is not an object", async () => {
    respond(
      { totalHits: 1, searchHits: [hit("koha:1")] },
      { source: "a string" },
    );
    const r = await catalogSearchTool({ keywords: "x" }, LOCAL);
    expect(r.hits[0].hydrated).toBe(false);
  });

  it("keeps an RSLINK that is not a digital-library link, with its url", async () => {
    // Filtering every RSLINK assumed the regex caught them all. It does not:
    // the Archive.org link vanished from `notes` AND produced no url, so the
    // item's only online-access information disappeared.
    respond(
      { totalHits: 1, searchHits: [hit("koha:1")] },
      { source: { note: [
        { type: "RSLINK", text: '<a href="https://archive.org/details/foo">Full text at Archive.org</a>' },
        { text: "prose" },
      ] } },
    );
    const r = await catalogSearchTool({ keywords: "x" }, LOCAL);
    expect(r.hits[0].notes).toEqual([
      "Full text at Archive.org (https://archive.org/details/foo)",
      "prose",
    ]);
  });

  it.each([
    ["http, no www", "http://familysearch.org/library/books/idurl/1/555"],
    ["https, no www", "https://familysearch.org/library/books/idurl/1/555"],
  ])("matches a digital-library url given as %s", async (_l, url) => {
    respond(
      { totalHits: 1, searchHits: [hit("koha:1")] },
      { source: { note: { type: "RSLINK", text: `<a href="${url}">B</a>` } } },
    );
    const r = await catalogSearchTool({ keywords: "x" }, LOCAL);
    expect(r.hits[0].digitalLibraryUrl).toBe(url);
  });

  it("reads the digital-library url from .value as well as .text", async () => {
    // Three lines from a comment saying "textOf everywhere below", this one
    // read .text first — the same defect that comment records fixing.
    respond(
      { totalHits: 1, searchHits: [hit("koha:1")] },
      { source: { note: {
        type: "RSLINK",
        text: "Click here",
        value: '<a href="https://www.familysearch.org/library/books/idurl/1/555">B</a>',
      } } },
    );
    const r = await catalogSearchTool({ keywords: "x" }, LOCAL);
    expect(r.hits[0].digitalLibraryUrl).toBe(
      "https://www.familysearch.org/library/books/idurl/1/555",
    );
  });

  it("keeps a repository title that is itself a collapsed element", async () => {
    respond({
      totalHits: 1,
      searchHits: [{ metadataHit: { metadata: {
        title: [{ value: "T" }],
        identifier: { value: `${ITEM}koha:1` },
        repositoryCalls: [{ title: { value: "Online" } }, { title: "FamilySearch Library" }],
      } } }],
    });
    const r = await catalogSearchTool({ keywords: "x", hydrate: 0 }, LOCAL);
    expect(r.hits[0].repositoryCalls).toEqual(["Online", "FamilySearch Library"]);
  });

  it("drops a film note that names neither a film nor a DGS", async () => {
    // `{}` claims the item was filmed while naming nothing — the shape the
    // unquoted-number fix closed, reached by a different route.
    respond(
      { totalHits: 1, searchHits: [hit("koha:1")] },
      { source: { film_note: { filmno: "", digital_film_no: "", note_text: "x" } } },
    );
    const r = await catalogSearchTool({ keywords: "x" }, LOCAL);
    expect(r.hits[0].filmNotes).toEqual([]);
  });

  it("refuses the bare item prefix as an identifier", async () => {
    // It passes a startsWith check, yields `id: ""` for the citation, and
    // spends a hydration slot on a request that can only 404.
    respond({
      totalHits: 1,
      searchHits: [{ metadataHit: { metadata: {
        title: [{ value: "T" }], identifier: { value: ITEM }, repositoryCalls: [],
      } } }],
    });
    const r = await catalogSearchTool({ keywords: "x" }, LOCAL);
    expect(mockFetch).toHaveBeenCalledTimes(1); // no item call
    expect(r.hits[0].id).toBeUndefined();
    expect(r.hits[0].url).toBeUndefined();
  });

  it("names the Catalog when a 200 is not JSON", async () => {
    mockFetch.mockReset();
    mockFetch.mockImplementation(
      async () => new Response('<?xml version="1.0"?><a/>', { status: 200 }),
    );
    await expect(catalogSearchTool({ keywords: "x" }, LOCAL)).rejects.toThrow(
      /answered 200 with a body that is not JSON/,
    );
  });

  it("names the Catalog when a 200 body is literal null", async () => {
    mockFetch.mockReset();
    mockFetch.mockImplementation(async () => json(null));
    await expect(catalogSearchTool({ keywords: "x" }, LOCAL)).rejects.toThrow(
      /answered 200 with a body that is not JSON/,
    );
  });
});

describe("catalog_search — a dropped filter is a wider answer", () => {
  it.each([
    ["keywords", {}],
    ["title", ["a"]],
    ["availability", ["Online"]],
    ["surname", null],
  ])("refuses an unusable %s even when another field is usable", async (field, value) => {
    // The emptiness guard passes because standardPlace IS usable, and the
    // unusable field was then dropped from the query. The agent asked
    // "Maine + parish registers" and got the top 25 of all 3,902 Maine
    // items, with placeResolved: true and nothing saying so.
    await expect(
      catalogSearchTool(
        { standardPlace: "Maine, United States", [field]: value } as never,
        LOCAL,
      ),
    ).rejects.toThrow(new RegExp(`${field} is .*non-blank string`, "s"));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("still carries every usable field onto the query", async () => {
    // The other direction: refusing unusable values must not start refusing
    // legitimate ones.
    respond({ totalHits: 0, searchHits: [] });
    await catalogSearchTool(
      {
        standardPlace: "Maine, United States",
        keywords: "parish registers",
        title: "Registers",
        availability: "Online",
      },
      LOCAL,
    );
    const p = new URL(searchUrl()).searchParams;
    expect(p.get("q.keywords")).toBe("parish registers");
    expect(p.get("q.title")).toBe("Registers");
    expect(p.get("q.availability")).toBe("Online");
    expect(p.get("q.placeId")).toBe("333");
  });

  it.each([1e21, 0, -1850, Number.MAX_SAFE_INTEGER])(
    "refuses year %s", async (year) => {
      await expect(
        catalogSearchTool({ keywords: "x", year } as never, LOCAL),
      ).rejects.toThrow(/whole year between 1000 and 2200/);
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );

  it.each([1000, 1850, 2200])("accepts year %s", async (year) => {
    respond({ totalHits: 0, searchHits: [] });
    await catalogSearchTool({ keywords: "x", year }, LOCAL);
    expect(new URL(searchUrl()).searchParams.get("q.year")).toBe(String(year));
  });
});

describe("catalog_search — the digitized-book link", () => {
  const rslink = (n: number) => ({
    type: "RSLINK",
    text: `<a href="https://www.familysearch.org/library/books/idurl/1/${n}">Book</a>`,
  });

  it("surfaces the first RSLINK url and keeps its markup out of notes", async () => {
    // The only route to a digitized book, which has no film note at all, and
    // the one hand-written parser in the tool. The SECOND rslink is not the
    // one consumed, so it survives as readable text carrying its href.
    respond(
      { totalHits: 1, searchHits: [hit("koha:1")] },
      { source: { note: [{ text: "holdings prose" }, rslink(111), rslink(222)] } },
    );
    const r = await catalogSearchTool({ keywords: "x" }, LOCAL);
    expect(r.hits[0].digitalLibraryUrl).toBe(
      "https://www.familysearch.org/library/books/idurl/1/111",
    );
    expect(r.hits[0].notes).toEqual([
      "holdings prose",
      "Book (https://www.familysearch.org/library/books/idurl/1/222)",
    ]);
    expect(r.hits[0].notes?.join()).not.toContain("<a");
  });

  it("leaves digitalLibraryUrl unset when no note is an RSLINK", async () => {
    respond(
      { totalHits: 1, searchHits: [hit("koha:1")] },
      { source: { note: { text: "just prose" } } },
    );
    const r = await catalogSearchTool({ keywords: "x" }, LOCAL);
    expect(r.hits[0].digitalLibraryUrl).toBeUndefined();
  });
});

describe("catalog_search — the query parameters nothing else covers", () => {
  it("maps exactPlace, year, availability and count onto the query", async () => {
    // A typo in any one of these is either a 400 or a silently wider result
    // set. `q.availability` is case-sensitive: 'Online' 472, 'online' 0.
    respond({ totalHits: 0, searchHits: [] });
    await catalogSearchTool(
      {
        standardPlace: "Maine, United States",
        exactPlace: true,
        year: 1850,
        availability: "Online",
        count: 7,
      },
      LOCAL,
    );
    const p = new URL(searchUrl()).searchParams;
    expect(p.get("q.place.exact")).toBe("on");
    expect(p.get("q.year")).toBe("1850");
    expect(p.get("q.availability")).toBe("Online");
    expect(p.get("count")).toBe("7");
  });

  it("refuses exactPlace given without a place", async () => {
    // `.exact` alone 400s. Dropping it silently returned the WIDER set with
    // nothing saying so, and the agent read the hit count as an answer to
    // the narrower question it asked.
    await expect(
      catalogSearchTool({ keywords: "x", exactPlace: true }, LOCAL),
    ).rejects.toThrow(/needs a standardPlace beside it/);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("catalog_search — the budget, continued", () => {
  it("flags the budget when the search leg spent it all", async () => {
    // Hydration is never attempted, so every task short-circuits and `work`
    // wins the race in microtasks — reporting false, i.e. "these items have
    // no detail", when the truth is "retry later". That is the one case the
    // flag exists for.
    vi.useFakeTimers();
    try {
      mockFetch.mockReset();
      mockFetch.mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () => resolve(json({ totalHits: 1, searchHits: [hit("koha:1")] })),
              50_000,
            ),
          ),
      );
      mockFetch.mockResolvedValue(json({ source: { note: { text: "n" } } }));
      const promise = catalogSearchTool({ keywords: "x" }, LOCAL);
      await vi.advanceTimersByTimeAsync(200_000);
      const r = await promise;

      expect(r.hydrationTimedOut).toBe(true);
      expect(r.hits[0].hydrated).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(1); // no item call was made
    } finally {
      vi.useRealTimers();
    }
  });

  it("discards an item result that lands exactly on the deadline", async () => {
    // The expiry timer fires AT the deadline, so a `>` guard let a task
    // completing in that same millisecond write to a hit after the race had
    // already settled to "expired" — and `hits` is returned by reference.
    vi.useFakeTimers();
    try {
      mockFetch.mockReset();
      mockFetch.mockImplementationOnce(async () =>
        json({ totalHits: 1, searchHits: [hit("koha:1")] }),
      );
      mockFetch.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () => resolve(json({ source: { note: { text: "late" } } })),
              50_000,
            ),
          ),
      );
      const promise = catalogSearchTool({ keywords: "x", hydrate: 1 }, LOCAL);
      await vi.advanceTimersByTimeAsync(120_000);
      const r = await promise;

      expect(r.hydrationTimedOut).toBe(true);
      expect(r.hits[0].hydrated).toBe(false);
      expect(r.hits[0].notes).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("echoes hydrateRequested so an unattempted hit is not read as a failure", async () => {
    // With the defaults, 15 of 25 hits are hydrated: false purely because
    // they sat past the hydration window — indistinguishable from a 404
    // without this.
    respond(
      { totalHits: 3, searchHits: [hit("koha:1"), hit("koha:2"), hit("koha:3")] },
      { source: {} },
    );
    const r = await catalogSearchTool({ keywords: "x", hydrate: 1 }, LOCAL);
    expect(r.hydrateRequested).toBe(1);
    expect(r.hits[0].hydrated).toBe(true);
    expect(r.hits[2].hydrated).toBe(false); // never attempted, not failed
    expect(r.hydrationTimedOut).toBe(false);
  });
});

describe("catalog_search — errors", () => {
  it("names place resolution when it eats the whole budget", async () => {
    // Resolution is unbudgeted. Overrunning left the search a timeoutMs of 0,
    // whose abort reads "timed out after 0ms" and quotes the query URL but
    // names neither the Catalog nor a way out.
    vi.useFakeTimers();
    try {
      mockStandardPlaceToRepId.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve("333"), 55_000)),
      );
      mockFetch.mockResolvedValue(json({ totalHits: 1, searchHits: [] }));
      const promise = catalogSearchTool(
        { standardPlace: "Maine, United States" },
        LOCAL,
      );
      const assertion = expect(promise).rejects.toThrow(
        /resolving the place 'Maine, United States'.*Retry without standardPlace/s,
      );
      await vi.advanceTimersByTimeAsync(120_000);
      await assertion;
      expect(mockFetch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("carries the Catalog's own detail into a 400", async () => {
    // The service says WHICH parameter it rejected; discarding that left the
    // agent retrying the same query against nine candidates.
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(
      json(
        {
          detail: "Validation failure",
          instance: "/v3/search",
          status: 400,
          title: "Bad Request",
        },
        400,
      ),
    );
    // `statusText` is empty on a constructed Response; in production the
    // status line reads "400 Bad Request". What this pins is the detail.
    await expect(catalogSearchTool({ keywords: "x" }, LOCAL)).rejects.toThrow(
      /failed: 400.*— Validation failure$/,
    );
  });

  it("gives the shared re-auth instruction on a 401", async () => {
    // fsFetch re-reads tokens.json once before this; a 401 still here is the
    // user's session, not a stale in-process token.
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(json({}, 401));
    await expect(catalogSearchTool({ keywords: "x" }, LOCAL)).rejects.toThrow(
      /session not accepted; call the login tool/,
    );
  });

  it("names the user-agent requirement on a 403", async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(new Response("", { status: 403 }));
    await expect(catalogSearchTool({ keywords: "x" }, LOCAL)).rejects.toThrow(
      /browser User-Agent/,
    );
  });

  // Both bounds and whole numbers, on both params. A one-sided `> MAX` check
  // passed `hydrate: -1`, which slice()d to all-but-one hit and clamped
  // mapWithConcurrency to ONE worker: 59 serial item calls against a cap of 25.
  it.each([
    ["count", 201],
    ["count", 0],
    ["count", -5],
    ["count", 12.5],
    ["count", Number.NaN],
    ["hydrate", 26],
    ["hydrate", -1],
    ["hydrate", 2.5],
    ["hydrate", Number.NaN],
  ])("refuses %s of %s before fetching", async (field, value) => {
    await expect(
      catalogSearchTool({ keywords: "x", [field]: value }, LOCAL),
    ).rejects.toThrow(/whole number/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // The other direction: the legitimate edges still pass validation.
  it.each([
    ["count", 1],
    ["count", 200],
    ["hydrate", 0],
    ["hydrate", 25],
  ])("accepts %s of %s", async (field, value) => {
    respond({ totalHits: 0, searchHits: [] });
    await expect(
      catalogSearchTool({ keywords: "x", [field]: value }, LOCAL),
    ).resolves.toBeDefined();
  });
});

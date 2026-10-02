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

describe("catalog_search — the digitized-book link", () => {
  const rslink = (n: number) => ({
    type: "RSLINK",
    text: `<a href="https://www.familysearch.org/library/books/idurl/1/${n}">Book</a>`,
  });

  it("surfaces the first RSLINK url and keeps its markup out of notes", async () => {
    // The only route to a digitized book, which has no film note at all, and
    // the one hand-written parser in the tool.
    respond(
      { totalHits: 1, searchHits: [hit("koha:1")] },
      { source: { note: [{ text: "holdings prose" }, rslink(111), rslink(222)] } },
    );
    const r = await catalogSearchTool({ keywords: "x" }, LOCAL);
    expect(r.hits[0].digitalLibraryUrl).toBe(
      "https://www.familysearch.org/library/books/idurl/1/111",
    );
    expect(r.hits[0].notes).toEqual(["holdings prose"]);
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

  it("omits q.place.exact when no place is given", async () => {
    // `.exact` alone 400s, so it must not be sent without a place beside it.
    respond({ totalHits: 0, searchHits: [] });
    await catalogSearchTool({ keywords: "x", exactPlace: true }, LOCAL);
    expect(new URL(searchUrl()).searchParams.has("q.place.exact")).toBe(false);
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

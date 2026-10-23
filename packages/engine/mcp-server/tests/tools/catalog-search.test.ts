/**
 * `catalog_search`. Every fixture shape here is one dev/probe-catalog.ts
 * measured against the live service; the traps each test pins are the ones
 * issue #2547 names, each of which gives a wrong answer with everything green.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LOCAL } from "../../src/auth/principal.js";

vi.mock("../../src/auth/refresh.js", () => ({ getValidToken: vi.fn() }));

const mockStandardPlaceToRepId = vi.hoisted(() => vi.fn());
vi.mock("../../src/utils/place-resolver.js", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("../../src/utils/place-resolver.js")>();
  return { ...real, standardPlaceToRepId: mockStandardPlaceToRepId };
});

import {
  ANSWER_CHAR_BUDGET,
  catalogSearchTool,
  FILM_FIELDS,
  filmNotesHint,
  fitFilmNotes,
  mergeFilmNotes,
  REEL_TEXT_CAP,
  shapeAnswer,
} from "../../src/tools/catalog-search.js";
import type { CatalogFilmNote, CatalogHit, CatalogSearchResult } from "../../src/types/catalog-search.js";
import { getValidToken } from "../../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../../src/constants.js";
import { CLI_SPILL_CHARS } from "../helpers/cli-spill.js";

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

  it("maps every film-note field to its own key, and carries neither shelf nor imageStartNumber", async () => {
    // The fields were seven near-identical spreads, where one mistyped repeat
    // would be invisible; only two were asserted. `shelf` and
    // `item_image_start_no` arrive from the service and are not carried: no
    // plugin body, validator or fixture reads them (spec, Response).
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
      copyLocation: "Granite Mountain Record Vault",
      text: "Baptisms 1750-1790",
    });
    expect(Object.keys(r.hits[0].filmNotes?.[0] ?? {})).toEqual([
      "filmNumber", "imageGroupNumber", "indexed", "copyLocation", "text",
    ]);
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

describe("catalog_search — the exhaustive sweep", () => {
  it("never answers an empty catalogue from a collapsed body", async () => {
    // `typeof [] === "object"`, so an array body walked through the guard
    // meant to catch exactly this and returned a clean, authoritative
    // "the Catalog holds nothing" — negative evidence the agent never got.
    mockFetch.mockReset();
    mockFetch.mockImplementation(async () =>
      json([{ totalHits: 803, searchHits: [hit("koha:1")] }]),
    );
    const r = await catalogSearchTool({ keywords: "x", hydrate: 0 }, LOCAL);
    expect(r.totalHits).toBe(803);
    expect(r.returned).toBe(1);
  });

  it("reads a hit whose metadataHit collapsed to an array", async () => {
    // The two containers ABOVE title/creator/identifier/repositoryCalls —
    // the same parent relationship that made item.source a finding.
    respond(
      {
        totalHits: 1,
        searchHits: [{ metadataHit: [{ metadata: {
          title: [{ value: "Real" }],
          identifier: { value: `${ITEM}koha:1` },
          repositoryCalls: [],
        } }] }],
      },
      { source: {} },
    );
    const r = await catalogSearchTool({ keywords: "x" }, LOCAL);
    expect(r.hits[0].title).toBe("Real");
    expect(r.hits[0].url).toBe(`${ITEM}koha:1`);
    expect(r.hits[0].hydrated).toBe(true);
  });

  it.each([
    ["{value}", { value: "1416754" }],
    ["{text}", { text: "1416754" }],
    ["array", ["1416754"]],
    ["array of objects", [{ value: "1416754" }]],
  ])("reads a film number given as %s", async (_l, filmno) => {
    // All seven FILM_FIELDS keys were read with a bare `str()` that drops
    // every collapse shape, so the note became {} and was then removed —
    // "this item was never filmed", with the film sitting in the payload.
    respond(
      { totalHits: 1, searchHits: [hit("koha:1")] },
      { source: { film_note: { filmno } } },
    );
    const r = await catalogSearchTool({ keywords: "x" }, LOCAL);
    expect(r.hits[0].filmNotes?.[0].filmNumber).toBe("1416754");
  });

  it.each([
    [{ value: "Y" }, true],
    [["Y"], true],
    ["YES", true],
    ["true", true],
    [1, true],
    ["NO", false],
    ["N", false],
  ])("reads available_online %s as %s", async (raw, expected) => {
    // `=== "Y"` made every other truthy spelling assert FALSE — a positive
    // claim the item cannot be seen online, which stops the agent planning a
    // visit it could have made from a desk.
    respond(
      { totalHits: 1, searchHits: [hit("koha:1")] },
      { source: { available_online: raw } },
    );
    const r = await catalogSearchTool({ keywords: "x" }, LOCAL);
    expect(r.hits[0].availableOnline).toBe(expected);
  });

  it("leaves availableOnline absent for a spelling it does not know", async () => {
    // Absent reads as "not stated"; false is a claim.
    respond(
      { totalHits: 1, searchHits: [hit("koha:1")] },
      { source: { available_online: "sometimes" } },
    );
    const r = await catalogSearchTool({ keywords: "x" }, LOCAL);
    expect(r.hits[0].availableOnline).toBeUndefined();
  });

  it("reads totalHits that collapsed to an object", async () => {
    respond({ totalHits: { value: 803 }, searchHits: [hit("koha:1")] }, { source: {} });
    const r = await catalogSearchTool({ keywords: "x" }, LOCAL);
    expect(r.totalHits).toBe(803);
  });

  it("recognises an RSLINK whose type collapsed", async () => {
    respond(
      { totalHits: 1, searchHits: [hit("koha:1")] },
      { source: { note: {
        type: { value: "RSLINK" },
        text: '<a href="https://www.familysearch.org/library/books/idurl/1/555">B</a>',
      } } },
    );
    const r = await catalogSearchTool({ keywords: "x" }, LOCAL);
    expect(r.hits[0].digitalLibraryUrl).toBe(
      "https://www.familysearch.org/library/books/idurl/1/555",
    );
  });

  it("hydrates from every source block, not just the first", async () => {
    respond(
      { totalHits: 1, searchHits: [hit("koha:1")] },
      { source: [
        { note: { text: "n1" }, film_note: { filmno: "111" } },
        { note: { text: "n2" }, film_note: { filmno: "222" } },
      ] },
    );
    const r = await catalogSearchTool({ keywords: "x" }, LOCAL);
    expect(r.hits[0].notes).toEqual(["n1", "n2"]);
    expect(r.hits[0].filmNotes?.map((f) => f.filmNumber)).toEqual(["111", "222"]);
  });

  it("keeps a second library link whose url has the first as a prefix", async () => {
    // The filter was a substring test; sequential idurl ids make the prefix
    // relationship ordinary, and the second note vanished from both fields.
    const link = (n: string) => ({
      type: "RSLINK",
      text: `<a href="https://www.familysearch.org/library/books/idurl/1/${n}">B${n}</a>`,
    });
    respond(
      { totalHits: 1, searchHits: [hit("koha:1")] },
      { source: { note: [link("123"), link("1234")] } },
    );
    const r = await catalogSearchTool({ keywords: "x" }, LOCAL);
    expect(r.hits[0].digitalLibraryUrl).toBe(
      "https://www.familysearch.org/library/books/idurl/1/123",
    );
    expect(r.hits[0].notes).toHaveLength(1);
    expect(r.hits[0].notes?.[0]).toContain("idurl/1/1234");
  });

  it("keeps every title a repository entry lists", async () => {
    respond({
      totalHits: 1,
      searchHits: [{ metadataHit: { metadata: {
        title: [{ value: "T" }],
        identifier: { value: `${ITEM}koha:1` },
        repositoryCalls: [{ title: [{ value: "Vault" }, { value: "Online" }] }],
      } } }],
    });
    const r = await catalogSearchTool({ keywords: "x", hydrate: 0 }, LOCAL);
    expect(r.hits[0].repositoryCalls).toEqual(["Vault", "Online"]);
  });

  it("falls back to (untitled) rather than shipping a hit with no title", async () => {
    // CatalogHit.title is a required string; undefined would be dropped by
    // JSON.stringify and cross the MCP boundary with no title key at all.
    respond({
      totalHits: 1,
      searchHits: [{ metadataHit: { metadata: {
        identifier: { value: `${ITEM}koha:1` }, repositoryCalls: [],
      } } }],
    });
    const r = await catalogSearchTool({ keywords: "x", hydrate: 0 }, LOCAL);
    expect(r.hits[0].title).toBe("(untitled)");
  });

  it("clears the expiry timer when hydration finishes early", async () => {
    // Left pending, it holds the Node event loop open for the rest of the
    // 50s budget after the tool has returned.
    const clear = vi.spyOn(globalThis, "clearTimeout");
    respond({ totalHits: 1, searchHits: [hit("koha:1")] }, { source: {} });
    await catalogSearchTool({ keywords: "x", hydrate: 1 }, LOCAL);
    expect(clear).toHaveBeenCalled();
  });

  it.each([
    ["a string", "false"],
    ["a number", 1],
    ["an array", []],
    ["an object", {}],
  ])("refuses exactPlace given as %s", async (_l, value) => {
    // The one field with no type guard: every truthy shape silently turned
    // the NARROWING filter on, so two sweeps hunting widening walked past it.
    await expect(
      catalogSearchTool(
        { standardPlace: "Maine, United States", exactPlace: value } as never,
        LOCAL,
      ),
    ).rejects.toThrow(/exactPlace is .*true or false/s);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each(["count", "hydrate"])("refuses %s given as null", async (field) => {
    await expect(
      catalogSearchTool({ keywords: "x", [field]: null } as never, LOCAL),
    ).rejects.toThrow(/null is neither/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([Number.NaN, Infinity])("names %s as itself when refusing", async (v) => {
    // JSON.stringify renders both as the literal "null", so the agent was
    // told it sent a value it never sent.
    await expect(
      catalogSearchTool({ keywords: "x", count: v }, LOCAL),
    ).rejects.toThrow(new RegExp(`count is ${String(v)}`));
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

  it.each([
    ["online", "Online"],
    ["ONLINE", "Online"],
    ["Online", "Online"],
    ["oNlInE", "Online"],
  ])("normalises availability %s to %s", async (given, sent) => {
    // Matched EXACTLY upstream: measured live against Maine with exactPlace,
    // `Online` gives 473 and both `online` and `ONLINE` give 0 — a clean zero
    // with no error, which an agent records as "the Catalog holds nothing".
    respond({ totalHits: 0, searchHits: [] });
    await catalogSearchTool({ keywords: "x", availability: given }, LOCAL);
    expect(new URL(searchUrl()).searchParams.get("q.availability")).toBe(sent);
  });

  it("passes an unmeasured availability value through unchanged", async () => {
    // The other direction: only the one value measured live is normalised.
    // Guessing at others would invent a mapping nothing has verified.
    respond({ totalHits: 0, searchHits: [] });
    await catalogSearchTool({ keywords: "x", availability: "Microfilm" }, LOCAL);
    expect(new URL(searchUrl()).searchParams.get("q.availability")).toBe("Microfilm");
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

// ─── One entry per reel ─────────────────────────────────────────────────────────
//
// A hydrated item can carry a film note per frame range, dozens of them on one
// reel. Notes that agree on every field but `text` are one entry, texts joined
// with " | " in order. Nothing is dropped, and notes that differ in ANY other
// field stay apart: the plugin reads `copyLocation` and the numbers off each
// entry, so a merge across them would make an entry say something no note said.

/** The answer the tool gave for "Ireland" + "Catholic parish registers baptism
 *  marriage" on 2026-10-22, saved verbatim by `dev/try-catalog-search.ts --save`
 *  at the defaults (count 25, hydrate 10) before film notes were merged or
 *  budgeted: 433 hits, 25 returned, 10 hydrated, 55,803 characters. */
const IRELAND: CatalogSearchResult = JSON.parse(
  readFileSync(
    new URL("../fixtures/catalog-search/ireland-catholic-parish-registers.answer.json", import.meta.url),
    "utf-8",
  ),
);

/** One film note in the shape the service returns it. */
const note = (o: Record<string, string>): Record<string, string> => ({
  filmno: "100",
  digital_film_no: "900",
  fs_indexed: "Y",
  copy_location: "Granite Mountain Record Vault",
  ...o,
});

describe("catalog_search — one entry per reel", () => {
  /** One hit, hydrated with the given film notes, answered through the tool. */
  async function notesOf(...film: object[]): Promise<CatalogFilmNote[]> {
    respond({ totalHits: 1, searchHits: [hit("koha:1")] }, { source: { film_note: film } });
    const r = await catalogSearchTool({ keywords: "x" }, LOCAL);
    return r.hits[0].filmNotes ?? [];
  }

  it("notes on one reel become one entry, texts joined in the order given", async () => {
    const entries = await notesOf(
      note({ text: "MIC 1/1-10 baptisms" }),
      note({ text: "MIC 1/11-20 marriages" }),
      note({ text: "MIC 1/21-30 burials" }),
    );
    expect(entries).toEqual([
      {
        filmNumber: "100",
        imageGroupNumber: "900",
        indexed: "Y",
        copyLocation: "Granite Mountain Record Vault",
        text: "MIC 1/1-10 baptisms | MIC 1/11-20 marriages | MIC 1/21-30 burials",
      },
    ]);
  });

  it.each([
    ["filmno", "101"],
    ["digital_film_no", "901"],
    ["fs_indexed", "N"],
    ["copy_location", "FamilySearch Library"],
  ])("two notes that differ only in %s stay apart", async (field, other) => {
    const entries = await notesOf(note({ text: "a" }), note({ text: "b", [field]: other }));
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.text)).toEqual(["a", "b"]);
  });

  it("a note missing a field the other has stays apart from it", async () => {
    const { copy_location: _gone, ...noCopy } = note({ text: "b" });
    const entries = await notesOf(note({ text: "a" }), noCopy);
    expect(entries).toHaveLength(2);
    expect(entries[1]).not.toHaveProperty("copyLocation");
  });

  it("notes that differ only in a field the answer no longer carries are one reel", async () => {
    // `shelf` is where the reel sits, not which reel it is.
    const entries = await notesOf(
      note({ text: "a", shelf: "Film" }),
      note({ text: "b", shelf: "B1 Floor Film" }),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toBe("a | b");
    expect(entries[0]).not.toHaveProperty("shelf");
  });

  it("a note with no text adds no separator, and a reel with no text at all has no text key", async () => {
    const noText = (o: Record<string, string> = {}) => {
      const { text: _t, ...rest } = note(o);
      return rest;
    };
    const [middle] = await notesOf(note({ text: "a" }), noText(), note({ text: "b" }));
    expect(middle.text).toBe("a | b");
    const [bare] = await notesOf(noText(), noText());
    expect(bare).not.toHaveProperty("text");
  });

  it("entries keep the order their reel first appeared in, and a later note joins its reel's entry", async () => {
    const entries = await notesOf(
      note({ text: "r1-a" }),
      note({ text: "r2-a", filmno: "200", digital_film_no: "901" }),
      note({ text: "r1-b" }),
      note({ text: "r2-b", filmno: "200", digital_film_no: "901" }),
    );
    expect(entries.map((e) => [e.filmNumber, e.text])).toEqual([
      ["100", "r1-a | r1-b"],
      ["200", "r2-a | r2-b"],
    ]);
  });

  it("hydration reads neither shelf nor item_image_start_no, even when the service sends them", async () => {
    const [entry] = await notesOf(note({ text: "a", shelf: "Film", item_image_start_no: "42" }));
    expect(Object.keys(entry)).toEqual(["filmNumber", "imageGroupNumber", "indexed", "copyLocation", "text"]);
    // A note with nothing but those two is no entry at all, not an empty one: it
    // would claim the item was filmed while naming neither the film nor the DGS.
    respond({ totalHits: 1, searchHits: [hit("koha:1")] }, { source: { film_note: { shelf: "Film", item_image_start_no: "7" } } });
    const r = await catalogSearchTool({ keywords: "x" }, LOCAL);
    expect(r.hits[0].hydrated).toBe(true);
    expect(r.hits[0].filmNotes).toEqual([]);
  });

  describe("mergeFilmNotes", () => {
    it("is empty for no notes, and leaves a lone note as it was", () => {
      expect(mergeFilmNotes([])).toEqual([]);
      const lone = { filmNumber: "1", imageGroupNumber: "2", text: "t" };
      expect(mergeFilmNotes([lone])).toEqual([lone]);
    });

    it("drops a field the notes no longer carry, whatever it is called, and keeps the key order", () => {
      const saved = [
        { filmNumber: "1", imageGroupNumber: "2", indexed: "Y", shelf: "Film", copyLocation: "V", text: "t", imageStartNumber: "7", mystery: "x" },
      ] as unknown as CatalogFilmNote[];
      const [entry] = mergeFilmNotes(saved);
      expect(Object.keys(entry)).toEqual(["filmNumber", "imageGroupNumber", "indexed", "copyLocation", "text"]);
    });

    // The reel key is derived from FILM_FIELDS, so these loop over it: a field
    // added to the table is a field the key and the entry carry, with no second list.
    const identity = FILM_FIELDS.map(([key]) => key).filter((key) => key !== "text");
    const full = (o: CatalogFilmNote = {}): CatalogFilmNote => ({
      filmNumber: "10",
      imageGroupNumber: "20",
      indexed: "Y",
      copyLocation: "V",
      text: "t",
      ...o,
    });

    it("the reel key is every field of the film-note table but text", () => {
      expect(identity.length).toBeGreaterThanOrEqual(4);
      expect(FILM_FIELDS.map(([key]) => key)).toContain("text");
      for (const key of identity) {
        const entries = mergeFilmNotes([full(), full({ [key]: "other", text: "u" })]);
        expect(entries, `a note differing only in ${key}`).toHaveLength(2);
        // Every field of the table is carried by the entry, none stripped.
        for (const [carried] of FILM_FIELDS) expect(entries[0], `${carried} on the entry`).toHaveProperty(carried);
      }
    });

    it("the reel key cannot run one field into the next: filmNumber 1 with DGS 23 is not filmNumber 12 with DGS 3", () => {
      for (const [i, key] of identity.slice(0, -1).entries()) {
        const next = identity[i + 1];
        const merged = mergeFilmNotes([
          { [key]: "1", [next]: "23", text: "a" },
          { [key]: "12", [next]: "3", text: "b" },
        ]);
        expect(merged, `${key} then ${next}`).toHaveLength(2);
        expect(merged.map((e) => e.text)).toEqual(["a", "b"]);
      }
    });

    it("a field absent and a field never set are the same reel", () => {
      const merged = mergeFilmNotes([
        { filmNumber: "1", text: "a" },
        { filmNumber: "1", imageGroupNumber: undefined, text: "b" },
      ]);
      expect(merged).toEqual([{ filmNumber: "1", text: "a | b" }]);
    });

    it("a reel whose joined text passes the cap is several entries in a row, each with the reel's fields and whole notes", () => {
      const texts = Array.from({ length: Math.ceil((3 * REEL_TEXT_CAP) / 300) }, (_, j) => `n${j}:`.padEnd(300, "x"));
      const entries = mergeFilmNotes(texts.map((text) => full({ text })));
      expect(entries.length).toBeGreaterThan(1);
      for (const [i, e] of entries.entries()) {
        const { text: _t, ...reel } = e;
        expect(reel).toEqual({ filmNumber: "10", imageGroupNumber: "20", indexed: "Y", copyLocation: "V" });
        expect((e.text ?? "").length).toBeLessThanOrEqual(REEL_TEXT_CAP);
        // Each run is as full as it can be: the next note would have passed the cap.
        const next = entries[i + 1]?.text?.split(" | ")[0];
        if (next !== undefined) expect((e.text ?? "").length + 3 + next.length).toBeGreaterThan(REEL_TEXT_CAP);
      }
      // Nothing is lost and nothing moves: the notes' texts, in their order.
      expect(entries.flatMap((e) => (e.text ?? "").split(" | "))).toEqual(texts);
    });

    it("a joined text of exactly the cap is one entry, and one character more is two", () => {
      const first = Math.floor(REEL_TEXT_CAP / 2);
      const a = "a".repeat(first);
      const fits = "b".repeat(REEL_TEXT_CAP - first - 3);
      expect(mergeFilmNotes([full({ text: a }), full({ text: fits })])).toHaveLength(1);
      expect(mergeFilmNotes([full({ text: a }), full({ text: `${fits}b` })])).toHaveLength(2);
    });

    it("a note longer than the cap stands alone, whole, with the notes around it still in order", () => {
      const huge = "h".repeat(REEL_TEXT_CAP + 500);
      const entries = mergeFilmNotes([full({ text: "a" }), full({ text: huge }), full({ text: "b" })]);
      expect(entries.map((e) => e.text)).toEqual(["a", huge, "b"]);
    });

    it("the entries of a dense reel stay together, ahead of the next reel", () => {
      const dense = Array.from({ length: Math.ceil((3 * REEL_TEXT_CAP) / 400) }, (_, j) => full({ text: `${j}`.padEnd(400, "x") }));
      const other = full({ filmNumber: "11", text: "o" });
      const entries = mergeFilmNotes([dense[0], other, ...dense.slice(1)]);
      expect(entries.length).toBeGreaterThan(2);
      // The other reel's note came second, yet its entry comes after every run of the dense one.
      expect(entries.map((e) => e.filmNumber)).toEqual([...Array(entries.length - 1).fill("10"), "11"]);
      expect(entries.at(-1)).toEqual(other);
    });

    it("is idempotent on a dense reel: its runs do not join again", () => {
      const dense = Array.from({ length: 40 }, (_, j) => full({ text: `${j}:`.padEnd(150 + (j % 7) * 90, "x") }));
      const once = mergeFilmNotes(dense);
      expect(once.length).toBeGreaterThan(1);
      expect(mergeFilmNotes(once)).toEqual(once);
    });

    it("is idempotent, and does not touch its input", () => {
      const input: CatalogFilmNote[] = [
        { filmNumber: "1", text: "a" },
        { filmNumber: "1", text: "b" },
        { filmNumber: "2", text: "c" },
      ];
      const copy = structuredClone(input);
      const once = mergeFilmNotes(input);
      expect(input).toEqual(copy);
      expect(mergeFilmNotes(once)).toEqual(once);
    });
  });

  it("on the saved Ireland answer, loses no text and no reel: 76 notes of one hit become entries one reel after another", () => {
    const first = IRELAND.hits[0];
    const original = first.filmNotes ?? [];
    expect(original).toHaveLength(76);
    const merged = mergeFilmNotes(original);
    // The reel, as the rule defines it, counted here independently of the code.
    const reelOfNote = (n: CatalogFilmNote): string =>
      JSON.stringify([n.filmNumber ?? null, n.imageGroupNumber ?? null, n.indexed ?? null, n.copyLocation ?? null]);
    const reels = [...new Set(original.map(reelOfNote))];
    expect(merged.length).toBeLessThan(original.length);
    // Every reel is there, its entries sit together, and reels keep the order they first appeared in.
    const sequence = merged.map(reelOfNote);
    expect(sequence.filter((k, i) => k !== sequence[i - 1])).toEqual(reels);
    // Lossless: every text survives, once, in the order its reel had it. No note
    // text contains the separator, so splitting gives the originals back.
    expect(original.every((n) => !n.text?.includes(" | "))).toBe(true);
    for (const reel of reels) {
      const notes = original.filter((n) => reelOfNote(n) === reel).map((n) => n.text ?? "");
      const entries = merged.filter((e) => reelOfNote(e) === reel).flatMap((e) => (e.text ?? "").split(" | "));
      expect(entries).toEqual(notes);
    }
    // Every entry still carries what the plugin reads, and none passes the cap.
    for (const e of merged) {
      expect(e.filmNumber).toBeDefined();
      expect(e.imageGroupNumber).toBeDefined();
      expect((e.text ?? "").length).toBeLessThanOrEqual(REEL_TEXT_CAP);
    }
  });
});

// ─── The answer stays under the spill line ───────────────────────────────────────
//
// Claude Code saves any tool result over CLI_SPILL_CHARS to a file and hands the
// agent a preview, and locality-guide has `Read` but no `Bash`, so the hits past
// the preview were lost. A hydrated item can carry thousands of film notes
// (`Norway` + `kirkebøker` was 1,476,812 characters), so the film notes are
// fitted into ANSWER_CHAR_BUDGET: a hit that does not fit lists the entries that
// do, in the item's order, and says how many it has. The serialized answer is
// never truncated.

/** What the service would have answered to produce `saved`: the search body and
 *  one item body per hydrated hit, in hit order. `saved` is the tool's own
 *  output, so this is its inverse; the first test below proves the round trip. */
function upstreamFor(saved: CatalogSearchResult): { search: unknown; items: unknown[] } {
  const search = {
    totalHits: saved.totalHits,
    searchHits: saved.hits.map((h) => ({
      metadataHit: {
        metadata: {
          title: [{ value: h.title }],
          ...(h.creator ? { creator: [{ value: h.creator }] } : {}),
          identifier: h.url ? { value: h.url } : [],
          repositoryCalls: h.repositoryCalls.map((title) => ({ title })),
        },
      },
    })),
  };
  const items = saved.hits
    .filter((h) => h.hydrated)
    .map((h) => ({
      source: {
        note: (h.notes ?? []).map((text) => ({ text })),
        author: (h.authors ?? []).map((value) => ({ value })),
        subject: (h.subjects ?? []).map((value) => ({ value })),
        film_note: (h.filmNotes ?? []).map((n) => {
          const raw = n as Record<string, string | undefined>;
          return {
            filmno: raw.filmNumber,
            digital_film_no: raw.imageGroupNumber,
            fs_indexed: raw.indexed,
            shelf: raw.shelf,
            copy_location: raw.copyLocation,
            text: raw.text,
          };
        }),
        ...(h.availableOnline !== undefined ? { available_online: h.availableOnline } : {}),
      },
    }));
  return { search, items };
}

/** The distinct reels of a note list, by the rule, counted independently of the code. */
const reelKeys = (notes: readonly CatalogFilmNote[]): Set<string> =>
  new Set(
    notes.map((n) => JSON.stringify([n.filmNumber ?? null, n.imageGroupNumber ?? null, n.indexed ?? null, n.copyLocation ?? null])),
  );

/** `small` is some of `big`'s entries, whole, in `big`'s order. */
const isSubsequence = (small: readonly CatalogFilmNote[], big: readonly CatalogFilmNote[]): boolean => {
  let at = 0;
  for (const entry of small) {
    const key = JSON.stringify(entry);
    while (at < big.length && JSON.stringify(big[at]) !== key) at++;
    if (at === big.length) return false;
    at++;
  }
  return true;
};

const size = (r: unknown): number => JSON.stringify(r).length;

/** Film notes in the service's shape, one reel (one DGS) each: the `Norway,
 *  kirkebøker : Volume N` digital collections look like this. */
const reels = (count: number, textLength = 40, from = 0): object[] =>
  Array.from({ length: count }, (_, j) => ({
    filmno: String(1_000_000 + from + j),
    digital_film_no: String(5_000_000 + from + j),
    fs_indexed: "Y",
    copy_location: "Granite Mountain Record Vault",
    text: `${j + from}:`.padEnd(textLength, "x"),
  }));

/** The entry the tool should list for `reels(...)[j]`. */
const entryFor = (j: number, textLength = 40): CatalogFilmNote => ({
  filmNumber: String(1_000_000 + j),
  imageGroupNumber: String(5_000_000 + j),
  indexed: "Y",
  copyLocation: "Granite Mountain Record Vault",
  text: `${j}:`.padEnd(textLength, "x"),
});

/** `count` search hits, the first `film.length` of which are hydrated with the given notes. */
function answerWith(count: number, film: object[][]): void {
  const ids = Array.from({ length: count }, (_, i) => `olib:${4_000_000 + i}`);
  respond(
    { totalHits: count + 400, searchHits: ids.map((id) => hit(id, `Norway, kirkebøker : ${id}`)) },
    ...film.map((notes) => ({ source: { film_note: notes } })),
  );
}

/** The saved Ireland answer padded with hits of its own shape that carry no detail, up to `count`. */
function paddedIreland(count: number): CatalogSearchResult {
  const padded = structuredClone(IRELAND);
  const bare = IRELAND.hits.filter((h) => !h.hydrated);
  for (let k = 0; padded.hits.length < count; k++) {
    const id = `koha:pad${k}`;
    padded.hits.push({ ...structuredClone(bare[k % bare.length]), id, url: `${ITEM}${id}` });
  }
  padded.returned = padded.hits.length;
  return padded;
}

/** A hydrated hit as the fit sees it, holding these entries already merged. */
function hitOf(id: string, entries: CatalogFilmNote[], extra: Partial<CatalogHit> = {}): CatalogHit {
  return { id, title: id, repositoryCalls: [], url: `https://example.test/${id}`, hydrated: true, filmNotes: entries, ...extra };
}

/** `entryFor` with a text of that length: an entry whose JSON is 124 characters more. */
const bigEntry = (j: number, textLength: number): CatalogFilmNote => entryFor(j, textLength);

/** An answer around those hits, as the fit sees it. */
function answerOf(hits: CatalogHit[], hydrateRequested = 10): CatalogSearchResult {
  return { totalHits: hits.length, returned: hits.length, placeResolved: true, hydrationTimedOut: false, hydrateRequested, hits };
}

describe("catalog_search — the answer stays under the spill line", () => {
  it("the budget is 40,000, at least 10,000 under the 50,000 spill line", () => {
    // Imported everywhere below, so a changed constant would keep every other
    // assertion here true; this one pins the value itself.
    expect(ANSWER_CHAR_BUDGET).toBe(40_000);
    expect(CLI_SPILL_CHARS - ANSWER_CHAR_BUDGET).toBeGreaterThanOrEqual(10_000);
  });

  it("a reel's text is split into entries of at most 2,000 characters, the figure the spec gives", () => {
    // The dense-reel tests derive their notes from the constant, so a changed cap
    // would keep them true; this one pins the value the spec states.
    expect(REEL_TEXT_CAP).toBe(2_000);
  });

  it("turns the saved Ireland answer back into the search response and the ten item responses", () => {
    // The inverse the next tests rest on: the upstream responses the tool would
    // have fetched for `IRELAND`. The next test runs them through the tool and
    // compares every field the shaping does not touch.
    const { search, items } = upstreamFor(IRELAND);
    const s = search as { totalHits: number; searchHits: unknown[] };
    expect(s.totalHits).toBe(433);
    expect(s.searchHits).toHaveLength(25);
    expect(items).toHaveLength(10);
  });

  it("the Ireland call at the defaults stays under the spill line, lists every hit, and keeps the DGS on a hydrated hit", async () => {
    const { search, items } = upstreamFor(IRELAND);
    respond(search, ...items);
    const r = await catalogSearchTool({ standardPlace: "Ireland", keywords: "Catholic parish registers baptism marriage" }, LOCAL);

    // At the defaults: count 25 asked for, ten item calls made.
    expect(new URL(searchUrl()).searchParams.get("count")).toBe("25");
    expect(mockFetch).toHaveBeenCalledTimes(1 + 10);

    expect(size(r)).toBeLessThan(CLI_SPILL_CHARS);
    expect(size(r)).toBeLessThanOrEqual(ANSWER_CHAR_BUDGET);
    // Every hit is still listed, in order, and nothing but film notes changed.
    expect(r.hits).toHaveLength(25);
    expect(r.hits.map((h) => h.id)).toEqual(IRELAND.hits.map((h) => h.id));
    for (const [i, h] of r.hits.entries()) {
      const { filmNotes: _f, filmNotesTotal: _t, filmNotesHint: _h, ...rest } = h;
      const { filmNotes: _sf, ...saved } = IRELAND.hits[i];
      expect(rest).toEqual(saved);
    }
    expect(r.totalHits).toBe(433);
    expect(r.returned).toBe(25);

    // imageGroupNumber survives on the first entry of every hydrated hit that has film notes.
    const withNotes = r.hits.filter((h) => h.hydrated && (h.filmNotes?.length ?? 0) > 0);
    expect(withNotes.length).toBeGreaterThan(5);
    for (const h of withNotes) expect(h.filmNotes?.[0].imageGroupNumber).toMatch(/^\d+$/);
    expect(r.hits[0].filmNotes?.[0]).toMatchObject({ filmNumber: "1701904", imageGroupNumber: "8100253" });
  });

  it("on that call only the giant at rank 1 is cut: it lists entries of its own in the item's order, keeps every reel's numbers, and says how much and how to get the rest", async () => {
    const { search, items } = upstreamFor(IRELAND);
    respond(search, ...items);
    const r = await catalogSearchTool({ standardPlace: "Ireland", keywords: "Catholic parish registers baptism marriage" }, LOCAL);

    const cut = r.hits.filter((h) => h.filmNotesTotal !== undefined);
    expect(cut.map((h) => h.id)).toEqual(["koha:449751"]);
    const giant = cut[0];
    const entries = mergeFilmNotes(IRELAND.hits[0].filmNotes ?? []);
    const listed = giant.filmNotes ?? [];
    // The unit is the entry, and a dense reel is several of them.
    expect(giant.filmNotesTotal).toBe(entries.length);
    expect(entries.length).toBeGreaterThan(reelKeys(IRELAND.hits[0].filmNotes ?? []).size);
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.length).toBeLessThan(entries.length);
    // What is listed is some of the item's entries, whole, in the item's order.
    expect(isSubsequence(listed, entries)).toBe(true);
    // No reel loses its numbers while another keeps more text: all seven reels
    // are listed, including the last two that a list ending at the first entry
    // that did not fit used to lose, with the DGS image_search is handed.
    expect(reelKeys(entries).size).toBe(7);
    expect(reelKeys(listed)).toEqual(reelKeys(entries));
    for (const dgs of ["8100258", "8098556"]) expect(JSON.stringify(r)).toContain(`"imageGroupNumber":"${dgs}"`);
    // The hint says how many are listed, and the way back that can work for a hit
    // at rank 1 of a call that hydrated ten: one hydrate away.
    expect(giant.filmNotesHint).toContain(`${listed.length} of ${entries.length} film-note entries are listed`);
    expect(giant.filmNotesHint).toContain("call again with hydrate: 1");
    expect(giant.filmNotesHint).toContain("keywords that name this item");
    expect(giant.filmNotesHint).not.toContain("hydrate fewer");
    // The hit's url is the Catalog's item record (401 without a token): not a way back.
    expect(giant.url).toBeTruthy();
    expect(giant.filmNotesHint).not.toContain(giant.url as string);
    expect(giant.filmNotesHint).not.toContain("catalog entry");
    expect(giant.filmNotesHint).not.toContain("\n");
    // The nine others list everything they have and carry neither field.
    for (const h of r.hits.filter((x) => x !== giant)) {
      expect(h).not.toHaveProperty("filmNotesTotal");
      expect(h).not.toHaveProperty("filmNotesHint");
    }
  });

  it("hydrating one hit leaves it the whole budget: every reel of the Ireland giant is listed", async () => {
    // The way back that needs no new input: fewer hydrated hits, more room each.
    const { search, items } = upstreamFor(IRELAND);
    respond(search, items[0]);
    const r = await catalogSearchTool(
      { standardPlace: "Ireland", keywords: "Catholic parish registers baptism marriage", hydrate: 1 },
      LOCAL,
    );
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const entries = mergeFilmNotes(IRELAND.hits[0].filmNotes ?? []);
    expect(r.hits[0].filmNotes).toEqual(entries);
    expect(r.hits[0]).not.toHaveProperty("filmNotesTotal");
    expect(r.hits[0]).not.toHaveProperty("filmNotesHint");
    expect(size(r)).toBeLessThanOrEqual(ANSWER_CHAR_BUDGET);
  });

  describe("a Norway-sized page: ten hydrated items of hundreds to thousands of reels each", () => {
    // `Norway` + `kirkebøker` was 1,476,812 characters: ten hydrated hits, nine
    // of them digital collections with 434 to 1,804 notes, each its own DGS, so
    // merging cannot help. Generated here, since the real page is 1.4 MB.
    const sizes = [1243, 1369, 1610, 1804, 434, 1200, 1776, 1567, 1222, 3];

    it("is bounded by the budget at the defaults, lists all 25 hits, and cuts each giant to a prefix of its own entries", async () => {
      answerWith(25, sizes.map((n) => reels(n)));
      const r = await catalogSearchTool({ standardPlace: "Norway", keywords: "kirkebøker" }, LOCAL);

      expect(size(r)).toBeLessThanOrEqual(ANSWER_CHAR_BUDGET);
      expect(size(r)).toBeLessThan(CLI_SPILL_CHARS);
      expect(r.hits).toHaveLength(25);
      expect(r.hits.filter((h) => h.hydrated)).toHaveLength(10);
      for (const [i, n] of sizes.entries()) {
        const h = r.hits[i];
        if (n === 3) {
          // A small item beside the giants is listed whole.
          expect(h.filmNotes).toHaveLength(3);
          expect(h).not.toHaveProperty("filmNotesTotal");
          continue;
        }
        expect(h.filmNotesTotal).toBe(n);
        const listed = h.filmNotes ?? [];
        expect(listed.length).toBeGreaterThan(0);
        expect(listed.length).toBeLessThan(n);
        // The first entries, in order, whole: nothing cut mid-entry.
        expect(listed).toEqual(Array.from({ length: listed.length }, (_, j) => entryFor(j)));
        expect(h.filmNotesHint).toMatch(new RegExp(`^${listed.length} of ${n} film-note entries are listed`));
        expect(h.filmNotesHint).not.toContain(h.url as string);
      }
    });

    it("is bounded at any hydrate: 25 giants are cut to the same budget", async () => {
      answerWith(25, Array.from({ length: 25 }, () => reels(1804)));
      const r = await catalogSearchTool({ standardPlace: "Norway", keywords: "kirkebøker", hydrate: 25 }, LOCAL);
      expect(size(r)).toBeLessThanOrEqual(ANSWER_CHAR_BUDGET);
      expect(r.hits).toHaveLength(25);
      expect(r.hits.every((h) => h.filmNotesTotal === 1804 && (h.filmNotes?.length ?? 0) >= 1)).toBe(true);
    });

    it("one giant alone gets the whole budget: far more entries than when ten share it", async () => {
      answerWith(3, [reels(1804)]);
      const alone = await catalogSearchTool({ standardPlace: "Norway", keywords: "kirkebøker", hydrate: 1 }, LOCAL);
      answerWith(25, Array.from({ length: 10 }, () => reels(1804)));
      const shared = await catalogSearchTool({ standardPlace: "Norway", keywords: "kirkebøker" }, LOCAL);
      expect(size(alone)).toBeLessThanOrEqual(ANSWER_CHAR_BUDGET);
      expect(alone.hits[0].filmNotes?.length ?? 0).toBeGreaterThan(5 * (shared.hits[0].filmNotes?.length ?? 1));
      expect(alone.hits[0].filmNotesTotal).toBe(1804);
    });
  });

  describe("the room is shared smallest demand first", () => {
    it("a hit that needs less than an equal share is listed whole, and what it leaves goes to the giant", async () => {
      // Eight small hits, one mid-size (12 entries of about 1 KB) and a giant
      // (100 of them), with about 34,000 characters of room. An equal share
      // would be 3,400 each and cut the mid-size hit to three entries; smallest
      // first lists all twelve and gives the giant the remainder.
      const text = 900;
      answerWith(25, [
        ...Array.from({ length: 8 }, (_, i) => reels(1, 100, i * 7)),
        reels(12, text),
        reels(100, text),
      ]);
      const r = await catalogSearchTool({ standardPlace: "Norway", keywords: "kirkebøker" }, LOCAL);
      const [mid, giant] = [r.hits[8], r.hits[9]];

      expect(mid.filmNotes).toHaveLength(12);
      expect(mid).not.toHaveProperty("filmNotesTotal");
      for (const small of r.hits.slice(0, 8)) {
        expect(small.filmNotes).toHaveLength(1);
        expect(small).not.toHaveProperty("filmNotesTotal");
      }
      expect(giant.filmNotesTotal).toBe(100);
      // The room the others left, not an equal share: about 19 entries, where an equal share is about 3.
      expect(giant.filmNotes?.length ?? 0).toBeGreaterThanOrEqual(15);
      expect(size(r)).toBeLessThanOrEqual(ANSWER_CHAR_BUDGET);
      // And the budget is used, not left on the table.
      expect(size(r)).toBeGreaterThan(ANSWER_CHAR_BUDGET - 1500);
    });

    it("what a cut hit leaves unused goes on to the hits after it", () => {
      // `a` asks for less than `b` and is cut anyway: its second entry cannot fit
      // its offer, so it lists only the first and leaves the offer unused. That
      // room is `b`'s. Charging `a` its whole offer would leave `b` about half.
      const a = hitOf("a", [bigEntry(0, 100), bigEntry(1, 3_000)]);
      const b = hitOf("b", Array.from({ length: 10 }, (_, j) => bigEntry(10 + j, 800)));
      const r = answerOf([a, b]);
      const base = size({ ...r, hits: r.hits.map((h) => ({ ...h, filmNotes: [] })) });
      // The two floors and about 5,000 characters of surplus.
      const budget = base + 6_600;
      fitFilmNotes(r, budget);
      expect(r.hits[0].filmNotes).toEqual([bigEntry(0, 100)]);
      expect(r.hits[0].filmNotesTotal).toBe(2);
      expect(r.hits[1].filmNotesTotal).toBe(10);
      // The budget is used to within one entry of `b`.
      expect(size(r)).toBeLessThanOrEqual(budget);
      expect(budget - size(r)).toBeLessThan(size(bigEntry(10, 800)));
    });

    it("a giant at rank 1 does not starve the small hits behind it", async () => {
      answerWith(25, [reels(76, 400), ...Array.from({ length: 9 }, (_, i) => reels(2, 60, 100 + i * 3))]);
      const r = await catalogSearchTool({ standardPlace: "Ireland", keywords: "parish registers" }, LOCAL);
      expect(r.hits[0].filmNotesTotal).toBe(76);
      for (const h of r.hits.slice(1, 10)) {
        expect(h.filmNotes).toHaveLength(2);
        expect(h).not.toHaveProperty("filmNotesTotal");
      }
      // The room the nine small hits leave unused goes to the giant, so the
      // budget is used and not left on the table. An equal share for every hit
      // would list only the giant's first few entries and leave the answer far
      // under the budget.
      expect(size(r)).toBeLessThanOrEqual(ANSWER_CHAR_BUDGET);
      expect(size(r)).toBeGreaterThan(ANSWER_CHAR_BUDGET - 1500);
    });
  });

  describe("fitFilmNotes, on its own", () => {
    const entries = (n: number): CatalogFilmNote[] => Array.from({ length: n }, (_, j) => entryFor(j, 60));
    const hitWith = (id: string, n: number, withUrl = true): CatalogHit => ({
      id,
      title: id,
      repositoryCalls: [],
      ...(withUrl ? { url: `https://example.test/${id}` } : {}),
      hydrated: true,
      filmNotes: entries(n),
    });
    const answer = (...hits: CatalogHit[]): CatalogSearchResult => ({
      totalHits: hits.length,
      returned: hits.length,
      placeResolved: true,
      hydrationTimedOut: false,
      hydrateRequested: 10,
      hits,
    });
    /** The answer with every film-note list emptied, and what the lists add, counted here. */
    const baseAndNeed = (r: CatalogSearchResult) => {
      const emptied = { ...r, hits: r.hits.map((h) => ({ ...h, filmNotes: [] })) };
      const one = JSON.stringify(entries(1)).length - 2;
      return { base: size(emptied), one };
    };

    it("lists a hit that fits its share exactly, and cuts one that is a character short", () => {
      const fresh = () => answer(hitWith("a", 3), hitWith("b", 3));
      const { base } = baseAndNeed(fresh());
      const need = JSON.stringify(entries(3)).length - 2;
      const fits = fresh();
      fitFilmNotes(fits, base + 2 * need);
      expect(fits.hits.every((h) => h.filmNotes?.length === 3 && h.filmNotesTotal === undefined)).toBe(true);
      expect(size(fits)).toBe(base + 2 * need);

      const short = fresh();
      fitFilmNotes(short, base + 2 * need - 1);
      expect(short.hits.some((h) => h.filmNotesTotal !== undefined)).toBe(true);
      expect(size(short)).toBeLessThanOrEqual(base + 2 * need - 1);
    });

    it("keeps at least one entry of every cut-short hit when the rest of the answer already exceeds the budget", () => {
      const r = answer(hitWith("a", 5), hitWith("b", 8), hitWith("c", 1));
      fitFilmNotes(r, 10);
      expect(r.hits[0].filmNotes).toEqual(entries(1));
      expect(r.hits[1].filmNotes).toEqual(entries(1));
      expect(r.hits[0].filmNotesTotal).toBe(5);
      expect(r.hits[1].filmNotesTotal).toBe(8);
      // A single entry cannot be cut by listing fewer of them.
      expect(r.hits[2].filmNotes).toEqual(entries(1));
      expect(r.hits[2]).not.toHaveProperty("filmNotesTotal");
    });

    it("counts every character, the two fields a cut-short hit adds included", () => {
      for (const budget of [3_000, 5_000, 8_000, 12_000, 20_000]) {
        const r = answer(hitWith("a", 200), hitWith("b", 150), hitWith("c", 4));
        fitFilmNotes(r, budget);
        const { base } = baseAndNeed(r);
        expect(base).toBeLessThan(budget);
        expect(size(r), `budget ${budget}`).toBeLessThanOrEqual(budget);
      }
    });

    it("says nothing about a hit it did not cut, and a hit with no url is offered only the keywords", () => {
      const r = answer(hitWith("a", 3), hitWith("b", 90, false));
      fitFilmNotes(r, 6_000);
      expect(r.hits[0]).not.toHaveProperty("filmNotesTotal");
      expect(r.hits[0]).not.toHaveProperty("filmNotesHint");
      expect(r.hits[1].filmNotesTotal).toBe(90);
      expect(r.hits[1].filmNotesHint).toMatch(/^\d+ of 90 film-note entries are listed/);
      expect(r.hits[1].filmNotesHint).toContain("search with keywords that name this item");
      expect(r.hits[1].filmNotesHint).not.toMatch(/hydrate/i);
      expect(r.hits[1].filmNotesHint).not.toContain("catalog entry");
      expect(r.hits[1].filmNotesHint).not.toContain("\n");
    });

    it("does nothing to an answer with no film notes, or one that already fits", () => {
      const none = answer({ id: "x", title: "x", repositoryCalls: [], hydrated: false });
      const before = structuredClone(none);
      fitFilmNotes(none, 50);
      expect(none).toEqual(before);
      const fits = answer(hitWith("a", 2));
      const copy = structuredClone(fits);
      fitFilmNotes(fits);
      expect(fits).toEqual(copy);
    });

    it("leaves a hit already cut alone, so shaping a shaped answer changes nothing", () => {
      const once = shapeAnswer(structuredClone(IRELAND));
      expect(once.hits[0].filmNotesTotal).toBeDefined();
      expect(shapeAnswer(structuredClone(once))).toEqual(once);
    });

    it("a hit already cut is final: fitted again into a smaller budget it keeps its total and its entries", () => {
      // Cutting it again would count the entries it LISTS as the entries it HAS,
      // and `filmNotesTotal` would then understate the item.
      const once = shapeAnswer(structuredClone(IRELAND));
      const total = once.hits[0].filmNotesTotal;
      expect(total).toBeDefined();
      const twice = structuredClone(once);
      fitFilmNotes(twice, 8_000);
      expect(twice.hits[0].filmNotesTotal).toBe(total);
      expect(twice.hits[0].filmNotes).toEqual(once.hits[0].filmNotes);
      expect(twice.hits[0].filmNotesHint).toBe(once.hits[0].filmNotesHint);
    });

    it("lists a single huge entry whole and does not call it cut; no allocation fits, so the hit beside it is listed at its floor", () => {
      // The entry cannot be cut by listing fewer of them, and at 60,000 it is
      // over the budget alone. Nothing within the budget exists, so the hit
      // beside it ends at its floor too: one entry of three, the cheapest cut.
      const huge: CatalogFilmNote = { filmNumber: "1", imageGroupNumber: "2", text: "t".repeat(60_000) };
      const r = answer({ ...hitWith("a", 0), filmNotes: [huge] }, hitWith("b", 3));
      fitFilmNotes(r);
      expect(r.hits[0].filmNotes).toEqual([huge]);
      expect(r.hits[0]).not.toHaveProperty("filmNotesTotal");
      expect(r.hits[1].filmNotes).toEqual(entries(1));
      expect(r.hits[1].filmNotesTotal).toBe(3);
      expect(size(r)).toBeGreaterThan(ANSWER_CHAR_BUDGET);
    });

    it("lists a single huge entry whole when nothing else is competing: the answer is over the budget by that entry alone", () => {
      const huge: CatalogFilmNote = { filmNumber: "1", imageGroupNumber: "2", text: "t".repeat(60_000) };
      const r = answer({ ...hitWith("a", 0), filmNotes: [huge] });
      fitFilmNotes(r);
      expect(r.hits[0].filmNotes).toEqual([huge]);
      expect(r.hits[0]).not.toHaveProperty("filmNotesTotal");
    });
  });

  describe("every hit's floor is reserved before the surplus is shared", () => {
    it("a first entry too big to fit beside another hit does not push the answer over the budget", () => {
      // X: a 30,000-character first entry, then two small ones. Y: three of 6,000.
      // Settling Y whole first and then keeping X's first entry whatever it
      // costs ended near 49,000, and shaping that again cut Y.
      const x = hitOf("x", [bigEntry(0, 30_000), bigEntry(1, 100), bigEntry(2, 100)]);
      const y = hitOf("y", [bigEntry(10, 6_000), bigEntry(11, 6_000), bigEntry(12, 6_000)]);
      const r = answerOf([x, y]);
      fitFilmNotes(r);
      expect(size(r)).toBeLessThanOrEqual(ANSWER_CHAR_BUDGET);
      // Y keeps all three; X lists the two it can, skipping the one it cannot.
      expect(r.hits[1].filmNotes).toEqual([bigEntry(10, 6_000), bigEntry(11, 6_000), bigEntry(12, 6_000)]);
      expect(r.hits[1]).not.toHaveProperty("filmNotesTotal");
      expect(r.hits[0].filmNotes).toEqual([bigEntry(1, 100), bigEntry(2, 100)]);
      expect(r.hits[0].filmNotesTotal).toBe(3);
      // And that is a fixed point.
      const again = structuredClone(r);
      fitFilmNotes(again);
      expect(again).toEqual(r);
    });

    it("a lone 38,000-character entry beside a 15,000-character hit ends under the spill line, by cutting the hit", () => {
      const a = hitOf("a", [bigEntry(0, 5_000), bigEntry(1, 5_000), bigEntry(2, 5_000)]);
      const b = hitOf("b", [bigEntry(9, 38_000)]);
      const r = answerOf([a, b]);
      fitFilmNotes(r);
      expect(size(r)).toBeLessThan(CLI_SPILL_CHARS);
      // The entry that cannot be cut is listed whole and is not called cut.
      expect(r.hits[1].filmNotes).toEqual([bigEntry(9, 38_000)]);
      expect(r.hits[1]).not.toHaveProperty("filmNotesTotal");
      // The hit beside it pays: one entry of three, and it says so.
      expect(r.hits[0].filmNotes).toHaveLength(1);
      expect(r.hits[0].filmNotesTotal).toBe(3);
    });

    it("the floor of a hit is its whole list when that costs no more than its cheapest cut, and the cheapest cut when it costs more", () => {
      // Two entries of about 150 characters: whole they cost about 300, and a cut
      // to one entry costs 150 plus the two fields, which is more.
      const small = hitOf("s", [bigEntry(0, 27), bigEntry(1, 27)]);
      // Three of about 725: whole about 2,200, and a cut to one costs 725 plus the fields.
      const mid = hitOf("m", [bigEntry(5, 600), bigEntry(6, 600), bigEntry(7, 600)]);
      const r = answerOf([small, mid]);
      const expected = answerOf([
        { ...small },
        { ...mid, filmNotes: [bigEntry(5, 600)], filmNotesTotal: 3, filmNotesHint: filmNotesHint(1, 3, 2) },
      ]);
      // A budget of nothing: no allocation fits, so every hit ends at its floor.
      fitFilmNotes(r, 0);
      expect(r).toEqual(expected);
    });
  });

  describe("shaping what was shaped changes nothing", () => {
    it("on the shapes that used to move: a first entry kept whatever it cost, and a hit list that grew with the count", () => {
      const cases: CatalogSearchResult[] = [];
      // X and Y, and a lone big entry behind a small hit.
      cases.push(answerOf([hitOf("x", [bigEntry(0, 30_000), bigEntry(1, 100), bigEntry(2, 100)]), hitOf("y", [bigEntry(10, 6_000), bigEntry(11, 6_000), bigEntry(12, 6_000)])]));
      cases.push(answerOf([hitOf("a", [bigEntry(0, 5_000), bigEntry(1, 5_000), bigEntry(2, 5_000)]), hitOf("b", [bigEntry(9, 38_000)])]));
      // A small hit and a giant whose first entry is big, beside a hit that takes nearly all the budget.
      for (const pad of [38_000, 38_500, 39_000, 39_400]) {
        cases.push(
          answerOf([
            hitOf("h1", [bigEntry(0, 60), bigEntry(1, 60), bigEntry(2, 60)]),
            hitOf("h2", [bigEntry(10, 1_500), ...Array.from({ length: 50 }, (_, j) => bigEntry(11 + j, 60))]),
            { id: "pad", title: "U".repeat(pad), repositoryCalls: [], hydrated: false },
          ]),
        );
      }
      // The saved Ireland answer padded with more of its own unhydrated hits, up to count 200.
      for (const count of [25, 50, 75, 86, 88, 90, 92, 96, 100, 150, 200]) {
        const padded = structuredClone(IRELAND);
        const bare = padded.hits.filter((h) => !h.hydrated);
        for (let k = 0; padded.hits.length < count; k++) padded.hits.push({ ...structuredClone(bare[k % bare.length]), id: `pad:${k}` });
        padded.returned = padded.hits.length;
        cases.push(padded);
      }
      for (const [i, a] of cases.entries()) {
        const once = shapeAnswer(structuredClone(a));
        expect(shapeAnswer(structuredClone(once)), `case ${i}`).toEqual(once);
      }
    });
  });

  describe("a cut never costs as much as listing the hit whole", () => {
    it("ten hits of two 150-character entries, each offered 250 characters, are all listed whole", () => {
      // Whole, a hit costs 301. Cut to one entry it costs 150 plus the two
      // fields, which is more: the answer used to grow by about 440 characters
      // and every hit lost an entry.
      const make = () =>
        answerOf(Array.from({ length: 10 }, (_, i) => hitOf(`h${i}`, [bigEntry(i * 2, 27), bigEntry(i * 2 + 1, 27)])));
      const before = make();
      const base = size({ ...before, hits: before.hits.map((h) => ({ ...h, filmNotes: [] })) });
      const r = make();
      fitFilmNotes(r, base + 10 * 250);
      expect(r).toEqual(before);
      expect(size(r)).toBeLessThanOrEqual(size(before));
    });

    it("on saved answers padded to count 100, no cut hit is bigger than the same hit whole", () => {
      for (const saved of [IRELAND]) {
        const padded = structuredClone(saved);
        const bare = padded.hits.filter((h) => !h.hydrated);
        for (let k = 0; padded.hits.length < 100; k++) padded.hits.push({ ...structuredClone(bare[k % bare.length]), id: `pad:${k}` });
        padded.returned = padded.hits.length;
        const whole = padded.hits.map((h) => ({ ...h, filmNotes: h.filmNotes ? mergeFilmNotes(h.filmNotes) : undefined }));
        const shaped = shapeAnswer(structuredClone(padded));
        for (const [i, h] of shaped.hits.entries()) {
          if (h.filmNotesTotal === undefined) continue;
          expect(size(h)).toBeLessThan(size(whole[i]));
        }
      }
    });
  });

  describe("a cut lists every entry that fits, and the first entry of every reel before any reel's later ones", () => {
    it("skips an entry that does not fit and goes on listing the ones after it", () => {
      const g = hitOf("g", [bigEntry(0, 100), bigEntry(1, 30_000), bigEntry(2, 100), bigEntry(3, 100)]);
      const r = answerOf([g]);
      fitFilmNotes(r, 2_000);
      expect(r.hits[0].filmNotes).toEqual([bigEntry(0, 100), bigEntry(2, 100), bigEntry(3, 100)]);
      expect(r.hits[0].filmNotesTotal).toBe(4);
      expect(r.hits[0].filmNotesHint).toMatch(/^3 of 4 film-note entries are listed/);
      expect(size(r)).toBeLessThanOrEqual(2_000);
    });

    it("tries the first entry of every reel before a reel's later entries", () => {
      // Reel A has three entries (a dense reel), reel B one. Room for two: listing
      // in order would give A's first two and lose B's numbers altogether.
      const e = (reel: string, j: number): CatalogFilmNote => ({
        filmNumber: reel,
        imageGroupNumber: `${reel}0`,
        text: `${j}:`.padEnd(1_000, "x"),
      });
      const hitAB = hitOf("ab", [e("1", 0), e("1", 1), e("1", 2), e("2", 3)]);
      const wanted = { ...hitAB, filmNotes: [e("1", 0), e("2", 3)], filmNotesTotal: 4, filmNotesHint: filmNotesHint(2, 4, undefined) };
      const r = answerOf([hitAB], 1);
      fitFilmNotes(r, size(answerOf([wanted], 1)));
      expect(r.hits[0].filmNotes).toEqual([e("1", 0), e("2", 3)]);
      expect(r.hits[0].filmNotesTotal).toBe(4);
    });

    it("lists a reel by a later entry when its first does not fit", () => {
      const e = (reel: string, j: number, len: number): CatalogFilmNote => ({
        filmNumber: reel,
        imageGroupNumber: `${reel}0`,
        text: `${j}:`.padEnd(len, "x"),
      });
      const h = hitOf("h", [e("1", 0, 100), e("2", 1, 30_000), e("2", 2, 100)]);
      const r = answerOf([h], 1);
      fitFilmNotes(r, 2_000);
      expect(r.hits[0].filmNotes).toEqual([e("1", 0, 100), e("2", 2, 100)]);
    });

    it.each([10, 100])(
      "charges the longer hint when the entries listed gain a digit: the exact size of %i entries lists them all, one character less lists one fewer",
      (k) => {
        // "9 of 215" becomes "10 of 215": the two fields grow by a character, and a cap measured once for
        // one digit count would let the tenth (or hundredth) entry in a character over the budget.
        const original = Array.from({ length: 2 * k + 5 }, (_, j) => bigEntry(j, 60));
        const listing = (n: number): CatalogSearchResult =>
          answerOf([
            { ...hitOf("g", original.slice(0, n)), filmNotesTotal: original.length, filmNotesHint: filmNotesHint(n, original.length, 1) },
          ]);
        const exact = size(listing(k));
        const at = answerOf([hitOf("g", structuredClone(original))]);
        fitFilmNotes(at, exact);
        expect(at.hits[0].filmNotes).toHaveLength(k);
        expect(size(at)).toBe(exact);
        const under = answerOf([hitOf("g", structuredClone(original))]);
        fitFilmNotes(under, exact - 1);
        expect(under.hits[0].filmNotes).toHaveLength(k - 1);
        expect(size(under)).toBeLessThanOrEqual(exact - 1);
      },
    );

    it("lists some of the entries, whole, in the item's order", () => {
      const original = Array.from({ length: 12 }, (_, j) => bigEntry(j, 40 + 90 * (j % 5)));
      const r = answerOf([hitOf("g", structuredClone(original))]);
      fitFilmNotes(r, 2_500);
      const listed = r.hits[0].filmNotes ?? [];
      expect(listed.length).toBeGreaterThan(1);
      expect(listed.length).toBeLessThan(12);
      expect(isSubsequence(listed, original)).toBe(true);
      expect(size(r)).toBeLessThanOrEqual(2_500);
    });
  });

  describe("the hint offers only a way back that can work", () => {
    const keywordsWay = "search with keywords that name this item";

    it("names the hydrate value that reaches the hit only when one is given, and always the keywords", () => {
      expect(filmNotesHint(3, 40)).toBe(
        `3 of 40 film-note entries are listed, to keep this answer under the size limit. For the rest, ${keywordsWay}.`,
      );
      expect(filmNotesHint(3, 40, 2)).toBe(
        "3 of 40 film-note entries are listed, to keep this answer under the size limit. " +
          `For the rest, call again with hydrate: 2, or ${keywordsWay}.`,
      );
    });

    it("at hydrate 1 never says to hydrate fewer: there is nothing fewer", async () => {
      answerWith(3, [reels(1804)]);
      const r = await catalogSearchTool({ standardPlace: "Norway", keywords: "kirkebøker", hydrate: 1 }, LOCAL);
      expect(r.hits[0].filmNotesTotal).toBe(1804);
      expect(r.hits[0].filmNotesHint).toContain(keywordsWay);
      expect(r.hits[0].filmNotesHint).not.toMatch(/hydrate/i);
    });

    it("a giant at rank 2 of a call that hydrated ten is told to call again with hydrate 2", async () => {
      // `hydrate` is a prefix count: 2 reaches the giant and leaves the hits below it unhydrated.
      answerWith(5, [reels(2), reels(1804), reels(2), reels(2), reels(2)]);
      const r = await catalogSearchTool({ standardPlace: "Norway", keywords: "kirkebøker" }, LOCAL);
      expect(r.hits[1].filmNotesTotal).toBe(1804);
      expect(r.hits[1].filmNotesHint).toContain("call again with hydrate: 2");
      expect(r.hits[1].filmNotesHint).toContain(keywordsWay);
      expect(r.hits[1].filmNotesHint).not.toContain("hydrate fewer");
    });

    it("a giant at the last rank a call hydrated is offered only the keywords: a smaller hydrate would un-hydrate it", async () => {
      answerWith(5, [reels(2), reels(2), reels(1804)]);
      const r = await catalogSearchTool({ standardPlace: "Norway", keywords: "kirkebøker", hydrate: 3 }, LOCAL);
      expect(r.hits[2].filmNotesTotal).toBe(1804);
      expect(r.hits[2].filmNotesHint).toContain(keywordsWay);
      expect(r.hits[2].filmNotesHint).not.toMatch(/hydrate/i);
    });

    it("the position that counts is among the hits that carry a url: an off-host hit above does not move it", async () => {
      // `hydrate` reaches the first N hits with a usable url. The giant is second
      // in the list and first among those, so hydrate 1 reaches it.
      const elsewhere = { metadataHit: { metadata: { title: [{ value: "elsewhere" }], identifier: { value: "https://example.test/x" }, repositoryCalls: [] } } };
      respond(
        { totalHits: 4, searchHits: [elsewhere, hit("olib:1"), hit("olib:2")] },
        { source: { film_note: reels(1804) } },
        { source: { film_note: reels(2) } },
      );
      const r = await catalogSearchTool({ standardPlace: "Norway", keywords: "kirkebøker" }, LOCAL);
      expect(r.hits[0].hydrated).toBe(false);
      expect(r.hits[1].filmNotesTotal).toBe(1804);
      expect(r.hits[1].filmNotesHint).toContain("call again with hydrate: 1");
    });

    it("a hit with no url is offered only the keywords", () => {
      const r = answerOf([hitOf("a", Array.from({ length: 90 }, (_, j) => bigEntry(j, 60)), { url: undefined })]);
      fitFilmNotes(r, 6_000);
      expect(r.hits[0].filmNotesTotal).toBe(90);
      expect(r.hits[0].filmNotesHint).toContain(keywordsWay);
      expect(r.hits[0].filmNotesHint).not.toMatch(/hydrate/i);
    });
  });

  describe("a dense reel", () => {
    it("720 notes on one reel, at the default count, come back within the budget and say what was left out", async () => {
      // One reel joined into one entry was 50,033 characters at count 25, past the
      // spill line, with no total and no hint, since nothing could cut a lone entry.
      const notes = Array.from({ length: 720 }, (_, j) => note({ text: `Item ${j}: Kirchenbuch, 1700-1800, Taufen, Heiraten, Tote` }));
      answerWith(25, [notes]);
      const r = await catalogSearchTool({ standardPlace: "Germany", keywords: "kirchenbücher" }, LOCAL);
      expect(size(r)).toBeLessThanOrEqual(ANSWER_CHAR_BUDGET);
      expect(size(r)).toBeLessThan(CLI_SPILL_CHARS);
      const h = r.hits[0];
      const listed = h.filmNotes ?? [];
      expect(h.filmNotesTotal).toBeGreaterThan(listed.length);
      expect(h.filmNotesHint).toMatch(new RegExp(`^${listed.length} of ${h.filmNotesTotal} film-note entries are listed`));
      for (const e of listed) {
        expect(e).toMatchObject({ filmNumber: "100", imageGroupNumber: "900", indexed: "Y" });
        expect((e.text ?? "").length).toBeLessThanOrEqual(REEL_TEXT_CAP);
      }
      // Whole notes only: every entry's text splits back into notes the Catalog sent.
      const sent = new Set(notes.map((n) => n.text));
      for (const e of listed) for (const text of (e.text ?? "").split(" | ")) expect(sent.has(text)).toBe(true);
    });
  });

  describe("over random answers", () => {
    // Examples show that the fit does what its author expected. These ask whether
    // it does something else on answers nobody wrote. Every case is drawn from a
    // seeded generator, so a failure names the seed that replays it.
    const CASES = 300;

    /** The line an answer carries when `n` hits were left off its end. */
    const omittedHint = (n: number): string =>
      `${n} more ${n === 1 ? "hit was" : "hits were"} left off the end, to keep this answer under the size limit. ` +
      "Ask with a smaller count, or a narrower query.";

    /** mulberry32: a small seeded generator. */
    function seeded(seed: number): () => number {
      let a = seed >>> 0;
      return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), a | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    const TEXT_LENGTHS = [0, 8, 40, 150, 400, 1_200, 3_000, 9_000];

    /** A random answer: hits with notes and hits without, entries of every size. With `raw`, film notes as the
     *  service sends them (several to a reel); without, one note per reel, so merging changes nothing. */
    function randomAnswer(
      rand: () => number,
      shape: { hits: number; entries: number; raw: boolean },
    ): CatalogSearchResult {
      const int = (lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1));
      const hits: CatalogHit[] = [];
      for (let i = 0; i < shape.hits; i++) {
        const hasUrl = rand() < 0.9;
        const hydrated = hasUrl && rand() < 0.8;
        const h: CatalogHit = {
          id: `h${i}`,
          title: "t".repeat(int(1, 120)),
          repositoryCalls: rand() < 0.5 ? ["Online"] : [],
          ...(hasUrl ? { url: `https://example.test/h${i}` } : {}),
          hydrated,
        };
        if (hydrated) {
          if (rand() < 0.3) h.notes = ["n".repeat(int(1, 300))];
          const n = rand() < 0.1 ? 0 : int(1, shape.entries);
          h.filmNotes = Array.from({ length: n }, (_, j) => {
            const reel = shape.raw ? int(0, Math.floor(n / 3)) : j;
            const length = TEXT_LENGTHS[int(0, TEXT_LENGTHS.length - 1)];
            return {
              filmNumber: String(100 + reel),
              imageGroupNumber: String(900 + reel),
              indexed: "Y",
              copyLocation: "Vault",
              ...(length > 0 ? { text: `${j}:`.padEnd(Math.max(length, 3), "x") } : {}),
            };
          });
        }
        hits.push(h);
      }
      return answerOf(hits, int(1, 25));
    }

    /** The `hydrate` value that reaches a hit, when it is fewer than the call used. */
    function reachedBy(r: CatalogSearchResult, h: CatalogHit): number | undefined {
      if (!h.url) return undefined;
      const position = r.hits.slice(0, r.hits.indexOf(h) + 1).filter((x) => x.url).length;
      return position < r.hydrateRequested ? position : undefined;
    }

    /** What listing the entries at `pick` of a hit's `costs` adds to its hit: the entries, their commas, and, unless
     *  they are all of them, the two fields a cut adds. Counted from the JSON of those two fields. */
    function listCost(costs: number[], pick: number[], way: number | undefined): number {
      const entries = pick.reduce((a, k) => a + costs[k], 0) + pick.length - 1;
      if (pick.length === costs.length) return entries;
      const fields = size({ filmNotesTotal: costs.length, filmNotesHint: filmNotesHint(pick.length, costs.length, way) });
      return entries + fields - 1;
    }

    /** The least a hit's list can cost, found by trying every non-empty subset of its entries. */
    function cheapestList(costs: number[], way: number | undefined): number {
      let best = Infinity;
      for (let mask = 1; mask < 1 << costs.length; mask++) {
        const pick = costs.map((_, k) => k).filter((k) => mask & (1 << k));
        best = Math.min(best, listCost(costs, pick, way));
      }
      return best;
    }

    const carriesList = (h: CatalogHit): boolean => (h.filmNotes?.length ?? 0) > 0;
    const costsOf = (entries: CatalogFilmNote[]): number[] => entries.map((e) => size(e));
    /** The answer with every film-note list emptied and no cut field: what the lists have to fit around. */
    const baseOf = (r: CatalogSearchResult): number =>
      size({
        ...r,
        hits: r.hits.map((h) => {
          const { filmNotesTotal: _t, filmNotesHint: _h, ...rest } = h;
          return carriesList(h) ? { ...rest, filmNotes: [] } : rest;
        }),
      });

    it("ends within the budget whenever an allocation within it exists, and otherwise leaves hits off the end until it fits", () => {
      for (let seed = 1; seed <= CASES; seed++) {
        const rand = seeded(seed);
        const a = randomAnswer(rand, { hits: 1 + Math.floor(rand() * 6), entries: 7, raw: false });
        // Brute force: the cheapest list of every hit, found by trying all of its subsets.
        const least =
          baseOf(a) +
          a.hits.filter(carriesList).reduce((sum, h) => sum + cheapestList(costsOf(h.filmNotes ?? []), reachedBy(a, h)), 0);
        const whole = size(a);
        const n = a.hits.length;
        for (const budget of [least - 1, least, least + 1, Math.floor((least + whole) / 2), whole - 1, whole]) {
          const shaped = shapeAnswer(structuredClone(a), budget);
          const message = `seed ${seed}, budget ${budget} (least ${least}, whole ${whole})`;
          if (least <= budget) {
            // An allocation within the budget exists: it is found, and no hit is left off.
            expect(size(shaped), message).toBeLessThanOrEqual(budget);
            expect(shaped.hits, message).toHaveLength(n);
            expect(shaped, message).not.toHaveProperty("hitsOmitted");
            // An answer that fits is left exactly as it came.
            if (whole <= budget) expect(shaped, message).toEqual(a);
            continue;
          }
          // None exists. Every hit is at its floor, the least it can be...
          const fitted = structuredClone(a);
          fitFilmNotes(fitted, budget);
          expect(size(fitted), message).toBe(least);
          // ...so hits are left off the end, one at a time, until the rest at their floors fit or one is left...
          const leftOff = (from: CatalogSearchResult, k: number): CatalogSearchResult =>
            k === n
              ? from
              : { ...from, hits: from.hits.slice(0, k), returned: k, hitsOmitted: n - k, hitsOmittedHint: omittedHint(n - k) };
          let keep = n;
          while (keep > 1 && size(leftOff(fitted, keep)) > budget) keep--;
          // ...and the hits that stay are fitted into the room the others freed, not held at their floors.
          const kept = structuredClone(leftOff(a, keep));
          fitFilmNotes(kept, budget);
          expect(shaped, message).toEqual(kept);
          expect(size(shaped), message).toBeGreaterThanOrEqual(size(leftOff(fitted, keep)));
          if (keep > 1) expect(size(shaped), message).toBeLessThanOrEqual(budget);
        }
      }
    });

    it("is idempotent, lists whole entries of its own in order, counts every character, and never cuts a hit into something bigger", () => {
      for (let seed = 1; seed <= CASES; seed++) {
        const rand = seeded(10_000 + seed);
        const a = randomAnswer(rand, {
          hits: 1 + Math.floor(rand() * 30),
          entries: 1 + Math.floor(rand() * 60),
          raw: rand() < 0.6,
        });
        const merged = structuredClone(a);
        for (const h of merged.hits) if (h.filmNotes) h.filmNotes = mergeFilmNotes(h.filmNotes);
        const whole = size(merged);
        const budget = rand() < 0.2 ? ANSWER_CHAR_BUDGET : Math.max(50, Math.floor(whole * (0.05 + rand() * 1.1)));
        const shaped = shapeAnswer(structuredClone(a), budget);
        const message = `seed ${seed}, budget ${budget}`;

        // Idempotent: shaping what was shaped changes nothing.
        expect(shapeAnswer(structuredClone(shaped), budget), message).toEqual(shaped);
        // And an answer that fits, merged, is left exactly so.
        if (whole <= budget) expect(shaped, message).toEqual(merged);

        // Hits are left off the END only: what is listed is a prefix, and the answer says how many went.
        const left = a.hits.length - shaped.hits.length;
        expect(shaped.hits.map((h) => h.id), message).toEqual(a.hits.slice(0, shaped.hits.length).map((h) => h.id));
        if (left === 0) {
          expect(shaped, message).not.toHaveProperty("hitsOmitted");
          expect(shaped, message).not.toHaveProperty("hitsOmittedHint");
        } else {
          expect(shaped.hitsOmitted, message).toBe(left);
          expect(shaped.hitsOmittedHint, message).toBe(omittedHint(left));
          expect(shaped.returned, message).toBe(shaped.hits.length);
        }
        // Within the budget, unless one hit is left and it is over by itself.
        if (shaped.hits.length > 1) expect(size(shaped), message).toBeLessThanOrEqual(budget);

        let added = 0;
        for (const [i, h] of shaped.hits.entries()) {
          const was = merged.hits[i];
          const { filmNotes: _f, filmNotesTotal: _t, filmNotesHint: _h, ...rest } = h;
          const { filmNotes: _wf, ...restWas } = was;
          expect(rest, message).toEqual(restWas);
          if (!carriesList(was)) {
            expect(h.filmNotes, message).toEqual(was.filmNotes);
            expect(h, message).not.toHaveProperty("filmNotesTotal");
            continue;
          }
          const entries = was.filmNotes ?? [];
          const listed = h.filmNotes ?? [];
          const costs = costsOf(entries);
          const way = reachedBy(shaped, h);
          if (h.filmNotesTotal === undefined) {
            expect(listed, message).toEqual(entries);
            expect(h, message).not.toHaveProperty("filmNotesHint");
            added += listCost(costs, costs.map((_, k) => k), way);
            continue;
          }
          // Cut: some of the item's entries, whole, in its order, never none and never all.
          expect(h.filmNotesTotal, message).toBe(entries.length);
          expect(listed.length, message).toBeGreaterThan(0);
          expect(listed.length, message).toBeLessThan(entries.length);
          expect(isSubsequence(listed, entries), message).toBe(true);
          expect(h.filmNotesHint, message).toBe(filmNotesHint(listed.length, entries.length, way));
          const picked: number[] = [];
          let at = 0;
          for (const e of listed) {
            while (JSON.stringify(entries[at]) !== JSON.stringify(e)) at++;
            picked.push(at++);
          }
          const cost = listCost(costs, picked, way);
          // A cut costs less than the whole list.
          expect(cost, message).toBeLessThan(listCost(costs, costs.map((_, k) => k), way));
          added += cost;
        }
        // Every character is counted: the answer is its base plus what the lists cost.
        expect(size(shaped), message).toBe(baseOf(shaped) + added);
      }
    });

    it("merging is idempotent and loses no text, on random reels of every density", () => {
      for (let seed = 1; seed <= CASES; seed++) {
        const rand = seeded(20_000 + seed);
        const a = randomAnswer(rand, { hits: 3, entries: 80, raw: true });
        for (const h of a.hits) {
          const notes = h.filmNotes ?? [];
          const once = mergeFilmNotes(notes);
          expect(mergeFilmNotes(once), `seed ${seed}`).toEqual(once);
          expect(once.flatMap((e) => (e.text ?? "").split(" | ")).filter(Boolean).sort(), `seed ${seed}`).toEqual(
            notes.map((n) => n.text ?? "").filter(Boolean).sort(),
          );
          for (const e of once) {
            // A run is over the cap only when it is one note.
            if ((e.text ?? "").length > REEL_TEXT_CAP) expect((e.text ?? "").includes(" | "), `seed ${seed}`).toBe(false);
          }
        }
      }
    });
  });

  describe("the hit list is bounded too", () => {
    /** The line an answer carries when `n` hits were left off its end. */
    const omittedHint = (n: number): string =>
      `${n} more ${n === 1 ? "hit was" : "hits were"} left off the end, to keep this answer under the size limit. ` +
      "Ask with a smaller count, or a narrower query.";

    it.each([100, 120, 200])("count %i at the defaults comes back within the budget, with the hits left off its end counted", async (count) => {
      // The film notes were fitted, yet the hits alone passed the budget and then the
      // spill line (count 120 was 50,950 characters), and a hit cut for it blamed `hydrate`.
      const padded = paddedIreland(count);
      const { search, items } = upstreamFor(padded);
      respond(search, ...items.slice(0, 10));
      const r = await catalogSearchTool(
        { standardPlace: "Ireland", keywords: "Catholic parish registers baptism marriage", count },
        LOCAL,
      );
      expect(new URL(searchUrl()).searchParams.get("count")).toBe(String(count));
      expect(size(r)).toBeLessThanOrEqual(ANSWER_CHAR_BUDGET);
      expect(size(r)).toBeLessThan(CLI_SPILL_CHARS);
      // The hits that are listed are the first ones, in order: what went is the end.
      expect(r.hits.length).toBeGreaterThan(25);
      expect(r.hits.length).toBeLessThan(count);
      expect(r.hits.map((h) => h.id)).toEqual(padded.hits.slice(0, r.hits.length).map((h) => h.id));
      // And the answer says so: `returned` is what is listed, `hitsOmitted` what went.
      expect(r.returned).toBe(r.hits.length);
      expect(r.hitsOmitted).toBe(count - r.hits.length);
      expect(r.hitsOmittedHint).toBe(omittedHint(count - r.hits.length));
      // Nothing is blamed on hydrate: no film-note hint offers it for a hit it cannot help.
      for (const h of r.hits) if (h.filmNotesHint) expect(h.filmNotesHint).not.toContain("hydrate fewer");
    });

    it("count 200 with no hydration at all is bounded by the hits alone", async () => {
      const padded = paddedIreland(200);
      const { search } = upstreamFor(padded);
      respond(search);
      const r = await catalogSearchTool({ standardPlace: "Ireland", keywords: "Catholic parish registers baptism marriage", count: 200, hydrate: 0 }, LOCAL);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(size(r)).toBeLessThanOrEqual(ANSWER_CHAR_BUDGET);
      expect(r.hits.length + (r.hitsOmitted ?? 0)).toBe(200);
      expect(r.hitsOmitted).toBeGreaterThan(0);
    });

    it("count 25 is unchanged: every hit is listed and neither field appears", async () => {
      const { search, items } = upstreamFor(IRELAND);
      respond(search, ...items);
      const r = await catalogSearchTool({ standardPlace: "Ireland", keywords: "Catholic parish registers baptism marriage" }, LOCAL);
      expect(r.hits).toHaveLength(25);
      expect(r.returned).toBe(25);
      expect(r).not.toHaveProperty("hitsOmitted");
      expect(r).not.toHaveProperty("hitsOmittedHint");
    });

    const bare = (i: number): CatalogHit => ({
      id: `b${i}`,
      title: `Bare hit number ${i}`.padEnd(120, "."),
      repositoryCalls: ["Online"],
      url: `https://example.test/b${i}`,
      hydrated: false,
    });
    const bareAnswer = (n: number): CatalogSearchResult => answerOf(Array.from({ length: n }, (_, i) => bare(i)));

    it("leaves hits off the end until the answer fits, and says how many went", () => {
      const a = bareAnswer(60);
      const r = shapeAnswer(structuredClone(a), 3_000);
      expect(size(r)).toBeLessThanOrEqual(3_000);
      expect(r.hits.map((h) => h.id)).toEqual(a.hits.slice(0, r.hits.length).map((h) => h.id));
      expect(r.hits.length).toBeLessThan(60);
      expect(r.hitsOmitted).toBe(60 - r.hits.length);
      expect(r.returned).toBe(r.hits.length);
      expect(r.hitsOmittedHint).toBe(omittedHint(60 - r.hits.length));
    });

    it("leaves off exactly as many as it must: the budget of the kept answer keeps them, one character less drops one more", () => {
      const a = bareAnswer(20);
      const seven: CatalogSearchResult = {
        ...structuredClone(a),
        hits: a.hits.slice(0, 7),
        returned: 7,
        hitsOmitted: 13,
        hitsOmittedHint: omittedHint(13),
      };
      const exact = size(seven);
      expect(shapeAnswer(structuredClone(a), exact)).toEqual(seven);
      expect(shapeAnswer(structuredClone(a), exact - 1).hits).toHaveLength(6);
    });

    it("says `1 more hit was` for one hit", () => {
      const a = bareAnswer(6);
      const five = size({ ...structuredClone(a), hits: a.hits.slice(0, 5), returned: 5, hitsOmitted: 1, hitsOmittedHint: omittedHint(1) });
      const r = shapeAnswer(structuredClone(a), five);
      expect(r.hitsOmitted).toBe(1);
      expect(r.hitsOmittedHint).toMatch(/^1 more hit was left off the end/);
    });

    it("never drops a hit when the answer fits, and carries neither field", () => {
      const a = bareAnswer(20);
      const r = shapeAnswer(structuredClone(a), size(a));
      expect(r).toEqual(a);
      expect(r).not.toHaveProperty("hitsOmitted");
      expect(r).not.toHaveProperty("hitsOmittedHint");
    });

    it("an answer shaped again into a smaller budget adds to the count it carries", () => {
      const once = shapeAnswer(bareAnswer(60), 8_000);
      const twice = shapeAnswer(structuredClone(once), 4_000);
      expect(once.hitsOmitted).toBe(60 - once.hits.length);
      expect(twice.hits.length).toBeLessThan(once.hits.length);
      expect(twice.hitsOmitted).toBe(60 - twice.hits.length);
      expect(twice.returned).toBe(twice.hits.length);
      expect(twice.hitsOmittedHint).toBe(omittedHint(60 - twice.hits.length));
    });

    it("the room the hits left off free goes to the film notes of the hits that stay", () => {
      // Cut first and left off after, the hit that stays kept only its floor, one
      // entry, and the room the 39,000-character hit freed went unused.
      const entries = Array.from({ length: 5 }, (_, j) => bigEntry(j, 1_000));
      const tail: CatalogHit = { ...bare(9), hydrated: true, notes: ["n".repeat(39_000)] };
      const r = shapeAnswer(answerOf([hitOf("a", entries), tail]));
      expect(r.hits.map((h) => h.id)).toEqual(["a"]);
      expect(r.hitsOmitted).toBe(1);
      expect(r.hits[0].filmNotes).toEqual(entries);
      expect(r.hits[0]).not.toHaveProperty("filmNotesTotal");
      expect(size(r)).toBeLessThanOrEqual(ANSWER_CHAR_BUDGET);
    });

    it("keeps one hit however small the budget", () => {
      const r = shapeAnswer(bareAnswer(5), 10);
      expect(r.hits.map((h) => h.id)).toEqual(["b0"]);
      expect(r.hitsOmitted).toBe(4);
      expect(shapeAnswer(bareAnswer(1), 10).hits).toHaveLength(1);
    });

    it("the part of the answer that is not film notes can be over the budget by itself: the first hit is listed whole, the rest left off", () => {
      // The first documented exception: one hit whose own fields pass the budget.
      const huge: CatalogHit = { ...bare(0), hydrated: true, notes: ["n".repeat(60_000)] };
      const r = shapeAnswer(answerOf([huge, bare(1), bare(2)]));
      expect(r.hits.map((h) => h.id)).toEqual(["b0"]);
      expect(r.hits[0].notes).toEqual(huge.notes);
      expect(r.hitsOmitted).toBe(2);
      expect(size(r)).toBeGreaterThan(ANSWER_CHAR_BUDGET);
    });

    it("a single irreducible entry can be over the budget by itself: it is listed whole, and the hits after it are left off", () => {
      // The second documented exception: one entry that cannot be cut by listing fewer of them.
      const entry: CatalogFilmNote = { filmNumber: "1", imageGroupNumber: "2", text: "t".repeat(60_000) };
      const r = shapeAnswer(answerOf([hitOf("a", [entry]), bare(1)]));
      expect(r.hits.map((h) => h.id)).toEqual(["a"]);
      expect(r.hits[0].filmNotes).toEqual([entry]);
      expect(r.hits[0]).not.toHaveProperty("filmNotesTotal");
      expect(r.hitsOmitted).toBe(1);
      expect(size(r)).toBeGreaterThan(ANSWER_CHAR_BUDGET);
    });

    it("an {error} envelope has no hits and comes back as it came", () => {
      const envelope = { error: "FamilySearch session not accepted; call the login tool." } as unknown as CatalogSearchResult;
      expect(shapeAnswer(envelope)).toBe(envelope);
      expect(envelope).toEqual({ error: "FamilySearch session not accepted; call the login tool." });
    });
  });
});

// ─── The recorded eval fixtures ─────────────────────────────────────────────────
//
// `eval/fixtures/mcp/catalog-search-*.json` stand in for the tool in every unit
// eval run, so the agent is graded on what they say. They were reshaped with the
// tool's own `shapeAnswer` (`dev/reshape-catalog-fixtures.ts`), not edited by
// hand, and this keeps them there: a change to the answer's shape that does not
// reshape them fails here, instead of leaving the evals graded on an answer the
// tool no longer gives. `mcp-fixture-shape.test.ts` checks keys one level down
// from the response and does not see film notes.

/** What is wrong with the cut fields of a recorded answer, if anything. A cut list carries its total and its
 *  hint together, and the total is more than the entries it lists; an answer that left hits off carries its
 *  count and its hint together, and `returned` is what it lists. An `{ error }` envelope has no hits to check. */
function cutFieldProblems(response: unknown): string[] {
  const r = response as Partial<CatalogSearchResult> | undefined;
  if (!r || !Array.isArray(r.hits)) return [];
  const problems: string[] = [];
  for (const [i, h] of r.hits.entries()) {
    const total = "filmNotesTotal" in h;
    if (total !== "filmNotesHint" in h) {
      problems.push(`hit ${i}: ${total ? "a filmNotesTotal without its hint" : "a filmNotesHint without its total"}`);
    }
    if (total && !(typeof h.filmNotesTotal === "number" && h.filmNotesTotal > (h.filmNotes?.length ?? 0))) {
      problems.push(`hit ${i}: filmNotesTotal is not more than the entries listed`);
    }
  }
  const omitted = "hitsOmitted" in r;
  if (omitted !== "hitsOmittedHint" in r) {
    problems.push(`${omitted ? "hitsOmitted without its hint" : "hitsOmittedHint without its count"}`);
  }
  if (omitted && !(typeof r.hitsOmitted === "number" && r.hitsOmitted > 0)) problems.push("hitsOmitted is not a count of hits");
  if (omitted && r.returned !== r.hits.length) problems.push("returned is not the number of hits listed");
  return problems;
}

describe("catalog_search — the recorded eval fixtures", () => {
  const dir = fileURLToPath(new URL("../../../../../eval/fixtures/mcp/", import.meta.url));
  const files = readdirSync(dir)
    .filter((f) => /^catalog-search-.*\.json$/.test(f))
    .sort();

  it("finds the fixtures it guards (a glob that matches nothing checks nothing)", () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
    expect(files).toContain("catalog-search-skofja-loka.json");
    expect(files).toContain("catalog-search-gorenja-vas-poljane.json");
  });

  it.each(files)("%s is already in the shape the tool returns", (file) => {
    const fixture = JSON.parse(readFileSync(`${dir}${file}`, "utf-8")) as { response: CatalogSearchResult };
    // Shaping it changes nothing: one entry per reel, within the budget, and no
    // cut list without its total and its hint (an `{ error }` envelope is left as it is).
    expect(shapeAnswer(structuredClone(fixture.response))).toEqual(fixture.response);
    expect(cutFieldProblems(fixture.response)).toEqual([]);
    // The two fields the answer no longer carries, anywhere in the file.
    expect(JSON.stringify(fixture)).not.toMatch(/"(shelf|imageStartNumber)"/);
  });

  describe("the guard on the cut fields", () => {
    const cut = (): CatalogSearchResult => shapeAnswer(structuredClone(IRELAND));
    const withCutHit = (r: CatalogSearchResult): CatalogHit => r.hits.find((h) => h.filmNotesTotal !== undefined) as CatalogHit;

    it("passes a cut answer, an uncut one and an error envelope", () => {
      expect(cutFieldProblems(cut())).toEqual([]);
      expect(cutFieldProblems(IRELAND)).toEqual([]);
      expect(cutFieldProblems({ error: "no such place" })).toEqual([]);
      const left = shapeAnswer(paddedIreland(120), 5_000);
      expect(left.hitsOmitted).toBeGreaterThan(0);
      expect(cutFieldProblems(left)).toEqual([]);
    });

    it("fails a total without its hint, a hint without its total, and a total that is not more than the entries listed", () => {
      const noHint = cut();
      delete withCutHit(noHint).filmNotesHint;
      expect(cutFieldProblems(noHint)).toEqual([expect.stringContaining("filmNotesTotal without its hint")]);
      const noTotal = cut();
      delete withCutHit(noTotal).filmNotesTotal;
      expect(cutFieldProblems(noTotal)).toEqual([expect.stringContaining("filmNotesHint without its total")]);
      const small = cut();
      withCutHit(small).filmNotesTotal = withCutHit(small).filmNotes?.length;
      expect(cutFieldProblems(small)).toEqual([expect.stringContaining("not more than the entries listed")]);
      // The review's plant: a total on a hit of a recorded answer that lists everything, with no hint.
      // Whatever cut fields the recorded answer carries are removed first, so the plant is the same defect
      // whatever the file holds.
      const planted = JSON.parse(readFileSync(`${dir}catalog-search-skofja-loka.json`, "utf-8")) as { response: CatalogSearchResult };
      const hitWithNotes = planted.response.hits.find((h) => (h.filmNotes?.length ?? 0) > 0) as CatalogHit;
      delete hitWithNotes.filmNotesTotal;
      delete hitWithNotes.filmNotesHint;
      expect(cutFieldProblems(planted.response)).toEqual([]);
      hitWithNotes.filmNotesTotal = 9;
      expect(cutFieldProblems(planted.response)).toEqual([expect.stringContaining("filmNotesTotal without its hint")]);
    });

    it("fails an omitted count without its hint, a hint without its count, a count that is not a count, and a `returned` that is not the hits listed", () => {
      const left = (): CatalogSearchResult => shapeAnswer(paddedIreland(120), 5_000);
      const noHint = left();
      delete noHint.hitsOmittedHint;
      expect(cutFieldProblems(noHint)).toEqual([expect.stringContaining("hitsOmitted without its hint")]);
      const noCount = left();
      delete noCount.hitsOmitted;
      expect(cutFieldProblems(noCount)).toEqual([expect.stringContaining("hitsOmittedHint without its count")]);
      const zero = left();
      zero.hitsOmitted = 0;
      expect(cutFieldProblems(zero)).toEqual([expect.stringContaining("not a count of hits")]);
      const off = left();
      off.returned = 120;
      expect(cutFieldProblems(off)).toEqual([expect.stringContaining("returned is not the number of hits listed")]);
    });
  });
});

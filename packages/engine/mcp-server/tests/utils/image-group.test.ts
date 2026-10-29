import { describe, it, expect, vi, beforeEach } from "vitest";
import { LOCAL } from "../../src/auth/principal.js";

vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: vi.fn(),
}));

import { getValidToken } from "../../src/auth/refresh.js";
import {
  imageGroupPlace,
  sharedCoveragePlace,
  __clearImageGroupCacheForTests,
} from "../../src/utils/image-group.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const GS = "https://sg30p0.familysearch.org/service/records/rms/group-service";
const ARK = "ark:/61903/3:1:3QSQ-G9WJ-M3P";
const ARK_URL = `https://www.familysearch.org/${ARK}`;

/** A live-shaped group: the film 007156564 (probed 2026-10-29). */
const TRUMBULL = {
  groupName: "007156564",
  coverages: [{ place: "Trumbull, Ohio, United States", placeRepIdHierarchy: [1, 351, 35] }],
};

type Reply = { status: number; body?: unknown } | Error;

/** Serve `routes` (URL → reply) and record each URL asked for. */
function serve(routes: Record<string, Reply>) {
  mockFetch.mockImplementation(async (url: string) => {
    const reply = routes[url];
    if (reply === undefined) throw new Error(`unexpected URL ${url}`);
    if (reply instanceof Error) throw reply;
    const { status, body } = reply;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: String(status),
      headers: new Headers(),
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
      json: async () => (typeof body === "string" ? JSON.parse(body) : body),
    };
  });
}

const asked = () => mockFetch.mock.calls.map((c) => c[0] as string);

/** `run()`, with fetchWithRetry's backoff sleeps between retries run at once. */
async function withoutSleeps<T>(run: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  try {
    const result = run();
    await vi.runAllTimersAsync();
    return await result;
  } finally {
    vi.useRealTimers();
  }
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.mocked(getValidToken).mockReset();
  vi.mocked(getValidToken).mockResolvedValue("test-token");
  __clearImageGroupCacheForTests();
});

describe("sharedCoveragePlace", () => {
  it("is the one coverage place, or the trailing segments every coverage place shares", () => {
    expect(sharedCoveragePlace(TRUMBULL)).toBe("Trumbull, Ohio, United States");
    expect(
      sharedCoveragePlace({
        coverages: [
          { place: "Oude Tonge, South Holland, Netherlands" },
          { place: "Vlist, South Holland, Netherlands" },
          { place: "South Holland, Netherlands" },
        ],
      }),
    ).toBe("South Holland, Netherlands");
    expect(
      sharedCoveragePlace({
        coverages: [
          { place: "Vlist, South Holland, Netherlands" },
          { place: "Tienhoven, Vijfheerenlanden, Utrecht, Netherlands" },
        ],
      }),
    ).toBe("Netherlands");
  });

  it("is null when the coverages lie in different countries, or name no place", () => {
    expect(
      sharedCoveragePlace({ coverages: [{ place: "Dublin, Ireland" }, { place: "Belfast, Antrim, Northern Ireland, United Kingdom" }] }),
    ).toBeNull();
    expect(sharedCoveragePlace({ coverages: [] })).toBeNull();
    expect(sharedCoveragePlace({})).toBeNull();
    expect(sharedCoveragePlace({ coverages: [{ place: 7 }, {}] })).toBeNull();
    expect(sharedCoveragePlace({ coverages: [{ place: 7 }, { place: "Trumbull, Ohio, United States" }] })).toBe(
      "Trumbull, Ohio, United States",
    );
  });
});

describe("imageGroupPlace", () => {
  it("reads an imageId's film: its group id, then the group's coverage place", async () => {
    serve({
      [`${GS}/group/007156564/apid`]: { status: 200, body: "TH-1951-32909-2914-67\n" },
      [`${GS}/group/TH-1951-32909-2914-67`]: { status: 200, body: TRUMBULL },
    });
    expect(await imageGroupPlace({ imageId: "007156564_00250" }, LOCAL)).toBe("Trumbull, Ohio, United States");
    expect(asked()).toEqual([`${GS}/group/007156564/apid`, `${GS}/group/TH-1951-32909-2914-67`]);
  });

  it("asks an ark's resolver once for its image's name, then reads that film", async () => {
    serve({
      [ARK_URL]: { status: 200, body: { name: "007156564_00250", apid: "TH-1942-32910-113-69" } },
      [`${GS}/group/007156564/apid`]: { status: 200, body: "TH-1951-32909-2914-67" },
      [`${GS}/group/TH-1951-32909-2914-67`]: { status: 200, body: TRUMBULL },
    });
    expect(await imageGroupPlace({ ark: `${ARK}?i=4&cc=1968530` }, LOCAL)).toBe("Trumbull, Ohio, United States");
    expect(asked()[0]).toBe(ARK_URL);
    const init = mockFetch.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get("Accept")).toBe("application/json");
  });

  it("reaches the resolver from every ark spelling image_transcribe reads", async () => {
    const spellings = [ARK, ARK_URL, `${ARK_URL}?i=4&cc=1`, "3:1:3QSQ-G9WJ-M3P"];
    for (const ark of spellings) {
      __clearImageGroupCacheForTests();
      mockFetch.mockReset();
      serve({ [ARK_URL]: { status: 404 } });
      await imageGroupPlace({ ark }, LOCAL);
      expect(asked(), ark).toEqual([ARK_URL]);
    }
    __clearImageGroupCacheForTests();
    mockFetch.mockReset();
    serve({ "https://www.familysearch.org/ark:/61903/3:1:3QSQ-G9WJ-M3PX-Q": { status: 404 } });
    await imageGroupPlace({ ark: "3QSQ-G9WJ-M3PX-Q" }, LOCAL);
    expect(asked()).toEqual(["https://www.familysearch.org/ark:/61903/3:1:3QSQ-G9WJ-M3PX-Q"]);
  });

  it("reads a DGS distribution URL's film with no ark request", async () => {
    serve({
      [`${GS}/group/004884748/apid`]: { status: 200, body: "TH-A" },
      [`${GS}/group/TH-A`]: { status: 200, body: TRUMBULL },
    });
    const ark = "https://familysearch.org/das/v2/dgs:004884748_02613/dist.jpg";
    expect(await imageGroupPlace({ ark }, LOCAL)).toBe("Trumbull, Ohio, United States");
    expect(asked()).toEqual([`${GS}/group/004884748/apid`, `${GS}/group/TH-A`]);
  });

  it("caches the place per film, and the film per ark, for the process", async () => {
    serve({
      [ARK_URL]: { status: 200, body: { name: "007156564_00250" } },
      [`${GS}/group/007156564/apid`]: { status: 200, body: "TH-F" },
      [`${GS}/group/TH-F`]: { status: 200, body: TRUMBULL },
    });
    await imageGroupPlace({ imageId: "007156564_00001" }, LOCAL);
    await imageGroupPlace({ imageId: "007156564_00002" }, LOCAL);
    await imageGroupPlace({ ark: ARK }, LOCAL);
    await imageGroupPlace({ ark: ARK }, LOCAL);
    expect(asked()).toEqual([`${GS}/group/007156564/apid`, `${GS}/group/TH-F`, ARK_URL]);
  });

  it("gives no place, and never throws, for a restricted group, a missing coverage or a film that has none", async () => {
    const cases: [string, Record<string, Reply>][] = [
      ["403 on the group", { [`${GS}/group/007156564/apid`]: { status: 200, body: "TH-F" }, [`${GS}/group/TH-F`]: { status: 403 } }],
      ["no coverages", { [`${GS}/group/007156564/apid`]: { status: 200, body: "TH-F" }, [`${GS}/group/TH-F`]: { status: 200, body: { groupName: "007156564" } } }],
      ["no group id", { [`${GS}/group/007156564/apid`]: { status: 404 } }],
    ];
    for (const [label, routes] of cases) {
      __clearImageGroupCacheForTests();
      mockFetch.mockReset();
      serve(routes);
      expect(await imageGroupPlace({ imageId: "007156564_00250" }, LOCAL), label).toBeNull();
    }
  });

  it("gives no place, and never throws, when an ark's resolver refuses it or names no image", async () => {
    const replies: [string, Reply][] = [
      ["403", { status: 403 }],
      ["not JSON", { status: 200, body: "<html>" }],
      ["no name", { status: 200, body: { apid: "TH-X" } }],
      ["a name that is no image", { status: 200, body: { name: "Bautismos 1800-1820" } }],
    ];
    for (const [label, reply] of replies) {
      __clearImageGroupCacheForTests();
      mockFetch.mockReset();
      serve({ [ARK_URL]: reply });
      expect(await imageGroupPlace({ ark: ARK }, LOCAL), label).toBeNull();
      expect(asked(), label).toEqual([ARK_URL]);
    }
  });

  it("gives no place, and never throws, with no FamilySearch session or no network", async () => {
    vi.mocked(getValidToken).mockRejectedValueOnce(new Error("Call the login tool to authenticate."));
    expect(await imageGroupPlace({ imageId: "007156564_00250" }, LOCAL)).toBeNull();
    serve({ [`${GS}/group/007156564/apid`]: new TypeError("fetch failed") });
    expect(await withoutSleeps(() => imageGroupPlace({ imageId: "007156564_00250" }, LOCAL))).toBeNull();
  });

  it("caches what FamilySearch answered, a refusal included, but asks again after a failure to reach it", async () => {
    serve({
      [`${GS}/group/007156564/apid`]: { status: 200, body: "TH-F" },
      [`${GS}/group/TH-F`]: { status: 403 },
      [ARK_URL]: { status: 403 },
    });
    await imageGroupPlace({ imageId: "007156564_00001" }, LOCAL);
    await imageGroupPlace({ imageId: "007156564_00002" }, LOCAL);
    await imageGroupPlace({ ark: ARK }, LOCAL);
    await imageGroupPlace({ ark: ARK }, LOCAL);
    expect(asked()).toEqual([`${GS}/group/007156564/apid`, `${GS}/group/TH-F`, ARK_URL]);

    const transient: [string, Record<string, Reply>][] = [
      ["network", { [`${GS}/group/007156564/apid`]: new TypeError("fetch failed") }],
      ["5xx", { [`${GS}/group/007156564/apid`]: { status: 200, body: "TH-F" }, [`${GS}/group/TH-F`]: { status: 503 } }],
      ["429", { [`${GS}/group/007156564/apid`]: { status: 200, body: "TH-F" }, [`${GS}/group/TH-F`]: { status: 429 } }],
      ["metadata not JSON", { [`${GS}/group/007156564/apid`]: { status: 200, body: "TH-F" }, [`${GS}/group/TH-F`]: { status: 200, body: "<html>" } }],
      ["ark resolver 5xx", { [ARK_URL]: { status: 502 } }],
      ["ark resolver not JSON", { [ARK_URL]: { status: 200, body: "<html>" } }],
    ];
    for (const [label, routes] of transient) {
      __clearImageGroupCacheForTests();
      mockFetch.mockReset();
      serve(routes);
      const image = label.startsWith("ark") ? { ark: ARK } : { imageId: "007156564_00250" };
      expect(await withoutSleeps(() => imageGroupPlace(image, LOCAL)), label).toBeNull();
      serve({
        [ARK_URL]: { status: 200, body: { name: "007156564_00250" } },
        [`${GS}/group/007156564/apid`]: { status: 200, body: "TH-F" },
        [`${GS}/group/TH-F`]: { status: 200, body: TRUMBULL },
      });
      expect(await withoutSleeps(() => imageGroupPlace(image, LOCAL)), label).toBe("Trumbull, Ohio, United States");
    }
  });

  it("asks nothing for an input that names no FamilySearch image", async () => {
    expect(await imageGroupPlace({}, LOCAL)).toBeNull();
    expect(await imageGroupPlace({ ark: "dgs:008679397/dist.jpg" }, LOCAL)).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

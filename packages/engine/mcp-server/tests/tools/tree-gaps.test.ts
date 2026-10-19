import { LOCAL } from "../../src/auth/principal.js";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Spy on the real fsFetch so a test can read the timeout and retry budget it was given.
vi.mock("../../src/utils/fs-fetch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/fs-fetch.js")>();
  return { ...actual, fsFetch: vi.fn(actual.fsFetch) };
});

vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: vi.fn().mockResolvedValue("test-token"),
}));

import { fsFetch } from "../../src/utils/fs-fetch.js";
import { catalogWaitMs, hintEvents, hintYears, readWindow, treeGapsTool } from "../../src/tools/tree-gaps.js";
import { clearCollectionsCache } from "../../src/tools/collections-search.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function json(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: () => Promise.resolve(body),
    headers: new Headers(),
  };
}

const person = (id: string, d: Record<string, string>, living = false) => ({
  id,
  living,
  display: d,
});

// Route by URL fragment so call order does not matter.
function route(handlers: Record<string, () => unknown>) {
  mockFetch.mockImplementation(async (url: string) => {
    for (const [frag, fn] of Object.entries(handlers)) {
      if (String(url).includes(frag)) return fn();
    }
    throw new Error(`unrouted ${url}`);
  });
}

beforeEach(() => {
  mockFetch.mockReset();
  clearCollectionsCache();
});

describe("treeGapsTool", () => {
  it("rejects out-of-range arguments", async () => {
    await expect(treeGapsTool({ ancestorGenerations: 9 }, LOCAL)).rejects.toThrow(/ancestorGenerations/);
    await expect(treeGapsTool({ descendantGenerations: 5 }, LOCAL)).rejects.toThrow(/descendantGenerations/);
    await expect(treeGapsTool({ maxHoles: 0 }, LOCAL)).rejects.toThrow(/maxHoles/);
  });

  it("defaults the root to the logged-in user and reports holes from the pedigree and descendancy", async () => {
    const root = {
      name: "Root",
      gender: "Male",
      birthDate: "1 May 1900",
      deathDate: "1 May 1970",
      lifespan: "1900-1970",
    };
    route({
      "/users/current": () => json({ users: [{ personId: "ROOT-1" }] }),
      "/tree/ancestry": () => json({ persons: [person("ROOT-1", { ascendancyNumber: "1", ...root })] }),
      "/tree/descendancy": () =>
        json({
          persons: [
            person("ROOT-1", { descendancyNumber: "1", ...root, marriageDate: "1 May 1925" }),
            person("WIFE-1", {
              descendancyNumber: "1-S1",
              name: "Wife",
              gender: "Female",
              birthDate: "1 May 1902",
              deathDate: "1 May 1980",
              lifespan: "1902-1980",
            }),
          ],
        }),
      "/service/search/hr/v2/collections": () => json({ entries: [] }),
    });
    const r = await treeGapsTool({ ancestorGenerations: 1 }, LOCAL);
    expect(r.root).toEqual({ personId: "ROOT-1", name: "Root" });
    expect(r.gaps.map((g) => g.type)).toContain("no_children");
    expect(r.scanned.descendancyReads).toBe(1);
    const urls = mockFetch.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/tree/ancestry?person=ROOT-1&generations=1&personDetails=true"))).toBe(true);
    expect(urls.some((u) => u.includes("/tree/descendancy?person=ROOT-1&generations=4&personDetails=true"))).toBe(true);
  });

  it("makes no descendancy read when descendantGenerations is 0 and the cap is 1", async () => {
    route({
      "/tree/ancestry": () =>
        json({ persons: [person("R", { ascendancyNumber: "1", name: "R", gender: "Male", lifespan: "1900-1970" })] }),
      "/tree/descendancy": () => json({ persons: [] }),
      "/service/search/hr/v2/collections": () => json({ entries: [] }),
    });
    const r = await treeGapsTool({ personId: "R", ancestorGenerations: 1, descendantGenerations: 0 }, LOCAL);
    // The only anchor left is the depth-1 ancestors, which this tree does not have.
    expect(r.scanned.descendancyReads).toBe(0);
  });

  it("surfaces a missing person as a clear error", async () => {
    route({ "/tree/ancestry": () => json({}, 404) });
    await expect(treeGapsTool({ personId: "NOPE-123" }, LOCAL)).rejects.toThrow(/not found/);
  });

  it("still returns holes, with null coverage and a note, when the catalog is unavailable", async () => {
    const r1 = { name: "R", gender: "Male", birthDate: "1 May 1900", lifespan: "1900-" };
    route({
      "/tree/ancestry": () => json({ persons: [person("R", { ascendancyNumber: "1", ...r1 })] }),
      "/tree/descendancy": () => json({ persons: [person("R", { descendancyNumber: "1", ...r1 })] }),
      "/service/search/hr/v2/collections": () => json({}, 500),
    });
    const r = await treeGapsTool({ personId: "R", ancestorGenerations: 1 }, LOCAL);
    expect(r.gaps.length).toBeGreaterThan(0);
    expect(r.gaps.every((g) => g.coverage === null)).toBe(true);
    expect(r.notes.join(" ")).toMatch(/coverage was unavailable/);
  });

  it("notes a failed ancestor-household read instead of dropping it silently", async () => {
    const asc = (id: string, n: string) =>
      person(id, { ascendancyNumber: n, name: id, gender: Number(n) % 2 ? "Female" : "Male", birthDate: "1 May 1850", deathDate: "1 May 1920", lifespan: "1850-1920" });
    route({
      "/tree/ancestry": () => json({ persons: [asc("R", "1"), asc("F", "2"), asc("M", "3")] }),
      "/tree/descendancy?person=R": () => json({ persons: [] }),
      "/tree/descendancy?person=F": () => json({}, 500),
      "/tree/descendancy?person=M": () => json({}, 500),
      "/service/search/hr/v2/collections": () => json({ entries: [] }),
    });
    const r = await treeGapsTool({ personId: "R", ancestorGenerations: 1 }, LOCAL);
    expect(r.notes.join(" ")).toMatch(/1 descendancy read failed/);
  });

  // Ancestry with a deceased root and one ancestor at each of depths 4 and 8, so the
  // near tier has an anchor and the far tier has an anchor.
  function ancestryWithFarAnchors(extraDepth8: number) {
    const base = {
      gender: "Male",
      birthDate: "1 May 1700",
      birthPlace: "Dayton, Ohio, United States",
      deathDate: "1 May 1770",
      lifespan: "1700-1770",
    };
    const persons = [
      person("R", { ascendancyNumber: "1", name: "R", ...base }),
      person("A4", { ascendancyNumber: "16", name: "A4", ...base }),
    ];
    for (let i = 0; i < extraDepth8; i++) {
      persons.push(person(`A8-${i}`, { ascendancyNumber: String(256 + i), name: `A8-${i}`, ...base }));
    }
    return { persons };
  }

  it("stops before the far anchors once maxHoles are in hand (early exit)", async () => {
    route({
      "/tree/ancestry": () => json(ancestryWithFarAnchors(1)),
      "/tree/descendancy": () => json({ persons: [] }),
      "/service/search/hr/v2/collections": () => json({ entries: [] }),
    });
    // R (depth 0) and A4 (depth 4 < 8) both lack parents: two holes at once.
    const r = await treeGapsTool({ personId: "R", maxHoles: 1 }, LOCAL);
    expect(r.scanned.stopReason).toBe("maxHoles");
    expect(r.scanned.stoppedEarly).toBe(true);
    // The root's descendants and the depth-4 anchor ran; the depth-8 anchor did not.
    expect(r.scanned.descendancyReads).toBe(2);
    expect(r.gaps).toHaveLength(1);
  });

  it("reads the far anchors when maxHoles is not reached", async () => {
    route({
      "/tree/ancestry": () => json(ancestryWithFarAnchors(1)),
      "/tree/descendancy": () => json({ persons: [] }),
      "/service/search/hr/v2/collections": () => json({ entries: [] }),
    });
    const r = await treeGapsTool({ personId: "R", maxHoles: 50 }, LOCAL);
    expect(r.scanned.descendancyReads).toBe(3);
    expect(r.scanned.stopReason).toBeNull();
  });

  it("caps the descendancy reads at 60 and says so", async () => {
    route({
      "/tree/ancestry": () => json(ancestryWithFarAnchors(130)),
      "/tree/descendancy": () => json({ persons: [] }),
      "/service/search/hr/v2/collections": () => json({ entries: [] }),
    });
    const r = await treeGapsTool({ personId: "R", maxHoles: 50 }, LOCAL);
    expect(r.scanned.stopReason).toBe("readCap");
    expect(r.scanned.descendancyReads).toBe(60);
    expect(r.notes.join(" ")).toMatch(/read cap/);
  });

  describe("time budget", () => {
    const rootOnly = () =>
      route({
        "/tree/ancestry": () =>
          json({ persons: [person("R", { ascendancyNumber: "1", name: "R", gender: "Male", lifespan: "1900-1970" })] }),
        "/tree/descendancy": () => json({ persons: [] }),
        "/service/search/hr/v2/collections": () => json({ entries: [] }),
      });
    // First Date.now() is the tool's start stamp; every later one reads `later`.
    const clock = (later: number) => {
      let calls = 0;
      return vi.spyOn(Date, "now").mockImplementation(() => (calls++ === 0 ? 0 : later));
    };

    it("starts no read once 40 s have passed, and says so", async () => {
      rootOnly();
      const now = clock(40_001);
      try {
        const r = await treeGapsTool({ personId: "R", ancestorGenerations: 1 }, LOCAL);
        expect(r.scanned.stopReason).toBe("timeBudget");
        expect(r.scanned.descendancyReads).toBe(0);
        expect(r.notes.join(" ")).toMatch(/time budget/);
      } finally {
        now.mockRestore();
      }
    });

    it("still reads when exactly 40 s have passed", async () => {
      rootOnly();
      const now = clock(40_000);
      try {
        const r = await treeGapsTool({ personId: "R", ancestorGenerations: 1 }, LOCAL);
        expect(r.scanned.stopReason).toBeNull();
        expect(r.scanned.descendancyReads).toBe(1);
      } finally {
        now.mockRestore();
      }
    });
  });

  describe("pending hints", () => {
    const hint = (pid: string, title: string) => ({
      id: `https://familysearch.org/ark:/61903/1:1:${pid}`,
      confidence: 4,
      score: 0.9,
      title,
      matchInfo: [{ status: "http://familysearch.org/v1/Pending", collection: "https://familysearch.org/platform/collections/records" }],
    });
    const MATCHES = "/match/resolutions/match/matches";
    // One root, deceased with no death date: a `no_death_date` hole.
    const survey = (matches: () => unknown, catalog: () => unknown = () => json({ entries: [] })) =>
      route({
        "/tree/ancestry": () =>
          json({
            persons: [
              person("KNDX-MKG", { ascendancyNumber: "1", name: "R", gender: "Male", birthDate: "1 May 1900", lifespan: "1900-1990" }),
            ],
          }),
        "/tree/descendancy": () => json({ persons: [] }),
        "/service/search/hr/v2/collections": catalog,
        [MATCHES]: matches,
      });

    it("counts a hint only when its title names the event the hole is missing", async () => {
      survey(() =>
        json({
          entries: [
            hint("AAAA-111", "Ohio, Deaths and Burials, 1850-1950"),
            hint("BBBB-222", "Ohio, Births and Christenings, 1800-1900"),
            hint("CCCC-333", "Ohio, Marriages, 1800-1900"),
            hint("DDDD-444", "Ohio, Vital Records, 1800-1950"),
          ],
        }),
      );
      const r = await treeGapsTool({ personId: "KNDX-MKG", ancestorGenerations: 1 }, LOCAL);
      // Only the death record is about a missing death date: a birth or a marriage
      // hint shares the VITAL type but not the event, and a title naming none cannot be judged.
      expect(r.gaps.find((g) => g.type === "no_death_date")!.pendingHints).toEqual({ fitting: 1, total: 4 });
    });

    it("counts zero fitting when every hint is about another event", async () => {
      survey(() => json({ entries: [hint("BBBB-222", "Ohio, Births and Christenings, 1800-1900")] }));
      const r = await treeGapsTool({ personId: "KNDX-MKG", ancestorGenerations: 1 }, LOCAL);
      expect(r.gaps.find((g) => g.type === "no_death_date")!.pendingHints).toEqual({ fitting: 0, total: 1 });
    });

    it("on a couple hole about children, only a census fits; a spouse's own baptism or death does not", async () => {
      const root = { name: "Root", gender: "Male", birthDate: "1 May 1900", deathDate: "1 May 1970", lifespan: "1900-1970" };
      route({
        "/tree/ancestry": () => json({ persons: [person("KNDX-MKG", { ascendancyNumber: "1", ...root })] }),
        "/tree/descendancy": () =>
          json({
            persons: [
              person("KNDX-MKG", { descendancyNumber: "1", ...root, marriageDate: "1 May 1925" }),
              person("WIFE-111", {
                descendancyNumber: "1-S1",
                name: "Wife",
                gender: "Female",
                birthDate: "1 May 1902",
                deathDate: "1 May 1980",
                lifespan: "1902-1980",
              }),
            ],
          }),
        "/service/search/hr/v2/collections": () => json({ entries: [] }),
        [MATCHES]: () =>
          json({
            entries: [
              hint("AAAA-111", "Ohio, Baptisms, 1800-1950"),
              hint("BBBB-222", "Ohio, Deaths and Burials, 1850-1950"),
              hint("CCCC-333", "United States Census, 1930"),
            ],
          }),
      });
      const r = await treeGapsTool({ personId: "KNDX-MKG", ancestorGenerations: 1 }, LOCAL);
      const hole = r.gaps.find((g) => g.type === "no_children")!;
      expect(hole.spouseId).toBe("WIFE-111");
      // Both spouses return the same three matches; each is counted once.
      expect(hole.pendingHints).toEqual({ fitting: 1, total: 3 });
    });

    it("puts a hole with a fitting hint first and keeps the nearest-first order within each group", async () => {
      const asc = (id: string, n: string, d: Record<string, string>) =>
        person(id, { ascendancyNumber: n, name: id, gender: Number(n) % 2 ? "Female" : "Male", birthDate: "1 May 1850", ...d });
      route({
        "/tree/ancestry": () =>
          json({
            persons: [
              asc("KNDX-MKG", "1", { lifespan: "1880-1950" }),
              asc("FATH-111", "2", { lifespan: "1850-1920" }),
              asc("MOTH-111", "3", { lifespan: "1855-1925" }),
            ],
          }),
        "/tree/descendancy": () => json({ persons: [] }),
        "/service/search/hr/v2/collections": () => json({ entries: [] }),
        // The mother, the farthest hole, is the only one with a fitting (death) hint.
        "4%3A1%3AMOTH-111": () => json({ entries: [hint("AAAA-111", "Ohio, Deaths and Burials, 1850-1950")] }),
        [MATCHES]: () => json({ entries: [] }),
      });
      const r = await treeGapsTool({ personId: "KNDX-MKG", ancestorGenerations: 2 }, LOCAL);
      const ids = r.gaps.filter((g) => g.type === "no_death_date").map((g) => g.personId);
      // The mother, the farthest hole, moves first; the root and the father keep their order.
      expect(ids).toEqual(["MOTH-111", "KNDX-MKG", "FATH-111"]);
    });

    it("a census counts for a children hole only if taken in the hole's window", async () => {
      const root = { name: "Root", gender: "Male", birthDate: "1 May 1900", deathDate: "1 May 1970", lifespan: "1900-1970" };
      route({
        "/tree/ancestry": () => json({ persons: [person("KNDX-MKG", { ascendancyNumber: "1", ...root })] }),
        "/tree/descendancy": () =>
          json({
            persons: [
              person("KNDX-MKG", { descendancyNumber: "1", ...root, marriageDate: "1 May 1925" }),
              person("WIFE-111", {
                descendancyNumber: "1-S1",
                name: "Wife",
                gender: "Female",
                birthDate: "1 May 1902",
                deathDate: "1 May 1980",
                lifespan: "1902-1980",
              }),
            ],
          }),
        "/service/search/hr/v2/collections": () => json({ entries: [] }),
        [MATCHES]: () =>
          json({
            entries: [
              hint("AAAA-111", "United States Census, 1910"),
              hint("BBBB-222", "United States Census, 1930"),
              hint("CCCC-333", "Ohio Census Index, 1900-1950"),
              hint("DDDD-444", "United States Census"),
            ],
          }),
      });
      const r = await treeGapsTool({ personId: "KNDX-MKG", ancestorGenerations: 1 }, LOCAL);
      const hole = r.gaps.find((g) => g.type === "no_children")!;
      expect(hole.yearRange!.start).toBeGreaterThan(1910);
      // The 1910 census, taken before the marriage, is the spouse's own childhood census and is excluded.
      // The 1930 census, a span that overlaps the window, and a title with no year all count.
      expect(hole.pendingHints).toEqual({ fitting: 3, total: 4 });
    });

    it("reads the years a collection title names, as one span", () => {
      expect(hintYears("United States Census, 1930")).toEqual({ start: 1930, end: 1930 });
      expect(hintYears("Ohio Census Index, 1900-1950")).toEqual({ start: 1900, end: 1950 });
      expect(hintYears("United States Census")).toBeNull();
      expect(hintYears("Find a Grave Index")).toBeNull();
    });

    it("reads event words from a collection title", () => {
      expect(hintEvents("Pennsylvania, Births and Christenings, 1700-1900")).toEqual(["birth"]);
      expect(hintEvents("Ohio, County Marriages, 1789-2013")).toEqual(["marriage"]);
      expect(hintEvents("Find a Grave Index")).toEqual(["death"]);
      expect(hintEvents("BillionGraves Index")).toEqual(["death"]);
      expect(hintEvents("United States, Social Security Death Index")).toEqual(["death"]);
      expect(hintEvents("United States Census, 1900")).toEqual(["census"]);
      expect(hintEvents("Vermont, Vital Records, 1760-2008")).toEqual([]);
      expect(hintEvents("Ghana, Church Registers")).toEqual([]);
    });

    it("leaves pendingHints null, with a note, when the hints cannot be read", async () => {
      survey(() => json({}, 500));
      const r = await treeGapsTool({ personId: "KNDX-MKG", ancestorGenerations: 1 }, LOCAL);
      expect(r.gaps.every((g) => g.pendingHints === null)).toBe(true);
      expect(r.notes.join(" ")).toMatch(/Pending hints were not read for 1 person/);
    });

    it("asks for pending matches at the API maximum count, with its own time window", async () => {
      survey(() => json({ entries: [] }));
      await treeGapsTool({ personId: "KNDX-MKG", ancestorGenerations: 1 }, LOCAL);
      const call = vi.mocked(fsFetch).mock.calls.find((c) => String(c[1]).includes(MATCHES))!;
      const url = String(call[1]);
      expect(url).toContain("status=pending");
      expect(url).toContain("count=50");
      expect(url).not.toContain("includeSummary=true");
      // The read ends inside the 50 s deadline on its own: a timeout and a retry budget.
      expect(call[3]).toBeGreaterThan(0);
      expect(call[3]).toBeLessThanOrEqual(25_000);
      expect(call[4]).toEqual({ budgetMs: expect.any(Number) });
    });

    it("leaves pendingHints null, with a note, for people not read before the time budget", async () => {
      survey(() => json({ entries: [hint("AAAA-111", "Ohio, Deaths, 1850-1950")] }));
      // First Date.now() is the tool's start stamp; every later one reads 41 s.
      let calls = 0;
      const now = vi.spyOn(Date, "now").mockImplementation(() => (calls++ === 0 ? 0 : 41_000));
      try {
        const r = await treeGapsTool({ personId: "KNDX-MKG", ancestorGenerations: 1 }, LOCAL);
        expect(r.gaps.length).toBeGreaterThan(0);
        expect(r.gaps.every((g) => g.pendingHints === null)).toBe(true);
        expect(r.notes.join(" ")).toMatch(/Pending hints were not read for 1 person/);
        expect(mockFetch.mock.calls.some((c) => String(c[0]).includes(MATCHES))).toBe(false);
      } finally {
        now.mockRestore();
      }
    });

    it("still counts hints when the catalog is unavailable", async () => {
      survey(() => json({ entries: [hint("AAAA-111", "Ohio, Deaths and Burials, 1850-1950")] }), () => json({}, 500));
      const r = await treeGapsTool({ personId: "KNDX-MKG", ancestorGenerations: 1 }, LOCAL);
      const hole = r.gaps.find((g) => g.type === "no_death_date")!;
      expect(hole.coverage).toBeNull();
      expect(hole.pendingHints).toEqual({ fitting: 1, total: 1 });
    });
  });

  it("scores a hole against the catalog: place scope, years and record type", async () => {
    const entry = (id: string, title: string, typeFacet: string, years: [number, number] = [1850, 1950]) => ({
      content: {
        gedcomx: {
          collections: [
            {
              id,
              title,
              searchMetadata: [{ startYear: years[0], endYear: years[1], typeFacet, recordCount: 1000 }],
            },
          ],
        },
      },
    });
    route({
      "/tree/ancestry": () =>
        json({
          persons: [
            person("R", {
              ascendancyNumber: "1",
              name: "R",
              gender: "Male",
              birthDate: "1 May 1900",
              birthPlace: "Dayton, Montgomery, Ohio, United States",
              lifespan: "1900-1990",
            }),
          ],
        }),
      "/tree/descendancy": () => json({ persons: [] }),
      "/service/search/hr/v2/collections": () =>
        json({
          entries: [
            entry("1", "Ohio, Births and Christenings, 1850-1950", "VITAL"),
            entry("2", "Ohio, Military Rolls, 1850-1950", "MILITARY"),
            entry("3", "Texas, Births, 1850-1950", "VITAL"),
            entry("4", "Ohio Census, 1920", "CENSUS", [1920, 1920]),
            entry("5", "Ohio Census, 1850", "CENSUS", [1850, 1850]),
            entry("6", "Ohio Census Index, 1900-1950", "CENSUS", [1900, 1950]),
          ],
        }),
    });
    const r = await treeGapsTool({ personId: "R", ancestorGenerations: 1 }, LOCAL);
    const hole = r.gaps.find((g) => g.type === "no_death_date")!;
    // Texas is the wrong place, MILITARY the wrong type, and the 1850 census is outside 1900-1990; a multi-year census index counts as a collection but names no census year.
    expect(hole.coverage).toEqual({
      collections: 3,
      records: 3000,
      recordTypes: ["CENSUS", "VITAL"],
      censusYears: [1920],
      placeLevel: "locality",
    });
  });

  it("reads the family of a couple whose line ends early, even when no anchor depth reaches them", async () => {
    // Living root; deceased parents (depth 1) with no parents of their own. Depth 1 is
    // neither 4 nor 8, so only the line-end rule sends a read to them.
    const base = { birthPlace: "Dayton, Montgomery, Ohio, United States" };
    route({
      "/tree/ancestry": () =>
        json({
          persons: [
            person("R", { ascendancyNumber: "1", name: "R", gender: "Male", birthDate: "1 May 1960", lifespan: "1960-" }, true),
            person("DAD", { ascendancyNumber: "2", name: "Dad", gender: "Male", birthDate: "1 May 1900", deathDate: "1 May 1980", lifespan: "1900-1980", ...base }),
            person("MOM", { ascendancyNumber: "3", name: "Mom", gender: "Female", birthDate: "1 May 1903", deathDate: "1 May 1985", lifespan: "1903-1985", ...base }),
          ],
        }),
      "/tree/descendancy?person=R": () => json({ persons: [] }),
      "/tree/descendancy?person=DAD": () =>
        json({
          persons: [
            person("DAD", { descendancyNumber: "1", name: "Dad", gender: "Male", birthDate: "1 May 1900", deathDate: "1 May 1980", lifespan: "1900-1980", marriageDate: "1 May 1925" }),
            person("MOM", { descendancyNumber: "1-S1", name: "Mom", gender: "Female", birthDate: "1 May 1903", deathDate: "1 May 1985", lifespan: "1903-1985" }),
            person("K1", { descendancyNumber: "1.1", name: "K1", gender: "Male", birthDate: "1 May 1926", deathDate: "1 May 2000", lifespan: "1926-2000" }),
            person("K2", { descendancyNumber: "1.2", name: "K2", gender: "Male", birthDate: "1 May 1940", deathDate: "1 May 2010", lifespan: "1940-2010" }),
          ],
        }),
      "/service/search/hr/v2/collections": () => json({ entries: [] }),
    });
    const r = await treeGapsTool({ personId: "R", ancestorGenerations: 3, descendantGenerations: 0 }, LOCAL);
    const gap = r.gaps.find((g) => g.type === "child_gap");
    expect(gap?.detail).toMatch(/1926 and 1940/);
    const urls = mockFetch.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/tree/descendancy?person=DAD&generations=1"))).toBe(true);
  });

  it("reads each direct-line couple one level down, never four", async () => {
    const base = { gender: "Male", birthDate: "1 May 1850", deathDate: "1 May 1920", lifespan: "1850-1920" };
    route({
      "/tree/ancestry": () =>
        json({
          persons: [
            person("R", { ascendancyNumber: "1", name: "R", ...base }),
            person("P2", { ascendancyNumber: "2", name: "P2", ...base }),
            person("P3", { ascendancyNumber: "3", name: "P3", ...base }),
            person("G4", { ascendancyNumber: "4", name: "G4", ...base }),
          ],
        }),
      "/tree/descendancy": () => json({ persons: [] }),
      "/service/search/hr/v2/collections": () => json({ entries: [] }),
    });
    await treeGapsTool({ personId: "R", ancestorGenerations: 4, descendantGenerations: 0 }, LOCAL);
    const urls = mockFetch.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/tree/descendancy?person=G4&generations=1"))).toBe(true);
    expect(urls.filter((u) => u.includes("/tree/descendancy?person=") && !/generations=1&/.test(u))).toEqual([]);
  });

  it("reads the household of a couple between the root and brick-wall grandparents", async () => {
    // Living root; deceased parents; four deceased grandparents with no parents of their own.
    const d = (extra: Record<string, string>) => ({ gender: "Male", ...extra });
    route({
      "/tree/ancestry": () =>
        json({
          persons: [
            person("R", { ascendancyNumber: "1", name: "R", ...d({ birthDate: "1 May 1960", lifespan: "1960-" }) }, true),
            person("DAD", { ascendancyNumber: "2", name: "Dad", ...d({ birthDate: "1 May 1900", deathDate: "1 May 1980", lifespan: "1900-1980" }) }),
            person("MOM", { ascendancyNumber: "3", name: "Mom", gender: "Female", birthDate: "1 May 1903", deathDate: "1 May 1985", lifespan: "1903-1985" }),
            ...["4", "5", "6", "7"].map((n) =>
              person(`G${n}`, { ascendancyNumber: n, name: `G${n}`, gender: Number(n) % 2 ? "Female" : "Male", birthDate: "1 May 1870", deathDate: "1 May 1940", lifespan: "1870-1940" }),
            ),
          ],
        }),
      "/tree/descendancy?person=R": () => json({ persons: [] }),
      "/tree/descendancy?person=DAD": () =>
        json({
          persons: [
            person("DAD", { descendancyNumber: "1", name: "Dad", ...d({ birthDate: "1 May 1900", deathDate: "1 May 1980", lifespan: "1900-1980", marriageDate: "1 May 1925" }) }),
            person("MOM", { descendancyNumber: "1-S1", name: "Mom", gender: "Female", birthDate: "1 May 1903", deathDate: "1 May 1985", lifespan: "1903-1985" }),
            person("K1", { descendancyNumber: "1.1", name: "K1", ...d({ birthDate: "1 May 1926", deathDate: "1 May 2000", lifespan: "1926-2000" }) }),
            person("K2", { descendancyNumber: "1.2", name: "K2", ...d({ birthDate: "1 May 1940", deathDate: "1 May 2010", lifespan: "1940-2010" }) }),
          ],
        }),
      "/tree/descendancy": () => json({ persons: [] }),
      "/service/search/hr/v2/collections": () => json({ entries: [] }),
    });
    const r = await treeGapsTool({ personId: "R", ancestorGenerations: 3, descendantGenerations: 0 }, LOCAL);
    expect(r.gaps.find((g) => g.type === "child_gap")?.detail).toMatch(/1926 and 1940/);
    const urls = mockFetch.mock.calls.map((c) => String(c[0]));
    // The parents' household, and each grandparent couple's, one level down.
    for (const id of ["DAD", "G4", "G6"]) {
      expect(urls.some((u) => u.includes(`/tree/descendancy?person=${id}&generations=1&`))).toBe(true);
    }
    // One read per couple: the mothers are not read when the father is.
    expect(urls.some((u) => u.includes("person=MOM"))).toBe(false);
  });

  describe("deadline", () => {
    it("gives a read half the time left as its timeout and half as its retry budget", () => {
      expect(readWindow(0)).toEqual({ timeoutMs: 25_000, budgetMs: 25_000 });
      expect(readWindow(30_000)).toEqual({ timeoutMs: 10_000, budgetMs: 10_000 });
    });
    it("starts no read with under 2 s left", () => {
      expect(readWindow(47_999)).not.toBeNull();
      expect(readWindow(48_001)).toBeNull();
    });
    it("hands every FamilySearch read its timeout and retry budget", async () => {
      route({
        "/tree/ancestry": () =>
          json({ persons: [person("R", { ascendancyNumber: "1", name: "R", gender: "Male", lifespan: "1900-1970" })] }),
        "/tree/descendancy": () => json({ persons: [] }),
        "/service/search/hr/v2/collections": () => json({ entries: [] }),
      });
      vi.mocked(fsFetch).mockClear();
      await treeGapsTool({ personId: "R", ancestorGenerations: 1 }, LOCAL);
      const tree = vi.mocked(fsFetch).mock.calls.filter((c) => String(c[1]).includes("/tree/"));
      expect(tree.length).toBeGreaterThanOrEqual(2);
      for (const c of tree) {
        expect(c[3]).toBeGreaterThan(0);
        expect(c[3]).toBeLessThanOrEqual(25_000);
        expect(c[4]).toEqual({ budgetMs: c[3] });
      }
    });
    it("waits for the catalog no longer than the time left, nor 15 s", () => {
      expect(catalogWaitMs(0)).toBe(15_000);
      expect(catalogWaitMs(40_000)).toBe(10_000);
      expect(catalogWaitMs(55_000)).toBe(0);
    });
  });
});


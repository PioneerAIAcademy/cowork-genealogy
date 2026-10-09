import { LOCAL } from "../../src/auth/principal.js";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/auth/refresh.js", () => ({
  getValidToken: vi.fn().mockResolvedValue("test-token"),
}));

import { anchorDepths, treeGapsTool } from "../../src/tools/tree-gaps.js";
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

describe("anchorDepths", () => {
  it("steps down from the cap every 4 generations, nearest first", () => {
    expect(anchorDepths(8)).toEqual([4, 8]);
    expect(anchorDepths(6)).toEqual([2, 6]);
    expect(anchorDepths(3)).toEqual([3]);
  });
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
});

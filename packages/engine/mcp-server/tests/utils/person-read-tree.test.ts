import { describe, it, expect, vi, beforeEach } from "vitest";

// The host build's place step goes through the converter's own resolver; stub
// it so these stay offline and deterministic.
vi.mock("../../src/utils/place-resolver.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/place-resolver.js")>();
  return { ...actual, resolveStandardPlace: vi.fn() };
});

import { resolveStandardPlace } from "../../src/utils/place-resolver.js";
import { buildFromStagedRead, accessDate } from "../../src/utils/person-read-tree.js";

const resolver = vi.mocked(resolveStandardPlace);
const NOW = new Date("2026-10-01T12:00:00Z");

const read = (facts: Array<Record<string, unknown>>) => ({
  personId: "LZNY-BRF",
  requestedId: "LZNY-BRF",
  gedcomx: {
    persons: [{ id: "LZNY-BRF", gender: "Male", living: false, names: [{ given: "Patrick", surname: "Flynn" }], facts }],
    relationships: [],
    sources: [],
  },
});

beforeEach(() => {
  resolver.mockReset();
});

/** Build, then run the place retry the way project_create does, after its checks. */
async function buildAndFill(args: Parameters<typeof buildFromStagedRead>[0]) {
  const built = await buildFromStagedRead(args);
  await built.fillPlaces();
  return built;
}

describe("buildFromStagedRead — places the read could not standardize", () => {
  it("fills a missing standard_place through the resolver", async () => {
    resolver.mockResolvedValue("Schuylkill, Pennsylvania, United States");
    const { tree } = await buildAndFill({
      staged: read([{ type: "Death", place: "Schuylkill Co., PA" }]),
      now: NOW,
    });
    expect(tree.persons[0].facts[0].standard_place).toBe("Schuylkill, Pennsylvania, United States");
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("makes no resolver call when every fact already carries standard_place", async () => {
    await buildAndFill({
      staged: read([{ type: "Birth", place: "Ireland", standard_place: "Ireland" }]),
      now: NOW,
    });
    expect(resolver).not.toHaveBeenCalled();
  });

  it("leaves the fact as it was when the resolver finds nothing", async () => {
    resolver.mockResolvedValue(null);
    const { tree } = await buildAndFill({
      staged: read([{ type: "Death", place: "Same Place" }]),
      now: NOW,
    });
    expect("standard_place" in tree.persons[0].facts[0]).toBe(false);
    expect(tree.persons[0].facts[0].place).toBe("Same Place");
  });
});

describe("buildFromStagedRead — the place retry's time budget", () => {
  it("refuses a bad addition before the retry, without waiting on a hanging resolver", async () => {
    resolver.mockImplementation(() => new Promise(() => {}));
    await expect(
      buildFromStagedRead({
        staged: read([{ type: "Death", place: "Hanging Place" }]),
        additions: { relationships: [{ type: "ParentChild", parent: "NOPE-000", child: "LZNY-BRF" }] },
        now: NOW,
      }),
    ).rejects.toThrow(/neither a FamilySearch ID/);
    expect(resolver).not.toHaveBeenCalled();
  }, 5_000);

  it("does not run the retry during the build itself", async () => {
    resolver.mockResolvedValue("Somewhere");
    const built = await buildFromStagedRead({ staged: read([{ type: "Death", place: "Later Place" }]), now: NOW });
    expect(resolver).not.toHaveBeenCalled();
    await built.fillPlaces();
    expect(built.tree.persons[0].facts[0].standard_place).toBe("Somewhere");
  });

  it("retries only the read's facts, never an addition's", async () => {
    resolver.mockResolvedValue("Somewhere");
    const { tree } = await buildAndFill({
      staged: read([]),
      additions: { persons: [{ id: "A1", gender: "Unknown", names: [{ given: "", surname: "X" }], facts: [{ type: "Birth", place: "Typed Place" }] }] },
      now: NOW,
    });
    expect(resolver).not.toHaveBeenCalled();
    expect("standard_place" in tree.persons[1].facts[0]).toBe(false);
  });

  it("returns within the budget when the resolver hangs, keeping the place unresolved", async () => {
    vi.useFakeTimers();
    try {
      resolver.mockImplementation(() => new Promise(() => {}));
      const built = buildAndFill({ staged: read([{ type: "Death", place: "Hanging Place" }]), now: NOW });
      await vi.advanceTimersByTimeAsync(21_000);
      const { tree } = await built;
      expect("standard_place" in tree.persons[0].facts[0]).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  }, 5_000);

  it("never lets an answer that arrives after the budget land on the returned tree", async () => {
    vi.useFakeTimers();
    try {
      let answer: (v: string) => void = () => {};
      resolver.mockImplementation(() => new Promise<string>((r) => { answer = r; }));
      const built = buildAndFill({ staged: read([{ type: "Death", place: "Slow Place" }]), now: NOW });
      await vi.advanceTimersByTimeAsync(21_000);
      const { tree } = await built;
      answer("Slow Place, Somewhere");
      await vi.runAllTimersAsync();
      expect("standard_place" in tree.persons[0].facts[0]).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  }, 5_000);
});

describe("accessDate", () => {
  it("renders the Evidence Explained access-date form in UTC", () => {
    expect(accessDate(new Date("2026-10-01T23:30:00Z"))).toBe("1 October 2026");
    expect(accessDate(new Date("2026-01-09T00:00:00Z"))).toBe("9 January 2026");
  });
});

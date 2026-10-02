import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

/**
 * `person_read` must hand the relatives fetch the SHARED budget, not a fresh one.
 *
 * WHY A SEPARATE FILE. The bound is an argument passed from the tool to the module, so
 * seeing it requires mocking `relative-sources.js` — which `person-read.test.ts` cannot
 * do, because it exercises the real one. Review proved the gap: replacing `deadline`
 * with `Date.now() + 999_999_999` at the call site left all 102 tests in both files
 * green. `relative-sources.test.ts` proves the module honours whatever deadline it is
 * given; nothing proved the tool gives it the right one, which is the premise of the
 * whole "bounded twice, under the 60s bridge abort" story in its header and the spec.
 */
vi.mock("../../src/utils/relative-sources.js", () => ({
  fetchRelativeSources: vi.fn(async () => ({ descriptions: [], skipped: [] })),
}));
vi.mock("../../src/auth/refresh.js", () => ({ getValidToken: vi.fn() }));

import { fetchRelativeSources } from "../../src/utils/relative-sources.js";
import { getValidToken } from "../../src/auth/refresh.js";
import { personReadTool } from "../../src/tools/person-read.js";
import { LOCAL } from "../../src/auth/principal.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);
const mockedFetchRelatives = vi.mocked(fetchRelativeSources);

/** Advanced by the mocked tree read so elapsed time is observable. */
let clockOffset = 0;
const realNow = Date.now.bind(Date);
vi.spyOn(Date, "now").mockImplementation(() => realNow() + clockOffset);

// `Date.now` is a shared global and the last test leaves the offset at 20s. File
// isolation contains that today; this keeps it contained if `isolate` ever changes.
afterAll(() => {
  vi.mocked(Date.now).mockRestore();
});

/** Mirrors `OCR_PHASE_BUDGET_MS` in person-read.ts. */
const OCR_PHASE_BUDGET_MS = 40_000;

beforeEach(() => {
  clockOffset = 0;
  mockFetch.mockReset();
  mockedFetchRelatives.mockClear();
  vi.mocked(getValidToken).mockResolvedValue("test-token");
});

function treeBody() {
  return {
    persons: [
      {
        id: "SUBJ-001",
        living: true,
        names: [{ nameForms: [{ fullText: "Ann Subject" }] }],
        sources: [{ description: "#OWN-1", descriptionId: "OWN-1" }],
      },
      {
        id: "KID-0001",
        living: false,
        gender: { type: "http://gedcomx.org/Female" },
        names: [{ nameForms: [{ fullText: "Bea Child" }] }],
        sources: [
          {
            description: "https://api.familysearch.org/platform/sources/descriptions/REL-9AA",
            descriptionId: "REL-9AA",
          },
        ],
      },
    ],
    childAndParentsRelationships: [
      { parent1: { resourceId: "SUBJ-001" }, child: { resourceId: "KID-0001" } },
    ],
    sourceDescriptions: [{ id: "OWN-1", titles: [{ value: "Her own" }] }],
  };
}

describe("person_read hands the relatives fetch the shared budget", () => {
  /**
   * THE CLOCK HAS TO MOVE, or this file cannot see the bug that matters.
   *
   * An earlier version caught only `Date.now() + 999_999_999`. It did NOT catch the
   * realistic defect — a fresh `Date.now() + OCR_PHASE_BUDGET_MS` anchored at the call
   * site, AFTER the tree read. With an instant mocked fetch, that second budget lands
   * within milliseconds of the first, so every assertion passed; review made exactly
   * that edit and all 2580 tool tests stayed green.
   *
   * Advancing the clock inside the tree-read mock is what separates them: a deadline
   * anchored at entry stays one budget from `before`, while one anchored after the read
   * is a budget PLUS the elapsed 20s.
   */
  function mockTreeReadTaking(ms: number): void {
    mockFetch.mockImplementationOnce(async () => {
      clockOffset += ms;
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve(treeBody()),
        headers: new Headers(),
      };
    });
  }

  it("anchors the deadline at ENTRY, not after the tree read", async () => {
    const before = Date.now();
    mockTreeReadTaking(20_000);
    await personReadTool({ personId: "SUBJ-001" }, LOCAL);

    expect(mockedFetchRelatives).toHaveBeenCalledTimes(1);
    const deadline = mockedFetchRelatives.mock.calls[0][2] as number;
    expect(typeof deadline).toBe("number");
    // Entry-anchored: ~40s from `before`. Anchored after a 20s read: ~60s, which this
    // rejects. The 5s tolerance absorbs scheduling, not a whole phase.
    //
    // ONE-SIDED ON PURPOSE. A tighter sub-budget — `Math.min(deadline, now + 10s)` —
    // is legitimate: it cannot outlive the shared deadline, which is the whole property.
    // An equality bound here rejected that variant, so the floor that actually matters
    // (the phase must get usable time, not an expired deadline) is the next test's
    // `remaining > 0`, where it belongs.
    expect(deadline - before).toBeLessThan(OCR_PHASE_BUDGET_MS + 5_000);
  });

  it("gives the relatives phase what is LEFT of the budget, not a fresh one", async () => {
    // The same property stated from the consumer's side: after 20s of tree read, the
    // relatives phase must see ~20s remaining, never a full 40s.
    mockTreeReadTaking(20_000);
    await personReadTool({ personId: "SUBJ-001" }, LOCAL);
    const deadline = mockedFetchRelatives.mock.calls[0][2] as number;
    const remaining = deadline - Date.now();
    expect(remaining).toBeLessThan(OCR_PHASE_BUDGET_MS - 10_000);
    expect(remaining).toBeGreaterThan(0);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

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

/** Mirrors `OCR_PHASE_BUDGET_MS` in person-read.ts. */
const OCR_PHASE_BUDGET_MS = 40_000;

beforeEach(() => {
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
  it("passes a deadline no later than the one anchored for the whole read", async () => {
    const before = Date.now();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(treeBody()),
      headers: new Headers(),
    });
    await personReadTool({ personId: "SUBJ-001" }, LOCAL);

    expect(mockedFetchRelatives).toHaveBeenCalledTimes(1);
    const deadline = mockedFetchRelatives.mock.calls[0][2] as number;
    expect(typeof deadline).toBe("number");
    // ONE budget from entry, within a tolerance for the few ms between `before` and
    // the anchor inside the tool. The tolerance is wide enough to be stable and far
    // narrower than the things it must reject: a second budget would land a whole
    // OCR_PHASE_BUDGET_MS beyond, and an unbounded value further still.
    const TOLERANCE_MS = 5_000;
    expect(deadline - before).toBeGreaterThan(OCR_PHASE_BUDGET_MS - TOLERANCE_MS);
    expect(deadline - before).toBeLessThan(OCR_PHASE_BUDGET_MS + TOLERANCE_MS);
  });

  it("is the SAME deadline the memories phase shares, not a second one", async () => {
    // The budget covers the fan-out, memories and this together. Two independent
    // budgets would let the read run to twice the bound the 60s bridge abort assumes.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(treeBody()),
      headers: new Headers(),
    });
    const before = Date.now();
    await personReadTool({ personId: "SUBJ-001" }, LOCAL);
    const deadline = mockedFetchRelatives.mock.calls[0][2] as number;
    // Within the budget window anchored at entry — a per-phase budget would sit a
    // full OCR_PHASE_BUDGET_MS beyond it.
    expect(deadline - before).toBeLessThan(OCR_PHASE_BUDGET_MS + 5_000);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// The server binds the caller's catalog loader into research_log_append
// (§8.7). The stub stands in for FamilySearch, so this checks the binding, not
// the network.
vi.mock("../../src/tools/collections-search.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/tools/collections-search.js")>();
  return {
    ...actual,
    collectionCatalogLoader: () => async () =>
      new Map([
        ["2036959", { personCount: 6, recordCount: 0, imageCount: 4302124, title: "Mississippi, Probate Records, 1781-1930" }],
      ]),
  };
});

// record_search runs offline here: a token, no place expansion, and one empty
// search answer.
vi.mock("../../src/auth/refresh.js", () => ({ getValidToken: vi.fn().mockResolvedValue("test-token") }));
vi.mock("../../src/utils/place-resolver.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/utils/place-resolver.js")>()),
  resolveStandardPlace: vi.fn().mockResolvedValue(null),
  placeSearchNames: vi.fn().mockResolvedValue(null),
}));
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { callTool } from "../helpers/call-tool.js";

describe("through the server: the browse-only check is bound (§8.7)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "log-append-dispatch-"));
    const research = {
      project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01" },
      questions: [],
      plans: [],
      log: [],
      sources: [],
      assertions: [],
      person_evidence: [],
      conflicts: [],
      hypotheses: [],
      timelines: [],
      proof_summaries: [],
      evaluations: [],
    };
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2), "utf-8");
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify({ persons: [], relationships: [], sources: [] }), "utf-8");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("refuses a capture of a FamilySearch name search pinned to a browse-only collection", async () => {
    const url = "https://www.familysearch.org/search/record/results?q.surname=Holliday&f.collectionId=2036959";
    const r = await callTool("research_log_append", {
      projectPath: dir,
      tool: "external_site",
      query: { url },
      outcome: "negative",
      resultsExamined: 0,
      planItemId: null,
      externalSite: { site: "familysearch_web", urlGenerated: url, captureReceived: true, captureFilename: "Holliday.pdf" },
    });
    expect(r.text).toContain("browse-only");
    const research = JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));
    expect(research.log).toHaveLength(0);
  });

  it("record_search does not log its own nil pinned to a browse-only collection", async () => {
    // The unpinned same-name retry is already logged, so only the browse-only
    // rule can stop this write.
    const research = JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));
    research.log.push({
      id: "log_001",
      plan_item_id: null,
      performed: "2026-01-01T00:00:00.000Z",
      tool: "record_search",
      query: { surname: "Holliday", givenName: "Eliza" },
      outcome: "negative",
      results_examined: 0,
      external_site: null,
      results_ref: null,
    });
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2), "utf-8");
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ results: 0, index: 0, entries: [] }),
    });

    const r = await callTool("record_search", {
      surname: "Holliday",
      givenName: "Eliza",
      collectionId: "2036959",
      projectPath: dir,
    });
    expect(r.text).toContain("nilLogRefused");
    expect(r.text).toContain("browse-only");
    const after = JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));
    expect(after.log).toHaveLength(1);
  });
});

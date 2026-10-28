import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { researchLogAppend } from "../../src/tools/research-log-append.js";
import { awaitingUserHandOffs } from "../../src/utils/awaiting-hand-offs.js";
import { fileStoreOnly } from "../helpers/store-backend.js";

// An `external_site` url that names a collection must name one in
// external-collections.json (issue #2995). A url already in the log is not
// re-checked, so a hand-off built before the list existed stays closable.

const STORED_7163 = "https://www.ancestry.com/search/collections/7163/";
const INVENTED_9093 = "https://www.ancestry.com/search/collections/9093/?name=Patrick_Flynn";

function research(log: any[] = []) {
  return {
    project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01" },
    questions: [],
    plans: [],
    log,
    sources: [],
    assertions: [],
    person_evidence: [],
    conflicts: [],
    hypotheses: [],
    timelines: [],
    proof_summaries: [],
    evaluations: [],
  };
}

function stored(urls: string[]) {
  return {
    places: {
      "Pennsylvania, United States": {
        rows: urls.map((url) => ({
          key: url,
          url,
          link_text: "A collection",
          record_types: ["Census"],
          place: "Pennsylvania, United States",
          cost: "",
          content_type: "",
          start_year: "1870",
          end_year: "1870",
        })),
      },
    },
  };
}

function handOff(url: string, captureReceived = false) {
  return {
    tool: "external_site" as const,
    query: { surname: "Flynn" },
    outcome: captureReceived ? "negative" : "partial",
    resultsExamined: 0,
    externalSite: { site: "ancestry", urlGenerated: url, captureReceived },
  };
}

describe("research_log_append: a collection url must be a stored collection", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "log-collection-guard-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function project(log: any[] = [], collections?: unknown | string) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research(log), null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify({ persons: [], relationships: [], sources: [] }));
    if (collections !== undefined) {
      await writeFile(
        join(dir, "external-collections.json"),
        typeof collections === "string" ? collections : JSON.stringify(collections),
      );
    }
  }
  const log = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf-8")).log;

  it("refuses a collection the stored list does not hold, and writes nothing", async () => {
    await project([], stored([STORED_7163]));
    const r = await researchLogAppend({ projectPath: dir, ...handOff(INVENTED_9093) });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toContain("is not in external-collections.json");
    expect(JSON.stringify(r)).toContain("build_external_search_url and no baseUrl");
    expect(await log()).toEqual([]);
  });

  it("accepts a stored collection in another spelling of the same id", async () => {
    await project([], stored([STORED_7163]));
    const r = await researchLogAppend({
      projectPath: dir,
      ...handOff("https://search.ancestry.com/cgi-bin/sse.dll?dbid=7163&gsln=Flynn"),
    });
    expect(r.ok).toBe(true);
    expect(await log()).toHaveLength(1);
  });

  it("accepts a site-wide search with nothing stored", async () => {
    await project();
    const r = await researchLogAppend({
      projectPath: dir,
      ...handOff("https://www.ancestry.com/search/?name=Patrick_Flynn"),
    });
    expect(r.ok).toBe(true);
  });

  it("refuses a collection with nothing stored, naming the fetch", async () => {
    await project();
    const r = await researchLogAppend({ projectPath: dir, ...handOff(INVENTED_9093) });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toContain("nothing is stored");
    expect(JSON.stringify(r)).toContain("external_links_search");
  });

  it("refuses when the stored list cannot be read, naming the re-fetch", async () => {
    fileStoreOnly("a document that is not JSON cannot exist in the Postgres store");
    await project([], "{ not json");
    const r = await researchLogAppend({ projectPath: dir, ...handOff(INVENTED_9093) });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toContain("cannot be checked");
    expect(JSON.stringify(r)).toContain("Re-fetch the place");
  });

  it("checks a stringified externalSite too", async () => {
    await project([], stored([STORED_7163]));
    const op = handOff(INVENTED_9093);
    const r = await researchLogAppend({
      projectPath: dir,
      ...op,
      externalSite: JSON.stringify(op.externalSite) as any,
    });
    expect(r.ok).toBe(false);
  });

  // The hand-off was logged before the list existed (or a re-fetch dropped its
  // collection). Its closing entry logs the same url and must not be refused,
  // or the hand-off stays open for good.
  it("closes an earlier hand-off whose url is not stored", async () => {
    await project([
      {
        id: "log_001",
        plan_item_id: null,
        performed: "2026-01-01T00:00:00.000Z",
        tool: "external_site",
        query: { surname: "Flynn" },
        outcome: "partial",
        results_examined: 0,
        external_site: { site: "ancestry", url_generated: INVENTED_9093, capture_received: false },
        results_ref: null,
      },
    ]);
    expect(awaitingUserHandOffs(await log())).toHaveLength(1);
    const r = await researchLogAppend({ projectPath: dir, ...handOff(INVENTED_9093, true) });
    expect(r.ok).toBe(true);
    expect(awaitingUserHandOffs(await log())).toEqual([]);
  });

  it("reports every refused op in a batch, and writes none of them", async () => {
    await project([], stored([STORED_7163]));
    const r = await researchLogAppend({
      projectPath: dir,
      ops: [handOff(INVENTED_9093), handOff(STORED_7163), handOff("https://www.ancestry.com/search/collections/1234/")],
    } as any);
    expect(r.ok).toBe(false);
    const errors = (r as { errors: string[] }).errors;
    expect(errors.map((e) => e.slice(0, 7))).toEqual(["ops[0]:", "ops[2]:"]);
    expect(await log()).toEqual([]);
  });
});

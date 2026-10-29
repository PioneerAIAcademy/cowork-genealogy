/**
 * `research_append` refuses a `plan_item.collection_url` that is not a stored
 * curated collection (issue #2995, the writer half). The field exists so a plan
 * names a collection FamilySearch actually curates, not one recalled from
 * memory; whether it does is decidable from `external-collections.json` alone,
 * so the rule lives in the tool (ADR-0011), on both routes that write an item:
 * a `plan_items` op and inline `items[]` on a `plans` op.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { researchAppend } from "../../src/tools/research-append.js";
import { fileStoreOnly } from "../helpers/store-backend.js";

let dir: string;

const QUESTION = {
  id: "q_001",
  question: "Who did Anders Monsen marry?",
  status: "open",
  priority: "high",
  created: "2026-01-01",
  rationale: "The marriage is the question under research.",
  selection_basis: "user_directed",
  depends_on: [],
  unblocks: [],
  resolved: null,
  resolution_assertion_ids: [],
  search_stop: { stopped_because: null, log_entry_ids: [], stop_criteria: null, not_reached: [] },
};

function item(over: Record<string, unknown> = {}) {
  return {
    id: "pli_001",
    sequence: 1,
    record_type: "census",
    jurisdiction: "Hordaland, Norway",
    date_range: "1786",
    repository: "FamilySearch",
    rationale: "Why this item was planned.",
    fallback_for: null,
    status: "planned",
    ...over,
  };
}

function seed(items: Record<string, unknown>[]) {
  const research = {
    project: {
      id: "rp_001",
      objective: "Test",
      status: "active",
      created: "2026-01-01",
      updated: "2026-01-01",
    },
    questions: [QUESTION],
    plans: [
      { id: "pl_001", question_id: "q_001", status: "active", created: "2026-01-01", items },
    ],
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
  writeFileSync(join(dir, "research.json"), JSON.stringify(research, null, 2), "utf-8");
  writeFileSync(
    join(dir, "tree.gedcomx.json"),
    JSON.stringify({ persons: [], relationships: [], sources: [] }, null, 2),
    "utf-8",
  );
}

async function update(fields: Record<string, unknown>, entryId = "pli_001") {
  return researchAppend(
    {
      projectPath: dir,
      section: "plan_items",
      op: "update",
      planId: "pl_001",
      entryId,
      fields,
    } as never,
    undefined as never,
  );
}

const STORED = "https://www.ancestry.com/search/collections/7163/";
const INVENTED = "https://www.ancestry.com/search/collections/9093/";

function storeCollections(urls: string[]) {
  const rows = urls.map((url, i) => ({
    key: `k${i}`, url, link_text: "x", record_types: ["Census"], place: "Pennsylvania, United States",
    cost: "paid", content_type: "index", start_year: "", end_year: "",
  }));
  writeFileSync(
    join(dir, "external-collections.json"),
    JSON.stringify({ places: { "Pennsylvania, United States": { rows } } }, null, 2),
    "utf-8",
  );
}

async function run(op: Record<string, unknown>) {
  return researchAppend({ projectPath: dir, ...op } as never, undefined as never);
}

const appendItem = (over: Record<string, unknown>) =>
  run({ section: "plan_items", op: "append", planId: "pl_001", entry: { ...item(), id: undefined, sequence: 2, ...over } });

const storedPlans = () => JSON.parse(readFileSync(join(dir, "research.json"), "utf-8")).plans;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "collurl-"));
  mkdirSync(join(dir, "results"), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("research_append: plan_item.collection_url must be a stored collection", () => {
  it("ACCEPTS a stored url on append (the battery can pass)", async () => {
    seed([item()]);
    storeCollections([STORED]);
    const r = await appendItem({ collection_url: STORED });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(storedPlans()[0].items[1].collection_url).toBe(STORED);
  });

  it("ACCEPTS another spelling of a stored collection, compared by the dedupe key", async () => {
    seed([item()]);
    storeCollections([STORED]);
    for (const spelling of [
      "https://www.ancestry.com/search/collections/7163",
      "https://search.ancestry.com/search/db.aspx?dbid=7163",
      "https://www.ancestry.com/search/collections/7163/?name=Flynn",
    ]) {
      const r = await appendItem({ collection_url: spelling });
      expect(r.ok, `${spelling}: ${JSON.stringify(r)}`).toBe(true);
    }
  });

  it("REFUSES an unstored id in another spelling", async () => {
    seed([item()]);
    storeCollections([STORED]);
    const r = await appendItem({ collection_url: "https://search.ancestry.com/search/db.aspx?dbid=9093" });
    expect(r.ok).toBe(false);
  });

  it("does not check a status update that does not touch collection_url", async () => {
    seed([item({ repository: "Ancestry", collection_url: INVENTED })]);
    const r = await run({ section: "plan_items", op: "update", planId: "pl_001", entryId: "pli_001",
      fields: { status: "in_progress" } });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  it("REFUSES a url that is not stored, and writes nothing", async () => {
    seed([item()]);
    storeCollections([STORED]);
    const before = readFileSync(join(dir, "research.json"), "utf-8");
    const r = await appendItem({ collection_url: INVENTED });
    expect(r.ok).toBe(false);
    const msg = JSON.stringify(r);
    expect(msg).toContain("collection_url");
    expect(msg).toContain("external_collections");
    expect(readFileSync(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  it("REFUSES any url when nothing has been stored", async () => {
    seed([item()]);
    const r = await appendItem({ collection_url: STORED });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toContain("external_links_search");
  });

  it("REFUSES, without throwing, when external-collections.json is malformed", async () => {
    fileStoreOnly("a document that is not JSON cannot exist in the Postgres store");
    seed([item()]);
    writeFileSync(join(dir, "external-collections.json"), "{not json", "utf-8");
    const r = await appendItem({ collection_url: STORED });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toContain("external-collections.json");
  });

  it("checks an update that sets it", async () => {
    seed([item()]);
    storeCollections([STORED]);
    const bad = await run({ section: "plan_items", op: "update", planId: "pl_001", entryId: "pli_001", fields: { collection_url: INVENTED } });
    expect(bad.ok).toBe(false);
    const good = await run({ section: "plan_items", op: "update", planId: "pl_001", entryId: "pli_001", fields: { collection_url: STORED } });
    expect(good.ok, JSON.stringify(good)).toBe(true);
  });

  it("does not re-check a url an item already had, when a plans update re-sends items whole", async () => {
    // A url stored before a re-fetch dropped its row must not strand the plan:
    // re-sending items[] (to add one) carries the old url through unchanged.
    seed([item({ collection_url: INVENTED })]);
    storeCollections([STORED]);
    const r = await run({ section: "plans", op: "update", entryId: "pl_001",
      fields: { items: [item({ collection_url: INVENTED }), item({ id: "pli_002", sequence: 2 })] } });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  it("does not re-check a plan_items update that re-sends the same url", async () => {
    seed([item({ collection_url: INVENTED })]);
    storeCollections([STORED]);
    const r = await run({ section: "plan_items", op: "update", planId: "pl_001", entryId: "pli_001",
      fields: { collection_url: INVENTED, status: "in_progress" } });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  it("REFUSES an unstored url on a COMPLETED item re-sent whole by a plans update, and keeps its own url", async () => {
    seed([item({ status: "completed", collection_url: STORED })]);
    storeCollections([STORED]);
    const bad = await run({ section: "plans", op: "update", entryId: "pl_001",
      fields: { items: [item({ status: "completed", collection_url: INVENTED })] } });
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(bad)).toContain("collection_url");
    const same = await run({ section: "plans", op: "update", entryId: "pl_001",
      fields: { items: [item({ status: "completed", collection_url: STORED }), item({ id: "pli_002", sequence: 2 })] } });
    expect(same.ok, JSON.stringify(same)).toBe(true);
  });

  it("REFUSES an unstored url on an inline item of a plans update", async () => {
    seed([item()]);
    storeCollections([STORED]);
    const r = await run({ section: "plans", op: "update", entryId: "pl_001",
      fields: { items: [{ ...item(), collection_url: INVENTED }] } });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toContain("collection_url");
  });

  it("ACCEPTS a stored url on an inline item of a plans update", async () => {
    seed([item()]);
    storeCollections([STORED]);
    const r = await run({ section: "plans", op: "update", entryId: "pl_001",
      fields: { items: [{ ...item(), collection_url: STORED }] } });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });
});

describe("research_append: an external item appended without collection_url lists the stored collections that fit", () => {
  const ancestryItem = (over: Record<string, unknown> = {}) => ({
    repository: "Ancestry",
    record_type: "census",
    jurisdiction: "Schuylkill County, Pennsylvania",
    date_range: "1870",
    ...over,
  });
  const warningsOf = (r: unknown) => {
    const x = r as { warnings?: string[]; validation?: { warnings?: string[] } };
    return [...(x.warnings ?? []), ...(x.validation?.warnings ?? [])].filter((w) => w.includes("collection_url"));
  };

  it("warns, naming the stored url, when an Ancestry census item is appended without one", async () => {
    seed([item()]);
    storeCollections([STORED]);
    const r = await appendItem(ancestryItem());
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const w = warningsOf(r);
    expect(w, JSON.stringify(r)).toHaveLength(1);
    expect(w[0]).toContain(STORED);
    expect(w[0]).toMatch(/leave it off for a site-wide search/);
  });

  it("warns for an inline item of a plans append too", async () => {
    seed([item()]);
    const research = JSON.parse(readFileSync(join(dir, "research.json"), "utf-8"));
    research.questions.push({ ...research.questions[0], id: "q_002" });
    writeFileSync(join(dir, "research.json"), JSON.stringify(research, null, 2), "utf-8");
    storeCollections([STORED]);
    const r = await run({ section: "plans", op: "append", entry: {
      question_id: "q_002", status: "active", created: "2026-01-02",
      items: [{ ...item(), id: "pli_010", ...ancestryItem() }],
    } });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(warningsOf(r)).toHaveLength(1);
  });

  it("stays quiet with a collection_url, for FamilySearch, on an update, or when nothing stored fits", async () => {
    seed([item()]);
    storeCollections([STORED]);
    expect(warningsOf(await appendItem(ancestryItem({ collection_url: STORED })))).toEqual([]);
    expect(warningsOf(await appendItem(ancestryItem({ repository: "FamilySearch" })))).toEqual([]);
    expect(warningsOf(await appendItem(ancestryItem({ record_type: "probate" })))).toEqual([]);
    expect(warningsOf(await appendItem(ancestryItem({ jurisdiction: "Hordaland, Norway" })))).toEqual([]);
    expect(warningsOf(await run({ section: "plan_items", op: "update", planId: "pl_001", entryId: "pli_001",
      fields: { status: "in_progress" } }))).toEqual([]);
  });

  it("stays quiet when nothing is stored at all", async () => {
    seed([item()]);
    const r = await appendItem(ancestryItem());
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(warningsOf(r)).toEqual([]);
  });
});

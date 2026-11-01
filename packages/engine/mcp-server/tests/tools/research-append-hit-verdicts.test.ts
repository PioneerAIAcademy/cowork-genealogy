import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { researchAppend, researchAppendFromCaller } from "../../src/tools/research-append.js";
import { researchQuery } from "../../src/tools/research-query.js";
import { validateIntroduced } from "../../src/validation/introduced-errors.js";

// The `hit_verdicts` section (#3522): research_append checks the hit against
// the search that returned it, stores its id once per person, and refuses the
// two flag combinations decidable from the documents. End to end.

const HITS = {
  christening: "ark:/61903/3:1:3Q9M-CSK3-ZSLR",
  marriage: "ark:/61903/3:1:3Q9M-CSK3-ZSH4",
  extracted: "ark:/61903/3:1:3QS7-99WC-KLYK",
};

const fulltextLog = (id: string, resultsRef: string | null) => ({
  id,
  plan_item_id: null,
  performed: "2026-10-29T00:00:00Z",
  tool: "fulltext_search",
  query: { text: "Jackson" },
  outcome: "positive",
  results_examined: 3,
  results_ref: resultsRef,
  results_available: 3,
  notes: null,
  external_site: null,
});

function research(): any {
  return {
    project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01", subject_person_ids: ["I1"] },
    questions: [],
    plans: [],
    log: [
      fulltextLog("log_001", "results/log_001.json"),
      { ...fulltextLog("log_002", "results/log_002.json"), tool: "record_search", query: { surname: "Jackson" } },
      fulltextLog("log_003", null),
    ],
    sources: [
      {
        id: "src_001",
        gedcomx_source_description_id: "S1",
        citation: "Full-text hit 3QS7-99WC-KLYK",
        citation_detail: {
          who: "Clerk", what: "Deed", when_created: "1821", when_accessed: "2026-10-29", where: "Jackson", where_within: "page 1",
        },
        source_classification: "derivative",
        repository: "FamilySearch",
        access_date: "2026-10-29",
      },
    ],
    // Resolver-URL form on purpose: the hit ids are bare ARKs.
    assertions: [
      {
        id: "a_001", source_id: "src_001", record_id: `https://www.familysearch.org/${HITS.extracted}`,
        record_role: "principal", fact_type: "name", value: "John Jackson", information_quality: "primary",
        informant: "clerk", informant_proximity: "official_duty", record_basis: "stated", extracted_for_question_ids: [],
      },
    ],
    person_evidence: [],
    conflicts: [],
    hypotheses: [],
    timelines: [],
    proof_summaries: [],
    evaluations: [],
  };
}

const tree = {
  persons: [
    { id: "I1", gender: "Male", names: [{ id: "N1", given: "John", surname: "Jackson" }] },
    { id: "I2", gender: "Female", names: [{ id: "N2", given: "Mary", surname: "Robertson" }] },
  ],
  relationships: [],
  sources: [{ id: "S1", title: "Deed" }],
};

const sidecar = (logId: string, tool: string, results: unknown[]) => ({
  log_id: logId,
  tool,
  retrieved: "2026-10-29T00:00:00Z",
  returned_count: results.length,
  payload: { results },
});

const entry = (extra: Record<string, unknown> = {}) => ({
  log_id: "log_001",
  hit_id: HITS.christening,
  target_person_id: "I1",
  verdict: "match",
  new_vital_info: false,
  rationale: "Names John Jackson of the right parish and decade.",
  ...extra,
});

describe("research_append — hit_verdicts", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "research-append-hv-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function write(r: any = research()) {
    await writeFile(join(dir, "research.json"), JSON.stringify(r, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree, null, 2));
    await mkdir(join(dir, "results"), { recursive: true });
    await writeFile(
      join(dir, "results", "log_001.json"),
      JSON.stringify(
        sidecar("log_001", "fulltext_search", [
          { id: HITS.christening, title: "Christenings", textDocument: "Christina, daughter of John Jackson" },
          { id: HITS.marriage, title: "Marriages", textDocument: "John Jackson m. Mary Robertson 1820" },
          { id: HITS.extracted, title: "Deeds", textDocument: "John Jackson, grantor" },
        ]),
        null,
        2,
      ),
    );
    await writeFile(
      join(dir, "results", "log_002.json"),
      JSON.stringify(sidecar("log_002", "record_search", [{ recordId: "ark:/61903/1:1:ABCD-123" }]), null, 2),
    );
  }
  const readResearch = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));
  const append = (e: Record<string, unknown>) =>
    researchAppendFromCaller({ projectPath: dir, section: "hit_verdicts", op: "append", entry: e } as any);
  const update = (entryId: string, fields: Record<string, unknown>) =>
    researchAppendFromCaller({ projectPath: dir, section: "hit_verdicts", op: "update", entryId, fields } as any);
  const errorsOf = (r: any): string => (r.ok ? "" : (r.errors as string[]).join("\n"));

  // ── the hit is a hit of that search, stored in its stored form ──

  it("rewrites hit_id to the sidecar's stored form", async () => {
    await write();
    const spellings: Array<[string, string]> = [
      ["3Q9M-CSK3-ZSLR", "I1"],
      [`https://www.familysearch.org/${HITS.christening}`, "I2"],
    ];
    for (const [hitId, person] of spellings) {
      const r: any = await append(entry({ hit_id: hitId, target_person_id: person }));
      expect(r.ok, errorsOf(r)).toBe(true);
    }
    const rows = (await readResearch()).hit_verdicts;
    expect(rows.map((h: any) => h.hit_id)).toEqual([HITS.christening, HITS.christening]);
    expect(rows.map((h: any) => h.id)).toEqual(["hv_001", "hv_002"]);
    expect(rows[0].created).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("refuses a hit the search did not return, and writes nothing", async () => {
    await write();
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const r = await append(entry({ hit_id: "ark:/61903/3:1:3Q9M-0000-0000" }));
    expect(r.ok).toBe(false);
    expect(errorsOf(r)).toContain("log_001's results hold no hit 'ark:/61903/3:1:3Q9M-0000-0000' (3 hits)");
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  it("refuses a log entry that is not a full-text search", async () => {
    await write();
    const r = await append(entry({ log_id: "log_002" }));
    expect(r.ok).toBe(false);
    expect(errorsOf(r)).toContain("log_id 'log_002' is a record_search entry");
  });

  it("refuses a full-text search that retained no results", async () => {
    await write();
    const r = await append(entry({ log_id: "log_003" }));
    expect(r.ok).toBe(false);
    expect(errorsOf(r)).toContain("results_ref is null");
  });

  it("refuses a blank or empty hit_id", async () => {
    await write();
    for (const hitId of ["  ", ""]) {
      const r = await append(entry({ hit_id: hitId }));
      expect(r.ok, JSON.stringify(hitId)).toBe(false);
    }
    expect((await readResearch()).hit_verdicts).toBeUndefined();
  });

  it("refuses a log id that names no entry", async () => {
    await write();
    const r = await append(entry({ log_id: "log_099" }));
    expect(r.ok).toBe(false);
    expect(errorsOf(r)).toContain("log_id 'log_099' names no log entry");
  });

  // ── one row per hit and person ──

  it("folds a second append for the same hit and person into an update of the first", async () => {
    await write();
    expect((await append(entry())).ok).toBe(true);
    const first = (await readResearch()).hit_verdicts[0];
    const r: any = await append(
      entry({ hit_id: "3Q9M-CSK3-ZSLR", verdict: "possible_match", rationale: "Second look: the parish is a guess.", created: "2030-01-01" }),
    );
    expect(r.ok, errorsOf(r)).toBe(true);
    expect(r).toMatchObject({ section: "hit_verdicts", op: "update", entryId: "hv_001" });
    expect(r.validation.warnings.join("\n")).toContain("already has a verdict on 'I1' (hv_001); this append updated it");
    const rows = (await readResearch()).hit_verdicts;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      ...first,
      verdict: "possible_match",
      rationale: "Second look: the parish is a guess.",
    });
  });

  it.each([
    ["new_vital_info", { verdict: "possible_match", rationale: "Second look: the parish is a guess." }],
    ["rationale", { verdict: "not_a_match", new_vital_info: false }],
    ["verdict", { new_vital_info: false, rationale: "Second look." }],
  ])("refuses a folding append missing %s, and leaves the stored row as it was", async (field, judgement) => {
    await write();
    expect((await append(entry({ new_vital_info: true }))).ok).toBe(true);
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const { log_id, hit_id, target_person_id } = entry();
    const r = await append({ log_id, hit_id, target_person_id, ...judgement });
    expect(r.ok).toBe(false);
    const refusals = (r as any).errors.filter((e: string) => !e.startsWith("worked example"));
    expect(refusals).toEqual([`missing required field '${field}'`]);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  it("refuses a folding append in a batch by its op index, writing nothing", async () => {
    await write();
    expect((await append(entry())).ok).toBe(true);
    const before = await readFile(join(dir, "research.json"), "utf-8");
    const r = await researchAppendFromCaller({
      projectPath: dir,
      ops: [
        { section: "hit_verdicts", op: "append", entry: entry({ hit_id: HITS.marriage }) },
        { section: "hit_verdicts", op: "append", entry: { log_id: "log_001", hit_id: HITS.christening, target_person_id: "I1" } },
      ],
    } as any);
    expect(r.ok).toBe(false);
    expect(errorsOf(r)).toBe(
      ["verdict", "new_vital_info", "rationale"].map((f) => `ops[1]: missing required field '${f}'`).join("\n"),
    );
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(before);
  });

  it("blocks a duplicate key a write introduces, and lets a hand-edited one ride an unrelated write", async () => {
    const stored = (id: string, extra: Record<string, unknown> = {}) => ({ id, ...entry(extra), created: "2026-10-29" });
    const one = research();
    one.hit_verdicts = [stored("hv_001")];
    const two = research();
    two.hit_verdicts = [stored("hv_001"), stored("hv_002", { hit_id: "3Q9M-CSK3-ZSLR", verdict: "not_a_match" })];
    const introduced = await validateIntroduced({ research: one, tree }, { research: two, tree });
    expect(introduced.valid).toBe(false);
    expect(introduced.errors.map((e) => e.message)).toEqual([
      "hit verdict 'hv_002' judges the same hit of log_001 against the same person as 'hv_001' — " +
        "one row per (log_id, hit_id, target_person_id); an append for a judged hit updates its row",
    ]);

    await write(two);
    const r: any = await append(entry({ hit_id: HITS.marriage }));
    expect(r.ok, errorsOf(r)).toBe(true);
    expect(r.validation.warnings.join("\n")).toContain("1 pre-existing schema error(s) not caused by this call");
  });

  it("reports a folded append in a batch as an update", async () => {
    await write();
    expect((await append(entry())).ok).toBe(true);
    const r: any = await researchAppendFromCaller({
      projectPath: dir,
      ops: [
        { section: "hit_verdicts", op: "append", entry: entry({ verdict: "not_a_match" }) },
        { section: "hit_verdicts", op: "append", entry: entry({ hit_id: HITS.marriage }) },
      ],
    } as any);
    expect(r.ok, errorsOf(r)).toBe(true);
    expect(r.results).toEqual([
      { section: "hit_verdicts", op: "update", entryId: "hv_001" },
      { section: "hit_verdicts", op: "append", entryId: "hv_002" },
    ]);
  });

  it("keeps one row per person: the same hit judged against another person is a new row", async () => {
    await write();
    expect((await append(entry())).ok).toBe(true);
    const r: any = await append(entry({ target_person_id: "I2", verdict: "not_a_match" }));
    expect(r).toMatchObject({ ok: true, op: "append", entryId: "hv_002" });
  });

  it("refuses two verdicts on one hit and person in one call", async () => {
    await write();
    const r = await researchAppendFromCaller({
      projectPath: dir,
      ops: [
        { section: "hit_verdicts", op: "append", entry: entry() },
        { section: "hit_verdicts", op: "append", entry: entry({ hit_id: "3Q9M-CSK3-ZSLR" }) },
      ],
    } as any);
    expect(r.ok).toBe(false);
    expect(errorsOf(r)).toContain("ops[1]: ops[0] already judges hit");
  });

  it("refuses an append carrying an id, even one that would fold", async () => {
    await write();
    expect((await append(entry())).ok).toBe(true);
    for (const id of ["hv_001", "hv_009"]) {
      const r = await append(entry({ id, verdict: "possible_match" }));
      expect(r.ok, id).toBe(false);
      expect(errorsOf(r)).toContain("must not carry an id");
    }
    expect((await readResearch()).hit_verdicts[0].verdict).toBe("match");
  });

  it("refuses an update that re-points what a verdict judged", async () => {
    await write();
    expect((await append(entry())).ok).toBe(true);
    for (const fields of [{ log_id: "log_002" }, { hit_id: HITS.marriage }, { target_person_id: "I2" }, { created: "2030-01-01" }]) {
      const r = await update("hv_001", fields);
      expect(r.ok, JSON.stringify(fields)).toBe(false);
      expect(errorsOf(r)).toContain("field(s) not updatable on 'hit_verdicts'");
    }
    const ok: any = await update("hv_001", { verdict: "possible_match", new_vital_info: true, rationale: "Possibly him." });
    expect(ok.ok, errorsOf(ok)).toBe(true);
  });

  // ── the two write-time preconditions ──

  it("refuses new_vital_info on a not_a_match append", async () => {
    await write();
    const r = await append(entry({ verdict: "not_a_match", new_vital_info: true }));
    expect(r.ok).toBe(false);
    expect(errorsOf(r)).toContain("new_vital_info is true on a not_a_match verdict");
  });

  it("refuses an update flipping a flagged row to not_a_match", async () => {
    await write();
    expect((await append(entry({ new_vital_info: true }))).ok).toBe(true);
    const r = await update("hv_001", { verdict: "not_a_match" });
    expect(r.ok).toBe(false);
    expect(errorsOf(r)).toContain("new_vital_info is true on a not_a_match verdict ('hv_001')");
  });

  it("refuses new_vital_info on a hit an assertion already cites, on an append and on an update", async () => {
    await write();
    const r = await append(entry({ hit_id: HITS.extracted, new_vital_info: true }));
    expect(r.ok).toBe(false);
    expect(errorsOf(r)).toContain(`hit '${HITS.extracted}' is already extracted (assertion 'a_001' cites it)`);

    expect((await append(entry({ hit_id: HITS.extracted }))).ok).toBe(true);
    const u = await update("hv_001", { new_vital_info: true });
    expect(u.ok).toBe(false);
    expect(errorsOf(u)).toContain("is already extracted");
  });

  it("refuses new_vital_info on an extracted hit when the append folds", async () => {
    await write();
    expect((await append(entry({ hit_id: HITS.extracted }))).ok).toBe(true);
    const r = await append(entry({ hit_id: HITS.extracted, new_vital_info: true }));
    expect(r.ok).toBe(false);
    expect(errorsOf(r)).toContain("is already extracted");
  });

  it.each([
    ["possible_match", true, HITS.marriage],
    ["match", true, HITS.christening],
    ["not_a_match", false, HITS.christening],
    ["match", false, HITS.extracted],
  ])("accepts verdict %s with new_vital_info %s", async (verdict, flag, hitId) => {
    await write();
    const r: any = await append(entry({ verdict, new_vital_info: flag, hit_id: hitId }));
    expect(r.ok, errorsOf(r)).toBe(true);
  });

  it("leaves a stored true flag alone when its hit is extracted later, and checks only ops that touch the pair", async () => {
    const r0 = research();
    r0.hit_verdicts = [{ id: "hv_001", ...entry({ hit_id: HITS.extracted, new_vital_info: true }), created: "2026-10-29" }];
    await write(r0);
    const r: any = await update("hv_001", { rationale: "Reworded." });
    expect(r.ok, errorsOf(r)).toBe(true);
  });

  // ── reads ──

  it("research_query serves the section, filtered by the target person", async () => {
    await write();
    expect((await append(entry())).ok).toBe(true);
    expect((await append(entry({ target_person_id: "I2", verdict: "not_a_match" }))).ok).toBe(true);
    const r: any = await researchQuery({ projectPath: dir, section: "hit_verdicts", personId: "I2" } as any);
    expect(r.count).toBe(1);
    expect(r.items[0]).toMatchObject({ id: "hv_002", target_person_id: "I2" });
  });

  it("research_query answers count 0 on a project with no hit_verdicts key", async () => {
    await write();
    const r: any = await researchQuery({ projectPath: dir, section: "hit_verdicts" } as any);
    expect(r).toMatchObject({ count: 0, items: [] });
  });

  it("researchAppend writes the section as its MCP caller does", async () => {
    await write();
    const r: any = await researchAppend({ projectPath: dir, section: "hit_verdicts", op: "append", entry: entry() } as any);
    expect(r.ok, errorsOf(r)).toBe(true);
  });
});

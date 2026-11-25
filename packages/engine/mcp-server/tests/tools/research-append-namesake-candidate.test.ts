import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "fs/promises";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { researchAppend } from "../../src/tools/research-append.js";
import { getProjectStore } from "../../src/store/project-store.js";
import { readProjectJson } from "../../src/utils/project-io.js";
import { candidateExclusionRefusal, namesakeCandidateRefusals } from "../../src/utils/candidate-exclusion.js";

// Issue #4580: a namesake row may not drop a candidate a search for its person
// returned on nothing but the candidate's birth year. The project is the real
// ut_search_records_035 scenario, whose log_001 returned Antoine Tyler (b. 1833)
// for I1 (b. 1853).

const SCENARIO = resolve(__dirname, "../../../../../eval/fixtures/scenarios/tyler-fluvanna-midwife-1870-candidate");
const FILES = ["research.json", "tree.gedcomx.json", "results/log_001.json"];

/** A fresh project holding the scenario, written through the project store. */
async function seedScenario(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  for (const f of FILES) {
    await getProjectStore().writeJson(dir, f, JSON.parse(await readFile(join(SCENARIO, f), "utf-8")));
  }
  return dir;
}
const ANTOINE = "ark:/61903/1:1:MFLB-F5N";

const row = (person_id: string, record_ids: string[]) => ({
  person_id,
  name: "Antoine Tyler",
  place: "Cunningham, Fluvanna, Virginia",
  time_period: "1870",
  record_ids,
  log_entry_ids: ["log_001"],
  notes: "Born 1833, twenty years before the subject.",
});

describe("research_append: a namesake row may not name a candidate on its birth year alone (#4580)", () => {
  let dir: string;
  const errs = (r: any) => (r.ok ? "" : JSON.stringify(r.errors));
  const readResearch = () => readProjectJson(dir, "research.json");

  beforeEach(async () => {
    dir = await seedScenario("ns-candidate-");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("refuses a row for I1 naming Antoine, writes nothing, and leaves the range refusal standing", async () => {
    const r = await researchAppend({ projectPath: dir, section: "namesakes", op: "append", entry: row("I1", [ANTOINE]) } as any);
    expect(r.ok).toBe(false);
    expect(errs(r)).toMatch(/names a candidate a search for 'I1' returned: Antoine Tyler \(ark:\/61903\/1:1:MFLB-F5N\), born 1833, from log_001/);
    expect(errs(r)).toMatch(/needs-review/);
    expect((await readResearch()).namesakes ?? []).toEqual([]);
    expect(await candidateExclusionRefusal({ projectPath: dir, subjectId: "I1", birthYearFrom: 1848, birthYearTo: 1858 })).not.toBeNull();
  });

  it("refuses the same row in a batch beside an op that would succeed", async () => {
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "plan_items", op: "update", planId: "pl_001", entryId: "pli_002", fields: { status: "in_progress" } },
        { section: "namesakes", op: "append", entry: row("I1", [ANTOINE]) },
      ],
    } as any);
    expect(r.ok).toBe(false);
    expect(errs(r)).toMatch(/names a candidate a search for 'I1' returned/);
  });

  it("names the row among every failure when another op of the batch fails too", async () => {
    const r = await researchAppend({
      projectPath: dir,
      ops: [
        { section: "plan_items", op: "update", planId: "pl_001", entryId: "pli_999", fields: { status: "in_progress" } },
        { section: "namesakes", op: "append", entry: row("I1", [ANTOINE]) },
      ],
    } as any);
    expect(r.ok).toBe(false);
    expect(errs(r)).toMatch(/pli_999/);
    expect(errs(r)).toMatch(/names a candidate a search for 'I1' returned/);
  });

  it("does not re-judge a standing row that already names Antoine when only its notes change", async () => {
    const research: any = await readResearch();
    research.namesakes = [{ id: "ns_001", ...row("I1", [ANTOINE]), created: "2026-11-25" }];
    await getProjectStore().writeJson(dir, "research.json", research);
    const r = await researchAppend({
      projectPath: dir, section: "namesakes", op: "update", entryId: "ns_001", fields: { notes: "reworded" },
    } as any);
    expect(r.ok, errs(r)).toBe(true);
  });

  it("allows a row naming a record that is not a candidate", async () => {
    const other = await researchAppend({
      projectPath: dir, section: "namesakes", op: "append", entry: row("I1", ["ark:/61903/1:1:ZZZZ-999"]),
    } as any);
    expect(other.ok, errs(other)).toBe(true);
  });

  it("refuses an update that adds Antoine to a row's record_ids, and allows one that changes only notes", async () => {
    const first = await researchAppend({
      projectPath: dir, section: "namesakes", op: "append", entry: row("I1", ["ark:/61903/1:1:ZZZZ-999"]),
    } as any);
    expect(first.ok, errs(first)).toBe(true);
    const add = await researchAppend({
      projectPath: dir, section: "namesakes", op: "update", entryId: "ns_001", fields: { record_ids: ["ark:/61903/1:1:ZZZZ-999", ANTOINE] },
    } as any);
    expect(add.ok).toBe(false);
    expect(errs(add)).toMatch(/names a candidate/);
    const notes = await researchAppend({
      projectPath: dir, section: "namesakes", op: "update", entryId: "ns_001", fields: { notes: "reworded" },
    } as any);
    expect(notes.ok, errs(notes)).toBe(true);
  });
});

describe("namesakeCandidateRefusals: when a row may name a candidate", () => {
  let dir: string;
  let research: any;
  let tree: any;

  beforeEach(async () => {
    dir = await seedScenario("ns-candidate-unit-");
    research = await readProjectJson(dir, "research.json");
    tree = await readProjectJson(dir, "tree.gedcomx.json");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const judge = (after: any = research, r: any = row("I1", [ANTOINE])) =>
    namesakeCandidateRefusals(dir, research, after, tree, [{ opIndex: 0, row: r }]);

  /** `research` with I1 linked at `confidence` to an assertion of `recordId`. */
  const linked = (recordId: string, confidence: string, extra: Record<string, unknown> = {}) => ({
    ...research,
    assertions: [{ id: "a_001", record_id: recordId }],
    person_evidence: [{ id: "pe_001", assertion_id: "a_001", person_id: "I1", confidence, ...extra }],
  });

  it("refuses a row naming Antoine by her bare id too", async () => {
    expect(await judge()).toHaveLength(1);
    expect(await judge(research, row("I1", ["MFLB-F5N"]))).toHaveLength(1);
  });

  it("allows it once I1 is linked probable or confident to another record", async () => {
    expect(await judge(linked("ark:/61903/1:1:ABCD-123", "probable"))).toEqual([]);
    expect(await judge(linked("ark:/61903/1:1:ABCD-123", "confident"))).toEqual([]);
  });

  it("a speculative or superseded link to another record, or any link to Antoine's own record, does not", async () => {
    expect(await judge(linked("ark:/61903/1:1:ABCD-123", "speculative"))).toHaveLength(1);
    expect(await judge(linked("ark:/61903/1:1:ABCD-123", "confident", { superseded_by: "pe_002" }))).toHaveLength(1);
    expect(await judge(linked(ANTOINE, "confident"))).toHaveLength(1);
  });

  it("allows it when the candidate's birth date is a full day-month-year date", async () => {
    const s: any = await readProjectJson(dir, "results/log_001.json");
    s.payload.results[0].birthDate = "12 March 1833";
    await getProjectStore().writeJson(dir, "results/log_001.json", s);
    expect(await judge()).toEqual([]);
    s.payload.results[0].birthDate = "March 1833";
    await getProjectStore().writeJson(dir, "results/log_001.json", s);
    expect(await judge()).toHaveLength(1);
  });

  it("allows it when her indexed birthplace names another state or country than I1's tree birth", async () => {
    const s: any = await readProjectJson(dir, "results/log_001.json");
    const birthPlace = async (place: string) => {
      s.payload.results[0].birthPlace = place;
      await getProjectStore().writeJson(dir, "results/log_001.json", s);
    };
    tree = structuredClone(tree);
    const i1 = tree.persons.find((p: any) => p.id === "I1");
    i1.facts = [...(i1.facts ?? []).filter((f: any) => f.type !== "Birth"), { id: "Fb", type: "Birth", date: "Apr 1853", place: "Fluvanna, Virginia, United States" }];
    await birthPlace("New York, United States");
    expect(await judge()).toEqual([]);
    await birthPlace("Ireland");
    expect(await judge()).toEqual([]);
    await birthPlace("Virginia, United States");
    expect(await judge()).toHaveLength(1);
    i1.facts = i1.facts.filter((f: any) => f.type !== "Birth");
    await birthPlace("New York, United States");
    expect(await judge()).toHaveLength(1);
  });

  it("allows a row for another person: Antoine is I1's candidate, not I2's", async () => {
    expect(await judge(research, row("I2", [ANTOINE]))).toEqual([]);
  });
});

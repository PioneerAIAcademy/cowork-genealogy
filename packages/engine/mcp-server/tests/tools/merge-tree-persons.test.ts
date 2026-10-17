import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm, access } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { mergeTreePersons } from "../../src/tools/merge-tree-persons.js";

function baseResearch() {
  return {
    project: {
      id: "rp_001",
      objective: "Test",
      status: "active",
      created: "2026-01-01",
      updated: "2026-01-01",
      subject_person_ids: ["I1"],
    },
    questions: [],
    plans: [],
    log: [],
    sources: [],
    assertions: [],
    person_evidence: [],
    conflicts: [],
    hypotheses: [],
    timelines: [
      {
        id: "t_001",
        label: "Father timeline",
        person_ids: ["I2"],
        generated: "2026-01-01T00:00:00Z",
        events: [],
        gaps: [],
      },
    ],
    proof_summaries: [],
    evaluations: [],
  };
}

function baseTree() {
  return {
    persons: [
      { id: "I1", gender: "Male", names: [{ id: "N1", given: "John", surname: "Smith" }] },
      { id: "I2", gender: "Male", names: [{ id: "N2", given: "J", surname: "Smith" }] },
    ],
    relationships: [],
    sources: [],
  };
}

describe("merge_tree_persons", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "merge-tree-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeProject(tree: any, research: any) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree, null, 2));
  }
  const readJson = async (name: string) =>
    JSON.parse(await readFile(join(dir, name), "utf-8"));
  const exists = async (name: string) =>
    access(join(dir, name)).then(() => true, () => false);

  it("writes both files, repoints research person-id refs collapsed→survivor, and reports counts", async () => {
    await writeProject(baseTree(), baseResearch());

    const result = await mergeTreePersons({
      projectPath: dir,
      merges: [["I1", "I2"]],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filesWritten).toEqual(["tree.gedcomx.json", "research.json"]);
    expect(result.researchRefsUpdated).toEqual({
      subject_person_ids: 0,
      person_evidence: 0,
      timelines: 1,
      known_holdings: 0,
      proof_summaries: 0,
      namesakes: 0,
    });
    expect(result.newRelatives).toEqual([]);

    // no readable `.bak` copy of either file left beside the originals.
    expect(await exists("tree.gedcomx.json.bak")).toBe(false);
    expect(await exists("research.json.bak")).toBe(false);

    // collapsed person removed from the tree.
    const tree = await readJson("tree.gedcomx.json");
    expect(tree.persons.map((p: any) => p.id)).toEqual(["I1"]);

    // timeline ref repointed I2 → I1; subject unchanged.
    const research = await readJson("research.json");
    expect(research.timelines[0].person_ids).toEqual(["I1"]);
    expect(research.project.subject_person_ids).toEqual(["I1"]);
  });

  it("merges an initial-form name into the survivor's fuller name", async () => {
    await writeProject(baseTree(), baseResearch());
    const result = await mergeTreePersons({ projectPath: dir, merges: [["I1", "I2"]] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // "J Smith" is an initial form of "John Smith" → equivalent → one kept.
    expect(result.pairs[0]).toMatchObject({ survivorId: "I1", namesKept: 1, namesMerged: 1 });
    const tree = await readJson("tree.gedcomx.json");
    expect(tree.persons[0].names).toHaveLength(1);
    expect(tree.persons[0].names[0]).toMatchObject({ given: "John", preferred: true });
  });

  it("rejects a merge chain (an id that is both survivor and collapsed) and writes nothing", async () => {
    const tree = {
      persons: [
        { id: "I1", gender: "Male", names: [{ id: "N1", given: "A", surname: "X" }] },
        { id: "I2", gender: "Male", names: [{ id: "N2", given: "B", surname: "X" }] },
        { id: "I3", gender: "Male", names: [{ id: "N3", given: "C", surname: "X" }] },
      ],
      relationships: [],
      sources: [],
    };
    await writeProject(tree, baseResearch());
    const treeBefore = await readFile(join(dir, "tree.gedcomx.json"), "utf-8");

    const result = await mergeTreePersons({
      projectPath: dir,
      merges: [["I1", "I2"], ["I2", "I3"]],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/chains are not supported/);
    expect(await readFile(join(dir, "tree.gedcomx.json"), "utf-8")).toBe(treeBefore);
    expect(await exists("tree.gedcomx.json.bak")).toBe(false);
    expect(await exists("research.json.bak")).toBe(false);
  });

  it("returns a staleness error and writes nothing when a survivor id is not in the tree", async () => {
    await writeProject(baseTree(), baseResearch());
    const result = await mergeTreePersons({ projectPath: dir, merges: [["I999", "I2"]] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/I999 not found in target/);
    expect(await exists("research.json.bak")).toBe(false);
  });

  // Issue #2525: merging two records of one child, each with its own father,
  // gives the survivor two biological fathers. The refusal surfaces it.
  it("refuses a merge that joins two fathers onto one child, with conflicts_surfaced", async () => {
    const p = (id: string, given: string, birth: string) => ({
      id,
      gender: "Male",
      names: [{ id: `N${id}`, given, surname: "Flynn" }],
      facts: [{ id: `F${id}`, type: "Birth", date: birth, primary: true }],
    });
    const tree = {
      persons: [p("I1", "Patrick", "1845"), p("I2", "Patrick", "1845"), p("I3", "Thomas", "1815"), p("I4", "John", "1818")],
      relationships: [
        { id: "R1", type: "ParentChild", parent: "I3", child: "I1", sources: [{ ref: "S1" }] },
        { id: "R2", type: "ParentChild", parent: "I4", child: "I2", sources: [{ ref: "S1" }] },
      ],
      sources: [{ id: "S1", title: "1850 census" }],
    };
    await writeProject(tree, baseResearch());

    const result = await mergeTreePersons({ projectPath: dir, merges: [["I1", "I2"]] });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unjustified_warnings");
    expect(result.errors).toHaveLength(1);
    expect(result.conflicts_surfaced?.map((c) => [c.personId, c.factType, c.values.length])).toEqual([
      ["I1", "ParentChild", 2],
    ]);
  });

  it("does not report two fathers that already stood when a merge only folds one into another", async () => {
    const p = (id: string, given: string, birth: string) => ({
      id,
      gender: "Male",
      names: [{ id: `N${id}`, given, surname: "Flynn" }],
      facts: [{ id: `F${id}`, type: "Birth", date: birth, primary: true }],
    });
    const tree = {
      persons: [p("I1", "Patrick", "1845"), p("I2", "Thomas", "1815"), p("I3", "John", "1818"), p("I4", "John", "1818")],
      relationships: [
        { id: "R1", type: "ParentChild", parent: "I2", child: "I1", sources: [{ ref: "S1" }] },
        { id: "R2", type: "ParentChild", parent: "I3", child: "I1", sources: [{ ref: "S1" }] },
      ],
      sources: [{ id: "S1", title: "1850 census" }],
    };
    await writeProject(tree, baseResearch());

    const result = await mergeTreePersons({ projectPath: dir, merges: [["I4", "I3"]] });

    expect((result as any).conflicts_surfaced).toBeUndefined();
  });
});

// ─── The pair and namesake checks (issue #3363) ─────────────────────────────
//
// A merge is judged on the project as it stood before it: the relationship
// joining a pair (part 2), the survivor order (24e), the links it moves onto a
// person with a namesake row (part 1), and what it carries onto that person
// from a record none of whose links to the pair passes the cap (part 3). Every
// refusal writes nothing.

describe("merge_tree_persons: pair and namesake checks", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "merge-namesake-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const T = "KWCB-111";
  const W = "KWCB-222";
  const ADDRESS = "530 Baldwin St, Niles, Ohio";
  const NILES = "Niles, Trumbull, Ohio, United States";
  const pad = (n: number) => String(n).padStart(3, "0");
  const rec = (n: number, suffix = "") => `ark:/61903/1:1:REC${pad(n)}${suffix}`;

  const source = (n: number) => ({
    id: `src_${pad(n)}`,
    gedcomx_source_description_id: `S${n}`,
    citation: `Record S${n}`,
    citation_detail: { who: "Clerk", what: `Record S${n}`, when_created: "1880", when_accessed: "2026-10-17", where: "Ohio", where_within: "page 1" },
    source_classification: "original",
    repository: "FamilySearch",
    access_date: "2026-10-17",
  });
  const assertion = (id: string, n: number, role: string, factType: string, value: string, extra: Record<string, unknown> = {}) => ({
    id,
    source_id: `src_${pad(n)}`,
    record_id: rec(n),
    record_role: role,
    fact_type: factType,
    value,
    information_quality: "primary",
    informant: "self",
    informant_proximity: "self",
    record_basis: "stated",
    extracted_for_question_ids: [],
    ...extra,
  });
  const link = (id: string, assertionId: string, personId: string, confidence = "probable", extra: Record<string, unknown> = {}) => ({
    id, assertion_id: assertionId, person_id: personId, confidence, rationale: "test", created: "2026-10-01", superseded_by: null, ...extra,
  });
  const row = (id: string, personId: string, name = "John Smith") => ({
    id, person_id: personId, name, place: "San Francisco, California, United States", time_period: "born about 1873", record_ids: [], created: "2026-10-01",
  });
  const person = (id: string, given: string, surname: string, gender = "Male", extra: Record<string, unknown> = {}) => ({
    id, gender, names: [{ id: `N-${id}`, given, surname }], ...extra,
  });
  /** A person whose name cites these tree sources. */
  const cited = (id: string, given: string, surname: string, refs: string[], gender = "Male", extra: Record<string, unknown> = {}) => ({
    id, gender, names: [{ id: `N-${id}`, given, surname, sources: refs.map((ref) => ({ ref })) }], ...extra,
  });
  const couple = (id: string, a: string, b: string) => ({ id, type: "Couple", person1: a, person2: b });
  const parentChild = (id: string, parent: string, child: string, refs: string[] = []) => ({
    id, type: "ParentChild", parent, child, ...(refs.length > 0 ? { sources: refs.map((ref) => ({ ref })) } : {}),
  });
  const fact = (id: string, type: string, date: string, refs: string[] = [], extra: Record<string, unknown> = {}) => ({
    id, type, date, ...(refs.length > 0 ? { sources: refs.map((ref) => ({ ref })) } : {}), ...extra,
  });

  function project(o: { persons: any[]; relationships?: any[]; sources?: number[]; assertions?: any[]; links?: any[]; namesakes?: any[] }) {
    const nums = o.sources ?? [];
    return {
      tree: { persons: o.persons, relationships: o.relationships ?? [], sources: nums.map((n) => ({ id: `S${n}`, title: `Record S${n}` })) },
      research: {
        project: { id: "rp_001", objective: "Test", status: "active", created: "2026-01-01", updated: "2026-01-01", subject_person_ids: [] },
        questions: [], plans: [], log: [],
        sources: nums.map(source),
        assertions: o.assertions ?? [],
        person_evidence: o.links ?? [],
        conflicts: [], hypotheses: [], timelines: [], proof_summaries: [], evaluations: [],
        namesakes: o.namesakes ?? [],
      },
    };
  }
  async function write(p: { tree: any; research: any }, starting?: any) {
    await writeFile(join(dir, "research.json"), JSON.stringify(p.research, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(p.tree, null, 2));
    if (starting) {
      await writeFile(join(dir, "starting-tree.gedcomx.json"), JSON.stringify({ relationships: [], sources: [], ...starting }, null, 2));
    }
  }
  const files = async () => [await readFile(join(dir, "research.json"), "utf-8"), await readFile(join(dir, "tree.gedcomx.json"), "utf-8")];
  async function refused(merges: Array<[string, string]>, p: { tree: any; research: any }, starting?: any) {
    await write(p, starting);
    const before = await files();
    const r = await mergeTreePersons({ projectPath: dir, merges });
    expect(r.ok, JSON.stringify(r)).toBe(false);
    expect(await files()).toEqual(before);
    return r as any;
  }
  const refusedText = async (merges: Array<[string, string]>, p: { tree: any; research: any }, starting?: any) =>
    ((await refused(merges, p, starting)).errors as string[]).join("\n");
  async function merged(merges: Array<[string, string]>, p: { tree: any; research: any }, starting?: any) {
    await write(p, starting);
    const r = await mergeTreePersons({ projectPath: dir, merges });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    return r as any;
  }
  const readResearch = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));

  // ─── part 2 and the survivor order ────────────────────────────────────────

  it("MF3 refuses a pair a ParentChild relationship joins, written child first", async () => {
    const m = await refusedText([["I51", "I50"]], project({
      persons: [person("I50", "Thomas", "Smith"), person("I51", "John", "Smith")],
      relationships: [parentChild("R1", "I50", "I51")],
    }));
    expect(m).toContain("relationship 'R1' (ParentChild) joins 'I50' and 'I51', a pair in this merge");
    expect(m).toContain("remove that relationship with tree_correct (operation 'remove', relationshipId)");
  });

  it("MF3c refuses a pair a Couple relationship joins", async () => {
    const m = await refusedText([["I53", "I52"]], project({
      persons: [person("I52", "John", "Smith"), person("I53", "Mary", "Smith", "Female")],
      relationships: [couple("R2", "I52", "I53")],
    }));
    expect(m).toContain("relationship 'R2' (Couple) joins 'I52' and 'I53'");
  });

  it("MS11 merges a pair whose members each have relationships but none joining them", async () => {
    await merged([["I54", "I55"]], project({
      persons: [person("I54", "John", "Smith"), person("I55", "John", "Smith"), person("I56", "Ann", "Smith", "Female"), person("I57", "Mary", "Smith", "Female")],
      relationships: [parentChild("R1", "I54", "I56"), couple("R2", "I55", "I57")],
    }));
  });

  it("MF14 refuses folding a FamilySearch person into one made during the run", async () => {
    const m = await refusedText([["I60", "KWCB-333"]], project({ persons: [person("I60", "Peter", "Jones"), person("KWCB-333", "Peter", "Jones")] }));
    expect(m).toContain("pair ['I60', 'KWCB-333'] would fold 'KWCB-333', a FamilySearch or starting-tree person, into 'I60', which is neither.");
    expect(m).toContain("Write each listed pair the other way round");
  });

  it("MF14b refuses folding a starting-tree person into one made during the run", async () => {
    const m = await refusedText(
      [["I61", "I3"]],
      project({ persons: [person("I61", "Peter", "Jones"), person("I3", "Peter", "Jones")] }),
      { persons: [person("I3", "Peter", "Jones")] },
    );
    expect(m).toContain("pair ['I61', 'I3']");
  });

  it("MS14 merges a run-made or a FamilySearch person into a FamilySearch person", async () => {
    const p = () => project({ persons: [person("KWCB-333", "Peter", "Jones"), person("I60", "Peter", "Jones"), person("KWCB-444", "Peter", "Jones")] });
    await merged([["KWCB-333", "I60"]], p());
    await merged([["KWCB-333", "KWCB-444"]], p());
  });

  // ─── part 1: links moved onto a person with a namesake row ────────────────

  const mf1 = (confidence: string, i7: any = cited("I7", "John", "Smith", ["S1", "S9"]), extra: any[] = []) =>
    project({
      persons: [person(T, "John", "Smith"), i7, ...extra],
      sources: [1, 9],
      assertions: [assertion("a_001", 1, "principal", "birth", "1873"), assertion("a_009", 9, "head", "name", "John Smith")],
      links: [link("pe_001", "a_001", "I7", confidence)],
      namesakes: [row("ns_001", T)],
    });

  it("MF1 refuses moving an untied link onto the row holder, naming the link, the row and the source", async () => {
    const m = await refusedText([[T, "I7"]], mf1("confident"));
    expect(m).toContain(
      `person_evidence 'pe_001' on 'I7' would stand under the namesake row 'ns_001' of '${T}' after this merge: ` +
        `nothing in source 'src_001' ties assertion 'a_001' to '${T}'.`,
    );
    expect(m).toContain("Nothing was written. Each person_evidence link listed above would stand under a recorded namesake");
    expect(m).not.toContain("Do not lower it");
  });

  it("MF1p refuses it at probable too", async () => {
    expect(await refusedText([[T, "I7"]], mf1("probable"))).toContain("person_evidence 'pe_001' on 'I7'");
  });

  it("MF13 judges every pair, not only the first", async () => {
    const m = await refusedText(
      [["I30", "I31"], [T, "I7"]],
      mf1("confident", undefined, [person("I30", "Ann", "Brown", "Female"), person("I31", "Ann", "Brown", "Female")]),
    );
    expect(m).toContain("person_evidence 'pe_001' on 'I7'");
  });

  it("MF19 marks a link from the record the folded person was made from 'do not lower it'", async () => {
    const m = await refusedText([[T, "I7"]], mf1("confident", cited("I7", "John", "Smith", ["S1"])));
    expect(m).toContain("Do not lower it: 'I7' was created from this record.");
    expect(m).toContain("Remove nothing from a record whose link above says 'do not lower it'");
  });

  it("MF2 keys on the row, not on the survivor", async () => {
    const m = await refusedText([["I8", "I12"]], project({
      persons: [person("I12", "John", "Smith"), person("I8", "John", "Smith")],
      sources: [2],
      assertions: [assertion("a_002", 2, "principal", "birth", "1873")],
      links: [link("pe_002", "a_002", "I8", "confident")],
      namesakes: [row("ns_001", "I12")],
    }));
    expect(m).toContain("person_evidence 'pe_002' on 'I8' would stand under the namesake row 'ns_001' of 'I12'");
  });

  const mf4 = () =>
    project({
      persons: [
        person(T, "John", "Smith"),
        person(W, "Mary", "Smith", "Female"),
        person("I7", "John", "Smith", "Male", {
          facts: [fact("F1", "Birth", "1873", ["S4"]), fact("F2", "Residence", "1880", ["S5"], { place: NILES })],
        }),
      ],
      relationships: [couple("R1", T, W)],
      sources: [4, 5],
      assertions: [
        assertion("a_041", 4, "head", "residence", ADDRESS, { place: NILES }),
        assertion("a_042", 4, "wife", "name", "Mary Smith"),
        assertion("a_051", 5, "principal", "residence", ADDRESS, { place: NILES }),
      ],
      links: [link("pe_004", "a_041", "I7"), link("pe_005", "a_051", "I7"), link("pe_006", "a_042", W)],
      namesakes: [row("ns_001", T)],
    });

  it("MF4 refuses only the moved link nothing ties, and part 3 lists the fact that link's record backs", async () => {
    const m = await refusedText([[T, "I7"]], mf4());
    expect(m).toContain("person_evidence 'pe_005' on 'I7'");
    expect(m).not.toContain("person_evidence 'pe_004'");
    expect(m).toContain("fact 'F2' (Residence) on 'I7' cites 'S5' (research source 'src_005')");
    expect(m).toContain("'pe_005' refused above");
    expect(m).not.toContain("fact 'F1' (Birth)");
  });

  const mf5 = (onSurvivor: boolean) =>
    project({
      persons: [person(T, "John", "Smith"), person("I7", "John", "Smith")],
      sources: [7],
      assertions: [assertion("a_007", 7, "principal", "birth", "1873")],
      links: [link("pe_007", "a_007", onSurvivor ? T : "I7")],
      namesakes: [row("ns_001", T), row("ns_002", "I7")],
    });

  it("MF5 judges the folded person's link on the survivor when both hold rows", async () => {
    expect(await refusedText([[T, "I7"]], mf5(false))).toContain(
      `person_evidence 'pe_007' on 'I7' would stand under the namesake row 'ns_001' of '${T}'`,
    );
  });

  it("MF5m and the survivor's link on the folded person", async () => {
    expect(await refusedText([[T, "I7"]], mf5(true))).toContain(
      `person_evidence 'pe_007' on '${T}' would stand under the namesake row 'ns_002' of 'I7'`,
    );
  });

  const mf6 = (holder: string, other: string) =>
    project({
      persons: [person(holder, "John", "Smith"), person(other, "John", "Smith"), person("KWCB-333", "Thomas", "Smith")],
      relationships: [parentChild("R1", "KWCB-333", other)],
      sources: [8],
      assertions: [assertion("a_081", 8, "child", "name", "John Smith"), assertion("a_082", 8, "father", "name", "Thomas Smith")],
      links: [link("pe_008", "a_081", other), link("pe_009", "a_082", "KWCB-333")],
      namesakes: [row("ns_001", holder)],
    });
  const fatherBaseline = { persons: [person("KWCB-333", "Thomas", "Smith")] };

  it("MF6 judges on the tree before the merge, where the folded person's father is not the row holder's", async () => {
    const m = await refusedText([[T, "I7"]], mf6(T, "I7"), fatherBaseline);
    expect(m).toContain("person_evidence 'pe_008' on 'I7'");
    expect(m).toContain(`to 'KWCB-333', who is not a spouse, parent or child of '${T}' in the tree.`);
  });

  it("MF6r and judges under the row holder's id when the row holder is folded", async () => {
    const m = await refusedText([["I7", "I70"]], mf6("I70", "I7"), fatherBaseline);
    expect(m).toContain("person_evidence 'pe_008' on 'I7' would stand under the namesake row 'ns_001' of 'I70'");
  });

  it("MF9 marks a link tied on the survivor's own family 'do not lower it', without the cap's routing", async () => {
    const m = await refusedText([["I20", "I21"]], project({
      persons: [cited("I20", "John", "Smith", ["S20", "S21"]), person("I21", "John", "Smith"), person(W, "Mary", "Smith", "Female")],
      relationships: [couple("R1", "I20", W)],
      sources: [20, 21],
      assertions: [
        assertion("a_201", 20, "head", "name", "John Smith"),
        assertion("a_202", 20, "wife", "name", "Mary Smith"),
        assertion("a_211", 21, "principal", "name", "John Smith"),
      ],
      links: [link("pe_020", "a_201", "I20"), link("pe_021", "a_202", W)],
      namesakes: [row("ns_001", "I21")],
    }));
    const line = m.split("\n").find((l) => l.startsWith("person_evidence 'pe_020'"))!;
    expect(line).toContain("of 'I21' after this merge");
    expect(line).toContain("Do not lower it: on 'I20' it is tied by 'I20''s own relatives or earlier links, which 'I21' does not share in the tree.");
    expect(line).not.toContain("A recorded namesake caps");
  });

  it("MF12 refuses on the namesake check before the warning gate", async () => {
    const r = await refused([[T, "I7"]], project({
      persons: [
        person(T, "John", "Smith", "Male", { facts: [fact("F1", "Birth", "1873", [], { primary: true })] }),
        person("I7", "John", "Smith", "Male", { facts: [fact("F1", "Birth", "1873", [], { primary: true })] }),
        person("KWCB-333", "Thomas", "Smith", "Male", { facts: [fact("F1", "Birth", "1840", [], { primary: true })] }),
        person("KWCB-444", "James", "Smith", "Male", { facts: [fact("F1", "Birth", "1842", [], { primary: true })] }),
      ],
      relationships: [parentChild("R1", "KWCB-333", T), parentChild("R2", "KWCB-444", "I7")],
      sources: [7],
      assertions: [assertion("a_007", 7, "principal", "birth", "1873")],
      links: [link("pe_007", "a_007", "I7")],
      namesakes: [row("ns_001", T)],
    }));
    expect(r.reason).toBeUndefined();
    expect(r.errors.join("\n")).toContain("person_evidence 'pe_007' on 'I7'");
  });

  it("MF16 judges the survivor's link on the folded row holder, marked 'do not lower it'", async () => {
    const m = await refusedText([[T, "I7"]], project({
      persons: [person(T, "John", "Smith"), person("I7", "John", "Smith"), person(W, "Mary", "Smith", "Female")],
      relationships: [couple("R1", T, W)],
      sources: [20],
      assertions: [assertion("a_201", 20, "head", "name", "John Smith"), assertion("a_202", 20, "wife", "name", "Mary Smith")],
      links: [link("pe_020", "a_201", T), link("pe_021", "a_202", W)],
      namesakes: [row("ns_001", T), row("ns_002", "I7")],
    }));
    const line = m.split("\n").find((l) => l.startsWith("person_evidence 'pe_020'"))!;
    expect(line).toContain("of 'I7' after this merge");
    expect(line).toContain(`Do not lower it: on '${T}' it is tied`);
    expect(line).not.toContain("A recorded namesake caps");
  });

  const widow = (husbandToo: boolean) =>
    project({
      persons: [person("I30", "Mary", "Brown", "Female"), person("I31", "Mary", "Brown", "Female"), person("KWCB-666", "Henry", "Brown"), person("KWCB-777", "James", "Brown")],
      relationships: [couple("R1", "I30", "KWCB-666"), couple("R2", "I31", "KWCB-777"), ...(husbandToo ? [couple("R3", "I30", "KWCB-777")] : [])],
      sources: [30],
      assertions: [assertion("a_301", 30, "head", "name", "James Brown"), assertion("a_302", 30, "wife", "name", "Mary Brown")],
      links: [link("pe_030", "a_301", "KWCB-777"), link("pe_031", "a_302", "I31")],
      namesakes: [row("ns_001", "I30", "Mary Brown")],
    });
  const widowBaseline = {
    persons: [person("I30", "Mary", "Brown", "Female"), person("KWCB-666", "Henry", "Brown")],
    relationships: [couple("R1", "I30", "KWCB-666")],
  };

  it("MF17 refuses a widow's link tied by the other copy's husband, routing to recording that relationship", async () => {
    const m = await refusedText([["I30", "I31"]], widow(false), widowBaseline);
    expect(m).toContain("person_evidence 'pe_031' on 'I31'");
    expect(m).toContain("Do not lower it: on 'I31' it is tied");
    expect(m).toContain("record that relationship first (tree_edit add_relationship)");
  });

  it("MS15 merges once that relationship is in the tree, though the starting tree lacks it", async () => {
    await merged([["I30", "I31"]], widow(true), widowBaseline);
  });

  // MS19 is a known let-through (R7): the wife merged in the same call is judged
  // by her own id and refs, so the merged wife, who reaches only the census, ties
  // it. MF22 is the accepted false deny of the same rule.
  const r7 = (falseDeny: boolean) =>
    project({
      persons: [
        person(T, "John", "Smith"),
        person("I7", "John", "Smith"),
        falseDeny ? cited("I5", "Mary", "Smith", ["S41"], "Female") : person("I5", "Mary", "Smith", "Female"),
        falseDeny
          ? { id: "I6", gender: "Female", names: [{ id: "N-I6", given: "Mary", surname: "Smith", sources: [{ ref: "S41" }, { ref: "S42" }] }] }
          : cited("I6", "Mary", "Smith", ["S40"], "Female"),
      ],
      relationships: [couple("R1", T, "I5")],
      sources: falseDeny ? [41, 42] : [40],
      assertions: falseDeny
        ? [assertion("a_411", 41, "head", "name", "John Smith"), assertion("a_412", 41, "wife", "name", "Mary Smith"), assertion("a_421", 42, "principal", "name", "Mary Smith")]
        : [assertion("a_401", 40, "head", "name", "John Smith"), assertion("a_402", 40, "wife", "name", "Mary Smith")],
      links: falseDeny
        ? [link("pe_001", "a_411", "I7"), link("pe_002", "a_412", "I6")]
        : [link("pe_001", "a_401", "I7"), link("pe_002", "a_402", "I6")],
      namesakes: [row("ns_001", T)],
    });

  it("MS19 known let-through: a ref-less wife merged in the same call ties a link her duplicate's census holds", async () => {
    await merged([[T, "I7"], ["I5", "I6"]], r7(false));
  });

  it("MF22 accepted false deny: a wife made from that census, merged with a duplicate that has another record", async () => {
    const m = await refusedText([[T, "I7"], ["I5", "I6"]], r7(true));
    expect(m).toContain("person_evidence 'pe_001' on 'I7'");
    expect(m).toContain("but 'I5' was created from this source alone.");
  });

  it("MS1 ignores a row on someone outside the pair", async () => {
    await merged([["I40", "I41"]], project({
      persons: [person(T, "John", "Smith"), person("I40", "James", "Brown"), person("I41", "James", "Brown")],
      sources: [1],
      assertions: [assertion("a_001", 1, "principal", "birth", "1873")],
      links: [link("pe_001", "a_001", "I41")],
      namesakes: [row("ns_001", T)],
    }));
  });

  it("MS2 lets the row holder's starting-tree father tie a moved link", async () => {
    const father = cited("I3", "Thomas", "Smith", ["S11"]);
    await merged(
      [[T, "I7"]],
      project({
        persons: [person(T, "John", "Smith"), person("I7", "John", "Smith"), father],
        relationships: [parentChild("R1", "I3", T)],
        sources: [11],
        assertions: [assertion("a_111", 11, "child", "name", "John Smith"), assertion("a_112", 11, "father", "name", "Thomas Smith")],
        links: [link("pe_010", "a_111", "I7"), link("pe_011", "a_112", "I3")],
        namesakes: [row("ns_001", T)],
      }),
      { persons: [person(T, "John", "Smith"), father], relationships: [parentChild("R1", "I3", T)] },
    );
  });

  it("MS3 does not judge the row holder's own links", async () => {
    await merged([[T, "I7"]], project({
      persons: [person(T, "John", "Smith"), person("I7", "John", "Smith")],
      sources: [12],
      assertions: [assertion("a_121", 12, "principal", "birth", "1873")],
      links: [link("pe_012", "a_121", T)],
      namesakes: [row("ns_001", T)],
    }));
  });

  it("MS4 does not judge a speculative or a withdrawn link", async () => {
    await merged([[T, "I7"]], project({
      persons: [person(T, "John", "Smith"), person("I7", "John", "Smith")],
      sources: [13],
      assertions: [assertion("a_131", 13, "principal", "birth", "1873"), assertion("a_132", 13, "principal", "occupation", "Clerk")],
      links: [link("pe_013", "a_131", "I7", "speculative"), link("pe_014", "a_132", "I7", "confident", { superseded_by: "pe_013" })],
      namesakes: [row("ns_001", T)],
    }));
  });

  const ms5 = (holder: string) =>
    project({
      persons: [person(holder, "John", "Smith"), person("I7", "John", "Smith"), person(W, "Mary", "Smith", "Female")],
      relationships: [couple("R1", holder, W)],
      sources: [12, 13],
      assertions: [
        assertion("a_121", 12, "head", "residence", ADDRESS, { place: NILES }),
        assertion("a_122", 12, "wife", "name", "Mary Smith"),
        assertion("a_131", 13, "principal", "residence", ADDRESS, { place: NILES }),
      ],
      links: [link("pe_015", "a_121", holder), link("pe_016", "a_131", "I7"), link("pe_017", "a_122", W)],
      namesakes: [row("ns_001", holder)],
    });

  it("MS5 lets the row holder's own earlier link vouch for a moved link at the same address", async () => {
    await merged([[T, "I7"]], ms5(T));
  });

  it("MS5r and the same when the row holder is folded", async () => {
    await merged([["I7", "I71"]], ms5("I71"));
  });

  it("MS6 re-keys a namesake row onto the survivor", async () => {
    const r = await merged([[T, "I13"]], project({
      persons: [person(T, "John", "Smith"), person("I13", "John", "Smith")],
      namesakes: [row("ns_001", "I13")],
    }));
    expect((await readResearch()).namesakes[0].person_id).toBe(T);
    expect(r.researchRefsUpdated.namesakes).toBe(1);
  });

  it("MS7 does not judge a row holder outside the pair, though a merged relative now reaches his record", async () => {
    await merged([["I5", "I6"]], project({
      persons: [person(T, "John", "Smith"), person("I5", "Mary", "Smith", "Female"), cited("I6", "Mary", "Smith", ["S20"], "Female")],
      relationships: [couple("R1", T, "I5")],
      sources: [20],
      assertions: [assertion("a_201", 20, "groom", "name", "John Smith"), assertion("a_202", 20, "bride", "name", "Mary Smith")],
      links: [link("pe_020", "a_201", T), link("pe_021", "a_202", "I5")],
      namesakes: [row("ns_001", T)],
    }));
  });

  it("MS8 ties through a co-party the source keeps on a record id of its own", async () => {
    await merged([[T, "I7"]], project({
      persons: [person(T, "John", "Smith"), cited("I7", "John", "Smith", ["S14"]), person(W, "Mary", "Smith", "Female")],
      relationships: [couple("R1", T, W)],
      sources: [14],
      assertions: [
        assertion("a_141", 14, "groom", "name", "John Smith", { record_id: rec(14, "-1") }),
        assertion("a_142", 14, "bride", "name", "Mary Smith", { record_id: rec(14, "-2") }),
      ],
      links: [link("pe_018", "a_141", "I7", "confident"), link("pe_019", "a_142", W)],
      namesakes: [row("ns_001", T)],
    }));
  });

  const ms9 = () =>
    project({
      persons: [person("I20", "John", "Smith"), person("I21", "John", "Smith"), person("I5", "Mary", "Smith", "Female"), cited("I6", "Mary", "Smith", ["S20"], "Female")],
      relationships: [couple("R1", "I20", "I5"), couple("R2", "I21", "I6")],
      sources: [20],
      assertions: [assertion("a_201", 20, "head", "name", "John Smith"), assertion("a_202", 20, "wife", "name", "Mary Smith")],
      links: [link("pe_020", "a_201", "I21"), link("pe_021", "a_202", "I6")],
      namesakes: [row("ns_001", "I20")],
    });

  it("MS9 maps a wife merged in the same call onto the row holder's wife, in either survivor order", async () => {
    await merged([["I20", "I21"], ["I5", "I6"]], ms9());
    await merged([["I21", "I20"], ["I6", "I5"]], ms9());
  });

  it("MS10 judges under the folded row holder's id, whose wife ties the link", async () => {
    await merged([["I20", "I21"]], project({
      persons: [person("I20", "John", "Smith"), person("I21", "John", "Smith"), person(W, "Mary", "Smith", "Female")],
      relationships: [couple("R1", "I21", W)],
      sources: [20],
      assertions: [assertion("a_201", 20, "head", "name", "John Smith"), assertion("a_202", 20, "wife", "name", "Mary Smith")],
      links: [link("pe_020", "a_201", "I20"), link("pe_021", "a_202", W)],
      namesakes: [row("ns_001", "I21")],
    }));
  });

  it("MS13 merges two row holders whose links one shared wife ties", async () => {
    await merged([[T, "I7"]], project({
      persons: [person(T, "John", "Smith"), person("I7", "John", "Smith"), person(W, "Mary", "Smith", "Female")],
      relationships: [couple("R1", T, W), couple("R2", "I7", W)],
      sources: [20, 21],
      assertions: [
        assertion("a_201", 20, "head", "name", "John Smith"),
        assertion("a_202", 20, "wife", "name", "Mary Smith"),
        assertion("a_211", 21, "head", "name", "John Smith"),
        assertion("a_212", 21, "wife", "name", "Mary Smith"),
      ],
      links: [link("pe_020", "a_201", T), link("pe_021", "a_202", W), link("pe_022", "a_211", "I7"), link("pe_023", "a_212", W)],
      namesakes: [row("ns_001", T), row("ns_002", "I7")],
    }));
  });

  // ─── part 3: what the merge carries from a record nothing ties ────────────

  const mf18 = (withdrawn: boolean) =>
    project({
      persons: [
        person("KWCB-500", "Juan", "Cruz"),
        cited("I1", "Jose", "Cruz Corona", ["S1"], "Male", {
          facts: [fact("F1", "Birth", "1890", ["S1"]), fact("F2", "BirthRegistration", "1890", ["S1"])],
        }),
        person("I2", "Pedro", "Cruz"),
        person("I3", "Maria", "Corona", "Female"),
        person("I9", "Jose", "Cruz"),
      ],
      relationships: [parentChild("R1", "I2", "I1", ["S1"]), parentChild("R2", "I3", "I1", ["S1"])],
      sources: [1],
      assertions: [assertion("a_001", 1, "child", "name", "Jose Cruz Corona"), assertion("a_002", 1, "child", "birth", "1890")],
      links: withdrawn
        ? [
            link("pe_001", "a_001", "I1", "probable", { superseded_by: "pe_003" }),
            link("pe_002", "a_002", "I1", "probable", { superseded_by: "pe_004" }),
            link("pe_003", "a_001", "I9"),
            link("pe_004", "a_002", "I9"),
          ]
        : [link("pe_001", "a_001", "I1", "speculative"), link("pe_002", "a_002", "I1", "speculative")],
      namesakes: [row("ns_001", "KWCB-500", "Juan Cruz")],
    });

  it("MF18 refuses carrying a name, facts and parents from a record linked only at 'speculative'", async () => {
    const m = await refusedText([["KWCB-500", "I1"]], mf18(false));
    expect(m).not.toContain("person_evidence '");
    for (const item of [
      "name 'Jose Cruz Corona' on 'I1' cites 'S1' (research source 'src_001')",
      "fact 'F1' (Birth) on 'I1' cites 'S1'",
      "fact 'F2' (BirthRegistration) on 'I1' cites 'S1'",
      "relationship 'R1' (ParentChild with 'I2') on 'I1' cites 'S1'",
      "relationship 'R2' (ParentChild with 'I3') on 'I1' cites 'S1'",
    ]) {
      expect(m).toContain(item);
    }
    expect(m).toContain("('pe_001' speculative, 'pe_002' speculative)");
    expect(m).toContain("Remove each listed fact or relationship from 'I1' with tree_correct");
    expect(m).toContain("No tool removes a name or a person-level source");
  });

  it("MF18s and from a record whose links to the pair were all withdrawn", async () => {
    expect(await refusedText([["KWCB-500", "I1"]], mf18(true))).toContain("('pe_001' withdrawn, 'pe_002' withdrawn)");
  });

  const mf20 = (absentToo: boolean) =>
    project({
      persons: [
        person(T, "John", "Smith"),
        cited("I9", "John", "Smith", ["S1"], "Male", { facts: [fact("F1", "Death", "1930", ["S1"]), fact("F2", "Burial", "1930", ["S1"])] }),
      ],
      sources: [1],
      assertions: [
        assertion("a_001", 1, "deceased", "name", "John Smith"),
        ...(absentToo ? [assertion("a_002", 1, "deceased", "residence", "No residence stated", { record_basis: "absent" })] : []),
      ],
      links: [link("pe_001", "a_001", T), ...(absentToo ? [link("pe_002", "a_002", T)] : [])],
      namesakes: [row("ns_001", T)],
    });

  it("MF20 refuses carrying a record's facts and citation when the row holder's own link to it is untied", async () => {
    const m = await refusedText([[T, "I9"]], mf20(false));
    expect(m).not.toContain("person_evidence '");
    expect(m).toContain(`name 'John Smith' on 'I9' would fold into '${T}''s and add the citation 'S1' (research source 'src_001')`);
    expect(m).toContain("fact 'F1' (Death) on 'I9' cites 'S1'");
    expect(m).toContain("fact 'F2' (Burial) on 'I9' cites 'S1'");
    expect(m).toContain(`('pe_001' untied on '${T}')`);
  });

  it("MF20a and ignores an absent-basis link from that record", async () => {
    const m = await refusedText([[T, "I9"]], mf20(true));
    expect(m).toContain(`('pe_001' untied on '${T}')`);
    expect(m).not.toContain("pe_002");
  });

  it("MF21 refuses a folded fact for the citation it adds", async () => {
    const m = await refusedText([[T, "I7"]], project({
      persons: [
        person(T, "John", "Smith", "Male", { facts: [fact("F1", "Birth", "1873")] }),
        person("I7", "John", "Smith", "Male", { facts: [fact("F1", "Birth", "1873", ["S31"])] }),
      ],
      sources: [31],
      assertions: [assertion("a_311", 31, "principal", "birth", "1873")],
      links: [link("pe_031", "a_311", "I7", "speculative")],
      namesakes: [row("ns_001", T)],
    }));
    expect(m).toContain(`fact 'F1' (Birth) on 'I7' would fold into '${T}''s and add the citation 'S31' (research source 'src_031')`);
    expect(m).toContain("('pe_031' speculative)");
  });

  it("MS16 merges a second copy whose name and birth fold in adding no citation", async () => {
    const copy = (id: string) => cited(id, "Jose", "Cruz", ["S5"], "Male", { facts: [fact("F1", "Birth", "1890", ["S5"])] });
    await merged([["I6", "I8"]], project({
      persons: [copy("I6"), copy("I8")],
      sources: [5],
      assertions: [assertion("a_051", 5, "child", "name", "Jose Cruz"), assertion("a_052", 5, "child", "birth", "1890")],
      links: [link("pe_051", "a_051", "I6"), link("pe_052", "a_052", "I6")],
      namesakes: [row("ns_001", "I6", "Jose Cruz")],
    }));
  });

  it("MS17 lets a relative's record through: the father's baptism cited on the parent edge", async () => {
    await merged([[T, "I7"]], project({
      persons: [person(T, "John", "Smith"), person("I7", "John", "Smith"), cited("I4", "Thomas", "Smith", ["S30"])],
      relationships: [parentChild("R1", "I4", "I7", ["S30"])],
      sources: [30],
      assertions: [assertion("a_301", 30, "child", "name", "Thomas Smith")],
      links: [link("pe_030", "a_301", "I4")],
      namesakes: [row("ns_001", T)],
    }));
  });

  it("MS20 merges a fact cited from a negative search whose only link is absent basis", async () => {
    await merged([[T, "I7"]], project({
      persons: [person(T, "John", "Smith"), person("I7", "John", "Smith", "Male", { facts: [fact("F1", "Death", "before 1850", ["S42"])] })],
      sources: [42],
      assertions: [assertion("a_421", 42, "principal", "death", "No death record before 1850", { record_basis: "absent" })],
      links: [link("pe_042", "a_421", "I7")],
      namesakes: [row("ns_001", T)],
    }));
  });

  it("MS21 does not judge a person-level source the row holder already holds", async () => {
    await merged([[T, "I7"]], project({
      persons: [person(T, "John", "Smith", "Male", { sources: [{ ref: "S12" }] }), person("I7", "John", "Smith", "Male", { sources: [{ ref: "S12" }] })],
      sources: [12],
      assertions: [assertion("a_121", 12, "principal", "birth", "1873")],
      links: [link("pe_012", "a_121", T)],
      namesakes: [row("ns_001", T)],
    }));
  });
});

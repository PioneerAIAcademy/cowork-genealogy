import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm, access } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { materializeFacts } from "../../src/tools/materialize-facts.js";

// ─── fixture builders (valid research.json + tree.gedcomx.json) ───────────────

function source(id: string, sdid: string, over: Record<string, unknown> = {}) {
  return {
    id,
    gedcomx_source_description_id: sdid,
    citation: "Test citation",
    citation_detail: { who: "", what: "", when_created: "", when_accessed: "", where: "", where_within: "" },
    source_classification: "original",
    repository: "Test Repository",
    access_date: "2026-01-01",
    ...over,
  };
}

function assertion(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    source_id: "src_001",
    record_id: "REC",
    record_role: "principal",
    record_persona_id: null,
    fact_type: "birth",
    value: "",
    date: null,
    place: null,
    standard_place: null,
    information_quality: "primary" as const,
    informant: "unknown",
    informant_proximity: "official_duty" as const,
    evidence_type: "direct" as const,
    extracted_for_question_ids: [] as string[],
    ...over,
  };
}

function research(opts: { sources: any[]; assertions: any[]; subjectIds?: string[] }) {
  return {
    project: {
      id: "rp_001",
      objective: "Test",
      status: "active",
      created: "2026-01-01",
      updated: "2026-01-01",
      subject_person_ids: opts.subjectIds ?? ["I1"],
    },
    questions: [],
    plans: [],
    log: [],
    sources: opts.sources,
    assertions: opts.assertions,
    person_evidence: [],
    conflicts: [],
    hypotheses: [],
    timelines: [],
    proof_summaries: [],
    evaluations: [],
  };
}

/** Subject I1 always present so subject_person_ids resolves; extra persons via `persons`. */
function tree(opts: { persons?: any[]; sources?: any[] } = {}) {
  return {
    persons: [
      { id: "I1", gender: "Male", names: [{ id: "N1", given: "John", surname: "Smith" }] },
      ...(opts.persons ?? []),
    ],
    relationships: [],
    sources: opts.sources ?? [{ id: "S1", title: "1850 Census" }],
  };
}

const S1 = source("src_001", "S1");

// GOLDEN anti-regression helper (spec §6 / Test strategy): every fact + name a
// writer AUTHORED carries a non-empty sources[] with a non-null ref pointing at
// an existing tree S-entry. Scoped to written content (the materialized person),
// NOT the whole tree.
function assertWrittenNodesHaveRefs(treeDoc: any, person: any) {
  const sourceIds = new Set((treeDoc.sources ?? []).map((s: any) => s.id));
  const nodes = [...(person.facts ?? []), ...(person.names ?? [])];
  expect(nodes.length).toBeGreaterThan(0);
  let refless = 0;
  for (const n of nodes) {
    const refs = Array.isArray(n.sources) ? n.sources : [];
    const ok = refs.length > 0 && refs.every((r: any) => r.ref != null && sourceIds.has(r.ref));
    if (!ok) refless++;
  }
  expect(refless).toBe(0); // inverts the cruz "0/13 facts carried a ref" leak
}

describe("materialize_facts", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "materialize-facts-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeProject(treeDoc: any, researchDoc: any) {
    await writeFile(join(dir, "research.json"), JSON.stringify(researchDoc, null, 2), "utf-8");
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(treeDoc, null, 2), "utf-8");
  }
  const readTree = async () => JSON.parse(await readFile(join(dir, "tree.gedcomx.json"), "utf-8"));
  const exists = async (name: string) => access(join(dir, name)).then(() => true, () => false);
  const findPerson = (t: any, id: string) => t.persons.find((p: any) => p.id === id);

  // The create-or-enrich persona: a name, a gender, and a Birth for a new son.
  const enrichPersona = () => [
    assertion("a_001", { record_id: "REC-SON", record_role: "child", fact_type: "name", value: "Robert Smith" }),
    assertion("a_002", { record_id: "REC-SON", record_role: "child", fact_type: "gender", value: "Male" }),
    assertion("a_003", {
      record_id: "REC-SON",
      record_role: "child",
      fact_type: "birth",
      date: "1855",
      place: "Provo, Utah, United States",
    }),
  ];

  it("(1) create-or-enrich mints a NEW person WITH facts (never fact-less)", async () => {
    await writeProject(tree(), research({ sources: [S1], assertions: enrichPersona() }));

    const result = await materializeFacts({ projectPath: dir, personId: "I2", recordId: "REC-SON", recordRole: "child" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.personId).toBe("I2");
    expect(result.created).toBe(true);
    expect(result.factsAdded).toBe(1);
    expect(result.namesAdded).toBe(1);
    expect(result.refsAttached).toBe(2); // one on the name, one on the Birth
    expect(result.filesWritten).toEqual(["tree.gedcomx.json"]);

    const t = await readTree();
    const p = findPerson(t, "I2");
    expect(p).toBeTruthy();
    expect(p.gender).toBe("Male");
    expect(p.names).toHaveLength(1);
    expect(p.names[0]).toMatchObject({ given: "Robert", surname: "Smith" });
    expect(p.facts).toHaveLength(1);
    expect(p.facts[0]).toMatchObject({ type: "Birth", date: "1855" });
    expect(p.facts[0].sources).toEqual([{ ref: "S1", quality: 3 }]);
    // A person minted from a record is structurally never fact-less.
    expect(p.facts.length).toBeGreaterThan(0);
  });

  it("(2) enriches an existing fact-less stub (person exists, gains a sourced fact)", async () => {
    const stub = { id: "I2", gender: "Male", names: [{ id: "N2", given: "Robert", surname: "Smith" }] };
    await writeProject(
      tree({ persons: [stub] }),
      research({
        sources: [S1],
        assertions: [assertion("a_001", { record_id: "REC2", record_role: "principal", fact_type: "birth", date: "1855" })],
      }),
    );

    const result = await materializeFacts({ projectPath: dir, personId: "I2", recordId: "REC2", recordRole: "principal" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toBe(false);
    expect(result.factsAdded).toBe(1);

    const p = findPerson(await readTree(), "I2");
    expect(p.facts).toHaveLength(1);
    expect(p.facts[0]).toMatchObject({ type: "Birth", date: "1855" });
    expect(p.facts[0].sources).toEqual([{ ref: "S1", quality: 3 }]);
  });

  it("(3) is idempotent — a re-run adds no duplicate facts or refs", async () => {
    await writeProject(tree(), research({ sources: [S1], assertions: enrichPersona() }));

    const first = await materializeFacts({ projectPath: dir, personId: "I2", recordId: "REC-SON", recordRole: "child" });
    expect(first.ok).toBe(true);

    const second = await materializeFacts({ projectPath: dir, personId: "I2", recordId: "REC-SON", recordRole: "child" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.created).toBe(false);
    expect(second.factsAdded).toBe(0);
    expect(second.factsEnriched).toBe(0);
    expect(second.namesAdded).toBe(0);
    expect(second.refsAttached).toBe(0);

    const p = findPerson(await readTree(), "I2");
    expect(p.facts).toHaveLength(1);
    expect(p.facts[0].sources).toHaveLength(1); // no duplicate ref
    expect(p.names).toHaveLength(1);
    expect(p.names[0].sources).toHaveLength(1);
  });

  it("(4) two agreeing values union onto ONE fact carrying BOTH refs", async () => {
    const stub = { id: "I2", gender: "Male", names: [{ id: "N2", given: "Jane", surname: "Doe" }] };
    await writeProject(
      tree({ persons: [stub], sources: [{ id: "S1", title: "Census A" }, { id: "S2", title: "Census B" }] }),
      research({
        sources: [source("src_001", "S1"), source("src_002", "S2")],
        assertions: [
          assertion("a_001", { source_id: "src_001", record_id: "REC-A", record_role: "principal", fact_type: "birth", date: "1850", place: "Nauvoo, Illinois, United States" }),
          assertion("a_002", { source_id: "src_002", record_id: "REC-B", record_role: "principal", fact_type: "birth", date: "1850", place: "Nauvoo, Illinois, United States" }),
        ],
      }),
    );

    const r1 = await materializeFacts({ projectPath: dir, personId: "I2", recordId: "REC-A", recordRole: "principal" });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.factsAdded).toBe(1);

    const r2 = await materializeFacts({ projectPath: dir, personId: "I2", recordId: "REC-B", recordRole: "principal" });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.factsAdded).toBe(0);
    expect(r2.factsEnriched).toBe(1);
    expect(r2.refsAttached).toBe(1);

    const p = findPerson(await readTree(), "I2");
    const births = p.facts.filter((f: any) => f.type === "Birth");
    expect(births).toHaveLength(1); // agreeing → ONE fact
    expect(births[0].sources.map((s: any) => s.ref).sort()).toEqual(["S1", "S2"]);
  });

  it("(5) two CONFLICTING births COEXIST as two facts AND appear in conflicts_surfaced", async () => {
    const stub = { id: "I2", gender: "Male", names: [{ id: "N2", given: "Sam", surname: "Vital" }] };
    await writeProject(
      tree({ persons: [stub] }),
      research({
        sources: [S1],
        assertions: [
          assertion("a_001", { record_id: "REC5", record_role: "principal", fact_type: "birth", date: "1850", place: "Nauvoo, Illinois, United States" }),
          assertion("a_002", { record_id: "REC5", record_role: "principal", fact_type: "birth", date: "1888", place: "Ogden, Utah, United States" }),
        ],
      }),
    );

    const result = await materializeFacts({ projectPath: dir, personId: "I2", recordId: "REC5", recordRole: "principal" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.factsAdded).toBe(2); // value not lost to a (type, value) collapse
    expect(result.conflicts_surfaced).toHaveLength(1);
    expect(result.conflicts_surfaced[0]).toMatchObject({ personId: "I2", factType: "Birth" });
    expect(result.conflicts_surfaced[0].values).toHaveLength(2);

    const p = findPerson(await readTree(), "I2");
    const births = p.facts.filter((f: any) => f.type === "Birth");
    expect(births).toHaveLength(2); // coexist
    for (const b of births) expect(b.sources).toEqual([{ ref: "S1", quality: 3 }]);
  });

  it("(6) a multi-valued type (Occupation) coexists WITHOUT surfacing a conflict", async () => {
    const stub = { id: "I2", gender: "Male", names: [{ id: "N2", given: "Multi", surname: "Job" }] };
    await writeProject(
      tree({ persons: [stub] }),
      research({
        sources: [S1],
        assertions: [
          assertion("a_001", { record_id: "REC6", record_role: "principal", fact_type: "occupation", value: "Farmer" }),
          assertion("a_002", { record_id: "REC6", record_role: "principal", fact_type: "occupation", value: "Blacksmith" }),
        ],
      }),
    );

    const result = await materializeFacts({ projectPath: dir, personId: "I2", recordId: "REC6", recordRole: "principal" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.factsAdded).toBe(2); // both values kept
    expect(result.conflicts_surfaced).toHaveLength(0); // Occupation is not vital

    const p = findPerson(await readTree(), "I2");
    const occ = p.facts.filter((f: any) => f.type === "Occupation");
    expect(occ.map((f: any) => f.value).sort()).toEqual(["Blacksmith", "Farmer"]);
    for (const f of occ) expect(f.sources).toEqual([{ ref: "S1", quality: 3 }]);
  });

  it("(7) a missing tree S-entry is an ERROR (never a silent null ref), writes nothing", async () => {
    // The research source points at S99, which is absent from the tree.
    await writeProject(
      tree(), // tree.sources has only S1
      research({
        sources: [source("src_001", "S99")],
        assertions: [assertion("a_001", { record_id: "REC7", record_role: "principal", fact_type: "birth", date: "1855" })],
      }),
    );
    const treeBefore = await readFile(join(dir, "tree.gedcomx.json"), "utf-8");

    const result = await materializeFacts({ projectPath: dir, personId: "I2", recordId: "REC7", recordRole: "principal" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/S99/);
    expect(await readFile(join(dir, "tree.gedcomx.json"), "utf-8")).toBe(treeBefore);
    expect(await exists("tree.gedcomx.json.bak")).toBe(false);
  });

  it("(8) GOLDEN: every fact and name written carries a non-null source-ref", async () => {
    await writeProject(tree(), research({ sources: [S1], assertions: enrichPersona() }));

    const result = await materializeFacts({ projectPath: dir, personId: "I2", recordId: "REC-SON", recordRole: "child" });
    expect(result.ok).toBe(true);

    const p = findPerson(await readTree(), "I2");
    assertWrittenNodesHaveRefs(await readTree(), p);
  });

  it("(9) NEVER sets primary on facts or preferred on names", async () => {
    // Exercise the multi-fact conflict path so several facts/names are authored.
    const persona = [
      ...enrichPersona(),
      assertion("a_004", { record_id: "REC-SON", record_role: "child", fact_type: "birth", date: "1899", place: "Ogden, Utah, United States" }),
      assertion("a_005", { record_id: "REC-SON", record_role: "child", fact_type: "occupation", value: "Farmer" }),
    ];
    await writeProject(tree(), research({ sources: [S1], assertions: persona }));

    const result = await materializeFacts({ projectPath: dir, personId: "I2", recordId: "REC-SON", recordRole: "child" });
    expect(result.ok).toBe(true);

    const p = findPerson(await readTree(), "I2");
    for (const f of p.facts ?? []) expect("primary" in f).toBe(false);
    for (const n of p.names ?? []) expect("preferred" in n).toBe(false);
  });

  it("(10) indirect evidence rides a lower source-ref quality (2), not 3", async () => {
    const stub = { id: "I2", gender: "Male", names: [{ id: "N2", given: "Ind", surname: "Rect" }] };
    await writeProject(
      tree({ persons: [stub] }),
      research({
        sources: [S1],
        assertions: [
          assertion("a_001", { record_id: "REC10", record_role: "principal", fact_type: "birth", date: "1855", evidence_type: "indirect" }),
        ],
      }),
    );

    const result = await materializeFacts({ projectPath: dir, personId: "I2", recordId: "REC10", recordRole: "principal" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const p = findPerson(await readTree(), "I2");
    const birth = p.facts.find((f: any) => f.type === "Birth");
    // §7.1/§8: an indirect claim carries a weaker QUAY on its ref than a direct one.
    expect(birth.sources).toEqual([{ ref: "S1", quality: 2 }]);
  });

  it("(11) two distinct name assertions coexist as two sourced name nodes", async () => {
    // A legacy placeholder name (no ref, tolerated) plus two distinct authored names.
    const stub = { id: "I2", gender: "Male", names: [{ id: "N2", given: "Placeholder", surname: "Stub" }] };
    await writeProject(
      tree({ persons: [stub] }),
      research({
        sources: [S1],
        assertions: [
          assertion("a_001", { record_id: "REC11", record_role: "principal", fact_type: "name", value: "Robert Smith" }),
          assertion("a_002", { record_id: "REC11", record_role: "principal", fact_type: "name", value: "Bob Jones" }),
        ],
      }),
    );

    const result = await materializeFacts({ projectPath: dir, personId: "I2", recordId: "REC11", recordRole: "principal" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.namesAdded).toBe(2); // two distinct names, neither collapsed onto the other

    const p = findPerson(await readTree(), "I2");
    const authored = p.names.filter((n: any) => (n.sources ?? []).length > 0);
    expect(authored).toHaveLength(2);
    expect(authored.map((n: any) => `${n.given} ${n.surname}`).sort()).toEqual(["Bob Jones", "Robert Smith"]);
    for (const n of authored) expect(n.sources[0]).toMatchObject({ ref: "S1" });
  });

  it("(12) omitting personId auto-mints the next allocated I id, WITH facts", async () => {
    // Seed I5 so the allocator must walk the max (→ I6), not coincidentally land on I2.
    const other = { id: "I5", gender: "Female", names: [{ id: "N9", given: "Ann", surname: "Smith" }] };
    await writeProject(tree({ persons: [other] }), research({ sources: [S1], assertions: enrichPersona() }));

    const result = await materializeFacts({ projectPath: dir, recordId: "REC-SON", recordRole: "child" }); // no personId
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toBe(true);
    expect(result.personId).toBe("I6"); // nextId over { I1, I5 }

    const p = findPerson(await readTree(), "I6");
    expect(p.names).toHaveLength(1);
    expect(p.facts.length).toBeGreaterThan(0); // minted WITH facts, never fact-less
    expect(p.facts[0].sources).toEqual([{ ref: "S1", quality: 3 }]);
  });

  it("(13) negative evidence is not materialized as a positive tree fact (spec §7.1)", async () => {
    const stub = { id: "I2", gender: "Male", names: [{ id: "N2", given: "Neg", surname: "Absent" }] };
    await writeProject(
      tree({ persons: [stub] }),
      research({
        sources: [S1],
        assertions: [
          assertion("a_001", {
            record_id: "REC13",
            record_role: "absent",
            fact_type: "residence",
            place: "Schuylkill, Pennsylvania, United States",
            value: "expected but absent from the 1870 census",
            evidence_type: "negative",
          }),
        ],
      }),
    );

    const result = await materializeFacts({ projectPath: dir, personId: "I2", recordId: "REC13", recordRole: "absent" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.factsAdded).toBe(0); // the absence feeds proof-conclusion, not a tree fact
    expect(result.factsEnriched).toBe(0);

    const p = findPerson(await readTree(), "I2");
    expect((p.facts ?? []).length).toBe(0);
  });
});

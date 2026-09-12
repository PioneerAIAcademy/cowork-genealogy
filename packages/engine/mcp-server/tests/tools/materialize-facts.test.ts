import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { single } from "../helpers/narrow.js";
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

    const result = single(await materializeFacts({ projectPath: dir, personId: "I2", recordId: "REC-SON", recordRole: "child" }));

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

    const result = single(await materializeFacts({ projectPath: dir, personId: "I2", recordId: "REC2", recordRole: "principal" }));

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

    const first = single(await materializeFacts({ projectPath: dir, personId: "I2", recordId: "REC-SON", recordRole: "child" }));
    expect(first.ok).toBe(true);

    const second = single(await materializeFacts({ projectPath: dir, personId: "I2", recordId: "REC-SON", recordRole: "child" }));
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

    const r1 = single(await materializeFacts({ projectPath: dir, personId: "I2", recordId: "REC-A", recordRole: "principal" }));
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.factsAdded).toBe(1);

    const r2 = single(await materializeFacts({ projectPath: dir, personId: "I2", recordId: "REC-B", recordRole: "principal" }));
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

    const result = single(await materializeFacts({ projectPath: dir, personId: "I2", recordId: "REC5", recordRole: "principal" }));

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

    const result = single(await materializeFacts({ projectPath: dir, personId: "I2", recordId: "REC6", recordRole: "principal" }));

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

    const result = single(await materializeFacts({ projectPath: dir, personId: "I2", recordId: "REC7", recordRole: "principal" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/S99/);
    expect(await readFile(join(dir, "tree.gedcomx.json"), "utf-8")).toBe(treeBefore);
    expect(await exists("tree.gedcomx.json.bak")).toBe(false);
  });

  it("(8) GOLDEN: every fact and name written carries a non-null source-ref", async () => {
    await writeProject(tree(), research({ sources: [S1], assertions: enrichPersona() }));

    const result = single(await materializeFacts({ projectPath: dir, personId: "I2", recordId: "REC-SON", recordRole: "child" }));
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

    const result = single(await materializeFacts({ projectPath: dir, personId: "I2", recordId: "REC-SON", recordRole: "child" }));
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

    const result = single(await materializeFacts({ projectPath: dir, personId: "I2", recordId: "REC10", recordRole: "principal" }));
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

    const result = single(await materializeFacts({ projectPath: dir, personId: "I2", recordId: "REC11", recordRole: "principal" }));
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

    const result = single(await materializeFacts({ projectPath: dir, recordId: "REC-SON", recordRole: "child" })); // no personId
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

    const result = single(await materializeFacts({ projectPath: dir, personId: "I2", recordId: "REC13", recordRole: "absent" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.factsAdded).toBe(0); // the absence feeds proof-conclusion, not a tree fact
    expect(result.factsEnriched).toBe(0);

    const p = findPerson(await readTree(), "I2");
    expect((p.facts ?? []).length).toBe(0);
  });

  // ── Batch form (`ops[]`) — mirrors tree-edit.test.ts's own batch suite ────────

  it("(14) batch: multiple personas materialize in one validate-once/write-once call", async () => {
    const stub = { id: "I3", gender: "Female", names: [{ id: "N3", given: "Ann", surname: "Doe" }] };
    await writeProject(
      tree({ persons: [stub] }),
      research({
        sources: [S1],
        assertions: [
          ...enrichPersona(), // REC-SON / child -> new person
          assertion("a_010", { record_id: "REC14", record_role: "principal", fact_type: "birth", date: "1852" }),
        ],
      }),
    );

    const result = await materializeFacts({
      projectPath: dir,
      ops: [
        { personId: "I2", recordId: "REC-SON", recordRole: "child" },
        { personId: "I3", recordId: "REC14", recordRole: "principal" },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok || !("results" in result)) return;
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({ personId: "I2", created: true, factsAdded: 1, namesAdded: 1 });
    expect(result.results[1]).toMatchObject({ personId: "I3", created: false, factsAdded: 1 });
    expect(result.filesWritten).toEqual(["tree.gedcomx.json"]);

    const t = await readTree();
    expect(findPerson(t, "I2")).toBeTruthy();
    expect(findPerson(t, "I3").facts).toHaveLength(1);
    // One atomic write cycle for the whole batch, and no readable `.bak` copy
    // left beside the tree.
    expect(await exists("tree.gedcomx.json.bak")).toBe(false);
  });

  it("(15) batch all-or-nothing: op[1] failing writes NOTHING, not even op[0]'s facts", async () => {
    await writeProject(
      tree(), // tree.sources has only S1
      research({
        sources: [S1, source("src_099", "S99")],
        assertions: [
          ...enrichPersona(), // REC-SON / child, resolves fine via S1
          assertion("a_099", {
            source_id: "src_099",
            record_id: "REC15",
            record_role: "principal",
            fact_type: "birth",
            date: "1860",
          }),
        ],
      }),
    );
    const before = await readFile(join(dir, "tree.gedcomx.json"), "utf-8");

    const result = await materializeFacts({
      projectPath: dir,
      ops: [
        { personId: "I2", recordId: "REC-SON", recordRole: "child" },
        { personId: "I3", recordId: "REC15", recordRole: "principal" }, // S99 has no tree S-entry
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/^ops\[1\]:/);
    expect(result.errors.join(" ")).toMatch(/S99/);
    expect(await readFile(join(dir, "tree.gedcomx.json"), "utf-8")).toBe(before); // op[0]'s facts also rolled back
    expect(await exists("tree.gedcomx.json.bak")).toBe(false);
  });

  it("(16) batch id-allocator continuity: two create-or-enrich ops (personId omitted) mint DISTINCT ids", async () => {
    await writeProject(
      tree(), // only I1 present
      research({
        sources: [S1],
        assertions: [
          assertion("a_020", { record_id: "REC16A", record_role: "child", fact_type: "name", value: "Alice Smith" }),
          assertion("a_021", { record_id: "REC16A", record_role: "child", fact_type: "birth", date: "1851" }),
          assertion("a_022", { record_id: "REC16B", record_role: "child", fact_type: "name", value: "Bea Smith" }),
          assertion("a_023", { record_id: "REC16B", record_role: "child", fact_type: "birth", date: "1853" }),
        ],
      }),
    );

    const result = await materializeFacts({
      projectPath: dir,
      ops: [
        { recordId: "REC16A", recordRole: "child" }, // personId omitted
        { recordId: "REC16B", recordRole: "child" }, // personId omitted
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok || !("results" in result)) return;
    expect(result.results).toHaveLength(2);
    expect(result.results[0].created).toBe(true);
    expect(result.results[1].created).toBe(true);
    expect(result.results[0].personId).toBe("I2");
    expect(result.results[1].personId).toBe("I3"); // must not collide with I2

    const t = await readTree();
    expect(findPerson(t, "I2").names[0].given).toBe("Alice");
    expect(findPerson(t, "I3").names[0].given).toBe("Bea");
  });

  it("(17) batch: conflicts_surfaced is scoped to the op that authored it, not leaked across ops", async () => {
    const stub3 = { id: "I3", gender: "Female", names: [{ id: "N3", given: "Clean", surname: "One" }] };
    await writeProject(
      tree({ persons: [stub3] }),
      research({
        sources: [S1],
        assertions: [
          assertion("a_029", { record_id: "REC17A", record_role: "principal", fact_type: "name", value: "Conflict Vital" }),
          assertion("a_030", { record_id: "REC17A", record_role: "principal", fact_type: "birth", date: "1850", place: "Nauvoo, Illinois, United States" }),
          assertion("a_031", { record_id: "REC17A", record_role: "principal", fact_type: "birth", date: "1888", place: "Ogden, Utah, United States" }),
          assertion("a_032", { record_id: "REC17B", record_role: "principal", fact_type: "birth", date: "1852" }),
        ],
      }),
    );

    const result = await materializeFacts({
      projectPath: dir,
      ops: [
        { personId: "I2", recordId: "REC17A", recordRole: "principal" }, // new person, conflicting births
        { personId: "I3", recordId: "REC17B", recordRole: "principal" }, // existing stub, clean birth
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok || !("results" in result)) return;
    expect(result.results[0].conflicts_surfaced).toHaveLength(1);
    expect(result.results[0].conflicts_surfaced[0].personId).toBe("I2");
    expect(result.results[1].conflicts_surfaced).toHaveLength(0); // I3's clean birth is not contaminated by I2's conflict
  });

  it("(18) batch: the same persona listed twice in one call is idempotent (second occurrence is a no-op)", async () => {
    await writeProject(tree(), research({ sources: [S1], assertions: enrichPersona() }));

    const result = await materializeFacts({
      projectPath: dir,
      ops: [
        { personId: "I2", recordId: "REC-SON", recordRole: "child" },
        { personId: "I2", recordId: "REC-SON", recordRole: "child" }, // duplicate within the same batch
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok || !("results" in result)) return;
    expect(result.results[0].created).toBe(true);
    expect(result.results[0].factsAdded).toBe(1);
    expect(result.results[1].created).toBe(false); // person now exists (minted by op 0, same batch)
    expect(result.results[1].factsAdded).toBe(0);
    expect(result.results[1].namesAdded).toBe(0);
    expect(result.results[1].refsAttached).toBe(0);

    const p = findPerson(await readTree(), "I2");
    expect(p.facts).toHaveLength(1);
    expect(p.facts[0].sources).toHaveLength(1); // no duplicate ref
    expect(p.names).toHaveLength(1);
  });

  // ── String-coercion: the model sometimes serializes a large `ops` batch as a
  // JSON *string* (see coerce-json-arg.ts). The tool recovers it rather than
  // rejecting it into a slow one-op-per-call fallback.
  it("(19) a JSON-stringified `ops` array is coerced", async () => {
    await writeProject(tree(), research({ sources: [S1], assertions: enrichPersona() }));

    const opsArray = [{ personId: "I2", recordId: "REC-SON", recordRole: "child" }];
    const result = await materializeFacts({ projectPath: dir, ops: JSON.stringify(opsArray) as any });

    expect(result.ok).toBe(true);
    if (!result.ok || !("results" in result)) return;
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({ personId: "I2", created: true, factsAdded: 1 });
  });

  it("(20) rejects an empty ops array", async () => {
    await writeProject(tree(), research({ sources: [S1], assertions: [] }));
    const result = await materializeFacts({ projectPath: dir, ops: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/non-empty/);
  });

  // ── `marriage` is a Couple-relationship event, never a person-level fact
  // (ut_person_evidence_022 regression: an existing spouse's persona whose only
  // assertion was `marriage` got materialized straight onto that person, leaving
  // the Couple relationship itself factless — tree_edit add_relationship owns it) ──

  it("(21) a `marriage` assertion is skipped — never materialized as a person-level fact", async () => {
    const stub = { id: "I2", gender: "Male", names: [{ id: "N2", given: "Thomas", surname: "Flynn" }] };
    await writeProject(
      tree({ persons: [stub] }),
      research({
        sources: [S1],
        assertions: [
          assertion("a_005", {
            record_id: "REC-MARR",
            record_role: "principal",
            fact_type: "marriage",
            date: "12 May 1843",
            place: "Schuylkill County, Pennsylvania, United States",
          }),
        ],
      }),
    );

    const result = single(await materializeFacts({ projectPath: dir, personId: "I2", recordId: "REC-MARR", recordRole: "principal" }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.factsAdded).toBe(0); // never a correct person-level write
    expect(result.factsEnriched).toBe(0);
    expect(result.refsAttached).toBe(0);

    const p = findPerson(await readTree(), "I2");
    expect((p.facts ?? []).length).toBe(0); // the Couple relationship + fact is tree_edit's job
  });

  it("(22) a persona's OTHER assertions still materialize when a `marriage` assertion is mixed in", async () => {
    const stub = { id: "I2", gender: "Male", names: [{ id: "N2", given: "Thomas", surname: "Flynn" }] };
    await writeProject(
      tree({ persons: [stub] }),
      research({
        sources: [S1],
        assertions: [
          assertion("a_005", { record_id: "REC-MARR", record_role: "principal", fact_type: "marriage", date: "12 May 1843" }),
          assertion("a_006", {
            record_id: "REC-MARR",
            record_role: "principal",
            fact_type: "residence",
            value: "Schuylkill County, Pennsylvania, United States",
          }),
        ],
      }),
    );

    const result = single(await materializeFacts({ projectPath: dir, personId: "I2", recordId: "REC-MARR", recordRole: "principal" }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.factsAdded).toBe(1); // only Residence — the skip is scoped to the one assertion

    const p = findPerson(await readTree(), "I2");
    expect(p.facts).toHaveLength(1);
    expect(p.facts[0].type).toBe("Residence");
  });

  // ─── the NAMED-PARTY arm (§4.6) ───────────────────────────────────────────
  //
  // A party the record names only INSIDE another persona's relationship/marriage
  // assertion: no record_role, no name assertion, so the persona arm has nothing
  // to select on. Before this arm she could only be written by tree_edit
  // add_person, whose name path is ref-tolerant — so a record-derived person
  // landed with NO provenance. These cases pin that the ref is now enforced.

  /** The bride case: a marriage assertion on the GROOM's persona that names Mary Doyle. */
  const marriageNamingBride = () => [
    assertion("a_005", {
      record_id: "REC-MARR",
      record_role: "groom",
      fact_type: "marriage",
      value: "Thomas Flynn married Mary Doyle, 12 May 1843, Schuylkill County, Pennsylvania",
      date: "12 May 1843",
    }),
  ];

  it("(23) mints the named party with an ENFORCED, resolved source-ref on her name", async () => {
    await writeProject(tree(), research({ sources: [S1], assertions: marriageNamingBride() }));

    const result = single(
      await materializeFacts({
        projectPath: dir,
        assertionId: "a_005",
        relatedRole: "bride",
        name: { given: "Mary", surname: "Doyle" },
        gender: "Female",
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toBe(true);
    expect(result.namesAdded).toBe(1);
    expect(result.refsAttached).toBe(1);
    // The whole point: a name, and no fact — the marriage stays on the Couple.
    expect(result.factsAdded).toBe(0);
    expect(result.factsEnriched).toBe(0);
    expect(result.conflicts_surfaced).toEqual([]);

    const p = findPerson(await readTree(), result.personId);
    expect(p.gender).toBe("Female");
    expect(p.names).toHaveLength(1);
    expect(p.names[0]).toMatchObject({ given: "Mary", surname: "Doyle" });
    // No name type asserted: the caller did not say, and the record does not
    // settle whether "Doyle" is her own surname or a married one.
    expect(p.names[0].type).toBeUndefined();
    // Resolved from the assertion's own source_id — never null, never hand-passed.
    expect(p.names[0].sources).toEqual([{ ref: "S1", quality: 3 }]);
    // proof-conclusion alone concludes a preferred name.
    expect(p.names[0].preferred).toBeUndefined();
    expect(p.facts ?? []).toEqual([]);
  });

  it("(24) enriches an EXISTING person — adds the sourced name, does not re-mint", async () => {
    const existing = { id: "I2", gender: "Female", names: [{ id: "N2", given: "Mary", surname: "Kelly" }] };
    await writeProject(
      tree({ persons: [existing] }),
      research({ sources: [S1], assertions: marriageNamingBride() }),
    );

    const result = single(
      await materializeFacts({
        projectPath: dir,
        personId: "I2",
        assertionId: "a_005",
        relatedRole: "bride",
        name: { given: "Mary", surname: "Doyle" },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toBe(false);
    expect(result.namesAdded).toBe(1);

    const t2 = await readTree();
    expect(t2.persons).toHaveLength(2); // I1 + I2, nobody minted
    const p = findPerson(t2, "I2");
    expect(p.names).toHaveLength(2); // the maiden name coexists with the existing one
    expect(p.names[1].sources).toEqual([{ ref: "S1", quality: 3 }]);
  });

  it("(25) idempotent for a given personId — a re-run adds no duplicate name or ref", async () => {
    await writeProject(tree(), research({ sources: [S1], assertions: marriageNamingBride() }));
    const call = () =>
      materializeFacts({
        projectPath: dir,
        personId: "I2",
        assertionId: "a_005",
        relatedRole: "bride",
        name: { given: "Mary", surname: "Doyle" },
        gender: "Female",
      });

    const first = single(await call());
    expect(first.ok).toBe(true);
    const second = single(await call());
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.created).toBe(false);
    expect(second.namesAdded).toBe(0);
    expect(second.refsAttached).toBe(0);

    const p = findPerson(await readTree(), "I2");
    expect(p.names).toHaveLength(1);
    expect(p.names[0].sources).toHaveLength(1);
  });

  it("(26) mints the bride and writes NO Marriage fact anywhere — §4.5 holds", async () => {
    const groom = { id: "I2", gender: "Male", names: [{ id: "N2", given: "Thomas", surname: "Flynn" }] };
    await writeProject(
      tree({ persons: [groom] }),
      research({ sources: [S1], assertions: marriageNamingBride() }),
    );

    const result = single(
      await materializeFacts({
        projectPath: dir,
        assertionId: "a_005",
        relatedRole: "bride",
        name: { given: "Mary", surname: "Doyle" },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const t2 = await readTree();
    // No Marriage fact on ANY person, and no relationship edge — the Couple event
    // and the edge stay tree_edit add_relationship's job.
    for (const person of t2.persons) {
      expect((person.facts ?? []).some((f: any) => f.type === "Marriage")).toBe(false);
    }
    expect(t2.relationships).toEqual([]);
  });

  it("(27) a missing tree S-entry is an ERROR and writes NOTHING (never a null ref)", async () => {
    await writeProject(
      tree({ sources: [{ id: "S9", title: "Some other source" }] }),
      research({ sources: [S1], assertions: marriageNamingBride() }),
    );

    const result = single(
      await materializeFacts({
        projectPath: dir,
        assertionId: "a_005",
        relatedRole: "bride",
        name: { given: "Mary", surname: "Doyle" },
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toContain("S1");
    // Nothing half-written: no person, and no backup implying a write was tried.
    const t2 = await readTree();
    expect(t2.persons).toHaveLength(1);
    expect(await exists("tree.gedcomx.json.bak")).toBe(false);
  });

  it("(28) refuses an assertion that names no second party (a `birth` assertion)", async () => {
    await writeProject(
      tree(),
      research({
        sources: [S1],
        assertions: [assertion("a_007", { record_role: "child", fact_type: "birth", date: "1855" })],
      }),
    );

    const result = single(
      await materializeFacts({
        projectPath: dir,
        assertionId: "a_007",
        relatedRole: "mother",
        name: { given: "Bridget", surname: "Doyle" },
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toContain("fact_type 'birth'");
    expect(result.errors[0]).toContain("recordId/recordRole");
    expect((await readTree()).persons).toHaveLength(1);
  });

  it("(29) refuses a relatedRole that is the assertion's OWN record_role", async () => {
    await writeProject(tree(), research({ sources: [S1], assertions: marriageNamingBride() }));

    const result = single(
      await materializeFacts({
        projectPath: dir,
        assertionId: "a_005",
        relatedRole: "Groom", // the persona itself — case-insensitively
        name: { given: "Thomas", surname: "Flynn" },
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toContain("own record_role");
    expect((await readTree()).persons).toHaveLength(1);
  });

  it("(30) refuses an empty name, an unknown assertionId, and both forms at once", async () => {
    await writeProject(tree(), research({ sources: [S1], assertions: marriageNamingBride() }));

    const empty = single(
      await materializeFacts({
        projectPath: dir,
        assertionId: "a_005",
        relatedRole: "bride",
        name: { given: "   ", surname: "" },
      }),
    );
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.errors[0]).toContain("non-empty given or surname");

    const missing = single(
      await materializeFacts({
        projectPath: dir,
        assertionId: "a_nope",
        relatedRole: "bride",
        name: { given: "Mary", surname: "Doyle" },
      }),
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors[0]).toContain("not found in research.json");

    const both = single(
      await materializeFacts({
        projectPath: dir,
        assertionId: "a_005",
        relatedRole: "bride",
        name: { given: "Mary", surname: "Doyle" },
        recordId: "REC-MARR",
        recordRole: "groom",
      }),
    );
    expect(both.ok).toBe(false);
    if (!both.ok) expect(both.errors[0]).toContain("not both");

    const neither = single(await materializeFacts({ projectPath: dir, personId: "I2" }));
    expect(neither.ok).toBe(false);
    if (!neither.ok) expect(neither.errors[0]).toContain("supply either");

    expect((await readTree()).persons).toHaveLength(1); // no partial write from any of them
  });

  it("(31) batch: a persona op and a named-party op apply in ONE all-or-nothing call", async () => {
    await writeProject(
      tree(),
      research({
        sources: [S1],
        assertions: [
          assertion("a_001", { record_id: "REC-MARR", record_role: "groom", fact_type: "name", value: "Thomas Flynn" }),
          assertion("a_002", { record_id: "REC-MARR", record_role: "groom", fact_type: "residence", value: "Schuylkill County" }),
          ...marriageNamingBride(),
        ],
      }),
    );

    const result = await materializeFacts({
      projectPath: dir,
      ops: [
        { personId: "I2", recordId: "REC-MARR", recordRole: "groom" },
        { assertionId: "a_005", relatedRole: "bride", name: { given: "Mary", surname: "Doyle" }, gender: "Female" },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok || !("results" in result)) return;
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({ personId: "I2", created: true, factsAdded: 1, namesAdded: 1 });
    expect(result.results[1]).toMatchObject({ created: true, factsAdded: 0, namesAdded: 1 });
    // The named-party op saw the id the persona op minted, so the bride gets a
    // DISTINCT id rather than colliding with the groom.
    expect(result.results[1].personId).not.toBe("I2");

    const t2 = await readTree();
    const bride = findPerson(t2, result.results[1].personId);
    expect(bride.names[0]).toMatchObject({ given: "Mary", surname: "Doyle" });
    expect(bride.names[0].sources).toEqual([{ ref: "S1", quality: 3 }]);
  });

  it("(32) batch all-or-nothing spans the arms: a failing named-party op writes NOTHING", async () => {
    await writeProject(
      tree(),
      research({
        sources: [S1],
        assertions: [
          assertion("a_001", { record_id: "REC-MARR", record_role: "groom", fact_type: "name", value: "Thomas Flynn" }),
          ...marriageNamingBride(),
        ],
      }),
    );

    const result = await materializeFacts({
      projectPath: dir,
      ops: [
        { personId: "I2", recordId: "REC-MARR", recordRole: "groom" },
        { assertionId: "a_005", relatedRole: "groom", name: { given: "Mary", surname: "Doyle" } },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toContain("ops[1]:");
    // op[0] succeeded in memory and is discarded with it.
    expect((await readTree()).persons).toHaveLength(1);
  });

  it("(33) malformed named-party input REFUSES rather than crashing or half-writing", async () => {
    // The recurring input-robustness class: a model that stringifies, nulls or
    // mistypes a field must get a readable refusal, never a stack trace and
    // never a partial write.
    await writeProject(tree(), research({ sources: [S1], assertions: marriageNamingBride() }));

    const shapes: [string, unknown][] = [
      ["name is null", null],
      ["name is a bare string", "Mary Doyle"],
      ["name is an array", ["Mary", "Doyle"]],
      ["name parts are non-strings", { given: 42, surname: true }],
      ["name parts are whitespace", { given: "  ", surname: "\t" }],
    ];
    for (const [label, name] of shapes) {
      const r = single(
        await materializeFacts({
          projectPath: dir,
          assertionId: "a_005",
          relatedRole: "bride",
          name,
        } as any),
      );
      expect(r.ok, label).toBe(false);
      if (!r.ok) expect(r.errors[0], label).toContain("non-empty given or surname");
    }

    for (const role of [null, undefined, 42, "   "]) {
      const r = single(
        await materializeFacts({
          projectPath: dir,
          assertionId: "a_005",
          relatedRole: role,
          name: { given: "Mary", surname: "Doyle" },
        } as any),
      );
      expect(r.ok, `relatedRole ${String(role)}`).toBe(false);
      if (!r.ok) expect(r.errors[0]).toContain("relatedRole is required");
    }

    // Not one of them wrote anything.
    expect((await readTree()).persons).toHaveLength(1);
  });

  it("(34) accepts the inputs it must NOT refuse — including a name matching the persona's own", async () => {
    // A guard that rejects correct input is worse than the gap it closes. A
    // same-named father and son is ordinary genealogy, so the tool deliberately
    // does not refuse a name equal to the persona's; §4.6 enforces the ref, not
    // the name.
    await writeProject(
      tree(),
      research({
        sources: [S1],
        assertions: [
          assertion("a_009", {
            record_id: "REC-BAPT",
            record_role: "child_1",
            fact_type: "relationship",
            value: "Thomas Flynn, son of Thomas Flynn",
          }),
        ],
      }),
    );

    const sameName = single(
      await materializeFacts({
        projectPath: dir,
        assertionId: "a_009",
        relatedRole: "father",
        name: { given: "Thomas", surname: "Flynn" }, // identical to the persona's
      }),
    );
    expect(sameName.ok).toBe(true);
    if (!sameName.ok) return;
    expect(sameName.namesAdded).toBe(1);

    // A numbered sibling role, and a role differing from record_role only by case.
    const sibling = single(
      await materializeFacts({
        projectPath: dir,
        assertionId: "a_009",
        relatedRole: "CHILD_2", // record_role is child_1 — different party, different role
        name: { surname: "Flynn" }, // surname-only is a complete name here
      }),
    );
    expect(sibling.ok).toBe(true);
    if (!sibling.ok) return;
    expect(sibling.namesAdded).toBe(1);

    const t2 = await readTree();
    for (const id of [sameName.personId, sibling.personId]) {
      const p = findPerson(t2, id);
      expect(p.names[0].sources).toEqual([{ ref: "S1", quality: 3 }]);
    }
  });

  it("(35) a persona op carrying named-party fields is REFUSED, in both call shapes", async () => {
    // The half-formed named-party call: the caller supplies `name` and forgets
    // `assertionId`. Silently ignoring it would drop the caller's intent, and if
    // the persona had no name assertion the failure would surface as an
    // unrelated "no name assertion" error.
    await writeProject(
      tree(),
      research({
        sources: [S1],
        assertions: [assertion("a_010", { record_id: "REC-X", record_role: "groom", fact_type: "marriage" })],
      }),
    );

    const flat = single(
      await materializeFacts({
        projectPath: dir,
        recordId: "REC-X",
        recordRole: "groom",
        name: { given: "Mary", surname: "Doyle" },
      } as any),
    );
    expect(flat.ok).toBe(false);
    if (!flat.ok) {
      expect(flat.errors[0]).toContain("without `assertionId`");
      expect(flat.errors[0]).toContain("name");
    }

    const batched = await materializeFacts({
      projectPath: dir,
      ops: [
        {
          recordId: "REC-X",
          recordRole: "groom",
          relatedRole: "bride",
          name: { given: "Mary", surname: "Doyle" },
        },
      ],
    } as any);
    expect(batched.ok).toBe(false);
    if (!batched.ok) expect(batched.errors[0]).toContain("ops[0]:");

    // A clean persona op is unaffected.
    expect((await readTree()).persons).toHaveLength(1);
  });

  it("(36) REFUSES when the named role already has its own persona on that record", async () => {
    // The common case, not an edge case: measured over eval/**/research.json the
    // role a relationship/marriage assertion names already has its own persona
    // on the same record in 52 of 162 cases. The persona arm mints her WITH her
    // facts; this arm would leave a name-only shell, which is the symptom the
    // spec exists to cure.
    await writeProject(
      tree(),
      research({
        sources: [S1],
        assertions: [
          assertion("a_001", {
            record_id: "REC-BAPT",
            record_role: "child",
            fact_type: "relationship",
            value: "Patrick, son of Thomas and Bridget Doyle",
          }),
          // Bridget HAS a persona on this record — she is not a bare name.
          assertion("a_002", { record_id: "REC-BAPT", record_role: "mother", fact_type: "name", value: "Bridget Doyle" }),
          assertion("a_003", { record_id: "REC-BAPT", record_role: "mother", fact_type: "birth", date: "1820" }),
        ],
      }),
    );

    const refused = single(
      await materializeFacts({
        projectPath: dir,
        assertionId: "a_001",
        relatedRole: "mother",
        name: { given: "Bridget", surname: "Doyle" },
      }),
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.errors[0]).toContain("already has its own persona");
      // The refusal hands over the exact call to make instead.
      expect(refused.errors[0]).toContain("recordRole: 'mother'");
    }
    expect((await readTree()).persons).toHaveLength(1);

    // And that call mints her WITH her facts, which is the point of refusing.
    const viaPersona = single(
      await materializeFacts({ projectPath: dir, recordId: "REC-BAPT", recordRole: "mother" }),
    );
    expect(viaPersona.ok).toBe(true);
    if (!viaPersona.ok) return;
    expect(viaPersona.namesAdded).toBe(1);
    expect(viaPersona.factsAdded).toBe(1); // the Birth — never a name-only shell
  });

  it("(37) REFUSES negative evidence — 'Father: not recorded' must not mint a father", async () => {
    await writeProject(
      tree(),
      research({
        sources: [S1],
        assertions: [
          assertion("a_012", {
            record_id: "REC-DEATH",
            record_role: "deceased",
            fact_type: "relationship",
            evidence_type: "negative",
            value: "Father: not recorded (informant reported 'unknown')",
          }),
        ],
      }),
    );

    const r = single(
      await materializeFacts({
        projectPath: dir,
        assertionId: "a_012",
        relatedRole: "father",
        name: { given: "Thomas", surname: "Flynn" },
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain("negative evidence");
    expect((await readTree()).persons).toHaveLength(1);
  });

  it("(38) a PascalCase fact_type is accepted identically by BOTH tools' shared predicate", async () => {
    // `fact_type` is an OPEN enum with no pattern, and models emit PascalCase
    // for it in practice: Marriage 27 and Relationship 64 across the
    // agent-produced final-research snapshots under eval/runlogs, though zero
    // in the hand-written fixture corpus. If one caller case folds and the
    // other does not, the same assertion mints the party but cannot source her
    // edge — the exact drift the shared module exists to stop.
    await writeProject(
      tree(),
      research({
        sources: [S1],
        assertions: [
          assertion("a_005", { record_role: "groom", fact_type: "Marriage", value: "Thomas married Mary Doyle" }),
        ],
      }),
    );

    const r = single(
      await materializeFacts({
        projectPath: dir,
        assertionId: "a_005",
        relatedRole: "bride",
        name: { given: "Mary", surname: "Doyle" },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.namesAdded).toBe(1);
  });

  it("(39) coerces a JSON-stringified `name`, in both call shapes", async () => {
    await writeProject(tree(), research({ sources: [S1], assertions: marriageNamingBride() }));

    const flat = single(
      await materializeFacts({
        projectPath: dir,
        assertionId: "a_005",
        relatedRole: "bride",
        name: '{"given":"Mary","surname":"Doyle"}',
      } as any),
    );
    expect(flat.ok).toBe(true);
    if (!flat.ok) return;
    expect(flat.namesAdded).toBe(1);

    const batched = await materializeFacts({
      projectPath: dir,
      ops: [
        { assertionId: "a_005", relatedRole: "bride", name: '{"given":"Mary","surname":"Doyle"}' },
      ],
    } as any);
    expect(batched.ok).toBe(true);
    if (!batched.ok || !("results" in batched)) return;
    // Same person, same name: the second call unions the ref rather than duplicating.
    expect(batched.results[0].namesAdded + batched.results[0].refsAttached).toBeGreaterThan(0);

    const p = findPerson(await readTree(), flat.personId);
    expect(p.names[0]).toMatchObject({ given: "Mary", surname: "Doyle" });
  });

  it("(40) a malformed op is an error payload, never a raw crash", async () => {
    await writeProject(tree(), research({ sources: [S1], assertions: marriageNamingBride() }));

    for (const [label, ops] of [
      ["null op", [null]],
      ["string op", ["a_005"]],
      ["array op", [[]]],
    ] as [string, unknown[]][]) {
      const r = await materializeFacts({ projectPath: dir, ops } as any);
      expect(r.ok, label).toBe(false);
      if (!r.ok) expect(r.errors[0], label).toContain("must be an object");
    }

    // A non-string, non-null assertionId must NOT silently run the persona arm.
    const nonString = single(
      await materializeFacts({
        projectPath: dir,
        assertionId: 5,
        relatedRole: "bride",
        name: { given: "Mary", surname: "Doyle" },
      } as any),
    );
    expect(nonString.ok).toBe(false);
    if (!nonString.ok) expect(nonString.errors[0]).toContain("assertionId must be a string");

    expect((await readTree()).persons).toHaveLength(1);
  });

  it("(42) a null in an optional field means ABSENT, not an error", async () => {
    // Models filling a flat optional schema write nulls. Treating those as
    // present turned shapes that worked before this arm existed into hard
    // refusals, on the persona arm which this PR was not supposed to change.
    await writeProject(
      tree(),
      research({
        sources: [S1],
        assertions: [
          assertion("a_001", { record_id: "REC-MARR", record_role: "groom", fact_type: "name", value: "Thomas Flynn" }),
          ...marriageNamingBride(),
        ],
      }),
    );

    const nulls = single(
      await materializeFacts({
        projectPath: dir,
        personId: "I2",
        recordId: "REC-MARR",
        recordRole: "groom",
        assertionId: null,
        relatedRole: null,
        name: null,
        gender: null,
      } as any),
    );
    expect(nulls.ok).toBe(true);
    if (!nulls.ok) return;
    expect(nulls.namesAdded).toBe(1);

    // `gender` on a persona op is tolerated too: it is not named-party-only, and
    // refusing it would reject a shape that worked before this arm existed.
    const withGender = single(
      await materializeFacts({
        projectPath: dir,
        personId: "I3",
        recordId: "REC-MARR",
        recordRole: "groom",
        gender: "Male",
      } as any),
    );
    expect(withGender.ok).toBe(true);
  });

  it("(43) does NOT refuse when the steered-to persona could not be minted either", async () => {
    // A mirrored marriage register: both parties have a persona, but each
    // carries only the `marriage` assertion, so the persona arm cannot mint
    // either of them. Refusing here left the bride writable by NEITHER arm.
    await writeProject(
      tree(),
      research({
        sources: [S1],
        assertions: [
          assertion("a_002", { record_id: "REC-MARR", record_role: "groom", fact_type: "marriage", value: "Thomas Flynn married Mary Doyle" }),
          assertion("a_003", { record_id: "REC-MARR", record_role: "bride", fact_type: "marriage", value: "Mary Doyle married Thomas Flynn" }),
        ],
      }),
    );

    const r = single(
      await materializeFacts({
        projectPath: dir,
        assertionId: "a_002",
        relatedRole: "bride",
        name: { given: "Mary", surname: "Doyle" },
      }),
    );
    expect(r.ok).toBe(true); // the only arm that can write her at all
    if (!r.ok) return;
    expect(r.namesAdded).toBe(1);

    // But when that persona CAN be minted, the refusal still fires.
    await writeProject(
      tree(),
      research({
        sources: [S1],
        assertions: [
          assertion("a_002", { record_id: "REC-MARR", record_role: "groom", fact_type: "marriage", value: "Thomas married Mary" }),
          assertion("a_003", { record_id: "REC-MARR", record_role: "bride", fact_type: "name", value: "Mary Doyle" }),
          assertion("a_004", { record_id: "REC-MARR", record_role: "bride", fact_type: "birth", date: "1822" }),
        ],
      }),
    );
    const refused = single(
      await materializeFacts({
        projectPath: dir,
        assertionId: "a_002",
        relatedRole: "bride",
        name: { given: "Mary", surname: "Doyle" },
      }),
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.errors[0]).toContain("already has its own persona");
  });

  it("(44) an ambiguous whole-name `given` is REFUSED, never split into a guess", async () => {
    // "Mary Doyle" is a full name; "Anna Maria" is a compound given name a
    // register may give with no surname at all. Splitting the second fabricates
    // a surname, under an enforced ref, which makes the fabrication look
    // provenanced. Writing the first whole produces a name the persona arm can
    // never match, so one woman gets two sourced names. Neither is guessed.
    await writeProject(
      tree(),
      research({
        sources: [S1],
        assertions: [
          ...marriageNamingBride(),
          assertion("a_006", { record_id: "REC-HER", record_role: "bride", fact_type: "name", value: "Mary Doyle" }),
        ],
      }),
    );

    const ambiguous = single(
      await materializeFacts({
        projectPath: dir,
        personId: "I2",
        assertionId: "a_005",
        relatedRole: "bride",
        name: { given: "Mary Doyle" }, // no surname KEY at all
      }),
    );
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) {
      expect(ambiguous.errors[0]).toContain("ambiguous");
      expect(ambiguous.errors[0]).toContain("does not guess");
    }
    expect((await readTree()).persons).toHaveLength(1);

    // Stating the surname key, even empty, is honoured verbatim: a compound
    // given name with no surname is a real record shape.
    const mononym = single(
      await materializeFacts({
        projectPath: dir,
        personId: "I3",
        assertionId: "a_005",
        relatedRole: "bride",
        name: { given: "Anna Maria", surname: "" },
      }),
    );
    expect(mononym.ok).toBe(true);
    if (!mononym.ok) return;
    const p3 = findPerson(await readTree(), "I3");
    expect(p3.names[0]).toMatchObject({ given: "Anna Maria", surname: "" });

    // And split properly, both arms agree on one name node for one woman.
    const split = single(
      await materializeFacts({
        projectPath: dir,
        personId: "I4",
        assertionId: "a_005",
        relatedRole: "bride",
        name: { given: "Mary", surname: "Doyle" },
      }),
    );
    expect(split.ok).toBe(true);
    const viaPersona = single(
      await materializeFacts({ projectPath: dir, personId: "I4", recordId: "REC-HER", recordRole: "bride" }),
    );
    expect(viaPersona.ok).toBe(true);
    expect(findPerson(await readTree(), "I4").names).toHaveLength(1); // ONE woman, one name
  });

  it("(45) `parentage` and `ParentChild` establish a link, and both arms agree", async () => {
    // Refusing these while accepting `Marriage` was not a defensible line: they
    // outnumber it 45 to 27 in the agent-produced final-research snapshots, and
    // a parentage assertion establishes a parent-child link as squarely as a
    // `relationship` one does.
    for (const factType of ["parentage", "Parentage", "ParentChild"]) {
      await writeProject(
        tree(),
        research({
          sources: [S1],
          assertions: [
            assertion("a_008", {
              record_id: "REC-WILL",
              record_role: "decedent",
              fact_type: factType,
              value: "Peter Geach, deceased, is father of Elizabeth Geach",
            }),
          ],
        }),
      );
      const r = single(
        await materializeFacts({
          projectPath: dir,
          assertionId: "a_008",
          relatedRole: "daughter",
          name: { given: "Elizabeth", surname: "Geach" },
        }),
      );
      expect(r.ok, factType).toBe(true);
      if (!r.ok) continue;
      expect(r.namesAdded, factType).toBe(1);
      const p = findPerson(await readTree(), r.personId);
      expect(p.names[0].sources, factType).toEqual([{ ref: "S1", quality: 3 }]);
    }
  });

  it("(46) a type that names no second party is still refused", async () => {
    // The set is a ruling on measured spellings, not an open door. `age` is
    // indirect evidence about ONE person; `marriage_intention` is an intent.
    for (const factType of ["age", "marriage_intention", "residence"]) {
      await writeProject(
        tree(),
        research({
          sources: [S1],
          assertions: [assertion("a_009", { record_role: "groom", fact_type: factType })],
        }),
      );
      const r = single(
        await materializeFacts({
          projectPath: dir,
          assertionId: "a_009",
          relatedRole: "bride",
          name: { given: "Mary", surname: "Doyle" },
        }),
      );
      expect(r.ok, factType).toBe(false);
      if (!r.ok) expect(r.errors[0], factType).toContain(`fact_type '${factType}'`);
    }
  });

  it("(47) records a name type only when the caller supplies one, and never invents one", async () => {
    // A party named inside someone else's assertion is often named by a surname
    // that is not her birth surname ("survived by his wife Mary Smith" gives the
    // husband's). The tree schema requires only id/given/surname, and most of
    // the corpus carries no type, so omitting is legal and is the smaller claim.
    await writeProject(tree(), research({ sources: [S1], assertions: marriageNamingBride() }));

    const stated = single(
      await materializeFacts({
        projectPath: dir,
        personId: "I2",
        assertionId: "a_005",
        relatedRole: "bride",
        name: { given: "Mary", surname: "Doyle" },
        nameType: "BirthName", // a marriage register gives the bride's maiden name
      }),
    );
    expect(stated.ok).toBe(true);
    if (!stated.ok) return;
    expect(findPerson(await readTree(), "I2").names[0].type).toBe("BirthName");

    const married = single(
      await materializeFacts({
        projectPath: dir,
        personId: "I3",
        assertionId: "a_005",
        relatedRole: "wife",
        name: { given: "Mary", surname: "Smith" },
        nameType: "MarriedName",
      }),
    );
    expect(married.ok).toBe(true);
    if (!married.ok) return;
    expect(findPerson(await readTree(), "I3").names[0].type).toBe("MarriedName");

    // Omitted: the node is still schema-valid, and carries no type claim.
    const silent = single(
      await materializeFacts({
        projectPath: dir,
        personId: "I4",
        assertionId: "a_005",
        relatedRole: "bride",
        name: { given: "Mary", surname: "Doyle" },
      }),
    );
    expect(silent.ok).toBe(true);
    if (!silent.ok) return;
    const n = findPerson(await readTree(), "I4").names[0];
    expect(n.type).toBeUndefined();
    expect(n.sources).toEqual([{ ref: "S1", quality: 3 }]); // the ref is never optional
  });

  it("(48) the PERSONA arm still records BirthName, unchanged by the named-party arm", async () => {
    // upsertName is shared, so a change for one arm must not move the other.
    await writeProject(tree(), research({ sources: [S1], assertions: enrichPersona() }));
    const r = single(
      await materializeFacts({ projectPath: dir, personId: "I2", recordId: "REC-SON", recordRole: "child" }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(findPerson(await readTree(), "I2").names[0].type).toBe("BirthName");
  });

  /** A mirrored register: both parties have a persona, each carrying ONLY the
   *  marriage assertion, so the persona arm can mint neither. */
  const mirroredRegister = () => [
    assertion("a_002", { record_id: "REC-MARR", record_role: "groom", fact_type: "marriage", value: "Thomas Flynn married Mary Doyle" }),
    assertion("a_003", { record_id: "REC-MARR", record_role: "bride", fact_type: "marriage", value: "Mary Doyle married Thomas Flynn" }),
  ];

  it("(49) does NOT refuse when the party is already a tree person but her persona writes nothing", async () => {
    // The guard's job is to steer to a call that does MORE. When the sibling
    // persona carries only a `marriage` assertion, the persona call returns
    // ok:true and writes nothing, so refusing leaves her writable by neither
    // arm — the provenance leak this arm exists to close, reopened by its own
    // guard. Existing-person-ness is NOT what makes the steer valid.
    const existing = { id: "I2", gender: "Female", names: [{ id: "N2", given: "Mary", surname: "Kelly" }] };
    await writeProject(
      tree({ persons: [existing] }),
      research({ sources: [S1], assertions: mirroredRegister() }),
    );

    const r = single(
      await materializeFacts({
        projectPath: dir,
        personId: "I2",
        assertionId: "a_002",
        relatedRole: "bride",
        name: { given: "Mary", surname: "Doyle" },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.namesAdded).toBe(1);
    const p = findPerson(await readTree(), "I2");
    expect(p.names).toHaveLength(2);
    expect(p.names[1].sources).toEqual([{ ref: "S1", quality: 3 }]);
  });

  it("(50) idempotent for a given personId EVEN when a sibling persona exists", async () => {
    // The regression this pins: a guard keyed on "the target person exists"
    // makes call 1 mint the person and call 2 refuse itself, so the documented
    // idempotency was false exactly where a re-run is most likely.
    await writeProject(tree(), research({ sources: [S1], assertions: mirroredRegister() }));
    const call = () =>
      materializeFacts({
        projectPath: dir,
        personId: "I5",
        assertionId: "a_002",
        relatedRole: "bride",
        name: { given: "Mary", surname: "Doyle" },
      });

    const first = single(await call());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.created).toBe(true);

    const second = single(await call());
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.created).toBe(false);
    expect(second.namesAdded).toBe(0);
    expect(second.refsAttached).toBe(0);
    expect(findPerson(await readTree(), "I5").names).toHaveLength(1);

    // And the same in ONE batch: two mirrored records naming the same woman.
    const batched = await materializeFacts({
      projectPath: dir,
      ops: [
        { personId: "I6", assertionId: "a_002", relatedRole: "bride", name: { given: "Mary", surname: "Doyle" } },
        { personId: "I6", assertionId: "a_003", relatedRole: "groom", name: { given: "Thomas", surname: "Flynn" } },
      ],
    });
    expect(batched.ok).toBe(true);
  });

  it("(51) the refusal carries the personId the caller supplied, so following it cannot duplicate", async () => {
    // The steer said { recordId, recordRole } with no personId, so a caller who
    // followed it verbatim minted a SECOND person for the same woman.
    const existing = { id: "I2", gender: "Female", names: [{ id: "N2", given: "Mary", surname: "Kelly" }] };
    await writeProject(
      tree({ persons: [existing] }),
      research({
        sources: [S1],
        assertions: [
          assertion("a_002", { record_id: "REC-MARR", record_role: "groom", fact_type: "marriage", value: "T married M" }),
          assertion("a_003", { record_id: "REC-MARR", record_role: "bride", fact_type: "name", value: "Mary Doyle" }),
        ],
      }),
    );

    const r = single(
      await materializeFacts({
        projectPath: dir,
        personId: "I2",
        assertionId: "a_002",
        relatedRole: "bride",
        name: { given: "Mary", surname: "Doyle" },
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toContain("personId: 'I2'");
    expect(r.errors[0]).toContain("recordRole: 'bride'");
  });

  it("(52) a `parentage` assertion is treated ONE way: a two-party link, never a person fact", async () => {
    // The inconsistency this pins: widening the sourcing set without widening
    // SKIP_TYPES left one fact_type meaning two things — a link when sourcing
    // an edge, a person-level `Parentage` fact when materializing a persona.
    await writeProject(
      tree(),
      research({
        sources: [S1],
        assertions: [
          assertion("a_008", { record_id: "REC-WILL", record_role: "decedent", fact_type: "name", value: "Peter Geach" }),
          assertion("a_009", { record_id: "REC-WILL", record_role: "decedent", fact_type: "parentage", value: "father of Elizabeth Geach" }),
          assertion("a_010", { record_id: "REC-WILL", record_role: "decedent", fact_type: "ParentChild", value: "father of Elizabeth" }),
        ],
      }),
    );

    const r = single(
      await materializeFacts({ projectPath: dir, personId: "I2", recordId: "REC-WILL", recordRole: "decedent" }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.namesAdded).toBe(1);
    expect(r.factsAdded).toBe(0); // neither spelling becomes a person fact

    const p = findPerson(await readTree(), "I2");
    for (const f of p.facts ?? []) {
      expect(f.type).not.toMatch(/[Pp]arent/);
    }
  });

  it("(53) a sibling persona with no NAME assertion does not block the named-party arm", async () => {
    // The writable-by-neither-arm gap this closes: siblingCanMint used to accept
    // a persona carrying only a gender or only a fact, but the persona arm
    // refuses to mint a person it cannot name. Steering there errored, this arm
    // refused and pointed back at it, and add_person is prohibited for a
    // record-derived person, so nothing could write her.
    for (const sibling of [
      assertion("a_002", { record_id: "REC-MARR", record_role: "bride", fact_type: "gender", value: "Female" }),
      assertion("a_002", { record_id: "REC-MARR", record_role: "bride", fact_type: "birth", date: "1820" }),
    ]) {
      await writeProject(
        tree(),
        research({
          sources: [S1],
          assertions: [
            assertion("a_001", { record_id: "REC-MARR", record_role: "groom", fact_type: "marriage", value: "T married M" }),
            sibling,
          ],
        }),
      );
      const r = single(
        await materializeFacts({
          projectPath: dir,
          assertionId: "a_001",
          relatedRole: "bride",
          name: { given: "Mary", surname: "Doyle" },
        }),
      );
      expect(r.ok, String(sibling.fact_type)).toBe(true);
      if (!r.ok) continue;
      expect(r.namesAdded).toBe(1);
    }

    // But a sibling WITH a name still blocks it: the persona arm does better there.
    await writeProject(
      tree(),
      research({
        sources: [S1],
        assertions: [
          assertion("a_001", { record_id: "REC-MARR", record_role: "groom", fact_type: "marriage", value: "T married M" }),
          assertion("a_002", { record_id: "REC-MARR", record_role: "bride", fact_type: "name", value: "Mary Doyle" }),
        ],
      }),
    );
    const blocked = single(
      await materializeFacts({
        projectPath: dir,
        assertionId: "a_001",
        relatedRole: "bride",
        name: { given: "Mary", surname: "Doyle" },
      }),
    );
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.errors[0]).toContain("already has its own persona");
  });

  it("(54) a nameless persona's sourced FACTS are written too, not just her name", async () => {
    // The regression test 53 did not have: it pinned namesAdded and said nothing
    // about facts, so narrowing siblingCanMint traded a loud refusal for a quiet
    // half-write. The bride the register gives a persona for but never names
    // carries a birth that has NO other route into the tree — the persona arm
    // refuses her for want of a name, and add_person is prohibited for a
    // record-derived person — so dropping it here drops it everywhere.
    const namelessBride = () => [
      assertion("a_001", { record_id: "REC-MARR", record_role: "groom", fact_type: "marriage", value: "T married M", date: "1860" }),
      assertion("a_002", { record_id: "REC-MARR", record_role: "bride", fact_type: "birth", date: "1839", place: "Cork, Ireland" }),
    ];

    await writeProject(tree(), research({ sources: [S1], assertions: namelessBride() }));
    const r = single(
      await materializeFacts({
        projectPath: dir,
        assertionId: "a_001",
        relatedRole: "bride",
        name: { given: "Mary", surname: "Doyle" },
        nameType: "BirthName",
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.created).toBe(true);
    expect(r.namesAdded).toBe(1); // her name is not double-written by the second pass
    expect(r.factsAdded).toBe(1); // the 1839 birth, which used to be dropped

    const her = findPerson(await readTree(), r.personId);
    expect(her.facts.map((f: any) => [f.type, f.date])).toEqual([["Birth", "1839"]]);
    expect(her.names).toHaveLength(1);
    assertWrittenNodesHaveRefs(await readTree(), her); // the birth arrives WITH its ref

    // Idempotent: the same call again enriches nothing and duplicates nothing.
    const again = single(
      await materializeFacts({
        projectPath: dir,
        personId: r.personId,
        assertionId: "a_001",
        relatedRole: "bride",
        name: { given: "Mary", surname: "Doyle" },
        nameType: "BirthName",
      }),
    );
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.factsAdded).toBe(0);
    expect(again.namesAdded).toBe(0);
    expect(findPerson(await readTree(), r.personId).facts).toHaveLength(1);
  });

  it("(55) the fact pass is scoped: no persona, gender-only, and negative evidence each write no fact", async () => {
    // The other direction of the same guard. Writing her facts must not start
    // writing facts that are not hers, are not facts, or are not positive
    // evidence — each of these returns a clean factsAdded: 0 rather than an
    // error or a spurious fact.
    const cases: Array<[string, any[]]> = [
      // No persona for the role at all: the pure named-party case, unchanged.
      ["no persona", [
        assertion("a_001", { record_id: "REC-MARR", record_role: "groom", fact_type: "marriage", value: "T married M" }),
      ]],
      // A persona carrying only gender: gender is a scalar, never a fact node.
      ["gender only", [
        assertion("a_001", { record_id: "REC-MARR", record_role: "groom", fact_type: "marriage", value: "T married M" }),
        assertion("a_002", { record_id: "REC-MARR", record_role: "bride", fact_type: "gender", value: "Female" }),
      ]],
      // Negative evidence is not a positive tree write (§7.1 (4)).
      ["negative evidence", [
        assertion("a_001", { record_id: "REC-MARR", record_role: "groom", fact_type: "marriage", value: "T married M" }),
        assertion("a_002", { record_id: "REC-MARR", record_role: "bride", fact_type: "birth", date: "1839", evidence_type: "negative" }),
      ]],
    ];
    for (const [label, assertions] of cases) {
      await writeProject(tree(), research({ sources: [S1], assertions }));
      const r = single(
        await materializeFacts({
          projectPath: dir,
          assertionId: "a_001",
          relatedRole: "bride",
          name: { given: "Mary", surname: "Doyle" },
        }),
      );
      expect(r.ok, label).toBe(true);
      if (!r.ok) continue;
      expect(r.factsAdded, label).toBe(0);
      expect(r.namesAdded, label).toBe(1);
      const her = findPerson(await readTree(), r.personId);
      expect(her.facts ?? [], label).toHaveLength(0);
    }
  });
});

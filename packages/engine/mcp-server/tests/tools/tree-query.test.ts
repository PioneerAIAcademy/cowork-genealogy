import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { treeQuery } from "../../src/tools/tree-query.js";
import { treeQuerySchema } from "../../src/tools/tree-query.js";
import { projectContext } from "../../src/tools/project-context.js";
import { LOCAL } from "../../src/auth/principal.js";
import { runProjectCreate } from "../../src/tools/project-create.js";
import { __usePlaceTableForTests } from "../../src/utils/place-resolver.js";

const TREE = {
  persons: [
    {
      id: "I1",
      ark: "ark:/61903/4:1:AAAA-111",
      living: false,
      gender: "Male",
      names: [
        { id: "N1", given: "William", surname: "Bottermiller", preferred: true, sources: [{ ref: "S3" }] },
        { id: "N2", given: "Willie", surname: "Bottermiller" },
      ],
      facts: [
        {
          id: "F1", type: "http://gedcomx.org/Birth", date: "12 Mar 1863", standard_date: "12 Mar 1863",
          place: "Ohio", standard_place: "Ohio, United States", sources: [{ ref: "S1" }],
        },
        { id: "F2", type: "Death", date: "1929", assertion_id: "a_009", sources: [{ ref: "S2" }, { ref: "S1" }] },
        { id: "F3", type: "Occupation", value: "Farmer" },
      ],
      sources: [{ ref: "S1" }],
    },
    { id: "I2", gender: "Female", names: [{ given: "Anna" }], facts: [] },
    { id: "I3", names: [{ given: "Carl" }], facts: [{ type: "Birth", date: "1890" }] },
    { id: "I9", names: [{ given: "Unrelated" }] },
  ],
  relationships: [
    {
      id: "R1", type: "http://gedcomx.org/Couple", person1: "I1", person2: "I2",
      facts: [
        { type: "Marriage", date: "1885", place: "Dayton, Ohio", sources: [{ ref: "S4" }] },
        { type: "http://gedcomx.org/Divorce", date: "1901" },
      ],
      notes: ["m. at home"],
      sources: [{ ref: "S6" }],
    },
    { id: "R2", type: "ParentChild", parent: "I1", child: "I3", subtype: "Biological" },
    { id: "R3", type: "ParentChild", parent: "I9", child: "I8" },
  ],
  sources: [
    { id: "S1", title: "1880 census", author: "United States Census Bureau", citation: "c1", url: "https://fs/1" },
    { id: "S2", title: "Death cert" },
    { id: "S3", title: "Name source" },
    { id: "S4", title: "Marriage register", author: "Montgomery County" },
    { id: "S5", title: "Uncited" },
    { id: "S6", title: "Edge source" },
  ],
};

describe("tree_query", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tree-query-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeProject(tree: any = TREE) {
    await writeFile(join(dir, "research.json"), JSON.stringify({ project: { id: "rp_001" } }));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree));
  }

  it("returns every person with names, facts and ark, and no source entries, when no filter is given", async () => {
    await writeProject();
    const r = await treeQuery({ projectPath: dir });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.persons.map((p) => p.id)).toEqual(["I1", "I2", "I3", "I9"]);
    const i1 = r.persons[0];
    expect(i1.ark).toBe("ark:/61903/4:1:AAAA-111");
    expect(i1.living).toBe(false);
    expect(i1.names!.map((n) => [n.given, n.preferred])).toEqual([["William", true], ["Willie", undefined]]);
    expect(i1.facts![0]).toMatchObject({
      type: "http://gedcomx.org/Birth", standardDate: "12 Mar 1863",
      place: "Ohio", standardPlace: "Ohio, United States", sourceRefs: ["S1"],
    });
    expect(i1.facts![1]).toMatchObject({ assertionId: "a_009", sourceRefs: ["S2", "S1"] });
    expect(i1.sourceRefs).toEqual(["S1", "S3", "S2"]);
    expect(r).not.toHaveProperty("sources");
    expect(r).not.toHaveProperty("truncated");
    expect(r.missingPersonIds).toEqual([]);
  });

  it("leaves out null and empty keys, and a place or date equal to its standard form", async () => {
    await writeProject();
    const r = await treeQuery({ projectPath: dir });
    if (!r.ok) throw new Error("not ok");
    const [birth, death, occupation] = r.persons[0].facts!;
    // date equals standardDate: absent means "same as standardDate"; place differs, so it stays.
    expect(birth).not.toHaveProperty("date");
    expect(birth.place).toBe("Ohio");
    expect(death.date).toBe("1929");
    expect(occupation).toEqual({ id: "F3", type: "Occupation", value: "Farmer" });
    // I2 has no facts, no ark, no living flag: none of those keys is sent.
    expect(r.persons[1]).toEqual({ id: "I2", gender: "Female", names: [{ given: "Anna" }] });
    // preferred and primary are sent only when true: absence means false.
    expect(r.persons[0].names![0].preferred).toBe(true);
    expect(r.persons[0].names![1]).not.toHaveProperty("preferred");
    const r2 = r.relationships.find((e) => e.id === "R2")!;
    expect(r2).toEqual({ id: "R2", type: "ParentChild", parent: "I1", child: "I3", subtype: "Biological" });
  });

  it("sends a fact's primary only when true", async () => {
    await writeProject({
      persons: [{ id: "I1", facts: [{ id: "F1", type: "Birth", primary: true }, { id: "F2", type: "Birth", primary: false }] }],
    });
    const r = await treeQuery({ projectPath: dir });
    if (!r.ok) throw new Error("not ok");
    expect(r.persons[0].facts).toEqual([{ id: "F1", type: "Birth", primary: true }, { id: "F2", type: "Birth" }]);
  });

  it("returns marriage facts on the Couple edge, and the source author when asked for sources", async () => {
    await writeProject();
    const r = await treeQuery({ projectPath: dir, personIds: ["I1"], includeSources: true });
    if (!r.ok) throw new Error("not ok");
    const couple = r.relationships.find((e) => e.type === "Couple")!;
    expect(couple.person2).toBe("I2");
    expect(couple.facts![0]).toMatchObject({ type: "Marriage", date: "1885", place: "Dayton, Ohio" });
    expect(couple.notes).toEqual(["m. at home"]);
    expect(couple.sourceRefs).toEqual(["S6"]);
    expect(r.sources!.find((s) => s.id === "S6")).toBeDefined();
    expect(r.sources!.find((s) => s.id === "S4")?.author).toBe("Montgomery County");
    expect(r.sources!.find((s) => s.id === "S1")).toEqual({
      id: "S1", title: "1880 census", citation: "c1", author: "United States Census Bureau", url: "https://fs/1",
    });
  });

  it("limits persons, the edges touching them and the cited sources to what is returned", async () => {
    await writeProject();
    const r = await treeQuery({ projectPath: dir, personIds: ["I3"], includeSources: true });
    if (!r.ok) throw new Error("not ok");
    expect(r.persons.map((p) => p.id)).toEqual(["I3"]);
    expect(r.relationships.map((e) => e.id)).toEqual(["R2"]); // R1 and R3 do not touch I3
    expect(r.sources).toEqual([]);
  });

  it("returns only sources something returned cites under includeSources", async () => {
    await writeProject();
    const r = await treeQuery({ projectPath: dir, includeSources: true });
    if (!r.ok) throw new Error("not ok");
    expect(r.sources!.map((s) => s.id)).toEqual(["S1", "S2", "S3", "S4", "S6"]); // S5 uncited
    expect(await treeQuery({ projectPath: dir, includeSources: false })).not.toHaveProperty("sources");
  });

  it("returns the named sources under sourceIds, cited or not, and skips an unknown id", async () => {
    await writeProject();
    const r = await treeQuery({ projectPath: dir, personIds: ["I2"], sourceIds: ["S5", "S1", "S404"] });
    if (!r.ok) throw new Error("not ok");
    expect(r.sources!.map((s) => s.id)).toEqual(["S5", "S1"]);
    // sourceIds: [] asks for sources like includeSources.
    const all = await treeQuery({ projectPath: dir, sourceIds: [] });
    if (!all.ok) throw new Error("not ok");
    expect(all.sources!.map((s) => s.id)).toEqual(["S1", "S2", "S3", "S4", "S6"]);
  });

  it("reports requested ids that match no tree id and no FamilySearch link", async () => {
    await writeProject();
    const r = await treeQuery({ projectPath: dir, personIds: ["I2", "I404", "ZZZZ-999"] });
    if (!r.ok) throw new Error("not ok");
    expect(r.persons.map((p) => p.id)).toEqual(["I2"]);
    expect(r.missingPersonIds).toEqual(["I404", "ZZZZ-999"]);
  });

  it("returns persons in the requested order", async () => {
    await writeProject();
    const r = await treeQuery({ projectPath: dir, personIds: ["I3", "I1", "I3"] });
    if (!r.ok) throw new Error("not ok");
    expect(r.persons.map((p) => p.id)).toEqual(["I3", "I1"]);
  });

  it("resolves a FamilySearch id to every person linked to it, case-insensitively", async () => {
    await writeProject({
      ...TREE,
      persons: [
        ...TREE.persons.map((p) => (p.id === "I3" ? { ...p, ark: "ark:/61903/4:1:BBBB-222" } : p)),
        { id: "I7", ark: "https://www.familysearch.org/tree/person/details/aaaa-111", names: [{ given: "Dup" }] },
      ],
    });
    const r = await treeQuery({ projectPath: dir, personIds: ["aaaa-111"] });
    if (!r.ok) throw new Error("not ok");
    expect(r.persons.map((p) => p.id)).toEqual(["I1", "I7"]);
    expect(r.missingPersonIds).toEqual([]);
    // One linked person: just that one.
    const one = await treeQuery({ projectPath: dir, personIds: ["BBBB-222"] });
    if (!one.ok) throw new Error("not ok");
    expect(one.persons.map((p) => p.id)).toEqual(["I3"]);
    expect(one.missingPersonIds).toEqual([]);
    // A tree id wins over a FamilySearch link.
    const byTreeId = await treeQuery({ projectPath: dir, personIds: ["I1"] });
    if (!byTreeId.ok) throw new Error("not ok");
    expect(byTreeId.persons.map((p) => p.id)).toEqual(["I1"]);
  });

  it("filters fact types case-insensitively on the last URI segment, on persons and edges", async () => {
    await writeProject();
    const r = await treeQuery({ projectPath: dir, factTypes: ["birth", "MARRIAGE"] });
    if (!r.ok) throw new Error("not ok");
    expect(r.persons[0].facts!.map((f) => f.id)).toEqual(["F1"]);
    expect(r.relationships[0].facts!.map((f) => f.type)).toEqual(["Marriage"]);
    // The filter does not change which sources the person is reported as citing.
    expect(r.persons[0].sourceRefs).toEqual(["S1", "S3", "S2"]);
  });

  it("treats empty filters as no filter", async () => {
    await writeProject();
    const r = await treeQuery({ projectPath: dir, personIds: [], factTypes: [] });
    if (!r.ok) throw new Error("not ok");
    expect(r.persons).toHaveLength(4);
    expect(r.persons[0].facts).toHaveLength(3);
  });

  it("rejects non-array or non-string filters and a non-boolean includeSources", async () => {
    await writeProject();
    expect(await treeQuery({ projectPath: dir, personIds: "I1" as any })).toMatchObject({ ok: false });
    expect(await treeQuery({ projectPath: dir, personIds: [1] as any })).toMatchObject({ ok: false });
    expect(await treeQuery({ projectPath: dir, factTypes: [null] as any })).toMatchObject({ ok: false });
    expect(await treeQuery({ projectPath: dir, includeSources: "true" as any })).toMatchObject({
      ok: false, errors: ["includeSources must be a boolean"],
    });
    expect(await treeQuery({ projectPath: dir, sourceIds: "S1" as any })).toMatchObject({
      ok: false, errors: ["sourceIds must be an array of strings"],
    });
    expect(await treeQuery({ projectPath: dir, sourceIds: [1] as any })).toMatchObject({ ok: false });
  });

  it("skips malformed entries instead of failing", async () => {
    await writeProject({
      persons: [null, { names: [] }, { id: "I1", names: [null, 5], facts: [null, { type: 7 }] }],
      relationships: [null, "x", { type: "Couple", person1: "I1" }],
      sources: [null, { title: "no id" }],
    });
    const r = await treeQuery({ projectPath: dir });
    if (!r.ok) throw new Error("not ok");
    expect(r.persons).toHaveLength(1);
    expect(r.persons[0]).not.toHaveProperty("names");
    expect(r.persons[0].facts).toEqual([{}]);
    expect(r.relationships).toHaveLength(1);
  });

  it("returns the no_project answer outside a project and a loud error for an unreadable tree", async () => {
    expect(await treeQuery({ projectPath: dir })).toMatchObject({ ok: false, reason: "no_project" });
    await writeFile(join(dir, "research.json"), "{}");
    await writeFile(join(dir, "tree.gedcomx.json"), "{not json");
    const r = await treeQuery({ projectPath: dir });
    expect(r).toMatchObject({ ok: false });
    expect((r as any).reason).toBeUndefined();
  });

  it("is advertised with projectPath required, the source opt-ins, and no write surface", () => {
    expect(treeQuerySchema.name).toBe("tree_query");
    expect(treeQuerySchema.inputSchema.required).toEqual(["projectPath"]);
    expect(Object.keys(treeQuerySchema.inputSchema.properties)).toEqual(
      expect.arrayContaining(["includeSources", "sourceIds"]),
    );
    expect(treeQuerySchema.description).toContain("omittedPersonIds");
  });

  describe("the 40,000-character cap", () => {
    // Persons with long, distinct facts and their own long sources, so a whole
    // tree is well over the budget.
    const bigTree = (n: number) => ({
      persons: Array.from({ length: n }, (_, i) => ({
        id: `I${i + 1}`,
        names: [{ preferred: true, given: `Person${i + 1}`, surname: "Longsurname" }],
        facts: Array.from({ length: 6 }, (_, j) => ({
          id: `F${i + 1}_${j}`,
          type: "http://gedcomx.org/Residence",
          date: `${1850 + j}`,
          place: `Somewhere ${j}, A Long County Name, A Long State Name, United States ${i}`,
          sources: [{ ref: `S${i + 1}` }],
        })),
      })),
      relationships: Array.from({ length: n - 1 }, (_, i) => ({
        id: `R${i + 1}`, type: "ParentChild", parent: `I${i + 1}`, child: `I${i + 2}`,
      })),
      sources: Array.from({ length: n }, (_, i) => ({
        id: `S${i + 1}`, title: `Source ${i + 1}`, citation: "x".repeat(400), author: "A", url: "https://fs/s",
      })),
    });
    const size = (r: unknown) => JSON.stringify(r).length;

    it("cuts persons from the end, keeps the first, and names the omitted ones", async () => {
      await writeProject(bigTree(120));
      const r = await treeQuery({ projectPath: dir });
      if (!r.ok) throw new Error("not ok");
      expect(size(r)).toBeLessThanOrEqual(40_000);
      expect(r.truncated).toBe(true);
      expect(r.persons[0].id).toBe("I1");
      const kept = r.persons.map((p) => p.id);
      expect([...kept, ...r.omittedPersonIds!]).toEqual(Array.from({ length: 120 }, (_, i) => `I${i + 1}`));
      // Only edges touching a kept person.
      for (const e of r.relationships) expect(kept.includes(e.parent!) || kept.includes(e.child!)).toBe(true);
    });

    it("lets a caller recover everything by following the description's instructions", async () => {
      await writeProject(bigTree(120));
      const seenPersons = new Set<string>();
      const seenSources = new Set<string>();
      let personIds: string[] | undefined;
      for (let call = 0; call < 20; call++) {
        const r = await treeQuery({ projectPath: dir, includeSources: true, ...(personIds ? { personIds } : {}) });
        if (!r.ok) throw new Error("not ok");
        expect(size(r)).toBeLessThanOrEqual(40_000);
        for (const p of r.persons) seenPersons.add(p.id);
        for (const s of r.sources!) seenSources.add(s.id);
        if (r.omittedSourceIds) {
          const more = await treeQuery({ projectPath: dir, personIds: [r.persons[0].id], sourceIds: r.omittedSourceIds });
          if (!more.ok) throw new Error("not ok");
          for (const s of more.sources!) seenSources.add(s.id);
        }
        if (!r.omittedPersonIds) break;
        personIds = r.omittedPersonIds;
      }
      expect(seenPersons.size).toBe(120);
      expect(seenSources.size).toBe(120);
    });

    it("cuts named sources before persons, and lists every one it cut", async () => {
      await writeProject(bigTree(40));
      const wanted = Array.from({ length: 40 }, (_, i) => `S${i + 1}`);
      const extra = { ...bigTree(40) };
      extra.sources = extra.sources.map((s) => ({ ...s, citation: "x".repeat(2000) }));
      await writeProject(extra);
      const r = await treeQuery({ projectPath: dir, personIds: ["I1"], sourceIds: wanted });
      if (!r.ok) throw new Error("not ok");
      expect(size(r)).toBeLessThanOrEqual(40_000);
      expect(r.persons.map((p) => p.id)).toEqual(["I1"]);
      expect(r).not.toHaveProperty("omittedPersonIds");
      expect([...r.sources!.map((s) => s.id), ...r.omittedSourceIds!]).toEqual(wanted);
    });

    it("lists under omittedSourceIds only sources a returned person or edge cites", async () => {
      // I1 alone cites more source text than fits; I2..I5 each cite one source of
      // their own, which goes with them when they are cut.
      const big = (id: string) => ({ id, title: id, citation: "x".repeat(2000) });
      await writeProject({
        persons: [
          { id: "I1", names: [{ given: "First" }], facts: Array.from({ length: 30 }, (_, k) => ({ id: `FA${k}`, type: "Residence", sources: [{ ref: `A${k}` }] })) },
          ...[2, 3, 4, 5].map((i) => ({ id: `I${i}`, names: [{ given: `P${i}` }], facts: [{ id: `FB${i}`, type: "Residence", sources: [{ ref: `B${i}` }] }] })),
        ],
        relationships: [{ id: "R1", type: "ParentChild", parent: "I1", child: "I2", sources: [{ ref: "E1" }] }],
        sources: [...Array.from({ length: 30 }, (_, k) => big(`A${k}`)), big("E1"), ...[2, 3, 4, 5].map((i) => big(`B${i}`))],
      });
      const r = await treeQuery({ projectPath: dir, includeSources: true });
      if (!r.ok) throw new Error("not ok");
      expect(size(r)).toBeLessThanOrEqual(40_000);
      expect(r.persons.map((p) => p.id)).toEqual(["I1"]);
      expect(r.omittedPersonIds).toEqual(["I2", "I3", "I4", "I5"]);
      expect(r.omittedSourceIds!.length).toBeGreaterThan(0);
      const citedByKept = new Set([...Array.from({ length: 30 }, (_, k) => `A${k}`), "E1"]);
      for (const id of [...r.sources!.map((s) => s.id), ...r.omittedSourceIds!]) expect(citedByKept.has(id)).toBe(true);
      expect([...r.sources!.map((s) => s.id), ...r.omittedSourceIds!].sort()).toEqual([...citedByKept].sort());
    });

    it("still returns a named source whose only citing person the cap dropped", async () => {
      await writeProject(bigTree(120));
      const r = await treeQuery({ projectPath: dir, sourceIds: ["S120"] });
      if (!r.ok) throw new Error("not ok");
      expect(r.omittedPersonIds).toContain("I120");
      expect(r.sources!.map((s) => s.id)).toEqual(["S120"]);
    });
  });
});

// The reads issue #4382 was measured on. Compact JSON, as server.ts sends it.
describe("tree_query on real trees, against the 40,000-character budget", () => {
  const FIXTURES = new URL("../../../../../eval/fixtures/", import.meta.url);
  let dir: string;
  beforeAll(() => __usePlaceTableForTests({}));
  afterAll(() => __usePlaceTableForTests(null));
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tree-query-size-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads the richardson scenario's whole tree under 40,000 characters, untruncated", async () => {
    const scenario = new URL("scenarios/richardson-parentage-not-exhaustive/", FIXTURES);
    for (const f of ["research.json", "tree.gedcomx.json"]) {
      await writeFile(join(dir, f), await readFile(new URL(f, scenario), "utf-8"));
    }
    const r = await treeQuery({ projectPath: dir });
    if (!r.ok) throw new Error("not ok");
    expect(JSON.stringify(r).length).toBeLessThan(40_000);
    expect(r).not.toHaveProperty("truncated");
  });

  // Tallman's tree as project_create builds it from his person_read, the eval
  // mock's pattern: 21 persons, 321 sources.
  async function tallman(): Promise<void> {
    const fixture = JSON.parse(
      await readFile(new URL("mcp/person-read-tallman-attached-sources.json", FIXTURES), "utf-8"),
    );
    const read = fixture.response ?? fixture;
    const subject = read.persons[0].id;
    const created = await runProjectCreate(
      { projectPath: dir, objective: "Who were his parents?", title: "Tallman", personId: subject },
      { readPerson: async () => ({ result: structuredClone(read), resolvedId: subject, memoryKinds: {} }) },
      LOCAL,
    );
    if (!created.ok) throw new Error(created.errors.join("; "));
  }

  it("reads Tallman's whole tree under 40,000 characters, keeping the subject", async () => {
    await tallman();
    const r = await treeQuery({ projectPath: dir });
    if (!r.ok) throw new Error("not ok");
    expect(JSON.stringify(r).length).toBeLessThanOrEqual(40_000);
    expect(r.persons[0].id).toBe("I1");
  });

  it("reads Tallman's whole tree untruncated", async () => {
    await tallman();
    const r = await treeQuery({ projectPath: dir });
    if (!r.ok) throw new Error("not ok");
    expect(r).not.toHaveProperty("truncated");
    expect(r.persons).toHaveLength(21);
  });

  it("recovers every Tallman person and cited source by following the truncation fields", async () => {
    await tallman();
    const tree = JSON.parse(await readFile(join(dir, "tree.gedcomx.json"), "utf-8"));
    const persons = new Set<string>();
    const sources = new Set<string>();
    let personIds: string[] | undefined;
    for (let call = 0; call < 25; call++) {
      const r = await treeQuery({ projectPath: dir, includeSources: true, ...(personIds ? { personIds } : {}) });
      if (!r.ok) throw new Error("not ok");
      expect(JSON.stringify(r).length).toBeLessThanOrEqual(40_000);
      for (const p of r.persons) persons.add(p.id);
      for (const x of r.sources!) sources.add(x.id);
      if (r.omittedSourceIds) {
        const more = await treeQuery({ projectPath: dir, personIds: [r.persons[0].id], sourceIds: r.omittedSourceIds });
        if (!more.ok) throw new Error("not ok");
        for (const x of more.sources!) sources.add(x.id);
      }
      if (!r.omittedPersonIds) break;
      personIds = r.omittedPersonIds;
    }
    const cited = new Set<string>();
    const all = await treeQuery({ projectPath: dir });
    if (!all.ok) throw new Error("not ok");
    for (const p of all.persons) for (const ref of p.sourceRefs ?? []) cited.add(ref);
    for (const e of all.relationships) for (const ref of e.sourceRefs ?? []) cited.add(ref);
    for (const e of tree.relationships ?? []) for (const f of e.facts ?? []) for (const x of f.sources ?? []) cited.add(x.ref);
    expect(persons.size).toBe(21);
    expect([...cited].filter((id) => !sources.has(id))).toEqual([]);
  });
});

describe("project_context profile fields (#3836)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "project-context-profile-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function ctx(research: any) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify({ persons: [] }));
    const r = await projectContext({ projectPath: dir }, LOCAL);
    if (!r.ok) throw new Error("not ok");
    return r;
  }

  it("returns narration_guidance verbatim and subscriptions as strings", async () => {
    const r = await ctx({
      project: { id: "rp_001" },
      researcher_profile: { narration_guidance: "Plain words.", subscriptions: ["ancestry", 3, "findmypast"] },
    });
    expect(r.narrationGuidance).toBe("Plain words.");
    expect(r.subscriptions).toEqual(["ancestry", "findmypast"]);
  });

  it("leaves both out when the profile is absent or malformed", async () => {
    const a = await ctx({ project: { id: "rp_001" } });
    expect(a).not.toHaveProperty("narrationGuidance");
    expect(a).not.toHaveProperty("subscriptions");
    const b = await ctx({ project: { id: "rp_001" }, researcher_profile: { narration_guidance: null, subscriptions: "x" } });
    expect(b).not.toHaveProperty("narrationGuidance");
    expect(b).not.toHaveProperty("subscriptions");
  });
});

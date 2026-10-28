import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { treeQuery } from "../../src/tools/tree-query.js";
import { treeQuerySchema } from "../../src/tools/tree-query.js";
import { projectContext } from "../../src/tools/project-context.js";

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
      facts: [{ type: "Marriage", date: "1885", place: "Dayton, Ohio", sources: [{ ref: "S4" }] }],
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

  it("returns every person with names, facts, ark and cited sources when no filter is given", async () => {
    await writeProject();
    const r = await treeQuery({ projectPath: dir });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.persons.map((p) => p.id)).toEqual(["I1", "I2", "I3", "I9"]);
    const i1 = r.persons[0];
    expect(i1.ark).toBe("ark:/61903/4:1:AAAA-111");
    expect(i1.living).toBe(false);
    expect(i1.names.map((n) => [n.given, n.preferred])).toEqual([["William", true], ["Willie", false]]);
    expect(i1.facts[0]).toMatchObject({
      type: "http://gedcomx.org/Birth", date: "12 Mar 1863", standardDate: "12 Mar 1863",
      place: "Ohio", standardPlace: "Ohio, United States", sourceRefs: ["S1"],
    });
    expect(i1.facts[1]).toMatchObject({ assertionId: "a_009", sourceRefs: ["S2", "S1"] });
    expect(i1.facts[2]).toMatchObject({ value: "Farmer", date: null, standardPlace: null });
    expect(i1.sourceRefs).toEqual(["S1", "S3", "S2"]);
    expect(r.missingPersonIds).toEqual([]);
  });

  it("returns marriage facts on the Couple edge and the source author", async () => {
    await writeProject();
    const r = await treeQuery({ projectPath: dir, personIds: ["I1"] });
    if (!r.ok) throw new Error("not ok");
    const couple = r.relationships.find((e) => e.type === "Couple")!;
    expect(couple.person2).toBe("I2");
    expect(couple.facts[0]).toMatchObject({ type: "Marriage", date: "1885", place: "Dayton, Ohio" });
    expect(couple.notes).toEqual(["m. at home"]);
    expect(couple.sourceRefs).toEqual(["S6"]);
    expect(r.sources.find((s) => s.id === "S6")).toBeDefined();
    expect(r.sources.find((s) => s.id === "S4")?.author).toBe("Montgomery County");
    expect(r.sources.find((s) => s.id === "S1")?.author).toBe("United States Census Bureau");
  });

  it("limits persons, the edges touching them and the sources to what is returned", async () => {
    await writeProject();
    const r = await treeQuery({ projectPath: dir, personIds: ["I3"] });
    if (!r.ok) throw new Error("not ok");
    expect(r.persons.map((p) => p.id)).toEqual(["I3"]);
    expect(r.relationships.map((e) => e.id)).toEqual(["R2"]); // R1 and R3 do not touch I3
    expect(r.sources).toEqual([]);
  });

  it("only returns sources something returned cites", async () => {
    await writeProject();
    const r = await treeQuery({ projectPath: dir });
    if (!r.ok) throw new Error("not ok");
    expect(r.sources.map((s) => s.id).sort()).toEqual(["S1", "S2", "S3", "S4", "S6"]); // S5 uncited
  });

  it("reports requested ids that are not in the tree", async () => {
    await writeProject();
    const r = await treeQuery({ projectPath: dir, personIds: ["I2", "I404"] });
    if (!r.ok) throw new Error("not ok");
    expect(r.persons.map((p) => p.id)).toEqual(["I2"]);
    expect(r.missingPersonIds).toEqual(["I404"]);
  });

  it("filters fact types case-insensitively on the last URI segment, on persons and edges", async () => {
    await writeProject();
    const r = await treeQuery({ projectPath: dir, factTypes: ["birth", "MARRIAGE"] });
    if (!r.ok) throw new Error("not ok");
    expect(r.persons[0].facts.map((f) => f.id)).toEqual(["F1"]);
    expect(r.relationships[0].facts.map((f) => f.type)).toEqual(["Marriage"]);
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

  it("rejects non-array or non-string filters", async () => {
    await writeProject();
    expect(await treeQuery({ projectPath: dir, personIds: "I1" as any })).toMatchObject({ ok: false });
    expect(await treeQuery({ projectPath: dir, personIds: [1] as any })).toMatchObject({ ok: false });
    expect(await treeQuery({ projectPath: dir, factTypes: [null] as any })).toMatchObject({ ok: false });
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
    expect(r.persons[0].names).toEqual([]);
    expect(r.persons[0].facts).toHaveLength(1);
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

  it("is advertised with projectPath required and no write surface", () => {
    expect(treeQuerySchema.name).toBe("tree_query");
    expect(treeQuerySchema.inputSchema.required).toEqual(["projectPath"]);
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
    const r = await projectContext({ projectPath: dir });
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

  it("falls back to null and [] when the profile is absent or malformed", async () => {
    const a = await ctx({ project: { id: "rp_001" } });
    expect(a.narrationGuidance).toBeNull();
    expect(a.subscriptions).toEqual([]);
    const b = await ctx({ project: { id: "rp_001" }, researcher_profile: { narration_guidance: null, subscriptions: "x" } });
    expect(b.narrationGuidance).toBeNull();
    expect(b.subscriptions).toEqual([]);
  });
});

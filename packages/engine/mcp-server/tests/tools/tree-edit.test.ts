import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, readFile, rm, access } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// Stub the network place resolver so add_fact/update_fact tests are offline and
// deterministic. The tool calls resolveStandardPlace(place) → standardized name.
vi.mock("../../src/utils/place-resolver.js", () => ({
  resolveStandardPlace: vi.fn(async (text: string) =>
    text === "Schuylkill County, Pennsylvania" ? "Schuylkill, Pennsylvania, United States" : null,
  ),
}));

import { treeEdit } from "../../src/tools/tree-edit.js";

const minimalResearch = {
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

describe("tree_edit", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tree-edit-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeProject(tree: any, research: any = minimalResearch) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree, null, 2));
  }
  const readTree = async () => JSON.parse(await readFile(join(dir, "tree.gedcomx.json"), "utf-8"));
  const exists = async (rel: string) => access(join(dir, rel)).then(() => true, () => false);

  const onePerson = () => ({
    persons: [
      {
        id: "I1",
        gender: "Male",
        names: [{ id: "N1", given: "John", surname: "Smith", preferred: true }],
        facts: [{ id: "F1", type: "Birth", date: "1850", primary: true }],
      },
    ],
    relationships: [],
    sources: [],
  });

  it("add_fact: assigns the next F id, resolves standard_place, swaps the primary, writes only the tree + .bak", async () => {
    await writeProject(onePerson());
    const researchBefore = await readFile(join(dir, "research.json"), "utf-8");

    const r = await treeEdit({
      projectPath: dir,
      operation: "add_fact",
      personId: "I1",
      fact: { type: "Birth", date: "1851", place: "Schuylkill County, Pennsylvania", primary: true },
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.assignedIds?.fact).toBe("F2");
    expect(r.filesWritten).toEqual(["tree.gedcomx.json"]);

    const tree = await readTree();
    const facts = tree.persons[0].facts;
    expect(facts).toHaveLength(2);
    const f2 = facts.find((f: any) => f.id === "F2");
    expect(f2.standard_place).toBe("Schuylkill, Pennsylvania, United States");
    expect(f2.primary).toBe(true);
    // the old Birth lost its primary (one primary per type)
    expect(facts.find((f: any) => f.id === "F1").primary).toBeUndefined();

    expect(await exists("tree.gedcomx.json.bak")).toBe(true);
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(researchBefore);
  });

  it("update_fact: merges fields by id and re-resolves standard_place on a place change", async () => {
    await writeProject(onePerson());
    const r = await treeEdit({
      projectPath: dir,
      operation: "update_fact",
      personId: "I1",
      factId: "F1",
      fact: { date: "1849", place: "Schuylkill County, Pennsylvania" },
    });
    expect(r.ok).toBe(true);
    const f1 = (await readTree()).persons[0].facts[0];
    expect(f1.date).toBe("1849");
    expect(f1.standard_place).toBe("Schuylkill, Pennsylvania, United States");
    expect(f1.id).toBe("F1");
  });

  it("add_name: assigns N id and moves the preferred flag", async () => {
    await writeProject(onePerson());
    const r = await treeEdit({
      projectPath: dir,
      operation: "add_name",
      personId: "I1",
      name: { given: "Johnny", surname: "Smith", preferred: true },
    });
    expect(r.ok && r.assignedIds?.name).toBe("N2");
    const names = (await readTree()).persons[0].names;
    expect(names).toHaveLength(2);
    expect(names.find((n: any) => n.id === "N1").preferred).toBeUndefined();
    expect(names.find((n: any) => n.id === "N2").preferred).toBe(true);
  });

  it("add_person: assigns I + N ids", async () => {
    await writeProject(onePerson());
    const r = await treeEdit({
      projectPath: dir,
      operation: "add_person",
      person: { gender: "Female", names: [{ given: "Margaret", surname: "Smith", preferred: true }] },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.assignedIds?.person).toBe("I2");
    expect(r.assignedIds?.names).toEqual(["N2"]);
    const tree = await readTree();
    expect(tree.persons.map((p: any) => p.id)).toEqual(["I1", "I2"]);
  });

  it("add_person: normalizes to exactly one preferred name", async () => {
    await writeProject(onePerson());
    // two names both flagged preferred → only the first kept
    const r1 = await treeEdit({
      projectPath: dir,
      operation: "add_person",
      person: {
        gender: "Female",
        names: [
          { given: "Margaret", surname: "Smith", preferred: true },
          { given: "Maggie", surname: "Smith", preferred: true },
        ],
      },
    });
    expect(r1.ok).toBe(true);
    const p2 = (await readTree()).persons.find((p: any) => p.id === "I2");
    expect(p2.names.filter((n: any) => n.preferred === true)).toHaveLength(1);
    expect(p2.names[0].preferred).toBe(true);

    // no name flagged preferred → first is marked
    const r2 = await treeEdit({
      projectPath: dir,
      operation: "add_person",
      person: { gender: "Male", names: [{ given: "Sam", surname: "Smith" }] },
    });
    expect(r2.ok).toBe(true);
    const p3 = (await readTree()).persons.find((p: any) => p.id === "I3");
    expect(p3.names[0].preferred).toBe(true);
  });

  it("add_relationship: assigns R id and links existing persons", async () => {
    const tree = onePerson();
    tree.persons.push({ id: "I2", gender: "Female", names: [{ id: "N2", given: "Mary", surname: "Smith", preferred: true }], facts: [] } as any);
    await writeProject(tree);
    const r = await treeEdit({
      projectPath: dir,
      operation: "add_relationship",
      relationship: { type: "Couple", person1: "I1", person2: "I2" },
    });
    expect(r.ok && r.assignedIds?.relationship).toBe("R1");
    expect((await readTree()).relationships[0]).toMatchObject({ id: "R1", type: "Couple", person1: "I1", person2: "I2" });
  });

  it("add_relationship: assigns F ids to couple facts (Marriage) so the tree validates", async () => {
    const tree = onePerson();
    tree.persons.push({ id: "I2", gender: "Female", names: [{ id: "N2", given: "Mary", surname: "Smith", preferred: true }], facts: [] } as any);
    await writeProject(tree);
    const r = await treeEdit({
      projectPath: dir,
      operation: "add_relationship",
      relationship: {
        type: "Couple",
        person1: "I1",
        person2: "I2",
        facts: [{ type: "Marriage", date: "12 May 1843", place: "St. Patrick's Church, Schuylkill County, Pennsylvania" }],
      } as any,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Tool assigns the fact id; F1 is taken by I1's birth, so the next free is F2.
    expect(r.assignedIds?.facts).toEqual(["F2"]);
    const rel = (await readTree()).relationships[0];
    expect(rel.facts[0]).toMatchObject({ id: "F2", type: "Marriage", date: "12 May 1843" });
  });

  it("add_relationship: rejects a caller-supplied fact id", async () => {
    const tree = onePerson();
    tree.persons.push({ id: "I2", gender: "Female", names: [{ id: "N2", given: "Mary", surname: "Smith", preferred: true }], facts: [] } as any);
    await writeProject(tree);
    const bad = await treeEdit({
      projectPath: dir,
      operation: "add_relationship",
      relationship: {
        type: "Couple",
        person1: "I1",
        person2: "I2",
        facts: [{ id: "F9", type: "Marriage", date: "1843" }],
      } as any,
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors.join(" ")).toMatch(/must not carry ids/);
  });

  it("remove: deletes a fact by id; refuses to remove a person", async () => {
    await writeProject(onePerson());
    const ok = await treeEdit({ projectPath: dir, operation: "remove", factId: "F1" });
    // removing the only Birth is structurally fine (person still has a name); validates.
    expect(ok.ok).toBe(true);
    expect((await readTree()).persons[0].facts).toHaveLength(0);

    const bad = await treeEdit({ projectPath: dir, operation: "remove", personId: "I1" });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors.join(" ")).toMatch(/merge_tree_persons/);
  });

  it("rejects a stale target id and writes nothing", async () => {
    await writeProject(onePerson());
    const treeBefore = await readFile(join(dir, "tree.gedcomx.json"), "utf-8");
    const r = await treeEdit({ projectPath: dir, operation: "update_fact", personId: "I1", factId: "F999", fact: { date: "1800" } });
    expect(r.ok).toBe(false);
    expect(await readFile(join(dir, "tree.gedcomx.json"), "utf-8")).toBe(treeBefore);
    expect(await exists("tree.gedcomx.json.bak")).toBe(false);
  });

  it("rejects an add_person payload that carries an id", async () => {
    await writeProject(onePerson());
    const r = await treeEdit({ projectPath: dir, operation: "add_person", person: { id: "I9", gender: "Male", names: [{ given: "X", surname: "Y" }] } as any });
    expect(r.ok).toBe(false);
  });

  it("writes nothing when the edit would invalidate the project", async () => {
    await writeProject(onePerson());
    const treeBefore = await readFile(join(dir, "tree.gedcomx.json"), "utf-8");
    // A ParentChild relationship referencing a non-existent child fails validation.
    const r = await treeEdit({
      projectPath: dir,
      operation: "add_relationship",
      relationship: { type: "ParentChild", parent: "I1", child: "I_GHOST" },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/I_GHOST/);
    expect(await readFile(join(dir, "tree.gedcomx.json"), "utf-8")).toBe(treeBefore);
    expect(await exists("tree.gedcomx.json.bak")).toBe(false);
  });

  it("add_source: assigns the next S id, rejects a caller-supplied id, writes only the tree + .bak", async () => {
    await writeProject(onePerson());
    const researchBefore = await readFile(join(dir, "research.json"), "utf-8");

    const r = await treeEdit({
      projectPath: dir,
      operation: "add_source",
      source: { title: "1850 U.S. Federal Census" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.assignedIds?.source).toBe("S1");
    expect(r.filesWritten).toEqual(["tree.gedcomx.json"]);

    const tree = await readTree();
    expect(tree.sources).toHaveLength(1);
    expect(tree.sources[0]).toMatchObject({ id: "S1", title: "1850 U.S. Federal Census" });

    expect(await exists("tree.gedcomx.json.bak")).toBe(true);
    // research.json is never touched by a source add
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(researchBefore);

    // a caller-supplied id is rejected (the tool assigns ids)
    const bad = await treeEdit({
      projectPath: dir,
      operation: "add_source",
      source: { id: "S9", title: "Should fail" } as any,
    });
    expect(bad.ok).toBe(false);
  });

  it("add_source twice: ids increment S1 -> S2 (nextId is S-aware)", async () => {
    await writeProject(onePerson());
    const r1 = await treeEdit({ projectPath: dir, operation: "add_source", source: { title: "First" } });
    expect(r1.ok && r1.assignedIds?.source).toBe("S1");
    const r2 = await treeEdit({ projectPath: dir, operation: "add_source", source: { title: "Second" } });
    expect(r2.ok && r2.assignedIds?.source).toBe("S2");
    expect((await readTree()).sources.map((s: any) => s.id)).toEqual(["S1", "S2"]);
  });

  it("add_source: author/url round-trip into the written S entry", async () => {
    await writeProject(onePerson());
    const r = await treeEdit({
      projectPath: dir,
      operation: "add_source",
      source: { title: "Pension File", author: "National Archives", url: "https://example.com/pension" },
    });
    expect(r.ok).toBe(true);
    const s1 = (await readTree()).sources.find((s: any) => s.id === "S1");
    expect(s1).toMatchObject({
      id: "S1",
      title: "Pension File",
      author: "National Archives",
      url: "https://example.com/pension",
    });
  });

  it("update_source: merges fields, leaves others intact, refuses to change id, errors on unknown id", async () => {
    const tree = onePerson();
    (tree as any).sources = [{ id: "S1", title: "Original Title", author: "Old Author" }];
    await writeProject(tree);

    const r = await treeEdit({
      projectPath: dir,
      operation: "update_source",
      sourceId: "S1",
      source: { citation: "Smith, *Census*, p. 4.", id: "S99" } as any,
    });
    expect(r.ok).toBe(true);
    const s1 = (await readTree()).sources.find((s: any) => s.id === "S1");
    expect(s1.id).toBe("S1"); // id immutable — the supplied id is ignored
    expect(s1.citation).toBe("Smith, *Census*, p. 4.");
    expect(s1.title).toBe("Original Title"); // untouched
    expect(s1.author).toBe("Old Author"); // untouched
    // no S99 was created
    expect((await readTree()).sources.map((s: any) => s.id)).toEqual(["S1"]);

    const bad = await treeEdit({
      projectPath: dir,
      operation: "update_source",
      sourceId: "S404",
      source: { title: "X" },
    });
    expect(bad.ok).toBe(false);
  });

  it("source operations: missing-argument guards write nothing", async () => {
    await writeProject(onePerson());
    const noSource = await treeEdit({ projectPath: dir, operation: "add_source" });
    expect(noSource.ok).toBe(false);
    const noId = await treeEdit({ projectPath: dir, operation: "update_source", source: { title: "X" } });
    expect(noId.ok).toBe(false);
    const noFields = await treeEdit({ projectPath: dir, operation: "update_source", sourceId: "S1" });
    expect(noFields.ok).toBe(false);
  });

  it("add_source: a source with no title fails validation and writes nothing", async () => {
    await writeProject(onePerson());
    const treeBefore = await readFile(join(dir, "tree.gedcomx.json"), "utf-8");
    const r = await treeEdit({
      projectPath: dir,
      operation: "add_source",
      source: { author: "No Title Source" } as any,
    });
    expect(r.ok).toBe(false);
    expect(await readFile(join(dir, "tree.gedcomx.json"), "utf-8")).toBe(treeBefore);
    expect(await exists("tree.gedcomx.json.bak")).toBe(false);
  });
});

describe("tree_edit (batch ops)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tree-edit-batch-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  async function writeProject(tree: any, research: any = minimalResearch) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree, null, 2));
  }
  const readTree = async () => JSON.parse(await readFile(join(dir, "tree.gedcomx.json"), "utf-8"));
  const exists = async (rel: string) => access(join(dir, rel)).then(() => true, () => false);
  const onePerson = () => ({
    persons: [
      {
        id: "I1",
        gender: "Male",
        names: [{ id: "N1", given: "John", surname: "Smith", preferred: true }],
        facts: [{ id: "F1", type: "Birth", date: "1850", primary: true }],
      },
    ],
    relationships: [],
    sources: [],
  });

  it("(a/c) applies a heterogeneous batch (source + person + fact) in one write, sequencing ids, one .bak", async () => {
    await writeProject(onePerson());
    const r = await treeEdit({
      projectPath: dir,
      ops: [
        { operation: "add_source", source: { title: "1850 Census" } }, // → S1
        { operation: "add_person", person: { gender: "Female", names: [{ given: "Mary", surname: "Smith" }] } }, // → I2
        { operation: "add_fact", personId: "I1", fact: { type: "Death", date: "1899" } }, // → F2 on existing person
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.results.map((x) => x.operation)).toEqual(["add_source", "add_person", "add_fact"]);
    expect(r.results[0].assignedIds?.source).toBe("S1");
    expect(r.results[1].assignedIds?.person).toBe("I2");
    expect(r.results[2].assignedIds?.fact).toBe("F2");
    expect(r.filesWritten).toEqual(["tree.gedcomx.json"]);
    expect(await exists("tree.gedcomx.json.bak")).toBe(true);
    const tree = await readTree();
    expect(tree.sources.map((s: any) => s.id)).toEqual(["S1"]);
    expect(tree.persons.map((p: any) => p.id)).toEqual(["I1", "I2"]);
  });

  it("intra-batch cross-op: add_person then add_relationship referencing the predicted I id validates", async () => {
    await writeProject(onePerson());
    const r = await treeEdit({
      projectPath: dir,
      ops: [
        { operation: "add_person", person: { gender: "Female", names: [{ given: "Mary", surname: "Smith" }] } }, // → I2 (max I is I1)
        { operation: "add_relationship", relationship: { type: "Couple", person1: "I1", person2: "I2" } }, // references op #0's I2
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.results[0].assignedIds?.person).toBe("I2");
    expect(r.results[1].assignedIds?.relationship).toBe("R1");
    expect((await readTree()).relationships[0]).toMatchObject({ id: "R1", person1: "I1", person2: "I2" });
  });

  it("(b) rolls back the whole batch on a validation failure — nothing written, no .bak", async () => {
    await writeProject(onePerson());
    const before = await readFile(join(dir, "tree.gedcomx.json"), "utf-8");
    const r = await treeEdit({
      projectPath: dir,
      ops: [
        { operation: "add_source", source: { title: "Valid source" } }, // ok alone
        { operation: "add_relationship", relationship: { type: "ParentChild", parent: "I1", child: "I_GHOST" } }, // dangling → validation fails
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/I_GHOST/);
    expect(await readFile(join(dir, "tree.gedcomx.json"), "utf-8")).toBe(before); // including the valid source op
    expect(await exists("tree.gedcomx.json.bak")).toBe(false);
  });

  it("indexes a per-op precondition failure as ops[i] and writes nothing", async () => {
    await writeProject(onePerson());
    const before = await readFile(join(dir, "tree.gedcomx.json"), "utf-8");
    const r = await treeEdit({
      projectPath: dir,
      ops: [
        { operation: "add_source", source: { title: "ok" } }, // op 0 ok
        { operation: "add_person", person: { id: "I9", gender: "Male", names: [{ given: "X", surname: "Y" }] } as any }, // op 1 carries id → throws
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/^ops\[1\]:/);
    expect(r.errors.join(" ")).toMatch(/must not carry an id/);
    expect(await readFile(join(dir, "tree.gedcomx.json"), "utf-8")).toBe(before);
    expect(await exists("tree.gedcomx.json.bak")).toBe(false);
  });

  it("rejects an empty ops array", async () => {
    await writeProject(onePerson());
    const r = await treeEdit({ projectPath: dir, ops: [] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/non-empty/);
  });

  // ── String-coercion: the model sometimes serializes a large `ops` batch (or a
  // single-op nested object) as a JSON *string* (see coerce-json-arg.ts). The
  // tool recovers it rather than rejecting it into a slow one-op-per-call fallback.
  it("(coerce) applies an ops batch that arrives as a JSON string", async () => {
    await writeProject(onePerson());
    const opsArray = [
      { operation: "add_source", source: { title: "1850 Census" } }, // → S1
      { operation: "add_person", person: { gender: "Female", names: [{ given: "Mary", surname: "Smith" }] } }, // → I2
      { operation: "add_fact", personId: "I1", fact: { type: "Death", date: "1899" } }, // → F2
    ];
    const r = await treeEdit({ projectPath: dir, ops: JSON.stringify(opsArray) as any });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.results.map((x) => x.operation)).toEqual(["add_source", "add_person", "add_fact"]);
    expect(r.results[1].assignedIds?.person).toBe("I2");
    expect((await readTree()).persons.map((p: any) => p.id)).toEqual(["I1", "I2"]);
  });

  it("(coerce) applies a single-op whose nested object arrives as a JSON string", async () => {
    await writeProject(onePerson());
    const r = await treeEdit({
      projectPath: dir,
      operation: "add_source",
      source: JSON.stringify({ title: "Stringified source" }) as any,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await readTree()).sources.map((s: any) => s.title)).toEqual(["Stringified source"]);
  });

  it("(coerce) leaves a non-JSON ops string alone → the existing non-empty-array error, writes nothing", async () => {
    await writeProject(onePerson());
    const before = await readFile(join(dir, "tree.gedcomx.json"), "utf-8");
    const r = await treeEdit({ projectPath: dir, ops: "not valid json" as any });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/non-empty/);
    expect(await readFile(join(dir, "tree.gedcomx.json"), "utf-8")).toBe(before);
  });
});

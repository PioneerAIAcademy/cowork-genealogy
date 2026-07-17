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
import { treeCorrect } from "../../src/tools/tree-correct.js";

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

  it("update_fact (tree_correct): merges fields by id and re-resolves standard_place on a place change", async () => {
    await writeProject(onePerson());
    const r = await treeCorrect({
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

  it("add_person: lifts a singular `name` object into a names[] array", async () => {
    // Models slip and send `name: {given, surname}` (~15% of add_person calls)
    // where the schema wants `names: [...]`; the tool should tolerate it.
    await writeProject(onePerson());
    const r = await treeEdit({
      projectPath: dir,
      operation: "add_person",
      person: { gender: "Female", name: { given: "Mary", surname: "Flynn" } } as any,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p2 = (await readTree()).persons.find((p: any) => p.id === "I2");
    expect(p2.names).toHaveLength(1);
    expect(p2.names[0]).toMatchObject({ given: "Mary", surname: "Flynn", preferred: true });
    // the stray singular key is not persisted (tree-shape additionalProperties)
    expect("name" in p2).toBe(false);
  });

  it("add_person: rejects when both `name` and `names` are supplied", async () => {
    await writeProject(onePerson());
    const r = await treeEdit({
      projectPath: dir,
      operation: "add_person",
      person: {
        gender: "Female",
        name: { given: "Mary", surname: "Flynn" },
        names: [{ given: "Mary", surname: "Flynn", preferred: true }],
      } as any,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/not both/);
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

  it("remove (tree_correct): deletes a fact by id; refuses to remove a person", async () => {
    await writeProject(onePerson());
    const ok = await treeCorrect({ projectPath: dir, operation: "remove", factId: "F1" });
    // removing the only Birth is structurally fine (person still has a name); validates.
    expect(ok.ok).toBe(true);
    expect((await readTree()).persons[0].facts).toHaveLength(0);

    const bad = await treeCorrect({ projectPath: dir, operation: "remove", personId: "I1" });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors.join(" ")).toMatch(/merge_tree_persons/);
  });

  it("rejects a stale target id and writes nothing", async () => {
    await writeProject(onePerson());
    const treeBefore = await readFile(join(dir, "tree.gedcomx.json"), "utf-8");
    const r = await treeCorrect({ projectPath: dir, operation: "update_fact", personId: "I1", factId: "F999", fact: { date: "1800" } });
    expect(r.ok).toBe(false);
    expect(await readFile(join(dir, "tree.gedcomx.json"), "utf-8")).toBe(treeBefore);
    expect(await exists("tree.gedcomx.json.bak")).toBe(false);
  });

  // ── Op gating: the tree_edit / tree_correct split ───────────────────────────
  it("tree_edit rejects a correction/removal op with a redirect to tree_correct, writing nothing", async () => {
    await writeProject(onePerson());
    const treeBefore = await readFile(join(dir, "tree.gedcomx.json"), "utf-8");

    const single = await treeEdit({
      projectPath: dir,
      operation: "update_name",
      personId: "I1",
      nameId: "N1",
      name: { given: "Renamed" },
    });
    expect(single.ok).toBe(false);
    if (single.ok) return;
    expect(single.errors.join(" ")).toMatch(/corrections and removals live in tree_correct/);
    expect(single.errors.join(" ")).toMatch(/'update_name'/);

    // batch form: the rejection is indexed ops[i] and nothing is written
    const batch = await treeEdit({
      projectPath: dir,
      ops: [
        { operation: "add_source", source: { title: "ok" } },
        { operation: "remove", factId: "F1" },
      ],
    });
    expect(batch.ok).toBe(false);
    if (batch.ok) return;
    expect(batch.errors[0]).toMatch(/^ops\[1\]:.*tree_correct/);

    expect(await readFile(join(dir, "tree.gedcomx.json"), "utf-8")).toBe(treeBefore);
    expect(await exists("tree.gedcomx.json.bak")).toBe(false);
  });

  it("tree_correct rejects an additive op with a redirect to tree_edit, writing nothing", async () => {
    await writeProject(onePerson());
    const treeBefore = await readFile(join(dir, "tree.gedcomx.json"), "utf-8");

    const single = await treeCorrect({
      projectPath: dir,
      operation: "add_person",
      person: { gender: "Female", names: [{ given: "Margaret", surname: "Smith" }] },
    });
    expect(single.ok).toBe(false);
    if (single.ok) return;
    expect(single.errors.join(" ")).toMatch(/additions live in tree_edit/);
    expect(single.errors.join(" ")).toMatch(/'add_person'/);

    const batch = await treeCorrect({
      projectPath: dir,
      ops: [{ operation: "add_fact", personId: "I1", fact: { type: "Death", date: "1899" } }],
    });
    expect(batch.ok).toBe(false);
    if (batch.ok) return;
    expect(batch.errors[0]).toMatch(/^ops\[0\]:.*tree_edit/);

    expect(await readFile(join(dir, "tree.gedcomx.json"), "utf-8")).toBe(treeBefore);
    expect(await exists("tree.gedcomx.json.bak")).toBe(false);
  });

  it("both tools still reject an operation neither admits as unknown", async () => {
    await writeProject(onePerson());
    const a = await treeEdit({ projectPath: dir, operation: "rename_person" as any });
    expect(a.ok).toBe(false);
    if (a.ok) return;
    expect(a.errors.join(" ")).toMatch(/unknown operation 'rename_person'/);

    const b = await treeCorrect({ projectPath: dir, operation: "rename_person" as any });
    expect(b.ok).toBe(false);
    if (b.ok) return;
    expect(b.errors.join(" ")).toMatch(/unknown operation 'rename_person'/);
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

  it("update_source (tree_correct): merges fields, leaves others intact, refuses to change id, errors on unknown id", async () => {
    const tree = onePerson();
    (tree as any).sources = [{ id: "S1", title: "Original Title", author: "Old Author" }];
    await writeProject(tree);

    const r = await treeCorrect({
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

    const bad = await treeCorrect({
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
    const noId = await treeCorrect({ projectPath: dir, operation: "update_source", source: { title: "X" } });
    expect(noId.ok).toBe(false);
    const noFields = await treeCorrect({ projectPath: dir, operation: "update_source", sourceId: "S1" });
    expect(noFields.ok).toBe(false);
  });

  // ── add_person inline facts: F ids assigned like add_relationship's ────────
  const twoPersonCoupleTree = () => {
    const tree = onePerson();
    tree.persons.push({
      id: "I2",
      gender: "Female",
      names: [{ id: "N2", given: "Mary", surname: "Smith", preferred: true }],
      facts: [],
    } as any);
    (tree as any).relationships = [
      { id: "R1", type: "Couple", person1: "I1", person2: "I2", facts: [{ id: "F2", type: "Marriage", date: "1840", primary: true }] },
    ];
    return tree;
  };

  it("add_person: assigns F ids to inline facts, resolves standard_place, reports them in assignedIds", async () => {
    await writeProject(onePerson());
    const r = await treeEdit({
      projectPath: dir,
      operation: "add_person",
      person: {
        gender: "Female",
        names: [{ given: "Margaret", surname: "Smith" }],
        facts: [
          { type: "Birth", date: "1852", place: "Schuylkill County, Pennsylvania" },
          { type: "Death", date: "1930" },
        ],
      } as any,
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("assignedIds" in r)) return;
    // F1 is taken by I1's birth, so the inline facts get F2, F3.
    expect(r.assignedIds?.facts).toEqual(["F2", "F3"]);
    expect(r.assignedIds?.person).toBe("I2");
    const p2 = (await readTree()).persons.find((p: any) => p.id === "I2");
    expect(p2.facts.map((f: any) => f.id)).toEqual(["F2", "F3"]);
    expect(p2.facts[0].standard_place).toBe("Schuylkill, Pennsylvania, United States");
  });

  it("add_person: rejects an inline fact that carries an id", async () => {
    await writeProject(onePerson());
    const treeBefore = await readFile(join(dir, "tree.gedcomx.json"), "utf-8");
    const r = await treeEdit({
      projectPath: dir,
      operation: "add_person",
      person: {
        gender: "Female",
        names: [{ given: "Margaret", surname: "Smith" }],
        facts: [{ id: "F9", type: "Birth", date: "1852" }],
      } as any,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/must not carry ids/);
    expect(await readFile(join(dir, "tree.gedcomx.json"), "utf-8")).toBe(treeBefore);
  });

  // ── Facts on existing relationships (relationshipId targeting) ─────────────
  it("add_fact: relationshipId appends to the Couple's own facts with an F id and the primary swap", async () => {
    await writeProject(twoPersonCoupleTree());
    const r = await treeEdit({
      projectPath: dir,
      operation: "add_fact",
      relationshipId: "R1",
      fact: { type: "Marriage", date: "12 May 1843", place: "Schuylkill County, Pennsylvania", primary: true },
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("assignedIds" in r)) return;
    expect(r.assignedIds?.fact).toBe("F3"); // F1 birth, F2 existing marriage
    const rel = (await readTree()).relationships[0];
    expect(rel.facts.map((f: any) => f.id)).toEqual(["F2", "F3"]);
    const f3 = rel.facts.find((f: any) => f.id === "F3");
    expect(f3.standard_place).toBe("Schuylkill, Pennsylvania, United States");
    expect(f3.primary).toBe(true);
    // the older Marriage lost its primary (one primary per type per holder)
    expect(rel.facts.find((f: any) => f.id === "F2").primary).toBeUndefined();
    // no fact was duplicated onto either spouse
    expect((await readTree()).persons.find((p: any) => p.id === "I2").facts ?? []).toHaveLength(0);
  });

  it("update_fact (tree_correct): relationshipId merges fields onto the Couple-held fact by id", async () => {
    await writeProject(twoPersonCoupleTree());
    const r = await treeCorrect({
      projectPath: dir,
      operation: "update_fact",
      relationshipId: "R1",
      factId: "F2",
      fact: { date: "3 June 1841" },
    });
    expect(r.ok).toBe(true);
    const f2 = (await readTree()).relationships[0].facts.find((f: any) => f.id === "F2");
    expect(f2.date).toBe("3 June 1841");
    expect(f2.id).toBe("F2");
  });

  it("add_fact/update_fact: reject when both or neither of personId/relationshipId is given", async () => {
    await writeProject(twoPersonCoupleTree());
    const both = await treeEdit({
      projectPath: dir,
      operation: "add_fact",
      personId: "I1",
      relationshipId: "R1",
      fact: { type: "Marriage", date: "1843" },
    });
    expect(both.ok).toBe(false);
    if (both.ok) return;
    expect(both.errors.join(" ")).toMatch(/exactly one of `personId` or `relationshipId`/);

    const neither = await treeCorrect({ projectPath: dir, operation: "update_fact", factId: "F2", fact: { date: "1841" } });
    expect(neither.ok).toBe(false);
    if (neither.ok) return;
    expect(neither.errors.join(" ")).toMatch(/exactly one of `personId` or `relationshipId`/);
  });

  it("add_fact: rejects a ParentChild relationship target and a stale relationshipId", async () => {
    const tree = twoPersonCoupleTree();
    (tree as any).relationships.push({ id: "R2", type: "ParentChild", parent: "I1", child: "I2" });
    await writeProject(tree);
    const pc = await treeEdit({
      projectPath: dir,
      operation: "add_fact",
      relationshipId: "R2",
      fact: { type: "Marriage", date: "1843" },
    });
    expect(pc.ok).toBe(false);
    if (pc.ok) return;
    expect(pc.errors.join(" ")).toMatch(/Couple relationships/);

    const stale = await treeEdit({
      projectPath: dir,
      operation: "add_fact",
      relationshipId: "R404",
      fact: { type: "Marriage", date: "1843" },
    });
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.errors.join(" ")).toMatch(/'R404' not found/);
  });

  it("update_fact (tree_correct): errors when the factId is not on the targeted relationship", async () => {
    await writeProject(twoPersonCoupleTree());
    // F1 exists, but on person I1 — not on R1.
    const r = await treeCorrect({
      projectPath: dir,
      operation: "update_fact",
      relationshipId: "R1",
      factId: "F1",
      fact: { date: "1841" },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/not found on relationship 'R1'/);
  });

  // ── Date/place shape validation on every fact write path ───────────────────
  const nestedDate = { original: "2 Oct 1876", formal: "+1876-10-02" };

  it("rejects a nested GedcomX date object on every fact write path, writing nothing", async () => {
    await writeProject(twoPersonCoupleTree());
    const treeBefore = await readFile(join(dir, "tree.gedcomx.json"), "utf-8");

    const attempts = [
      // add_fact on a person
      treeEdit({ projectPath: dir, operation: "add_fact", personId: "I1", fact: { type: "Death", date: nestedDate } as any }),
      // add_fact on a relationship
      treeEdit({ projectPath: dir, operation: "add_fact", relationshipId: "R1", fact: { type: "Marriage", date: nestedDate } as any }),
      // update_fact (tree_correct — same shared shape check)
      treeCorrect({ projectPath: dir, operation: "update_fact", personId: "I1", factId: "F1", fact: { date: nestedDate } as any }),
      // add_person inline fact
      treeEdit({
        projectPath: dir,
        operation: "add_person",
        person: { gender: "Male", names: [{ given: "Sam", surname: "Smith" }], facts: [{ type: "Birth", date: nestedDate }] } as any,
      }),
      // add_relationship fact
      treeEdit({
        projectPath: dir,
        operation: "add_relationship",
        relationship: { type: "Couple", person1: "I1", person2: "I2", facts: [{ type: "Divorce", date: nestedDate }] } as any,
      }),
    ];
    for (const attempt of attempts) {
      const r = await attempt;
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.errors.join(" ")).toMatch(/`date` must be a plain string/);
    }
    expect(await readFile(join(dir, "tree.gedcomx.json"), "utf-8")).toBe(treeBefore);
    expect(await exists("tree.gedcomx.json.bak")).toBe(false);
  });

  it("rejects a non-string place/standard_date and names the offending field", async () => {
    await writeProject(onePerson());
    const badPlace = await treeEdit({
      projectPath: dir,
      operation: "add_fact",
      personId: "I1",
      fact: { type: "Death", date: "1899", place: { original: "Pottsville" } } as any,
    });
    expect(badPlace.ok).toBe(false);
    if (badPlace.ok) return;
    expect(badPlace.errors.join(" ")).toMatch(/`place` must be a plain string/);

    const badStd = await treeCorrect({
      projectPath: dir,
      operation: "update_fact",
      personId: "I1",
      factId: "F1",
      fact: { standard_date: null } as any,
    });
    expect(badStd.ok).toBe(false);
    if (badStd.ok) return;
    expect(badStd.errors.join(" ")).toMatch(/`standard_date` must be a plain string.*got null/);
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

describe("tree_edit (add_household_children)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tree-edit-household-"));
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

  /** ut_013-style tree: Thomas (I1) is Patrick's (I2) father via R1. */
  const flynnTree = () => ({
    persons: [
      { id: "I1", gender: "Male", names: [{ id: "N1", given: "Thomas", surname: "Flynn", preferred: true }] },
      { id: "I2", gender: "Male", names: [{ id: "N2", given: "Patrick", surname: "Flynn", preferred: true }] },
    ],
    relationships: [{ id: "R1", type: "ParentChild", parent: "I1", child: "I2" }],
    sources: [],
  });

  it("creates stubs + edges for new children, skips the existing child, returns the checklist", async () => {
    await writeProject(flynnTree());
    const r = await treeEdit({
      projectPath: dir,
      operation: "add_household_children",
      parents: [
        { given: "Thomas", surname: "Flynn", gender: "Male" },
        { given: "Margaret", surname: "Flynn", gender: "Female" }, // not in tree
      ],
      children: [
        { given: "Bridget", surname: "Flynn", gender: "Female" },
        { given: "Patrick", surname: "Flynn", gender: "Male" }, // the subject — already I2
        { given: "John", surname: "Flynn", gender: "Male" },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || "results" in r) return;
    expect(r.household).toEqual({
      parentsMatched: [{ name: "Thomas Flynn", id: "I1" }],
      created: [
        { name: "Bridget Flynn", id: "I3" },
        { name: "John Flynn", id: "I4" },
      ],
      skipped: [{ name: "Patrick Flynn", reason: "already_child_of_parent", id: "I2" }],
      edgesAdded: 2,
    });
    expect(r.assignedIds?.persons).toEqual(["I3", "I4"]);
    expect(r.assignedIds?.relationships).toEqual(["R2", "R3"]);
    expect(r.filesWritten).toEqual(["tree.gedcomx.json"]);
    expect(await exists("tree.gedcomx.json.bak")).toBe(true);

    const tree = await readTree();
    const bridget = tree.persons.find((p: any) => p.id === "I3");
    // the established stub shape: gender + ONE preferred BirthName — no facts, no ark
    expect(bridget).toEqual({
      id: "I3",
      gender: "Female",
      names: [{ id: "N3", type: "BirthName", preferred: true, given: "Bridget", surname: "Flynn" }],
    });
    const newRels = tree.relationships.filter((x: any) => x.id !== "R1");
    expect(newRels).toEqual([
      { id: "R2", type: "ParentChild", parent: "I1", child: "I3" },
      { id: "R3", type: "ParentChild", parent: "I1", child: "I4" },
    ]);
  });

  it("no parent in the tree → skipped_no_parent_in_tree, zero writes, no .bak", async () => {
    await writeProject(flynnTree());
    const before = await readFile(join(dir, "tree.gedcomx.json"), "utf-8");
    const r = await treeEdit({
      projectPath: dir,
      operation: "add_household_children",
      parents: [{ given: "Henry", surname: "Bottermiller", gender: "Male" }],
      children: [{ given: "Willie", surname: "Bottermiller", gender: "Male" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || "results" in r) return;
    expect(r.action).toBe("skipped_no_parent_in_tree");
    expect(r.household?.parentsMatched).toEqual([]);
    expect(r.household?.created).toEqual([]);
    expect(r.household?.skipped).toEqual([{ name: "Willie Bottermiller", reason: "no_parent_in_tree" }]);
    expect(r.filesWritten).toEqual([]);
    expect(await readFile(join(dir, "tree.gedcomx.json"), "utf-8")).toBe(before);
    expect(await exists("tree.gedcomx.json.bak")).toBe(false);
  });

  it("dedup tolerance: Wm/William contraction, Will/William prefix, and accent-folded exact all skip", async () => {
    const tree = flynnTree();
    tree.persons.push(
      { id: "I3", gender: "Male", names: [{ id: "N3", given: "William", surname: "Flynn", preferred: true }] },
      { id: "I4", gender: "Male", names: [{ id: "N4", given: "Jose", surname: "Flynn", preferred: true }] },
    );
    tree.relationships.push({ id: "R2", type: "ParentChild", parent: "I1", child: "I3" });
    await writeProject(tree);
    const r = await treeEdit({
      projectPath: dir,
      operation: "add_household_children",
      parents: [{ given: "Thos", surname: "Flynn", gender: "Male" }], // contraction matches Thomas
      children: [
        { given: "Wm", surname: "Flynn", gender: "Male" }, // contraction → I3 (child of I1)
        { given: "José", surname: "Flynn", gender: "Male" }, // accent-folded → I4 (global, no edge)
        { given: "Biddy", surname: "Flynn", gender: "Female" }, // no match → created
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || "results" in r) return;
    expect(r.household?.parentsMatched).toEqual([{ name: "Thos Flynn", id: "I1" }]);
    expect(r.household?.skipped).toEqual([
      { name: "Wm Flynn", reason: "already_child_of_parent", id: "I3" },
      { name: "José Flynn", reason: "person_exists_in_tree", id: "I4" },
    ]);
    expect(r.household?.created).toEqual([{ name: "Biddy Flynn", id: "I5" }]);
  });

  it("gender mismatch does NOT dedup — a same-named child of the other sex is created", async () => {
    const tree = flynnTree();
    tree.persons.push({
      id: "I3",
      gender: "Female",
      names: [{ id: "N3", given: "Frances", surname: "Flynn", preferred: true }],
    });
    tree.relationships.push({ id: "R2", type: "ParentChild", parent: "I1", child: "I3" });
    await writeProject(tree);
    const r = await treeEdit({
      projectPath: dir,
      operation: "add_household_children",
      parents: [{ given: "Thomas", surname: "Flynn", gender: "Male" }],
      children: [{ given: "Frances", surname: "Flynn", gender: "Male" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || "results" in r) return;
    expect(r.household?.skipped).toEqual([]);
    expect(r.household?.created).toEqual([{ name: "Frances Flynn", id: "I4" }]);
  });

  it("multi-parent: every created stub gets one edge per matched parent", async () => {
    const tree = flynnTree();
    tree.persons.push({
      id: "I3",
      gender: "Female",
      names: [{ id: "N3", given: "Mary", surname: "Flynn", preferred: true }],
    });
    await writeProject(tree);
    const r = await treeEdit({
      projectPath: dir,
      operation: "add_household_children",
      parents: [
        { given: "Thomas", surname: "Flynn", gender: "Male" },
        { given: "Mary", surname: "Flynn", gender: "Female" },
      ],
      children: [
        { given: "Bridget", surname: "Flynn", gender: "Female" },
        { given: "John", surname: "Flynn", gender: "Male" },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || "results" in r) return;
    expect(r.household?.parentsMatched).toEqual([
      { name: "Thomas Flynn", id: "I1" },
      { name: "Mary Flynn", id: "I3" },
    ]);
    expect(r.household?.edgesAdded).toBe(4);
    const rels = (await readTree()).relationships.filter((x: any) => x.id !== "R1");
    expect(rels.map((x: any) => [x.parent, x.child])).toEqual([
      ["I1", "I4"],
      ["I3", "I4"],
      ["I1", "I5"],
      ["I3", "I5"],
    ]);
  });

  it("every child dedups away → nothing written (filesWritten [])", async () => {
    await writeProject(flynnTree());
    const before = await readFile(join(dir, "tree.gedcomx.json"), "utf-8");
    const r = await treeEdit({
      projectPath: dir,
      operation: "add_household_children",
      parents: [{ given: "Thomas", surname: "Flynn", gender: "Male" }],
      children: [{ given: "Patrick", surname: "Flynn", gender: "Male" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || "results" in r) return;
    expect(r.household?.created).toEqual([]);
    expect(r.household?.skipped).toEqual([{ name: "Patrick Flynn", reason: "already_child_of_parent", id: "I2" }]);
    expect(r.filesWritten).toEqual([]);
    expect(await readFile(join(dir, "tree.gedcomx.json"), "utf-8")).toBe(before);
  });

  it("an in-request duplicate child dedups against the stub created moments earlier", async () => {
    await writeProject(flynnTree());
    const r = await treeEdit({
      projectPath: dir,
      operation: "add_household_children",
      parents: [{ given: "Thomas", surname: "Flynn", gender: "Male" }],
      children: [
        { given: "Bridget", surname: "Flynn", gender: "Female" },
        { given: "Bridget", surname: "Flynn", gender: "Female" },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || "results" in r) return;
    expect(r.household?.created).toEqual([{ name: "Bridget Flynn", id: "I3" }]);
    expect(r.household?.skipped).toEqual([
      { name: "Bridget Flynn", reason: "person_exists_in_tree", id: "I3" },
    ]);
  });

  it("rejects malformed input: missing arrays, entry without gender, entry without any name part", async () => {
    await writeProject(flynnTree());
    const noChildren = await treeEdit({
      projectPath: dir,
      operation: "add_household_children",
      parents: [{ given: "Thomas", surname: "Flynn", gender: "Male" }],
    });
    expect(noChildren.ok).toBe(false);
    if (noChildren.ok) return;
    expect(noChildren.errors.join(" ")).toMatch(/non-empty `children` array/);

    const badGender = await treeEdit({
      projectPath: dir,
      operation: "add_household_children",
      parents: [{ given: "Thomas", surname: "Flynn", gender: "Male" }],
      children: [{ given: "Bridget", surname: "Flynn", gender: "girl" }],
    });
    expect(badGender.ok).toBe(false);
    if (badGender.ok) return;
    expect(badGender.errors.join(" ")).toMatch(/children\[0\] requires a gender/);

    const noName = await treeEdit({
      projectPath: dir,
      operation: "add_household_children",
      parents: [{ gender: "Male" }],
      children: [{ given: "Bridget", surname: "Flynn", gender: "Female" }],
    });
    expect(noName.ok).toBe(false);
    if (noName.ok) return;
    expect(noName.errors.join(" ")).toMatch(/parents\[0\] requires a given and\/or surname/);
  });

  it("works inside a batch, and tree_correct rejects the op (additive gate)", async () => {
    await writeProject(flynnTree());
    const r = await treeEdit({
      projectPath: dir,
      ops: [
        {
          operation: "add_household_children",
          parents: [{ given: "Thomas", surname: "Flynn", gender: "Male" }],
          children: [{ given: "Bridget", surname: "Flynn", gender: "Female" }],
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !("results" in r)) return;
    expect(r.results[0].operation).toBe("add_household_children");
    expect(r.results[0].household?.created).toEqual([{ name: "Bridget Flynn", id: "I3" }]);

    const rejected = await treeCorrect({
      projectPath: dir,
      operation: "add_household_children",
      parents: [{ given: "Thomas", surname: "Flynn", gender: "Male" }],
      children: [{ given: "John", surname: "Flynn", gender: "Male" }],
    });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.errors.join(" ")).toMatch(/additive op/);
  });
});

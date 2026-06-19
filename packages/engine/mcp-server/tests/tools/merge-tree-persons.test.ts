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
        impossibilities: [],
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
    });
    expect(result.newRelatives).toEqual([]);

    // both .bak backups written.
    expect(await exists("tree.gedcomx.json.bak")).toBe(true);
    expect(await exists("research.json.bak")).toBe(true);

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
});

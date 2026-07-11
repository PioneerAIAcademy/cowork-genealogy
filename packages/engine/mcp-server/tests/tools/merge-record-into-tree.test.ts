import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm, access } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { mergeRecordIntoTree } from "../../src/tools/merge-record-into-tree.js";

const minimalResearch = {
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
  timelines: [],
  proof_summaries: [],
  evaluations: [],
};

describe("merge_record_into_tree", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "merge-record-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeProject(tree: any, research: any = minimalResearch) {
    await writeFile(join(dir, "research.json"), JSON.stringify(research, null, 2));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree, null, 2));
  }

  const readJson = async (name: string) =>
    JSON.parse(await readFile(join(dir, name), "utf-8"));
  const exists = async (name: string) =>
    access(join(dir, name)).then(() => true, () => false);

  it("writes only tree.gedcomx.json, leaves research.json byte-unchanged, carries new relatives", async () => {
    await writeProject({
      persons: [{ id: "I1", gender: "Male", names: [{ id: "N1", given: "John", surname: "Smith" }] }],
      relationships: [],
      sources: [],
    });
    const researchBefore = await readFile(join(dir, "research.json"), "utf-8");

    const result = await mergeRecordIntoTree({
      projectPath: dir,
      candidateGedcomx: {
        persons: [
          { id: "I1", gender: "Male", names: [{ id: "N1", given: "J", surname: "Smith" }] },
          { id: "I2", gender: "Male", names: [{ id: "N2", given: "Robert", surname: "Smith" }] },
        ],
        relationships: [{ id: "R1", type: "ParentChild", parent: "I2", child: "I1" }],
      },
      merges: [["I1", "I1"]],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filesWritten).toEqual(["tree.gedcomx.json"]);
    expect(result.newRelatives).toEqual(["I2"]);
    expect(result.validation.valid).toBe(true);

    // research.json untouched.
    expect(await readFile(join(dir, "research.json"), "utf-8")).toBe(researchBefore);
    // tree.bak written before overwrite.
    expect(await exists("tree.gedcomx.json.bak")).toBe(true);

    const tree = await readJson("tree.gedcomx.json");
    const ids = tree.persons.map((p: any) => p.id).sort();
    expect(ids).toEqual(["I1", "I2"]);
    // carried-in father is linked as the parent of the survivor.
    expect(tree.relationships).toEqual([
      { id: "R1", type: "ParentChild", parent: "I2", child: "I1" },
    ]);
  });

  it("strips candidate places and person-level sources with a warning, and persists neither", async () => {
    await writeProject({
      persons: [{ id: "I1", gender: "Male", names: [{ id: "N1", given: "John", surname: "Smith" }] }],
      relationships: [],
      sources: [],
    });

    // A record_read-shaped candidate: persona-level source refs and a
    // places[] section are legal tool output but not tree format.
    const result = await mergeRecordIntoTree({
      projectPath: dir,
      candidateGedcomx: {
        persons: [
          {
            id: "I1",
            gender: "Male",
            names: [{ id: "N1", given: "John", surname: "Smith" }],
            sources: [{ ref: "S1" }],
          },
        ],
        sources: [{ id: "S1", title: "1850 Census" }],
        places: [{ id: "PL1", name: "Ireland" }],
      } as any,
      merges: [["I1", "I1"]],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.validation.warnings.some((w) => w.includes("place description"))).toBe(true);
    expect(result.validation.warnings.some((w) => w.includes("person-level source reference"))).toBe(true);

    const tree = await readJson("tree.gedcomx.json");
    expect(tree.places).toBeUndefined();
    expect(tree.persons[0].sources).toBeUndefined();
    // The candidate's source description still merges in — only the
    // person-level *reference* is dropped.
    expect(tree.sources.map((s: any) => s.title)).toContain("1850 Census");
  });

  it("reports name/fact merge counts and primarySet matching the merged tree", async () => {
    await writeProject({
      persons: [
        {
          id: "I1",
          gender: "Male",
          names: [{ id: "N1", given: "J", surname: "Smith" }],
          facts: [{ id: "F1", type: "Birth", place: "Utah" }],
        },
      ],
      relationships: [],
      sources: [],
    });

    const result = await mergeRecordIntoTree({
      projectPath: dir,
      candidateGedcomx: {
        persons: [
          {
            id: "C1",
            gender: "Male",
            names: [{ id: "N1", given: "John", surname: "Smith" }],
            facts: [{ id: "F1", type: "Birth", place: "Provo, Utah" }],
          },
        ],
      },
      merges: [["I1", "C1"]],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pairs).toHaveLength(1);
    const p = result.pairs[0];
    expect(p.survivorId).toBe("I1");
    expect(p.namesMerged).toBe(1);
    expect(p.namesKept).toBe(1);
    expect(p.factsMerged).toBe(1);
    expect(p.factsKept).toBe(1);
    expect(p.primarySet).toEqual(["Birth"]);
    expect(p.genderConflictKeptSurvivor).toBe(false);

    // The merged survivor keeps the fuller name and the more specific place.
    const tree = await readJson("tree.gedcomx.json");
    const surv = tree.persons.find((x: any) => x.id === "I1");
    expect(surv.names).toHaveLength(1);
    expect(surv.names[0]).toMatchObject({ given: "John", surname: "Smith", preferred: true });
    expect(surv.facts).toHaveLength(1);
    expect(surv.facts[0]).toMatchObject({ type: "Birth", place: "Provo, Utah", primary: true });
  });

  it("rejects a malformed candidateGedcomx before merging or writing", async () => {
    await writeProject({
      persons: [{ id: "I1", gender: "Male", names: [{ id: "N1", given: "John", surname: "Smith" }] }],
      relationships: [],
      sources: [],
    });
    const treeBefore = await readFile(join(dir, "tree.gedcomx.json"), "utf-8");

    const result = await mergeRecordIntoTree({
      projectPath: dir,
      // person missing required names → validateGedcomx rejects.
      candidateGedcomx: { persons: [{ id: "C1", gender: "Male", names: [] }] },
      merges: [["I1", "C1"]],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/candidateGedcomx/);
    expect(await readFile(join(dir, "tree.gedcomx.json"), "utf-8")).toBe(treeBefore);
    expect(await exists("tree.gedcomx.json.bak")).toBe(false);
  });

  it("returns a staleness error and writes nothing when a survivor id is not in the on-disk tree", async () => {
    await writeProject({
      persons: [{ id: "I1", gender: "Male", names: [{ id: "N1", given: "John", surname: "Smith" }] }],
      relationships: [],
      sources: [],
    });
    const treeBefore = await readFile(join(dir, "tree.gedcomx.json"), "utf-8");

    const result = await mergeRecordIntoTree({
      projectPath: dir,
      candidateGedcomx: { persons: [{ id: "C1", gender: "Male", names: [{ id: "N1", given: "Jo", surname: "Smith" }] }] },
      merges: [["I999", "C1"]],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/I999 not found in target/);
    expect(await readFile(join(dir, "tree.gedcomx.json"), "utf-8")).toBe(treeBefore);
    expect(await exists("tree.gedcomx.json.bak")).toBe(false);
  });

  it("writes nothing when the would-be project fails validation", async () => {
    // Pre-existing dangling reference makes the project invalid; the merge must
    // refuse rather than overwrite.
    const badResearch = {
      ...minimalResearch,
      project: { ...minimalResearch.project, subject_person_ids: ["I_GHOST"] },
    };
    await writeProject(
      {
        persons: [{ id: "I1", gender: "Male", names: [{ id: "N1", given: "John", surname: "Smith" }] }],
        relationships: [],
        sources: [],
      },
      badResearch,
    );
    const treeBefore = await readFile(join(dir, "tree.gedcomx.json"), "utf-8");

    const result = await mergeRecordIntoTree({
      projectPath: dir,
      candidateGedcomx: { persons: [{ id: "C1", gender: "Male", names: [{ id: "N1", given: "Jon", surname: "Smith" }] }] },
      merges: [["I1", "C1"]],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/I_GHOST/);
    expect(await readFile(join(dir, "tree.gedcomx.json"), "utf-8")).toBe(treeBefore);
    expect(await exists("tree.gedcomx.json.bak")).toBe(false);
  });

  it("returns a clear error when tree.gedcomx.json is missing", async () => {
    await writeFile(join(dir, "research.json"), JSON.stringify(minimalResearch, null, 2));
    const result = await mergeRecordIntoTree({
      projectPath: dir,
      candidateGedcomx: { persons: [{ id: "C1", gender: "Male", names: [{ id: "N1", given: "A", surname: "B" }] }] },
      merges: [["I1", "C1"]],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/tree\.gedcomx\.json not found/);
  });
});

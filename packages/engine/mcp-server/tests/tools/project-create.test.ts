import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm, access } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { projectCreate } from "../../src/tools/project-create.js";

/**
 * `project_create` is the only route by which a project comes into existence.
 * Before it, `init-project` held no writer tool and built both documents with a
 * bare `Write` — which the shipped PreToolUse hook denies by basename, with no
 * exemption for a file that does not exist yet. Confirmed live in Cowork: the
 * `Write` was denied, `tree_edit` refused because the files were absent, and the
 * agent then wrote both through `device_bash`, and that write landed.
 *
 * So the cases that matter here are the ones that decide whether that bypass has
 * a sanctioned replacement: does it create BOTH documents, does it refuse to
 * overwrite one that exists, and does a rejected create leave nothing behind.
 */

const SUBJECT = {
  id: "I1",
  gender: "Male",
  names: [{ id: "N1", preferred: true, given: "Patrick", surname: "Flynn" }],
};
const TREE_SOURCE = { id: "S1", title: "FamilySearch Family Tree" };

describe("project_create", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "project-create-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const readResearch = async () => JSON.parse(await readFile(join(dir, "research.json"), "utf-8"));
  const readTree = async () =>
    JSON.parse(await readFile(join(dir, "tree.gedcomx.json"), "utf-8"));
  const exists = async (name: string) =>
    access(join(dir, name)).then(
      () => true,
      () => false,
    );

  // ── The headline case ────────────────────────────────────────────────────

  it("creates both documents in an empty directory", async () => {
    const r = await projectCreate({
      projectPath: dir,
      objective: "Identify the parents of Patrick Flynn",
      title: "Patrick Flynn's parents",
      subjectPersonIds: ["I1"],
      tree: { persons: [SUBJECT], relationships: [], sources: [TREE_SOURCE] },
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filesWritten).toEqual(["tree.gedcomx.json", "research.json"]);
    expect(r.counts).toEqual({ persons: 1, relationships: 0, sources: 1 });

    const research = await readResearch();
    expect(research.project.objective).toBe("Identify the parents of Patrick Flynn");
    expect(research.project.title).toBe("Patrick Flynn's parents");
    expect(research.project.subject_person_ids).toEqual(["I1"]);
    expect(research.project.id).toBe("rp_001");
    expect(research.project.status).toBe("active");
    expect(research.project.created).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(research.project.updated).toBe(research.project.created);

    const tree = await readTree();
    expect(tree.persons).toHaveLength(1);
    expect(tree.sources[0].id).toBe("S1");
  });

  it("starts every analytical section empty", async () => {
    await projectCreate({ projectPath: dir, objective: "Who were John's parents?" });
    const research = await readResearch();
    for (const section of [
      "questions",
      "plans",
      "log",
      "sources",
      "assertions",
      "person_evidence",
      "conflicts",
      "hypotheses",
      "timelines",
      "proof_summaries",
      "evaluations",
    ]) {
      expect(research[section], `${section} should start empty`).toEqual([]);
    }
  });

  it("writes no researcher_profile and no known_holdings", async () => {
    // Both are written afterwards through research_append, from what the
    // researcher actually said. A project was observed created with an
    // experience level and subscriptions the user was never asked for, and a
    // fabricated profile is indistinguishable downstream from a real one while
    // an absent one falls back to sane defaults everywhere.
    await projectCreate({ projectPath: dir, objective: "Who were John's parents?" });
    const research = await readResearch();
    expect(research.researcher_profile).toBeUndefined();
    expect(research.known_holdings).toBeUndefined();
  });

  it("creates a valid empty tree when none is supplied", async () => {
    const r = await projectCreate({ projectPath: dir, objective: "Who were John's parents?" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.counts).toEqual({ persons: 0, relationships: 0, sources: 0 });
    expect(await readTree()).toEqual({ persons: [], relationships: [], sources: [] });
  });

  // ── Create, never upsert ─────────────────────────────────────────────────

  it("refuses when research.json already exists, and changes nothing", async () => {
    await writeFile(join(dir, "research.json"), '{"project":{"objective":"existing"}}');
    const r = await projectCreate({ projectPath: dir, objective: "a different objective" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/exists in projectPath/);
    // The audit trail this would have destroyed is unreconstructible.
    expect(JSON.parse(await readFile(join(dir, "research.json"), "utf-8")).project.objective).toBe(
      "existing",
    );
    expect(await exists("tree.gedcomx.json")).toBe(false);
  });

  it("refuses a complete existing project, and points at the writer tools", async () => {
    // Both present is the ordinary "this is already a project" case, and there
    // the writers DO work — unlike the half-present case below.
    await writeFile(join(dir, "research.json"), '{"project":{"objective":"existing"}}');
    await writeFile(join(dir, "tree.gedcomx.json"), '{"persons":[],"relationships":[],"sources":[]}');
    const r = await projectCreate({ projectPath: dir, objective: "a different objective" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/already exist in projectPath/);
    expect(r.errors.join(" ")).toMatch(/research_append/);
  });

  it("refuses when only tree.gedcomx.json exists", async () => {
    // The half-present case: a researcher who exported or moved the tree still
    // must not have a create silently overwrite the other half.
    await writeFile(join(dir, "tree.gedcomx.json"), '{"persons":[],"relationships":[],"sources":[]}');
    const r = await projectCreate({ projectPath: dir, objective: "an objective" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/tree\.gedcomx\.json/);
    expect(await exists("research.json")).toBe(false);
  });

  it.each([
    ["research.json", "tree.gedcomx.json"],
    ["tree.gedcomx.json", "research.json"],
  ])(
    "names the MISSING file when only %s is present, and never says delete",
    async (present, missing) => {
      // Measured: with either file alone, project_create, research_append AND
      // tree_edit all refuse — every writer reads both documents. So a refusal
      // that points at the other writers points at another dead end, which is
      // the failure this whole tool exists to remove.
      //
      // And it must not offer "delete the one that survived" as the way out:
      // when that is research.json it is the audit trail, the half nothing can
      // reconstruct.
      const body =
        present === "research.json"
          ? '{"project":{}}'
          : '{"persons":[],"relationships":[],"sources":[]}';
      await writeFile(join(dir, present), body);
      const r = await projectCreate({ projectPath: dir, objective: "an objective" });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      const msg = r.errors.join(" ");
      expect(msg).toContain(missing);
      expect(msg).toMatch(/restore/i);
      expect(msg).not.toMatch(/use research_append and the tree tools/);
      expect(msg).not.toMatch(/^(?!.*Do not delete).*\bdelete\b.*$/);
      expect(await exists(missing)).toBe(false);
    },
  );

  // ── An objective is not optional ─────────────────────────────────────────

  it.each([
    ["absent", undefined],
    ["empty", ""],
    ["whitespace", "   "],
  ])("refuses a %s objective and writes nothing", async (_label, objective) => {
    const r = await projectCreate({ projectPath: dir, objective: objective as string });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/objective is required/);
    expect(await exists("research.json")).toBe(false);
    expect(await exists("tree.gedcomx.json")).toBe(false);
  });

  it("trims the objective it stores", async () => {
    await projectCreate({ projectPath: dir, objective: "  Who were John's parents?  " });
    expect((await readResearch()).project.objective).toBe("Who were John's parents?");
  });

  // ── The pair is validated together ───────────────────────────────────────

  it("refuses a subject person the tree does not contain, and writes NEITHER file", async () => {
    // This is why the tool takes the tree rather than creating an empty one and
    // leaving the caller to add persons afterwards: a dangling
    // subject_person_ids is a hard validator error, so a header-first create
    // would impose an ordering constraint that has to be got right every time.
    const r = await projectCreate({
      projectPath: dir,
      objective: "Identify the parents of Patrick Flynn",
      subjectPersonIds: ["I9"],
      tree: { persons: [SUBJECT], relationships: [], sources: [TREE_SOURCE] },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/I9/);
    expect(await exists("research.json")).toBe(false);
    expect(await exists("tree.gedcomx.json")).toBe(false);
  });

  it("refuses a malformed tree, and writes NEITHER file", async () => {
    const r = await projectCreate({
      projectPath: dir,
      objective: "Identify the parents of Patrick Flynn",
      tree: { persons: [{ id: "I1", gender: "Martian" }], relationships: [], sources: [] },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(await exists("research.json")).toBe(false);
    expect(await exists("tree.gedcomx.json")).toBe(false);
  });

  it("accepts a subject person that IS in the tree", async () => {
    const r = await projectCreate({
      projectPath: dir,
      objective: "Identify the parents of Patrick Flynn",
      subjectPersonIds: ["I1"],
      tree: { persons: [SUBJECT], relationships: [], sources: [TREE_SOURCE] },
    });
    expect(r.ok).toBe(true);
  });

  // ── Argument hygiene ─────────────────────────────────────────────────────

  it("omits title when none is given rather than writing an empty one", async () => {
    await projectCreate({ projectPath: dir, objective: "Who were John's parents?" });
    expect((await readResearch()).project.title).toBeUndefined();
  });

  it("defaults subject_person_ids to an empty array", async () => {
    // Empty, not absent: the schema types it as an array, and the set-once
    // predicate on research_append treats [] as unset, so it stays fillable.
    await projectCreate({ projectPath: dir, objective: "Who were John's parents?" });
    expect((await readResearch()).project.subject_person_ids).toEqual([]);
  });

  it("requires a projectPath", async () => {
    const r = await projectCreate({ projectPath: "", objective: "an objective" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/projectPath is required/);
  });
});

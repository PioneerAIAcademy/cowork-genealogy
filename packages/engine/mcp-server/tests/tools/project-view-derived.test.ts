import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { callProjectView, connectorProjectView, deriveProject, READ_PROJECT_VIEW } from "../../src/tools/project-view.js";

// `derived` on named states: what only the engine computes for a card.

const REPO = resolve(__dirname, "../../../../..");
const MCANDREW = join(REPO, "docs/captures/2026-09-29-mcandrew-children");
const COMPOUND = join(REPO, "eval/fixtures/scenarios/compound-objective-fully-covered");
const FLYNN = join(REPO, "eval/fixtures/scenarios/flynn-prior-craft-verdict");
const FOLDER = "proj_0123456789abcdef";

const context = connectorProjectView({});

let base: string;
let project: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "project-view-derived-"));
  project = join(base, FOLDER);
  await mkdir(project);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

async function stage(fixture: string): Promise<void> {
  await cp(fixture, project, { recursive: true });
}

async function derived(): Promise<any> {
  const result = await callProjectView(context, READ_PROJECT_VIEW, { part: "document", projectPath: project });
  return (result.structuredContent as any).derived;
}

const json = async (path: string) => JSON.parse(await readFile(path, "utf8"));
const writeJson = (name: string, value: unknown) => writeFile(join(project, name), JSON.stringify(value), "utf8");

describe("derived", () => {
  it("McAndrew: every question's state, no starting tree, and a missing verdict file is not craft", async () => {
    await stage(MCANDREW);
    const d = await derived();
    expect(d.folderName).toBe(FOLDER);
    expect(d.questions.map((q: any) => [q.id, q.state])).toEqual([["q_001", "critiqued"]]);
    expect(d.awaitingUser).toEqual([]);
    expect(d.treeChanges).toBeNull();
    expect(d.evaluations).toEqual({ ev_001: { body: null, craft: false } });
  });

  it("the compound fixture: a live proof-critique's body, not craft", async () => {
    await stage(COMPOUND);
    const d = await derived();
    expect(d.evaluations.ev_001.craft).toBe(false);
    expect(d.evaluations.ev_001.body.verdict).toBe("looks_solid");
  });

  it("Flynn: a craft read is marked craft", async () => {
    await stage(FLYNN);
    const d = await derived();
    expect(d.evaluations.ev_001.craft).toBe(true);
  });

  it("reads no verdict outside evaluations/, and leaves out a retired one", async () => {
    await stage(COMPOUND);
    const research = await json(join(project, "research.json"));
    const live = research.evaluations[0];
    research.evaluations = [
      { ...live, id: "ev_002", file_path: "research.json" },
      { ...live, id: "ev_003", file_path: "evaluations/../research.json" },
      { ...live, id: "ev_004", file_path: "evaluations/absent.json" },
      { ...live, id: "ev_005", superseded_by: "ev_002" },
    ];
    await writeJson("research.json", research);
    const d = await derived();
    expect(d.evaluations).toEqual({
      ev_002: { body: null, craft: false },
      ev_003: { body: null, craft: false },
      ev_004: { body: null, craft: false },
    });
  });

  it("tree changes against the starting tree", async () => {
    await stage(MCANDREW);
    const tree = await json(join(project, "tree.gedcomx.json"));
    const added = tree.persons.at(-1).id;
    await writeJson("starting-tree.gedcomx.json", { ...tree, persons: tree.persons.slice(0, -1) });
    const d = await derived();
    expect(d.treeChanges.personsAdded).toEqual([added]);
  });

  it("a retired assertion is never half of an unregistered disagreement", () => {
    const assertion = (id: string, year: string) => ({ id, fact_type: "birth", date: year, value: year });
    const research = (retired: boolean) => ({
      questions: [{ id: "q_001", question: "When was Ann born?", status: "in_progress" }],
      assertions: [
        { ...assertion("a_001", "1850"), extracted_for_question_ids: ["q_001"] },
        { ...assertion("a_002", "1862"), extracted_for_question_ids: ["q_001"], superseded_by: retired ? "a_003" : null },
      ],
      person_evidence: [
        { id: "pe_001", person_id: "I1", assertion_id: "a_001", confidence: "probable" },
        { id: "pe_002", person_id: "I1", assertion_id: "a_002", confidence: "probable" },
      ],
    });
    const count = (retired: boolean) =>
      deriveProject({ folderName: FOLDER, research: research(retired), tree: null, startingTree: null, evaluationBodies: {} })
        .questions![0].unregisteredDisagreements.length;
    expect(count(false)).toBe(1);
    expect(count(true)).toBe(0);
  });

  it("a malformed tree costs only its own field", () => {
    const d = deriveProject({
      folderName: FOLDER,
      research: { questions: [{ id: "q_001", question: "Who?" }] },
      tree: { persons: "not a list" },
      startingTree: { persons: 7 },
      evaluationBodies: {},
    });
    expect(d.treeChanges).toBeNull();
    expect(d.questions).toHaveLength(1);
  });
});

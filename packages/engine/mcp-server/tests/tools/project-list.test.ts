import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { projectList } from "../../src/tools/project-list.js";
import { runWithProjectStore, unboundProjectStore } from "../../src/store/project-store.js";
import { ScopedFsStore, SCOPED_ANCHOR } from "../helpers/scoped-fs-store.js";

describe("project_list", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "project-list-test-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function seed(projectId: string, research: unknown, tree: unknown) {
    const dir = join(root, projectId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "research.json"), JSON.stringify(research));
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree));
  }

  it("on the file store says the working folder is the project, with no project list", async () => {
    const result = await projectList();
    expect(result).toEqual({
      mode: "folder",
      message:
        "The task's working folder is the project: pass its absolute path as projectPath, " +
        "and read what it holds with project_context.",
    });
  });

  it("on a store bound to a project lists it with its objective and subjects", async () => {
    await seed(
      "p1",
      {
        project: {
          id: "rp_001",
          objective: "Identify the parents of Patrick Flynn",
          subject_person_ids: ["LZNY-BRF", "I9"],
          status: "active",
          created: "2026-10-01",
          updated: "2026-10-20",
        },
      },
      {
        persons: [
          {
            id: "LZNY-BRF",
            names: [
              { id: "N2", given: "Pat", surname: "Flynn" },
              { id: "N1", given: "Patrick", surname: "Flynn", preferred: true },
            ],
          },
        ],
      },
    );
    const result = await runWithProjectStore(new ScopedFsStore(root, "p1"), () => projectList());
    expect(result).toEqual({
      mode: "hosted",
      projects: [
        {
          projectPath: SCOPED_ANCHOR,
          objective: "Identify the parents of Patrick Flynn",
          subjects: [
            { id: "LZNY-BRF", name: "Patrick Flynn" },
            { id: "I9", name: null },
          ],
          status: "active",
          updated: "2026-10-20",
        },
      ],
      message: "Pass a listed project's projectPath to continue it. No other project can be started here.",
    });
  });

  it("on a bound store with no research.json yet offers the anchor as newProjectPath", async () => {
    const result = await runWithProjectStore(new ScopedFsStore(root, "empty"), () => projectList());
    expect(result.mode).toBe("hosted");
    expect(result.projects).toEqual([]);
    expect(result.newProjectPath).toBe(SCOPED_ANCHOR);
    expect(result.message).toBe("No project yet: pass newProjectPath as projectPath to start one.");
  });

  it("lists a project whose documents do not parse, with nulls", async () => {
    const dir = join(root, "bad");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "research.json"), "{ not json");
    const result = await runWithProjectStore(new ScopedFsStore(root, "bad"), () => projectList());
    expect(result.projects).toEqual([
      { projectPath: SCOPED_ANCHOR, objective: null, subjects: [], status: null, updated: null },
    ]);
  });

  it("on an unbound store rejects with that store's message", async () => {
    const message = "no project bound: send X-Genealogy-Project-Id";
    await expect(runWithProjectStore(unboundProjectStore(message), () => projectList())).rejects.toThrow(message);
  });
});

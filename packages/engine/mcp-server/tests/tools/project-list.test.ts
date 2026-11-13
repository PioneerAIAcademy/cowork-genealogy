import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { setFlagsFromString } from "v8";
import { runInNewContext } from "vm";

import {
  MAX_FIELD_CHARS,
  MAX_LISTED_SUBJECTS,
  MAX_OBJECTIVE_CHARS,
  projectList,
} from "../../src/tools/project-list.js";
import { ownedProjectsStore, runWithProjectStore, unboundProjectStore } from "../../src/store/project-store.js";
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
        "The task's working folder is the project: pass its absolute path as projectPath. " +
        "This answer does not say whether the folder holds a project yet: call project_context " +
        "with that path before routing, and route on what it returns. " +
        "A request about a named FamilySearch person starts a project first, through the research skill.",
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
    expect(result.message).toBe(
      "No project yet: pass newProjectPath as projectPath to start one. " +
        "A request about a named FamilySearch person starts a project first, through the research skill.",
    );
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

  it.each(["research.json", "tree.gedcomx.json"])(
    "a read of %s that fails other than by absence rejects, so the project never lists as one with no subject",
    async (failing) => {
      await seed("p1", { project: { objective: "o", subject_person_ids: ["I1"] } }, { persons: [] });
      const store = new ScopedFsStore(root, "p1");
      const readText = store.readText.bind(store);
      vi.spyOn(store, "readText").mockImplementation(async (projectPath, ref) => {
        if (ref === failing) throw new Error("timeout exceeded when trying to connect");
        return readText(projectPath, ref);
      });
      await expect(runWithProjectStore(store, () => projectList())).rejects.toThrow(
        "timeout exceeded when trying to connect",
      );
    },
  );

  it("on an unbound store rejects with that store's message", async () => {
    const message = "no project bound: send X-Genealogy-Project-Id";
    await expect(runWithProjectStore(unboundProjectStore(message), () => projectList())).rejects.toThrow(message);
  });

  describe("a signed-in user's listing", () => {
    const FRESH = "/proj_fresh";

    /** The store a connector call naming no project gets, over these project ids. */
    function userStore(ids: string[], opts: { truncated?: boolean; signal?: AbortSignal } = {}) {
      return ownedProjectsStore("name a project", {
        listOwned: async () => ({ projectPaths: ids.map((id) => `/${id}`), truncated: opts.truncated ?? false }),
        freshPath: FRESH,
        storeFor: (path) => new ScopedFsStore(root, path.slice(1), path),
        signal: opts.signal ?? new AbortController().signal,
      });
    }

    const listUser = (ids: string[], opts?: { truncated?: boolean; signal?: AbortSignal }) =>
      runWithProjectStore(userStore(ids, opts), () => projectList());

    async function onlyEntry(project: unknown, tree: unknown = { persons: [] }) {
      await seed("p1", { project }, tree);
      const { projects } = await listUser(["p1"]);
      expect(projects).toHaveLength(1);
      return projects![0]!;
    }

    it("reports a listing that names every project with no truncated key and no warning", async () => {
      await seed("p1", { project: { objective: "o" } }, { persons: [] });
      const result = await listUser(["p1"]);
      expect(result).not.toHaveProperty("truncated");
      expect(result).toEqual({
        mode: "hosted",
        projects: [{ projectPath: "/p1", objective: "o", subjects: [], status: null, updated: null }],
        newProjectPath: FRESH,
        message:
          "Pass a listed project's projectPath to continue it. " +
          "To start a project for a person none of them is about, pass newProjectPath as projectPath.",
      });
    });

    it("says a cut listing is cut, in the field and in the message the router reads", async () => {
      await seed("p1", { project: { objective: "o" } }, { persons: [] });
      const result = await listUser(["p1"], { truncated: true });
      expect(result.truncated).toBe(true);
      expect(result.projects).toHaveLength(1);
      expect(result.message).toBe(
        "Pass a listed project's projectPath to continue it. " +
          "To start a project for a person none of them is about, pass newProjectPath as projectPath. " +
          "More projects exist than are listed, and the most recently updated come first, so a " +
          "person none of them is about may already have one: ask the researcher before starting a new project.",
      );
    });

    it("never says No project yet when the cut left nothing to list", async () => {
      const result = await listUser([], { truncated: true });
      expect(result.projects).toEqual([]);
      expect(result.truncated).toBe(true);
      expect(result.message).not.toContain("No project yet");
      expect(result.message).toContain("More projects exist than are listed");
    });

    it("keeps an objective at the limit whole", async () => {
      const objective = "x".repeat(MAX_OBJECTIVE_CHARS);
      expect((await onlyEntry({ objective })).objective).toBe(objective);
    });

    it("cuts an objective past the limit and marks the cut", async () => {
      const objective = "x".repeat(MAX_OBJECTIVE_CHARS + 1);
      expect((await onlyEntry({ objective })).objective).toBe(`${"x".repeat(MAX_OBJECTIVE_CHARS)}…`);
    });

    it("cuts a million-character objective to the same length", async () => {
      const entry = await onlyEntry({ objective: "x".repeat(1_000_000) });
      expect(entry.objective).toHaveLength(MAX_OBJECTIVE_CHARS + 1);
    });

    it("keeps none of a cut objective's text in memory once the entry is built", async () => {
      setFlagsFromString("--expose-gc");
      const gc = runInNewContext("gc") as () => void;
      const count = 30;
      const ids = Array.from({ length: count }, (_, i) => `big${i}`);
      for (const id of ids) {
        await seed(id, { project: { objective: `${id} `.repeat(250_000) } }, { persons: [] });
      }

      gc();
      const before = process.memoryUsage().heapUsed;
      const { projects } = await listUser(ids);
      gc();
      const grew = process.memoryUsage().heapUsed - before;

      // A retained objective is 1 MB or more, so holding them all is 30 MB.
      expect(projects).toHaveLength(count);
      expect(grew).toBeLessThan(10_000_000);
    });

    // A real pool queues the tree read behind every other call, so what a listing
    // holds there is multiplied by however many a caller has running.
    it.each<[string, (big: string) => unknown]>([
      ["objective", (big) => ({ objective: big })],
      ["subject id", (big) => ({ subject_person_ids: [big] })],
      ["status", (big) => ({ status: big })],
      ["list of subject ids", (big) => ({ subject_person_ids: big.split(" ") })],
    ])("concurrent listings waiting on their tree read hold none of a huge %s", async (_field, projectOf) => {
      setFlagsFromString("--expose-gc");
      const gc = runInNewContext("gc") as () => void;
      await seed("p1", { project: projectOf("xy ".repeat(350_000)) }, { persons: [] });

      const count = 30;
      const waiting: Array<() => void> = [];
      let allWaiting!: () => void;
      const reachedTreeRead = new Promise<void>((resolve) => (allWaiting = resolve));
      const listing = () =>
        ownedProjectsStore("name a project", {
          listOwned: async () => ({ projectPaths: ["/p1"], truncated: false }),
          freshPath: FRESH,
          storeFor: (path) => {
            const scoped = new ScopedFsStore(root, path.slice(1), path);
            const readText = scoped.readText.bind(scoped);
            // Not a spy: a mock keeps every value it returns, which is what this measures.
            scoped.readText = async (projectPath, ref) => {
              if (ref === "tree.gedcomx.json") {
                await new Promise<void>((go) => {
                  if (waiting.push(go) === count) allWaiting();
                });
              }
              return readText(projectPath, ref);
            };
            return scoped;
          },
          signal: new AbortController().signal,
        });

      gc();
      const before = process.memoryUsage().heapUsed;
      const listings = Array.from({ length: count }, () => runWithProjectStore(listing(), () => projectList()));
      await reachedTreeRead;
      gc();
      const grew = process.memoryUsage().heapUsed - before;
      for (const go of waiting) go();

      // Each document holds about 1 MB of text, so all of them is 30 MB.
      expect((await Promise.all(listings)).map((r) => r.projects)).toHaveLength(count);
      expect(grew).toBeLessThan(10_000_000);
    });

    it("never leaves half a surrogate pair at the cut, which a client could not send on", async () => {
      const objective = `${"x".repeat(MAX_OBJECTIVE_CHARS - 1)}\u{1F600}y`;
      expect((await onlyEntry({ objective })).objective).toBe(`${"x".repeat(MAX_OBJECTIVE_CHARS - 1)}\uFFFD…`);
    });

    it("keeps a surrogate pair that ends exactly at the cut", async () => {
      const kept = `${"x".repeat(MAX_OBJECTIVE_CHARS - 2)}\u{1F600}`;
      expect((await onlyEntry({ objective: `${kept}y` })).objective).toBe(`${kept}…`);
    });

    const subjectIds = (count: number) => Array.from({ length: count }, (_, i) => `I${i}`);

    it("lists every subject at the limit, with no moreSubjects", async () => {
      const ids = subjectIds(MAX_LISTED_SUBJECTS);
      const entry = await onlyEntry({ subject_person_ids: ids });
      expect(entry.subjects.map((s) => s.id)).toEqual(ids);
      expect(entry).not.toHaveProperty("moreSubjects");
    });

    it("lists the first subjects past the limit and counts the rest", async () => {
      const ids = subjectIds(MAX_LISTED_SUBJECTS + 2);
      const entry = await onlyEntry({ subject_person_ids: ids });
      expect(entry.subjects.map((s) => s.id)).toEqual(ids.slice(0, MAX_LISTED_SUBJECTS));
      expect(entry.moreSubjects).toBe(2);
    });

    it.each([
      ["at", MAX_FIELD_CHARS, (s: string) => s],
      ["past", MAX_FIELD_CHARS + 1, (s: string) => `${s.slice(0, MAX_FIELD_CHARS)}…`],
    ])("bounds every other text in an entry %s the limit", async (_label, length, expected) => {
      const long = "y".repeat(length);
      const entry = await onlyEntry(
        { subject_person_ids: [long], status: long, updated: long },
        { persons: [{ id: long, names: [{ id: "N1", given: long, preferred: true }] }] },
      );
      expect(entry.status).toBe(expected(long));
      expect(entry.updated).toBe(expected(long));
      expect(entry.subjects).toEqual([{ id: expected(long), name: expected(long) }]);
    });

    it("stops reading when the caller goes, and rejects rather than answering a short list", async () => {
      await seed("p1", { project: { objective: "first" } }, { persons: [] });
      await seed("p2", { project: { objective: "second" } }, { persons: [] });
      const client = new AbortController();
      const read: string[] = [];
      const store = ownedProjectsStore("name a project", {
        listOwned: async () => ({ projectPaths: ["/p1", "/p2"], truncated: false }),
        freshPath: FRESH,
        storeFor: (path) => {
          const scoped = new ScopedFsStore(root, path.slice(1), path);
          const readText = scoped.readText.bind(scoped);
          vi.spyOn(scoped, "readText").mockImplementation(async (projectPath, ref) => {
            read.push(`${projectPath}:${ref}`);
            if (ref === "tree.gedcomx.json") client.abort();
            return readText(projectPath, ref);
          });
          return scoped;
        },
        signal: client.signal,
      });

      await expect(runWithProjectStore(store, () => projectList())).rejects.toThrow("aborted");
      expect(read).toEqual(["/p1:research.json", "/p1:tree.gedcomx.json"]);
    });
  });

  it("on a store bound to one project keeps everything verbatim: the bounds are the user listing's", async () => {
    const ids = Array.from({ length: MAX_LISTED_SUBJECTS + 2 }, (_, i) => `I${i}`);
    const objective = "x".repeat(MAX_OBJECTIVE_CHARS + 1);
    const given = "y".repeat(MAX_FIELD_CHARS + 1);
    await seed(
      "p1",
      { project: { objective, subject_person_ids: ids, status: "active" } },
      { persons: [{ id: "I0", names: [{ id: "N1", given, preferred: true }] }] },
    );
    const result = await runWithProjectStore(new ScopedFsStore(root, "p1"), () => projectList());
    expect(result).not.toHaveProperty("truncated");
    const [entry] = result.projects!;
    expect(entry!.objective).toBe(objective);
    expect(entry!.subjects.map((s) => s.id)).toEqual(ids);
    expect(entry!.subjects[0]!.name).toBe(given);
    expect(entry).not.toHaveProperty("moreSubjects");
  });
});

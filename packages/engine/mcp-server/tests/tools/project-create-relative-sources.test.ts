import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Offline: the place retry and place search find nothing.
vi.mock("../../src/utils/place-resolver.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/place-resolver.js")>();
  return { ...actual, resolveStandardPlace: vi.fn(async () => null) };
});
vi.mock("../../src/utils/place-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/place-api.js")>();
  return { ...actual, searchPlace: vi.fn(async () => []) };
});

import { mkdtemp, readFile, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { runProjectCreate, type ProjectCreateDeps } from "../../src/tools/project-create.js";
import type { RelativeSourcesResult } from "../../src/utils/relative-sources.js";
import { LOCAL } from "../../src/auth/principal.js";

const CENSUS_URL = "https://familysearch.org/ark:/61903/1:1:AAAA-111";

/** Patrick and his wife Mary; the 1850 census is attached to Patrick and, in
 *  FamilySearch, to Mary too. */
const READ = {
  persons: [
    {
      id: "KWCJ-RN4",
      gender: "Male",
      names: [{ preferred: true, given: "Patrick", surname: "Flynn" }],
      sources: [{ ref: "SRC-1" }],
    },
    { id: "KWCJ-RN5", gender: "Female", names: [{ preferred: true, given: "Mary", surname: "Doyle" }] },
  ],
  relationships: [{ type: "Couple", person1: "KWCJ-RN4", person2: "KWCJ-RN5" }],
  sources: [{ id: "SRC-1", title: "1850 census", citation: "Census cite", url: CENSUS_URL }],
};

/** The census as FamilySearch returns it from Mary's sources, and one source only she has. */
const SHARED = {
  id: "SRC-1",
  titles: [{ value: "1850 census" }],
  citations: [{ value: "Census cite" }],
  about: CENSUS_URL,
};
const MARRIAGE = {
  id: "SRC-2",
  titles: [{ value: "Marriage record" }],
  citations: [{ value: "Marriage cite" }],
  about: "https://familysearch.org/ark:/61903/1:1:BBBB-222",
};

describe("project_create — the relatives' attached sources", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "project-create-relsrc-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const text = (name: string) => readFile(join(dir, name), "utf-8");
  const json = async (name: string) => JSON.parse(await text(name));
  /** The store keeps project files read-only on disk, so a test edit replaces the file. */
  const rewrite = async (name: string, data: unknown) => {
    await rm(join(dir, name));
    await writeFile(join(dir, name), JSON.stringify(data, null, 2));
  };

  const seenOpts: Array<Record<string, unknown>> = [];
  const reader =
    (skipped?: string[]): ProjectCreateDeps["readPerson"] =>
    async (id, opts) => {
      seenOpts.push({ ...opts });
      return {
        result: structuredClone(READ) as never,
        resolvedId: id,
        memoryKinds: {},
        ...(skipped ? { relativeSourcesSkipped: skipped } : {}),
      };
    };
  const create = (skipped?: string[]): Promise<any> =>
    runProjectCreate(
      { projectPath: dir, objective: "Find Patrick's parents", personId: "KWCJ-RN4" },
      { readPerson: reader(skipped) },
      LOCAL,
    );

  const fetched: Array<{ ids: string[]; deadline: number }> = [];
  const fetcher =
    (answer: RelativeSourcesResult): NonNullable<ProjectCreateDeps["fetchRelativeSources"]> =>
    async (ids, _principal, deadline) => {
      fetched.push({ ids, deadline });
      return structuredClone(answer);
    };
  const fill = (input: Record<string, unknown>, answer: RelativeSourcesResult): Promise<any> =>
    runProjectCreate(
      { projectPath: dir, ...input } as never,
      { readPerson: reader(), fetchRelativeSources: fetcher(answer) },
      LOCAL,
    );
  const READ_MARY: RelativeSourcesResult = {
    descriptions: [SHARED, MARRIAGE],
    skipped: [],
    idsBy: { "KWCJ-RN5": ["SRC-1", "SRC-2"] },
  };

  beforeEach(() => {
    seenOpts.length = 0;
    fetched.length = 0;
  });

  it("reads with the relatives' sources ahead of memory transcription", async () => {
    expect((await create()).ok).toBe(true);
    expect(seenOpts).toHaveLength(1);
    expect(seenOpts[0].relativeSourcesFirst).toBe(true);
  });

  it("names the relatives whose sources were skipped, by tree id", async () => {
    const r = await create(["KWCJ-RN5"]);
    expect(r.ok).toBe(true);
    expect(r.relativeSourcesSkipped).toEqual(["I2"]);
  });

  it("carries no skipped list when none were skipped, and no fill fields", async () => {
    for (const skipped of [undefined, []]) {
      await rm(dir, { recursive: true, force: true });
      dir = await mkdtemp(join(tmpdir(), "project-create-relsrc-"));
      const r = await create(skipped);
      expect(r.ok).toBe(true);
      expect("relativeSourcesSkipped" in r).toBe(false);
      expect("filled" in r).toBe(false);
      expect(r.filesWritten).toEqual(["tree.gedcomx.json", "research.json", "starting-tree.gedcomx.json"]);
    }
  });

  it("fillRelativeSources cites a skipped relative's sources on her, reusing one the tree holds", async () => {
    expect((await create(["KWCJ-RN5"])).ok).toBe(true);
    const researchBefore = await text("research.json");
    const treeBefore = await json("tree.gedcomx.json");
    expect(treeBefore.sources.map((s: any) => s.id)).toEqual(["S1", "S2"]);
    expect(treeBefore.persons[1].sources).toBeUndefined();

    const start = Date.now();
    const r = await fill({ fillRelativeSources: ["I2"] }, READ_MARY);

    expect(r).toMatchObject({
      ok: true,
      filesWritten: ["tree.gedcomx.json", "starting-tree.gedcomx.json"],
      filled: [{ id: "I2", name: "Mary Doyle", sources: 2 }],
      sourcesAdded: 1,
      sourcesReused: 1,
    });
    expect("relativeSourcesSkipped" in r).toBe(false);
    expect(fetched).toEqual([{ ids: ["KWCJ-RN5"], deadline: expect.any(Number) }]);
    // A fresh budget, not what the create spent.
    expect(fetched[0].deadline - start).toBeGreaterThan(30_000);

    const tree = await json("tree.gedcomx.json");
    expect(tree.sources).toEqual([
      ...treeBefore.sources,
      { id: "S3", title: "Marriage record", citation: "Marriage cite", url: MARRIAGE.about },
    ]);
    // The census is one source cited on both, as the create's read would have made it.
    expect(tree.persons[0].sources).toEqual([{ ref: "S2" }]);
    expect(tree.persons[1].sources).toEqual([{ ref: "S2" }, { ref: "S3" }]);
    expect(await json("starting-tree.gedcomx.json")).toEqual(tree);
    expect(await text("research.json")).toBe(researchBefore);
  });

  it("fillRelativeSources is idempotent: a second fill adds nothing and writes nothing", async () => {
    await create(["KWCJ-RN5"]);
    await fill({ fillRelativeSources: ["I2"] }, READ_MARY);
    const treeAfterFirst = await text("tree.gedcomx.json");
    const r = await fill({ fillRelativeSources: ["I2"] }, READ_MARY);
    expect(r).toMatchObject({ ok: true, filesWritten: [], sourcesAdded: 0, sourcesReused: 2 });
    expect(await text("tree.gedcomx.json")).toBe(treeAfterFirst);
  });

  it("leaves the starting tree alone once the tree has moved on from it", async () => {
    await create(["KWCJ-RN5"]);
    const tree = await json("tree.gedcomx.json");
    tree.persons[0].living = false;
    await rewrite("tree.gedcomx.json", tree);
    const baseline = await text("starting-tree.gedcomx.json");
    const r = await fill({ fillRelativeSources: ["I2"] }, READ_MARY);
    expect(r).toMatchObject({ ok: true, filesWritten: ["tree.gedcomx.json"] });
    expect(await text("starting-tree.gedcomx.json")).toBe(baseline);
  });

  it("reports a relative still unread, and writes nothing for them", async () => {
    await create(["KWCJ-RN5"]);
    const before = await text("tree.gedcomx.json");
    const r = await fill({ fillRelativeSources: ["I2"] }, { descriptions: [], skipped: ["KWCJ-RN5"], idsBy: {} });
    expect(r).toMatchObject({ ok: true, filesWritten: [], filled: [], relativeSourcesSkipped: ["I2"] });
    expect(await text("tree.gedcomx.json")).toBe(before);
  });

  describe("refusals, each before any read and writing nothing", () => {
    const refusedWith = async (input: Record<string, unknown>, pattern: RegExp) => {
      const files = ["tree.gedcomx.json", "research.json", "starting-tree.gedcomx.json"];
      const before = await Promise.all(files.map((f) => text(f).catch(() => null)));
      const r = await fill(input, READ_MARY);
      expect(r.ok).toBe(false);
      expect(r.errors.join(" ")).toMatch(pattern);
      expect(fetched).toEqual([]);
      expect(await Promise.all(files.map((f) => text(f).catch(() => null)))).toEqual(before);
    };

    it("an id that is not a tree person", async () => {
      await create(["KWCJ-RN5"]);
      await refusedWith({ fillRelativeSources: ["I2", "I99"] }, /I99 \(not in the tree\)/);
    });

    it("a tree person with no FamilySearch ark", async () => {
      await create(["KWCJ-RN5"]);
      const tree = await json("tree.gedcomx.json");
      delete tree.persons[1].ark;
      await rewrite("tree.gedcomx.json", tree);
      await refusedWith({ fillRelativeSources: ["I2"] }, /I2 \(no FamilySearch ark\)/);
    });

    it("a folder with no project", async () => {
      await refusedWith({ fillRelativeSources: ["I2"] }, /adds to an existing project/);
    });

    it("a create's inputs beside it", async () => {
      await create(["KWCJ-RN5"]);
      await refusedWith({ fillRelativeSources: ["I2"], personId: "KWCJ-RN4" }, /remove personId/);
    });

    it("an empty list", async () => {
      await create(["KWCJ-RN5"]);
      await refusedWith({ fillRelativeSources: [] }, /non-empty array of tree person ids/);
    });
  });
});

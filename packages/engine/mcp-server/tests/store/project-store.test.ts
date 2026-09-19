import { describe, it, expect, afterEach } from "vitest";
import { FsProjectStore } from "../../src/store/fs-project-store.js";
import {
  getProjectStore,
  runWithProjectStore,
  setProjectStore,
  unboundProjectStore,
  type ProjectStore,
} from "../../src/store/project-store.js";

// The two bindings `getProjectStore()` resolves — per request (ALS) over per
// process — and the unbound store a shared server installs so a request that
// bound nothing fails instead of reaching another project's store or the file
// backend.

/** Every `ProjectStore` method. `satisfies` makes a method added to the
 *  interface and forgotten here a tsc error in the `pretest` typecheck; a
 *  runtime walk of `FsProjectStore.prototype` would trip on its private helpers. */
const METHODS = {
  withTransaction: true,
  classifyProject: true,
  projectDirState: true,
  findNestingAncestor: true,
  exists: true,
  readText: true,
  list: true,
  writeJson: true,
  writeJsonBoth: true,
  writeBytes: true,
  appendText: true,
  remove: true,
} satisfies Record<keyof ProjectStore, true>;

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("project store binding", () => {
  afterEach(() => {
    setProjectStore(null);
  });

  it("runWithProjectStore wins over setProjectStore inside the callback and is gone after it", async () => {
    const processStore = unboundProjectStore("process");
    const requestStore = unboundProjectStore("request");
    setProjectStore(processStore);
    expect(getProjectStore()).toBe(processStore);

    const seen = await runWithProjectStore(requestStore, async () => {
      const before = getProjectStore();
      await tick();
      const after = getProjectStore();
      return { before, after };
    });
    expect(seen.before).toBe(requestStore);
    expect(seen.after).toBe(requestStore);
    expect(getProjectStore()).toBe(processStore);
  });

  it("two concurrent scopes each see their own store across an await", async () => {
    const a = unboundProjectStore("a");
    const b = unboundProjectStore("b");
    setProjectStore(unboundProjectStore("process"));

    // Interleave: each scope yields to the other between its two reads.
    const [seenA, seenB] = await Promise.all([
      runWithProjectStore(a, async () => {
        const first = getProjectStore();
        await tick();
        await tick();
        return [first, getProjectStore()];
      }),
      runWithProjectStore(b, async () => {
        const first = getProjectStore();
        await tick();
        return [first, getProjectStore()];
      }),
    ]);
    expect(seenA).toEqual([a, a]);
    expect(seenB).toEqual([b, b]);
  });

  it("an unbound store rejects every ProjectStore method with the given message", async () => {
    const message = "no project bound: send X-Genealogy-Project-Id";
    const store = unboundProjectStore(message);
    for (const name of Object.keys(METHODS) as (keyof ProjectStore)[]) {
      const method = store[name] as (...args: unknown[]) => Promise<unknown>;
      await expect(method.call(store, "/project", "research.json"), name).rejects.toThrow(message);
    }
  });

  it("installed as the process store with nothing bound, getProjectStore returns it and never builds FsProjectStore", async () => {
    const unbound = unboundProjectStore("build/http.js binds a project store per request");
    setProjectStore(unbound);
    const store = getProjectStore();
    expect(store).toBe(unbound);
    expect(store).not.toBeInstanceOf(FsProjectStore);
    await expect(store.readText("/project", "research.json")).rejects.toThrow(
      "build/http.js binds a project store per request",
    );
    // Still no file backend after the rejection.
    expect(getProjectStore()).toBe(unbound);
  });
});

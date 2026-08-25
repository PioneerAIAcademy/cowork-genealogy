import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, readdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  isInsideProject,
  assertInsideProject,
  atomicWriteJson,
  atomicWriteBoth,
  withProjectLock,
} from "../../src/utils/project-io.js";

describe("project-io write layer", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "project-io-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe("isInsideProject / assertInsideProject", () => {
    it("accepts a project-relative path", () => {
      expect(isInsideProject(dir, "results/log_001.json")).toBe(true);
      expect(assertInsideProject(dir, "results/log_001.json")).toBe(
        join(dir, "results/log_001.json"),
      );
    });

    it("accepts the project root itself", () => {
      expect(isInsideProject(dir, ".")).toBe(true);
    });

    it("rejects a traversal escape", () => {
      expect(isInsideProject(dir, "../escape.json")).toBe(false);
      expect(isInsideProject(dir, "results/../../escape.json")).toBe(false);
      expect(() => assertInsideProject(dir, "../escape.json")).toThrow(
        /escapes the project directory/,
      );
    });

    it("rejects an absolute path outside the project", () => {
      expect(isInsideProject(dir, "/etc/passwd")).toBe(false);
      expect(() => assertInsideProject(dir, "/etc/passwd")).toThrow();
    });
  });

  describe("atomicWriteJson", () => {
    it("writes pretty JSON and leaves no temp file behind", async () => {
      const path = join(dir, "research.json");
      await atomicWriteJson(path, { a: 1, b: [2, 3] });

      const text = await readFile(path, "utf-8");
      expect(JSON.parse(text)).toEqual({ a: 1, b: [2, 3] });
      expect(text).toBe(JSON.stringify({ a: 1, b: [2, 3] }, null, 2));

      const leftovers = (await readdir(dir)).filter((f) => f.includes(".tmp-"));
      expect(leftovers).toEqual([]);
    });

    it("creates missing parent directories", async () => {
      const path = join(dir, "results", "log_007.json");
      await atomicWriteJson(path, { log_id: "log_007" });
      expect(JSON.parse(await readFile(path, "utf-8"))).toEqual({ log_id: "log_007" });
    });

    it("overwrites an existing file in place", async () => {
      const path = join(dir, "tree.gedcomx.json");
      await writeFile(path, JSON.stringify({ old: true }), "utf-8");
      await atomicWriteJson(path, { new: true });
      expect(JSON.parse(await readFile(path, "utf-8"))).toEqual({ new: true });
    });
  });

  describe("atomicWriteBoth", () => {
    it("writes both files and leaves no temps", async () => {
      const treePath = join(dir, "tree.gedcomx.json");
      const researchPath = join(dir, "research.json");
      await atomicWriteBoth([
        { path: treePath, data: { tree: 1 } },
        { path: researchPath, data: { research: 1 } },
      ]);

      expect(JSON.parse(await readFile(treePath, "utf-8"))).toEqual({ tree: 1 });
      expect(JSON.parse(await readFile(researchPath, "utf-8"))).toEqual({ research: 1 });
      const leftovers = (await readdir(dir)).filter((f) => f.includes(".tmp-"));
      expect(leftovers).toEqual([]);
    });

    it("a failure during the temp-write phase leaves both targets unchanged (both-or-neither)", async () => {
      const treePath = join(dir, "tree.gedcomx.json");
      const researchPath = join(dir, "research.json");
      await writeFile(treePath, JSON.stringify({ tree: "old" }), "utf-8");
      await writeFile(researchPath, JSON.stringify({ research: "old" }), "utf-8");

      // A circular object cannot be serialized → JSON.stringify throws before
      // any rename, so neither target is touched.
      const circular: any = {};
      circular.self = circular;

      await expect(
        atomicWriteBoth([
          { path: treePath, data: { tree: "new" } },
          { path: researchPath, data: circular },
        ]),
      ).rejects.toThrow();

      expect(JSON.parse(await readFile(treePath, "utf-8"))).toEqual({ tree: "old" });
      expect(JSON.parse(await readFile(researchPath, "utf-8"))).toEqual({ research: "old" });
      const leftovers = (await readdir(dir)).filter((f) => f.includes(".tmp-"));
      expect(leftovers).toEqual([]);
    });

    it("a failure injected between the two renames leaves the first new and the second old", async () => {
      const treePath = join(dir, "tree.gedcomx.json");
      const researchPath = join(dir, "research.json");
      await writeFile(treePath, JSON.stringify({ tree: "old" }), "utf-8");
      await writeFile(researchPath, JSON.stringify({ research: "old" }), "utf-8");

      await expect(
        atomicWriteBoth(
          [
            { path: treePath, data: { tree: "new" } },
            { path: researchPath, data: { research: "new" } },
          ],
          {
            onBeforeSecondRename: () => {
              throw new Error("simulated crash between renames");
            },
          },
        ),
      ).rejects.toThrow(/between renames/);

      // First file committed (new), second still old — the documented residual window.
      expect(JSON.parse(await readFile(treePath, "utf-8"))).toEqual({ tree: "new" });
      expect(JSON.parse(await readFile(researchPath, "utf-8"))).toEqual({ research: "old" });
    });
  });

  describe("withProjectLock reentrancy guard", () => {
    // These would HANG on a non-guarded mutex; vitest's per-test timeout is the
    // backstop that makes "throws instead of deadlocks" a falsifiable assertion.
    it("rejects a same-project re-acquire instead of deadlocking, naming the key", async () => {
      await expect(
        withProjectLock(dir, async () => {
          // Re-acquiring the SAME project's lock from inside the critical section.
          return withProjectLock(dir, async () => "unreachable");
        }),
      ).rejects.toThrow(/re-entered for '.*': a locked writer called another/);
    });

    it("catches re-entry reached through a non-lock await chain", async () => {
      const inner = async () => withProjectLock(dir, async () => "unreachable");
      await expect(
        withProjectLock(dir, async () => {
          await Promise.resolve();
          return inner();
        }),
      ).rejects.toThrow(/re-entered/);
    });

    it("allows nested locks on DIFFERENT projects (only same-key re-entry deadlocks)", async () => {
      const other = await mkdtemp(join(tmpdir(), "project-io-test-b-"));
      try {
        const result = await withProjectLock(dir, async () =>
          withProjectLock(other, async () => "inner"),
        );
        expect(result).toBe("inner");
      } finally {
        await rm(other, { recursive: true, force: true });
      }
    });

    it("does not poison the lock: a sequential re-acquire after the body settles succeeds", async () => {
      const first = await withProjectLock(dir, async () => "first");
      expect(first).toBe("first");
      // Not nested — the previous critical section has fully settled, so this is
      // a fresh acquire, not a re-entry.
      const second = await withProjectLock(dir, async () => "second");
      expect(second).toBe("second");
    });
  });
});

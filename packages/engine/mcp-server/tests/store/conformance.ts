import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ProjectStore } from "../../src/store/project-store.js";

// The behaviour every ProjectStore backend must share, written once so a second
// backend runs the same suite as the file backend rather than a parallel copy.
// Fixtures are handed in by the backend's own test: a fresh, empty project
// container per test and the identity the tools would pass as `projectPath`.

export interface StoreFixture {
  store: ProjectStore;
  /** An existing, empty project container. */
  projectPath: string;
  /** A path that names nothing. */
  missingPath: string;
  cleanup: () => Promise<void>;
}

export function runProjectStoreConformance(
  name: string,
  makeFixture: () => Promise<StoreFixture>,
): void {
  describe(`${name}: ProjectStore conformance`, () => {
    let f: StoreFixture;
    beforeEach(async () => {
      f = await makeFixture();
    });
    afterEach(async () => {
      await f.cleanup();
    });

    it("exists is false before a write and true after", async () => {
      expect(await f.store.exists(f.projectPath, "research.json")).toBe(false);
      await f.store.writeJson(f.projectPath, "research.json", { a: 1 });
      expect(await f.store.exists(f.projectPath, "research.json")).toBe(true);
    });

    it("writeJson stores pretty JSON that readText returns verbatim", async () => {
      await f.store.writeJson(f.projectPath, "research.json", { a: 1, b: [2, 3] });
      expect(await f.store.readText(f.projectPath, "research.json")).toBe(
        JSON.stringify({ a: 1, b: [2, 3] }, null, 2),
      );
    });

    it("writeJson creates missing parents and overwrites in place", async () => {
      await f.store.writeJson(f.projectPath, "results/log_007.json", { log_id: "log_007" });
      await f.store.writeJson(f.projectPath, "results/log_007.json", { log_id: "log_007", v: 2 });
      expect(JSON.parse(await f.store.readText(f.projectPath, "results/log_007.json"))).toEqual({
        log_id: "log_007",
        v: 2,
      });
    });

    it("readText throws for an absent ref", async () => {
      await expect(f.store.readText(f.projectPath, "nope.json")).rejects.toThrow();
    });

    it("writeJsonBoth writes every document", async () => {
      await f.store.writeJsonBoth(f.projectPath, [
        { ref: "tree.gedcomx.json", data: { tree: 1 } },
        { ref: "research.json", data: { research: 1 } },
      ]);
      expect(JSON.parse(await f.store.readText(f.projectPath, "tree.gedcomx.json"))).toEqual({ tree: 1 });
      expect(JSON.parse(await f.store.readText(f.projectPath, "research.json"))).toEqual({ research: 1 });
    });

    it("writeJsonBoth writes nothing when one document cannot be serialized", async () => {
      await f.store.writeJson(f.projectPath, "tree.gedcomx.json", { tree: "old" });
      const circular: any = {};
      circular.self = circular;
      await expect(
        f.store.writeJsonBoth(f.projectPath, [
          { ref: "tree.gedcomx.json", data: { tree: "new" } },
          { ref: "research.json", data: circular },
        ]),
      ).rejects.toThrow();
      expect(JSON.parse(await f.store.readText(f.projectPath, "tree.gedcomx.json"))).toEqual({ tree: "old" });
      expect(await f.store.exists(f.projectPath, "research.json")).toBe(false);
    });

    it("writeBytes stores a blob that exists and lists", async () => {
      await f.store.writeBytes(f.projectPath, "images/scan.jpg", new Uint8Array([0xff, 0xd8, 0xff]));
      expect(await f.store.exists(f.projectPath, "images/scan.jpg")).toBe(true);
      const names = (await f.store.list(f.projectPath, "images")).map((e) => e.name);
      expect(names).toEqual(["scan.jpg"]);
    });

    it("appendText creates the ref and appends in order", async () => {
      await f.store.appendText(f.projectPath, "results/match-scores.jsonl", "a\n");
      await f.store.appendText(f.projectPath, "results/match-scores.jsonl", "b\n");
      expect(await f.store.readText(f.projectPath, "results/match-scores.jsonl")).toBe("a\nb\n");
    });

    it("list is empty for an absent directory and carries a numeric mtime otherwise", async () => {
      expect(await f.store.list(f.projectPath, "results/.staging")).toEqual([]);
      const before = Date.now() - 1000;
      await f.store.writeJson(f.projectPath, "results/.staging/x.json", {});
      const entries = await f.store.list(f.projectPath, "results/.staging");
      expect(entries.map((e) => e.name)).toEqual(["x.json"]);
      expect(entries[0].mtimeMs).toBeGreaterThanOrEqual(before);
    });

    it("remove deletes a ref and tolerates an absent one", async () => {
      await f.store.writeJson(f.projectPath, "results/.staging/x.json", {});
      await f.store.remove(f.projectPath, "results/.staging/x.json");
      expect(await f.store.exists(f.projectPath, "results/.staging/x.json")).toBe(false);
      await expect(f.store.remove(f.projectPath, "results/.staging/x.json")).resolves.toBeUndefined();
    });

    it("rejects a ref that escapes the project on every ref-taking method", async () => {
      const escapes = ["../outside.json", "../../etc/passwd", "results/../../x"];
      for (const ref of escapes) {
        await expect(f.store.readText(f.projectPath, ref)).rejects.toThrow(/escapes the project/);
        await expect(f.store.writeJson(f.projectPath, ref, {})).rejects.toThrow(/escapes the project/);
        await expect(f.store.writeBytes(f.projectPath, ref, new Uint8Array())).rejects.toThrow(/escapes the project/);
        await expect(f.store.appendText(f.projectPath, ref, "x")).rejects.toThrow(/escapes the project/);
        await expect(f.store.exists(f.projectPath, ref)).resolves.toBe(false);
        await expect(f.store.list(f.projectPath, ref)).rejects.toThrow(/escapes the project/);
        await expect(f.store.remove(f.projectPath, ref)).rejects.toThrow(/escapes the project/);
      }
      await expect(
        f.store.writeJsonBoth(f.projectPath, [{ ref: "ok.json", data: {} }, { ref: "../no.json", data: {} }]),
      ).rejects.toThrow(/escapes the project/);
      expect(await f.store.exists(f.projectPath, "ok.json")).toBe(false);
    });

    it("classifyProject distinguishes a missing argument, a missing container, an empty one and a project", async () => {
      expect(await f.store.classifyProject(undefined)).toBe("missing_arg");
      expect(await f.store.classifyProject("")).toBe("missing_arg");
      expect(await f.store.classifyProject(f.missingPath)).toBe("missing_dir");
      expect(await f.store.classifyProject(f.projectPath)).toBe("no_project");
      await f.store.writeJson(f.projectPath, "research.json", {});
      expect(await f.store.classifyProject(f.projectPath)).toBe("project");
    });

    it("projectDirState reports the container", async () => {
      expect(await f.store.projectDirState(f.projectPath)).toBe("directory");
      expect(await f.store.projectDirState(f.missingPath)).toBe("missing");
    });

    it("withTransaction serializes bodies for one project in arrival order", async () => {
      const order: string[] = [];
      const first = f.store.withTransaction(f.projectPath, async () => {
        order.push("first:start");
        await new Promise((r) => setTimeout(r, 30));
        order.push("first:end");
        return 1;
      });
      const second = f.store.withTransaction(f.projectPath, async () => {
        order.push("second:start");
        return 2;
      });
      expect(await Promise.all([first, second])).toEqual([1, 2]);
      expect(order).toEqual(["first:start", "first:end", "second:start"]);
    });

    it("withTransaction releases the lock when the body throws", async () => {
      await expect(
        f.store.withTransaction(f.projectPath, async () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      expect(await f.store.withTransaction(f.projectPath, async () => "after")).toBe("after");
    });

    it("withTransaction rejects same-project re-entry instead of deadlocking", async () => {
      await expect(
        f.store.withTransaction(f.projectPath, async () =>
          f.store.withTransaction(f.projectPath, async () => "unreachable"),
        ),
      ).rejects.toThrow(/re-entered/);
    });
  });
}

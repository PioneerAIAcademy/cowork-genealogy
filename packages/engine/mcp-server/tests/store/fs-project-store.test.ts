import { describe, it, expect } from "vitest";
import { mkdir, mkdtemp, rm, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsProjectStore } from "../../src/store/fs-project-store.js";
import { getProjectStore, setProjectStore } from "../../src/store/project-store.js";
import { runProjectStoreConformance } from "./conformance.js";

runProjectStoreConformance("FsProjectStore", async () => {
  const root = await mkdtemp(join(tmpdir(), "fs-store-"));
  return {
    store: new FsProjectStore(),
    projectPath: root,
    missingPath: join(root, "does-not-exist"),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
});

describe("FsProjectStore specifics", () => {
  it("is the default store and can be swapped for the process", () => {
    setProjectStore(null);
    const first = getProjectStore();
    expect(first).toBeInstanceOf(FsProjectStore);
    expect(getProjectStore()).toBe(first);
    const custom = new FsProjectStore();
    setProjectStore(custom);
    expect(getProjectStore()).toBe(custom);
    setProjectStore(null);
    expect(getProjectStore()).not.toBe(custom);
  });

  it("projectDirState tells a file apart from a directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "fs-store-"));
    try {
      const file = join(root, "a-file");
      await writeFile(file, "x", "utf-8");
      expect(await new FsProjectStore().projectDirState(file)).toBe("not_directory");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writeJson leaves a dot-prefixed temp only mid-write and none after", async () => {
    const root = await mkdtemp(join(tmpdir(), "fs-store-"));
    try {
      const store = new FsProjectStore();
      let midWrite: string[] = [];
      await store.writeJsonBoth(
        root,
        [
          { ref: "tree.gedcomx.json", data: { tree: 1 } },
          { ref: "research.json", data: { research: 1 } },
        ],
        {
          onBeforeSecondRename: async () => {
            midWrite = (await readdir(root)).filter((f) => f.includes(".tmp-"));
          },
        },
      );
      expect(midWrite.length).toBe(1);
      expect(midWrite[0].startsWith(".research.json.tmp-")).toBe(true);
      expect((await readdir(root)).filter((f) => f.includes(".tmp-"))).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "readText refuses a symlink that leaves the project and follows one that stays",
    async () => {
      // assertInsideProject reasons about the ref string; a symlink placed in
      // the project resolves "inside" and readFile would follow it to any
      // host-readable file. readText re-checks on the real path.
      const root = await mkdtemp(join(tmpdir(), "fs-store-"));
      try {
        const project = join(root, "project");
        const outsideDir = join(root, "outside");
        await mkdir(join(project, "uploads"), { recursive: true });
        await mkdir(outsideDir);
        await writeFile(join(outsideDir, "secret.txt"), "outside", "utf-8");
        await writeFile(join(project, "uploads", "real.txt"), "inside", "utf-8");
        await symlink(join(outsideDir, "secret.txt"), join(project, "uploads", "link-file.txt"));
        await symlink(outsideDir, join(project, "uploads", "link-dir"));
        await symlink(join(project, "uploads", "real.txt"), join(project, "uploads", "alias.txt"));
        const store = new FsProjectStore();
        await expect(store.readText(project, "uploads/link-file.txt")).rejects.toThrow(
          /escapes the project/,
        );
        await expect(store.readText(project, "uploads/link-dir/secret.txt")).rejects.toThrow(
          /escapes the project/,
        );
        // The other direction: a symlink that stays inside still reads, and so
        // does a project reached through an alias of its own path.
        expect(await store.readText(project, "uploads/alias.txt")).toBe("inside");
        const projectAlias = join(root, "project-alias");
        await symlink(project, projectAlias);
        expect(await store.readText(projectAlias, "uploads/real.txt")).toBe("inside");
        // An absent ref still surfaces as ENOENT, so callers that classify by
        // code (sidecar_read → not_found) are unaffected.
        await expect(store.readText(project, "uploads/nope.txt")).rejects.toMatchObject({
          code: "ENOENT",
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it("locks one project under two spellings of its path", async () => {
    // Two callers can name one project through different symlinks (on macOS
    // /tmp itself is one). The lock key is the real path, so they serialize.
    const root = await mkdtemp(join(tmpdir(), "fs-store-"));
    try {
      const real = join(root, "project");
      const alias = join(root, "alias");
      await mkdir(real);
      await symlink(real, alias);
      const store = new FsProjectStore();
      const order: string[] = [];
      const a = store.withTransaction(real, async () => {
        order.push("real:start");
        await new Promise((r) => setTimeout(r, 30));
        order.push("real:end");
      });
      const b = store.withTransaction(alias, async () => {
        order.push("alias:start");
      });
      await Promise.all([a, b]);
      expect(order).toEqual(["real:start", "real:end", "alias:start"]);
      await expect(
        store.withTransaction(real, async () => store.withTransaction(alias, async () => "x")),
      ).rejects.toThrow(/re-entered/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

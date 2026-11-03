// The protected project files stay read-only on disk between store writes
// (issue #1499), so a shell write that bypasses the plugin hook is refused by
// the filesystem. Mode bits are POSIX here; the Windows rename order is pinned
// by fs-project-store-lock-order.test.ts, and was measured by
// dev/probe-readonly-project-files.ts.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFile, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsProjectStore, PROTECTED_FILES } from "../../src/store/fs-project-store.js";

const POSIX = process.platform !== "win32";
// Root ignores 0o444, so the refusal cases cannot be observed as root.
const AS_ROOT = process.getuid?.() === 0;

const mode = async (path: string) => (await stat(path)).mode & 0o777;

describe.runIf(POSIX)("FsProjectStore keeps the protected files read-only", () => {
  let dir: string;
  const store = new FsProjectStore();

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "readonly-store-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it.each([...PROTECTED_FILES])("writeJson leaves %s read-only, and writes it again", async (name) => {
    await store.writeJson(dir, name, { v: 1 });
    expect(await mode(join(dir, name))).toBe(0o444);
    await store.writeJson(dir, name, { v: 2 });
    expect(await mode(join(dir, name))).toBe(0o444);
    expect(JSON.parse(await store.readText(dir, name))).toEqual({ v: 2 });
  });

  it("writeJsonBoth locks both files, the second one too", async () => {
    await store.writeJsonBoth(dir, [
      { ref: "tree.gedcomx.json", data: { persons: [] } },
      { ref: "research.json", data: { v: 1 } },
    ]);
    expect(await mode(join(dir, "tree.gedcomx.json"))).toBe(0o444);
    expect(await mode(join(dir, "research.json"))).toBe(0o444);
  });

  it("a ./-spelled ref is the same protected file", async () => {
    await store.writeJson(dir, "./research.json", { v: 1 });
    expect(await mode(join(dir, "research.json"))).toBe(0o444);
  });

  it("leaves other files, and a nested research.json, writable", async () => {
    await store.writeJson(dir, "results/log_001.json", { v: 1 });
    await store.writeJson(dir, "sub/research.json", { v: 1 });
    await store.writeJson(dir, "notes.json", { v: 1 });
    for (const ref of ["results/log_001.json", "sub/research.json", "notes.json"]) {
      expect(await mode(join(dir, ref))).toBe(0o666 & ~process.umask());
    }
  });

  it.skipIf(AS_ROOT)("refuses the raw write and append a shell would make", async () => {
    await store.writeJson(dir, "research.json", { v: 1 });
    const path = join(dir, "research.json");
    await expect(writeFile(path, "{}")).rejects.toMatchObject({ code: "EACCES" });
    await expect(appendFile(path, "x")).rejects.toMatchObject({ code: "EACCES" });
    expect(JSON.parse(await store.readText(dir, "research.json"))).toEqual({ v: 1 });
  });

  it("remove deletes a locked file", async () => {
    await store.writeJson(dir, "research.json", { v: 1 });
    await store.remove(dir, "research.json");
    await expect(stat(join(dir, "research.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

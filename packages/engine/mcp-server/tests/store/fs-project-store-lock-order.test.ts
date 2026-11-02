// The order of the unlock, the rename and the re-lock (issue #1499). On POSIX a
// rename ignores the target's mode, so a missing or late unlock passes every
// behavioural test on Linux CI and breaks every write on Windows, which refuses
// to rename over a read-only file. This pins the order on any platform by
// recording the calls.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const events: string[] = [];
const failRename = { once: false };

vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  const name = (p: unknown) => String(p).split(/[\\/]/).pop()!;
  return {
    ...real,
    chmod: async (p: Parameters<typeof real.chmod>[0], m: Parameters<typeof real.chmod>[1]) => {
      events.push(`chmod ${name(p)} ${Number(m).toString(8)}`);
      return real.chmod(p, m);
    },
    rename: async (from: Parameters<typeof real.rename>[0], to: Parameters<typeof real.rename>[1]) => {
      events.push(`rename ${name(to)}`);
      if (failRename.once) {
        failRename.once = false;
        throw Object.assign(new Error("EPERM: injected"), { code: "EPERM" });
      }
      return real.rename(from, to);
    },
    unlink: async (p: Parameters<typeof real.unlink>[0]) => {
      if (!name(p).startsWith(".")) events.push(`unlink ${name(p)}`);
      return real.unlink(p);
    },
  };
});

const { FsProjectStore } = await import("../../src/store/fs-project-store.js");

describe("FsProjectStore unlocks before the rename and re-locks after it", () => {
  let dir: string;
  const store = new FsProjectStore();

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "lock-order-"));
    events.length = 0;
    failRename.once = false;
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writeJson", async () => {
    await store.writeJson(dir, "research.json", { v: 1 });
    expect(events).toEqual(["chmod research.json 644", "rename research.json", "chmod research.json 444"]);
  });

  it("writeJsonBoth, for each target in commit order", async () => {
    await store.writeJsonBoth(dir, [
      { ref: "tree.gedcomx.json", data: {} },
      { ref: "research.json", data: {} },
    ]);
    expect(events).toEqual([
      "chmod tree.gedcomx.json 644", "rename tree.gedcomx.json", "chmod tree.gedcomx.json 444",
      "chmod research.json 644", "rename research.json", "chmod research.json 444",
    ]);
  });

  it("re-locks when the rename fails, and reports the rename's error", async () => {
    await store.writeJson(dir, "research.json", { v: 1 });
    events.length = 0;
    failRename.once = true;
    await expect(store.writeJson(dir, "research.json", { v: 2 })).rejects.toThrow("EPERM: injected");
    expect(events).toEqual(["chmod research.json 644", "rename research.json", "chmod research.json 444"]);
  });

  it("writeJsonBoth re-locks the target whose rename failed", async () => {
    failRename.once = true;
    await expect(
      store.writeJsonBoth(dir, [{ ref: "research.json", data: {} }]),
    ).rejects.toThrow("EPERM: injected");
    expect(events).toEqual(["chmod research.json 644", "rename research.json", "chmod research.json 444"]);
  });

  it("remove unlocks before it unlinks", async () => {
    await store.writeJson(dir, "research.json", { v: 1 });
    events.length = 0;
    await store.remove(dir, "research.json");
    expect(events).toEqual(["chmod research.json 644", "unlink research.json"]);
  });

  it("an unprotected file is never chmodded", async () => {
    await store.writeJson(dir, "results/log_001.json", { v: 1 });
    await store.remove(dir, "results/log_001.json");
    expect(events).toEqual(["rename log_001.json", "unlink log_001.json"]);
  });
});

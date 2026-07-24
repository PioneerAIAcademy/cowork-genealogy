import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  mkdir,
  utimes,
  stat,
} from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  saveSourceImage,
  gcUnreferencedImages,
  imageFilenameFor,
} from "../../src/utils/image-store.js";

const dirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "imgstore-"));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

describe("imageFilenameFor", () => {
  it("keeps an imageId as-is", () => {
    expect(imageFilenameFor("004884748_02613")).toBe("004884748_02613.jpg");
  });
  it("sanitizes an ARK label to a safe filename", () => {
    expect(imageFilenameFor("ark:/61903/3:1:3Q9M-CSNL")).toBe(
      "ark_61903_3_1_3Q9M-CSNL.jpg",
    );
  });
});

describe("saveSourceImage", () => {
  it("writes images/<key>.jpg and returns the project-relative ref", async () => {
    const dir = await tmp();
    const ref = await saveSourceImage({
      projectPath: dir,
      imageKey: "004884748_02613",
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(ref).toBe("images/004884748_02613.jpg");
    const saved = await readFile(join(dir, "images", "004884748_02613.jpg"));
    expect(saved.length).toBe(3);
  });

  it("throws when projectPath does not exist", async () => {
    await expect(
      saveSourceImage({
        projectPath: join(tmpdir(), "nope-does-not-exist-xyz-123"),
        imageKey: "x",
        bytes: new Uint8Array([1]),
      }),
    ).rejects.toThrow(/does not exist/);
  });
});

describe("gcUnreferencedImages", () => {
  async function makeImage(dir: string, name: string, ageMs: number) {
    await mkdir(join(dir, "images"), { recursive: true });
    const p = join(dir, "images", name);
    await writeFile(p, Buffer.from([0]));
    const when = (Date.now() - ageMs) / 1000;
    await utimes(p, when, when);
  }

  it("removes an unreferenced image older than the TTL", async () => {
    const dir = await tmp();
    await makeImage(dir, "old.jpg", 25 * 60 * 60 * 1000); // > 24h
    await gcUnreferencedImages(dir, new Set());
    await expect(stat(join(dir, "images", "old.jpg"))).rejects.toThrow();
  });

  it("keeps a referenced image even when old", async () => {
    const dir = await tmp();
    await makeImage(dir, "cited.jpg", 25 * 60 * 60 * 1000);
    await gcUnreferencedImages(dir, new Set(["images/cited.jpg"]));
    expect((await stat(join(dir, "images", "cited.jpg"))).isFile()).toBe(true);
  });

  it("keeps a recent unreferenced image (TTL not elapsed)", async () => {
    const dir = await tmp();
    await makeImage(dir, "fresh.jpg", 60 * 1000); // 1 min old
    await gcUnreferencedImages(dir, new Set());
    expect((await stat(join(dir, "images", "fresh.jpg"))).isFile()).toBe(true);
  });

  it("is a no-op when there is no images/ dir", async () => {
    const dir = await tmp();
    await gcUnreferencedImages(dir, new Set()); // must not throw
  });
});

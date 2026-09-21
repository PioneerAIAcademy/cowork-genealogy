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
  recordImageReadCap,
  wasSourceImageTruncated,
  sourceImageCapState,
  __clearTruncatedSourceImagesForTests,
} from "../../src/utils/image-store.js";
import { runWithProjectStore, type ProjectStore } from "../../src/store/project-store.js";

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

  it("keeps an image cited with a non-canonical ref — `./images/x.jpg` protects `images/x.jpg` (#2457 r4 note 6)", async () => {
    // The cap join normalizes a relayed image_filename; the GC must canonicalize
    // the referenced set the same way, or a source citing `./images/cited.jpg`
    // (or a backslash spelling) leaves the real file unprotected and it is swept.
    const dir = await tmp();
    await makeImage(dir, "cited.jpg", 25 * 60 * 60 * 1000);
    await gcUnreferencedImages(dir, new Set(["./images/cited.jpg"]));
    expect((await stat(join(dir, "images", "cited.jpg"))).isFile()).toBe(true);
  });

  it("keeps an image cited with a doubled or interior separator — `images//x.jpg`, `images/./x.jpg` (#2457 r9 note)", async () => {
    // normalizeImageRef folds via posix.normalize, so an LLM-relayed ref with a
    // doubled `//` or interior `/./` still canonicalizes to `images/cited.jpg` and
    // protects the file. Without the full fold the GC would delete a cited scan.
    const dir = await tmp();
    await makeImage(dir, "cited.jpg", 25 * 60 * 60 * 1000);
    await gcUnreferencedImages(dir, new Set(["images//cited.jpg", "images/./other.jpg"]));
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

describe("truncated-source-image cache (#2457)", () => {
  afterEach(() => __clearTruncatedSourceImagesForTests());

  it("records a capped read so a source citing that image_filename reads truncated", () => {
    recordImageReadCap("/proj", "images/004884748_02613.jpg", true);
    expect(wasSourceImageTruncated("/proj", "images/004884748_02613.jpg")).toBe(true);
  });

  it("reports false for an image never recorded", () => {
    expect(wasSourceImageTruncated("/proj", "images/never-seen.jpg")).toBe(false);
  });

  it("is sticky-true: a later clean read does NOT retract a recorded cap (#2457 B1 ruling 2026-09-19)", () => {
    // The cap bounds output tokens and the prompt varies with lookingFor, so a
    // narrower second read of the same image can come back uncapped. That false
    // must NOT overwrite the true, or read 1's partial text gets stamped whole.
    recordImageReadCap("/proj", "images/x.jpg", true);
    expect(wasSourceImageTruncated("/proj", "images/x.jpg")).toBe(true);
    recordImageReadCap("/proj", "images/x.jpg", false); // narrower, uncapped re-read
    expect(wasSourceImageTruncated("/proj", "images/x.jpg")).toBe(true); // sticky — still partial
    expect(sourceImageCapState("/proj", "images/x.jpg")).toBe(true);
  });

  it("records false only when no true stands for that key (partial=true, whole=false, unseen=undefined)", () => {
    // The store is still tri-state in memory; sticky-true only blocks true → false
    // for one key. A key whose first read is whole records false.
    expect(sourceImageCapState("/proj", "images/never.jpg")).toBeUndefined();
    recordImageReadCap("/proj", "images/partial.jpg", true);
    expect(sourceImageCapState("/proj", "images/partial.jpg")).toBe(true);
    recordImageReadCap("/proj", "images/whole.jpg", false);
    expect(sourceImageCapState("/proj", "images/whole.jpg")).toBe(false); // no prior true → records false
  });

  it("is keyed by project — one project's cap does not leak into another", () => {
    recordImageReadCap("/proj-a", "images/shared.jpg", true);
    expect(wasSourceImageTruncated("/proj-a", "images/shared.jpg")).toBe(true);
    expect(wasSourceImageTruncated("/proj-b", "images/shared.jpg")).toBe(false);
  });

  it("an ARK read is joinable too — its imageRef is what a source cites", () => {
    // saveSourceImage sanitizes an ARK label to this ref; the cache keys on the
    // same string, so an ARK read is NOT a join blind spot (only a no-persist
    // read is). Mirrors imageFilenameFor("ark:/61903/3:1:3Q9M-CSNL").
    const ref = `images/${imageFilenameFor("ark:/61903/3:1:3Q9M-CSNL")}`;
    recordImageReadCap("/proj", ref, true);
    expect(wasSourceImageTruncated("/proj", ref)).toBe(true);
  });

  it("joins across a trailing separator on projectPath — record `/p/`, query `/p` (#2457 review, blocker 4a)", () => {
    // projectPath arrives raw from an LLM relay, so record and query can spell
    // the same project with and without a trailing slash. The key must normalize
    // both or a capped read reads back clean.
    recordImageReadCap("/proj/", "images/x.jpg", true);
    expect(wasSourceImageTruncated("/proj", "images/x.jpg")).toBe(true);
    // …and the other direction.
    __clearTruncatedSourceImagesForTests();
    recordImageReadCap("/proj", "images/x.jpg", true);
    expect(wasSourceImageTruncated("/proj/", "images/x.jpg")).toBe(true);
  });

  it("joins across image_filename spelling variants — `./images/x.jpg` and backslashes (#2457 review r3, note 8)", () => {
    // The read side joins on a source's image_filename, relayed by the agent, so it
    // can carry a leading `./` or backslash separators the module-minted write-side
    // ref never has. Without normalizing both, a capped read reads back clean.
    recordImageReadCap("/proj", "images/x.jpg", true);
    expect(wasSourceImageTruncated("/proj", "./images/x.jpg")).toBe(true);
    expect(wasSourceImageTruncated("/proj", "images\\x.jpg")).toBe(true);
    // …and the other direction: recorded with a variant, queried canonically.
    __clearTruncatedSourceImagesForTests();
    recordImageReadCap("/proj", "./images/y.jpg", true);
    expect(wasSourceImageTruncated("/proj", "images/y.jpg")).toBe(true);
  });

  it("isolates patrons under a shared-process store binding — same anchor path, different projectId, no collision (#2457 r8 B2)", async () => {
    // Under http.ts every request presents the SAME anchor projectPath (`/project`);
    // the bound store's projectId is the real identity. Keying the cap on projectId
    // (not the anchor) keeps patron A's cap out of patron B's read, while still
    // joining A's own record→read (same projectId across A's turns).
    const store = (projectId: string) => ({ projectId }) as unknown as ProjectStore;
    await runWithProjectStore(store("proj-A"), async () => {
      recordImageReadCap("/project", "images/x.jpg", true);
      expect(wasSourceImageTruncated("/project", "images/x.jpg")).toBe(true);
    });
    // Patron B: identical anchor path and image, must NOT see A's cap.
    await runWithProjectStore(store("proj-B"), async () => {
      expect(wasSourceImageTruncated("/project", "images/x.jpg")).toBe(false);
    });
    // A still sees its own (record→read join survives across A's turns).
    await runWithProjectStore(store("proj-A"), async () => {
      expect(wasSourceImageTruncated("/project", "images/x.jpg")).toBe(true);
    });
  });

  it("joins across a Windows projectPath spelled with backslashes vs forward slashes (#2457 review r5)", () => {
    // The genealogist team is on Windows: a record under `C:\Users\proj` and a
    // query under `C:/Users/proj` must join, or the truncation marker is silently
    // lost. projectPath must normalize separators the same way imageRef does.
    recordImageReadCap("C:\\Users\\proj", "images/x.jpg", true);
    expect(wasSourceImageTruncated("C:/Users/proj", "images/x.jpg")).toBe(true);
    __clearTruncatedSourceImagesForTests();
    recordImageReadCap("C:/Users/proj/", "images/x.jpg", true);
    expect(wasSourceImageTruncated("C:\\Users\\proj", "images/x.jpg")).toBe(true);
  });
});

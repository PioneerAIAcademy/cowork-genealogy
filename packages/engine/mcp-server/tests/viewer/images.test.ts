import { mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IMAGE_TOKEN_TTL_MS, imageTokens } from "../../viewer/tokens.js";
import { PUBLIC_URL, realFoldersOnly, startViewer, tempFolders, writeProject, type RunningViewer } from "./harness.js";

realFoldersOnly();
const { base, root } = tempFolders();

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

function writeImage(project: string, name = "page.jpg", bytes: Uint8Array = JPEG): void {
  mkdirSync(join(project, "images"), { recursive: true });
  writeFileSync(join(project, "images", name), bytes);
}

/** A link from the tool, as a path on the test's own port. */
async function signedPath(viewer: RunningViewer, args: Record<string, unknown> = {}): Promise<string> {
  const { structuredContent } = await viewer.call("read_project_view", { part: "image", id: "images/page.jpg", ...args });
  return structuredContent.url.slice(PUBLIC_URL.length);
}

const get = (viewer: RunningViewer, path: string) => fetch(`${viewer.origin}${path}`);

async function expectSame404(response: Response): Promise<void> {
  expect(response.status).toBe(404);
  expect(await response.text()).toBe("Not found");
}

describe("a valid link", () => {
  it("serves the image with the headers a card's frame needs", async () => {
    writeProject(root());
    writeImage(root());
    const viewer = await startViewer(root());
    const response = await get(viewer, await signedPath(viewer));
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(JPEG);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
  });

  it("is not cached past the token", async () => {
    writeProject(root());
    writeImage(root());
    let time = 1_000_000;
    const viewer = await startViewer(root(), { now: () => time });
    const path = await signedPath(viewer);
    time += IMAGE_TOKEN_TTL_MS - 90_000;
    const cacheControl = (await get(viewer, path)).headers.get("cache-control");
    expect(cacheControl).toBe("private, max-age=90");
  });

  it("works for a project in a folder under the root, and never holds the secret", async () => {
    const project = writeProject(join(root(), "proj"));
    writeImage(project);
    const viewer = await startViewer(root());
    const path = await signedPath(viewer, { projectPath: "proj" });
    expect(path).toMatch(/^\/img\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect((await get(viewer, path)).status).toBe(200);
  });

  it("answers only GET", async () => {
    writeProject(root());
    writeImage(root());
    const viewer = await startViewer(root());
    const response = await fetch(`${viewer.origin}${await signedPath(viewer)}`, { method: "POST" });
    await expectSame404(response);
  });
});

describe("every bad link is the same 404", () => {
  it("expired, at the instant it expires and after", async () => {
    writeProject(root());
    writeImage(root());
    let time = 1_000_000;
    const viewer = await startViewer(root(), { now: () => time });
    const path = await signedPath(viewer);
    time += IMAGE_TOKEN_TTL_MS - 1;
    expect((await get(viewer, path)).status).toBe(200);
    time += 1;
    await expectSame404(await get(viewer, path));
    time += 1_000;
    await expectSame404(await get(viewer, path));
  });

  it("tampered: a changed signature or payload, or either missing", async () => {
    writeProject(root());
    writeImage(root());
    const viewer = await startViewer(root());
    const path = await signedPath(viewer);
    expect((await get(viewer, path)).status).toBe(200);
    const [payload, signature] = path.slice("/img/".length).split(".");
    const flip = (s: string) => (s.endsWith("A") ? `${s.slice(0, -1)}B` : `${s.slice(0, -1)}A`);
    const longer = Buffer.from(JSON.stringify({ rel: "", ref: "images/page.jpg", expiresAt: Date.now() + 1e9 }));
    for (const token of [
      `${payload}.${flip(signature)}`,
      `${flip(payload)}.${signature}`,
      `${longer.toString("base64url")}.${signature}`,
      `${payload}.`,
      `.${signature}`,
      payload,
      `${payload}.${signature}.x`,
      `${payload}.${signature}/x`,
    ]) {
      await expectSame404(await get(viewer, `/img/${token}`));
    }
  });

  it("signed with another key", async () => {
    writeProject(root());
    writeImage(root());
    const viewer = await startViewer(root());
    const { token } = imageTokens(randomBytes(32), Date.now).sign("", "images/page.jpg");
    await expectSame404(await get(viewer, `/img/${token}`));
  });

  it("signed for another project: the same ref in a project that does not hold it", async () => {
    writeProject(join(root(), "signed-for"));
    const other = writeProject(join(root(), "other"));
    writeImage(other);
    const viewer = await startViewer(root());
    await expectSame404(await get(viewer, await signedPath(viewer, { projectPath: "signed-for" })));
    expect((await get(viewer, await signedPath(viewer, { projectPath: "other" }))).status).toBe(200);
  });

  it("signed for another project: its signature on this project's claim", async () => {
    const mine = writeProject(join(root(), "mine"));
    const theirs = writeProject(join(root(), "theirs"));
    writeImage(mine);
    writeImage(theirs);
    const viewer = await startViewer(root());
    const [minePayload] = (await signedPath(viewer, { projectPath: "mine" })).slice("/img/".length).split(".");
    const [, theirSignature] = (await signedPath(viewer, { projectPath: "theirs" })).slice("/img/".length).split(".");
    await expectSame404(await get(viewer, `/img/${minePayload}.${theirSignature}`));
  });

  it("a project folder that became an escaping symlink after signing", async () => {
    const project = writeProject(join(root(), "proj"));
    writeImage(project);
    const outside = join(base(), "outside");
    const viewer = await startViewer(root());
    const path = await signedPath(viewer, { projectPath: "proj" });
    expect((await get(viewer, path)).status).toBe(200);
    renameSync(project, outside);
    symlinkSync(outside, project);
    await expectSame404(await get(viewer, path));
  });

  it("a project folder that now resolves somewhere else inside the root", async () => {
    const project = writeProject(join(root(), "proj"));
    writeImage(project);
    const other = writeProject(join(root(), "other"));
    writeImage(other);
    const viewer = await startViewer(root());
    const path = await signedPath(viewer, { projectPath: "proj" });
    rmSync(project, { recursive: true });
    symlinkSync(other, project);
    await expectSame404(await get(viewer, path));
  });

  it("a missing file", async () => {
    writeProject(root());
    const viewer = await startViewer(root());
    await expectSame404(await get(viewer, await signedPath(viewer)));
  });

  it("an image that is a symlink out of the project", async () => {
    writeProject(root());
    mkdirSync(join(root(), "images"));
    const outside = join(base(), "secret.jpg");
    writeFileSync(outside, JPEG);
    symlinkSync(outside, join(root(), "images", "page.jpg"));
    const viewer = await startViewer(root());
    await expectSame404(await get(viewer, await signedPath(viewer)));
  });

  it("a folder where the image should be", async () => {
    writeProject(root());
    mkdirSync(join(root(), "images", "page.jpg"), { recursive: true });
    const viewer = await startViewer(root());
    await expectSame404(await get(viewer, await signedPath(viewer)));
  });
});

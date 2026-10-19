import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

/**
 * README download links ↔ the release workflows.
 *
 * `.github/workflows/cowork-release.yml` (MCP server, plugin) and
 * `.github/workflows/electron-release.yml` (Research Viewer) each upload their
 * `ASSETS` to the release tagged `TAG`, and README.md's Install section links
 * straight to `releases/download/<TAG>/<file>`. Renaming the tag or a file on
 * one side only leaves every new user's first click on a 404, with the
 * workflow still green.
 */

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, "..", "..", "..", "..", "..");

type ReleaseWorkflow = {
  env: { TAG: string; ASSETS: string };
  jobs: { build?: { strategy: { matrix: { include: { asset: string }[] } } } };
};
const readWorkflow = (name: string) =>
  parse(readFileSync(join(projectRoot, ".github/workflows", name), "utf8")) as ReleaseWorkflow;
const assetsOf = (w: ReleaseWorkflow) =>
  w.env.ASSETS.split(/\s+/).filter(Boolean).map((p) => basename(p));

const cowork = readWorkflow("cowork-release.yml");
const viewer = readWorkflow("electron-release.yml");
const readme = readFileSync(join(projectRoot, "README.md"), "utf8");
const builder = parse(
  readFileSync(join(projectRoot, "apps/electron/electron-builder.yml"), "utf8"),
) as { dmg: { artifactName: string }; nsis: { artifactName: string } };

const DOWNLOAD_RE =
  /https:\/\/github\.com\/PioneerAIAcademy\/cowork-genealogy\/releases\/download\/([^/\s)]+)\/([^/\s)]+)/gi;

describe("README download links", () => {
  const links = [...readme.matchAll(DOWNLOAD_RE)].map((m) => ({ tag: m[1], file: m[2] }));
  const published = [...assetsOf(cowork), ...assetsOf(viewer)];

  it("the workflows publish the install files to one release", () => {
    expect(cowork.env.TAG).toBeTruthy();
    expect(viewer.env.TAG).toBe(cowork.env.TAG);
    expect(assetsOf(cowork).sort()).toEqual(["genealogy-mcp.mcpb", "genealogy-plugin.zip"]);
    expect(assetsOf(viewer).sort()).toEqual([
      "research-viewer-mac.dmg",
      "research-viewer-windows-setup.exe",
    ]);
  });

  // A mismatch here only shows as a missing-file warning on the PR build, then
  // a red publish on main that leaves the viewer download stale.
  it("electron-builder and the build matrix name the viewer installers ASSETS names", () => {
    const built = [
      builder.dmg.artifactName.replace("${ext}", "dmg"),
      builder.nsis.artifactName.replace("${ext}", "exe"),
    ];
    const uploaded = viewer.jobs.build!.strategy.matrix.include.map((i) => i.asset);
    expect(built.sort()).toEqual(assetsOf(viewer).sort());
    expect(uploaded.sort()).toEqual(assetsOf(viewer).sort());
  });

  it("name the tag the workflows publish to", () => {
    expect(links.length, "README has no release download links").toBeGreaterThan(0);
    for (const link of links) {
      expect(link.tag, `README links ${link.file} under a tag the workflows do not publish`).toBe(
        cowork.env.TAG,
      );
    }
  });

  it("link every file the workflows publish, and nothing else", () => {
    expect([...new Set(links.map((l) => l.file))].sort()).toEqual([...published].sort());
  });
});

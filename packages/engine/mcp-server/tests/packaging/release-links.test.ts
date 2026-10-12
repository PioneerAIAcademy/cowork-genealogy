import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

/**
 * README download links ↔ the release workflow.
 *
 * `.github/workflows/cowork-release.yml` uploads its `ASSETS` to the release
 * tagged `TAG`, and README.md's Install section links straight to
 * `releases/download/<TAG>/<file>`. Renaming the tag or a file on one side only
 * leaves every new user's first click on a 404, with the workflow still green.
 */

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, "..", "..", "..", "..", "..");

const workflow = parse(
  readFileSync(join(projectRoot, ".github/workflows/cowork-release.yml"), "utf8"),
) as { env: { TAG: string; ASSETS: string } };
const readme = readFileSync(join(projectRoot, "README.md"), "utf8");

const DOWNLOAD_RE =
  /https:\/\/github\.com\/PioneerAIAcademy\/cowork-genealogy\/releases\/download\/([^/\s)]+)\/([^/\s)]+)/gi;

describe("README download links", () => {
  const links = [...readme.matchAll(DOWNLOAD_RE)].map((m) => ({ tag: m[1], file: m[2] }));
  const published = workflow.env.ASSETS.split(/\s+/).filter(Boolean).map((p) => basename(p));

  it("the workflow publishes the two install files", () => {
    expect(workflow.env.TAG).toBeTruthy();
    expect(published.sort()).toEqual(["genealogy-mcp.mcpb", "genealogy-plugin.zip"]);
  });

  it("name the tag the workflow publishes to", () => {
    expect(links.length, "README has no release download links").toBeGreaterThan(0);
    for (const link of links) {
      expect(link.tag, `README links ${link.file} under a tag the workflow does not publish`).toBe(
        workflow.env.TAG,
      );
    }
  });

  it("link every file the workflow publishes, and nothing else", () => {
    expect([...new Set(links.map((l) => l.file))].sort()).toEqual([...published].sort());
  });
});

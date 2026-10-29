import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");
const packager = join(repoRoot, "scripts", "package-plugin.mjs");
const temp = mkdtempSync(join(tmpdir(), "plugin-connector-build-"));
const out = join(temp, "marketplace");
const version = "7.8.9";
const marketplace = "test-genealogy";
const sourcePlugin = JSON.parse(
  readFileSync(join(repoRoot, "packages", "engine", "plugin", ".claude-plugin", "plugin.json"), "utf8"),
);

function build(args: string[]) {
  return spawnSync(process.execPath, [packager, ...args], { cwd: temp, encoding: "utf8" });
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [entry.name],
  );
}

beforeAll(() => {
  const result = build(["--connector", "--version", version, "--marketplace", marketplace, "--out", out]);
  if (result.status !== 0) throw new Error(`connector build failed:\n${result.stderr}`);
});

afterAll(() => {
  rmSync(temp, { recursive: true, force: true });
});

describe("connector plugin build", () => {
  it("writes the marketplace with one relative plugin source and the supplied version", () => {
    const manifest = JSON.parse(readFileSync(join(out, ".claude-plugin", "marketplace.json"), "utf8"));
    expect(manifest.name).toBe(marketplace);
    expect(manifest.description).toBe(sourcePlugin.description);
    expect(manifest.owner).toEqual(sourcePlugin.author);
    expect(manifest.plugins).toEqual([{
      name: "genealogy-research",
      source: "./plugins/genealogy-research",
      description: sourcePlugin.description,
      version,
    }]);
  });

  it("ships the supplied version verbatim and both hook files in the built plugin", () => {
    const pluginRoot = join(out, "plugins", "genealogy-research");
    const plugin = JSON.parse(readFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"));
    expect(plugin.version).toBe(version);
    expect(existsSync(join(pluginRoot, "hooks", "hooks.json"))).toBe(true);
    expect(existsSync(join(pluginRoot, "hooks", "guard_project_files.py"))).toBe(true);
  });

  it("writes only the connector zip beside the layout and no MCP configuration", () => {
    const zip = readFileSync(join(temp, "genealogy-plugin-connector.zip"));
    expect(zip.length).toBeGreaterThan(4);
    expect(zip.subarray(0, 4)).toEqual(Buffer.from("PK\x03\x04"));
    const files = filesUnder(temp);
    expect(files).not.toContain(".mcp.json");
    expect(files).not.toContain("genealogy-plugin.zip");
  });

  it("removes stale files when rebuilding the same marketplace", () => {
    const stale = join(out, "plugins", "genealogy-research", "stale.txt");
    writeFileSync(stale, "stale");
    expect(build(["--connector", "--version", version, "--marketplace", marketplace, "--out", out]).status).toBe(0);
    expect(existsSync(stale)).toBe(false);
  });

  // The reason in stderr is what tells a refusal from a crash: both exit non-zero.
  it.each([
    ["short version", ["--version", "0.1", "--marketplace", marketplace], /--version x\.y\.z/],
    ["stamped version", ["--version", "0.1.0+x", "--marketplace", marketplace], /--version x\.y\.z/],
    ["missing version", ["--marketplace", marketplace], /--version x\.y\.z/],
    ["missing marketplace", ["--version", version], /--marketplace name/],
  ])("refuses %s before creating output", (_label, args, reason) => {
    const invalid = join(temp, "invalid");
    const result = build(["--connector", ...args, "--out", invalid]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(reason);
    expect(existsSync(invalid)).toBe(false);
  });

  it("preserves a non-empty output directory without a marketplace manifest", () => {
    const existing = join(temp, "existing");
    mkdirSync(existing);
    const keep = join(existing, "keep.txt");
    writeFileSync(keep, "keep");
    const result = build(["--connector", "--version", version, "--marketplace", marketplace, "--out", existing]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/refusing to delete it/);
    expect(readFileSync(keep, "utf8")).toBe("keep");
  });
});

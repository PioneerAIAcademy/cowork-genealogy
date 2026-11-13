import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");
const packager = join(repoRoot, "scripts", "package-plugin.mjs");
const pluginSource = join(repoRoot, "packages", "engine", "plugin");
const temp = mkdtempSync(join(tmpdir(), "plugin-connector-build-"));
const out = join(temp, "marketplace");
const version = "7.8.9";
const marketplace = "test-genealogy";
const serverUrl = "https://tools.example.test/mcp";
const sourcePlugin = JSON.parse(readFileSync(join(pluginSource, ".claude-plugin", "plugin.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(repoRoot, "packages", "engine", "mcp-server", "manifest.json"), "utf8"));
/** Every argument of a good connector build but `--out`. */
const good = ["--version", version, "--marketplace", marketplace, "--server-url", serverUrl];

function build(args: string[]) {
  return spawnSync(process.execPath, [packager, ...args], { cwd: temp, encoding: "utf8" });
}

/** Every file under `dir`, as a path relative to it. */
function filesUnder(dir: string, root: string = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(dir, entry.name), root) : [relative(root, join(dir, entry.name))],
  );
}

/** The entries of a zip the packager wrote (deflate, no data descriptors), by name. */
function zipEntries(zip: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const compressed = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const start = offset + 30 + nameLength + zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    entries.set(name, inflateRawSync(zip.subarray(start, start + compressed)));
    offset = start + compressed;
  }
  return entries;
}

beforeAll(() => {
  const result = build(["--connector", ...good, "--out", out]);
  if (result.status !== 0) throw new Error(`connector build failed:\n${result.stderr}`);
});

afterAll(() => {
  rmSync(temp, { recursive: true, force: true });
});

describe("connector plugin build", () => {
  it("writes the marketplace with one relative plugin source and the supplied version", () => {
    const marketplaceJson = JSON.parse(readFileSync(join(out, ".claude-plugin", "marketplace.json"), "utf8"));
    expect(marketplaceJson.name).toBe(marketplace);
    expect(marketplaceJson.description).toBe(sourcePlugin.description);
    expect(marketplaceJson.owner).toEqual(sourcePlugin.author);
    expect(marketplaceJson.plugins).toEqual([{
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

  it("is one install: the plugin's .mcp.json names the tool server, under the name the agents list", () => {
    // The shape Claude connected from in the live test (issue #3529, item 14).
    // The name is what Claude builds each tool's name from, so it must be the
    // manifest's display_name, the field every agent's `tools:` spelling derives
    // from; under any other name an agent spawns with no tools.
    expect(manifest.display_name).toBe("Genealogy Research");
    const expected = { mcpServers: { [manifest.display_name]: { type: "http", url: serverUrl } } };
    const pluginRoot = join(out, "plugins", "genealogy-research");
    expect(JSON.parse(readFileSync(join(pluginRoot, ".mcp.json"), "utf8"))).toEqual(expected);
    // Exactly one, at the plugin's root, where Claude looks for it.
    expect(filesUnder(out).filter((f) => f.endsWith(".mcp.json"))).toEqual([
      join("plugins", "genealogy-research", ".mcp.json"),
    ]);
  });

  it("writes only the connector zip beside the layout, holding the same files as the layout", () => {
    const zip = readFileSync(join(temp, "genealogy-plugin-connector.zip"));
    expect(zip.subarray(0, 4)).toEqual(Buffer.from("PK\x03\x04"));
    expect(filesUnder(temp).filter((f) => f.endsWith(".zip"))).toEqual(["genealogy-plugin-connector.zip"]);
    const zipped = zipEntries(zip);
    const pluginRoot = join(out, "plugins", "genealogy-research");
    const laidOut = filesUnder(pluginRoot).map((f) => f.split("\\").join("/")).sort();
    expect([...zipped.keys()].sort()).toEqual(laidOut);
    // The zip a user installs by hand carries the connector too, byte for byte.
    expect(zipped.get(".mcp.json")).toEqual(readFileSync(join(pluginRoot, ".mcp.json")));
    expect(JSON.parse(zipped.get(".claude-plugin/plugin.json")!.toString("utf8")).version).toBe(version);
  });

  it("the plugin's own tree carries no .mcp.json, so the Cowork zip and the harnesses get none", () => {
    // The Cowork build zips this tree and the harnesses and the hosted plane load
    // it as it is; there the tool server is registered by someone else, and a
    // second registration under another name would leave every agent toolless.
    expect(filesUnder(pluginSource).filter((f) => f.endsWith(".mcp.json"))).toEqual([]);
  });

  it("removes stale files when rebuilding the same marketplace", () => {
    const stale = join(out, "plugins", "genealogy-research", "stale.txt");
    writeFileSync(stale, "stale");
    expect(build(["--connector", ...good, "--out", out]).status).toBe(0);
    expect(existsSync(stale)).toBe(false);
  });

  // The reason in stderr is what tells a refusal from a crash: both exit non-zero.
  it.each([
    ["short version", ["--version", "0.1", "--marketplace", marketplace, "--server-url", serverUrl], /--version x\.y\.z/],
    ["stamped version", ["--version", "0.1.0+x", "--marketplace", marketplace, "--server-url", serverUrl], /--version x\.y\.z/],
    ["missing version", ["--marketplace", marketplace, "--server-url", serverUrl], /--version x\.y\.z/],
    ["missing marketplace", ["--version", version, "--server-url", serverUrl], /--marketplace name/],
    ["missing server URL", ["--version", version, "--marketplace", marketplace], /--server-url https/],
  ])("refuses %s before creating output", (label, args, reason) => {
    // A folder of its own per case: with one shared folder, a case that wrongly
    // built would make every later case fail its "no output" check too.
    const invalid = join(temp, `invalid-${label.replace(/\W+/g, "-")}`);
    const result = build(["--connector", ...args, "--out", invalid]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(reason);
    expect(existsSync(invalid)).toBe(false);
  });

  // A wrong URL ships in every install and fails only at sign-in, so only the
  // exact public spelling is taken.
  it.each([
    ["an empty value", ""],
    ["plain http", "http://tools.example.test/mcp"],
    ["no path", "https://tools.example.test"],
    ["a trailing slash", "https://tools.example.test/mcp/"],
    ["another path", "https://tools.example.test/api/mcp"],
    ["a query", "https://tools.example.test/mcp?x=1"],
    ["a fragment", "https://tools.example.test/mcp#x"],
    ["credentials", "https://user:pass@tools.example.test/mcp"],
    ["an uppercase host", "https://Tools.Example.test/mcp"],
    ["the default port spelled out", "https://tools.example.test:443/mcp"],
    ["not a URL", "tools.example.test/mcp"],
  ])("refuses a server URL with %s before creating output", (label, url) => {
    const invalid = join(temp, `invalid-url-${label.replace(/\W+/g, "-")}`);
    const result = build(["--connector", "--version", version, "--marketplace", marketplace, "--server-url", url, "--out", invalid]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--server-url https/);
    expect(existsSync(invalid)).toBe(false);
  });

  it("takes a server URL on another port", () => {
    const other = join(temp, "other-port");
    const url = "https://tools.example.test:8443/mcp";
    const result = build(["--connector", "--version", version, "--marketplace", marketplace, "--server-url", url, "--out", other]);
    expect(result.status, result.stderr).toBe(0);
    const mcp = JSON.parse(readFileSync(join(other, "plugins", "genealogy-research", ".mcp.json"), "utf8"));
    expect(mcp.mcpServers[manifest.display_name].url).toBe(url);
  });

  it("refuses --server-url on the Cowork build, which must never carry a connector", () => {
    const result = build(["--server-url", serverUrl]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/require --connector/);
  });

  it("preserves a non-empty output directory without a marketplace manifest", () => {
    const existing = join(temp, "existing");
    mkdirSync(existing);
    const keep = join(existing, "keep.txt");
    writeFileSync(keep, "keep");
    const result = build(["--connector", ...good, "--out", existing]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/refusing to delete it/);
    expect(readFileSync(keep, "utf8")).toBe("keep");
  });

  it("preserves a git checkout that holds a marketplace", () => {
    const checkout = join(temp, "checkout");
    mkdirSync(join(checkout, ".claude-plugin"), { recursive: true });
    mkdirSync(join(checkout, ".git"));
    writeFileSync(join(checkout, ".claude-plugin", "marketplace.json"), "{}");
    const result = build(["--connector", ...good, "--out", checkout]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/git checkout/);
    expect(existsSync(join(checkout, ".git"))).toBe(true);
  });
});

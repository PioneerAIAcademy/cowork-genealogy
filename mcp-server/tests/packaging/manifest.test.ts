import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { allToolSchemas } from "../../src/tool-schemas.js";

// Contract: docs/specs/mcpb-package-spec.md § "Manifest contract".
// These guard the .mcpb manifest against shipping scaffold placeholders,
// a stale schema version, or a tool list that has drifted from what the
// server actually registers.

const here = dirname(fileURLToPath(import.meta.url));
const mcpRoot = join(here, "..", "..");

const manifest = JSON.parse(
  readFileSync(join(mcpRoot, "manifest.json"), "utf8"),
) as Record<string, any>;
const pkg = JSON.parse(
  readFileSync(join(mcpRoot, "package.json"), "utf8"),
) as { version: string };

describe("mcpb manifest", () => {
  it("uses manifest schema version 0.3", () => {
    expect(manifest.manifest_version).toBe("0.3");
  });

  it("has the required top-level fields", () => {
    for (const field of ["name", "version", "description", "author", "server"]) {
      expect(manifest[field], `missing ${field}`).toBeDefined();
    }
    expect(manifest.name).toBe("genealogy-mcp");
  });

  it("keeps version in sync with package.json", () => {
    expect(manifest.version).toBe(pkg.version);
  });

  it("carries no scaffold placeholders", () => {
    expect(manifest.author?.name).toBeTruthy();
    expect(manifest.author.name).not.toBe("Your Name");
    const desc = String(manifest.description).toLowerCase();
    expect(desc).not.toContain("scaffold");
    expect(desc).not.toContain("hello-world");
  });

  it("declares the node server with the build entry point", () => {
    expect(manifest.server.type).toBe("node");
    expect(manifest.server.entry_point).toBe("build/index.js");
    expect(manifest.server.mcp_config.command).toBe("node");
    expect(manifest.server.mcp_config.args).toContain(
      "${__dirname}/build/index.js",
    );
  });

  it("declares cross-platform compatibility and a node runtime", () => {
    const platforms: string[] = manifest.compatibility?.platforms ?? [];
    for (const p of ["darwin", "win32", "linux"]) {
      expect(platforms, `missing platform ${p}`).toContain(p);
    }
    expect(manifest.compatibility?.runtimes?.node).toBeTruthy();
  });

  it("does not declare user_config (per the config-file convention)", () => {
    expect(manifest.user_config).toBeUndefined();
  });

  it("lists exactly the tools registered in tool-schemas.ts", () => {
    const declared: string[] = (manifest.tools ?? [])
      .map((t: { name: string }) => t.name)
      .sort();
    const registered = allToolSchemas.map((s) => s.name).sort();
    expect(declared).toEqual(registered);
  });
});

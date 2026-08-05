import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";
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

/**
 * Dispatch drift (issue #1164).
 *
 * The manifest check above is the only tool-list assertion the repo had, and it
 * cannot see the dispatcher. Follow the documented recipe — write the tool,
 * export its schema, add it to `allToolSchemas`, add the manifest entry — and
 * forget the `if` in `index.ts`, and every test still passes: `ListTools`
 * spreads `allToolSchemas` straight through, so the tool is advertised to the
 * model and the *first real call* throws `Unknown tool: <name>`. CI is green
 * the whole way, and on the `.mcpb`/Cowork path that surfaces after shipping.
 *
 * Parsed rather than imported: `index.ts` connects the stdio transport as an
 * import side effect, which is the same reason `tool-schemas.ts` exists as a
 * separate module for the check above. `createSourceFile` only parses text, so
 * none of that runs.
 *
 * Parsed rather than regex-matched for a second reason: a comment is not a
 * node, so a **commented-out** dispatch cannot be counted as a live case. That
 * is not hypothetical — block-commenting the whole `research_query` branch
 * leaves `tsc --noEmit` at exit 0 and the tool still advertised by `ListTools`,
 * so the regex version of this test reported 12/12 green while the first real
 * call threw `Unknown tool`. The defect this lint exists to catch, inside the
 * lint.
 */
describe("tool dispatch", () => {
  const indexPath = join(mcpRoot, "src", "index.ts");
  const indexAst = ts.createSourceFile(
    indexPath,
    readFileSync(indexPath, "utf8"),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );

  /** Every `request.params.name === "<tool>"` comparison, in source order. */
  const dispatched: string[] = [];
  const collect = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
      ts.isStringLiteral(node.right) &&
      node.left.getText(indexAst) === "request.params.name"
    ) {
      dispatched.push(node.right.text);
    }
    node.forEachChild(collect);
  };
  indexAst.forEachChild(collect);

  it("finds a dispatch chain at all (guards the extraction itself)", () => {
    // If dispatch is ever refactored to a lookup map this fails, which is the
    // correct outcome: the replacement needs its own check, not a silent pass.
    expect(
      dispatched.length,
      "no `request.params.name === \"…\"` comparisons found in src/index.ts — if " +
        "dispatch was refactored, replace this test rather than deleting it",
    ).toBeGreaterThan(0);
  });

  it("has a case for every registered tool", () => {
    const registered = allToolSchemas.map((s) => s.name).sort();
    const missing = registered.filter((n) => !dispatched.includes(n));
    expect(
      missing,
      `these tools are advertised but have no dispatch case, so the first call ` +
        `throws "Unknown tool": ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("has no dispatch case for an unregistered tool", () => {
    // Harmless by comparison — dead code that is never reached — but it means
    // someone deleted a schema and left the handler, or misspelled a name.
    const registered = new Set(allToolSchemas.map((s) => s.name));
    const orphaned = [...new Set(dispatched)].filter((n) => !registered.has(n));
    expect(
      orphaned,
      `dispatch cases with no entry in allToolSchemas (dead, or a typo in the ` +
        `name): ${orphaned.join(", ")}`,
    ).toEqual([]);
  });

  it("dispatches each tool exactly once", () => {
    const seen = new Map<string, number>();
    for (const name of dispatched) seen.set(name, (seen.get(name) ?? 0) + 1);
    const duped = [...seen.entries()].filter(([, n]) => n > 1).map(([n]) => n);
    expect(
      duped,
      `duplicate dispatch cases — the second is unreachable: ${duped.join(", ")}`,
    ).toEqual([]);
  });
});

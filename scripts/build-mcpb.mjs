#!/usr/bin/env node
// Builds the Claude Desktop extension at releases/genealogy-mcp.mcpb.
// Contract: docs/specs/mcpb-package-spec.md.
//
// Cross-platform (Node) replacement for the former build-mcpb.sh, so it runs
// natively on Windows too (no bash needed). We pack a staged, production-only
// copy of packages/engine/mcp-server/ (not the dev tree) so the bundle ships
// compiled JS + prod deps only -- never devDependencies (typescript, vitest,
// @anthropic-ai/mcpb) or TypeScript source.
import { execSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE = join(ROOT, "packages", "engine", "mcp-server");
const RELEASES = join(ROOT, "releases");
const OUT = join(RELEASES, "genealogy-mcp.mcpb");

const sh = (cmd, cwd = ROOT) => execSync(cmd, { stdio: "inherit", cwd });

console.log("Building MCP server...");
// Requires npm >=11.12 (engine-strict in .npmrc). On EBADENGINE, upgrade npm
// to the version in mcp-server/package.json's packageManager field.
sh("npm install", ENGINE);
sh("npm run build", ENGINE);

console.log("Staging production-only tree...");
const stage = mkdtempSync(join(tmpdir(), "genealogy-mcpb-"));
try {
  for (const f of ["manifest.json", "package.json", "package-lock.json", ".mcpbignore"]) {
    copyFileSync(join(ENGINE, f), join(stage, f));
  }
  for (const d of ["build", "config"]) {
    cpSync(join(ENGINE, d), join(stage, d), { recursive: true });
  }

  console.log("Installing production dependencies into the stage...");
  sh("npm ci --omit=dev --ignore-scripts", stage);

  // The mcpb CLI is the @anthropic-ai/mcpb devDep's local binary; run from the
  // engine dir so `npx` resolves node_modules/.bin/mcpb instead of trying to
  // fetch a (nonexistent) "mcpb" package from the registry.
  console.log("Validating manifest...");
  sh(`npx mcpb validate "${stage}"`, ENGINE);

  console.log("Packing .mcpb...");
  mkdirSync(RELEASES, { recursive: true });
  sh(`npx mcpb pack "${stage}" "${OUT}"`, ENGINE);

  console.log();
  sh(`npx mcpb info "${OUT}"`, ENGINE);
} finally {
  rmSync(stage, { recursive: true, force: true });
}

console.log(`\nDone. Created ${OUT}`);
console.log("Verify it (Mac/Linux) with: ./scripts/verify-mcpb.sh");

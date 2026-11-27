#!/usr/bin/env node
// Writes packages/engine/mcp-server/build/build-info.json after `tsc`.
//
// Run by the engine's `npm run build` (package.json: `tsc && node
// ../../../scripts/write-build-info.mjs`), which is the one step every artifact
// path already takes — scripts/build-mcpb.mjs, apps/server/sandbox/build-image.sh,
// the Makefile's $(ENGINE_BUILD) rule and the engine's own `pretest`. build/ is
// gitignored, cpSync'd into the .mcpb stage and COPY'd into the E2B image, so
// the stamp reaches every artifact from this single write. The running server
// reads it back through src/utils/build-info.ts (`dev` fallback when absent).
//
// `--engine <dir>` names an engine folder that is not this repo's: the tool server's
// image (apps/server/proto/tools/Dockerfile) compiles at /app. A checkout always
// answers for itself; only when git has no answer does BUILD_SHA speak (`envStamp`).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildVersion, envStamp, gitStamp } from "./build-stamp.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({ options: { engine: { type: "string" } } });
const ENGINE = values.engine ? resolve(values.engine) : join(ROOT, "packages", "engine", "mcp-server");

const base = JSON.parse(readFileSync(join(ENGINE, "package.json"), "utf8")).version;
const fromGit = gitStamp(ROOT);
const stamp = fromGit.sha ? fromGit : (envStamp() ?? fromGit);
const info = {
  version: buildVersion(base, stamp),
  base,
  sha: stamp.sha ?? "dev",
  date: stamp.sha ? stamp.date : "dev",
  dirty: stamp.dirty,
};

mkdirSync(join(ENGINE, "build"), { recursive: true });
writeFileSync(join(ENGINE, "build", "build-info.json"), JSON.stringify(info, null, 2) + "\n");
console.log(`build-info.json: ${info.version}`);

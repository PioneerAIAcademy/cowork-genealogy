/**
 * `make mcp-viewer-sweep`, step 1: stage every committed end state as a project folder
 * and dump each one's `read_project_view` document, as a card would read it.
 *
 *   npx tsx dev/sweep-stage.ts --out <repo>/releases/mcp-viewer-sweep
 *
 * Writes <out>/docs/<name>.json, one per state, and <out>/count.txt. Exits 1 if any
 * read fails. The page's sweep (apps/mcp-viewer/sweep/) reads only those files.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { callTool } from "../viewer/tools.js";

const REPO = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));
const RUNLOGS = join(REPO, "eval/runlogs/e2e");
const E2E_FIXTURES = join(REPO, "eval/tests/e2e");

/** Committed projects staged whole: the capture, and the fixtures that hold evaluations. */
const WHOLE = [
  ["mcandrew-capture", "docs/captures/2026-09-29-mcandrew-children"],
  ["compound-objective-fully-covered", "eval/fixtures/scenarios/compound-objective-fully-covered"],
  ["compound-objective-part-unframed", "eval/fixtures/scenarios/compound-objective-part-unframed"],
  ["flynn-prior-craft-verdict", "eval/fixtures/scenarios/flynn-prior-craft-verdict"],
] as const;

function arg(name: string): string {
  const at = process.argv.indexOf(name);
  const value = at >= 0 ? process.argv[at + 1] : undefined;
  if (!value) throw new Error(`usage: tsx dev/sweep-stage.ts ${name} <dir>`);
  return value;
}

function stage(projects: string): string[] {
  const names: string[] = [];
  for (const [name, dir] of WHOLE) {
    cpSync(join(REPO, dir), join(projects, name), { recursive: true });
    names.push(name);
  }
  for (const fixture of readdirSync(RUNLOGS).sort()) {
    const runs = join(RUNLOGS, fixture);
    let files: string[];
    try {
      files = readdirSync(runs);
    } catch {
      continue;
    }
    for (const file of files.filter((f) => f.endsWith(".final-research.json")).sort()) {
      const stem = file.slice(0, -".final-research.json".length);
      const name = `${fixture}--${stem}`;
      const folder = join(projects, name);
      mkdirSync(folder);
      cpSync(join(runs, file), join(folder, "research.json"));
      const tree = join(runs, `${stem}.final-tree.gedcomx.json`);
      if (existsSync(tree)) cpSync(tree, join(folder, "tree.gedcomx.json"));
      const starting = join(E2E_FIXTURES, fixture, "starting-tree.gedcomx.json");
      if (existsSync(starting)) cpSync(starting, join(folder, "starting-tree.gedcomx.json"));
      names.push(name);
    }
  }
  return names;
}

async function main(): Promise<void> {
  const out = resolve(arg("--out"));
  // It empties the folder it is given, so it takes only the one the Makefile names.
  if (basename(out) !== "mcp-viewer-sweep") throw new Error(`--out must be a folder named mcp-viewer-sweep, not ${out}`);
  rmSync(out, { recursive: true, force: true });
  const projects = join(out, "projects");
  const docs = join(out, "docs");
  mkdirSync(projects, { recursive: true });
  mkdirSync(docs, { recursive: true });
  const names = stage(projects);
  const context = {
    rootReal: realpathSync(projects),
    signImage: () => {
      throw new Error("The sweep signs no images.");
    },
  };
  let failed = 0;
  for (const name of names) {
    const result = await callTool(context, "read_project_view", { part: "document", projectPath: name });
    if (result.isError) {
      failed++;
      process.stderr.write(`${name}: ${(result.content[0] as { text: string }).text}\n`);
      continue;
    }
    writeFileSync(join(docs, `${name}.json`), JSON.stringify(result.structuredContent), "utf8");
  }
  writeFileSync(join(out, "count.txt"), String(names.length), "utf8");
  process.stdout.write(`staged ${names.length} projects, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

await main();

/**
 * Smoke-test research_append against a local project folder — and, with no
 * arguments, walk the five projectPath states from issue #1695 so you can READ
 * what a person actually sees in each. The whole point of that change is the
 * wording, which no assertion checks for you.
 *
 * Usage:
 *   npx tsx dev/try-research-append.ts                 # the five states, in temp dirs
 *   npx tsx dev/try-research-append.ts <projectPath>   # one real project
 */
import { mkdtemp, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { researchAppend } from "../src/tools/research-append.js";

const entry = { id: "src_001", title: "A record found while not in a project" };

async function call(projectPath: any) {
  return researchAppend({ projectPath, section: "sources", op: "append", entry } as any);
}

const [, , projectPath] = process.argv;

if (projectPath) {
  console.log(JSON.stringify(await call(projectPath), null, 2));
  process.exit(0);
}

const dir = await mkdtemp(join(tmpdir(), "try-research-append-"));
try {
  const show = async (label: string, p: any) => {
    const r: any = await call(p);
    console.log(`\n── ${label} ──`);
    console.log(`  reason:  ${r.reason ?? "(none — a real failure)"}`);
    console.log(`  message: ${(r.errors ?? []).join(" ")}`);
  };

  await show("no projectPath at all", undefined);
  await show("projectPath does not exist", join(dir, "no-such-folder"));
  await show("a folder that is not a project", dir);

  await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify({ persons: [] }), "utf-8");
  await show("half a project — tree present, research.json gone", dir);

  await writeFile(join(dir, "research.json"), "{not json", "utf-8");
  await show("a corrupt research.json", dir);
} finally {
  await rm(dir, { recursive: true, force: true });
}

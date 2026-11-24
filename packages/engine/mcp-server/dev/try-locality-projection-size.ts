/**
 * The size of `project_context`'s `localities` projection for each run log's final research.json,
 * and how much of it the record-type rows take.
 *
 *   npx tsx dev/try-locality-projection-size.ts <run-log.json> [...]
 */
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { projectContext } from "../src/tools/project-context.js";
import { LOCAL } from "../src/auth/principal.js";

const sizes: { total: number; rows: number }[] = [];
for (const path of process.argv.slice(2)) {
  const log = JSON.parse(readFileSync(path, "utf8"));
  const research = log.final_research;
  if (!research) continue;
  const dir = mkdtempSync(join(tmpdir(), "proj-size-"));
  writeFileSync(join(dir, "research.json"), JSON.stringify(research));
  writeFileSync(join(dir, "tree.gedcomx.json"), JSON.stringify({ persons: [], relationships: [], sources: [] }));
  const r: any = await projectContext({ projectPath: dir }, LOCAL);
  rmSync(dir, { recursive: true, force: true });
  const locs = r.localities ?? [];
  sizes.push({
    total: JSON.stringify(locs).length,
    rows: locs.reduce((n: number, l: any) => n + JSON.stringify([l.recordTypes ?? [], l.repositories ?? [], l.losses ?? []]).length, 0),
  });
}
const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
console.log(`${sizes.length} runs; localities projection median ${med(sizes.map((s) => s.total))} max ${Math.max(...sizes.map((s) => s.total))}; rows median ${med(sizes.map((s) => s.rows))} max ${Math.max(...sizes.map((s) => s.rows))}`);

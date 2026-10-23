/**
 * Try `timeline_build` on a scratch copy of a committed e2e fixture's starting
 * state, against the live Places API, and time it (issue #3516).
 *
 * With `--extract` it first runs `extraction_append({ personId })` (live
 * FamilySearch, needs a login) so the subject has attachment links to build
 * from — the baseline step a /research job runs before its first question.
 * Then it runs `timeline_build` once cold and once warm and prints the timings,
 * the gaps and the summary. The fixture itself is never touched.
 *
 *   npx tsx dev/try-timeline-build.ts <fixture-slug> <personId> [--extract]
 *   npx tsx dev/try-timeline-build.ts william-sloan-spouse LHG6-L26 --extract
 */

import { mkdtempSync, copyFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { LOCAL } from "../src/auth/principal.js";
import { extractionAppend } from "../src/tools/extraction-append.js";
import { timelineBuild } from "../src/tools/timeline-build.js";

const args = process.argv.slice(2);
const extract = args.includes("--extract");
const [slug, personId] = args.filter((a) => a !== "--extract");
if (!slug || !personId) {
  console.error("Usage: npx tsx dev/try-timeline-build.ts <fixture-slug> <personId> [--extract]");
  process.exit(2);
}
const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "..", "..", "..", "..", "eval", "tests", "e2e", slug);

async function once(label: string, dir: string): Promise<void> {
  const t0 = Date.now();
  const r: any = await timelineBuild({ projectPath: dir, personId });
  const ms = Date.now() - t0;
  console.log(`${label}: ${ms} ms  ok=${r.ok} status=${r.status ?? "-"} events=${r.events ?? "-"}` +
    ` unverified=${r.unverifiedEvents ?? "-"} gaps=${JSON.stringify(r.gaps ?? null)}`);
  console.log(`  summary: ${r.summary ?? r.errors?.join(" | ")}`);
  if (r.ok && r.timelineId) {
    const research = JSON.parse(readFileSync(join(dir, "research.json"), "utf-8"));
    const t = research.timelines.find((x: any) => x.id === r.timelineId);
    if (process.env.TRY_EVENTS) {
      for (const e of t?.events ?? []) {
        console.log(`  event ${e.date.padEnd(12)} ${e.event_type.padEnd(10)} ${String(e.standard_place ?? e.place ?? "-")}`);
      }
    }
    for (const g of t?.gaps ?? []) console.log(`  gap ${g.severity} ${g.start}..${g.end}: ${g.expected_events.join(", ")}`);
  }
}

const dir = mkdtempSync(join(tmpdir(), "try-timeline-build-"));
try {
  copyFileSync(join(fixture, "starting-research.json"), join(dir, "research.json"));
  copyFileSync(join(fixture, "starting-tree.gedcomx.json"), join(dir, "tree.gedcomx.json"));
  copyFileSync(join(fixture, "starting-tree.gedcomx.json"), join(dir, "starting-tree.gedcomx.json"));
  if (extract) {
    const t0 = Date.now();
    const e: any = await extractionAppend({ projectPath: dir, personId } as any, LOCAL);
    console.log(`extraction_append: ${Date.now() - t0} ms  ok=${e.ok} extracted=${e.extracted} linked=${e.linked}`);
  }
  await once("cold", dir);
  await once("warm (rerun updates in place)", dir);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

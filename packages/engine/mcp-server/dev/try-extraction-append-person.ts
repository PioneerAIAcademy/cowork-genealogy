/**
 * Try `extraction_append({ personId })` against live FamilySearch on a scratch
 * copy of a committed e2e fixture's starting state, and time it (issue #3516).
 *
 * The baseline step reads every record attached to a subject, so its cost
 * grows with the attached set. Cowork aborts a tool call at 60 s. This copies
 * the fixture to a temp folder (the fixture itself is never touched), runs the
 * mode once cold and once warm, and prints the counts and the wall-clock.
 *
 *   npx tsx dev/try-extraction-append-person.ts <fixture-slug> <personId>
 *   npx tsx dev/try-extraction-append-person.ts william-sloan-spouse LHG6-L26
 */

import { mkdtempSync, copyFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { LOCAL } from "../src/auth/principal.js";
import { extractionAppend } from "../src/tools/extraction-append.js";

const [slug, personId] = process.argv.slice(2);
if (!slug || !personId) {
  console.error("Usage: npx tsx dev/try-extraction-append-person.ts <fixture-slug> <personId>");
  process.exit(2);
}
const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "..", "..", "..", "..", "eval", "tests", "e2e", slug);

async function once(label: string, dir: string): Promise<void> {
  const t0 = Date.now();
  const r = await extractionAppend({ projectPath: dir, personId } as any, LOCAL);
  const ms = Date.now() - t0;
  console.log(
    `${label}: ${ms} ms  ok=${r.ok} extracted=${r.extracted} linked=${r.linked} skipped=${r.skipped}` +
      ` alreadyLinked=${r.alreadyLinked ?? 0} rejectedSkipped=${r.rejectedSkipped ?? 0} records=${r.records.length}`,
  );
  console.log(`  summary: ${r.summary}`);
  if (r.errors?.length) console.log(`  errors: ${r.errors.slice(0, 3).join(" | ")}`);
}

const dir = mkdtempSync(join(tmpdir(), "try-extraction-person-"));
try {
  copyFileSync(join(fixture, "starting-research.json"), join(dir, "research.json"));
  copyFileSync(join(fixture, "starting-tree.gedcomx.json"), join(dir, "tree.gedcomx.json"));
  copyFileSync(join(fixture, "starting-tree.gedcomx.json"), join(dir, "starting-tree.gedcomx.json"));
  await once("cold", dir);
  await once("warm (resend: already extracted, already linked)", dir);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

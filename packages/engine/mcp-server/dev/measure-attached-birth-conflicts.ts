/**
 * How often a tree person's own FamilySearch-attached records disagree on
 * birthplace (issue #4444): the population the core-identifier gate's
 * attached-births arm judges. The committed corpus holds five such people, too
 * few to say how often the arm would cap a correct link, so this reads them live.
 *
 * For each e2e fixture it copies the starting state to a temp folder (the fixture
 * is never touched), runs person mode (`extraction_append({ personId })`, spec
 * §11.8) on the fixture's subject exactly as the setup step does, then asks the
 * gate's own logic (`attachedBirthConflictsOf`) which tree people now carry
 * attached births that contradict each other. Every one is printed for a
 * genealogist to classify: a conflation (two people under one tree person, the
 * arm's target) or an ordinary error in one record (a census birthplace that is
 * simply wrong, where the arm would cap a correct link).
 *
 *   npx tsx dev/measure-attached-birth-conflicts.ts                 # every fixture
 *   npx tsx dev/measure-attached-birth-conflicts.ts --limit 40      # the first 40
 *   npx tsx dev/measure-attached-birth-conflicts.ts --only thomas-hanrahan-marriage
 *
 * Live: needs a FamilySearch login (the `login` tool) and reads every record
 * attached to each subject. Coordinates come from the FamilySearch Places API,
 * with each place's other FamilySearch names, as the gate's prefetch reads them. Exits 2 when it walked no fixture successfully or
 * judged no person with two attached births, so a broken login or a broken arm
 * cannot read as a clean zero.
 */
import { mkdtempSync, copyFileSync, rmSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { LOCAL } from "../src/auth/principal.js";
import { extractionAppend } from "../src/tools/extraction-append.js";
import { attachedBirthConflictsOf, attachedBirthsOf, birthPlaceInfo } from "../src/tools/research-append.js";
import { lookupWithin } from "../src/utils/place-coords.js";

function usage(problem: string): never {
  console.error(`${problem}\nusage: measure-attached-birth-conflicts.ts [--limit <positive whole number>] [--only <fixture slug>]`);
  process.exit(2);
}
let limit = Infinity;
let only: string | undefined;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  const [name, value] = [args[i], args[i + 1]];
  if (name !== "--limit" && name !== "--only") usage(`unknown argument '${name}'`);
  if (value === undefined || value.startsWith("--")) usage(`${name} needs a value`);
  if (name === "--only") only = value;
  else if (!/^[1-9]\d*$/.test(value)) usage(`--limit needs a positive whole number, not '${value}'`);
  else limit = Number(value);
}

const here = dirname(fileURLToPath(import.meta.url));
const e2eRoot = join(here, "..", "..", "..", "..", "eval", "tests", "e2e");
const slugs = readdirSync(e2eRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(e2eRoot, d.name, "fixture.json")))
  .map((d) => d.name)
  .filter((s) => !only || s === only)
  .sort();
if (only && slugs.length === 0) {
  console.error(`no e2e fixture named ${only}`);
  process.exit(2);
}

let walked = 0, failed = 0, judged = 0, conflicted = 0;
const lines: string[] = [];

for (const slug of slugs.slice(0, limit)) {
  const fixture = join(e2eRoot, slug);
  const pid = JSON.parse(readFileSync(join(fixture, "fixture.json"), "utf-8")).source_pid;
  if (typeof pid !== "string" || !existsSync(join(fixture, "starting-tree.gedcomx.json"))) continue;
  const dir = mkdtempSync(join(tmpdir(), "measure-attached-births-"));
  try {
    copyFileSync(join(fixture, "starting-research.json"), join(dir, "research.json"));
    copyFileSync(join(fixture, "starting-tree.gedcomx.json"), join(dir, "tree.gedcomx.json"));
    copyFileSync(join(fixture, "starting-tree.gedcomx.json"), join(dir, "starting-tree.gedcomx.json"));
    const r = await extractionAppend({ projectPath: dir, personId: pid } as any, LOCAL);
    if (!r.ok) {
      failed += 1;
      lines.push(`FAILED\t${slug}\t${pid}\t${(r.errors ?? []).join(" | ").slice(0, 200)}`);
      continue;
    }
    walked += 1;
    const research = JSON.parse(readFileSync(join(dir, "research.json"), "utf-8"));
    const tree = JSON.parse(readFileSync(join(dir, "tree.gedcomx.json"), "utf-8"));
    const live = ((research.person_evidence ?? []) as any[]).filter((e) => e && e.superseded_by == null);
    const links = live.map((e) => ({ id: e.id, assertion_id: e.assertion_id, person_id: e.person_id, confidence: e.confidence }));
    for (const person of (tree.persons ?? []) as any[]) {
      const births = attachedBirthsOf(person.id, research, links);
      if (births.length < 2) continue;
      judged += 1;
      const names = [...new Set(births.map((b) => b.assertion.standard_place).filter((n) => typeof n === "string"))];
      const coords = names.length ? await lookupWithin(names, (n) => birthPlaceInfo(n, true), 60_000) : new Map();
      const pairs = attachedBirthConflictsOf(person.id, research, tree, links, coords as any);
      if (pairs.length === 0) continue;
      conflicted += 1;
      const name = (person.names?.[0]?.given ?? "") + " " + (person.names?.[0]?.surname ?? "");
      for (const [x, y] of pairs) {
        lines.push(
          `CONFLICT\t${slug}\t${person.id}\t${name.trim()}\t'${x.place}' [${x.standard_place ?? "-"}] (${x.id}, ${x.record_id})\t'${y.place}' [${y.standard_place ?? "-"}] (${y.id}, ${y.record_id})`,
        );
      }
    }
  } catch (e) {
    failed += 1;
    lines.push(`FAILED\t${slug}\t${pid}\t${e instanceof Error ? e.message : String(e)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`fixtures walked                         : ${walked} (${failed} failed)`);
console.log(`people with two or more attached births : ${judged}`);
console.log(`people whose attached births contradict : ${conflicted}`);
for (const l of lines) console.log(l);
if (walked === 0 || judged === 0) {
  console.error("walked no fixture or judged nobody: check the FamilySearch login");
  process.exit(2);
}

/**
 * Probe: what `stdDate` changes over the committed corpus, against another
 * revision's `stdDate`. The evidence behind the "never emit a partial" rule in
 * simplified-gedcomx-spec.md (`standard_date`).
 *
 * Collects every string under a key named `date`, at any depth, in every JSON
 * file under eval/fixtures/scenarios, eval/tests/e2e and eval/runlogs/e2e:
 * tree facts and assertions, and also expected findings, source citations and
 * anything else that names a date. Scoping to tree facts and assertions alone
 * missed a correct output this rule had broken ("on or about 23 August 1936").
 *
 * Both versions run in this process: the comparison ref's
 * date-standardize.ts and date-constants.ts are read out of git into a temp
 * dir and imported from there. Re-run rather than quoting the figures forward;
 * the corpus moves as run logs land.
 *
 * Offline; no FamilySearch session needed. Not shipped in any artifact.
 *
 * Usage:
 *   npx tsx dev/probe-stddate-corpus.ts [--against <ref>] [--list]
 *   (default ref: origin/main)
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { stdDate as current } from "../src/utils/date-standardize.js";
import { repoRoot } from "./runlog-calls.js";

const ROOTS = ["eval/fixtures/scenarios", "eval/tests/e2e", "eval/runlogs/e2e"];
const SRC = "packages/engine/mcp-server/src/utils";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function jsonFiles(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) jsonFiles(p, out);
    else if (name.endsWith(".json")) out.push(p);
  }
}

function collectDates(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const v of node) collectDates(v, out);
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "date" && typeof v === "string") out.add(v);
      else collectDates(v, out);
    }
  }
}

/** A day with no month in a standard_date: "13 1752", "Abt 3 1872". */
function dayWithoutMonth(s: string): boolean {
  return s
    .replace(/\s*\([^)]*\)$/, "")
    .split(/ and | or /)
    .some((part) => /^(?:(?:Abt|Bef|Aft|Cal|Est|Bet) )?\d{1,2} \d{3,4}(?:\/\d{2})?$/.test(part.trim()));
}

async function main(): Promise<void> {
  const ref = arg("--against") ?? "origin/main";
  const tmp = mkdtempSync(join(tmpdir(), "stddate-ref-"));
  try {
    for (const f of ["date-standardize.ts", "date-constants.ts"]) {
      const body = execFileSync("git", ["show", `${ref}:${SRC}/${f}`], { cwd: repoRoot, encoding: "utf8" });
      writeFileSync(join(tmp, f), body, "utf8");
    }
    const { stdDate: before } = (await import(pathToFileURL(join(tmp, "date-standardize.ts")).href)) as {
      stdDate: (raw: string) => string;
    };

    const files: string[] = [];
    for (const r of ROOTS) jsonFiles(join(repoRoot, r), files);
    const dates = new Set<string>();
    for (const f of files) {
      try {
        collectDates(JSON.parse(readFileSync(f, "utf8")), dates);
      } catch {
        // Not JSON a date can come from; skip.
      }
    }

    const changed: string[] = [];
    let becameEmpty = 0;
    let wasEmpty = 0;
    let dwmBefore = 0;
    let dwmAfter = 0;
    for (const d of dates) {
      const b = before(d);
      const a = current(d);
      if (dayWithoutMonth(b)) dwmBefore++;
      if (dayWithoutMonth(a)) dwmAfter++;
      if (a === b) continue;
      if (a === "") becameEmpty++;
      if (b === "") wasEmpty++;
      changed.push(`${JSON.stringify(d)}  :  ${JSON.stringify(b)} -> ${JSON.stringify(a)}`);
    }

    console.log(
      JSON.stringify({
        against: ref,
        files: files.length,
        distinct: dates.size,
        changed: changed.length,
        becameEmpty,
        wasEmpty,
        dayWithoutMonthBefore: dwmBefore,
        dayWithoutMonthAfter: dwmAfter,
      }),
    );
    if (process.argv.includes("--list")) for (const line of changed.sort()) console.log(line);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

void main();

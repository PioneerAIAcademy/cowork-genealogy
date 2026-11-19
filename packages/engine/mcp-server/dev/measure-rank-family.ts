/**
 * Does ranking pick the right record more often when FamilySearch's matcher is
 * sent the subject with their family than with the subject alone (issue #4444)?
 *
 * Ranking on the FamilySearch backend sent the enriched subject alone, while
 * `same_person` and the matcher service send the family cut around them
 * (`Mob.matchSubset()`), so a household record's spouse and children counted for
 * nothing. In thomas-hanrahan-marriage the right 1865 household scored 0.003
 * alone, under the 0.01 floor, and the page read as a real negative.
 *
 * This replays ranked `record_search` calls from the committed e2e runs against
 * each fixture's STARTING project (copied to a temp folder; the fixture is never
 * touched), and scores every row of each page both ways. The truth is
 * FamilySearch's own attachments: a row attached to the subject's FamilySearch
 * person is right, a row attached only to someone else is wrong, any other row is
 * unknown. Each arm reports where the right rows rank, how many wrong rows clear
 * the floor or outrank the best right row, and how many pages holding a right
 * row would read as a real negative.
 *
 *   npx tsx dev/measure-rank-family.ts                        # 2 searches per fixture
 *   npx tsx dev/measure-rank-family.ts --per-fixture 1
 *   npx tsx dev/measure-rank-family.ts --only thomas-hanrahan-marriage
 *   npx tsx dev/measure-rank-family.ts --from juan-goni-daughter      # resume, in slug order
 *   npx tsx dev/measure-rank-family.ts --dump rows.jsonl              # every page's rows
 *
 * Live: needs a FamilySearch login (the `login` tool). Exits 2 when it scored no
 * page with a right row, or when the two arms sent the same document on every
 * page (no subject had a relative, or both arms were built the same way), so a
 * broken login, an empty replay or a measurement of one arm against itself
 * cannot read as a clean result.
 */
import { mkdtempSync, copyFileSync, rmSync, readFileSync, readdirSync, existsSync, mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { LOCAL } from "../src/auth/principal.js";
import { recordSearchTool } from "../src/tools/record-search.js";
import { buildSubjectDoc } from "../src/tools/rank-search-matches.js";
import { sourceAttachmentsTool } from "../src/tools/source-attachments.js";
import { readStagedResults } from "../src/utils/results-staging.js";
import { scorePair } from "../src/utils/match-engine.js";
import { mapWithConcurrency } from "../src/utils/place-resolver.js";
import { Mob } from "../src/utils/mob.js";
import { FAMILYSEARCH_FLOORS } from "../src/utils/matcher.js";
import type { SimplifiedGedcomX } from "../src/types/gedcomx.js";

function usage(problem: string): never {
  console.error(`${problem}\nusage: measure-rank-family.ts [--per-fixture <positive whole number>] [--only <fixture slug>] [--from <fixture slug>] [--dump <file>]`);
  process.exit(2);
}
let perFixture = 2;
let only: string | undefined;
let from: string | undefined;
let dump: string | undefined;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--per-fixture") {
    const v = argv[++i];
    if (v === undefined || !/^[1-9]\d*$/.test(v)) usage(`--per-fixture needs a positive whole number, got '${v ?? ""}'`);
    perFixture = Number(v);
  } else if (a === "--only") {
    const v = argv[++i];
    if (v === undefined || v.startsWith("--")) usage("--only needs a fixture slug");
    only = v;
  } else if (a === "--from") {
    const v = argv[++i];
    if (v === undefined || v.startsWith("--")) usage("--from needs a fixture slug");
    from = v;
  } else if (a === "--dump") {
    const v = argv[++i];
    if (v === undefined || v.startsWith("--")) usage("--dump needs a file path");
    dump = v;
  } else usage(`unknown argument '${a}'`);
}

const repo = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const runlogs = join(repo, "eval/runlogs/e2e");
const fixtures = join(repo, "eval/tests/e2e");
const FLOOR = FAMILYSEARCH_FLOORS.realNegative;
if (only !== undefined && !existsSync(join(fixtures, only))) usage(`--only: no fixture '${only}'`);
if (from !== undefined && !existsSync(join(fixtures, from))) usage(`--from: no fixture '${from}'`);
if (dump !== undefined) writeFileSync(dump, "");

type Search = { slug: string; args: Record<string, unknown> };
function searchesOf(slug: string): Search[] {
  const tree = JSON.parse(readFileSync(join(fixtures, slug, "starting-tree.gedcomx.json"), "utf8"));
  const ids = new Set((tree.persons ?? []).map((p: { id: string }) => p.id));
  const seen = new Set<string>();
  const out: Search[] = [];
  const files = readdirSync(join(runlogs, slug))
    .filter((f) => /^run-[\d_-]+\.json$/.test(f))
    .sort()
    .reverse();
  for (const f of files) {
    let run: { tool_calls?: Array<{ tool?: string; args?: Record<string, unknown> }> };
    try {
      run = JSON.parse(readFileSync(join(runlogs, slug, f), "utf8"));
    } catch {
      continue;
    }
    for (const c of run.tool_calls ?? []) {
      if (!String(c.tool).endsWith("record_search")) continue;
      const { projectPath: _p, subjectId, offset: _o, ...rest } = c.args ?? {};
      if (typeof subjectId !== "string" || !ids.has(subjectId)) continue;
      const key = JSON.stringify({ subjectId, ...rest });
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ slug, args: { subjectId, ...rest } });
      if (out.length >= perFixture) return out;
    }
  }
  return out;
}

type Row = { recordId: string; alone: number | null; family: number | null; truth: "right" | "wrong" | "unknown" };
const ranks = (rows: Row[], arm: "alone" | "family") =>
  [...rows].sort((a, b) => (b[arm] ?? -1) - (a[arm] ?? -1));

const slugs = readdirSync(runlogs)
  .filter((s) => existsSync(join(fixtures, s, "starting-tree.gedcomx.json")))
  .filter((s) => only === undefined || s === only)
  .filter((s) => from === undefined || s >= from)
  .sort();

const tally = {
  pages: 0, pagesWithRight: 0, pagesWithFamily: 0, failed: 0,
  alone: { rightTop1: 0, rightAboveFloor: 0, negativeWithRight: 0, wrongAboveFloor: 0, wrongOverRight: 0 },
  family: { rightTop1: 0, rightAboveFloor: 0, negativeWithRight: 0, wrongAboveFloor: 0, wrongOverRight: 0 },
  rightRows: 0, wrongRows: 0,
};

for (const slug of slugs) {
  for (const s of searchesOf(slug)) {
    const dir = mkdtempSync(join(tmpdir(), "rank-family-"));
    try {
      copyFileSync(join(fixtures, slug, "starting-tree.gedcomx.json"), join(dir, "tree.gedcomx.json"));
      copyFileSync(join(fixtures, slug, "starting-research.json"), join(dir, "research.json"));
      mkdirSync(join(dir, "results"));
      const subjectId = s.args.subjectId as string;
      const { subjectId: _s, ...searchArgs } = s.args;
      // The replayed call carried subjectId, which makes the tool default to 50 rows.
      const run = () => recordSearchTool({ count: 50, ...searchArgs, projectPath: dir } as never, LOCAL);
      // One retry after a pause: a search that times out once is common, and a
      // dropped page is a page this measurement cannot judge.
      const search = await run().catch(async () => {
        await new Promise((r) => setTimeout(r, 30_000));
        return run();
      });
      if (!search.staged?.resultsRef) continue;
      const rows = (await readStagedResults(dir, search.staged.resultsRef)) as Array<{
        recordId: string; gedcomx?: SimplifiedGedcomX; primaryId?: string;
      }>;
      const subject = await buildSubjectDoc(dir, subjectId);
      // Both arms are built here from the enriched tree, not taken from
      // `subject.doc`, which is whatever the shipped code sends.
      const enriched = (subject.tree as SimplifiedGedcomX).persons?.find((p) => p.id === subjectId);
      if (!enriched) throw new Error(`no enriched subject ${subjectId}`);
      const aloneDoc: SimplifiedGedcomX = { persons: [enriched] };
      const family = new Mob(subject.tree, subjectId).matchSubset().gedcomx;
      const relatives = (family.persons ?? []).length - 1;
      if (relatives > 0) tally.pagesWithFamily++;
      const sendable = rows.filter((r) => r.gedcomx && r.primaryId);
      const score = (doc: SimplifiedGedcomX) =>
        mapWithConcurrency(sendable, 10, async (r) => {
          try {
            return (await scorePair(r.gedcomx!, r.primaryId!, doc, subjectId, LOCAL)).score;
          } catch {
            return null;
          }
        });
      const [alone, fam] = [await score(aloneDoc), await score(family)];
      const att = await sourceAttachmentsTool({ uris: sendable.map((r) => r.recordId) }, LOCAL);
      const fsId = subject.familySearchId?.toUpperCase();
      const scored: Row[] = sendable.map((r, i) => {
        const persons = att.attachments[r.recordId] ?? [];
        const onSubject = fsId !== undefined && persons.some((p) => p.personId?.toUpperCase() === fsId);
        return {
          recordId: r.recordId,
          alone: alone[i],
          family: fam[i],
          truth: onSubject ? "right" : persons.length > 0 ? "wrong" : "unknown",
        };
      });
      tally.pages++;
      const right = scored.filter((r) => r.truth === "right");
      const wrong = scored.filter((r) => r.truth === "wrong");
      tally.rightRows += right.length;
      tally.wrongRows += wrong.length;
      const line: string[] = [];
      for (const arm of ["alone", "family"] as const) {
        const order = ranks(scored, arm);
        const t = tally[arm];
        const max = Math.max(...scored.map((r) => r[arm] ?? 0));
        const bestRight = Math.max(...right.map((r) => r[arm] ?? 0), -1);
        t.wrongAboveFloor += wrong.filter((r) => (r[arm] ?? 0) > FLOOR).length;
        if (right.length > 0) {
          if (order[0]?.truth === "right") t.rightTop1++;
          t.rightAboveFloor += right.filter((r) => (r[arm] ?? 0) > FLOOR).length;
          if (max <= FLOOR) t.negativeWithRight++;
          t.wrongOverRight += wrong.filter((r) => (r[arm] ?? 0) > bestRight).length;
        }
        const rightRanks = right.map((r) => order.indexOf(r) + 1).join(",") || "-";
        line.push(`${arm} max ${max.toFixed(3)} right@${rightRanks}`);
      }
      if (right.length > 0) tally.pagesWithRight++;
      if (dump !== undefined) appendFileSync(dump, JSON.stringify({ slug, subjectId, relatives, args: s.args, rows: scored }) + "\n");
      console.log(`${slug} ${subjectId} relatives ${relatives} rows ${scored.length} right ${right.length} wrong ${wrong.length} | ${line.join(" | ")}`);
    } catch (err) {
      tally.failed++;
      console.log(`${slug} FAILED: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

console.log("\n" + JSON.stringify(tally, null, 1));
if (tally.pagesWithRight === 0) {
  console.error("Scored no page holding a row attached to its subject: nothing was measured.");
  process.exit(2);
}
if (tally.pagesWithFamily === 0) {
  console.error("No page's subject had a relative to send: the two arms were never different.");
  process.exit(2);
}

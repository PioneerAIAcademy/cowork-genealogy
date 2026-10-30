/// <reference types="node" />
/**
 * Live smoke of the matcher shim against a running matcher service
 * (docs/specs/matcher-shim-spec.md). It starts no service: run one first, e.g.
 * `MATCHER_API_KEYS="$(cat <key file>)" MATCHER_PORT=8765 make -C <matcher-lab>/matcher serve`.
 *
 * Scores through the engine's own tools on a temporary copy of the committed
 * `flynn-record-matching` scenario, with a name-only person added as a thin
 * subject:
 *   (a) rank_search_matches on a 100-row page of committed record_search rows;
 *   (b) the thin subject, whose withheld ranking quotes the service's floor;
 *   (c) same_person's project arm, through the record_search sidecar, so no
 *       FamilySearch read;
 *   (d) project relatives;
 *   (e) the explicit arm, two records.
 * Per call it prints the scores, the duration, each POST's size, the model and
 * floors the service answered with, Jev's status, and the scorer and model read
 * back from the score log or the attestation. Every request to FamilySearch is
 * counted, and the run fails unless there were none.
 *
 *   --bad-key  sends a wrong key: (c) must fail with the 401 message
 *   --down     the service is stopped: (c) must fail as unreachable
 *
 * The matcher settings ride a local principal's overlay; config.json is never
 * written. Nothing printed holds the key.
 *
 * Usage:
 *   npx tsx dev/try-matcher-service.ts --url http://127.0.0.1:8765 --key-file <path> [--bad-key | --down]
 */
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { localPrincipal } from "../src/auth/principal.js";
import { rankSearchMatches } from "../src/tools/rank-search-matches.js";
import { samePerson } from "../src/tools/same-person.js";
import { readMatchScores } from "../src/utils/match-scores.js";
import { stageSearchResults } from "../src/utils/results-staging.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..");
const SCENARIO = join(REPO_ROOT, "eval", "fixtures", "scenarios", "flynn-record-matching");
const MCP_FIXTURES = join(REPO_ROOT, "eval", "fixtures", "mcp");
const RECORD = "https://www.familysearch.org/ark:/61903/1:1:MXHY-TP4";
const PAGE = 100;

interface Post {
  bytes: number;
  ms: number;
  status: number;
  model?: string;
  floors?: unknown;
  jev?: string[];
}

function args(argv: string[]): { url: string; keyFile: string; badKey: boolean; down: boolean } {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const url = value("--url");
  const keyFile = value("--key-file");
  if (!url || !keyFile) {
    console.error("usage: npx tsx dev/try-matcher-service.ts --url <base> --key-file <path> [--bad-key | --down]");
    process.exit(2);
  }
  return { url, keyFile, badKey: argv.includes("--bad-key"), down: argv.includes("--down") };
}

const opts = args(process.argv.slice(2));
const key = readFileSync(opts.keyFile, "utf8").trim();
const principal = localPrincipal({
  matcher: "service",
  matcherUrl: opts.url,
  matcherApiKey: opts.badKey ? "this-is-not-the-callers-key" : key,
});

// Every request the engine makes passes through here: FamilySearch ones are
// counted, and each /v1/score POST is measured and its answer read.
let familySearchRequests = 0;
let posts: Post[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(typeof input === "string" ? input : input?.url ?? input);
  if (/^https?:\/\/([^/]*\.)?familysearch\.org(\/|$|:)/.test(url)) familySearchRequests += 1;
  if (!url.endsWith("/v1/score")) return realFetch(input, init);
  const started = performance.now();
  const post: Post = { bytes: Buffer.byteLength(String(init?.body ?? "")), ms: 0, status: 0 };
  posts.push(post);
  const res = await realFetch(input, init);
  post.ms = Math.round(performance.now() - started);
  post.status = res.status;
  try {
    const body = (await res.clone().json()) as any;
    post.model = body?.model?.version;
    post.floors = body?.model?.cutoffs?.floors;
    post.jev = [...new Set<string>((body?.results ?? []).map((r: any) => r?.jev ?? (r?.error ? `error:${r.error.code}` : "?")))];
  } catch {
    // Not JSON: the status says what happened.
  }
  return res;
}) as typeof fetch;

/** Every committed record_search row that can be scored, each given its own id. */
function pageRows(n: number): any[] {
  const pool: any[] = [];
  for (const name of readdirSync(MCP_FIXTURES).sort()) {
    if (!name.startsWith("record-search-") || !name.endsWith(".json")) continue;
    const doc = JSON.parse(readFileSync(join(MCP_FIXTURES, name), "utf8"));
    for (const row of doc?.response?.results ?? []) {
      if (row?.gedcomx?.persons?.length && typeof row.primaryId === "string") pool.push(row);
    }
  }
  if (pool.length === 0) throw new Error("no committed record_search row carries a gedcomx");
  return Array.from({ length: n }, (_, i) => ({
    ...structuredClone(pool[i % pool.length]),
    recordId: `ark:/61903/1:1:SMK${String(i).padStart(3, "0")}-ROW`,
  }));
}

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "try-matcher-service-"));
  cpSync(SCENARIO, dir, { recursive: true });
  const tree = JSON.parse(readFileSync(join(dir, "tree.gedcomx.json"), "utf8"));
  tree.persons.push({ id: "I9", names: [{ preferred: true, given: "Wilhelm", surname: "Kunze" }] });
  writeFileSync(join(dir, "tree.gedcomx.json"), JSON.stringify(tree, null, 2), "utf8");
  return dir;
}

function sidecarRow(dir: string, ref: string): any {
  return JSON.parse(readFileSync(join(dir, ref), "utf8")).payload.results[0];
}

function scoreLog(dir: string): any[] {
  try {
    return readFileSync(join(dir, "results", "match-scores.jsonl"), "utf8")
      .split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures += 1;
}

async function step<T>(label: string, run: () => Promise<T>): Promise<{ value?: T; error?: Error }> {
  posts = [];
  console.log(`\n── ${label}`);
  const started = performance.now();
  try {
    const value = await run();
    console.log(`  duration ${Math.round(performance.now() - started)} ms`);
    return { value };
  } catch (e) {
    console.log(`  duration ${Math.round(performance.now() - started)} ms`);
    return { error: e instanceof Error ? e : new Error(String(e)) };
  } finally {
    for (const [i, p] of posts.entries()) {
      console.log(
        `  POST ${i + 1}: ${p.bytes} bytes, ${p.ms} ms, status ${p.status}` +
          (p.model ? `, model ${p.model}, floors ${JSON.stringify(p.floors)}, jev ${p.jev?.join("/")}` : ""),
      );
    }
  }
}

const dir = project();
try {
  console.log(`matcher service ${opts.url}; scenario flynn-record-matching; ${opts.badKey ? "wrong key" : opts.down ? "service down" : "caller's key"}`);
  const projectArm = () => samePerson({ projectPath: dir, assertionId: "a_001", treePersonId: "I1" }, principal);

  if (opts.badKey || opts.down) {
    const { error } = await step(`(${opts.badKey ? "f" : "g"}) same_person project arm`, projectArm);
    console.log(`  error: ${error?.message}`);
    check(error !== undefined, "the call failed rather than scoring");
    check(
      opts.badKey ? /\(401\)/.test(error?.message ?? "") : /Could not reach the matcher service/.test(error?.message ?? ""),
      opts.badKey ? "the 401 message" : "the unreachable message",
    );
    check(!(error?.message ?? "").includes(key), "the message does not hold the key");
  } else {
    // (a) a 100-row page
    const handle = await stageSearchResults({ projectPath: dir, tool: "record_search", response: { results: pageRows(PAGE) } });
    if (!handle) throw new Error("staging failed");
    const before = scoreLog(dir).length;
    const a = await step(`(a) rank_search_matches, ${PAGE} rows, subject I1`, () =>
      rankSearchMatches({ projectPath: dir, stagedResultsRef: handle.resultsRef, subjectId: "I1" }, principal),
    );
    if (a.error) throw a.error;
    const ranked = a.value!;
    const lines = scoreLog(dir).slice(before);
    console.log(`  scored ${ranked.scoredCount}, errors ${ranked.scoringErrors}, top scores ${ranked.matches.slice(0, 5).map((m) => m.matchScore).join(", ")}`);
    console.log(`  diagnostic: ${ranked.diagnostic ?? "(none)"}`);
    console.log(`  score log: ${lines.length} lines, scorer ${[...new Set(lines.map((l) => l.scorer))].join("/")}, model ${[...new Set(lines.map((l) => l.model))].join("/")}`);
    check(posts.length === 1, "one POST for the page");
    check(ranked.scoredCount === PAGE && ranked.scoringErrors === 0, `all ${PAGE} candidates scored`);
    check(lines.length === PAGE && lines.every((l) => l.scorer === "service" && typeof l.model === "string"), "every score-log line names the service and its model");
    check(lines.every((l) => !("match_confidence" in l)), "no score-log line carries match_confidence");
    check(ranked.matches.every((m) => !("matchConfidence" in m)), "no stub carries matchConfidence");

    // (b) a thin subject
    const thinHandle = await stageSearchResults({ projectPath: dir, tool: "record_search", response: { results: pageRows(10) } });
    if (!thinHandle) throw new Error("staging failed");
    const b = await step("(b) rank_search_matches, 10 rows, thin subject I9 (a name only)", () =>
      rankSearchMatches({ projectPath: dir, stagedResultsRef: thinHandle.resultsRef, subjectId: "I9" }, principal),
    );
    if (b.error) throw b.error;
    console.log(`  matches ${b.value!.matches.length}, subjectResolvable ${b.value!.subjectResolvable}`);
    console.log(`  diagnostic: ${b.value!.diagnostic ?? "(none)"}`);
    const floor = (posts[0]?.floors as any)?.thin_subject;
    check(b.value!.matches.length === 0 && b.value!.subjectResolvable === false, "the thin subject's ranking is withheld");
    check(typeof floor === "number" && (b.value!.diagnostic ?? "").includes(`at or below ${floor}.`), `diagnostic (a) quotes the service's thin_subject floor (${floor})`);

    // (c) the project arm, through the sidecar
    const c = await step("(c) same_person project arm: a_001 (1850 census, Patrick) against I1", projectArm);
    if (c.error) throw c.error;
    const entry = (await readMatchScores(dir, RECORD))?.scores["a_001|I1"];
    console.log(`  result ${JSON.stringify(c.value)}`);
    console.log(`  attestation: score ${entry?.score}, scorer ${entry?.scorer}, model ${entry?.model}, record_source ${entry?.record_source}`);
    check(posts.length === 1 && (c.value as any).recordSource === "record_read", "one POST; the record came from the sidecar");
    check(entry?.scorer === "service" && typeof entry?.model === "string" && entry?.score === (c.value as any).score, "the attestation names the service and its model");
    check(!("matched" in (c.value as object)) && !("confidence" in (c.value as object)), "no matched or confidence");

    // (d) project relatives
    const d = await step("(d) same_person project relatives, a_001 against I1", () =>
      samePerson({ projectPath: dir, assertionId: "a_001", treePersonId: "I1", matchRelatives: true }, principal),
    );
    if (d.error) throw d.error;
    console.log(`  result ${JSON.stringify(d.value)}`);
    check(posts.length === 1 && ((d.value as any).matches ?? []).length > 0, "one POST, relatives paired and scored");

    // (e) the explicit arm
    const rec1 = sidecarRow(dir, "results/log_001.json");
    const rec2 = sidecarRow(dir, "results/log_003.json");
    const e = await step("(e) same_person explicit arm: two 1850 census records, Patrick Flynn against Patrick Flinn", () =>
      samePerson({ gedcomx1: rec1.gedcomx, primaryId1: rec1.primaryId, gedcomx2: rec2.gedcomx, primaryId2: rec2.primaryId }, principal),
    );
    if (e.error) throw e.error;
    console.log(`  result ${JSON.stringify(e.value)}`);
    check(posts.length === 1 && Object.keys(e.value as object).join() === "score", "one POST; the answer is the score alone");
  }

  console.log(`\nrequests to FamilySearch: ${familySearchRequests}`);
  check(familySearchRequests === 0, "no request reached FamilySearch");
} finally {
  rmSync(dir, { recursive: true, force: true });
  globalThis.fetch = realFetch;
}
console.log(failures === 0 ? "\nPASS" : `\nFAIL: ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);

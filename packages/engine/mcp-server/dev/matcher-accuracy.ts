/// <reference types="node" />
/**
 * Matcher accuracy over the adjudicated record-hint e2e fixtures (issue #3553;
 * docs/specs/e2e-test-spec.md §3.6.2).
 *
 * Every resolved record-hint fixture's fixture.json carries
 * `"hint": {"persona_ark": "ark:/61903/1:1:…", "identity": "same" | "different" | "unresolved"}`
 * or an explicit `"hint": null`. `identity` is the genealogist's judgement of
 * whether that record persona is the tree person (`source_pid`) — never the
 * /resolve-record-hint outcome number. `same` is a true pair (label 1),
 * `different` a false one (label 0). `unresolved`, `null`, an absent key and a
 * draft (README still carrying DRAFT PENDING ADJUDICATION) are skipped and
 * counted by reason.
 *
 * Each pair is scored through `scorePair` (src/utils/match-engine.ts) — the
 * function `same_person` calls. There is no second scoring path here.
 *
 *   tree side    the fixture's frozen starting-tree.gedcomx.json anchored on
 *                source_pid, cut to the `Mob.matchSubset()` mob same_person sends
 *   record side  record_read of hint.persona_ark, anchored on the persons[].id
 *                whose ark IS that persona (never persons[0])
 *
 * same_person also drops the tree facts sourced only from the scored record
 * (`withoutRecordSourced`, walking research.json's assertions). This script
 * does not, so a fixture whose starting-research.json holds any assertion is a
 * per-fixture error rather than a score that is not same_person's.
 *
 * Reports the AUC (Mann-Whitney, ties count half), the confusion table at the
 * person-evidence bands (>0.7 strong, >0.4 moderate or better), the pairs those
 * bands misrank, and every per-fixture error. Exits 1 when the AUC is below
 * MIN_AUC (environment, default 0.65), when nothing was scored, or when any
 * record-hint fixture could not be scored; exits 2 on a usage error. The check
 * is a floor, not a pinned value, and there is no committed baseline: the label
 * set grows with every resolved hint.
 *
 * Record documents are cached as JSON in dev/.matcher-cache/<bare-id>.json,
 * which is gitignored: they are FamilySearch record payloads and are never
 * committed. --refresh ignores the cache and re-fetches.
 *
 * Needs a FamilySearch session (`make e2e-login`). Not shipped in any artifact.
 *
 * Usage:
 *   npx tsx dev/matcher-accuracy.ts [--refresh] [--csv <path>]
 *   MIN_AUC=0.7 npx tsx dev/matcher-accuracy.ts
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LOCAL } from "../src/auth/principal.js";
import { getValidToken } from "../src/auth/refresh.js";
import { recordReadTool } from "../src/tools/record-read.js";
import { scorePair } from "../src/utils/match-engine.js";
import { Mob } from "../src/utils/mob.js";
import { mapWithConcurrency, withRetry } from "../src/utils/place-resolver.js";
import { arkToBareId, toArk } from "../src/utils/ark.js";
import type { SimplifiedGedcomX } from "../src/types/gedcomx.js";
import type { SamePersonResult } from "../src/types/same-person.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "..", "..", "..", "..");
export const FIXTURES_DIR = join(REPO_ROOT, "eval", "tests", "e2e");
export const CACHE_DIR = join(HERE, ".matcher-cache");

export const DEFAULT_MIN_AUC = 0.65;
/** person-evidence's bands: `>0.7` strong, `0.4–0.7` moderate, `<0.4` weak. */
export const STRONG_CUT = 0.7;
export const WEAK_CUT = 0.4;
const CONCURRENCY = 4;
const DRAFT_MARKER = "DRAFT PENDING ADJUDICATION";
// Mirrors `_PERSONA_ARK_RE` in eval/harness/e2e/validate_fixture.py, which
// rejects a malformed hint in CI; this copy only refuses to score one.
const PERSONA_ARK_RE = /^ark:\/61903\/1:1:[A-Z0-9]{4}-[A-Z0-9]{2,4}$/;
const IDENTITIES = ["same", "different", "unresolved"] as const;
const HINT_KEYS = ["persona_ark", "identity"] as const;

class UsageError extends Error {}

// ─── Pure math ───────────────────────────────────────────────────────────────

export interface ScoredPair {
  slug: string;
  /** 1 = the genealogist judged the hint persona the tree person. */
  label: 0 | 1;
  score: number;
}

function assertFiniteScores(pairs: readonly ScoredPair[]): void {
  for (const p of pairs) {
    if (!Number.isFinite(p.score)) {
      throw new RangeError(`pair '${p.slug}' has a non-finite score (${p.score})`);
    }
  }
}

/**
 * Area under the ROC curve as the Mann-Whitney statistic: the share of
 * (true, false) pairs in which the true pair scores higher, a tie counting
 * half. Null when either class is empty, where it is undefined.
 */
export function auc(pairs: readonly ScoredPair[]): number | null {
  assertFiniteScores(pairs);
  const pos = pairs.filter((p) => p.label === 1).map((p) => p.score);
  const neg = pairs.filter((p) => p.label === 0).map((p) => p.score);
  if (pos.length === 0 || neg.length === 0) return null;
  let wins = 0;
  for (const s of pos) {
    for (const t of neg) {
      if (s > t) wins += 1;
      else if (s === t) wins += 0.5;
    }
  }
  return wins / (pos.length * neg.length);
}

export interface Confusion {
  cut: number;
  tp: number;
  fn: number;
  fp: number;
  tn: number;
}

/** Confusion counts with a pair predicted "same" when its score is strictly above `cut`. */
export function confusion(pairs: readonly ScoredPair[], cut: number): Confusion {
  assertFiniteScores(pairs);
  const out: Confusion = { cut, tp: 0, fn: 0, fp: 0, tn: 0 };
  for (const p of pairs) {
    const predicted = p.score > cut;
    if (p.label === 1) {
      if (predicted) out.tp += 1;
      else out.fn += 1;
    } else if (predicted) out.fp += 1;
    else out.tn += 1;
  }
  return out;
}

export interface Misranked {
  /** True pairs in the weak band (score below `weakCut`), lowest first. */
  weakTrue: ScoredPair[];
  /** False pairs in the strong band (score above `strongCut`), highest first. */
  strongFalse: ScoredPair[];
}

export function misranked(
  pairs: readonly ScoredPair[],
  weakCut: number = WEAK_CUT,
  strongCut: number = STRONG_CUT,
): Misranked {
  assertFiniteScores(pairs);
  return {
    weakTrue: pairs
      .filter((p) => p.label === 1 && p.score < weakCut)
      .sort((a, b) => a.score - b.score),
    strongFalse: pairs
      .filter((p) => p.label === 0 && p.score > strongCut)
      .sort((a, b) => b.score - a.score),
  };
}

/** The floor: an undefined AUC never clears it. */
export function passesFloor(value: number | null, minAuc: number): boolean {
  return value !== null && value >= minAuc;
}

export function parseMinAuc(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_MIN_AUC;
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new UsageError(`MIN_AUC must be a number from 0 to 1, got ${JSON.stringify(raw)}.`);
  }
  return value;
}

// ─── Fixture classification ──────────────────────────────────────────────────

export type Identity = (typeof IDENTITIES)[number];
export type SkipReason = "draft" | "no-hint" | "hint-absent" | "unresolved";

export type Classified =
  | { kind: "scored"; label: 0 | 1; identity: Identity; personaArk: string }
  | { kind: "skipped"; reason: SkipReason }
  | { kind: "error"; message: string };

/** What one record-hint fixture contributes, from its fixture.json and README. */
export function classifyFixture(
  meta: Record<string, unknown>,
  readme: string | null,
): Classified {
  if (readme !== null && readme.includes(DRAFT_MARKER)) {
    return { kind: "skipped", reason: "draft" };
  }
  if (!("hint" in meta)) return { kind: "skipped", reason: "hint-absent" };
  const hint = meta.hint;
  if (hint === null) return { kind: "skipped", reason: "no-hint" };
  if (typeof hint !== "object" || Array.isArray(hint)) {
    return { kind: "error", message: `hint must be an object or null, got ${JSON.stringify(hint)}` };
  }
  const fields = hint as Record<string, unknown>;
  const { persona_ark: personaArk, identity } = fields;
  const problems: string[] = [];
  const unknown = Object.keys(fields)
    .filter((k) => !(HINT_KEYS as readonly string[]).includes(k))
    .sort();
  if (unknown.length > 0) {
    problems.push(
      `hint has unrecognized field(s) ${unknown.map((k) => JSON.stringify(k)).join(", ")} ` +
        `(only ${HINT_KEYS.join(", ")} are defined)`,
    );
  }
  if (typeof personaArk !== "string" || !PERSONA_ARK_RE.test(personaArk)) {
    problems.push(
      `hint.persona_ark must be a full 1:1: record-persona ark, got ${JSON.stringify(personaArk)} ` +
        "(not a 1:2: record ark, a 3:1:/3:2: image ark, a bare id or a tree PID)",
    );
  }
  if (typeof identity !== "string" || !(IDENTITIES as readonly string[]).includes(identity)) {
    problems.push(
      `hint.identity must be one of ${IDENTITIES.join(", ")}, got ${JSON.stringify(identity)} ` +
        "(the identity judgement, never the outcome number)",
    );
  }
  if (problems.length > 0) return { kind: "error", message: problems.join("; ") };
  if (identity === "unresolved") return { kind: "skipped", reason: "unresolved" };
  return {
    kind: "scored",
    label: identity === "same" ? 1 : 0,
    identity: identity as Identity,
    personaArk: personaArk as string,
  };
}

/**
 * Why a fixture's starting-research.json keeps it from being scored, or null.
 * same_person strips the tree facts sourced only from the scored record
 * (`withoutRecordSourced`) by walking research.json's assertions; this script
 * scores the tree as frozen, so any assertion would make its score not
 * same_person's. An absent file holds no assertions.
 */
export function researchProblem(research: unknown): string | null {
  if (research === null || typeof research !== "object" || Array.isArray(research)) {
    return "starting-research.json is not a JSON object";
  }
  if (!("assertions" in research)) return null;
  const assertions = (research as Record<string, unknown>).assertions;
  if (!Array.isArray(assertions)) {
    return `starting-research.json assertions must be a list, got ${JSON.stringify(assertions)}`;
  }
  if (assertions.length === 0) return null;
  return (
    `starting-research.json holds ${assertions.length} assertion(s): same_person would strip the ` +
    "tree facts sourced only from the hinted record (withoutRecordSourced) and this script does not, " +
    "so its score would not be same_person's"
  );
}

/**
 * The persons[].id of the record persona `personaArk` names. Throws when no
 * persona carries that ark, or more than one does. There is no fallback to
 * persons[0]: matchTwoExamples scores the document's first person, and scoring
 * whichever persona happened to come first is what held the AUC at chance.
 */
export function personaIdFor(doc: SimplifiedGedcomX, personaArk: string): string {
  const wanted = toArk(personaArk).toLowerCase();
  const hits = (doc.persons ?? []).filter(
    (p) => typeof p.ark === "string" && toArk(p.ark).toLowerCase() === wanted,
  );
  const ids = [...new Set(hits.map((p) => p.id).filter((id): id is string => typeof id === "string" && id !== ""))];
  if (ids.length === 1) return ids[0];
  const present = (doc.persons ?? [])
    .map((p) => `${p.id ?? "(no id)"}=${p.ark ?? "(no ark)"}`)
    .join(", ");
  if (hits.length === 0) {
    throw new Error(`no persona in the record document carries ${personaArk} (persons: ${present || "none"})`);
  }
  throw new Error(`${personaArk} names ${hits.length} personas without one id (persons: ${present})`);
}

// ─── Record documents (cached) ───────────────────────────────────────────────

export function cachePath(cacheDir: string, personaArk: string): string {
  return join(cacheDir, `${arkToBareId(personaArk)}.json`);
}

export async function recordDocument(
  personaArk: string,
  opts: { refresh: boolean; cacheDir: string; fetchRecord: (ark: string) => Promise<SimplifiedGedcomX> },
): Promise<{ doc: SimplifiedGedcomX; cached: boolean }> {
  const path = cachePath(opts.cacheDir, personaArk);
  if (!opts.refresh && existsSync(path)) {
    try {
      return { doc: JSON.parse(readFileSync(path, "utf8")) as SimplifiedGedcomX, cached: true };
    } catch {
      // A truncated or hand-edited cache file is a miss, not an error.
    }
  }
  const doc = await opts.fetchRecord(personaArk);
  mkdirSync(opts.cacheDir, { recursive: true });
  writeFileSync(path, JSON.stringify(doc, null, 2) + "\n", "utf8");
  return { doc, cached: false };
}

// ─── Run ─────────────────────────────────────────────────────────────────────

export interface Deps {
  fixturesDir: string;
  cacheDir: string;
  fetchRecord: (ark: string) => Promise<SimplifiedGedcomX>;
  score: (
    gedcomx1: SimplifiedGedcomX,
    id1: string,
    gedcomx2: SimplifiedGedcomX,
    id2: string,
  ) => Promise<SamePersonResult>;
  ensureLogin: () => Promise<void>;
  log: (line: string) => void;
}

export const liveDeps: Deps = {
  fixturesDir: FIXTURES_DIR,
  cacheDir: CACHE_DIR,
  fetchRecord: async (ark) =>
    (await recordReadTool({ recordId: ark }, LOCAL)) as unknown as SimplifiedGedcomX,
  score: (g1, id1, g2, id2) => withRetry(() => scorePair(g1, id1, g2, id2, LOCAL)),
  ensureLogin: async () => {
    await getValidToken(LOCAL);
  },
  log: (line) => console.log(line),
};

interface PairRow extends ScoredPair {
  identity: Identity;
  personaArk: string;
  personaId: string;
  matched: boolean;
  confidence?: number;
}

export function parseArgs(argv: string[]): { refresh: boolean; csv: string | null } {
  let refresh = false;
  let csv: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--refresh") refresh = true;
    else if (arg === "--csv") {
      const value = argv[++i];
      if (value === undefined || value.trim() === "" || value.startsWith("--")) {
        throw new UsageError("--csv needs an output path.");
      }
      csv = value;
    } else {
      throw new UsageError(`unknown argument ${JSON.stringify(arg)}.`);
    }
  }
  return { refresh, csv };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function csvCell(value: unknown): string {
  const s = value === undefined || value === null ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const fmt = (n: number | null): string => (n === null ? "undefined" : n.toFixed(3));

export async function main(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
  deps: Deps = liveDeps,
): Promise<number> {
  const { log } = deps;
  let args: { refresh: boolean; csv: string | null };
  let minAuc: number;
  try {
    args = parseArgs(argv);
    minAuc = parseMinAuc(env.MIN_AUC);
  } catch (e) {
    if (e instanceof UsageError) {
      log(`matcher-accuracy: ${e.message}`);
      log("usage: npx tsx dev/matcher-accuracy.ts [--refresh] [--csv <path>]   (env MIN_AUC, default 0.65)");
      return 2;
    }
    throw e;
  }

  const skipped = new Map<SkipReason, string[]>();
  const errors: Array<{ slug: string; message: string }> = [];
  const candidates: Array<{ slug: string; dir: string; sourcePid: string; c: Extract<Classified, { kind: "scored" }> }> = [];
  let total = 0;

  for (const slug of readdirSync(deps.fixturesDir).sort()) {
    const dir = join(deps.fixturesDir, slug);
    const fixturePath = join(dir, "fixture.json");
    if (!existsSync(fixturePath)) continue;
    let meta: Record<string, unknown>;
    try {
      meta = readJson(fixturePath) as Record<string, unknown>;
    } catch (e) {
      errors.push({ slug, message: `fixture.json does not parse: ${(e as Error).message}` });
      continue;
    }
    if (meta?.genre !== "record-hint") continue;
    total += 1;
    const readmePath = join(dir, "README.md");
    const readme = existsSync(readmePath) ? readFileSync(readmePath, "utf8") : null;
    const c = classifyFixture(meta, readme);
    if (c.kind === "skipped") {
      skipped.set(c.reason, [...(skipped.get(c.reason) ?? []), slug]);
    } else if (c.kind === "error") {
      errors.push({ slug, message: c.message });
    } else if (typeof meta.source_pid !== "string" || meta.source_pid === "") {
      errors.push({ slug, message: "fixture.json has no source_pid" });
    } else {
      const researchPath = join(dir, "starting-research.json");
      let problem: string | null = null;
      if (existsSync(researchPath)) {
        try {
          problem = researchProblem(readJson(researchPath));
        } catch (e) {
          problem = `starting-research.json does not parse: ${(e as Error).message}`;
        }
      }
      if (problem !== null) errors.push({ slug, message: problem });
      else candidates.push({ slug, dir, sourcePid: meta.source_pid, c });
    }
  }

  if (candidates.length > 0) {
    try {
      await deps.ensureLogin();
    } catch (e) {
      log(`matcher-accuracy: needs a FamilySearch session — run \`make e2e-login\`. (${(e as Error).message})`);
      return 1;
    }
  }

  let fetched = 0;
  let fromCache = 0;
  const rows = await mapWithConcurrency(candidates, CONCURRENCY, async ({ slug, dir, sourcePid, c }) => {
    try {
      const tree = readJson(join(dir, "starting-tree.gedcomx.json")) as SimplifiedGedcomX;
      // No withoutRecordSourced step: researchProblem refused every fixture
      // whose starting-research.json holds an assertion, so there is nothing to drop.
      const gedcomx2 = new Mob(tree, sourcePid).matchSubset().gedcomx;
      const { doc: gedcomx1, cached } = await recordDocument(c.personaArk, {
        refresh: args.refresh,
        cacheDir: deps.cacheDir,
        fetchRecord: deps.fetchRecord,
      });
      if (cached) fromCache += 1;
      else fetched += 1;
      const personaId = personaIdFor(gedcomx1, c.personaArk);
      const result = await deps.score(gedcomx1, personaId, gedcomx2, sourcePid);
      if (!Number.isFinite(result.score)) {
        throw new Error(`matchTwoExamples returned a non-finite score (${result.score})`);
      }
      const row: PairRow = {
        slug,
        label: c.label,
        score: result.score,
        identity: c.identity,
        personaArk: c.personaArk,
        personaId,
        matched: result.matched,
        ...(result.confidence !== undefined ? { confidence: result.confidence } : {}),
      };
      return row;
    } catch (e) {
      errors.push({ slug, message: e instanceof Error ? e.message : String(e) });
      return null;
    }
  });
  const pairs = rows.filter((r): r is PairRow => r !== null);

  const nSame = pairs.filter((p) => p.label === 1).length;
  const nSkipped = [...skipped.values()].reduce((n, s) => n + s.length, 0);
  log(`matcher-accuracy: ${total} record-hint fixtures`);
  log(`  scored   ${pairs.length} (same ${nSame}, different ${pairs.length - nSame}; records fetched ${fetched}, cached ${fromCache})`);
  log(`  skipped  ${nSkipped}`);
  for (const reason of ["unresolved", "no-hint", "hint-absent", "draft"] as const) {
    const slugs = skipped.get(reason) ?? [];
    if (slugs.length > 0) log(`    ${reason} ${slugs.length}: ${slugs.join(", ")}`);
  }
  log(`  errors   ${errors.length}${errors.length > 0 ? " (NOT scored — see below)" : ""}`);

  const value = auc(pairs);
  log("");
  log(`AUC ${fmt(value)} (Mann-Whitney, ties = 0.5); floor MIN_AUC = ${minAuc}`);
  log("");
  log("confusion        TP   FN   FP   TN");
  for (const cut of [STRONG_CUT, WEAK_CUT]) {
    const m = confusion(pairs, cut);
    const cell = (n: number) => String(n).padStart(4);
    log(`  score > ${cut}  ${cell(m.tp)} ${cell(m.fn)} ${cell(m.fp)} ${cell(m.tn)}`);
  }
  const mis = misranked(pairs);
  log("");
  log(`misranked: true pairs below ${WEAK_CUT} ${mis.weakTrue.length}, false pairs above ${STRONG_CUT} ${mis.strongFalse.length}`);
  for (const p of mis.weakTrue) log(`  same       ${p.score.toFixed(4)}  ${p.slug}`);
  for (const p of mis.strongFalse) log(`  different  ${p.score.toFixed(4)}  ${p.slug}`);
  if (errors.length > 0) {
    log("");
    log("errors:");
    for (const e of errors.sort((a, b) => a.slug.localeCompare(b.slug))) log(`  ${e.slug}: ${e.message}`);
  }

  if (args.csv !== null) {
    const header = ["slug", "identity", "label", "persona_ark", "persona_id", "score", "matched", "confidence"];
    const lines = [header.join(",")].concat(
      pairs.map((p) =>
        [p.slug, p.identity, p.label, p.personaArk, p.personaId, p.score, p.matched, p.confidence]
          .map(csvCell)
          .join(","),
      ),
    );
    writeFileSync(resolve(args.csv), lines.join("\n") + "\n", "utf8");
    log("");
    log(`wrote ${pairs.length} rows to ${resolve(args.csv)}`);
  }

  log("");
  if (pairs.length === 0) {
    log("FAIL: nothing was scored.");
    return 1;
  }
  let failed = false;
  if (errors.length > 0) {
    log(`FAIL: ${errors.length} record-hint fixture(s) could not be scored; the AUC above covers only the rest.`);
    failed = true;
  }
  if (!passesFloor(value, minAuc)) {
    log(
      value === null
        ? "FAIL: AUC is undefined — it needs at least one same and one different pair."
        : `FAIL: AUC ${fmt(value)} is below MIN_AUC ${minAuc}.`,
    );
    failed = true;
  }
  if (failed) return 1;
  log(`PASS: AUC ${fmt(value)} >= MIN_AUC ${minAuc}.`);
  return 0;
}

if (process.argv[1]?.endsWith("matcher-accuracy.ts")) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error(e);
      process.exitCode = 1;
    },
  );
}

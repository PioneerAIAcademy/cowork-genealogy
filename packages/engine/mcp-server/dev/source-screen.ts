/**
 * Source screen, steps 1 and 2's data side (issue #3408, plan comment of
 * 2026-10-14). Four subcommands:
 *
 *   snapshot --pids <file> --out <dir> [--sample N] [--seed S] [--no-same-person]
 *   baseline --snapshot <dir> [--threshold T]
 *   plant    --spec <file> --out <dir> [--no-same-person]
 *   score    --spec <file> --findings <jsonl> [--findings <jsonl> ...]
 *
 * `snapshot` and `plant` are the only network stages; `baseline` and `score`
 * read files. The truth set is restricted: every path argument must lie outside
 * the repo, except `--spec`, the committed fixture spec. Report counts only.
 *
 * Needs a FamilySearch session (`make e2e-login`) for `snapshot` and `plant`.
 * Not shipped in any artifact.
 *
 * Usage: npx tsx dev/source-screen.ts <subcommand> [flags]
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  cpSync,
  writeFileSync,
} from "fs";
import { dirname, isAbsolute, join, relative, resolve, basename, sep } from "path";
import { fileURLToPath } from "url";
import { localPrincipal, type Principal } from "../src/auth/principal.js";
import { personReadTool } from "../src/tools/person-read.js";
import { recordReadTool } from "../src/tools/record-read.js";
import { sourceAttachmentsTool } from "../src/tools/source-attachments.js";
import { restoreSwitchedSessionTrees } from "../src/utils/session-tree.js";
import { personQualityTool } from "../src/tools/person-quality.js";
import { personWarningsTool } from "../src/tools/person-warnings.js";
import { samePerson } from "../src/tools/same-person.js";
import { sanitizeTree } from "../src/validation/tree-sanitize.js";
import { arkToBareId, toArk } from "../src/utils/ark.js";
import { fsFetch } from "../src/utils/fs-fetch.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";
import type { PersonReadResult, TreeSource } from "../src/types/person-read.js";
import type { SourceAttachmentsResult } from "../src/types/source-attachments.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
export const SPEC_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "source-screen-fixtures.json");

// ─── paths ──────────────────────────────────────────────────────────────────

function real(p: string): string {
  const abs = resolve(p);
  // A path that does not exist yet is judged by its nearest existing ancestor,
  // so a symlink out of (or into) the repo is followed either way.
  let probe = abs;
  const tail: string[] = [];
  while (!existsSync(probe) && dirname(probe) !== probe) {
    tail.unshift(basename(probe));
    probe = dirname(probe);
  }
  return join(realpathSync.native(probe), ...tail);
}

export function isInsideRepo(p: string, repoRoot = REPO_ROOT): boolean {
  const rel = relative(real(repoRoot), real(p));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** Refuse a path argument inside the repo; `--spec` may only be the committed spec. */
export function guardPath(flag: string, p: string, repoRoot = REPO_ROOT): string {
  if (typeof p !== "string" || p.trim() === "") throw new Error(`${flag} is required`);
  if (flag === "--spec") {
    if (real(p) === real(SPEC_PATH) || !isInsideRepo(p, repoRoot)) return resolve(p);
    throw new Error(`--spec inside the repo must be the committed spec ${relative(repoRoot, SPEC_PATH)}`);
  }
  if (isInsideRepo(p, repoRoot)) {
    throw new Error(`${flag} ${p} is inside the repo; truth-set data must stay outside it`);
  }
  return resolve(p);
}

// ─── copy keys ──────────────────────────────────────────────────────────────

export const unplantedKey = (hostId: string) => `${hostId}.unplanted`;

// ─── audit list ─────────────────────────────────────────────────────────────

/** `tree_person`: a `4:1:` link to another Family Tree person. `compiled_tree`: a `2:2:`/`2:3:` user-submitted tree entry. */
export type AuditClass = "persona" | "record_only" | "tree_person" | "compiled_tree" | "no_index";
export type AuditLevel = "subject" | "relationship";

export interface AuditEntry {
  /** The `toArk()` ARK, or `source:<id>` for a source with no ARK. */
  key: string;
  ark: string | null;
  source_ids: string[];
  title?: string;
  level: AuditLevel;
  class: AuditClass;
}

export interface AuditList {
  subject_id: string;
  living: boolean;
  entries: AuditEntry[];
}

export function classifyArk(ark: string | null): AuditClass {
  if (ark && /^ark:\/61903\/1:1:/.test(ark)) return "persona";
  if (ark && /^ark:\/61903\/1:2:/.test(ark)) return "record_only";
  if (ark && /^ark:\/61903\/4:1:[A-Z0-9]{4}-[A-Z0-9]{3,4}$/.test(ark)) return "tree_person";
  if (ark && /^ark:\/61903\/2:[23]:/.test(ark)) return "compiled_tree";
  return "no_index";
}

/** The Family Tree person id in a `4:1:` ARK. */
export const treePersonId = (ark: string) => ark.split("4:1:")[1];
/** Cache file name for a compiled-tree ARK: the two id spaces are kept apart. */
export const compiledTreeFile = (ark: string) => `${ark.replace(/^ark:\/61903\//, "").replace(/:/g, "-")}.json`;

/**
 * The sources this person's audit covers: the subject's own refs, sources on
 * every relationship the subject is an endpoint of, and any memory
 * (`artifact_url`). Relatives' own sources are not the subject's. Level is
 * decided per ARK, not per description id, because two descriptions can carry
 * one URL: `subject` wins whenever any description of that ARK is the
 * subject's own or a memory.
 */
export function buildAuditList(read: PersonReadResult): AuditList {
  const subject = read.persons?.[0];
  if (!subject) throw new Error("person_read returned no persons");
  const sid = subject.id;
  const byId = new Map((read.sources ?? []).map((s) => [s.id, s]));
  const subjectRefs = new Set((subject.sources ?? []).map((r) => r.ref));
  const relRefs = new Set<string>();
  for (const r of read.relationships ?? []) {
    if (![r.parent, r.child, r.person1, r.person2].includes(sid)) continue;
    for (const ref of r.sources ?? []) relRefs.add(ref.ref);
  }
  const memoryIds = (read.sources ?? []).filter((s) => s.artifact_url).map((s) => s.id);
  const entries = new Map<string, AuditEntry>();
  for (const id of new Set([...relRefs, ...subjectRefs, ...memoryIds])) {
    const src: TreeSource | undefined = byId.get(id);
    if (!src) continue;
    const ark = src.url ? toArk(src.url) : "";
    const hasArk = /^ark:\/61903\//.test(ark);
    const key = hasArk ? ark : `source:${id}`;
    const level: AuditLevel = subjectRefs.has(id) || src.artifact_url ? "subject" : "relationship";
    const prev = entries.get(key);
    if (prev) {
      prev.source_ids.push(id);
      if (level === "subject") prev.level = "subject";
      continue;
    }
    entries.set(key, {
      key,
      ark: hasArk ? ark : null,
      source_ids: [id],
      ...(src.title ? { title: src.title } : {}),
      level,
      class: classifyArk(hasArk ? ark : null),
    });
  }
  return { subject_id: sid, living: subject.living === true, entries: [...entries.values()] };
}

// ─── errors ─────────────────────────────────────────────────────────────────

export type ErrorClass = "transient" | "permanent" | "stop";

const STOP_PATTERNS = [/rate limit/i, /Retry-After/i, /login tool/i, /API error: 429\b/];
const PERMANENT_PATTERNS = [
  /was not found in FamilySearch historical records/i,
  /FamilySearch recapi error: 410\b/,
  /is restricted and cannot be viewed/i,
  /not found in the FamilySearch Family Tree/i,
  /has been deleted from the FamilySearch Family Tree/i,
  /is tombstoned in the FamilySearch tree/i,
  /No quality scores found for person .*not found or not visible/i,
  /no persona matching the ARK/i,
  /Compiled tree entry .* was not found/i,
];

/** Unknown messages are transient: a pattern we miss costs a retry, never a corrupt snapshot. */
export function classifyError(message: string): ErrorClass {
  if (STOP_PATTERNS.some((re) => re.test(message))) return "stop";
  if (PERMANENT_PATTERNS.some((re) => re.test(message))) return "permanent";
  return "transient";
}

const RELATIONSHIP_NOTE = /^(\d+) of \d+ source descriptions cited by relationships could not be read/;

/** The subject read's relationship-sources note marks a partial read (transient);
 *  the relatives' note does not. Returns the unread count, or null. */
export function relationshipNoteCount(notes: readonly string[] | undefined): number | null {
  for (const n of notes ?? []) {
    const m = RELATIONSHIP_NOTE.exec(n);
    if (m) return Number(m[1]);
  }
  return null;
}

export class StopRun extends Error {}

export const MAX_ATTEMPTS = 3;

// ─── tools ──────────────────────────────────────────────────────────────────

export interface Tools {
  personRead(personId: string): Promise<PersonReadResult>;
  recordRead(ark: string): Promise<Json>;
  sourceAttachments(uris: string[]): Promise<SourceAttachmentsResult>;
  personQuality(personId: string): Promise<Json>;
  personWarnings(projectPath: string, personId: string): Promise<Json>;
  samePerson(input: Json): Promise<Json>;
  /** A `2:2:`/`2:3:` compiled-tree entry, read from its ARK URL (record_read refuses these). */
  compiledTreeRead(ark: string): Promise<Json>;
}

/** GET a compiled-tree ARK as GedcomX. */
export async function fetchCompiledTree(ark: string, principal: Principal): Promise<Json> {
  const res = await fsFetch(principal, `https://www.familysearch.org/${ark}`, {
    headers: { Accept: "application/x-gedcomx-v1+json", "User-Agent": BROWSER_USER_AGENT },
  });
  if (res.status === 404 || res.status === 410) throw new Error(`Compiled tree entry ${ark} was not found (${res.status}).`);
  if (res.status === 429) throw new Error("FamilySearch rate limit reached on a compiled tree read.");
  if (!res.ok) throw new Error(`FamilySearch compiled tree read failed: ${res.status} ${res.statusText}.`);
  return res.json();
}

/** An empty OpenRouter key: person_read then transcribes no memory scan, so no
 *  restricted image goes to OpenRouter. */
export function liveTools(principal: Principal = localPrincipal({ openRouterApiKey: "" }), tree?: string): Tools {
  return {
    personRead: (personId) => personReadTool({ personId }, principal),
    recordRead: (ark) => recordReadTool({ recordId: ark }, principal),
    sourceAttachments: (uris) => sourceAttachmentsTool({ uris }, principal, { treeId: tree }),
    personQuality: (personId) => personQualityTool({ personId, detail: true }, principal),
    personWarnings: (projectPath, personId) =>
      personWarningsTool({ projectPath, personId }, { placeCoords: async () => null }),
    samePerson: (input) => samePerson(input, principal),
    compiledTreeRead: (ark) => fetchCompiledTree(ark, principal),
  };
}

// ─── json io ────────────────────────────────────────────────────────────────

export const readJson = (p: string): Json => JSON.parse(readFileSync(p, "utf8"));
export function writeJson(p: string, v: unknown): void {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(v, null, 2) + "\n", "utf8");
}
const readJsonIf = (p: string): Json | undefined => (existsSync(p) ? readJson(p) : undefined);

// ─── run state ──────────────────────────────────────────────────────────────

export interface RunJson {
  created: string;
  sample: number | null;
  seed: number;
  input_count: number;
  draw: string[];
  /** input PID -> copy key. */
  map: Record<string, string>;
  /** Copies `plant` added: copy key -> what it is. */
  plants?: Record<string, { fixture_id?: string; host: string; type?: string }>;
}

/** Every copy `baseline`, the judge and `score` read: from the map, never the directory listing. */
export function listCopies(run: RunJson): string[] {
  return [...new Set([...Object.values(run.map ?? {}), ...Object.keys(run.plants ?? {})])];
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededSample<T>(items: readonly T[], n: number | null, seed: number): T[] {
  const a = [...items];
  const rnd = mulberry32(seed);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return n === null ? a : a.slice(0, n);
}

export interface Ledger {
  started: string;
  finished?: string;
  calls: Record<string, number>;
  fetched: number;
  skipped: number;
  errored: number;
  merged: number;
  living: number;
  final_with_errors: number;
  stopped?: string;
}

const newLedger = (): Ledger => ({
  started: new Date().toISOString(),
  calls: {},
  fetched: 0,
  skipped: 0,
  errored: 0,
  merged: 0,
  living: 0,
  final_with_errors: 0,
});

// ─── snapshot ───────────────────────────────────────────────────────────────

export interface Ctx {
  out: string;
  tools: Tools;
  samePerson: boolean;
  ledger: Ledger;
}

interface CallError {
  tool: string;
  key?: string;
  error: string;
  class: ErrorClass;
}

const personsDir = (out: string, key: string) => join(out, "persons", key);
const sharedRecordPath = (out: string, id: string) => join(out, "records", `${id}.json`);

/** A copy's own records/ first (an indexing plant), then the shared cache. */
export function readRecord(out: string, copyKey: string, id: string): Json | undefined {
  return readJsonIf(join(personsDir(out, copyKey), "records", `${id}.json`)) ?? readJsonIf(sharedRecordPath(out, id));
}

/** The record's persona whose ARK is the source's. */
export function personaFor(record: Json, ark: string): Json | undefined {
  return (record?.persons ?? []).find((p: Json) => typeof p?.ark === "string" && toArk(p.ark) === ark);
}

/** The record as `same_person` takes it: response-only keys dropped. */
function recordGedcomx(record: Json): Json {
  const { imageArk: _a, viewerUrl: _v, staged: _s, stagingError: _e, ...gx } = record ?? {};
  return gx;
}

async function call<T>(
  ctx: Ctx,
  calls: Record<string, number>,
  errors: CallError[],
  tool: string,
  key: string | undefined,
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: string; class: ErrorClass }> {
  calls[tool] = (calls[tool] ?? 0) + 1;
  ctx.ledger.calls[tool] = (ctx.ledger.calls[tool] ?? 0) + 1;
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const cls = classifyError(error);
    if (cls === "stop") throw new StopRun(error);
    errors.push({ tool, ...(key ? { key } : {}), error, class: cls });
    return { ok: false, error, class: cls };
  }
}

const errorBody = (error: string) => ({ error, is_error: true });

/** `attachments.json`, then `others/` for each other person a subject-level persona is attached to. */
async function snapshotAttachments(
  ctx: Ctx,
  calls: Record<string, number>,
  errors: CallError[],
  dir: string,
  personas: AuditEntry[],
  sid: string,
  inputPid: string,
): Promise<SourceAttachmentsResult | undefined> {
  if (personas.length === 0) return undefined;
  const a = await call(ctx, calls, errors, "source_attachments", undefined, () =>
    ctx.tools.sourceAttachments(personas.map((e) => e.ark!)),
  );
  writeJson(join(dir, "attachments.json"), a.ok ? a.value : errorBody(a.error));
  if (!a.ok) return undefined;
  const others = new Set<string>();
  for (const e of personas.filter((p) => p.level === "subject")) {
    for (const p of a.value.attachments?.[e.ark!] ?? []) {
      if (p.personId !== sid && p.personId !== inputPid) others.add(p.personId);
    }
  }
  for (const other of others) {
    const path = join(dir, "others", `${other}.json`);
    const have = readJsonIf(path);
    if (have && !have.is_error) continue;
    const o = await call(ctx, calls, errors, "person_read", other, () => ctx.tools.personRead(other));
    writeJson(path, o.ok ? o.value : errorBody(o.error));
  }
  return a.value;
}

const compiledTreePath = (out: string, ark: string) => join(out, "trees", compiledTreeFile(ark));

/**
 * Subject-level tree links: each `4:1:` person into `others/` (person_read),
 * each `2:2:`/`2:3:` entry into the shared `trees/` cache (its ARK URL). A read
 * already on disk is reused.
 */
async function snapshotTreeSources(
  ctx: Ctx,
  calls: Record<string, number>,
  errors: CallError[],
  dir: string,
  entries: AuditEntry[],
): Promise<void> {
  for (const e of entries.filter((x) => x.level === "subject" && x.ark)) {
    if (e.class === "tree_person") {
      const pid = treePersonId(e.ark!);
      const path = join(dir, "others", `${pid}.json`);
      const have = readJsonIf(path);
      if (have && !have.is_error) continue;
      const o = await call(ctx, calls, errors, "person_read", pid, () => ctx.tools.personRead(pid));
      writeJson(path, o.ok ? o.value : errorBody(o.error));
    } else if (e.class === "compiled_tree") {
      const path = compiledTreePath(ctx.out, e.ark!);
      if (existsSync(path)) continue;
      const t = await call(ctx, calls, errors, "compiled_tree_read", e.ark!, () => ctx.tools.compiledTreeRead(e.ark!));
      if (t.ok) writeJson(path, t.value);
      else if (t.class === "permanent") writeJson(path, errorBody(t.error));
    }
  }
}

export interface TreeSourcesLedger {
  started: string;
  calls: Record<string, number>;
  copies: number;
  by_class: Record<string, number>;
  /** Subject-level tree links, and how many now have a read on disk. */
  tree_links: number;
  tree_links_read: number;
  errored: number;
  finished?: string;
  stopped?: string;
}

/**
 * Reclassify every truth-set copy's audit list with the current classes and
 * fetch the tree links it holds, reusing any read already on disk. Plant
 * copies are left alone.
 */
export async function runTreeSources(out: string, tools: Tools): Promise<TreeSourcesLedger> {
  const run: RunJson = readJson(join(out, "run.json"));
  const ledger: TreeSourcesLedger = {
    started: new Date().toISOString(), calls: {}, copies: 0, by_class: {}, tree_links: 0, tree_links_read: 0, errored: 0,
  };
  const ctx: Ctx = { out, tools, samePerson: false, ledger: newLedger() };
  try {
    for (const copyKey of new Set(Object.values(run.map))) {
      const dir = personsDir(out, copyKey);
      const audit: AuditList | undefined = readJsonIf(join(dir, "audit.json"));
      const meta = readJsonIf(join(dir, "meta.json"));
      if (!audit || !meta || meta.living) continue;
      ledger.copies += 1;
      for (const e of audit.entries) {
        e.class = classifyArk(e.ark);
        ledger.by_class[e.class] = (ledger.by_class[e.class] ?? 0) + 1;
      }
      writeJson(join(dir, "audit.json"), audit);
      const calls: Record<string, number> = {};
      const errors: CallError[] = [];
      await snapshotTreeSources(ctx, calls, errors, dir, audit.entries);
      if (errors.length) ledger.errored += 1;
      for (const e of audit.entries.filter((x) => x.level === "subject" && (x.class === "tree_person" || x.class === "compiled_tree"))) {
        ledger.tree_links += 1;
        const read = e.class === "tree_person" ? readJsonIf(join(dir, "others", `${treePersonId(e.ark!)}.json`)) : readJsonIf(compiledTreePath(out, e.ark!));
        if (read && !read.is_error) ledger.tree_links_read += 1;
      }
    }
  } catch (e) {
    if (!(e instanceof StopRun)) throw e;
    ledger.stopped = e.message;
  }
  ledger.calls = ctx.ledger.calls;
  ledger.finished = new Date().toISOString();
  writeJson(join(out, "runs", `tree-sources-${ledger.started.replace(/[:.]/g, "-")}.json`), ledger);
  return ledger;
}

export interface RefreshLedger {
  started: string;
  tree: string;
  calls: Record<string, number>;
  refreshed: number;
  skipped: number;
  errored: number;
  /** Subject-level persona ARKs, and how many the refreshed lookup attaches to the subject itself. */
  subject_arks: number;
  subject_arks_naming_subject: number;
  finished?: string;
  stopped?: string;
}

/**
 * Re-read every truth-set copy's attachments with the session switched to
 * `tree`. The Family Tree answer is kept beside it as
 * `attachments.family-tree.json`. `others/` keeps the person reads it already
 * holds and gains the tree's: the agent still reads a Family Tree person the
 * profile names, and the judge can only serve a read that is on disk. A copy already
 * refreshed for this tree (`attachments-tree.json`) is skipped, so a stopped
 * run resumes. Plant copies come from the Family Tree and are left alone.
 */
export async function runRefreshAttachments(out: string, tools: Tools, tree: string): Promise<RefreshLedger> {
  const run: RunJson = readJson(join(out, "run.json"));
  const ledger: RefreshLedger = {
    started: new Date().toISOString(), tree, calls: {}, refreshed: 0, skipped: 0, errored: 0,
    subject_arks: 0, subject_arks_naming_subject: 0,
  };
  const ctx: Ctx = { out, tools, samePerson: false, ledger: newLedger() };
  try {
    for (const copyKey of new Set(Object.values(run.map))) {
      const dir = personsDir(out, copyKey);
      const audit: AuditList | undefined = readJsonIf(join(dir, "audit.json"));
      const meta = readJsonIf(join(dir, "meta.json"));
      if (!audit || !meta || meta.living) continue;
      const personas = audit.entries.filter((e) => e.class === "persona");
      const subjectArks = personas.filter((e) => e.level === "subject").map((e) => e.ark!);
      if (readJsonIf(join(dir, "attachments-tree.json"))?.tree === tree) {
        ledger.skipped += 1;
      } else {
        if (existsSync(join(dir, "attachments.json")) && !existsSync(join(dir, "attachments.family-tree.json"))) {
          renameSync(join(dir, "attachments.json"), join(dir, "attachments.family-tree.json"));
        }
        const calls: Record<string, number> = {};
        const errors: CallError[] = [];
        await snapshotAttachments(ctx, calls, errors, dir, personas, audit.subject_id, meta.input_pid ?? audit.subject_id);
        if (errors.length) ledger.errored += 1;
        else {
          writeJson(join(dir, "attachments-tree.json"), { tree, refreshed: new Date().toISOString() });
          ledger.refreshed += 1;
        }
      }
      const att = readJsonIf(join(dir, "attachments.json"));
      ledger.subject_arks += subjectArks.length;
      ledger.subject_arks_naming_subject += subjectArks.filter((a) =>
        (att?.attachments?.[a] ?? []).some((p: Json) => p.personId === audit.subject_id)).length;
    }
  } catch (e) {
    if (!(e instanceof StopRun)) throw e;
    ledger.stopped = e.message;
  }
  ledger.calls = ctx.ledger.calls;
  ledger.finished = new Date().toISOString();
  writeJson(join(out, "runs", `attachments-${ledger.started.replace(/[:.]/g, "-")}.json`), ledger);
  return ledger;
}

export type PersonOutcome = "complete" | "transient" | "living" | "merged" | "final_with_errors";

export interface SnapshotPersonOpts {
  /** Force the copy key (a plant host's `.unplanted` copy); default the resolved id. */
  copyKey?: string;
  /** The run map, for merged-duplicate detection; omitted for plant hosts. */
  map?: Record<string, string>;
}

/**
 * Snapshot one person. Writes `meta.json` when the person has no transient
 * error (or has used all attempts), else `meta.error.json`. A run-stopping
 * error propagates as `StopRun` without counting an attempt.
 */
export async function snapshotPerson(ctx: Ctx, inputPid: string, opts: SnapshotPersonOpts = {}): Promise<{ outcome: PersonOutcome; copyKey: string }> {
  const t0 = Date.now();
  const calls: Record<string, number> = {};
  const errors: CallError[] = [];
  let copyKey = opts.copyKey ?? opts.map?.[inputPid] ?? inputPid;
  const prior = readJsonIf(join(personsDir(ctx.out, copyKey), "meta.error.json")) ??
    readJsonIf(join(personsDir(ctx.out, inputPid), "meta.error.json"));
  const attempts = (prior?.attempts ?? 0) + 1;

  const finish = (fields: Record<string, unknown>): PersonOutcome => {
    const dir = personsDir(ctx.out, copyKey);
    const transient = errors.some((e) => e.class === "transient");
    const meta = {
      input_pid: inputPid,
      copy_key: copyKey,
      attempts,
      wall_ms: Date.now() - t0,
      calls,
      errors,
      ...fields,
    };
    if (transient && attempts < MAX_ATTEMPTS) {
      writeJson(join(dir, "meta.error.json"), meta);
      return "transient";
    }
    rmSync(join(dir, "meta.error.json"), { force: true });
    writeJson(join(dir, "meta.json"), meta);
    return errors.length > 0 ? "final_with_errors" : "complete";
  };

  const pr = await call(ctx, calls, errors, "person_read", inputPid, () => ctx.tools.personRead(inputPid));
  if (!pr.ok) return { outcome: finish({ person_read_error: pr.error }), copyKey };

  const read = pr.value;
  const sid = read.persons?.[0]?.id ?? inputPid;
  if (!opts.copyKey) {
    const resolvedKey = sid;
    const owner = Object.entries(opts.map ?? {}).find(([pid, key]) => key === resolvedKey && pid !== inputPid);
    if (owner) return { outcome: "merged", copyKey: resolvedKey };
    if (resolvedKey !== copyKey) {
      const from = personsDir(ctx.out, copyKey);
      const to = personsDir(ctx.out, resolvedKey);
      if (existsSync(from)) {
        if (existsSync(to)) rmSync(from, { recursive: true, force: true });
        else {
          mkdirSync(dirname(to), { recursive: true });
          renameSync(from, to);
        }
      }
      copyKey = resolvedKey;
    }
  }
  const dir = personsDir(ctx.out, copyKey);
  mkdirSync(dir, { recursive: true });

  const audit = buildAuditList(read);
  if (audit.living) {
    rmSync(join(dir, "meta.error.json"), { force: true });
    writeJson(join(dir, "meta.json"), { input_pid: inputPid, copy_key: copyKey, attempts, living: true, calls });
    return { outcome: "living", copyKey };
  }
  writeJson(join(dir, "person-read.json"), read);
  writeJson(join(dir, "tree.gedcomx.json"), sanitizeTree(read).tree);
  writeJson(join(dir, "audit.json"), audit);

  const unreadRelationshipSources = relationshipNoteCount(read.notes);
  if (unreadRelationshipSources !== null) {
    errors.push({ tool: "person_read", error: `relationship sources unread: ${unreadRelationshipSources}`, class: "transient" });
  }

  const personas = audit.entries.filter((e) => e.class === "persona");
  for (const e of personas) {
    const id = arkToBareId(e.ark!);
    if (readRecord(ctx.out, copyKey, id)) continue;
    const r = await call(ctx, calls, errors, "record_read", e.ark!, () => ctx.tools.recordRead(e.ark!));
    if (r.ok) writeJson(sharedRecordPath(ctx.out, id), r.value);
    else if (r.class === "permanent") writeJson(sharedRecordPath(ctx.out, id), errorBody(r.error));
  }

  await snapshotAttachments(ctx, calls, errors, dir, personas, sid, inputPid);
  await snapshotTreeSources(ctx, calls, errors, dir, audit.entries);

  const q = await call(ctx, calls, errors, "person_quality", sid, () => ctx.tools.personQuality(sid));
  writeJson(join(dir, "quality.json"), q.ok ? q.value : errorBody(q.error));

  const w = await call(ctx, calls, errors, "person_warnings", sid, () => ctx.tools.personWarnings(dir, sid));
  writeJson(join(dir, "warnings.json"), w.ok ? w.value : errorBody(w.error));

  let relationshipUnscored = 0;
  const unscoredReasons: Record<string, number> = {};
  if (ctx.samePerson) {
    const tree = readJson(join(dir, "tree.gedcomx.json"));
    const rows: Json[] = [];
    for (const e of personas) {
      const row = await scoreEntry(ctx, calls, errors, copyKey, read, tree, sid, e);
      if (e.level !== "subject" && row.unscored) {
        relationshipUnscored += 1;
        unscoredReasons[row.unscored] = (unscoredReasons[row.unscored] ?? 0) + 1;
      }
      rows.push(row);
    }
    writeJson(join(dir, "same-person.json"), rows);
  } else {
    relationshipUnscored = personas.filter((e) => e.level !== "subject").length;
  }

  const counts = { by_class: {} as Record<string, number>, by_level: {} as Record<string, number> };
  for (const e of audit.entries) {
    counts.by_class[e.class] = (counts.by_class[e.class] ?? 0) + 1;
    counts.by_level[e.level] = (counts.by_level[e.level] ?? 0) + 1;
  }
  return {
    outcome: finish({
      audit_counts: counts,
      relationship_unscored: relationshipUnscored,
      relationship_unscored_reasons: unscoredReasons,
      ...(unreadRelationshipSources !== null ? { relationship_sources_unread: unreadRelationshipSources } : {}),
    }),
    copyKey,
  };
}

export type PersonaSelection = { persona_id: string; selected_by: string } | { unscored: string };

type EdgeRole = "parent" | "child" | "spouse";

/** The subject's role on each tree edge that cites the source, from `person-read.json`. */
function subjectRoles(read: PersonReadResult, sid: string, entry: AuditEntry): EdgeRole[] {
  const ids = new Set(entry.source_ids);
  const roles = new Set<EdgeRole>();
  for (const r of read.relationships ?? []) {
    if (!(r.sources ?? []).some((s) => ids.has(s.ref))) continue;
    if (r.type === "Couple" && (r.person1 === sid || r.person2 === sid)) roles.add("spouse");
    else if (r.type === "ParentChild" && r.parent === sid) roles.add("parent");
    else if (r.type === "ParentChild" && r.child === sid) roles.add("child");
  }
  return [...roles];
}

/** The record personas that hold `role` relative to P, plus P if P already holds it. */
function roleCandidates(record: Json, p: Json, role: EdgeRole): Json[] {
  const rels: Json[] = record.relationships ?? [];
  const ids = new Set<string>();
  for (const r of rels) {
    if (role === "spouse") {
      if (r.type !== "Couple") continue;
      if (r.person1 === p.id) ids.add(r.person2);
      if (r.person2 === p.id) ids.add(r.person1);
      if (r.person1 === p.id || r.person2 === p.id) ids.add(p.id);
    } else if (r.type === "ParentChild") {
      const holder = role === "parent" ? r.parent : r.child;
      const other = role === "parent" ? r.child : r.parent;
      if (other === p.id) ids.add(holder);
      if (holder === p.id) ids.add(p.id);
    }
  }
  return (record.persons ?? []).filter((x: Json) => ids.has(x.id));
}

/**
 * The record persona that is the audited person, or why none can be chosen.
 * Subject-level: the ARK's own persona. Relationship-level: the ARK names the
 * other party, so take the persona holding the subject's role relative to it,
 * narrowed by the subject's gender. Never guesses.
 */
export function selectSubjectPersona(read: PersonReadResult, sid: string, entry: AuditEntry, record: Json): PersonaSelection {
  if (!record || record.is_error || !entry.ark) return { unscored: "record_unreadable" };
  const p = personaFor(record, entry.ark);
  if (!p) return { unscored: "record_unreadable" };
  if (entry.level === "subject") return { persona_id: p.id, selected_by: "ark" };

  const gender = read.persons?.find((x) => x.id === sid)?.gender;
  const picks = new Map<string, EdgeRole>();
  let ambiguous = false;
  const roles = subjectRoles(read, sid, entry);
  if (roles.length === 0) return { unscored: "no_relationship" };
  for (const role of roles) {
    let cands = roleCandidates(record, p, role);
    if (gender && gender !== "Unknown") cands = cands.filter((c) => c.gender === gender);
    if (cands.length === 0) return { unscored: "no_relationship" };
    if (cands.length > 1) ambiguous = true;
    else picks.set(cands[0].id, role);
  }
  if (ambiguous) return { unscored: "ambiguous" };
  if (picks.size > 1) return { unscored: "edges_disagree" };
  const [[persona_id, role]] = [...picks];
  return { persona_id, selected_by: `role:${role}` };
}

/** Score one persona source: pick the persona, then ask `same_person`. An unselectable relationship-level source gets an `unscored` row. */
async function scoreEntry(
  ctx: Ctx,
  calls: Record<string, number>,
  errors: CallError[],
  copyKey: string,
  read: PersonReadResult,
  tree: Json,
  sid: string,
  entry: AuditEntry,
): Promise<Json> {
  const ark = entry.ark!;
  const record = readRecord(ctx.out, copyKey, arkToBareId(ark));
  const sel = selectSubjectPersona(read, sid, entry, record);
  if ("unscored" in sel) {
    if (entry.level !== "subject") return { ark, unscored: sel.unscored };
    if (!record || record.is_error) return { ark, ...errorBody(record?.error ?? "record not read") };
    const error = `no persona matching the ARK ${ark}`;
    errors.push({ tool: "same_person", key: ark, error, class: "permanent" });
    return { ark, ...errorBody(error) };
  }
  const s = await call(ctx, calls, errors, "same_person", ark, () =>
    ctx.tools.samePerson({ gedcomx1: tree, primaryId1: sid, gedcomx2: recordGedcomx(record), primaryId2: sel.persona_id }),
  );
  const tag = { persona_id: sel.persona_id, selected_by: sel.selected_by };
  return s.ok ? { ark, ...tag, result: s.value } : { ark, ...tag, ...errorBody(s.error) };
}

export function readPids(file: string): string[] {
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
}

export interface SnapshotOpts {
  pids: string[];
  out: string;
  sample: number | null;
  seed: number;
  samePerson: boolean;
  tools: Tools;
  /** The CLI sets this: Ctrl-C writes the ledger before exiting. */
  handleInterrupt?: boolean;
}

export async function runSnapshot(opts: SnapshotOpts): Promise<Ledger> {
  const runPath = join(opts.out, "run.json");
  let run: RunJson | undefined = readJsonIf(runPath);
  if (run && run.input_count !== opts.pids.length && run.draw.length > 0) {
    throw new Error(`${runPath} was drawn from ${run.input_count} PIDs, this --pids file holds ${opts.pids.length}; use the same file, or a new --out`);
  }
  if (run && (run.sample !== opts.sample || run.seed !== opts.seed)) {
    throw new Error(`${runPath} was drawn with --sample ${run.sample} --seed ${run.seed}; use those, or a new --out`);
  }
  if (!run) {
    run = {
      created: new Date().toISOString(),
      sample: opts.sample,
      seed: opts.seed,
      input_count: opts.pids.length,
      draw: seededSample(opts.pids, opts.sample, opts.seed),
      map: {},
    };
    writeJson(runPath, run);
  }
  const ctx: Ctx = { out: opts.out, tools: opts.tools, samePerson: opts.samePerson, ledger: newLedger() };
  const ledgerPath = join(opts.out, "runs", `${ctx.ledger.started.replace(/[:.]/g, "-")}.json`);
  // An interrupted run still leaves its ledger; the person in progress has no
  // meta.json yet, so the next run fetches it again.
  const onInterrupt = () => {
    ctx.ledger.stopped = "interrupted";
    ctx.ledger.finished = new Date().toISOString();
    writeJson(ledgerPath, ctx.ledger);
    void restoreSwitchedSessionTrees().finally(() => process.exit(130));
  };
  if (opts.handleInterrupt) process.once("SIGINT", onInterrupt);
  for (const pid of run.draw) {
    const key = run.map[pid];
    if (key && existsSync(join(personsDir(opts.out, key), "meta.json"))) {
      ctx.ledger.skipped += 1;
      continue;
    }
    try {
      const { outcome, copyKey } = await snapshotPerson(ctx, pid, { map: run.map });
      run.map[pid] = copyKey;
      writeJson(runPath, run);
      if (outcome === "merged") ctx.ledger.merged += 1;
      else if (outcome === "transient") ctx.ledger.errored += 1;
      else if (outcome === "living") ctx.ledger.living += 1;
      else {
        ctx.ledger.fetched += 1;
        if (outcome === "final_with_errors") ctx.ledger.final_with_errors += 1;
      }
    } catch (e) {
      if (!(e instanceof StopRun)) throw e;
      ctx.ledger.stopped = e.message;
      break;
    }
  }
  if (opts.handleInterrupt) process.off("SIGINT", onInterrupt);
  ctx.ledger.finished = new Date().toISOString();
  writeJson(ledgerPath, ctx.ledger);
  return ctx.ledger;
}

// ─── baseline ───────────────────────────────────────────────────────────────

export interface FindingRow {
  copy_key: string;
  ark: string | null;
  kind: string;
  signal: string;
  detail?: string;
  score?: number;
}

export const DEFAULT_THRESHOLD = 0.5;

export interface BaselineResult {
  rows: FindingRow[];
  summary: Json;
}

const median = (xs: number[]) => quantile(xs, 0.5);
function quantile(xs: number[], q: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

export function runBaseline(snapshot: string, threshold = DEFAULT_THRESHOLD): BaselineResult {
  const run: RunJson = readJson(join(snapshot, "run.json"));
  const rows: FindingRow[] = [];
  const flaggedPersons: Record<string, Set<string>> = {};
  const flaggedSources: Record<string, Set<string>> = {};
  const counts = { persons: 0, living: 0, not_ready: 0, person_read_failed: 0, unscorable: 0, relationship_unscored: 0, merged_duplicate: 0 };
  const unscoredReasons: Record<string, number> = {};
  const walls: number[] = [];
  const callTotals: number[] = [];
  const scores: number[] = [];
  let unmatchedConflictUris = 0;
  let unattachedSubjectArks = 0;
  const add = (r: FindingRow) => {
    rows.push(r);
    (flaggedPersons[r.signal] ??= new Set()).add(r.copy_key);
    if (r.ark) (flaggedSources[r.signal] ??= new Set()).add(`${r.copy_key}|${r.ark}`);
  };
  const seen = new Map<string, number>();
  for (const key of Object.values(run.map ?? {})) seen.set(key, (seen.get(key) ?? 0) + 1);
  for (const n of seen.values()) counts.merged_duplicate += n - 1;

  for (const copy of listCopies(run)) {
    const dir = personsDir(snapshot, copy);
    const meta = readJsonIf(join(dir, "meta.json"));
    if (!meta) {
      counts.not_ready += 1;
      continue;
    }
    if (meta.living) {
      counts.living += 1;
      continue;
    }
    if (!existsSync(join(dir, "audit.json"))) {
      counts.person_read_failed += 1;
      continue;
    }
    counts.persons += 1;
    walls.push(meta.wall_ms ?? 0);
    callTotals.push(Object.values(meta.calls ?? {}).reduce((a: number, b) => a + (b as number), 0));
    counts.relationship_unscored += meta.relationship_unscored ?? 0;
    for (const [reason, n] of Object.entries(meta.relationship_unscored_reasons ?? {})) {
      unscoredReasons[reason] = (unscoredReasons[reason] ?? 0) + (n as number);
    }
    const audit: AuditList = readJson(join(dir, "audit.json"));
    const byKey = new Map(audit.entries.map((e) => [e.key, e]));
    counts.unscorable += audit.entries.filter((e) => e.class !== "persona").length;

    for (const w of readJsonIf(join(dir, "warnings.json"))?.warnings ?? []) {
      add({ copy_key: copy, ark: null, kind: "warning", signal: "person_warnings", detail: w.issueType ?? w.message });
    }
    for (const c of readJsonIf(join(dir, "quality.json"))?.detail?.conflicts ?? []) {
      for (const s of c.sources ?? []) {
        const ark = typeof s.uri === "string" ? toArk(s.uri) : "";
        if (!byKey.has(ark)) {
          unmatchedConflictUris += 1;
          continue;
        }
        add({ copy_key: copy, ark, kind: "source_conflict", signal: "person_quality_conflict", detail: c.field });
      }
    }
    const att = readJsonIf(join(dir, "attachments.json"));
    if (att && !att.is_error) {
      const unattached = new Set((att.unattached ?? []).map((u: string) => toArk(u)));
      const byArk = new Map<string, Json[]>(Object.entries(att.attachments ?? {}).map(([k, v]) => [toArk(k), v as Json[]]));
      for (const e of audit.entries.filter((x) => x.class === "persona" && x.level === "subject")) {
        if (unattached.has(e.ark!)) unattachedSubjectArks += 1;
        const ids = new Set((byArk.get(e.ark!) ?? []).map((p) => p.personId));
        if (ids.size > 1) add({ copy_key: copy, ark: e.ark, kind: "misattributed", signal: "multi_attached", detail: `${ids.size} tree persons` });
      }
    }
    for (const sp of readJsonIf(join(dir, "same-person.json")) ?? []) {
      if (!sp.result) continue;
      const score = Number(sp.result.score);
      if (Number.isFinite(score)) scores.push(score);
      if (!(score >= threshold)) {
        add({ copy_key: copy, ark: toArk(sp.ark), kind: "misattributed", signal: "same_person_low", score });
      }
    }
  }
  const histogram: Record<string, number> = {};
  for (const s of scores) {
    const bin = Math.min(9, Math.floor(s * 10));
    const label = `${(bin / 10).toFixed(1)}-${((bin + 1) / 10).toFixed(1)}`;
    histogram[label] = (histogram[label] ?? 0) + 1;
  }
  const signals = [...new Set([...Object.keys(flaggedPersons)])].sort();
  const summary = {
    threshold,
    counts: { ...counts, relationship_unscored_reasons: unscoredReasons },
    flagged: Object.fromEntries(
      signals.map((s) => [s, { persons: flaggedPersons[s]?.size ?? 0, sources: flaggedSources[s]?.size ?? 0 }]),
    ),
    per_person: {
      wall_ms: { median: median(walls), p90: quantile(walls, 0.9) },
      calls: { median: median(callTotals), p90: quantile(callTotals, 0.9) },
    },
    same_person_scores: { n: scores.length, histogram },
    join_checks: {
      person_quality_conflict_uris_unmatched: unmatchedConflictUris,
      subject_persona_arks_unattached: unattachedSubjectArks,
    },
  };
  return { rows, summary };
}

// ─── fixture spec ───────────────────────────────────────────────────────────

export const MUST_FLAG = ["easy_wrong_person", "hard_wrong_person", "sr_jr_swap", "relative_clash", "indexing_error"] as const;
export const WRONG_PERSON = new Set<string>(["easy_wrong_person", "hard_wrong_person", "sr_jr_swap", "relative_clash"]);
export const MUST_NOT_FLAG = [
  "spelling_variant",
  "nickname",
  "latin_given_name",
  "maiden_married",
  "census_age_drift",
  "patronymic",
] as const;

export interface IndexingEdit {
  /** The host record's persona ARK (`ark:/61903/1:1:...`). */
  persona_ark: string;
  /** `name.given`, `name.surname`, or `<FactType>.date|place|value`, e.g. `Birth.date`. */
  field: string;
  value: string;
}

export interface FixtureSpecEntry {
  id: string;
  type: string;
  host: string;
  /** Wrong-person types: the donor persona ARK attached to the host. */
  donor_ark?: string;
  /** Must-not-flag types: the host's real source that shows the variation. */
  source_ark?: string;
  /** indexing_error: the one field changed in the host's own record. */
  edit?: IndexingEdit;
  note?: string;
}

export interface FixtureSpec {
  fixtures: FixtureSpecEntry[];
}

export function loadSpec(path: string): FixtureSpec {
  const spec: FixtureSpec = readJson(path);
  const ids = new Set<string>();
  for (const f of spec.fixtures ?? []) {
    if (ids.has(f.id)) throw new Error(`duplicate fixture id ${f.id}`);
    ids.add(f.id);
    if (![...MUST_FLAG, ...MUST_NOT_FLAG].includes(f.type as never)) throw new Error(`${f.id}: unknown type ${f.type}`);
    if (WRONG_PERSON.has(f.type) && !f.donor_ark) throw new Error(`${f.id}: ${f.type} needs donor_ark`);
    if (f.type === "indexing_error" && !f.edit) throw new Error(`${f.id}: indexing_error needs edit`);
    if ((MUST_NOT_FLAG as readonly string[]).includes(f.type) && !f.source_ark) throw new Error(`${f.id}: ${f.type} needs source_ark`);
  }
  return spec;
}

/** The copy a fixture is scored on: its own plant, or its host's unplanted copy for must-not-flag. */
export function scoredCopy(f: FixtureSpecEntry): string {
  return (MUST_NOT_FLAG as readonly string[]).includes(f.type) ? unplantedKey(f.host) : f.id;
}

// ─── plant ──────────────────────────────────────────────────────────────────

const ID_CHARS = "BCDFGHJKLMNPQRSTVWXYZ0123456789";

/** A normal-looking `XXXX-XXX` source id, deterministic per fixture. */
export function plantSourceId(fixtureId: string): string {
  let h = 2166136261;
  for (const ch of fixtureId) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const rnd = mulberry32(h);
  const pick = () => ID_CHARS[Math.floor(rnd() * ID_CHARS.length)];
  return `${pick()}${pick()}${pick()}${pick()}-${pick()}${pick()}${pick()}`;
}

/** `<donor persona name>, "<collection>"`, the style of the tree's own titles. */
export function donorTitle(record: Json, donorArk: string): string {
  const persona = personaFor(record, donorArk);
  const n = persona?.names?.[0];
  const name = [n?.given, n?.surname].filter((x) => typeof x === "string" && x.trim()).join(" ") || "Unknown";
  const collection = (record?.sources ?? []).find((s: Json) => /collection/i.test(String(s?.resource_type ?? "")))?.title;
  return collection ? `${name}, "${collection}"` : name;
}

function donorCitation(record: Json, title: string, donorArk: string): string {
  const rec = (record?.sources ?? []).find((s: Json) => /^record$/i.test(String(s?.resource_type ?? "")));
  return rec?.citation ?? `${title}, FamilySearch (https://www.familysearch.org/${donorArk})`;
}

/**
 * Add the donor source to a copy's person-read, tree and audit, at the subject
 * level, looking like the tree's own sources. Pure: returns new documents.
 */
export function applyWrongPersonPlant(
  docs: { read: Json; tree: Json; audit: AuditList },
  donorRecord: Json,
  donorArk: string,
  sourceId: string,
): { read: Json; tree: Json; audit: AuditList } {
  const read = structuredClone(docs.read);
  const tree = structuredClone(docs.tree);
  const audit = structuredClone(docs.audit);
  const title = donorTitle(donorRecord, donorArk);
  const source = {
    id: sourceId,
    title,
    citation: donorCitation(donorRecord, title, donorArk),
    url: `https://www.familysearch.org/${donorArk}`,
  };
  for (const doc of [read, tree]) {
    doc.sources = [...(doc.sources ?? []), { ...source }];
    const subject = doc.persons[0];
    subject.sources = [...(subject.sources ?? []), { ref: sourceId }];
  }
  audit.entries.push({ key: donorArk, ark: donorArk, source_ids: [sourceId], title, level: "subject", class: "persona" });
  return { read, tree, audit };
}

/** Add the host to the donor ARK's attachments, keeping who else holds it. Pure. */
export function addHostAttachment(att: Json, donorArk: string, donorPersons: Json[], hostId: string): Json {
  const out = structuredClone(att && !att.is_error ? att : { attachments: {}, unattached: [] });
  const persons = [...donorPersons.filter((p) => p.personId !== hostId), { personId: hostId, tags: [] }];
  out.attachments = { ...(out.attachments ?? {}), [donorArk]: persons };
  out.unattached = (out.unattached ?? []).filter((u: string) => toArk(u) !== donorArk);
  return out;
}

/** Change exactly one field of one persona in a copy of the record. Pure. */
export function applyIndexingPlant(record: Json, edit: IndexingEdit): { record: Json; before: string } {
  const out = structuredClone(record);
  const persona = personaFor(out, toArk(edit.persona_ark));
  if (!persona) throw new Error(`indexing plant: no persona ${edit.persona_ark} in the record`);
  const [head, attr] = edit.field.split(".");
  let before: unknown;
  if (head === "name") {
    const n = persona.names?.[0];
    if (!n || !["given", "surname"].includes(attr)) throw new Error(`indexing plant: bad name field ${edit.field}`);
    before = n[attr];
    n[attr] = edit.value;
  } else {
    const fact = (persona.facts ?? []).find((f: Json) => String(f.type ?? "").split("/").pop() === head);
    if (!fact || !["date", "place", "value"].includes(attr)) throw new Error(`indexing plant: no ${edit.field} on the persona`);
    before = fact[attr];
    fact[attr] = edit.value;
    if (attr === "date") delete fact.standard_date;
    if (attr === "place") delete fact.standard_place;
  }
  if (before === edit.value) throw new Error(`indexing plant: ${edit.field} already reads ${edit.value}`);
  return { record: out, before: String(before ?? "") };
}

function registerCopy(out: string, key: string, entry: { fixture_id?: string; host: string; type?: string }): void {
  const runPath = join(out, "run.json");
  const run: RunJson = readJsonIf(runPath) ?? { created: new Date().toISOString(), sample: null, seed: 1, input_count: 0, draw: [], map: {} };
  run.plants = { ...(run.plants ?? {}), [key]: entry };
  writeJson(runPath, run);
}

export async function runPlant(spec: FixtureSpec, out: string, tools: Tools, samePersonOn = true): Promise<Ledger> {
  const ctx: Ctx = { out, tools, samePerson: samePersonOn, ledger: newLedger() };
  try {
    for (const host of new Set(spec.fixtures.map((f) => f.host))) {
      const key = unplantedKey(host);
      if (!existsSync(join(personsDir(out, key), "meta.json"))) {
        const { outcome } = await snapshotPerson(ctx, host, { copyKey: key });
        if (outcome === "transient") throw new Error(`host ${host} had a transient error; re-run plant`);
      }
      const meta = readJson(join(personsDir(out, key), "meta.json"));
      if (meta.living) throw new Error(`host ${host} is living; fixture hosts must be deceased`);
      if (!existsSync(join(personsDir(out, key), "audit.json"))) {
        throw new Error(`host ${host} could not be read: ${meta.person_read_error ?? "no audit.json"}`);
      }
      registerCopy(out, key, { host });
    }
    for (const f of spec.fixtures) {
      if ((MUST_NOT_FLAG as readonly string[]).includes(f.type)) {
        const audit: AuditList = readJson(join(personsDir(out, unplantedKey(f.host)), "audit.json"));
        if (!audit.entries.some((e) => e.ark === toArk(f.source_ark!))) {
          throw new Error(`fixture ${f.id}: ${f.source_ark} is not attached to host ${f.host}`);
        }
        continue;
      }
      await plantOne(ctx, f);
      registerCopy(out, f.id, { fixture_id: f.id, host: f.host, type: f.type });
    }
  } catch (e) {
    if (!(e instanceof StopRun)) {
      ctx.ledger.stopped = e instanceof Error ? e.message : String(e);
      throw e;
    }
    ctx.ledger.stopped = e.message;
  } finally {
    ctx.ledger.finished = new Date().toISOString();
    writeJson(join(out, "runs", `plant-${ctx.ledger.started.replace(/[:.]/g, "-")}.json`), ctx.ledger);
  }
  return ctx.ledger;
}

async function plantOne(ctx: Ctx, f: FixtureSpecEntry): Promise<void> {
  const src = personsDir(ctx.out, unplantedKey(f.host));
  const dst = personsDir(ctx.out, f.id);
  rmSync(dst, { recursive: true, force: true });
  cpSync(src, dst, { recursive: true });
  const calls: Record<string, number> = {};
  const errors: CallError[] = [];
  const read = readJson(join(dst, "person-read.json"));
  const sid = read.persons[0].id;
  const tree = readJson(join(dst, "tree.gedcomx.json"));
  const audit: AuditList = readJson(join(dst, "audit.json"));
  let samePersonRows: Json[] = readJsonIf(join(dst, "same-person.json")) ?? [];
  const failIf = () => {
    if (errors.length) throw new Error(`plant ${f.id}: ${errors.map((e) => `${e.tool}: ${e.error}`).join("; ")}`);
  };

  if (WRONG_PERSON.has(f.type)) {
    const donorArk = toArk(f.donor_ark!);
    if (audit.entries.some((e) => e.ark === donorArk)) {
      throw new Error(`fixture ${f.id}: donor ${donorArk} is already attached to host ${f.host}, so planting it plants nothing`);
    }
    const id = arkToBareId(donorArk);
    let record = readRecord(ctx.out, f.id, id);
    if (!record) {
      const r = await call(ctx, calls, errors, "record_read", donorArk, () => ctx.tools.recordRead(donorArk));
      failIf();
      if (r.ok) writeJson(sharedRecordPath(ctx.out, id), (record = r.value));
    }
    if (record.is_error) throw new Error(`plant ${f.id}: donor record unreadable: ${record.error}`);
    const planted = applyWrongPersonPlant({ read, tree, audit }, record, donorArk, plantSourceId(f.id));
    writeJson(join(dst, "person-read.json"), planted.read);
    writeJson(join(dst, "tree.gedcomx.json"), planted.tree);
    writeJson(join(dst, "audit.json"), planted.audit);
    const a = await call(ctx, calls, errors, "source_attachments", donorArk, () => ctx.tools.sourceAttachments([donorArk]));
    failIf();
    const donorPersons: Json[] = a.ok ? (a.value.attachments?.[donorArk] ?? []) : [];
    writeJson(join(dst, "attachments.json"), addHostAttachment(readJsonIf(join(dst, "attachments.json")), donorArk, donorPersons, sid));
    for (const p of donorPersons) {
      if (p.personId === sid || existsSync(join(dst, "others", `${p.personId}.json`))) continue;
      const o = await call(ctx, calls, errors, "person_read", p.personId, () => ctx.tools.personRead(p.personId));
      failIf();
      writeJson(join(dst, "others", `${p.personId}.json`), o.ok ? o.value : errorBody(o.error));
    }
    if (ctx.samePerson) {
      samePersonRows = samePersonRows.filter((r) => toArk(r.ark) !== donorArk);
      const entry = planted.audit.entries.find((e) => e.ark === donorArk)!;
      samePersonRows.push(await scoreEntry(ctx, calls, errors, f.id, planted.read, planted.tree, sid, entry));
    }
  } else if (f.type === "indexing_error") {
    const ark = toArk(f.edit!.persona_ark);
    const id = arkToBareId(ark);
    const record = readRecord(ctx.out, unplantedKey(f.host), id);
    if (!record || record.is_error) throw new Error(`plant ${f.id}: host record ${ark} not in the snapshot`);
    const { record: edited } = applyIndexingPlant(record, f.edit!);
    writeJson(join(dst, "records", `${id}.json`), edited);
    const entry = audit.entries.find((e) => e.ark === ark && e.class === "persona");
    if (ctx.samePerson && entry) {
      samePersonRows = samePersonRows.filter((r) => toArk(r.ark) !== ark);
      samePersonRows.push(await scoreEntry(ctx, calls, errors, f.id, read, tree, sid, entry));
    }
  }
  failIf();
  if (ctx.samePerson) writeJson(join(dst, "same-person.json"), samePersonRows);
  const meta = readJson(join(dst, "meta.json"));
  writeJson(join(dst, "meta.json"), { ...meta, copy_key: f.id, fixture_id: f.id, type: f.type, host: f.host, plant_calls: calls });
}

// ─── score ──────────────────────────────────────────────────────────────────

export interface FindingsFile {
  path: string;
  step: "baseline" | "judge";
  rows: FindingRow[];
}

export function readFindings(path: string): FindingsFile {
  const step = basename(path).startsWith("judge") ? "judge" : "baseline";
  const rows = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .map((l) => {
      const r = JSON.parse(l);
      return { ...r, ark: r.ark ? toArk(r.ark) : r.source_url ? toArk(r.source_url) : null } as FindingRow;
    });
  return { path, step, rows };
}

/** Baseline signals that cannot see a plant, and one the plant itself creates. */
const BLIND_SIGNALS = new Set(["person_warnings", "person_quality_conflict"]);
const BY_CONSTRUCTION_SIGNALS = new Set(["multi_attached"]);

export interface TypeScore {
  type: string;
  fixtures: number;
  scored: number;
  caught: number;
  rate: number | null;
  misses: string[];
  missing: string[];
  harness_miss: string[];
  parse_error: string[];
  confounded?: string[];
  indexing_on_planted?: number;
  blind?: number;
  by_construction?: number;
  false_alarms?: number;
  false_alarm_ids?: string[];
  /** Must-not-flag: how many flagged fixtures each signal flagged. */
  false_alarm_signals?: Record<string, number>;
}

/** Whether a copy has its step's output: a baseline person dir, or a judge file. */
function copyPresent(f: FindingsFile, copy: string): { present: boolean; harnessMiss: boolean; parseError?: boolean } {
  const snap = dirname(f.path);
  if (f.step === "baseline") return { present: existsSync(join(personsDir(snap, copy), "meta.json")), harnessMiss: false };
  const j = readJsonIf(join(snap, "judge", `${copy}.json`));
  return { present: Boolean(j), harnessMiss: Boolean(j?.harness_miss), parseError: Boolean(j?.parse_error) };
}

const rowSig = (r: FindingRow) => `${r.ark}|${r.kind}|${r.signal}`;

export function scoreFindings(
  spec: FixtureSpec,
  file: FindingsFile,
  presence: (copy: string) => { present: boolean; harnessMiss: boolean; parseError?: boolean } = (copy) => copyPresent(file, copy),
): TypeScore[] {
  const byCopy = new Map<string, FindingRow[]>();
  for (const r of file.rows) byCopy.set(r.copy_key, [...(byCopy.get(r.copy_key) ?? []), r]);
  const out: TypeScore[] = [];
  for (const type of [...MUST_FLAG, ...MUST_NOT_FLAG]) {
    const fixtures = spec.fixtures.filter((f) => f.type === type);
    const mustNot = (MUST_NOT_FLAG as readonly string[]).includes(type);
    const s: TypeScore = { type, fixtures: fixtures.length, scored: 0, caught: 0, rate: null, misses: [], missing: [], harness_miss: [], parse_error: [] };
    if (type === "indexing_error") s.confounded = [];
    if (WRONG_PERSON.has(type)) s.indexing_on_planted = 0;
    if (file.step === "baseline" && !mustNot) {
      s.blind = 0;
      if (WRONG_PERSON.has(type)) s.by_construction = 0;
    }
    if (mustNot) {
      s.false_alarms = 0;
      s.false_alarm_ids = [];
      s.false_alarm_signals = {};
    }
    for (const f of fixtures) {
      const copy = scoredCopy(f);
      const p = presence(copy);
      if (!p.present) {
        s.missing.push(f.id);
        continue;
      }
      if (p.harnessMiss) {
        s.harness_miss.push(f.id);
        continue;
      }
      // A findings block that did not parse is not a clean audit.
      if (p.parseError) {
        s.parse_error.push(f.id);
        continue;
      }
      s.scored += 1;
      const rows = byCopy.get(copy) ?? [];
      if (mustNot) {
        const named = toArk(f.source_ark!);
        const flagged = rows.filter((r) => r.ark === named && r.kind !== "unchecked");
        if (flagged.length > 0) {
          s.false_alarms! += 1;
          s.false_alarm_ids!.push(f.id);
          for (const sig of new Set(flagged.map((r) => r.signal))) s.false_alarm_signals![sig] = (s.false_alarm_signals![sig] ?? 0) + 1;
        }
        continue;
      }
      const base = new Set((byCopy.get(unplantedKey(f.host)) ?? []).map(rowSig));
      let counted = rows.filter((r) => !base.has(rowSig(r)));
      if (file.step === "baseline") {
        s.blind! += counted.filter((r) => BLIND_SIGNALS.has(r.signal)).length;
        if (WRONG_PERSON.has(type)) {
          s.by_construction! += counted.filter((r) => BY_CONSTRUCTION_SIGNALS.has(r.signal)).length;
          counted = counted.filter((r) => !BY_CONSTRUCTION_SIGNALS.has(r.signal));
        }
      }
      let caught = false;
      if (WRONG_PERSON.has(type)) {
        const donor = toArk(f.donor_ark!);
        caught = counted.some((r) => r.ark === donor && r.kind === "misattributed");
        if (counted.some((r) => r.ark === donor && r.kind === "indexing")) s.indexing_on_planted! += 1;
      } else {
        const edited = toArk(f.edit!.persona_ark);
        const baseRows = byCopy.get(unplantedKey(f.host)) ?? [];
        if (baseRows.some((r) => r.ark === edited && r.kind === "indexing")) {
          s.confounded!.push(f.id);
          s.scored -= 1;
          continue;
        }
        caught = rows.some((r) => r.ark === edited && r.kind === "indexing");
      }
      if (caught) s.caught += 1;
      else s.misses.push(f.id);
    }
    if (s.scored > 0) s.rate = mustNot ? s.false_alarms! / s.scored : s.caught / s.scored;
    out.push(s);
  }
  return out;
}

export function formatScores(file: FindingsFile, scores: TypeScore[]): string {
  const lines = [`== ${file.step}: ${basename(file.path)}`];
  for (const s of scores) {
    const mustNot = s.false_alarms !== undefined;
    const rate = s.rate === null ? "n/a" : `${(s.rate * 100).toFixed(0)}%`;
    const head = mustNot
      ? `${s.type}: false alarms ${s.false_alarms}/${s.scored} (${rate}), n=${s.fixtures}`
      : `${s.type}: caught ${s.caught}/${s.scored} (${rate}), n=${s.fixtures}`;
    const extra = [
      s.misses.length ? `misses: ${s.misses.join(", ")}` : "",
      s.false_alarm_ids?.length ? `flagged: ${s.false_alarm_ids.join(", ")}` : "",
      Object.keys(s.false_alarm_signals ?? {}).length
        ? `by signal: ${Object.entries(s.false_alarm_signals!).map(([k, v]) => `${k} ${v}`).join(", ")}`
        : "",
      s.missing.length ? `missing: ${s.missing.join(", ")}` : "",
      s.harness_miss.length ? `harness_miss (excluded): ${s.harness_miss.join(", ")}` : "",
      s.parse_error.length ? `parse_error (excluded): ${s.parse_error.join(", ")}` : "",
      s.confounded?.length ? `confounded: ${s.confounded.join(", ")}` : "",
      s.indexing_on_planted ? `filed as indexing: ${s.indexing_on_planted}` : "",
      s.blind ? `blind signals on plants: ${s.blind}` : "",
      s.by_construction ? `multi-attached (by construction): ${s.by_construction}` : "",
    ].filter(Boolean);
    lines.push([head, ...extra].join("; "));
  }
  return lines.join("\n");
}

// ─── cli ────────────────────────────────────────────────────────────────────

export function parseArgs(argv: string[]): { cmd: string; flags: Record<string, string[]>; bools: Set<string> } {
  const [cmd, ...rest] = argv;
  const flags: Record<string, string[]> = {};
  const bools = new Set<string>();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith("--")) throw new Error(`unexpected argument ${a}`);
    if (a.startsWith("--no-")) {
      bools.add(a);
      continue;
    }
    const v = rest[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
    (flags[a] ??= []).push(v);
    i += 1;
  }
  return { cmd: cmd ?? "", flags, bools };
}

function intFlag(flags: Record<string, string[]>, name: string, fallback: number | null): number | null {
  const v = flags[name]?.[0];
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < (name === "--sample" ? 1 : 0)) throw new Error(`${name} must be a${name === "--sample" ? " positive" : " non-negative"} integer, got ${v}`);
  return n;
}

const ALLOWED: Record<string, string[]> = {
  snapshot: ["--pids", "--out", "--sample", "--seed", "--tree"],
  attachments: ["--snapshot", "--tree"],
  "tree-sources": ["--snapshot"],
  baseline: ["--snapshot", "--threshold"],
  plant: ["--spec", "--out"],
  score: ["--spec", "--findings"],
};
const PATH_FLAGS = new Set(["--pids", "--out", "--snapshot", "--findings", "--spec"]);

export async function main(argv: string[], tools?: Tools): Promise<number> {
  const { cmd, flags, bools } = parseArgs(argv);
  if (!ALLOWED[cmd]) throw new Error(`usage: source-screen.ts snapshot|attachments|tree-sources|baseline|plant|score [flags]`);
  for (const b of bools) {
    if (b !== "--no-same-person" || !["snapshot", "plant"].includes(cmd)) throw new Error(`${cmd} does not take ${b}`);
  }
  for (const f of Object.keys(flags)) {
    if (!ALLOWED[cmd].includes(f)) throw new Error(`${cmd} does not take ${f}`);
    if (PATH_FLAGS.has(f)) flags[f] = flags[f].map((p) => guardPath(f, p));
  }
  const one = (name: string) => {
    const v = flags[name]?.[0];
    if (!v) throw new Error(`${cmd} needs ${name}`);
    return v;
  };
  const samePersonOn = !bools.has("--no-same-person");
  if (cmd === "snapshot") {
    const pids = readPids(one("--pids"));
    if (pids.length === 0) throw new Error("--pids file holds no PIDs");
    const ledger = await runSnapshot({
      pids,
      out: one("--out"),
      sample: intFlag(flags, "--sample", null),
      seed: intFlag(flags, "--seed", 1)!,
      samePerson: samePersonOn,
      tools: tools ?? liveTools(undefined, flags["--tree"]?.[0]),
      handleInterrupt: true,
    });
    console.log(JSON.stringify(ledger, null, 2));
    return ledger.stopped ? 2 : 0;
  }
  if (cmd === "tree-sources") {
    const ledger = await runTreeSources(one("--snapshot"), tools ?? liveTools());
    console.log(JSON.stringify(ledger, null, 2));
    return ledger.stopped ? 2 : 0;
  }
  if (cmd === "attachments") {
    const onInterrupt = () => void restoreSwitchedSessionTrees().finally(() => process.exit(130));
    process.once("SIGINT", onInterrupt);
    const ledger = await runRefreshAttachments(one("--snapshot"), tools ?? liveTools(undefined, one("--tree")), one("--tree"));
    process.off("SIGINT", onInterrupt);
    console.log(JSON.stringify(ledger, null, 2));
    return ledger.stopped ? 2 : 0;
  }
  if (cmd === "baseline") {
    const snapshot = one("--snapshot");
    const t = flags["--threshold"]?.[0];
    const threshold = t === undefined ? DEFAULT_THRESHOLD : Number(t);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error(`--threshold must be 0..1, got ${t}`);
    const { rows, summary } = runBaseline(snapshot, threshold);
    writeFileSync(join(snapshot, "baseline.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""), "utf8");
    writeJson(join(snapshot, "baseline-summary.json"), summary);
    console.log(JSON.stringify(summary, null, 2));
    return 0;
  }
  if (cmd === "plant") {
    const ledger = await runPlant(loadSpec(one("--spec")), one("--out"), tools ?? liveTools(), samePersonOn);
    console.log(JSON.stringify(ledger, null, 2));
    return ledger.stopped ? 2 : 0;
  }
  const spec = loadSpec(one("--spec"));
  const files = flags["--findings"] ?? [];
  if (files.length === 0) throw new Error("score needs --findings");
  for (const path of files) {
    const file = readFindings(path);
    console.log(formatScores(file, scoreFindings(spec, file)));
  }
  return 0;
}

if (process.argv[1]?.endsWith("source-screen.ts")) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}

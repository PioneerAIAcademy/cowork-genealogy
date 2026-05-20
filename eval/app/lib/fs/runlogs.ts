/**
 * Read run logs under `eval/runlogs/unit/<skill>/<filename>`.
 *
 * Schema v2 only — no legacy model-dir or per-test file format. Filenames
 * are classified via `lib/versioning.ts` into released / candidate /
 * scratch / other.
 *
 * Lazy active-state detection is implemented here: walk a skill's run
 * logs newest-first; the first releasable full-skill run log whose
 * snapshot matches the current repo state is the active one.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { repoRoot, runlogsUnitDir } from '../paths';
import { diffSnapshotVsDisk, hashFile, normalize } from '../snapshot';
import { annFilenameFor, classify, sortNewestFirst } from '../versioning';
import type { RunLogFile, RunLogListEntry, AnnotationFile } from '../types';

/**
 * Walk the runlogs tree, yielding parsed run logs + metadata.
 * Skips `.ann.json` sidecars and `runs/` sidecar directories.
 */
async function* walkRunLogs(): AsyncGenerator<{
  filePath: string;
  skill: string;
  filename: string;
  raw: unknown;
  corrupt: boolean;
}> {
  const root = runlogsUnitDir();
  let skillDirs: string[];
  try {
    skillDirs = await fs.readdir(root);
  } catch {
    return;
  }
  for (const skill of skillDirs) {
    const skillPath = path.join(root, skill);
    const skillStat = await fs.stat(skillPath).catch(() => null);
    if (!skillStat?.isDirectory()) continue;
    const files = await fs.readdir(skillPath).catch(() => [] as string[]);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      if (file.endsWith('.ann.json')) continue;
      const c = classify(file);
      if (c.kind === 'other') continue;
      const filePath = path.join(skillPath, file);
      try {
        const raw = JSON.parse(await fs.readFile(filePath, 'utf8'));
        yield { filePath, skill, filename: file, raw, corrupt: false };
      } catch {
        yield { filePath, skill, filename: file, raw: null, corrupt: true };
      }
    }
  }
}

function weightedMean(log: RunLogFile): number | null {
  // N/A (null) scores — used by Tool Arguments when zero MCP calls
  // happened — are excluded; they represent "no signal" not "0/3."
  const scores: number[] = [];
  for (const t of log.tests) {
    for (const d of t.outcome_summary.aggregated_dimensions) {
      if (d.score !== null) scores.push(d.score);
    }
  }
  if (scores.length === 0) return null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

function runLogIdFromPath(filePath: string): string {
  const root = runlogsUnitDir();
  const rel = path.relative(root, filePath);
  // <skill>/<file>.json -> <skill>/<file>
  return rel.replace(/\\/g, '/').replace(/\.json$/, '');
}

async function isAnnotated(filePath: string): Promise<boolean> {
  const annPath = filePath.replace(/\.json$/, '.ann.json');
  try {
    await fs.access(annPath);
    return true;
  } catch {
    return false;
  }
}

/** True iff every dimension in every test has a correction entry. */
function isAnnotationComplete(log: RunLogFile, ann: AnnotationFile | null): boolean {
  if (!ann) return false;
  const have = new Set(
    ann.corrections.map(
      (c) => `${c.test_id}|${c.dimension_source}|${c.dimension_name}`,
    ),
  );
  for (const t of log.tests) {
    for (const d of t.outcome_summary.aggregated_dimensions) {
      const key = `${t.test_id}|${d.source}|${d.name}`;
      if (!have.has(key)) return false;
    }
  }
  return true;
}

async function readAnnotationAt(filePath: string): Promise<AnnotationFile | null> {
  const annPath = filePath.replace(/\.json$/, '.ann.json');
  try {
    const raw = await fs.readFile(annPath, 'utf8');
    return JSON.parse(raw) as AnnotationFile;
  } catch {
    return null;
  }
}

function rawToRunLog(raw: unknown): RunLogFile {
  // Schema v2 only — pass-through with shallow type assertion. The Zod
  // validator in the API route catches malformed shapes.
  return raw as RunLogFile;
}

export interface ListRunLogsOptions {
  skill?: string;
  /** When true, only releasable (full-skill) run logs. */
  releasableOnly?: boolean;
}

export interface ListRunLogsResult {
  runs: RunLogListEntry[];
  corrupt: string[];
}

export async function listRunLogs(opts: ListRunLogsOptions = {}): Promise<ListRunLogsResult> {
  const runs: RunLogListEntry[] = [];
  const corrupt: string[] = [];
  for await (const item of walkRunLogs()) {
    if (item.corrupt) {
      corrupt.push(item.filePath);
      continue;
    }
    if (opts.skill && item.skill !== opts.skill) continue;

    const log = rawToRunLog(item.raw);
    if (opts.releasableOnly && !log.releasable) continue;

    const c = classify(item.filename);
    const annotated = await isAnnotated(item.filePath);
    const ann = annotated ? await readAnnotationAt(item.filePath) : null;
    runs.push({
      id: runLogIdFromPath(item.filePath),
      skill: log.skill,
      kind: c.kind,
      version: log.version,
      released: log.released,
      releasable: log.releasable,
      invocation: log.invocation,
      timestamp: log.timestamp,
      model: log.model,
      testCount: log.tests.length,
      weightedMean: weightedMean(log),
      annotated,
      annotationComplete: isAnnotationComplete(log, ann),
      filePath: item.filePath,
    });
  }
  // Sort within each skill: newest first using lib/versioning.sortNewestFirst.
  runs.sort((a, b) => {
    if (a.skill !== b.skill) return a.skill.localeCompare(b.skill);
    return sortNewestFirst(path.basename(a.filePath), path.basename(b.filePath));
  });
  return { runs, corrupt };
}

/**
 * Read a single run log by `<skill>/<filename-without-ext>` id.
 * Returns null on missing or corrupt input.
 */
export async function readRunLogById(
  id: string,
): Promise<{ runLog: RunLogFile; filePath: string } | null> {
  const filePath = path.join(runlogsUnitDir(), `${id}.json`);
  try {
    const raw = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return { runLog: rawToRunLog(raw), filePath };
  } catch {
    return null;
  }
}

/**
 * List run logs for a given skill, sorted newest-first.
 */
export async function listRunLogsForSkill(
  skill: string,
): Promise<{ runs: Array<{ id: string; log: RunLogFile; filePath: string; filename: string }>; corrupt: string[] }> {
  const dir = path.join(runlogsUnitDir(), skill);
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return { runs: [], corrupt: [] };
  }
  const runs: Array<{ id: string; log: RunLogFile; filePath: string; filename: string }> = [];
  const corrupt: string[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    if (file.endsWith('.ann.json')) continue;
    if (classify(file).kind === 'other') continue;
    const filePath = path.join(dir, file);
    try {
      const raw = JSON.parse(await fs.readFile(filePath, 'utf8'));
      runs.push({
        id: runLogIdFromPath(filePath),
        log: rawToRunLog(raw),
        filePath,
        filename: file,
      });
    } catch {
      corrupt.push(filePath);
    }
  }
  runs.sort((a, b) => sortNewestFirst(a.filename, b.filename));
  return { runs, corrupt };
}

/**
 * Active-state detection for a single skill.
 *
 * Walks releasable (full-skill) run logs newest-first; the first whose
 * snapshot matches the current repo state is the active one. Scratch
 * runs are never active (incomplete snapshots). Returns null when no
 * run log matches.
 *
 * `judge_prompt_hash` mismatch does NOT disqualify a match (warn-only
 * per plan §C6 Rule 2b); the result includes `judgePromptDrift` so the
 * UI can surface a note next to the active badge.
 */
export interface ActiveRunLog {
  id: string;
  filename: string;
  log: RunLogFile;
  /** True iff the run log's judge_prompt_hash differs from current judge prompt. */
  judgePromptDrift: boolean;
}

export async function detectActiveRunLog(skill: string): Promise<ActiveRunLog | null> {
  const { runs } = await listRunLogsForSkill(skill);
  const root = repoRoot();
  const judgePromptPath = path.join(root, 'eval', 'harness', 'judge', 'prompt.md');
  const currentJudgeHash = await hashFile('eval/harness/judge/prompt.md', judgePromptPath);

  for (const r of runs) {
    if (!r.log.releasable) continue;
    const diff = await diffSnapshotVsDisk(r.log.snapshot, root);
    if (Object.keys(diff).length === 0) {
      return {
        id: r.id,
        filename: r.filename,
        log: r.log,
        judgePromptDrift:
          !!r.log.judge_prompt_hash &&
          !!currentJudgeHash &&
          r.log.judge_prompt_hash !== currentJudgeHash,
      };
    }
  }
  return null;
}

/**
 * Per-skill list of run logs with active flag marked. Used by the
 * results/[skill] list view.
 */
export interface SkillRunLogList {
  skill: string;
  active: ActiveRunLog | null;
  runs: Array<RunLogListEntry & { active: boolean }>;
  corrupt: string[];
}

export async function listRunLogsForSkillWithActive(skill: string): Promise<SkillRunLogList> {
  const { runs, corrupt } = await listRunLogs({ skill });
  const active = await detectActiveRunLog(skill);
  return {
    skill,
    active,
    runs: runs.map((r) => ({ ...r, active: active?.id === r.id })),
    corrupt,
  };
}

/**
 * Headline weighted-mean across an entire run log (every dimension in
 * every test). Exposed for the comparison view's headline computation.
 */
export function runLogWeightedMean(log: RunLogFile): number | null {
  return weightedMean(log);
}

export function runLogHistogram(log: RunLogFile): { 1: number; 2: number; 3: number } {
  const h: { 1: number; 2: number; 3: number } = { 1: 0, 2: 0, 3: 0 };
  for (const t of log.tests) {
    for (const d of t.outcome_summary.aggregated_dimensions) {
      if (d.score !== null) h[d.score] += 1;
    }
  }
  return h;
}

/**
 * Read run logs under `eval/runlogs/unit/<skill>/<model>/<file>.json`.
 *
 * Sibling `.ann.json` files indicate the run log is annotated.
 *
 * Legacy normalization: older run logs carry `score` as a string enum
 * ("pass"/"partial"/"fail"); the current schema is integer 1-3. We
 * normalize at read time so the UI only ever sees integers.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { runlogsUnitDir } from '../paths';
import type { RunLogDimension, RunLogFile, RunLogListEntry, Score } from '../types';

const RUN_LOG_FILENAME_RE = /^[^.].*\.json$/;

function normalizeScore(value: unknown): Score {
  if (typeof value === 'number') {
    if (value === 1 || value === 2 || value === 3) return value;
  }
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (lower === 'pass') return 3;
    if (lower === 'partial') return 2;
    if (lower === 'fail') return 1;
  }
  // Fallback for unknown: treat as fail to surface the issue without
  // crashing the entire grid.
  return 1;
}

function normalizeDimensions(dims: unknown): RunLogDimension[] {
  if (!Array.isArray(dims)) return [];
  return dims.map((d) => {
    const src = (d?.source as string) ?? 'base';
    return {
      source: src === 'base' || src === 'rubric' || src === 'criteria' ? src : 'base',
      name: String(d?.name ?? ''),
      score: normalizeScore(d?.score),
      rationale: typeof d?.rationale === 'string' ? d.rationale : '',
    };
  });
}

/**
 * Walk the runlogs tree and yield raw JSON path + parsed payload pairs.
 * Skips files that fail to parse — caller decides what to do.
 */
async function* walkRunLogs(): AsyncGenerator<{ filePath: string; skill: string; model: string; raw: unknown; corrupt: boolean }> {
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
    const modelDirs = await fs.readdir(skillPath).catch(() => [] as string[]);
    for (const model of modelDirs) {
      const modelPath = path.join(skillPath, model);
      const modelStat = await fs.stat(modelPath).catch(() => null);
      if (!modelStat?.isDirectory()) continue;
      const files = await fs.readdir(modelPath).catch(() => [] as string[]);
      for (const file of files) {
        if (!RUN_LOG_FILENAME_RE.test(file)) continue;
        if (file.endsWith('.ann.json')) continue;
        const filePath = path.join(modelPath, file);
        try {
          const raw = JSON.parse(await fs.readFile(filePath, 'utf8'));
          yield { filePath, skill, model, raw, corrupt: false };
        } catch {
          yield { filePath, skill, model, raw: null, corrupt: true };
        }
      }
    }
  }
}

function weightedMean(dims: RunLogDimension[]): number | null {
  if (dims.length === 0) return null;
  const sum = dims.reduce((acc, d) => acc + d.score, 0);
  return sum / dims.length;
}

function runLogIdFromPath(filePath: string): string {
  const root = runlogsUnitDir();
  const rel = path.relative(root, filePath);
  // skill/model/file.json -> skill/model/file
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

function rawToRunLog(raw: unknown): RunLogFile {
  const r = raw as Record<string, unknown>;
  const summary = (r.outcome_summary as Record<string, unknown> | undefined) ?? {};
  const aggregated = normalizeDimensions(summary.aggregated_dimensions);
  const perRun = Array.isArray(summary.per_run_outcomes) ? (summary.per_run_outcomes as RunLogFile['outcome_summary']['per_run_outcomes']) : [];

  const runsRaw = Array.isArray(r.runs) ? (r.runs as Array<Record<string, unknown>>) : [];
  const runs = runsRaw.map((run): RunLogFile['runs'][number] => {
    const judge = (run.judge as Record<string, unknown> | undefined) ?? {};
    return {
      ...(run as object),
      run_index: typeof run.run_index === 'number' ? run.run_index : 0,
      run_id: typeof run.run_id === 'string' ? run.run_id : '',
      outcome: (run.outcome as RunLogFile['runs'][number]['outcome']) ?? 'pass',
      aborted_reason: (run.aborted_reason as string | null) ?? null,
      duration_ms: typeof run.duration_ms === 'number' ? run.duration_ms : 0,
      judge: {
        skipped: Boolean(judge.skipped),
        dimensions: normalizeDimensions(judge.dimensions),
        judge_cost_usd: typeof judge.judge_cost_usd === 'number' ? judge.judge_cost_usd : 0,
        input_tokens: typeof judge.input_tokens === 'number' ? judge.input_tokens : undefined,
        cached_input_tokens: typeof judge.cached_input_tokens === 'number' ? judge.cached_input_tokens : undefined,
        output_tokens: typeof judge.output_tokens === 'number' ? judge.output_tokens : undefined,
        error: (judge.error as string | null | undefined) ?? null,
      },
    } as RunLogFile['runs'][number];
  });

  return {
    ...(r as unknown as RunLogFile),
    outcome_summary: { per_run_outcomes: perRun, aggregated_dimensions: aggregated },
    runs,
  };
}

export interface ListRunLogsOptions {
  skill?: string;
  model?: string;
  /** Filter to annotated / unannotated. Omit for both. */
  annotated?: boolean;
  /** ISO date filter (inclusive). Compared against the run log's `timestamp`. */
  dateFrom?: string;
  dateTo?: string;
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
    if (opts.model && item.model !== opts.model) continue;

    const log = rawToRunLog(item.raw);
    if (opts.dateFrom && log.timestamp < opts.dateFrom) continue;
    if (opts.dateTo && log.timestamp > opts.dateTo) continue;

    const annotated = await isAnnotated(item.filePath);
    if (opts.annotated !== undefined && annotated !== opts.annotated) continue;

    runs.push({
      id: runLogIdFromPath(item.filePath),
      skill: item.skill,
      model: item.model,
      timestamp: log.timestamp,
      outcome: log.outcome,
      flaky: log.flaky,
      weightedMean: weightedMean(log.outcome_summary.aggregated_dimensions),
      annotated,
      testId: log.test_id,
      filePath: item.filePath,
    });
  }
  runs.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
  return { runs, corrupt };
}

export async function readRunLogById(id: string): Promise<{ runLog: RunLogFile; filePath: string } | null> {
  const filePath = path.join(runlogsUnitDir(), `${id}.json`);
  try {
    const raw = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return { runLog: rawToRunLog(raw), filePath };
  } catch {
    return null;
  }
}

/**
 * For the comparison view: list run logs in a given
 * `<skill>/<model>/` directory, sorted timestamp descending.
 */
export async function listRunLogsInDir(skill: string, model: string): Promise<{ runs: Array<{ id: string; log: RunLogFile; filePath: string }>; corrupt: string[] }> {
  const dir = path.join(runlogsUnitDir(), skill, model);
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return { runs: [], corrupt: [] };
  }
  const runs: Array<{ id: string; log: RunLogFile; filePath: string }> = [];
  const corrupt: string[] = [];
  for (const file of files) {
    if (!RUN_LOG_FILENAME_RE.test(file)) continue;
    if (file.endsWith('.ann.json')) continue;
    const filePath = path.join(dir, file);
    try {
      const raw = JSON.parse(await fs.readFile(filePath, 'utf8'));
      runs.push({ id: runLogIdFromPath(filePath), log: rawToRunLog(raw), filePath });
    } catch {
      corrupt.push(filePath);
    }
  }
  runs.sort((a, b) => (a.log.timestamp < b.log.timestamp ? 1 : a.log.timestamp > b.log.timestamp ? -1 : 0));
  return { runs, corrupt };
}

export function runLogWeightedMean(log: RunLogFile): number | null {
  return weightedMean(log.outcome_summary.aggregated_dimensions);
}

/**
 * For the comparison-view banner: count of 1/2/3 scores across all
 * aggregated dimensions on a run log.
 */
export function runLogHistogram(log: RunLogFile): { 1: number; 2: number; 3: number } {
  const h = { 1: 0, 2: 0, 3: 0 };
  for (const d of log.outcome_summary.aggregated_dimensions) {
    h[d.score] += 1;
  }
  return h;
}

/**
 * Run-log filename classification — TypeScript mirror of
 * eval/harness/harness/versioning.py.
 *
 * Three kinds of run log live in `eval/runlogs/unit/<skill>/`:
 *   - `v{N}.json`                              released
 *   - `v{N}_{YYYY-MM-DD-HH-MM-SS}.json`        candidate
 *   - `scratch_{YYYY-MM-DD-HH-MM-SS}.json`     scratch (gitignored)
 *
 * See docs/plan/eval-runlog-versioning.md §A3, §A5, §A6.
 */
import type { RunLogClassification } from './types';

const TIMESTAMP = '\\d{4}-\\d{2}-\\d{2}-\\d{2}-\\d{2}-\\d{2}';

const RELEASED_RE = new RegExp(`^v(\\d+)\\.json$`);
const CANDIDATE_RE = new RegExp(`^v(\\d+)_(${TIMESTAMP})\\.json$`);
const SCRATCH_RE = new RegExp(`^scratch_(${TIMESTAMP})\\.json$`);

const RELEASED_ANN_RE = new RegExp(`^v(\\d+)\\.ann\\.json$`);
const CANDIDATE_ANN_RE = new RegExp(`^v(\\d+)_(${TIMESTAMP})\\.ann\\.json$`);
const SCRATCH_ANN_RE = new RegExp(`^scratch_(${TIMESTAMP})\\.ann\\.json$`);

export function classify(filename: string): RunLogClassification {
  let m = filename.match(RELEASED_RE);
  if (m) return { kind: 'released', version: Number(m[1]), timestamp: null };
  m = filename.match(CANDIDATE_RE);
  if (m) return { kind: 'candidate', version: Number(m[1]), timestamp: m[2] };
  m = filename.match(SCRATCH_RE);
  if (m) return { kind: 'scratch', version: null, timestamp: m[1] };
  return { kind: 'other', version: null, timestamp: null };
}

export function classifyAnn(filename: string): RunLogClassification {
  let m = filename.match(RELEASED_ANN_RE);
  if (m) return { kind: 'released', version: Number(m[1]), timestamp: null };
  m = filename.match(CANDIDATE_ANN_RE);
  if (m) return { kind: 'candidate', version: Number(m[1]), timestamp: m[2] };
  m = filename.match(SCRATCH_ANN_RE);
  if (m) return { kind: 'scratch', version: null, timestamp: m[1] };
  return { kind: 'other', version: null, timestamp: null };
}

/**
 * Return the `.ann.json` filename for the given run-log filename.
 * Throws on inputs that don't end in `.json`.
 */
export function annFilenameFor(runlogFilename: string): string {
  if (!runlogFilename.endsWith('.json')) {
    throw new Error(`not a run log filename: ${runlogFilename}`);
  }
  return runlogFilename.slice(0, -'.json'.length) + '.ann.json';
}

/**
 * Sort key for "newest first" ordering. Released `v{N}.json` sorts as
 * if its timestamp were "infinity for version N"; candidate `v{N}_<ts>`
 * sorts by (N, ts); scratch sorts by ts only.
 *
 * For the active-state walk we want, per the plan: "Walk newest first;
 * the first full-skill match wins."
 */
export function sortNewestFirst(a: string, b: string): number {
  const ca = classify(a);
  const cb = classify(b);
  // released > candidate > scratch > other within the same skill bucket
  const KIND_RANK: Record<string, number> = {
    released: 3,
    candidate: 2,
    scratch: 1,
    other: 0,
  };
  if (KIND_RANK[ca.kind] !== KIND_RANK[cb.kind]) {
    return KIND_RANK[cb.kind] - KIND_RANK[ca.kind];
  }
  if (ca.kind === 'released' && cb.kind === 'released') {
    return (cb.version ?? 0) - (ca.version ?? 0);
  }
  if (ca.kind === 'candidate' && cb.kind === 'candidate') {
    const vDiff = (cb.version ?? 0) - (ca.version ?? 0);
    if (vDiff !== 0) return vDiff;
    return (cb.timestamp ?? '').localeCompare(ca.timestamp ?? '');
  }
  // scratch or other
  return (cb.timestamp ?? '').localeCompare(ca.timestamp ?? '');
}

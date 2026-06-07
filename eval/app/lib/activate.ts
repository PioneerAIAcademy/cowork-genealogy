/**
 * Activate: write a run log's snapshot back to the repo.
 *
 * Skill-only scope — the snapshot covers `packages/engine/plugin/skills/<skill>/**`,
 * `eval/tests/unit/<skill>/**`, and the referenced scenarios/fixtures.
 * `eval/harness/judge/prompt.md` is NOT touched (it's global and lives
 * outside the snapshot).
 *
 * No git integration — this just overwrites files. Callers manage
 * uncommitted-state confirmation in the UI.
 *
 * See docs/plan/eval-runlog-versioning.md §B4.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from './paths';
import { atomicWriteText } from './fs/atomic';
import type { RunLogFile } from './types';

export interface ActivatePreview {
  /** Files that will be created or overwritten. */
  willWrite: string[];
}

export function previewActivate(log: RunLogFile): ActivatePreview {
  return { willWrite: Object.keys(log.snapshot).sort() };
}

/**
 * Restore every snapshot file to its repo path. Returns the list of
 * paths written (relative to repo root).
 *
 * Scratch runs are not activatable — `releasable: false` raises.
 */
export async function activateRunLog(log: RunLogFile): Promise<string[]> {
  if (!log.releasable) {
    throw new Error(
      'cannot activate a non-releasable (scratch) run log: snapshot is incomplete',
    );
  }
  const root = repoRoot();
  const written: string[] = [];
  for (const [rel, content] of Object.entries(log.snapshot)) {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await atomicWriteText(abs, content);
    written.push(rel);
  }
  return written.sort();
}

/**
 * Release: rename `v{N}_<ts>.json` (candidate) → `v{N}.json` (released).
 *
 * Also renames the matching `.ann.json` sibling. The run log JSON's
 * `released: false` field is flipped to `true` and `timestamp` is kept
 * (it stays "when the run happened," not "when it was released").
 *
 * Refuses to release unless:
 *   - The file is a candidate (`v{N}_<ts>.json`).
 *   - It has a sibling `.ann.json`.
 *   - The annotation is complete (every dimension in every test has an
 *     entry). The caller verifies completeness via lib/fs/annotations.
 *   - Target `v{N}.json` does not already exist.
 *
 * See docs/plan/eval-runlog-versioning.md §B5.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { runlogsUnitDir } from './paths';
import { atomicWriteText } from './fs/atomic';
import { annFilenameFor, classify } from './versioning';
import type { RunLogFile } from './types';

export interface ReleaseResult {
  newRunLogPath: string;
  newAnnPath: string;
  newRunLogId: string;
}

export async function releaseRunLog(runLogId: string): Promise<ReleaseResult> {
  const [skill, ...rest] = runLogId.split('/');
  if (!skill || rest.length === 0) {
    throw new Error(`invalid run log id: ${runLogId}`);
  }
  const filename = `${rest.join('/')}.json`;
  const dir = path.join(runlogsUnitDir(), skill);
  const fromPath = path.join(dir, filename);
  const fromAnnPath = path.join(dir, annFilenameFor(filename));

  const c = classify(filename);
  if (c.kind !== 'candidate' || c.version == null) {
    throw new Error(`only candidate runs are releasable: ${filename}`);
  }

  // Sibling annotation must exist.
  try {
    await fs.access(fromAnnPath);
  } catch {
    throw new Error(`missing annotation file: ${path.basename(fromAnnPath)}`);
  }

  const toFilename = `v${c.version}.json`;
  const toAnnFilename = `v${c.version}.ann.json`;
  const toPath = path.join(dir, toFilename);
  const toAnnPath = path.join(dir, toAnnFilename);

  try {
    await fs.access(toPath);
    throw new Error(`release target already exists: ${toFilename}`);
  } catch (e) {
    // Only the "already exists" branch above is fatal; ENOENT means we're fine.
    if ((e as { code?: string }).code !== 'ENOENT') {
      // Re-throw if it's not the "missing file" error.
      if (!(e as Error).message?.includes('release target already exists')) {
        // continue
      } else {
        throw e;
      }
    }
  }

  // Read the candidate run log, flip `released: true`, write at new
  // location atomically, then unlink the old. .ann file is renamed
  // in place (its contents don't change).
  const raw = await fs.readFile(fromPath, 'utf8');
  const log = JSON.parse(raw) as RunLogFile;
  log.released = true;
  // Also update the .ann.json's run_log field to point at the new name.
  const annRaw = await fs.readFile(fromAnnPath, 'utf8');
  const ann = JSON.parse(annRaw) as { run_log: string };
  ann.run_log = toFilename;

  await atomicWriteText(toPath, JSON.stringify(log, null, 2));
  await atomicWriteText(toAnnPath, JSON.stringify(ann, null, 2));
  await fs.rm(fromPath, { force: true });
  await fs.rm(fromAnnPath, { force: true });

  return {
    newRunLogPath: toPath,
    newAnnPath: toAnnPath,
    newRunLogId: `${skill}/${toFilename.replace(/\.json$/, '')}`,
  };
}

/**
 * Delete a candidate run log (and its sibling annotation) from disk.
 * Refuses to delete released `v{N}.json` files.
 */
export async function deleteCandidate(runLogId: string): Promise<void> {
  const [skill, ...rest] = runLogId.split('/');
  if (!skill || rest.length === 0) {
    throw new Error(`invalid run log id: ${runLogId}`);
  }
  const filename = `${rest.join('/')}.json`;
  const c = classify(filename);
  if (c.kind === 'released') {
    throw new Error(`cannot delete released run log: ${filename}`);
  }
  const dir = path.join(runlogsUnitDir(), skill);
  const filePath = path.join(dir, filename);
  const annPath = path.join(dir, annFilenameFor(filename));
  await fs.rm(filePath, { force: true });
  await fs.rm(annPath, { force: true });
}

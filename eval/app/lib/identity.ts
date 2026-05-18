/**
 * Identity resolution.
 *
 * Order:
 *   1. `eval/app/.local/identity.json` (set explicitly by a POST).
 *   2. `git config user.email` (async via execFile, not execSync —
 *      keeps the event loop unblocked).
 *   3. null (the client opens a modal to capture one).
 *
 * Cached in module-level memory for the process lifetime.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appLocalDir, repoRoot } from './paths';
import { atomicWriteJson } from './fs/atomic';

const execFileAsync = promisify(execFile);

let cached: string | null | undefined;

function identityPath(): string {
  return path.join(appLocalDir(), 'identity.json');
}

async function readStored(): Promise<string | null> {
  try {
    const raw = await fs.readFile(identityPath(), 'utf8');
    const parsed = JSON.parse(raw) as { annotator?: string };
    return typeof parsed.annotator === 'string' && parsed.annotator.trim() !== '' ? parsed.annotator : null;
  } catch {
    return null;
  }
}

async function readGitConfig(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['config', 'user.email'], { cwd: repoRoot() });
    const trimmed = stdout.trim();
    return trimmed === '' ? null : trimmed;
  } catch {
    return null;
  }
}

export async function getIdentity(): Promise<string | null> {
  if (cached !== undefined) return cached;
  const stored = await readStored();
  if (stored) {
    cached = stored;
    return cached;
  }
  const git = await readGitConfig();
  cached = git;
  return cached;
}

export async function setIdentity(annotator: string): Promise<void> {
  await atomicWriteJson(identityPath(), { annotator });
  cached = annotator;
}

export function _clearIdentityCacheForTests(): void {
  cached = undefined;
}

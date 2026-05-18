/**
 * Atomic file write: write to `foo.json.tmp`, then `rename` over
 * `foo.json`. Prevents half-written files when a process dies mid-save
 * or a `git pull` collides.
 *
 * On Windows, antivirus/OneDrive/Dropbox routinely hold transient file
 * handles. Retry the rename on EBUSY/EPERM (3 attempts, 50ms backoff).
 * Most `eval/` users are on Windows.
 *
 * No `fsync`: losing the last 50ms to a power cut is acceptable for
 * eval data (junior re-enters), and Windows fsync semantics on
 * directories is a portability headache.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_RENAME_ATTEMPTS = 3;
const RENAME_BACKOFF_MS = 50;

const RETRYABLE_RENAME_ERRORS = new Set(['EBUSY', 'EPERM', 'EACCES']);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function atomicWriteJson(
  filePath: string,
  data: unknown,
  opts: { pretty?: boolean } = {},
): Promise<void> {
  const json = opts.pretty === false ? JSON.stringify(data) : JSON.stringify(data, null, 2) + '\n';
  await atomicWriteText(filePath, json);
}

export async function atomicWriteText(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  // Suffix with PID + counter to avoid collisions if two processes
  // happen to write the same target concurrently (very rare in this
  // single-editor app, but cheap insurance).
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmpPath, content, 'utf8');

  let attempts = 0;
  while (true) {
    attempts += 1;
    try {
      await fs.rename(tmpPath, filePath);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (RETRYABLE_RENAME_ERRORS.has(code ?? '') && attempts < MAX_RENAME_ATTEMPTS) {
        await sleep(RENAME_BACKOFF_MS);
        continue;
      }
      // Best-effort cleanup of the temp file.
      try {
        await fs.unlink(tmpPath);
      } catch {
        /* swallow */
      }
      throw err;
    }
  }
}

// Exposed for tests that need to assert retry behavior.
export const __test = {
  MAX_RENAME_ATTEMPTS,
  RENAME_BACKOFF_MS,
};

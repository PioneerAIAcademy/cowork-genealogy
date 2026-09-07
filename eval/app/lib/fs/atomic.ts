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

// Monotonic within a process. Appended to the temp-file suffix so two writes
// to the same target inside one millisecond (Date.now() resolution) get
// distinct temp paths instead of colliding on one, which corrupted the target
// (both open O_TRUNC from offset 0; one rename wins, the other ENOENTs).
let tmpCounter = 0;

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

  // Suffix with PID + timestamp + counter to avoid collisions if two writes
  // hit the same target concurrently. Two saves within one millisecond share a
  // Date.now() value, so the counter is what actually keeps their temp paths
  // apart — without it the shorter payload overwrites the head of the longer
  // and the target ends up holding two spliced JSON documents.
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${tmpCounter++}`;
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

/**
 * Run-log snapshot normalization + diff helpers (TypeScript mirror of
 * eval/harness/harness/snapshot.py).
 *
 * The `normalize(path, content) → string` contract must produce byte-
 * identical canonical text on both sides — Python on the harness side,
 * TypeScript here on the CRUD UI / GH Action side. Shared test vectors
 * in `tests/unit/snapshot.test.ts` and `tests/unit/test_snapshot.py`
 * lock the contract.
 *
 * See docs/plan/eval-runlog-versioning.md §A7.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const COSMETIC_TEST_FIELDS = ['name', 'description', 'tags'] as const;
const JSON_EXTS = new Set(['.json']);
const TEXT_EXTS = new Set([
  '.md',
  '.txt',
  '.yaml',
  '.yml',
  '.py',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.css',
  '.html',
  '.sh',
  '.toml',
]);

function extOf(p: string): string {
  const dot = p.lastIndexOf('.');
  if (dot < 0) return '';
  return p.slice(dot).toLowerCase();
}

function isTestJsonPath(p: string): boolean {
  return p.startsWith('eval/tests/unit/') && p.endsWith('.json');
}

function stripCosmeticTestFields<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  // Deep copy, then strip.
  const cloned = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
  const testBlock = cloned.test as Record<string, unknown> | undefined;
  if (testBlock && typeof testBlock === 'object' && !Array.isArray(testBlock)) {
    for (const k of COSMETIC_TEST_FIELDS) {
      delete testBlock[k];
    }
  }
  return cloned as T;
}

/**
 * Canonical JSON re-emit with sorted keys, indent=2, trailing newline.
 * Matches Python's `json.dumps(obj, sort_keys=True, indent=2,
 * ensure_ascii=False)` + trailing `\n`.
 */
function canonicalJson(obj: unknown): string {
  return JSON.stringify(sortKeysDeep(obj), null, 2) + '\n';
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>).sort();
    for (const k of keys) {
      sorted[k] = sortKeysDeep((value as Record<string, unknown>)[k]);
    }
    return sorted;
  }
  return value;
}

function normalizeText(content: string | Buffer): string {
  let text = typeof content === 'string' ? content : content.toString('utf-8');
  // CRLF / CR → LF
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (text && !text.endsWith('\n')) text += '\n';
  return text;
}

/**
 * Canonical text form of the given file's content. Must match the
 * Python `normalize()` contract.
 */
export function normalize(repoRelativePath: string, content: string | Buffer): string {
  const ext = extOf(repoRelativePath);

  if (JSON_EXTS.has(ext)) {
    let parsed: unknown;
    try {
      const text = typeof content === 'string' ? content : content.toString('utf-8');
      parsed = JSON.parse(text);
    } catch {
      return normalizeText(content);
    }
    if (isTestJsonPath(repoRelativePath) && parsed && typeof parsed === 'object') {
      parsed = stripCosmeticTestFields(parsed);
    }
    return canonicalJson(parsed);
  }

  if (TEXT_EXTS.has(ext)) {
    return normalizeText(content);
  }

  // Unknown extension: try UTF-8 decode.
  if (typeof content === 'string') return content;
  return content.toString('utf-8');
}

export function hashContent(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf-8').digest('hex');
}

/**
 * Hash a file's normalized content. Returns `""` when the file is
 * missing (mirrors Python `hash_file()`).
 */
export async function hashFile(repoRelativePath: string, absPath: string): Promise<string> {
  try {
    const bytes = await fs.readFile(absPath);
    return hashContent(normalize(repoRelativePath, bytes));
  } catch {
    return '';
  }
}

export function hashSnapshot(snapshot: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [p, c] of Object.entries(snapshot)) {
    out[p] = hashContent(c);
  }
  return out;
}

/**
 * Compare snapshot against on-disk files under `repoRoot`. Returns a
 * `{path: reason}` map of mismatches. Mirrors Python's
 * `diff_snapshot_vs_disk()`.
 */
export async function diffSnapshotVsDisk(
  snapshot: Record<string, string>,
  repoRoot: string,
): Promise<Record<string, 'missing-on-disk' | 'content-differs'>> {
  const out: Record<string, 'missing-on-disk' | 'content-differs'> = {};
  for (const [rel, expected] of Object.entries(snapshot)) {
    const absPath = path.join(repoRoot, rel);
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(absPath);
    } catch {
      out[rel] = 'missing-on-disk';
      continue;
    }
    const actual = normalize(rel, bytes);
    if (actual !== expected) {
      out[rel] = 'content-differs';
    }
  }
  return out;
}

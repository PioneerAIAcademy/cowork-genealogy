import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { atomicWriteJson, atomicWriteText } from '../../lib/fs/atomic';

describe('atomicWriteJson — happy temp+rename', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('writes JSON to the target path on a fresh write', async () => {
    const file = path.join(tmpDir, 'sub', 'data.json');
    const payload = { hello: 'world', n: 1 };

    await atomicWriteJson(file, payload);

    const onDisk = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(onDisk).toEqual(payload);
  });

  it('overwrites an existing file atomically (no .tmp left behind)', async () => {
    const file = path.join(tmpDir, 'data.json');
    await fs.writeFile(file, '{"old":true}', 'utf8');

    await atomicWriteJson(file, { fresh: true });

    const onDisk = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(onDisk).toEqual({ fresh: true });

    const siblings = await fs.readdir(tmpDir);
    expect(siblings.filter((s) => s.includes('.tmp'))).toHaveLength(0);
  });

  it('creates parent directories that do not yet exist', async () => {
    const file = path.join(tmpDir, 'a', 'b', 'c', 'deep.json');
    await atomicWriteJson(file, { ok: true });
    const onDisk = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(onDisk).toEqual({ ok: true });
  });
});

describe('atomicWriteText — EBUSY retry', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-retry-test-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('retries the rename on EBUSY and succeeds on attempt 2', async () => {
    const file = path.join(tmpDir, 'data.txt');

    const realRename = fs.rename.bind(fs);
    let renameCalls = 0;
    const spy = vi.spyOn(fs, 'rename').mockImplementation(async (...args: Parameters<typeof fs.rename>) => {
      renameCalls += 1;
      if (renameCalls === 1) {
        const err: NodeJS.ErrnoException = new Error('EBUSY: transient antivirus lock');
        err.code = 'EBUSY';
        throw err;
      }
      return realRename(...args);
    });

    await atomicWriteText(file, 'payload');

    expect(spy).toHaveBeenCalledTimes(2);
    const onDisk = await fs.readFile(file, 'utf8');
    expect(onDisk).toBe('payload');
  });

  it('exhausts retries and surfaces the EBUSY error', async () => {
    const file = path.join(tmpDir, 'data.txt');

    const spy = vi.spyOn(fs, 'rename').mockImplementation(async () => {
      const err: NodeJS.ErrnoException = new Error('EBUSY: stuck lock');
      err.code = 'EBUSY';
      throw err;
    });

    await expect(atomicWriteText(file, 'payload')).rejects.toMatchObject({ code: 'EBUSY' });

    // 3 attempts per the documented cap.
    expect(spy).toHaveBeenCalledTimes(3);

    // The target file must not exist (we never succeeded).
    await expect(fs.access(file)).rejects.toBeTruthy();

    // The .tmp file must have been cleaned up.
    const siblings = await fs.readdir(tmpDir);
    expect(siblings).toHaveLength(0);
  });
});

describe('atomicWriteText — concurrent writes to one target do not corrupt it', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-concurrent-test-'));
  });

  afterEach(async () => {
    // Restore the Date.now spy so it does not leak into any later describe.
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // Reproduces the .ann.json corruption: two saves in the same millisecond
  // share a Date.now() value, so without a per-write counter both temp paths
  // are identical. Pinning Date.now() to a constant makes the collision
  // deterministic. On unpatched atomic.ts one write's rename ENOENTs, so the
  // Promise.all rejects (all-must-resolve) — this test goes red. The counter
  // fixes it. The secondary assertions (valid JSON, one whole payload, no tmp
  // sibling) hold on unpatched code too, which is why the "both writes resolve"
  // assertion is the one that actually discriminates.
  it('both concurrent writes resolve, leaving one intact payload', async () => {
    const file = path.join(tmpDir, 'run.ann.json');
    const long = JSON.stringify({ corrections: Array.from({ length: 40 }, (_, i) => ({ i })) });
    const short = JSON.stringify({ corrections: [{ i: 0 }] });
    expect(long.length).toBeGreaterThan(short.length);

    // Force the same-millisecond collision every run.
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

    await expect(
      Promise.all([atomicWriteText(file, long), atomicWriteText(file, short)]),
    ).resolves.toBeDefined();

    const onDisk = await fs.readFile(file, 'utf8');
    expect([long, short]).toContain(onDisk); // exactly one whole payload, not a splice

    const siblings = await fs.readdir(tmpDir);
    expect(siblings.filter((s) => s.includes('.tmp'))).toHaveLength(0);
  });
});

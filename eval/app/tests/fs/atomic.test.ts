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

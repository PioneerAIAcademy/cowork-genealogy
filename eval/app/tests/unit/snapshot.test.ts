/**
 * Tests for lib/snapshot.ts — normalize() + hash + diff.
 *
 * The normalize() vectors must mirror eval/harness/tests/unit/test_snapshot.py
 * so Python and TypeScript produce byte-identical canonical output.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  agentRefsInText,
  diffSnapshotVsDisk,
  hashContent,
  hashFile,
  hashSnapshot,
  normalize,
} from '../../lib/snapshot';

// ---- agentRefsInText (shared vectors with test_snapshot.py) ---------------

describe('agentRefsInText', () => {
  it('dedupes and sorts @plugin: references', () => {
    const text =
      'Delegate to `@plugin:image-reader`, the same way /research invokes\n' +
      '`@plugin:gps-mentor`. Then call @plugin:gps-mentor again.\n';
    expect(agentRefsInText(text)).toEqual(['gps-mentor', 'image-reader']);
  });

  it('returns empty when there are no references', () => {
    expect(agentRefsInText('No delegation here. @plugin: alone is not a ref.')).toEqual([]);
  });

  it('stops at invalid characters', () => {
    expect(agentRefsInText('see @plugin:record-extractor.')).toEqual(['record-extractor']);
    expect(agentRefsInText('bad @plugin:Foo uppercase')).toEqual([]);
  });
});

// ---- normalize contract --------------------------------------------------

describe('normalize', () => {
  it('sorts JSON keys and pretty-prints with trailing newline', () => {
    const raw = Buffer.from('{"b": 2, "a": 1}');
    expect(normalize('eval/foo.json', raw)).toBe('{\n  "a": 1,\n  "b": 2\n}\n');
  });

  it('strips cosmetic test.* fields under eval/tests/unit/', () => {
    const raw = Buffer.from(
      JSON.stringify({
        test: {
          id: 'ut_001',
          name: 'human-readable name',
          description: 'longer prose',
          tags: ['foo'],
          skill: 'search-familysearch-wiki',
        },
        input: { user_message: 'do the thing' },
      }),
    );
    const out = normalize('eval/tests/unit/search-familysearch-wiki/ut_001.json', raw);
    const parsed = JSON.parse(out);
    expect(parsed.test.name).toBeUndefined();
    expect(parsed.test.description).toBeUndefined();
    expect(parsed.test.tags).toBeUndefined();
    expect(parsed.test.id).toBe('ut_001');
    expect(parsed.test.skill).toBe('search-familysearch-wiki');
  });

  it('does NOT strip cosmetic fields outside eval/tests/unit/', () => {
    const raw = Buffer.from(JSON.stringify({ test: { id: 'x', name: 'kept here' } }));
    const out = normalize('packages/engine/plugin/skills/foo/SKILL.json', raw);
    expect(out).toContain('kept here');
  });

  it('converts CRLF to LF in text files', () => {
    const raw = Buffer.from('line one\r\nline two\r\n');
    expect(normalize('packages/engine/plugin/skills/foo/SKILL.md', raw)).toBe('line one\nline two\n');
  });

  it('ensures trailing newline on text files', () => {
    const raw = Buffer.from('no newline at end');
    expect(normalize('packages/engine/plugin/skills/foo/SKILL.md', raw).endsWith('\n')).toBe(true);
  });

  it('is idempotent for text', () => {
    const raw = Buffer.from('already normalized\n');
    const out1 = normalize('foo.md', raw);
    const out2 = normalize('foo.md', Buffer.from(out1));
    expect(out2).toBe(out1);
  });

  it('is idempotent for JSON', () => {
    const raw = Buffer.from('{"x": 1, "y": [3, 1, 2]}');
    const out1 = normalize('eval/foo.json', raw);
    const out2 = normalize('eval/foo.json', Buffer.from(out1));
    expect(out2).toBe(out1);
  });
});

// ---- hash helpers --------------------------------------------------------

describe('hash helpers', () => {
  it('hashContent returns a 64-char hex SHA-256', () => {
    const h = hashContent('hello\n');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashFile returns empty string when missing', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'snap-'));
    try {
      const missing = path.join(dir, 'nope.md');
      expect(await hashFile('eval/nope.md', missing)).toBe('');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('hashFile matches normalize() output', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'snap-'));
    try {
      const f = path.join(dir, 'x.md');
      await fs.writeFile(f, Buffer.from('hi\r\n'));
      const h = await hashFile('packages/engine/plugin/skills/foo/x.md', f);
      expect(h).toBe(hashContent('hi\n'));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('hashSnapshot hashes each entry', () => {
    const out = hashSnapshot({ 'a.md': 'alpha\n', 'b.md': 'beta\n' });
    expect(out['a.md']).toBe(hashContent('alpha\n'));
    expect(out['b.md']).toBe(hashContent('beta\n'));
  });
});

// ---- diff vs disk --------------------------------------------------------

describe('diffSnapshotVsDisk', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'snap-diff-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('detects content change', async () => {
    await fs.writeFile(path.join(dir, 'skill.md'), 'original\n');
    const snapshot = { 'skill.md': 'original\n' };
    expect(await diffSnapshotVsDisk(snapshot, dir)).toEqual({});

    await fs.writeFile(path.join(dir, 'skill.md'), 'edited\n');
    expect(await diffSnapshotVsDisk(snapshot, dir)).toEqual({ 'skill.md': 'content-differs' });
  });

  it('detects missing file', async () => {
    expect(await diffSnapshotVsDisk({ 'missing.md': 'x\n' }, dir)).toEqual({
      'missing.md': 'missing-on-disk',
    });
  });

  it('normalizes CRLF on disk so it does not flap', async () => {
    await fs.writeFile(path.join(dir, 'skill.md'), Buffer.from('hello\r\n'));
    expect(await diffSnapshotVsDisk({ 'skill.md': 'hello\n' }, dir)).toEqual({});
  });

  it('ignores legacy packages/engine/mcp-server/src keys', async () => {
    await fs.writeFile(path.join(dir, 'skill.md'), 'body\n');
    // src/ file absent on disk and would differ — neither is flagged.
    const snapshot = {
      'skill.md': 'body\n',
      'packages/engine/mcp-server/src/constants.ts': "export const UA = 'old';\n",
    };
    expect(await diffSnapshotVsDisk(snapshot, dir)).toEqual({});
  });
});

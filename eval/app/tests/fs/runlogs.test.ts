/**
 * Tests for lib/fs/runlogs.ts — listing, reading, active-state detection.
 *
 * Schema v2: multi-test envelope at eval/runlogs/unit/<skill>/<filename>.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { buildRunLog, makeFixtureTree, type FixtureTreeHandle } from '../helpers/fixtureTree';
import {
  detectActiveRunLog,
  listRunLogs,
  listRunLogsForSkillWithActive,
  readRunLogById,
  runLogHistogram,
  runLogWeightedMean,
} from '../../lib/fs/runlogs';
import { normalize } from '../../lib/snapshot';

describe('runlogs — listing', () => {
  let handle: FixtureTreeHandle;

  beforeEach(async () => {
    handle = await makeFixtureTree({
      runlogs: [
        {
          skill: 'search-wiki',
          filename: 'v1.json',
          body: buildRunLog({
            skill: 'search-wiki',
            version: 1,
            released: true,
            timestamp: '2026-05-13_09-30-52',
          }),
        },
        {
          skill: 'search-wiki',
          filename: 'v2_2026-05-14_10-00-00.json',
          body: buildRunLog({
            skill: 'search-wiki',
            version: 2,
            timestamp: '2026-05-14_10-00-00',
          }),
          annotation: { run_log: 'v2_2026-05-14_10-00-00.json', annotator: 'a', corrections: [] },
        },
        {
          skill: 'locality-guide',
          filename: 'v1.json',
          body: buildRunLog({
            skill: 'locality-guide',
            version: 1,
            released: true,
            timestamp: '2026-05-15_09-00-00',
          }),
        },
      ],
    });
    process.env.EVAL_DIR = handle.root;
  });

  afterEach(async () => {
    delete process.env.EVAL_DIR;
    await handle.cleanup();
  });

  it('lists every run log, sorted by skill then newest-first', async () => {
    const { runs } = await listRunLogs();
    expect(runs.map((r) => r.id)).toEqual([
      'locality-guide/v1',
      'search-wiki/v1',
      'search-wiki/v2_2026-05-14_10-00-00',
    ]);
  });

  it('filters by skill', async () => {
    const { runs } = await listRunLogs({ skill: 'search-wiki' });
    expect(runs.map((r) => r.id)).toEqual([
      'search-wiki/v1',
      'search-wiki/v2_2026-05-14_10-00-00',
    ]);
  });

  it('classifies released / candidate kinds correctly', async () => {
    const { runs } = await listRunLogs({ skill: 'search-wiki' });
    expect(runs[0].kind).toBe('released');
    expect(runs[0].released).toBe(true);
    expect(runs[1].kind).toBe('candidate');
    expect(runs[1].released).toBe(false);
  });

  it('reports annotation presence', async () => {
    const { runs } = await listRunLogs({ skill: 'search-wiki' });
    expect(runs[0].annotated).toBe(false); // v1 has no ann
    expect(runs[1].annotated).toBe(true);
  });
});

describe('runlogs — read by id', () => {
  let handle: FixtureTreeHandle;

  beforeEach(async () => {
    handle = await makeFixtureTree({
      runlogs: [
        {
          skill: 'search-wiki',
          filename: 'v1.json',
          body: buildRunLog({ skill: 'search-wiki', version: 1, released: true, timestamp: '2026-05-13_09-30-52' }),
        },
      ],
    });
    process.env.EVAL_DIR = handle.root;
  });
  afterEach(async () => {
    delete process.env.EVAL_DIR;
    await handle.cleanup();
  });

  it('reads a run log by skill/filename id', async () => {
    const result = await readRunLogById('search-wiki/v1');
    expect(result).not.toBeNull();
    expect(result!.runLog.skill).toBe('search-wiki');
    expect(result!.runLog.version).toBe(1);
  });

  it('returns null on missing id', async () => {
    expect(await readRunLogById('nope/missing')).toBeNull();
  });
});

describe('runlogs — corrupt / skip', () => {
  let handle: FixtureTreeHandle;

  beforeEach(async () => {
    handle = await makeFixtureTree({
      runlogs: [
        {
          skill: 'search-wiki',
          filename: 'v1.json',
          body: buildRunLog({ skill: 'search-wiki', version: 1, released: true, timestamp: '2026-05-13_09-30-52' }),
        },
      ],
      corruptRunlogs: [
        { skill: 'search-wiki', filename: 'v2_2026-05-14_10-00-00.json', body: '{not json' },
      ],
    });
    process.env.EVAL_DIR = handle.root;
  });
  afterEach(async () => {
    delete process.env.EVAL_DIR;
    await handle.cleanup();
  });

  it('skips corrupt files but lists their paths', async () => {
    const { runs, corrupt } = await listRunLogs();
    expect(runs).toHaveLength(1);
    expect(corrupt).toHaveLength(1);
    expect(corrupt[0]).toContain('v2_2026-05-14_10-00-00.json');
  });

  it('ignores .ann.json files in the list', async () => {
    const { runs } = await listRunLogs();
    // No `.ann` files yielded as primary entries.
    expect(runs.every((r) => !r.filePath.endsWith('.ann.json'))).toBe(true);
  });
});

describe('runlogs — active state detection', () => {
  let handle: FixtureTreeHandle;

  beforeEach(async () => {
    // Build a snapshot that matches files we'll put on disk under the
    // skill folder. normalize() must match because the detector compares
    // normalized text.
    const skillMd = '---\nname: search-wiki\n---\nbody\n';
    const rubricMd = '# rubric\n';
    const snapshot: Record<string, string> = {
      'plugin/skills/search-wiki/SKILL.md': normalize('plugin/skills/search-wiki/SKILL.md', Buffer.from(skillMd)),
      'eval/tests/unit/search-wiki/rubric.md': normalize('eval/tests/unit/search-wiki/rubric.md', Buffer.from(rubricMd)),
    };

    handle = await makeFixtureTree({
      skills: [{ name: 'search-wiki', skillMd, rubricMd }],
      runlogs: [
        {
          skill: 'search-wiki',
          filename: 'v1.json',
          body: buildRunLog({
            skill: 'search-wiki',
            version: 1,
            released: true,
            timestamp: '2026-05-13_09-30-52',
            snapshot,
          }),
        },
      ],
      judgePrompt: 'judge\n',
    });
    process.env.EVAL_DIR = handle.root;
  });
  afterEach(async () => {
    delete process.env.EVAL_DIR;
    await handle.cleanup();
  });

  it('marks a releasable run log active when its snapshot matches disk', async () => {
    const active = await detectActiveRunLog('search-wiki');
    expect(active).not.toBeNull();
    expect(active!.id).toBe('search-wiki/v1');
  });

  it('returns null when no run log snapshot matches', async () => {
    // Edit a tracked file → snapshot diverges.
    const skillMd = path.join(handle.repoRoot, 'plugin', 'skills', 'search-wiki', 'SKILL.md');
    await fs.writeFile(skillMd, 'edited\n');
    const active = await detectActiveRunLog('search-wiki');
    expect(active).toBeNull();
  });

  it('listRunLogsForSkillWithActive marks the active row', async () => {
    const list = await listRunLogsForSkillWithActive('search-wiki');
    expect(list.runs[0].active).toBe(true);
    expect(list.active?.id).toBe('search-wiki/v1');
  });
});

describe('runlogs — derived stats', () => {
  it('weighted mean across all dimensions in all tests', () => {
    const log = buildRunLog({
      skill: 's',
      version: 1,
      timestamp: '2026-05-13_09-30-52',
      tests: [
        {
          test_id: 'ut_001',
          dimensions: [
            { source: 'base', name: 'A', score: 3 },
            { source: 'base', name: 'B', score: 1 },
          ],
        },
      ],
    });
    expect(runLogWeightedMean(log as never)).toBe(2);
  });

  it('histogram sums across tests', () => {
    const log = buildRunLog({
      skill: 's',
      version: 1,
      timestamp: '2026-05-13_09-30-52',
      tests: [
        {
          test_id: 'ut_001',
          dimensions: [
            { source: 'base', name: 'A', score: 3 },
            { source: 'base', name: 'B', score: 2 },
          ],
        },
        {
          test_id: 'ut_002',
          dimensions: [
            { source: 'base', name: 'A', score: 1 },
            { source: 'base', name: 'B', score: 3 },
          ],
        },
      ],
    });
    expect(runLogHistogram(log as never)).toEqual({ 1: 1, 2: 1, 3: 2 });
  });
});

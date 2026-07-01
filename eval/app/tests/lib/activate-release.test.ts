/**
 * Tests for lib/activate.ts + lib/release.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  buildRunLog,
  makeFixtureTree,
  type FixtureTreeHandle,
} from '../helpers/fixtureTree';
import { activateRunLog } from '../../lib/activate';
import { deleteCandidate, releaseRunLog } from '../../lib/release';

describe('activateRunLog', () => {
  let handle: FixtureTreeHandle;
  beforeEach(async () => {
    handle = await makeFixtureTree({
      skills: [{ name: 'search-familysearch-wiki', skillMd: 'old\n', rubricMd: '# rubric\n' }],
    });
    process.env.EVAL_DIR = handle.root;
  });
  afterEach(async () => {
    delete process.env.EVAL_DIR;
    await handle.cleanup();
  });

  it('writes snapshot files back to repo', async () => {
    const log = buildRunLog({
      skill: 'search-familysearch-wiki',
      version: 1,
      timestamp: '2026-05-18_10-30-00',
      snapshot: {
        'packages/engine/plugin/skills/search-familysearch-wiki/SKILL.md': 'new content\n',
        'eval/tests/unit/search-familysearch-wiki/rubric.md': '# new rubric\n',
      },
    }) as never;
    const written = await activateRunLog(log);
    expect(written).toEqual([
      'eval/tests/unit/search-familysearch-wiki/rubric.md',
      'packages/engine/plugin/skills/search-familysearch-wiki/SKILL.md',
    ]);
    const skillMd = await fs.readFile(
      path.join(handle.repoRoot, 'packages', 'engine', 'plugin', 'skills', 'search-familysearch-wiki', 'SKILL.md'),
      'utf8',
    );
    expect(skillMd).toBe('new content\n');
  });

  it('refuses scratch runs (non-releasable)', async () => {
    const log = buildRunLog({
      skill: 'search-familysearch-wiki',
      version: null,
      releasable: false,
      invocation: 'test',
      timestamp: '2026-05-18_10-30-00',
    }) as never;
    await expect(activateRunLog(log)).rejects.toThrow(/non-releasable/);
  });
});

describe('releaseRunLog', () => {
  let handle: FixtureTreeHandle;
  beforeEach(async () => {
    handle = await makeFixtureTree({
      runlogs: [
        {
          skill: 'search-familysearch-wiki',
          filename: 'v3_2026-05-18_10-30-00.json',
          body: buildRunLog({
            skill: 'search-familysearch-wiki',
            version: 3,
            timestamp: '2026-05-18_10-30-00',
          }),
          annotation: {
            run_log: 'v3_2026-05-18_10-30-00.json',
            annotator: 'a',
            corrections: [],
          },
        },
      ],
    });
    process.env.EVAL_DIR = handle.root;
  });
  afterEach(async () => {
    delete process.env.EVAL_DIR;
    await handle.cleanup();
  });

  it('renames candidate → released and flips released:true', async () => {
    const result = await releaseRunLog('search-familysearch-wiki/v3_2026-05-18_10-30-00');
    expect(result.newRunLogId).toBe('search-familysearch-wiki/v3');
    // Old files gone.
    await expect(
      fs.access(path.join(handle.root, 'runlogs', 'unit', 'search-familysearch-wiki', 'v3_2026-05-18_10-30-00.json')),
    ).rejects.toThrow();
    // New files present.
    const newLog = JSON.parse(
      await fs.readFile(
        path.join(handle.root, 'runlogs', 'unit', 'search-familysearch-wiki', 'v3.json'),
        'utf8',
      ),
    );
    expect(newLog.released).toBe(true);
    expect(newLog.version).toBe(3);
    const newAnn = JSON.parse(
      await fs.readFile(
        path.join(handle.root, 'runlogs', 'unit', 'search-familysearch-wiki', 'v3.ann.json'),
        'utf8',
      ),
    );
    expect(newAnn.run_log).toBe('v3.json');
  });

  it('refuses to release released files', async () => {
    await releaseRunLog('search-familysearch-wiki/v3_2026-05-18_10-30-00');
    // After release, the file is now v3.json — releasing again should error.
    await expect(releaseRunLog('search-familysearch-wiki/v3')).rejects.toThrow(/only candidate/);
  });
});

describe('deleteCandidate', () => {
  let handle: FixtureTreeHandle;
  beforeEach(async () => {
    handle = await makeFixtureTree({
      runlogs: [
        {
          skill: 'search-familysearch-wiki',
          filename: 'v1.json',
          body: buildRunLog({ skill: 'search-familysearch-wiki', version: 1, released: true, timestamp: '2026-05-13_09-30-52' }),
        },
        {
          skill: 'search-familysearch-wiki',
          filename: 'v2_2026-05-18_10-30-00.json',
          body: buildRunLog({ skill: 'search-familysearch-wiki', version: 2, timestamp: '2026-05-18_10-30-00' }),
          annotation: { run_log: 'v2_2026-05-18_10-30-00.json', annotator: 'a', corrections: [] },
        },
      ],
    });
    process.env.EVAL_DIR = handle.root;
  });
  afterEach(async () => {
    delete process.env.EVAL_DIR;
    await handle.cleanup();
  });

  it('deletes candidate file and its annotation', async () => {
    await deleteCandidate('search-familysearch-wiki/v2_2026-05-18_10-30-00');
    await expect(
      fs.access(path.join(handle.root, 'runlogs', 'unit', 'search-familysearch-wiki', 'v2_2026-05-18_10-30-00.json')),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(handle.root, 'runlogs', 'unit', 'search-familysearch-wiki', 'v2_2026-05-18_10-30-00.ann.json')),
    ).rejects.toThrow();
  });

  it('refuses to delete released runs', async () => {
    await expect(deleteCandidate('search-familysearch-wiki/v1')).rejects.toThrow(/cannot delete released/);
  });
});

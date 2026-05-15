import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeFixtureTree, type FixtureTreeHandle } from '../helpers/fixtureTree';
import { readAnnotation, writeAnnotation } from '../../lib/fs/annotations';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('annotations — read', () => {
  let handle: FixtureTreeHandle;

  beforeEach(async () => {
    handle = await makeFixtureTree({
      runlogs: [
        {
          skill: 'wiki-lookup',
          model: 'claude-sonnet-4-6',
          filename: '2026-05-13T00-00-00Z.json',
          body: { stub: true },
          annotation: {
            run_log: '2026-05-13T00-00-00Z.json',
            annotator: 'team-a',
            corrections: [
              {
                test_id: 'ut_wiki_lookup_001',
                dimension_source: 'rubric',
                dimension_name: 'A',
                llm_score: 3,
                corrected_score: 2,
                comment: 'looked closer; off by one',
              },
            ],
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

  it('reads an existing annotation', async () => {
    const ann = await readAnnotation('wiki-lookup/claude-sonnet-4-6/2026-05-13T00-00-00Z');
    expect(ann?.annotator).toBe('team-a');
    expect(ann?.corrections).toHaveLength(1);
    expect(ann?.corrections[0].corrected_score).toBe(2);
  });

  it('returns null for missing annotation', async () => {
    const ann = await readAnnotation('wiki-lookup/claude-sonnet-4-6/2026-05-99T00-00-00Z');
    expect(ann).toBeNull();
  });
});

describe('annotations — write', () => {
  let handle: FixtureTreeHandle;

  beforeEach(async () => {
    handle = await makeFixtureTree({
      runlogs: [
        {
          skill: 'wiki-lookup',
          model: 'claude-sonnet-4-6',
          filename: '2026-05-13T00-00-00Z.json',
          body: { stub: true },
        },
      ],
    });
    process.env.EVAL_DIR = handle.root;
  });

  afterEach(async () => {
    delete process.env.EVAL_DIR;
    await handle.cleanup();
  });

  it('writes a fresh .ann.json alongside the run log', async () => {
    const filePath = await writeAnnotation('wiki-lookup/claude-sonnet-4-6/2026-05-13T00-00-00Z', {
      run_log: '2026-05-13T00-00-00Z.json',
      annotator: 'team-b',
      corrections: [],
    });
    expect(filePath).toMatch(/2026-05-13T00-00-00Z\.ann\.json$/);
    const onDisk = JSON.parse(await fs.readFile(filePath, 'utf8'));
    expect(onDisk.annotator).toBe('team-b');

    // .tmp file must not linger.
    const dir = path.dirname(filePath);
    const siblings = await fs.readdir(dir);
    expect(siblings.filter((s) => s.includes('.tmp'))).toHaveLength(0);
  });
});

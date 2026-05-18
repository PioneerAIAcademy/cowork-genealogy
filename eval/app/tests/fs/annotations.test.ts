/**
 * Tests for lib/fs/annotations.ts — sparse annotation read/write + helpers.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeFixtureTree, buildRunLog, type FixtureTreeHandle } from '../helpers/fixtureTree';
import {
  deleteCorrection,
  isAnnotationComplete,
  newAnnotation,
  readAnnotation,
  unreviewedDimensions,
  upsertCorrection,
  writeAnnotation,
} from '../../lib/fs/annotations';
import type { AnnotationFile, RunLogFile } from '../../lib/types';

describe('annotations — read/write', () => {
  let handle: FixtureTreeHandle;

  beforeEach(async () => {
    handle = await makeFixtureTree({
      runlogs: [
        {
          skill: 'wiki-lookup',
          filename: 'v1.json',
          body: buildRunLog({ skill: 'wiki-lookup', version: 1, released: true, timestamp: '2026-05-13-09-30-52' }),
        },
      ],
    });
    process.env.EVAL_DIR = handle.root;
  });
  afterEach(async () => {
    delete process.env.EVAL_DIR;
    await handle.cleanup();
  });

  it('returns null when no annotation file exists', async () => {
    expect(await readAnnotation('wiki-lookup/v1')).toBeNull();
  });

  it('writes then reads an annotation', async () => {
    const ann: AnnotationFile = {
      run_log: 'v1.json',
      annotator: 'team-a',
      corrections: [
        {
          test_id: 'ut_001',
          dimension_source: 'base',
          dimension_name: 'Correctness',
          llm_score: 3,
          corrected_score: 2,
          comment: 'subtle issue',
        },
      ],
    };
    await writeAnnotation('wiki-lookup/v1', ann);
    const loaded = await readAnnotation('wiki-lookup/v1');
    expect(loaded).toEqual(ann);
  });
});

describe('annotations — completeness + sparse helpers', () => {
  it('isAnnotationComplete requires every dimension to have an entry', () => {
    const log: RunLogFile = buildRunLog({
      skill: 's',
      version: 1,
      timestamp: '2026-05-13-09-30-52',
      tests: [
        {
          test_id: 'ut_001',
          dimensions: [
            { source: 'base', name: 'A', score: 3 },
            { source: 'base', name: 'B', score: 2 },
          ],
        },
      ],
    }) as unknown as RunLogFile;
    expect(isAnnotationComplete(log, null)).toBe(false);
    expect(isAnnotationComplete(log, { run_log: 'v1.json', annotator: 'a', corrections: [] })).toBe(false);
    const partial: AnnotationFile = {
      run_log: 'v1.json',
      annotator: 'a',
      corrections: [
        { test_id: 'ut_001', dimension_source: 'base', dimension_name: 'A', llm_score: 3, corrected_score: 3 },
      ],
    };
    expect(isAnnotationComplete(log, partial)).toBe(false);
    const complete: AnnotationFile = {
      ...partial,
      corrections: [
        ...partial.corrections,
        { test_id: 'ut_001', dimension_source: 'base', dimension_name: 'B', llm_score: 2, corrected_score: 2 },
      ],
    };
    expect(isAnnotationComplete(log, complete)).toBe(true);
  });

  it('unreviewedDimensions lists missing keys', () => {
    const log: RunLogFile = buildRunLog({
      skill: 's',
      version: 1,
      timestamp: '2026-05-13-09-30-52',
      tests: [
        {
          test_id: 'ut_001',
          dimensions: [
            { source: 'base', name: 'A', score: 3 },
            { source: 'base', name: 'B', score: 2 },
          ],
        },
      ],
    }) as unknown as RunLogFile;
    const ann: AnnotationFile = {
      run_log: 'v1.json',
      annotator: 'a',
      corrections: [
        { test_id: 'ut_001', dimension_source: 'base', dimension_name: 'A', llm_score: 3, corrected_score: 3 },
      ],
    };
    expect(unreviewedDimensions(log, ann)).toEqual([
      { test_id: 'ut_001', dimension_source: 'base', dimension_name: 'B' },
    ]);
  });
});

describe('annotations — upsert / delete', () => {
  it('upsertCorrection replaces existing entry for same key', () => {
    const ann = newAnnotation('v1.json', 'a');
    const a1 = upsertCorrection(ann, {
      test_id: 'ut_001',
      dimension_source: 'base',
      dimension_name: 'A',
      llm_score: 3,
      corrected_score: 2,
    });
    expect(a1.corrections).toHaveLength(1);
    const a2 = upsertCorrection(a1, {
      test_id: 'ut_001',
      dimension_source: 'base',
      dimension_name: 'A',
      llm_score: 3,
      corrected_score: 1,
      comment: 'updated',
    });
    expect(a2.corrections).toHaveLength(1);
    expect(a2.corrections[0].corrected_score).toBe(1);
    expect(a2.corrections[0].comment).toBe('updated');
  });

  it('deleteCorrection removes by key', () => {
    const ann = upsertCorrection(newAnnotation('v1.json', 'a'), {
      test_id: 'ut_001',
      dimension_source: 'base',
      dimension_name: 'A',
      llm_score: 3,
      corrected_score: 3,
    });
    const deleted = deleteCorrection(ann, 'ut_001', 'base', 'A');
    expect(deleted.corrections).toHaveLength(0);
  });
});

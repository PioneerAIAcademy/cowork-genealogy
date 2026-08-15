/**
 * Tests for lib/fs/annotations.ts — sparse annotation read/write + helpers.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
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
import { uncommentedSampledCorrections } from '../../lib/types';
import { runlogsUnitDir } from '../../lib/paths';
import type { AnnotationFile, RunLogFile } from '../../lib/types';

describe('annotations — read/write', () => {
  let handle: FixtureTreeHandle;

  beforeEach(async () => {
    handle = await makeFixtureTree({
      runlogs: [
        {
          skill: 'search-familysearch-wiki',
          filename: 'v1.json',
          body: buildRunLog({ skill: 'search-familysearch-wiki', version: 1, released: true, timestamp: '2026-05-13_09-30-52' }),
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
    expect(await readAnnotation('search-familysearch-wiki/v1')).toBeNull();
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
    await writeAnnotation('search-familysearch-wiki/v1', ann);
    const loaded = await readAnnotation('search-familysearch-wiki/v1');
    expect(loaded).toEqual(ann);
  });

  it('writeAnnotation rejects the deprecated run_index/dimension/source shape', async () => {
    const bad = {
      run_log: 'v1.json',
      annotator: 'team-a',
      corrections: [
        // legacy per-run shape Claude emits when asked to hand-write a .ann.json
        { test_id: 'ut_001', run_index: 0, dimension: 'Correctness', source: 'base', llm_score: 3, corrected_score: 3 },
      ],
    } as unknown as AnnotationFile;
    await expect(writeAnnotation('search-familysearch-wiki/v1', bad)).rejects.toThrow(/Invalid annotation/);
    // Nothing should have been persisted.
    expect(await readAnnotation('search-familysearch-wiki/v1')).toBeNull();
  });

  it('readAnnotation throws on an existing but off-schema file', async () => {
    // Simulate a hand-written file landing on disk (bypassing writeAnnotation).
    const bad = {
      run_log: 'v1.json',
      annotator: 'team-a',
      corrections: [
        { test_id: 'ut_001', run_index: 0, dimension: 'Correctness', source: 'base', llm_score: 3, corrected_score: 3 },
      ],
    };
    const dir = path.join(runlogsUnitDir(), 'search-familysearch-wiki');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'v1.ann.json'), JSON.stringify(bad), 'utf8');
    await expect(readAnnotation('search-familysearch-wiki/v1')).rejects.toThrow(/Invalid annotation/);
  });
});

describe('annotations — completeness + sparse helpers', () => {
  it('isAnnotationComplete requires every dimension to have an entry', () => {
    const log: RunLogFile = buildRunLog({
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
      timestamp: '2026-05-13_09-30-52',
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

describe('annotations — review sampling', () => {
  const buildLog = (
    n: number,
    review_sample?: { tests: string[]; cursor: string[]; seed: number },
  ) => {
    const log = buildRunLog({
      skill: 's',
      version: 1,
      timestamp: '2026-05-13_09-30-52',
      tests: Array.from({ length: n }, (_, i) => ({
        test_id: `ut_${String(i).padStart(3, '0')}`,
        dimensions: [
          { source: 'base', name: 'A', score: 3 },
          { source: 'base', name: 'B', score: 3 },
        ],
      })),
    }) as unknown as RunLogFile;
    if (review_sample) log.review_sample = review_sample;
    return log;
  };

  const annFor = (ids: string[], comment: string | null = 'read it'): AnnotationFile => ({
    run_log: 'v1.json',
    annotator: 'a',
    corrections: ids.flatMap((test_id) =>
      (['A', 'B'] as const).map((dimension_name) => ({
        test_id,
        dimension_source: 'base',
        dimension_name,
        llm_score: 3 as const,
        corrected_score: 3 as const,
        comment,
      })),
    ),
  });

  it('completeness counts only sampled dimensions', () => {
    // Without this the annotator sees "10/40 reviewed" on a sample of 5 and the
    // Release button never enables, while CI is green.
    const sampled = ['ut_000', 'ut_001', 'ut_002', 'ut_003', 'ut_004'];
    const log = buildLog(20, { tests: sampled, cursor: sampled, seed: 0 });
    expect(isAnnotationComplete(log, annFor(sampled))).toBe(true);
    expect(unreviewedDimensions(log, annFor(sampled))).toHaveLength(0);
  });

  it('an unreviewed sampled test still blocks', () => {
    const sampled = ['ut_000', 'ut_001'];
    const log = buildLog(20, { tests: sampled, cursor: sampled, seed: 0 });
    expect(isAnnotationComplete(log, annFor(['ut_000']))).toBe(false);
    expect(unreviewedDimensions(log, annFor(['ut_000']))).toHaveLength(2);
  });

  it('a run log with no review_sample keeps the every-dimension rule', () => {
    // Every committed run log today. This is what makes sampling retroactively
    // safe for all 109 committed annotations.
    const log = buildLog(3);
    expect(isAnnotationComplete(log, annFor(['ut_000']))).toBe(false);
    expect(isAnnotationComplete(log, annFor(['ut_000', 'ut_001', 'ut_002']))).toBe(true);
  });
});

describe('annotations — the comment requirement', () => {
  const log = (() => {
    const l = buildRunLog({
      skill: 's',
      version: 1,
      timestamp: '2026-05-13_09-30-52',
      tests: [
        { test_id: 'ut_000', dimensions: [{ source: 'base', name: 'A', score: 3 }] },
        { test_id: 'ut_001', dimensions: [{ source: 'base', name: 'A', score: 3 }] },
      ],
    }) as unknown as RunLogFile;
    l.review_sample = { tests: ['ut_000'], cursor: ['ut_000'], seed: 0 };
    return l;
  })();

  const one = (comment: string | null, score: 1 | 2 | 3 = 2): AnnotationFile => ({
    run_log: 'v1.json',
    annotator: 'a',
    corrections: [
      {
        test_id: 'ut_000',
        dimension_source: 'base',
        dimension_name: 'A',
        llm_score: score,
        corrected_score: score,
        comment,
      },
    ],
  });

  it('a sampled correction with no comment is not complete', () => {
    // 91.4% of the corpus this replaces was confirmed with no comment at all.
    expect(uncommentedSampledCorrections(log, one(null))).toHaveLength(1);
    expect(isAnnotationComplete(log, one(null))).toBe(false);
  });

  it('whitespace does not count as a comment', () => {
    expect(isAnnotationComplete(log, one('   '))).toBe(false);
  });

  it('a written comment completes it', () => {
    expect(isAnnotationComplete(log, one('checked the transcript'))).toBe(true);
  });

  it('a confirmed pass (3 -> 3) is exempt', () => {
    // 89.4% of the corpus is 3 -> 3; requiring a sentence there spends ~26 of
    // every ~29 on the cells least likely to carry anything.
    expect(isAnnotationComplete(log, one(null, 3))).toBe(true);
  });

  it('an overridden pass still needs a comment', () => {
    const ann = one(null, 3);
    ann.corrections[0].corrected_score = 2;
    expect(isAnnotationComplete(log, ann)).toBe(false);
  });

  it('an unsampled correction needs no comment', () => {
    const ann = one('ok');
    ann.corrections.push({
      test_id: 'ut_001',
      dimension_source: 'base',
      dimension_name: 'A',
      llm_score: 3,
      corrected_score: 3,
      comment: null,
    });
    expect(isAnnotationComplete(log, ann)).toBe(true);
  });
});

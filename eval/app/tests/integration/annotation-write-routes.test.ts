/**
 * Route tests for PUT and PATCH on /api/runlogs/annotation/[...id].
 *
 * Covers: valid PATCH preserving annotator; 400 for bad payloads; 422 for
 * corrupt file on PATCH; concurrent PATCHes both surviving via the lock.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import { NextRequest } from 'next/server';
import { makeFixtureTree, buildRunLog, type FixtureTreeHandle } from '../helpers/fixtureTree';
import { annPathForRunLog, readAnnotation, writeAnnotation } from '../../lib/fs/annotations';
import { _clearIdentityCacheForTests, setIdentity } from '../../lib/identity';
import { PUT, PATCH } from '../../app/api/runlogs/annotation/[...id]/route';
import type { AnnotationFile } from '../../lib/types';

const SKILL = 'search-familysearch-wiki';
const FILENAME = 'v1_2026-05-18_09-00-00.json';
const RUN_LOG_ID = `${SKILL}/v1_2026-05-18_09-00-00`;

function callPut(runLogId: string, body: unknown) {
  const id = runLogId.split('/');
  const req = new NextRequest('http://localhost/api/runlogs/annotation/' + runLogId, {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
  return PUT(req, { params: Promise.resolve({ id }) });
}

function callPatch(runLogId: string, body: unknown) {
  const id = runLogId.split('/');
  const req = new NextRequest('http://localhost/api/runlogs/annotation/' + runLogId, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
  return PATCH(req, { params: Promise.resolve({ id }) });
}

function validCorrection(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    test_id: 'ut_001',
    dimension_source: 'base',
    dimension_name: 'Correctness',
    llm_score: 3,
    corrected_score: 2,
    comment: 'needs work',
    ...overrides,
  };
}

describe('PUT /api/runlogs/annotation/[...id]', () => {
  let handle: FixtureTreeHandle;

  beforeEach(async () => {
    handle = await makeFixtureTree({
      runlogs: [
        {
          skill: SKILL,
          filename: FILENAME,
          body: buildRunLog({ skill: SKILL, version: 1, timestamp: '2026-05-18_09-00-00' }),
        },
      ],
    });
    process.env.EVAL_DIR = handle.root;
    _clearIdentityCacheForTests();
    await setIdentity('test-annotator@example.com');
  });
  afterEach(async () => {
    delete process.env.EVAL_DIR;
    _clearIdentityCacheForTests();
    await handle.cleanup();
  });

  it('returns 400 when corrections is missing', async () => {
    const res = await callPut(RUN_LOG_ID, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('missing_corrections');
  });

  it('returns 400 for invalid correction shape', async () => {
    const res = await callPut(RUN_LOG_ID, {
      corrections: [{ test_id: 'ut_001', dimension: 'old_shape' }],
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_annotation');
  });

  it('preserves existing annotator on update', async () => {
    const original: AnnotationFile = {
      run_log: FILENAME,
      annotator: 'original@example.com',
      corrections: [validCorrection()],
    };
    await writeAnnotation(RUN_LOG_ID, original);

    const res = await callPut(RUN_LOG_ID, {
      corrections: [validCorrection({ corrected_score: 1, comment: 'updated' })],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.annotation.annotator).toBe('original@example.com');
  });
});

describe('PATCH /api/runlogs/annotation/[...id]', () => {
  let handle: FixtureTreeHandle;

  beforeEach(async () => {
    handle = await makeFixtureTree({
      runlogs: [
        {
          skill: SKILL,
          filename: FILENAME,
          body: buildRunLog({ skill: SKILL, version: 1, timestamp: '2026-05-18_09-00-00' }),
        },
      ],
    });
    process.env.EVAL_DIR = handle.root;
    _clearIdentityCacheForTests();
    await setIdentity('test-annotator@example.com');
  });
  afterEach(async () => {
    delete process.env.EVAL_DIR;
    _clearIdentityCacheForTests();
    await handle.cleanup();
  });

  it('creates a new annotation when none exists', async () => {
    const res = await callPatch(RUN_LOG_ID, validCorrection());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.annotation.annotator).toBe('test-annotator@example.com');
    expect(body.annotation.corrections).toHaveLength(1);
  });

  it('preserves existing annotator and merges corrections', async () => {
    const original: AnnotationFile = {
      run_log: FILENAME,
      annotator: 'original@example.com',
      corrections: [validCorrection()],
    };
    await writeAnnotation(RUN_LOG_ID, original);

    const res = await callPatch(RUN_LOG_ID, validCorrection({
      dimension_name: 'Completeness',
      corrected_score: 3,
      comment: 'fine',
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.annotation.annotator).toBe('original@example.com');
    expect(body.annotation.corrections).toHaveLength(2);
  });

  it('returns 400 for score 4 (out of range)', async () => {
    const res = await callPatch(RUN_LOG_ID, validCorrection({ corrected_score: 4 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_correction');
  });

  it('returns 400 for string score', async () => {
    const res = await callPatch(RUN_LOG_ID, validCorrection({ corrected_score: '3' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_correction');
  });

  it('returns 400 for extra annotator key', async () => {
    const res = await callPatch(RUN_LOG_ID, { ...validCorrection(), annotator: 'sneak' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_correction');
  });

  it('returns 400 for null body', async () => {
    const res = await callPatch(RUN_LOG_ID, null);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_correction');
  });

  it('returns 400 for legacy run_index shape', async () => {
    const res = await callPatch(RUN_LOG_ID, {
      test_id: 'ut_001',
      run_index: 0,
      dimension: 'Correctness',
      source: 'base',
      llm_score: 3,
      corrected_score: 3,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_correction');
  });

  it('returns 422 when existing annotation is corrupt', async () => {
    // Two JSON docs spliced — what a temp-name collision leaves.
    const annPath = annPathForRunLog(RUN_LOG_ID);
    await fs.writeFile(annPath, '{"run_log":"x","annotator":"a","corrections":[]}\n{"extra":1}', 'utf8');

    const res = await callPatch(RUN_LOG_ID, validCorrection());
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('corrupt_annotation');
  });

  it('concurrent PATCHes both survive via lock', async () => {
    const original: AnnotationFile = {
      run_log: FILENAME,
      annotator: 'original@example.com',
      corrections: [],
    };
    await writeAnnotation(RUN_LOG_ID, original);

    const [resA, resB] = await Promise.all([
      callPatch(RUN_LOG_ID, validCorrection({ dimension_name: 'Correctness', comment: 'A' })),
      callPatch(RUN_LOG_ID, validCorrection({ dimension_name: 'Completeness', comment: 'B' })),
    ]);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const final = await readAnnotation(RUN_LOG_ID);
    expect(final!.corrections).toHaveLength(2);
    const names = final!.corrections.map((c) => c.dimension_name).sort();
    expect(names).toEqual(['Completeness', 'Correctness']);
  });
});

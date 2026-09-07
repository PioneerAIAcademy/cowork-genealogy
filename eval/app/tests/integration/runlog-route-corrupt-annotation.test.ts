/**
 * The run-log route must translate a corrupt `.ann.json` into a structured
 * 422 (with the file path) instead of a bare 500 — the recovery path from
 * the concurrent-save corruption fix. Covers both throw shapes readAnnotation
 * emits: spliced/unparseable JSON, and a parseable-but-off-schema file.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import { makeFixtureTree, buildRunLog, type FixtureTreeHandle } from '../helpers/fixtureTree';
import { annPathForRunLog } from '../../lib/fs/annotations';
import { GET } from '../../app/api/runlogs/[...id]/route';

const SKILL = 'search-familysearch-wiki';
const FILENAME = 'v1_2026-05-18_09-00-00.json';
const RUN_LOG_ID = `${SKILL}/v1_2026-05-18_09-00-00`;

function callGet(runLogId: string) {
  const id = runLogId.split('/');
  return GET({} as never, { params: Promise.resolve({ id }) });
}

describe('GET /api/runlogs/[...id] — corrupt annotation → 422, not 500', () => {
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
  });
  afterEach(async () => {
    delete process.env.EVAL_DIR;
    await handle.cleanup();
  });

  it('returns 422 with the file path when the annotation is spliced/unparseable JSON', async () => {
    // Two JSON documents concatenated — exactly what a temp-name collision leaves.
    const spliced = '{"run_log":"' + FILENAME + '","annotator":"x","corrections":[]}\n{"corrections":[]}';
    await fs.writeFile(annPathForRunLog(RUN_LOG_ID), spliced, 'utf8');

    const res = await callGet(RUN_LOG_ID);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('invalid_annotation');
    expect(body.filePath).toBe(annPathForRunLog(RUN_LOG_ID));
    expect(body.message).toMatch(/is not valid JSON/);
  });

  it('returns 422 with the file path when the annotation is parseable but off-schema', async () => {
    // Valid JSON, wrong shape — the loud-throw path readAnnotation validates for.
    await fs.writeFile(annPathForRunLog(RUN_LOG_ID), '{"run_log":"x","annotator":"y"}', 'utf8');

    const res = await callGet(RUN_LOG_ID);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('invalid_annotation');
    expect(body.filePath).toBe(annPathForRunLog(RUN_LOG_ID));
  });
});

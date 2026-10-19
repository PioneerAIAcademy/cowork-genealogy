/**
 * The sibling routes that read annotations bare — compare and trend — must
 * translate a corrupt `.ann.json` into a structured 422 instead of a bare 500,
 * the same recovery path the run-log route got. Same defect, same fix; these
 * are the parity guards for the two other `readAnnotation` call sites.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import { NextRequest } from 'next/server';
import { makeFixtureTree, buildRunLog, type FixtureTreeHandle } from '../helpers/fixtureTree';
import { annPathForRunLog } from '../../lib/fs/annotations';
import { GET as compareGet } from '../../app/api/runlogs/compare/route';
import { GET as trendGet } from '../../app/api/runlogs/trend/route';

const SKILL = 'search-familysearch-wiki';

// Two JSON documents concatenated — exactly what a temp-name collision leaves.
const SPLICED = '{"run_log":"x","annotator":"a","corrections":[]}\n{"corrections":[]}';

describe('compare/trend routes — corrupt annotation → 422, not 500', () => {
  let handle: FixtureTreeHandle;

  beforeEach(async () => {
    handle = await makeFixtureTree({
      runlogs: [
        {
          skill: SKILL,
          filename: 'v1_2026-05-18_09-00-00.json',
          body: buildRunLog({ skill: SKILL, version: 1, released: true, timestamp: '2026-05-18_09-00-00' }),
        },
        {
          skill: SKILL,
          filename: 'v2_2026-05-19_09-00-00.json',
          body: buildRunLog({ skill: SKILL, version: 2, released: true, timestamp: '2026-05-19_09-00-00' }),
        },
      ],
    });
    process.env.EVAL_DIR = handle.root;
  });
  afterEach(async () => {
    delete process.env.EVAL_DIR;
    await handle.cleanup();
  });

  it('compare returns 422 when either annotation is spliced/unparseable JSON', async () => {
    const recentId = `${SKILL}/v2_2026-05-19_09-00-00`;
    const previousId = `${SKILL}/v1_2026-05-18_09-00-00`;
    await fs.writeFile(annPathForRunLog(recentId), SPLICED, 'utf8');

    const req = new NextRequest(
      `http://localhost/api/runlogs/compare?recent=${encodeURIComponent(recentId)}&previous=${encodeURIComponent(previousId)}`,
    );
    const res = await compareGet(req);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('invalid_annotation');
    expect(body.message).toMatch(/is not valid JSON/);
  });

  it('trend returns 422 when a released run\'s annotation is spliced/unparseable JSON', async () => {
    const corruptId = `${SKILL}/v1_2026-05-18_09-00-00`;
    await fs.writeFile(annPathForRunLog(corruptId), SPLICED, 'utf8');

    const req = new NextRequest(`http://localhost/api/runlogs/trend?skill=${encodeURIComponent(SKILL)}`);
    const res = await trendGet(req);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('invalid_annotation');
    expect(body.message).toMatch(/is not valid JSON/);
  });
});

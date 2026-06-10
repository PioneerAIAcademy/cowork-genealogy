/**
 * Integration test: covers the verification scenario from
 * docs/plan/eval-runlog-versioning.md without spinning up a browser.
 *
 * Exercises the same lib functions the UI calls through its API routes.
 * Playwright-level browser tests (clicking the actual buttons) are
 * deferred — they would only add coverage on the JSX glue layer; the
 * data + business logic is fully covered here.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeFixtureTree, buildRunLog, type FixtureTreeHandle } from '../helpers/fixtureTree';
import { detectActiveRunLog, listRunLogsForSkillWithActive } from '../../lib/fs/runlogs';
import { activateRunLog } from '../../lib/activate';
import { deleteCandidate, releaseRunLog } from '../../lib/release';
import {
  isAnnotationComplete,
  upsertCorrection,
  writeAnnotation,
} from '../../lib/fs/annotations';
import { normalize } from '../../lib/snapshot';
import type { AnnotationFile, RunLogFile } from '../../lib/types';

function makeSkillSnapshot(skill: string, skillBody: string): Record<string, string> {
  return {
    [`packages/engine/plugin/skills/${skill}/SKILL.md`]: normalize(`packages/engine/plugin/skills/${skill}/SKILL.md`, Buffer.from(skillBody)),
    [`eval/tests/unit/${skill}/rubric.md`]: normalize(`eval/tests/unit/${skill}/rubric.md`, Buffer.from('# rubric\n')),
  };
}

describe('end-to-end flow: candidate → review → release → activate', () => {
  let handle: FixtureTreeHandle;
  const SKILL = 'search-familysearch-wiki';

  beforeEach(async () => {
    const skillBody = '---\nname: search-familysearch-wiki\n---\nbody\n';
    handle = await makeFixtureTree({
      skills: [{ name: SKILL, skillMd: skillBody, rubricMd: '# rubric\n' }],
      judgePrompt: 'judge prompt v1\n',
      runlogs: [
        // A first candidate iteration of v1.
        {
          skill: SKILL,
          filename: 'v1_2026-05-18_09-00-00.json',
          body: buildRunLog({
            skill: SKILL,
            version: 1,
            timestamp: '2026-05-18_09-00-00',
            snapshot: makeSkillSnapshot(SKILL, skillBody),
            tests: [
              {
                test_id: 'ut_001',
                dimensions: [
                  { source: 'base', name: 'A', score: 3 },
                  { source: 'rubric', name: 'B', score: 2 },
                ],
              },
            ],
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

  it('full lifecycle: review → release → activate v1, then iterate to v2', async () => {
    // Step 1: latest candidate is the active version (snapshot matches disk).
    let active = await detectActiveRunLog(SKILL);
    expect(active?.id).toBe(`${SKILL}/v1_2026-05-18_09-00-00`);

    // Step 2: review every dimension (sparse → complete).
    let ann: AnnotationFile = {
      run_log: 'v1_2026-05-18_09-00-00.json',
      annotator: 'team-a',
      corrections: [],
    };
    ann = upsertCorrection(ann, {
      test_id: 'ut_001',
      dimension_source: 'base',
      dimension_name: 'A',
      llm_score: 3,
      corrected_score: 3,
    });
    ann = upsertCorrection(ann, {
      test_id: 'ut_001',
      dimension_source: 'rubric',
      dimension_name: 'B',
      llm_score: 2,
      corrected_score: 2,
    });
    await writeAnnotation(`${SKILL}/v1_2026-05-18_09-00-00`, ann);
    const list = await listRunLogsForSkillWithActive(SKILL);
    expect(list.runs[0].annotationComplete).toBe(true);

    // Step 3: confirm completeness check sees a complete annotation.
    expect(isAnnotationComplete(active!.log, ann)).toBe(true);

    // Step 4: release → file renamed to v1.json with released:true.
    const released = await releaseRunLog(`${SKILL}/v1_2026-05-18_09-00-00`);
    expect(released.newRunLogId).toBe(`${SKILL}/v1`);
    const releasedLog = JSON.parse(
      await fs.readFile(
        path.join(handle.root, 'runlogs', 'unit', SKILL, 'v1.json'),
        'utf8',
      ),
    ) as RunLogFile;
    expect(releasedLog.released).toBe(true);

    // Step 5: active detection now picks the released file.
    active = await detectActiveRunLog(SKILL);
    expect(active?.id).toBe(`${SKILL}/v1`);

    // Step 6: edit the skill on disk → no active version.
    await fs.writeFile(
      path.join(handle.repoRoot, 'packages', 'engine', 'plugin', 'skills', SKILL, 'SKILL.md'),
      '---\nname: search-familysearch-wiki\n---\nedited body\n',
    );
    active = await detectActiveRunLog(SKILL);
    expect(active).toBeNull();

    // Step 7: "run the harness" → write a candidate v2 with the new snapshot.
    const editedBody = '---\nname: search-familysearch-wiki\n---\nedited body\n';
    const editedSnapshot = makeSkillSnapshot(SKILL, editedBody);
    const v2Body = buildRunLog({
      skill: SKILL,
      version: 2,
      timestamp: '2026-05-18_12-00-00',
      snapshot: editedSnapshot,
      tests: [
        {
          test_id: 'ut_001',
          dimensions: [
            { source: 'base', name: 'A', score: 3 },
            { source: 'rubric', name: 'B', score: 3 }, // improved
          ],
        },
      ],
    });
    await fs.writeFile(
      path.join(handle.root, 'runlogs', 'unit', SKILL, 'v2_2026-05-18_12-00-00.json'),
      JSON.stringify(v2Body, null, 2),
    );
    active = await detectActiveRunLog(SKILL);
    expect(active?.id).toBe(`${SKILL}/v2_2026-05-18_12-00-00`);

    // Step 8: activate v1 (rollback). Snapshot files are restored on disk.
    const v1Log = JSON.parse(
      await fs.readFile(
        path.join(handle.root, 'runlogs', 'unit', SKILL, 'v1.json'),
        'utf8',
      ),
    );
    await activateRunLog(v1Log);
    const skillOnDisk = await fs.readFile(
      path.join(handle.repoRoot, 'packages', 'engine', 'plugin', 'skills', SKILL, 'SKILL.md'),
      'utf8',
    );
    expect(skillOnDisk).toBe('---\nname: search-familysearch-wiki\n---\nbody\n');

    // Step 9: v1 is active again now that disk matches its snapshot.
    active = await detectActiveRunLog(SKILL);
    expect(active?.id).toBe(`${SKILL}/v1`);

    // Step 10: delete v2 candidate (rollback also removes the candidate iter).
    await deleteCandidate(`${SKILL}/v2_2026-05-18_12-00-00`);
    await expect(
      fs.access(path.join(handle.root, 'runlogs', 'unit', SKILL, 'v2_2026-05-18_12-00-00.json')),
    ).rejects.toThrow();
  });
});

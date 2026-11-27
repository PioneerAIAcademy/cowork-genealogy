/**
 * Integration test: covers run, review, a second run and delete without
 * spinning up a browser.
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
import { deleteCandidate, detectActiveRunLog, listRunLogsForSkillWithActive } from '../../lib/fs/runlogs';
import {
  isAnnotationComplete,
  upsertCorrection,
  writeAnnotation,
} from '../../lib/fs/annotations';
import { normalize } from '../../lib/snapshot';
import type { AnnotationFile } from '../../lib/types';

function makeSkillSnapshot(skill: string, skillBody: string): Record<string, string> {
  return {
    [`packages/engine/plugin/skills/${skill}/SKILL.md`]: normalize(`packages/engine/plugin/skills/${skill}/SKILL.md`, Buffer.from(skillBody)),
    [`eval/tests/unit/${skill}/rubric.md`]: normalize(`eval/tests/unit/${skill}/rubric.md`, Buffer.from('# rubric\n')),
  };
}

describe('end-to-end flow: run → review → iterate', () => {
  let handle: FixtureTreeHandle;
  const SKILL = 'search-familysearch-wiki';

  beforeEach(async () => {
    const skillBody = '---\nname: search-familysearch-wiki\n---\nbody\n';
    handle = await makeFixtureTree({
      skills: [{ name: SKILL, skillMd: skillBody, rubricMd: '# rubric\n' }],
      judgePrompt: 'judge prompt v1\n',
      runlogs: [
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

  it('full lifecycle: review a run, then iterate to a new run', async () => {
    // Step 1: the run log is active (snapshot matches disk).
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

    // Step 4: edit the skill on disk → no active version.
    await fs.writeFile(
      path.join(handle.repoRoot, 'packages', 'engine', 'plugin', 'skills', SKILL, 'SKILL.md'),
      '---\nname: search-familysearch-wiki\n---\nedited body\n',
    );
    active = await detectActiveRunLog(SKILL);
    expect(active).toBeNull();

    // Step 5: "run the harness" → write a new run log with the new snapshot.
    const editedBody = '---\nname: search-familysearch-wiki\n---\nedited body\n';
    const editedSnapshot = makeSkillSnapshot(SKILL, editedBody);
    const nextBody = buildRunLog({
      skill: SKILL,
      version: 1,
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
      path.join(handle.root, 'runlogs', 'unit', SKILL, 'v1_2026-05-18_12-00-00.json'),
      JSON.stringify(nextBody, null, 2),
    );
    active = await detectActiveRunLog(SKILL);
    expect(active?.id).toBe(`${SKILL}/v1_2026-05-18_12-00-00`);

    // Step 6: delete the new run log.
    await deleteCandidate(`${SKILL}/v1_2026-05-18_12-00-00`);
    await expect(
      fs.access(path.join(handle.root, 'runlogs', 'unit', SKILL, 'v1_2026-05-18_12-00-00.json')),
    ).rejects.toThrow();
    active = await detectActiveRunLog(SKILL);
    expect(active).toBeNull();
  });
});

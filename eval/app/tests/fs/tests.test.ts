import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeFixtureTree, type FixtureTreeHandle } from '../helpers/fixtureTree';
import { listTests, readTest, writeTest, deleteTest, nextTestId, hasGradingRelevantChange } from '../../lib/fs/tests';
import type { UnitTestFile } from '../../lib/types';

function makeTest(overrides: Partial<UnitTestFile> & { id?: string; skill?: string }): UnitTestFile {
  const skill = overrides.skill ?? 'search-familysearch-wiki';
  const id = overrides.id ?? `ut_${skill.replace(/-/g, '_')}_001`;
  return {
    test: {
      id,
      skill,
      name: `${id} test`,
      type: 'positive',
      description: 'desc',
      tags: [],
      ...(overrides.test ?? {}),
    },
    input: {
      user_message: 'hello',
      scenario: null,
      ...(overrides.input ?? {}),
    },
    mcp_fixtures: overrides.mcp_fixtures ?? [],
    judge_context: overrides.judge_context ?? [],
    ...(overrides.negative ? { negative: overrides.negative } : {}),
  };
}

describe('tests — listTests', () => {
  let handle: FixtureTreeHandle;

  beforeEach(async () => {
    handle = await makeFixtureTree({
      tests: [
        { skill: 'search-familysearch-wiki', filename: 'a.json', body: makeTest({ id: 'ut_search_wiki_001', skill: 'search-familysearch-wiki' }) },
        { skill: 'search-familysearch-wiki', filename: 'b.json', body: makeTest({ id: 'ut_search_wiki_002', skill: 'search-familysearch-wiki', mcp_fixtures: ['known-fixture'] }) },
        { skill: 'locality-guide', filename: 'c.json', body: makeTest({ id: 'ut_locality_guide_001', skill: 'locality-guide', input: { user_message: 'x', scenario: 'present-scenario' } }) },
      ],
      corruptTests: [
        { skill: 'search-familysearch-wiki', filename: 'bad.json', body: '{not json' },
      ],
      scenarios: [{ name: 'present-scenario' }],
      fixtures: [{ name: 'known-fixture', body: { tool: 'x', description: 'x', response: {} } }],
    });
    process.env.EVAL_DIR = handle.root;
  });

  afterEach(async () => {
    delete process.env.EVAL_DIR;
    await handle.cleanup();
  });

  it('lists tests across skills with no blocked entries', async () => {
    const { tests, corrupt } = await listTests();
    expect(corrupt).toHaveLength(1);
    expect(tests.map((t) => t.id)).toEqual([
      'ut_locality_guide_001',
      'ut_search_wiki_001',
      'ut_search_wiki_002',
    ]);
    expect(tests.every((t) => t.blocked === null)).toBe(true);
  });

  it('flags blocked when scenario is missing', async () => {
    const handle2 = await makeFixtureTree({
      tests: [
        { skill: 'locality-guide', filename: 'broken.json', body: makeTest({ id: 'ut_locality_guide_001', skill: 'locality-guide', input: { user_message: 'x', scenario: 'does-not-exist' } }) },
      ],
    });
    process.env.EVAL_DIR = handle2.root;
    const { tests } = await listTests();
    expect(tests[0].blocked).toEqual({ kind: 'missing-scenario', scenario: 'does-not-exist' });
    await handle2.cleanup();
  });

  it('flags blocked when fixture is missing', async () => {
    const handle2 = await makeFixtureTree({
      tests: [
        { skill: 'locality-guide', filename: 'broken.json', body: makeTest({ id: 'ut_locality_guide_001', skill: 'locality-guide', mcp_fixtures: ['vanished'] }) },
      ],
    });
    process.env.EVAL_DIR = handle2.root;
    const { tests } = await listTests();
    expect(tests[0].blocked).toEqual({ kind: 'missing-fixture', fixture: 'vanished' });
    await handle2.cleanup();
  });

  it('surfaces holdout on the list entry (default false, true when set)', async () => {
    const handle2 = await makeFixtureTree({
      tests: [
        { skill: 'locality-guide', filename: 'plain.json', body: makeTest({ id: 'ut_locality_guide_001', skill: 'locality-guide' }) },
        { skill: 'locality-guide', filename: 'held.json', body: makeTest({ id: 'ut_locality_guide_002', skill: 'locality-guide', test: { id: 'ut_locality_guide_002', skill: 'locality-guide', name: 'held', type: 'positive', description: 'd', tags: [], holdout: true } }) },
      ],
    });
    process.env.EVAL_DIR = handle2.root;
    const { tests } = await listTests();
    expect(tests.find((t) => t.id === 'ut_locality_guide_001')?.holdout).toBe(false);
    expect(tests.find((t) => t.id === 'ut_locality_guide_002')?.holdout).toBe(true);
    await handle2.cleanup();
  });

  it('flags blocked when scenario_notes present', async () => {
    const handle2 = await makeFixtureTree({
      tests: [
        { skill: 'locality-guide', filename: 'q.json', body: makeTest({ id: 'ut_locality_guide_001', skill: 'locality-guide', input: { user_message: 'x', scenario: 'present-scenario', scenario_notes: 'this scenario is wrong because…' } }) },
      ],
      scenarios: [{ name: 'present-scenario' }],
    });
    process.env.EVAL_DIR = handle2.root;
    const { tests } = await listTests();
    expect(tests[0].blocked).toMatchObject({ kind: 'scenario-notes-present' });
    await handle2.cleanup();
  });
});

describe('tests — read/write/delete/nextId', () => {
  let handle: FixtureTreeHandle;

  beforeEach(async () => {
    handle = await makeFixtureTree({
      tests: [
        { skill: 'search-familysearch-wiki', filename: 'a.json', body: makeTest({ id: 'ut_search_wiki_001', skill: 'search-familysearch-wiki' }) },
      ],
    });
    process.env.EVAL_DIR = handle.root;
  });

  afterEach(async () => {
    delete process.env.EVAL_DIR;
    await handle.cleanup();
  });

  it('reads a test by id', async () => {
    const found = await readTest('ut_search_wiki_001');
    expect(found?.test.test.skill).toBe('search-familysearch-wiki');
  });

  it('writes a new test atomically', async () => {
    const t = makeTest({ id: 'ut_search_wiki_005', skill: 'search-familysearch-wiki', test: { id: 'ut_search_wiki_005', skill: 'search-familysearch-wiki', name: 'new', type: 'positive', description: 'd', tags: [] } });
    await writeTest(t);
    const onDisk = JSON.parse(await fs.readFile(path.join(handle.root, 'tests', 'unit', 'search-familysearch-wiki', 'ut_search_wiki_005.json'), 'utf8'));
    expect(onDisk.test.id).toBe('ut_search_wiki_005');
  });

  it('deletes by id', async () => {
    const deleted = await deleteTest('ut_search_wiki_001');
    expect(deleted).toBe(true);
    expect(await readTest('ut_search_wiki_001')).toBeNull();
  });

  it('nextTestId returns the next sequence number', async () => {
    expect(await nextTestId('search-familysearch-wiki')).toBe('ut_search_wiki_002');
    expect(await nextTestId('locality-guide')).toBe('ut_locality_guide_001');
  });
});

describe('tests — hasGradingRelevantChange', () => {
  it('detects user_message change', () => {
    const a = makeTest({});
    const b = makeTest({});
    b.input.user_message = 'different';
    expect(hasGradingRelevantChange(a, b)).toBe(true);
  });

  it('ignores cosmetic name change', () => {
    const a = makeTest({});
    const b = JSON.parse(JSON.stringify(a)) as UnitTestFile;
    b.test.name = 'New cosmetic name';
    expect(hasGradingRelevantChange(a, b)).toBe(false);
  });

  it('detects scenario change', () => {
    const a = makeTest({});
    const b = JSON.parse(JSON.stringify(a)) as UnitTestFile;
    b.input.scenario = 'something-new';
    expect(hasGradingRelevantChange(a, b)).toBe(true);
  });

  it('detects fixtures-list change', () => {
    const a = makeTest({ mcp_fixtures: ['x'] });
    const b = makeTest({ mcp_fixtures: ['x', 'y'] });
    expect(hasGradingRelevantChange(a, b)).toBe(true);
  });

  it('detects judge_context change', () => {
    const a = makeTest({ judge_context: ['a'] });
    const b = makeTest({ judge_context: ['a', 'b'] });
    expect(hasGradingRelevantChange(a, b)).toBe(true);
  });

  it('detects holdout toggle (it survives snapshot normalization)', () => {
    const a = makeTest({});
    const b = JSON.parse(JSON.stringify(a)) as UnitTestFile;
    b.test.holdout = true;
    expect(hasGradingRelevantChange(a, b)).toBe(true);
  });

  it('detects judge_reads_files toggle (it survives snapshot normalization)', () => {
    const a = makeTest({});
    const b = JSON.parse(JSON.stringify(a)) as UnitTestFile;
    b.judge_reads_files = true;
    expect(hasGradingRelevantChange(a, b)).toBe(true);
  });

  it('treats absent holdout and explicit false as equivalent', () => {
    const a = makeTest({});
    const b = JSON.parse(JSON.stringify(a)) as UnitTestFile;
    b.test.holdout = false;
    expect(hasGradingRelevantChange(a, b)).toBe(false);
  });
});

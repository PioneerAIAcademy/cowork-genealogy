import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeFixtureTree, type FixtureTreeHandle } from '../helpers/fixtureTree';
import { listTests, readTest, writeTest, deleteTest, nextTestId, hasGradingRelevantChange } from '../../lib/fs/tests';
import type { UnitTestFile } from '../../lib/types';

function makeTest(overrides: Partial<UnitTestFile> & { id?: string; skill?: string }): UnitTestFile {
  const skill = overrides.skill ?? 'wiki-lookup';
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
    additional_criteria: overrides.additional_criteria ?? [],
    ...(overrides.negative ? { negative: overrides.negative } : {}),
  };
}

describe('tests — listTests', () => {
  let handle: FixtureTreeHandle;

  beforeEach(async () => {
    handle = await makeFixtureTree({
      tests: [
        { skill: 'wiki-lookup', filename: 'a.json', body: makeTest({ id: 'ut_wiki_lookup_001', skill: 'wiki-lookup' }) },
        { skill: 'wiki-lookup', filename: 'b.json', body: makeTest({ id: 'ut_wiki_lookup_002', skill: 'wiki-lookup', mcp_fixtures: ['known-fixture'] }) },
        { skill: 'locality-guide', filename: 'c.json', body: makeTest({ id: 'ut_locality_guide_001', skill: 'locality-guide', input: { user_message: 'x', scenario: 'present-scenario' } }) },
      ],
      corruptTests: [
        { skill: 'wiki-lookup', filename: 'bad.json', body: '{not json' },
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
      'ut_wiki_lookup_001',
      'ut_wiki_lookup_002',
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
        { skill: 'wiki-lookup', filename: 'a.json', body: makeTest({ id: 'ut_wiki_lookup_001', skill: 'wiki-lookup' }) },
      ],
    });
    process.env.EVAL_DIR = handle.root;
  });

  afterEach(async () => {
    delete process.env.EVAL_DIR;
    await handle.cleanup();
  });

  it('reads a test by id', async () => {
    const found = await readTest('ut_wiki_lookup_001');
    expect(found?.test.test.skill).toBe('wiki-lookup');
  });

  it('writes a new test atomically', async () => {
    const t = makeTest({ id: 'ut_wiki_lookup_005', skill: 'wiki-lookup', test: { id: 'ut_wiki_lookup_005', skill: 'wiki-lookup', name: 'new', type: 'positive', description: 'd', tags: [] } });
    await writeTest(t);
    const onDisk = JSON.parse(await fs.readFile(path.join(handle.root, 'tests', 'unit', 'wiki-lookup', 'ut_wiki_lookup_005.json'), 'utf8'));
    expect(onDisk.test.id).toBe('ut_wiki_lookup_005');
  });

  it('deletes by id', async () => {
    const deleted = await deleteTest('ut_wiki_lookup_001');
    expect(deleted).toBe(true);
    expect(await readTest('ut_wiki_lookup_001')).toBeNull();
  });

  it('nextTestId returns the next sequence number', async () => {
    expect(await nextTestId('wiki-lookup')).toBe('ut_wiki_lookup_002');
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

  it('detects additional_criteria change', () => {
    const a = makeTest({ additional_criteria: ['a'] });
    const b = makeTest({ additional_criteria: ['a', 'b'] });
    expect(hasGradingRelevantChange(a, b)).toBe(true);
  });
});

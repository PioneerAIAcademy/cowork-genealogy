/**
 * Tests for lib/snapshotFiles.ts.
 *
 * Both readers swallow parse errors and return null, so a regression here is
 * silent: the trace pane just renders empty. Before schema_version 3 these
 * read the run log's inline snapshot; they now read on-disk content supplied
 * by `readSnapshotFiles`. Nothing covered them until that change.
 */
import { describe, it, expect } from 'vitest';
import { findFixtureResponse, findTestJson } from '../../lib/snapshotFiles';

const SKILL = 'search-familysearch-wiki';

function files(): Record<string, string> {
  return {
    [`eval/tests/unit/${SKILL}/ut_001.json`]: JSON.stringify({
      test: { id: 'ut_001', skill: SKILL },
      input: { user_message: 'first' },
    }),
    [`eval/tests/unit/${SKILL}/ut_002.json`]: JSON.stringify({
      test: { id: 'ut_002', skill: SKILL },
      input: { user_message: 'second' },
    }),
    [`eval/tests/unit/${SKILL}/rubric.md`]: '# rubric\n',
    'eval/fixtures/mcp/wiki-search-cork.json': JSON.stringify({
      tool: 'wiki_search',
      description: 'd',
      response: { results: [{ title: 'Cork' }] },
    }),
    'eval/fixtures/mcp/untagged.json': JSON.stringify({ bare: true }),
    'eval/fixtures/mcp/broken.json': '{not json',
  };
}

describe('findTestJson', () => {
  it('returns the test file matching test.id', () => {
    const found = findTestJson(files(), SKILL, 'ut_002');
    expect((found as { input: { user_message: string } }).input.user_message).toBe('second');
  });

  it('returns null when no file matches the id', () => {
    expect(findTestJson(files(), SKILL, 'ut_999')).toBeNull();
  });

  it('returns null for a different skill, and ignores non-JSON siblings', () => {
    expect(findTestJson(files(), 'other-skill', 'ut_001')).toBeNull();
  });

  it('skips a malformed entry instead of throwing', () => {
    const f = { ...files(), [`eval/tests/unit/${SKILL}/bad.json`]: '{not json' };
    expect(findTestJson(f, SKILL, 'ut_001')).not.toBeNull();
  });

  it('returns null on an empty file map — the schema_version 3 regression shape', () => {
    expect(findTestJson({}, SKILL, 'ut_001')).toBeNull();
  });
});

describe('findFixtureResponse', () => {
  it('unwraps the response body', () => {
    expect(findFixtureResponse(files(), 'wiki-search-cork')).toEqual({
      results: [{ title: 'Cork' }],
    });
  });

  it('falls back to the whole file when there is no response key', () => {
    expect(findFixtureResponse(files(), 'untagged')).toEqual({ bare: true });
  });

  it('returns null for a missing fixture', () => {
    expect(findFixtureResponse(files(), 'nope')).toBeNull();
  });

  it('returns null for a malformed fixture instead of throwing', () => {
    expect(findFixtureResponse(files(), 'broken')).toBeNull();
  });
});

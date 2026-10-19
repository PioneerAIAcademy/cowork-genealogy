import { describe, it, expect } from 'vitest';
import { stripUnusedInputKey } from '@/lib/testInput';
import { UnitTestSchema } from '@/lib/schema/unit-test';
import type { UnitTestFile } from '@/lib/types';

/**
 * `input.oneOf` keys on the KEY BEING PRESENT, not on its value. The authoring
 * form seeds both `user_message` and `delegation`, so without the strip every
 * test saved from the UI carries `"delegation": ""`, matches BOTH branches, and
 * is rejected by harness/loader.py — reddening test_unit_test_corpus.py for a
 * test a genealogist just authored.
 */
const base = (input: UnitTestFile['input']): UnitTestFile => ({
  test: { id: 'ut_citation_abc', skill: 'citation', name: 'n', type: 'positive', description: 'd', tags: [] },
  input,
  mcp_fixtures: [],
  judge_context: [],
});

describe('stripUnusedInputKey', () => {
  it('drops the blank delegation the form seeds beside a real user_message', () => {
    const input = stripUnusedInputKey({ user_message: 'hello', delegation: '', scenario: null, scenario_notes: null });
    expect('delegation' in input).toBe(false);
    expect(input.user_message).toBe('hello');
  });

  it('drops the blank user_message the form seeds beside a real delegation', () => {
    const input = stripUnusedInputKey({ user_message: '', delegation: 'assess q_001', scenario: null, scenario_notes: null });
    expect('user_message' in input).toBe(false);
    expect(input.delegation).toBe('assess q_001');
  });

  it('treats whitespace as blank', () => {
    const input = stripUnusedInputKey({ user_message: 'hello', delegation: '   \n ', scenario: null, scenario_notes: null });
    expect('delegation' in input).toBe(false);
  });

  it('keeps a populated key untouched — the accept direction', () => {
    const input = stripUnusedInputKey({ user_message: 'hello', scenario: 'flynn', scenario_notes: null });
    expect(input.user_message).toBe('hello');
    expect(input.scenario).toBe('flynn');
  });

  // The reason the strip exists: the schema is what rejects the un-stripped shape.
  it('the un-stripped form payload is schema-INVALID, the stripped one is valid', () => {
    const raw = { user_message: 'hello', delegation: '', scenario: null, scenario_notes: null };
    expect(UnitTestSchema.safeParse(base({ ...raw })).success).toBe(false);
    expect(UnitTestSchema.safeParse(base(stripUnusedInputKey({ ...raw }))).success).toBe(true);
  });

  it('a direct payload round-trips valid too', () => {
    const raw = { user_message: '', delegation: 'assess q_001', scenario: null, scenario_notes: null };
    expect(UnitTestSchema.safeParse(base(stripUnusedInputKey({ ...raw }))).success).toBe(true);
  });
});

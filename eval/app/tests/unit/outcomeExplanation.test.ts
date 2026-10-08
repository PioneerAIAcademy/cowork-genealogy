import { describe, expect, it } from 'vitest';
import {
  deriveOutcomeExplanation,
  outcomeColor,
} from '@/lib/outcomeExplanation';
import type { TestEntry } from '@/lib/types';

// Issue #2842: xfail/xpass are no longer `outcome` values. Both the explanation
// note and the badge colour must be re-derived from the `expected_outcome`
// marker beside the real outcome. The ordering matters: a suppressed failure has
// `outcome: fail`, so its branch must run before the fail/aborted routing gate
// or it falls through to the routing-miss explanation.

function entry(over: Partial<TestEntry>): TestEntry {
  return {
    test_id: 'ut_x_001',
    test_type: 'positive',
    expected_outcome: 'pass',
    outcome: 'pass',
    runs: [],
    ...over,
  } as TestEntry;
}

describe('deriveOutcomeExplanation — declared-xfail suppression', () => {
  it('a declared-xfail failure gets the gray "expected failure" note (before the fail gate)', () => {
    const e = entry({
      expected_outcome: 'xfail',
      outcome: 'fail',
      // A routing-miss shape that WOULD produce an orange note if the branch
      // order were wrong and this fell through the fail gate.
      runs: [
        { outcome: 'fail', output: { activated: false, skills_invoked: [] } },
      ] as unknown as TestEntry['runs'],
    });
    const note = deriveOutcomeExplanation(e, 'my-skill');
    expect(note).not.toBeNull();
    expect(note!.color).toBe('gray');
    expect(note!.title).toContain('Expected failure');
  });

  it('a declared-xfail that passed gets the orange "unexpected pass" note', () => {
    const e = entry({ expected_outcome: 'xfail', outcome: 'pass' });
    const note = deriveOutcomeExplanation(e, 'my-skill');
    expect(note).not.toBeNull();
    expect(note!.color).toBe('orange');
    expect(note!.title).toContain('Unexpected pass');
  });

  it('an ordinary pass with no marker still returns null', () => {
    expect(deriveOutcomeExplanation(entry({ outcome: 'pass' }), 'my-skill')).toBeNull();
  });

  it('an unmarked routing-miss fail still gets the routing-miss note', () => {
    const e = entry({
      outcome: 'fail',
      runs: [
        { outcome: 'fail', output: { activated: false, skills_invoked: [] } },
      ] as unknown as TestEntry['runs'],
    });
    const note = deriveOutcomeExplanation(e, 'my-skill');
    expect(note).not.toBeNull();
    expect(note!.title).toContain('Routing miss');
  });
});

describe('outcomeColor — derived from the marker', () => {
  it('a declared-xfail failure is gray', () => {
    expect(outcomeColor('fail', 'xfail')).toBe('gray');
  });
  it('a declared-xfail that passed is orange', () => {
    expect(outcomeColor('pass', 'xfail')).toBe('orange');
  });
  it('an ordinary pass/partial/fail keep green/yellow/red', () => {
    expect(outcomeColor('pass', 'pass')).toBe('green');
    expect(outcomeColor('partial', 'pass')).toBe('yellow');
    expect(outcomeColor('fail', 'pass')).toBe('red');
    expect(outcomeColor('aborted', 'pass')).toBe('red');
  });
  it('an ordinary pass with no marker is green, not orange', () => {
    expect(outcomeColor('pass')).toBe('green');
    expect(outcomeColor('fail')).toBe('red');
  });
});

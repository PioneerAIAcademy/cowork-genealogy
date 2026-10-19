/**
 * Tests for dimensionAllowsNa (lib/types.ts) — decides when the annotation
 * score picker offers the N/A (null) option.
 *
 * Three independent reasons N/A is available:
 *
 *  1. The judge scored null — the reviewer must be able to agree (any source).
 *  2. The dimension is a rubric dimension — the judge can score a rubric
 *     dimension non-null on a fixture that never exercised it (e.g.
 *     Severity classification on a clean-data run where no warnings fired),
 *     and the reviewer must be able to correct that to null. This was the
 *     second regression: Severity classification was graded 3 in two runs and
 *     N/A in a third run on byte-identical output (issue #1965).
 *  3. The dimension is a declared nullable base dimension (Tool Arguments) —
 *     N/A is always available there regardless of the judge score.
 *
 * Base dimensions that are NOT in NULLABLE_BASE_DIMENSIONS (Correctness,
 * Completeness) still offer N/A only when the judge scored null.
 */
import { describe, it, expect } from 'vitest';
import { dimensionAllowsNa } from '../../lib/types';

describe('dimensionAllowsNa', () => {
  it('offers N/A when the judge scored a RUBRIC dimension null', () => {
    expect(dimensionAllowsNa('rubric', 'Actionability', null, true)).toBe(true);
    expect(dimensionAllowsNa('rubric', 'Severity classification', null, true)).toBe(
      true,
    );
  });

  it('offers N/A for any rubric dimension even when the judge gave 1/2/3', () => {
    // The judge can score a rubric dimension non-null on a fixture that never
    // exercised it; the reviewer must be able to correct to N/A.
    expect(dimensionAllowsNa('rubric', 'Actionability', 3, true)).toBe(true);
    expect(dimensionAllowsNa('rubric', 'Severity classification', 1, true)).toBe(true);
    expect(dimensionAllowsNa('rubric', 'Evidence Explained compliance', 2, true)).toBe(
      true,
    );
  });

  it('offers N/A when the judge scored a base dimension null', () => {
    expect(dimensionAllowsNa('base', 'Tool Arguments', null, true)).toBe(true);
    expect(dimensionAllowsNa('base', 'Correctness', null, true)).toBe(true);
  });

  it('offers N/A on the nullable base dimension even when judge gave 1/2/3', () => {
    expect(dimensionAllowsNa('base', 'Tool Arguments', 3, true)).toBe(true);
    expect(dimensionAllowsNa('base', 'Tool Arguments', 1, true)).toBe(true);
  });

  it('does NOT offer N/A for a scored non-nullable base dimension', () => {
    expect(dimensionAllowsNa('base', 'Correctness', 3, true)).toBe(false);
    expect(dimensionAllowsNa('base', 'Completeness', 1, true)).toBe(false);
  });

  // --- Case 3: the dimensions do not gate this test's outcome ---------------
  //
  // BASE dimensions only, deliberately. Case 2 above already allows N/A on any
  // rubric dimension whatever the score, so a rubric assertion here would pass
  // with case 3 deleted and pin nothing. The gap case 3 closes is a BASE 1 on
  // an already-committed routing negative, which no other case reaches.

  it('offers N/A on a recorded base 1 when the dimensions do NOT gate', () => {
    // THE REGRESSION. Routing decided this test; the base 1 is diagnostic and
    // may be grading a transcript the harness truncated at the hand-off. On an
    // already-committed log the score is a recorded 1, so cases 1 and 2 both
    // miss it and issue #2375's re-grade could not be entered at all.
    expect(dimensionAllowsNa('base', 'Correctness', 1, false)).toBe(true);
    expect(dimensionAllowsNa('base', 'Completeness', 2, false)).toBe(true);
  });

  it('does NOT widen a base dimension when the gating flag is absent', () => {
    // Every run log written before the field shipped. `undefined` is not
    // `false`: treating them alike would offer N/A on every base dimension in
    // the committed corpus.
    expect(dimensionAllowsNa('base', 'Correctness', 3, undefined)).toBe(false);
    expect(dimensionAllowsNa('base', 'Completeness', 1, undefined)).toBe(false);
  });

  it('does NOT offer N/A on a base dimension of a GATING test', () => {
    // The control. A positive test's dimensions decide the outcome, so N/A
    // there would erase a real failure.
    expect(dimensionAllowsNa('base', 'Correctness', 1, true)).toBe(false);
    expect(dimensionAllowsNa('base', 'Completeness', 2, true)).toBe(false);
  });
});

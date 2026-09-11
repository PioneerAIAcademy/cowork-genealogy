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
    expect(dimensionAllowsNa('rubric', 'Actionability', null)).toBe(true);
    expect(dimensionAllowsNa('rubric', 'Severity classification', null)).toBe(
      true,
    );
  });

  it('offers N/A for any rubric dimension even when the judge gave 1/2/3', () => {
    // The judge can score a rubric dimension non-null on a fixture that never
    // exercised it; the reviewer must be able to correct to N/A.
    expect(dimensionAllowsNa('rubric', 'Actionability', 3)).toBe(true);
    expect(dimensionAllowsNa('rubric', 'Severity classification', 1)).toBe(true);
    expect(dimensionAllowsNa('rubric', 'Evidence Explained compliance', 2)).toBe(
      true,
    );
  });

  it('offers N/A when the judge scored a base dimension null', () => {
    expect(dimensionAllowsNa('base', 'Tool Arguments', null)).toBe(true);
    expect(dimensionAllowsNa('base', 'Correctness', null)).toBe(true);
  });

  it('offers N/A on the nullable base dimension even when judge gave 1/2/3', () => {
    expect(dimensionAllowsNa('base', 'Tool Arguments', 3)).toBe(true);
    expect(dimensionAllowsNa('base', 'Tool Arguments', 1)).toBe(true);
  });

  it('does NOT offer N/A for a scored non-nullable base dimension', () => {
    expect(dimensionAllowsNa('base', 'Correctness', 3)).toBe(false);
    expect(dimensionAllowsNa('base', 'Completeness', 1)).toBe(false);
  });
});

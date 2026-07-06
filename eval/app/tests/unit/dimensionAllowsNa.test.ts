/**
 * Tests for dimensionAllowsNa (lib/types.ts) — decides when the annotation
 * score picker offers the N/A (null) option.
 *
 * Regression: rubric dimensions that the judge legitimately scored null
 * (e.g. check-warnings' Actionability when the project is clean) used to get
 * no N/A button, so the reviewer was forced to pick 3 — manufacturing a
 * null-vs-3 "disagreement" that was really just a UI gap.
 */
import { describe, it, expect } from 'vitest';
import { dimensionAllowsNa } from '../../lib/types';

describe('dimensionAllowsNa', () => {
  it('offers N/A when the judge scored a RUBRIC dimension null (the bug)', () => {
    expect(dimensionAllowsNa('rubric', 'Actionability', null)).toBe(true);
    expect(dimensionAllowsNa('rubric', 'Severity classification', null)).toBe(
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

  it('does NOT offer N/A for a scored rubric dimension', () => {
    expect(dimensionAllowsNa('rubric', 'Actionability', 3)).toBe(false);
    expect(dimensionAllowsNa('rubric', 'Evidence Explained compliance', 2)).toBe(
      false,
    );
  });

  it('does NOT offer N/A for a scored non-nullable base dimension', () => {
    expect(dimensionAllowsNa('base', 'Correctness', 3)).toBe(false);
    expect(dimensionAllowsNa('base', 'Completeness', 1)).toBe(false);
  });
});

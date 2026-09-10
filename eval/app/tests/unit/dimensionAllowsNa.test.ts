/**
 * Tests for dimensionAllowsNa (lib/types.ts) — decides when the annotation
 * score picker offers the N/A (null) option.
 *
 * Regression 1: rubric dimensions that the judge legitimately scored null
 * (e.g. check-warnings' Actionability when the project is clean) used to get
 * no N/A button, so the reviewer was forced to pick 3 — manufacturing a
 * null-vs-3 "disagreement" that was really just a UI gap.
 *
 * Regression 2: on an ALREADY-COMMITTED run log a diagnostic `1` on a routing
 * negative could not be corrected to N/A at all, because the first two cases
 * only match a judge score that is already null. The N/A coercion makes future
 * runs null, so the gap is invisible going forward and total for the ten cells
 * issue #2375 has to re-grade. An annotator hit it on `ut_record_extraction_011`
 * and both cells went in as `corrected_score: 1`.
 *
 * The first two groups below pass `true` for `dimensionsGateOutcome`, so none of
 * them can pass via case 3 — otherwise widening the predicate would have made
 * them tautological.
 */
import { describe, it, expect } from 'vitest';
import { dimensionAllowsNa } from '../../lib/types';

describe('dimensionAllowsNa', () => {
  it('offers N/A when the judge scored a RUBRIC dimension null (the bug)', () => {
    expect(dimensionAllowsNa('rubric', 'Actionability', null, true)).toBe(true);
    expect(dimensionAllowsNa('rubric', 'Severity classification', null, true)).toBe(
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

  it('does NOT offer N/A for a scored rubric dimension', () => {
    expect(dimensionAllowsNa('rubric', 'Actionability', 3, true)).toBe(false);
    expect(dimensionAllowsNa('rubric', 'Evidence Explained compliance', 2, true)).toBe(
      false,
    );
  });

  it('does NOT offer N/A for a scored non-nullable base dimension', () => {
    expect(dimensionAllowsNa('base', 'Correctness', 3, true)).toBe(false);
    expect(dimensionAllowsNa('base', 'Completeness', 1, true)).toBe(false);
  });

  // --- Case 3: the dimensions do not gate this test's outcome ---------------

  it('offers N/A on a recorded 1 when the dimensions do NOT gate the outcome', () => {
    // THE REGRESSION. Routing decided this test; the base 1 is diagnostic and
    // may be grading a transcript the harness truncated at the hand-off.
    expect(dimensionAllowsNa('base', 'Correctness', 1, false)).toBe(true);
    expect(dimensionAllowsNa('base', 'Completeness', 1, false)).toBe(true);
  });

  it('offers N/A on a non-gating test for rubric dimensions too', () => {
    // `dimensions_gate_outcome: false` says NO dimension decides the outcome,
    // so scoping case 3 to base dimensions would leave a rubric 1 on the same
    // test uncorrectable for the same wrong reason.
    expect(dimensionAllowsNa('rubric', 'Sequencing Logic', 2, false)).toBe(true);
  });

  it('does NOT widen anything when the gating flag is absent', () => {
    // Every run log written before the field shipped. `undefined` is not
    // `false`: a pre-sampling log must behave exactly as it did before, or this
    // change silently offers N/A across the whole committed corpus.
    expect(dimensionAllowsNa('base', 'Correctness', 3, undefined)).toBe(false);
    expect(dimensionAllowsNa('base', 'Completeness', 1, undefined)).toBe(false);
    expect(dimensionAllowsNa('rubric', 'Actionability', 3, undefined)).toBe(false);
  });

  it('does NOT offer N/A on a gating test with a scored dimension', () => {
    // The control for case 3. A positive test's dimensions DO decide the
    // outcome, so N/A there would erase a real failure.
    expect(dimensionAllowsNa('base', 'Correctness', 1, true)).toBe(false);
    expect(dimensionAllowsNa('rubric', 'Sequencing Logic', 2, true)).toBe(false);
  });
});

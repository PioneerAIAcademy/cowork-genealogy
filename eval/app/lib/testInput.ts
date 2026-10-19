import type { UnitTestFile } from './types';

/**
 * Drop whichever of `user_message` / `delegation` is blank.
 *
 * `input.oneOf` in unit-test.schema.json keys on the KEY BEING PRESENT, not on
 * its value, so a payload carrying both — even with one empty string — matches
 * both branches and is rejected by `harness/loader.py`. The authoring form seeds
 * both fields, so the unused one has to be removed rather than merely left
 * blank: without this every test saved from the UI is schema-invalid and reds
 * `test_unit_test_corpus.py`.
 *
 * Mutates and returns `input` — callers pass a deep clone of the form values.
 */
export function stripUnusedInputKey(input: UnitTestFile['input']): UnitTestFile['input'] {
  if (!(input.user_message ?? '').trim()) delete input.user_message;
  if (!(input.delegation ?? '').trim()) delete input.delegation;
  return input;
}

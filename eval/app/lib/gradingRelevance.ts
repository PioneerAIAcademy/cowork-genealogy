/**
 * Which unit-test fields invalidate a run log when edited.
 *
 * **Why this is its own module.** This logic existed twice — exported from
 * `lib/fs/tests.ts` (unit-tested, but called by nothing else) and copied
 * privately into `components/forms/TestForm.tsx` (uncalled by tests, but the
 * only copy the authoring UI runs), kept together by a "keep this in sync"
 * comment. They drifted: `input.delegation` was added to the exported copy and
 * the UI kept saving direct-agent tests without flagging the run log stale
 * (issue #2246). `lib/fs/tests.ts` imports `node:fs`, so a `'use client'`
 * component cannot import it — hence a pure module both sides can share, rather
 * than a third copy.
 *
 * Editing one of these fields means the committed run log no longer describes
 * the test, so the skill owes a re-run.
 */
import type { UnitTestFile } from './types';

export const GRADING_RELEVANT_FIELDS = [
  'input.user_message',
  'input.delegation',
  'input.scenario',
  'mcp_fixtures',
  'judge_context',
  'negative',
  'test.holdout',
  'test.expected_outcome',
  'test.xfail_reason',
  'test.tags',
  'judge_reads_files',
] as const;

/** True if any grading-relevant field differs between `before` and `after`. */
export function hasGradingRelevantChange(
  before: UnitTestFile,
  after: UnitTestFile,
): boolean {
  if ((before.input.user_message ?? null) !== (after.input.user_message ?? null)) return true;
  // The delegation is the entire instruction a direct-agent test gives the run,
  // and the harness asserts the recorded spawn carries it verbatim — so editing
  // it changes what the run was, exactly as a user_message edit does.
  if ((before.input.delegation ?? null) !== (after.input.delegation ?? null)) return true;
  if ((before.input.scenario ?? null) !== (after.input.scenario ?? null)) return true;
  if (JSON.stringify(before.mcp_fixtures ?? []) !== JSON.stringify(after.mcp_fixtures ?? [])) return true;
  if (JSON.stringify(before.judge_context) !== JSON.stringify(after.judge_context)) return true;
  if (JSON.stringify(before.negative ?? null) !== JSON.stringify(after.negative ?? null)) return true;
  // tags select validators and change outcome computation (issue #2694).
  // They are no longer cosmetic — only name/description are stripped.
  if (JSON.stringify(before.test.tags ?? []) !== JSON.stringify(after.test.tags ?? [])) return true;
  // holdout survives snapshot normalization (only name/description are
  // stripped), so toggling it changes the content hash.
  if ((before.test.holdout ?? false) !== (after.test.holdout ?? false)) return true;
  // judge_reads_files likewise survives normalization and changes what the
  // judge sees — toggling it invalidates the content hash.
  if ((before.judge_reads_files ?? false) !== (after.judge_reads_files ?? false)) return true;
  // expected_outcome / xfail_reason survive normalization too, and
  // expected_outcome changes how the harness labels the result — so a run log
  // taken under the old marking no longer describes the test.
  if ((before.test.expected_outcome ?? 'pass') !== (after.test.expected_outcome ?? 'pass')) return true;
  if ((before.test.xfail_reason ?? '') !== (after.test.xfail_reason ?? '')) return true;
  return false;
}

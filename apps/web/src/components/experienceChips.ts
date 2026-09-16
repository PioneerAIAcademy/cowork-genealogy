// Selectable answers for init-project's opening-turn experience-level question
// (issue #1932). Split out of ChatPane so the string surgery and the visibility
// rule are unit-testable without a DOM — the same split chatEvents.ts got for
// issue #1312.
//
// Hosted web only. Cowork renders its own chat UI, which the plugin does not
// control, so init-project can never depend on this: its prose question keeps
// working unchanged and a user who ignores the chips gets the documented
// defaults exactly as before.

import type { ExperienceLevel } from '@genealogy/schema'

// Exhaustive BY CONSTRUCTION, and that is the whole point of the Record: adding,
// removing or renaming a value in packages/schema/schemas/enums.schema.json
// fails `make typecheck` here rather than leaving the UI silently short a chip.
// It has to be a map and not an array because `ExperienceLevel` is a TYPE-only
// union — gen-enums.mjs emits no runtime array — so there is nothing to import
// and iterate.
//
// Labels are init-project's own (a)-(d) wording (init-project/SKILL.md), so a
// chip reads as the answer to the question actually on screen.
export const EXPERIENCE_CHIPS: Record<ExperienceLevel, string> = {
  novice: 'just starting out',
  intermediate: 'some research under my belt',
  experienced: 'experienced',
  professional: 'professional/certified'
}

// Insert the ENUM VALUE, not the label. `experience_level` is a closed enum and
// the skill scans this message for a stated level, so the enum spelling is the
// one it cannot mis-map.
export function chipMessage(value: ExperienceLevel): string {
  return `My genealogy experience: ${value}`
}

/**
 * Single-select composer surgery: replace the previously inserted chip if it is
 * still there, otherwise append.
 *
 * Replace-not-append is what makes the row single-select without a radio group:
 * clicking three chips in a row must leave ONE answer in the composer, not
 * three. The `previous` string is passed in rather than re-derived, because the
 * user may have edited it away — in which case this appends instead, and a chip
 * they deleted stays deleted.
 *
 * Free text the user typed around the chip survives, which is why this is a
 * substring replace on the live composer value rather than a rewrite of it.
 */
export function applyChip(input: string, previous: string | null, next: string): string {
  if (previous && input.includes(previous)) return input.replace(previous, next)
  if (input.length === 0) return next
  return /\s$/.test(input) ? input + next : `${input} ${next}`
}

/**
 * Show the chips only on the onramp turn init-project asks this question on.
 *
 * `isNew` is true only for a session opened from +New — App.tsx sets it false
 * for a session restored from the URL — and that is the session that auto-sends
 * the opening turn. So exactly one user message means the auto-sent opening turn
 * is the only one, and the user has not answered yet.
 *
 * Two accepted limits of this deliberately cheap trigger, per the card, NOT
 * defects: a page reload mid-onramp loses the chips, and they never return on a
 * resumed session. Do not query project state or add a status frame to make it
 * exact — if it turns out fragile in practice, add a real event kind instead.
 */
export function shouldShowExperienceChips(
  isNew: boolean,
  messages: readonly { role: string }[]
): boolean {
  // The assistant clause is what keeps the chips from leading the question.
  // `turn_start` is inert in `applyEvent`, so between `send(OPENING_TURN)` and
  // the first content token `messages` is exactly one user entry — four bare
  // chips under the user's own message with nothing on screen asking anything.
  // Still counts messages only; it never reaches for project state.
  return (
    isNew &&
    messages.filter((m) => m.role === 'user').length === 1 &&
    messages.some((m) => m.role === 'assistant')
  )
}

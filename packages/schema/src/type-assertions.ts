/**
 * Type-level guards for constraints that live in a type and nowhere else.
 *
 * This package has a `typecheck` task and no test task, so a constraint
 * expressed only in a type needs a type to hold it. Nothing imports this file:
 * `tsc` checks it because it is under `src/`, and that is the whole mechanism.
 * These emit no runtime code.
 */

import type { Plan } from './index.js'

/** Fails to compile unless `T` is exactly `true`. */
type Expect<T extends true> = T

/**
 * An empty `items` array must NOT satisfy `Plan`.
 *
 * `$defs/plan.items` in `research.schema.json` is `{ type: array, minItems: 1 }`
 * in both schema trees, but a plain `PlanItem[]` admits `[]`, so this mirror
 * silently disagreed with the schema it exists to mirror — the same drift the
 * engine's runtime validator carried, and the reason a `plans[].items: []`
 * reached a persisted document with three of four sources of truth saying it
 * could not.
 *
 * Widening `Plan['items']` back to `PlanItem[]` makes `[]` assignable, which
 * flips this to `Expect<false>` and fails `tsc --noEmit`. Nothing else would
 * notice: the schema-mirror drift test compares `required` against `?`, not
 * arrayness, and every consumer in this repo only reads `plan.items`.
 */
export type _EmptyPlanItemsStayRejected = Expect<
  ([] extends Plan['items'] ? true : false) extends false ? true : false
>

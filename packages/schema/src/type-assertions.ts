/**
 * Type-level guards for constraints that live in a type and nowhere else.
 *
 * This package has a `typecheck` task and no test task, so a constraint
 * expressed only in a type needs a type to hold it. Nothing imports this file:
 * `tsc` checks it because it is under `src/`, and that is the whole mechanism.
 * These emit no runtime code.
 *
 * Why not fold this into the sibling drift guard. The check that compares these
 * interfaces to the JSON Schema is `schema-interface-drift.test.ts`, over in
 * `packages/viewer-ui`, and it compares field NAMES and OPTIONALITY rather than
 * value types. A general `minItems` arm there would be the systematic home, and
 * it would guard exactly one field today: `$defs/plan.items` is the schema's
 * only PROPERTY-level `minItems`, the other three sitting inside
 * `allOf`/`if`/`then`. A second property-level `minItems` is the trigger to move
 * this there rather than add a second assertion here.
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
 * reached a persisted document while two of the five sources of truth, this
 * mirror among them, failed to say it could not.
 *
 * Widening `Plan['items']` back to `PlanItem[]` makes `[]` assignable, which
 * flips this to `Expect<false>` and fails `tsc --noEmit`. Nothing else would
 * notice: the schema-mirror drift test compares `required` against `?`, not
 * arrayness. The eval CRUD UI used to keep its own hand-written `Plan` in
 * `eval/app/components/scenario/lib/schema.ts`, npm-managed and outside this
 * workspace's typecheck; #1488 made it a workspace member and collapsed that
 * file to a re-export, so it consumes this tuple type and `pnpm turbo run
 * typecheck` compiles it.
 */
export type _EmptyPlanItemsStayRejected = Expect<
  ([] extends Plan['items'] ? true : false) extends false ? true : false
>

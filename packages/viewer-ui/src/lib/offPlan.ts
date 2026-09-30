// "Work with no plan item goes in an explicit off-plan group."
//
// Measured on the captured session: 3 of 52 log entries (6%) carry no
// `plan_item_id` -- real side searches that happened and that the plan never
// mentions. Without a group for them the ticking plan reads as if it covered
// everything the run did, which is the quiet version of lying to the reader.

export interface LogLike {
  id?: string
  plan_item_id?: string
  [k: string]: unknown
}

export interface OffPlanSplit<T> {
  onPlan: T[]
  offPlan: T[]
}

/**
 * Split a research log into work the plan accounted for and work it did not.
 *
 * `knownItemIds`, when given, also sends a DANGLING reference to the off-plan group:
 * an entry naming a plan item that no longer exists is not coverage, and counting it
 * as on-plan would let the plan claim work it never planned.
 */
export function splitOffPlan<T extends LogLike>(
  entries: T[],
  knownItemIds?: ReadonlySet<string>
): OffPlanSplit<T> {
  const onPlan: T[] = []
  const offPlan: T[] = []
  for (const e of entries) {
    const ref = e.plan_item_id
    const covered = Boolean(ref) && (knownItemIds ? knownItemIds.has(ref as string) : true)
    ;(covered ? onPlan : offPlan).push(e)
  }
  return { onPlan, offPlan }
}

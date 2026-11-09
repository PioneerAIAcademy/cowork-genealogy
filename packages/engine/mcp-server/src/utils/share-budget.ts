// One character budget shared among several parts of an answer, smallest claim first.
// `catalog_search` shares its film-note room among hits this way, and `sidecar_read`
// shares a `refs` batch's room among its refs.

/**
 * Share `budget` among `claims`, smallest first. With `m` claims left, each is offered
 * what is left of the budget divided by `m`, rounded down. A claim no larger than its
 * offer is met in full, and what it did not take goes on to the claims after it, so one
 * large claim cannot starve the small ones and the room the small ones leave goes to
 * the large. A claim larger than its offer is settled by `settle(index, offer)`, which
 * returns what that claim actually used; whatever of the offer it leaves goes on too.
 * Ties keep the claims' own order. Returns what each claim used, in the claims' order.
 */
export function shareBudget(
  claims: readonly number[],
  budget: number,
  settle: (index: number, offer: number) => number,
): number[] {
  const used = claims.map(() => 0);
  const order = claims.map((_, i) => i).sort((a, b) => claims[a] - claims[b]);
  let left = Math.max(0, budget);
  order.forEach((i, k) => {
    // A settle that went over its offer can leave `left` below zero; no offer is.
    const offer = Math.max(0, Math.floor(left / (order.length - k)));
    used[i] = claims[i] <= offer ? claims[i] : settle(i, offer);
    left -= used[i];
  });
  return used;
}

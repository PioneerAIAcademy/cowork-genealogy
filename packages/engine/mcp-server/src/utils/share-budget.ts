// One character budget shared among several parts of an answer, smallest claim first, two
// ways. `catalog_search` shares its film-note room among hits about equally
// (`shareBudget`), and `sidecar_read` fills a `refs` batch's room with whole refs
// (`fillWholeFirst`).

/** The claims' indexes, smallest claim first; ties keep the claims' own order. */
function smallestFirst(claims: readonly number[]): number[] {
  return claims.map((_, i) => i).sort((a, b) => claims[a] - claims[b]);
}

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
  const order = smallestFirst(claims);
  let left = Math.max(0, budget);
  order.forEach((i, k) => {
    // A settle that went over its offer can leave `left` below zero; no offer is.
    const offer = Math.max(0, Math.floor(left / (order.length - k)));
    used[i] = claims[i] <= offer ? claims[i] : settle(i, offer);
    left -= used[i];
  });
  return used;
}

/**
 * Fill `budget` with whole claims, smallest first. A claim no larger than what is left
 * is met in full. The first claim that is larger is settled by `settle(index, left)`,
 * which returns what that claim actually used, and every claim after it by
 * `settle(index, 0)`, so at most one claim is met in part. Ties keep the claims' own
 * order. Returns what each claim used, in the claims' order.
 */
export function fillWholeFirst(
  claims: readonly number[],
  budget: number,
  settle: (index: number, offer: number) => number,
): number[] {
  const used = claims.map(() => 0);
  let left = Math.max(0, budget);
  let full = false;
  for (const i of smallestFirst(claims)) {
    if (!full && claims[i] <= left) {
      used[i] = claims[i];
      left -= claims[i];
      continue;
    }
    used[i] = settle(i, full ? 0 : left);
    full = true;
  }
  return used;
}

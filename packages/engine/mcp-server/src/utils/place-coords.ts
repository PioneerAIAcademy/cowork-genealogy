// Coordinates and the era-banded birthplace distance, shared by person_warnings
// (birth far from the parents' residence), research_append (the
// contradicted-birthplace cap) and timeline_build.
import { mapWithConcurrency, type PlaceCoords } from "./place-resolver.js";
import { isFsBudgetExhausted } from "./fs-budget.js";

const PLACE_LOOKUP_CONCURRENCY = 4;

export type PlaceCoordsResolver = (
  standardPlace: string,
) => Promise<PlaceCoords | null>;

/** The era threshold; a range touching more than one era gets the most generous. */
export function birthThresholdMiles(minYear: number, maxYear: number): number {
  let miles = 0;
  if (minYear < 1850) miles = Math.max(miles, 25);
  if (minYear <= 1949 && maxYear >= 1850) miles = Math.max(miles, 250);
  if (maxYear >= 1950) miles = Math.max(miles, 500);
  return miles;
}

/** Answer every distinct name once through `resolver`, four at a time. A name
 *  whose lookup throws, or is still open when `budgetMs` runs out, answers null.
 *  `onExpired` is called once when the budget ran out with a lookup still open. */
export async function lookupWithin<T>(
  names: string[],
  resolver: (name: string) => Promise<T | null>,
  budgetMs: number,
  onExpired?: () => void,
): Promise<Map<string, T | null>> {
  const answers = new Map<string, T | null>();
  const distinct = [...new Set(names)];
  for (const name of distinct) answers.set(name, null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  // Recorded as well as rethrown. Usually the rethrow is enough -- a spent
  // budget refuses before any network I/O, so `lookups` rejects long before
  // `cap` fires and the rejection wins the race. But when the budget runs out
  // near the deadline, `cap` can win first and the refusal is then discarded
  // with the losing promise, leaving the caller an all-null map it blames on
  // its own time budget.
  let refusal: unknown;
  const lookups = mapWithConcurrency(distinct, PLACE_LOOKUP_CONCURRENCY, async (name) => {
    if (expired) return;
    let found: T | null = null;
    try {
      found = await resolver(name);
    } catch (err) {
      // A budget refusal is not an answer: returning null here tells the
      // agent the place has no coordinates when the truth is that the
      // server is rate-limited. Rethrow so the cause reaches the caller.
      if (isFsBudgetExhausted(err)) {
        refusal ??= err;
        throw err;
      }
      found = null;
    }
    if (!expired) answers.set(name, found);
  });
  const cap = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      expired = true;
      resolve();
      onExpired?.();
    }, budgetMs);
  });
  // A rejection that loses the race still needs a handler, or it surfaces as
  // an unhandled rejection after this function has already returned.
  lookups.catch((err: unknown) => {
    if (isFsBudgetExhausted(err)) refusal ??= err;
  });
  try {
    await Promise.race([lookups, cap]);
  } finally {
    clearTimeout(timer);
  }
  if (refusal !== undefined) throw refusal;
  return answers;
}

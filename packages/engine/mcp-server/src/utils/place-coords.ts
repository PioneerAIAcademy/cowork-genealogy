// Coordinates and the era-banded birthplace distance, shared by person_warnings
// (birth far from the parents' residence) and research_append (the
// contradicted-birthplace cap).
import { mapWithConcurrency, type PlaceCoords } from "./place-resolver.js";

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

/** Look up every distinct place once; a name not resolved within the budget stays null. */
export async function lookupPlaceCoords(
  names: string[],
  resolver: PlaceCoordsResolver,
  budgetMs: number,
): Promise<Map<string, PlaceCoords | null>> {
  return lookupWithin(names, resolver, budgetMs);
}

/** Answer every distinct name once through `resolver`, four at a time. A name
 *  whose lookup throws, or is still open when `budgetMs` runs out, answers null. */
export async function lookupWithin<T>(
  names: string[],
  resolver: (name: string) => Promise<T | null>,
  budgetMs: number,
): Promise<Map<string, T | null>> {
  const answers = new Map<string, T | null>();
  const distinct = [...new Set(names)];
  for (const name of distinct) answers.set(name, null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  const lookups = mapWithConcurrency(distinct, PLACE_LOOKUP_CONCURRENCY, async (name) => {
    if (expired) return;
    let found: T | null = null;
    try {
      found = await resolver(name);
    } catch {
      found = null;
    }
    if (!expired) answers.set(name, found);
  });
  const cap = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      expired = true;
      resolve();
    }, budgetMs);
  });
  try {
    await Promise.race([lookups, cap]);
  } finally {
    clearTimeout(timer);
  }
  return answers;
}

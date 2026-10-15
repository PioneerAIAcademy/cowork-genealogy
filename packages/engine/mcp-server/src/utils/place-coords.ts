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
  const coords = new Map<string, PlaceCoords | null>();
  const distinct = [...new Set(names)];
  for (const name of distinct) coords.set(name, null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  const lookups = mapWithConcurrency(distinct, PLACE_LOOKUP_CONCURRENCY, async (name) => {
    if (expired) return;
    let found: PlaceCoords | null = null;
    try {
      found = await resolver(name);
    } catch {
      found = null;
    }
    if (!expired) coords.set(name, found);
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
  return coords;
}

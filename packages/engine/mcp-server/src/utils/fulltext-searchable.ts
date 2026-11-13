import type { Principal } from "../auth/principal.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import { fsFetch } from "./fs-fetch.js";
import type { FulltextGroupNumberResponse } from "../types/volume-search.js";
import { isFsBudgetExhausted } from "./fs-budget.js";
import { mapWithConcurrency } from "./place-resolver.js";

const FULLTEXT_GROUP_URL =
  "https://sg30p0.familysearch.org/service/search/fulltext/search/groupNumber";

/**
 * Which of these image groups FamilySearch reports as full-text searchable.
 *
 * Shared because two tools need the same answer for opposite reasons:
 * `volume_search` reports it as capability metadata on every group it returns,
 * and `fulltext_search` uses it to tell a nil result caused by the volume apart
 * from one caused by the person not being there. Lifted out of
 * `volume-search.ts` rather than imported tool-to-tool, and shared rather than
 * re-fetched, per CLAUDE.md § Code reuse.
 *
 * Returns `null` for UNKNOWN, never an empty set: a non-OK response or a throw
 * means the endpoint did not answer, which is not the same as "none of them are
 * searchable". Callers must treat `null` as "no opinion" — reading it as false
 * is how a legitimate search gets blocked or a nil gets mislabelled.
 */
export async function fetchFulltextSearchable(
  groupNames: string[],
  principal: Principal,
): Promise<Set<string> | null> {
  if (groupNames.length === 0) return null;
  const ids = groupNames.join(",");
  const url = `${FULLTEXT_GROUP_URL}?ids=${encodeURIComponent(ids)}`;

  try {
    const response = await fsFetch(principal, url, {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": BROWSER_USER_AGENT,
        "FS-User-Agent-Chain": "chesworth",
      },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as FulltextGroupNumberResponse;
    return new Set(data.ids ?? []);
  } catch (err) {
    // Not "nothing is full-text searchable" -- the server is rate-limited.
    if (isFsBudgetExhausted(err)) throw err;
    return null;
  }
}

export const FULLTEXT_BATCH = 100;
const FULLTEXT_CONCURRENCY = 10;

/** Which of these groups FamilySearch reports as full-text searchable, in
 *  parallel batches; `null` (UNKNOWN) if ANY batch failed.
 *
 *  Lifted here from `volume-rollup.ts`, which had it private, when a second
 *  caller needed it (CLAUDE.md § Code reuse: two near-duplicates is the signal
 *  to consolidate). The single-request `fetchFulltextSearchable` puts every id
 *  in one query string, so an unbounded list is either truncated by the
 *  endpoint — ids past its cap come back absent, which a caller reading absence
 *  as "not searchable" turns into a false refusal — or rejected outright with a
 *  414. Any caller whose id list is not bounded by construction uses this. */
export async function fetchFulltextSearchableBatched(
  names: string[],
  principal: Principal,
): Promise<Set<string> | null> {
  if (names.length === 0) return null;
  const batches: string[][] = [];
  for (let i = 0; i < names.length; i += FULLTEXT_BATCH) batches.push(names.slice(i, i + FULLTEXT_BATCH));
  const sets = await mapWithConcurrency(batches, FULLTEXT_CONCURRENCY, (batch) =>
    fetchFulltextSearchable(batch, principal),
  );
  if (sets.some((s) => s === null)) return null;
  return new Set(sets.flatMap((s) => [...(s as Set<string>)]));
}

/** A principal-bound `fetchFulltextSearchableBatched`, so a writer tool can
 *  resolve a searchability set without importing auth or a principal (#4431).
 *  The same shape as `CollectionCatalogLoader`: built once per request in
 *  `server.ts`, passed to `researchAppendFromCaller`, `null` where no caller
 *  supplies one. Batched, because the ids come from a document that grows. */
export type FulltextSearchableLoader = (ids: string[]) => Promise<Set<string> | null>;

export function fulltextSearchableLoader(principal: Principal): FulltextSearchableLoader {
  return (ids: string[]) => fetchFulltextSearchableBatched(ids, principal);
}

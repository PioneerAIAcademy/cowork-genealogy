import { fetchWithRetry } from "./http.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import type { FulltextGroupNumberResponse } from "../types/volume-search.js";

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
  token: string,
): Promise<Set<string> | null> {
  if (groupNames.length === 0) return null;
  const ids = groupNames.join(",");
  const url = `${FULLTEXT_GROUP_URL}?ids=${encodeURIComponent(ids)}`;

  try {
    const response = await fetchWithRetry(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": BROWSER_USER_AGENT,
        "FS-User-Agent-Chain": "chesworth",
      },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as FulltextGroupNumberResponse;
    return new Set(data.ids ?? []);
  } catch {
    return null;
  }
}

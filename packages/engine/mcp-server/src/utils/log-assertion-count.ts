// How many live assertions each research-log entry led to (issue #1157). An
// assertion counts toward an entry when its `log_entry_id` is the entry's id, or
// when its `record_id` is a record the entry named: one its `query` read
// (`recordId` / `recordIds`), or, for a search, one of the hits its sidecar
// holds, widened to every persona of the record its `record_read` sidecar
// lists. Extraction logs its own `record_read` and cites that entry, never the
// search that found the record, and extracts under the persona the agent asked
// for, so without the hits a search whose find was extracted would read 0. Only
// a tool that can return a record gets a count, and a page `image_transcribe`
// logged itself does not: that is a read, not a find.

import { liveAssertions } from "./assertion-liveness.js";
import { arkToBareId } from "./ark.js";
import { isToolLoggedRead } from "./tool-logged-read.js";
import { personaGroups, sidecarHitIds } from "./results-staging.js";
import { mapWithConcurrency } from "./place-resolver.js";

/** Tools whose log entry can lead to an assertion. */
export const RECORD_TOOLS: ReadonlySet<string> = new Set([
  "record_search",
  "record_read",
  "fulltext_search",
  "image_transcribe",
  "image_read",
  "external_site",
  "person_record_matches",
  "user_provided",
]);

const HIT_TOOLS: ReadonlySet<string> = new Set(["record_search", "fulltext_search"]);

const bare = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? arkToBareId(v) : undefined;

function namedRecords(entry: any, hits: ReadonlyMap<string, string[]>): string[] {
  const q = entry?.query;
  const raw: unknown[] =
    q && typeof q === "object" ? [q.recordId, ...(Array.isArray(q.recordIds) ? q.recordIds : [])] : [];
  raw.push(...(hits.get(entry?.id) ?? []));
  return [...new Set(raw.map(bare).filter((r): r is string => r !== undefined))];
}

/** Whether an entry can carry a count. */
export function countsAssertions(entry: any): boolean {
  return RECORD_TOOLS.has(entry?.tool) && !isToolLoggedRead(entry);
}

/** Each search entry's hit record ids, read from its sidecar and widened to
 *  every persona of each hit's record. An entry whose sidecar is missing or
 *  unreadable has none, so it counts by log id alone. */
export async function searchHits(
  projectPath: string,
  research: any,
  entries: any[],
): Promise<Map<string, string[]>> {
  const searches = entries.filter(
    (e) => HIT_TOOLS.has(e?.tool) && typeof e?.id === "string" && typeof e?.results_ref === "string",
  );
  const hits = new Map<string, string[]>();
  if (searches.length === 0) return hits;
  const groups = await personaGroups(projectPath, research);
  await mapWithConcurrency(searches, 8, async (e) => {
    const ids = new Set<string>();
    for (const h of await sidecarHitIds(projectPath, e.results_ref, e.tool)) {
      for (const x of groups.get(h) ?? [h]) ids.add(x);
    }
    if (ids.size > 0) hits.set(e.id, [...ids]);
  });
  return hits;
}

/** A function giving each countable entry its assertion count, undefined otherwise. */
export function logAssertionCounter(
  research: any,
  hits: ReadonlyMap<string, string[]> = new Map(),
): (entry: any) => number | undefined {
  const byEntry = new Map<string, Set<unknown>>();
  const byRecord = new Map<string, Set<unknown>>();
  const add = (m: Map<string, Set<unknown>>, k: string, a: unknown) => {
    const s = m.get(k) ?? new Set();
    s.add(a);
    m.set(k, s);
  };
  for (const a of liveAssertions(research)) {
    if (typeof a?.log_entry_id === "string") add(byEntry, a.log_entry_id, a);
    const r = bare(a?.record_id);
    if (r) add(byRecord, r, a);
  }
  return (entry) => {
    if (!countsAssertions(entry)) return undefined;
    const found = new Set<unknown>(byEntry.get(entry?.id) ?? []);
    for (const r of namedRecords(entry, hits)) for (const a of byRecord.get(r) ?? []) found.add(a);
    return found.size;
  };
}

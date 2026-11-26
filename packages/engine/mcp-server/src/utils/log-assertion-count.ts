// How many live assertions each research-log entry led to (issue #1157). An
// assertion counts toward an entry when its `log_entry_id` is the entry's id, or
// when its `record_id` is a record the entry's query named (`recordId` /
// `recordIds`), so a record read under one entry and extracted under a sibling
// still counts. A tool that cannot yield an assertion gets no count at all, and
// neither does a page `image_transcribe` logged itself: that is a read, not a find.

import { liveAssertions } from "./assertion-liveness.js";
import { arkToBareId } from "./ark.js";
import { isToolLoggedRead } from "./tool-logged-read.js";

/** Tools whose answer is a listing of collections, volumes or images, never a record. */
export const NO_ASSERTION_TOOLS: ReadonlySet<string> = new Set([
  "external_links_search",
  "collections_search",
  "catalog_search",
  "volume_search",
  "image_search",
]);

const bare = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? arkToBareId(v) : undefined;

function namedRecords(entry: any): string[] {
  const q = entry?.query;
  if (!q || typeof q !== "object") return [];
  const raw = [q.recordId, ...(Array.isArray(q.recordIds) ? q.recordIds : [])];
  return [...new Set(raw.map(bare).filter((r): r is string => r !== undefined))];
}

/** Whether an entry can carry a count. */
export function countsAssertions(entry: any): boolean {
  return !NO_ASSERTION_TOOLS.has(entry?.tool) && !isToolLoggedRead(entry);
}

/** A function giving each countable entry its assertion count, undefined otherwise. */
export function logAssertionCounter(research: any): (entry: any) => number | undefined {
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
    for (const r of namedRecords(entry)) for (const a of byRecord.get(r) ?? []) found.add(a);
    return found.size;
  };
}

/** Every countable log entry's count, keyed by its id. The eval harness's
 *  validator reads this from the build, so the rule is never restated in Python. */
export function logAssertionCounts(research: any): Record<string, number> {
  const count = logAssertionCounter(research);
  const out: Record<string, number> = {};
  for (const e of Array.isArray(research?.log) ? research.log : []) {
    const n = count(e);
    if (n !== undefined && typeof e?.id === "string") out[e.id] = n;
  }
  return out;
}

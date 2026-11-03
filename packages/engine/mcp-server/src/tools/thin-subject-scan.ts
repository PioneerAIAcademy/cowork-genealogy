// The thin-subject gate's scan (rank-search-matches spec, `subjectTooThin`;
// research-append spec, "The thin-subject gate"). Shared by extraction_append,
// which refuses what it finds, and project_context, which routes around it; it
// writes nothing, so a reader may import it without counting as a writer.

import { arkToBareId } from "../utils/ark.js";
import { readSidecarSearch, unloggedStagedSearches } from "../utils/results-staging.js";
import { mapWithConcurrency } from "../utils/place-resolver.js";
import { buildSubjectDoc } from "./rank-search-matches.js";

const READ_CONCURRENCY = 4;

/**
 * Record id -> refusal summary, for each record a search for a too-thin subject
 * found (`subjectTooThin`, rank-search-matches spec: no date narrower than a
 * year and no named spouse, parent or child). Thinness is the one the search
 * saved when it ran, so a tree edit made afterwards — a date copied from the
 * refused record itself — does not clear the record; a later search for the same
 * person that saved `subjectTooThin: false` does. A search saved before the flag
 * existed is judged on the project as it stands. A listing search is a logged `record_search` sidecar or one
 * still staged, so extracting before logging does not skip it. Only its own
 * subject decides it: a search with no readable subject counts for nothing, and
 * a search for another, anchored person does not lift it, so re-running the
 * search under another `subjectId` or none cannot get the record through. A
 * record the researcher accepted as a hint, on any of its ids, is not gated.
 * Any read fault gates nothing. The searches and subjects are read once per
 * scan, so a call that checks twice (before and after its reads) pays once.
 */
export function thinSubjectScan(
  projectPath: string,
  research: any,
): (idsByRecord: ReadonlyMap<string, ReadonlySet<string>>) => Promise<Map<string, string>> {
  const log: any[] = Array.isArray(research.log) ? research.log : [];
  const verdict = new Map<string, unknown>();
  for (const e of log) {
    if (e?.tool === "person_record_matches" && typeof e?.query?.recordId === "string") {
      verdict.set(arkToBareId(e.query.recordId), e.outcome);
    }
  }
  type Listing = { ids: Set<string>; subjectId: string; frozen: boolean | undefined };
  let loaded: Promise<Listing[]> | undefined;
  const load = async () => {
    const refs = new Set<string>(
      log.filter((e) => e?.tool === "record_search" && typeof e?.results_ref === "string").map((e) => e.results_ref),
    );
    for (const u of await unloggedStagedSearches(projectPath)) if (u.tool === "record_search") refs.add(u.ref);
    return (
      await mapWithConcurrency([...refs], READ_CONCURRENCY, async (ref) => {
        const read = await readSidecarSearch(projectPath, ref);
        if (!read?.subjectId) return null;
        const ids = new Set<string>();
        for (const r of read.results as any[]) if (typeof r?.recordId === "string") ids.add(arkToBareId(r.recordId));
        return { ids, subjectId: read.subjectId, frozen: read.subjectTooThin };
      })
    ).filter((s): s is Listing => s !== null);
  };
  const subjects = new Map<string, { thin: boolean; name: string } | null>();
  const subject = async (sid: string) => {
    if (!subjects.has(sid)) {
      try {
        const doc = await buildSubjectDoc(projectPath, sid);
        const n = (doc.doc.persons?.[0] as any)?.names?.[0];
        const name = [n?.given, n?.surname].filter((x) => typeof x === "string" && x.trim()).join(" ") || sid;
        subjects.set(sid, { thin: doc.subjectTooThin, name });
      } catch {
        subjects.set(sid, null);
      }
    }
    return subjects.get(sid)!;
  };
  return async (idsByRecord) => {
    const out = new Map<string, string>();
    if (idsByRecord.size === 0) return out;
    const sidecars = await (loaded ??= load());
    if (sidecars.length === 0) return out;
    for (const [recordId, ids] of idsByRecord) {
      if ([...ids].some((x) => verdict.get(x) === "positive")) continue;
      const listing = sidecars.filter((s) => [...ids].some((x) => s.ids.has(x)));
      const thin = new Map<string, string>();
      for (const sid of new Set(listing.map((s) => s.subjectId))) {
        const mine = listing.filter((s) => s.subjectId === sid);
        if (mine.some((s) => s.frozen === false)) continue;
        const subj = await subject(sid);
        const gates = mine.some((s) => s.frozen === true) || (subj?.thin === true && mine.some((s) => s.frozen === undefined));
        if (gates) thin.set(sid, `${subj?.name ?? sid} (${sid})`);
      }
      if (thin.size === 0) continue;
      const who = [...thin.values()].join(", ");
      out.set(
        recordId,
        `${recordId}: not extracted: a search for ${who} found this record, and the tree gives ` +
          `${thin.size === 1 ? "that person" : "each of them"} no date narrower than a year and no named spouse, ` +
          `parent or child, so the record cannot be told from a namesake's. Report it as needs-review and name ` +
          `what would settle identity (a precise date, or a named spouse, parent or child) from the researcher ` +
          `or another record, never from this one; once the project records it, search again, and a ` +
          `record the new search finds can be extracted.`,
      );
    }
    return out;
  };
}

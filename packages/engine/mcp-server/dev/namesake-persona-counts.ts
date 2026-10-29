// Item 10 of issue #3363 (chesworthrm, 2026-10-24): what a refusal keyed on the
// namesake persona `research_append` stamps (`record_persona_ids`) would do,
// read from one research.json. Called by measure-namesake-cap.ts §7.

import { arkToBareId } from "../src/utils/ark.js";
import { PERSONA_BEARING_PRODUCERS } from "../src/utils/results-staging.js";

export interface PersonaStampCounts {
  /** Records the rows list. */
  listed: number;
  /** (c) Listed records stamped with a persona. */
  stamped: number;
  /** (d) Listed records left unstamped although their row cites a persona search
   *  that staged a sidecar: absent from it, or its result named no persona. */
  absent: number;
  /** (a) Live probable or confident links to a row holder whose assertion's
   *  record and persona equal a stamped pair. */
  wouldRefuse: number;
  /** (b) Live probable or confident links to a row holder on a listed record
   *  whose persona differs from the stamped one: a record-id rule refuses them. */
  spared: number;
}

const STRONG = new Set(["probable", "confident"]);

export function personaStampCounts(research: any): PersonaStampCounts {
  const counts: PersonaStampCounts = { listed: 0, stamped: 0, absent: 0, wouldRefuse: 0, spared: 0 };
  const logById = new Map<string, any>(
    (Array.isArray(research?.log) ? research.log : []).filter((e: any) => e && typeof e.id === "string").map((e: any) => [e.id, e]),
  );
  const assertionById = new Map<string, any>(
    (Array.isArray(research?.assertions) ? research.assertions : [])
      .filter((a: any) => a && typeof a.id === "string")
      .map((a: any) => [a.id, a]),
  );
  const strongLinks = (Array.isArray(research?.person_evidence) ? research.person_evidence : []).filter(
    (e: any) => e && !e.superseded_by && STRONG.has(e.confidence) && typeof e.assertion_id === "string",
  );
  // Rows may repeat for one person, so a link is counted once.
  const refused = new Set<unknown>();
  const spared = new Set<unknown>();
  for (const row of Array.isArray(research?.namesakes) ? research.namesakes : []) {
    if (!row || typeof row.person_id !== "string") continue;
    const stamp: Record<string, string> =
      row.record_persona_ids && typeof row.record_persona_ids === "object" ? row.record_persona_ids : {};
    const stampByBare = new Map(Object.entries(stamp).map(([rid, persona]) => [arkToBareId(rid), persona]));
    const citesPersonaSidecar = (Array.isArray(row.log_entry_ids) ? row.log_entry_ids : []).some((id: string) => {
      const entry = logById.get(id);
      return !!entry && PERSONA_BEARING_PRODUCERS.has(entry.tool) && typeof entry.results_ref === "string";
    });
    const listed = new Set<string>();
    for (const rid of Array.isArray(row.record_ids) ? row.record_ids : []) {
      if (typeof rid !== "string") continue;
      const bare = arkToBareId(rid);
      listed.add(bare);
      counts.listed += 1;
      if (stampByBare.has(bare)) counts.stamped += 1;
      else if (citesPersonaSidecar) counts.absent += 1;
    }
    for (const link of strongLinks) {
      if (link.person_id !== row.person_id) continue;
      const a = assertionById.get(link.assertion_id);
      if (!a || typeof a.record_id !== "string") continue;
      const bare = arkToBareId(a.record_id);
      if (!listed.has(bare)) continue;
      const persona = stampByBare.get(bare);
      if (persona !== undefined && a.record_persona_id === persona) refused.add(link);
      else if (persona !== undefined) spared.add(link);
    }
  }
  counts.wouldRefuse = refused.size;
  counts.spared = [...spared].filter((l) => !refused.has(l)).length;
  return counts;
}

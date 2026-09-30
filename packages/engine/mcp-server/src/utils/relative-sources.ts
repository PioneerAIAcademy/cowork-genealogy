/**
 * The sources FamilySearch has attached to a subject's RELATIVES.
 *
 * Issue #1689 Half 3. A relative comes back from the tree read as a person, facts and
 * relationships with no sources of their own, so a project starting from a well-sourced
 * node starts blind to every source hanging off its relatives and re-derives what is
 * already attached. Two live cases: feedback #1795 (63 children listed, 4 confirmed, zero
 * source calls) and #1948, where a relative's attached source recorded a Mississippi
 * marriage the agent never saw because it went straight to record search and found the
 * couple's Texas one — a contradiction that belongs in `conflicts[]` and was never raised.
 * That second case is why this is not merely cheaper: skipping it produces a confident
 * wrong answer rather than a slow right one.
 *
 * **Decided (lead, 2026-08-27): the tool returns them**, as ordinary `sources[]` entries
 * with no discriminator — the same shape ruling 2 set for memories. A skill-side rule for
 * when to spend N calls is a rule the model can skip silently.
 *
 * WHY PER-PERSON AND NOT PER-REF. The tree read already carries each relative's source
 * refs, as full URLs to descriptions it does not include. Both routes work; the per-person
 * endpoint returns all of one person's descriptions in ONE call, so it is ~6x fewer
 * requests for identical data (`dev/probe-relative-sources.json`, 2026-09-30):
 *
 *     by URL     3/3 ok, median 93-107ms, ~400 calls at 63 relatives  -> ~40s
 *     by person  3/3 ok, median 107-115ms,   63 calls at 63 relatives -> ~7s
 *
 * The 40s figure matters: `person_read` shares one `OCR_PHASE_BUDGET_MS` deadline across
 * the parent fan-out, memories paging and this, so the per-ref route would exhaust the
 * whole budget and time out the read it was meant to enrich.
 */
import type { Principal } from "../auth/principal.js";
import type { GedcomXSourceDescription } from "../types/gedcomx.js";
import { fsFetch } from "./fs-fetch.js";

const TREE_BASE = "https://api.familysearch.org/platform/tree/persons";
const ACCEPT_HEADER = "application/x-fs-v1+json";

/**
 * How many relatives are read at once. Bounded because a 63-child subject would
 * otherwise open 63 sockets against one host, and FamilySearch sits behind Imperva.
 * Six keeps the projected 63-relative case near a second of wall clock while staying
 * far below anything that reads as a burst.
 */
const CONCURRENCY = 6;

export interface RelativeSourcesResult {
  /** Descriptions to merge into `sources[]`, deduped by id. */
  descriptions: GedcomXSourceDescription[];
  /** Relatives whose fetch failed or was cut short. Diagnostic only — see below. */
  skipped: string[];
}

/** One person's attached descriptions. Never throws: a relative we cannot read is
 *  skipped, not fatal, because the tree read itself already succeeded. */
async function fetchOne(
  personId: string,
  principal: Principal,
  deadline: number,
): Promise<GedcomXSourceDescription[] | null> {
  if (Date.now() >= deadline) return null;
  try {
    const res = await fsFetch(
      principal,
      `${TREE_BASE}/${encodeURIComponent(personId)}/sources`,
      { headers: { Accept: ACCEPT_HEADER, "Accept-Language": "en" } },
    );
    // 204 is a person with no sources — an answer, not a failure.
    if (res.status === 204) return [];
    if (!res.ok) return null;
    const body = (await res.json()) as { sourceDescriptions?: GedcomXSourceDescription[] };
    return Array.isArray(body.sourceDescriptions) ? body.sourceDescriptions : [];
  } catch {
    return null;
  }
}

/**
 * Read the attached sources of every id in `personIds`, deduped.
 *
 * FAIL-SOFT, AND SILENT TO THE AGENT — deliberately, and the same way the memories
 * fetch is. The response shape is pinned to exactly `{persons, relationships, sources}`
 * by the 2026-08-21 no-discriminator ruling, so there is nowhere to report a shortfall
 * without reopening it. A caller that wants the detail reads `skipped`; nothing is put
 * in the response. What must NOT happen is a partial read presented as a complete one,
 * which is why `skipped` exists at all rather than being swallowed here.
 */
export async function fetchRelativeSources(
  personIds: string[],
  principal: Principal,
  deadline: number,
): Promise<RelativeSourcesResult> {
  const byId = new Map<string, GedcomXSourceDescription>();
  const skipped: string[] = [];
  const queue = [...new Set(personIds)];

  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = cursor++;
      if (i >= queue.length) return;
      const pid = queue[i];
      const got = await fetchOne(pid, principal, deadline);
      if (got === null) {
        skipped.push(pid);
        continue;
      }
      for (const d of got) {
        // Keyed by id, which IS the dedupe: two relatives genuinely share a source
        // (measured — 1 of 79 on KNDX-MKG) and a repeated id in `sources[]` breaks the
        // tree write. An earlier draft also guarded with `!byId.has(d.id)`; the
        // mutation check showed that guard is redundant — removing it changes nothing a
        // test can see, because the Map holds one entry per id either way. It only
        // chose first-wins over last-wins, and the two copies are the same description.
        if (typeof d.id === "string" && d.id !== "") byId.set(d.id, d);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker()),
  );

  return { descriptions: [...byId.values()], skipped };
}

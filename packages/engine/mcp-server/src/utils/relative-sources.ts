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
 *     by URL     3/3 ok, median 93-107ms, ~400 calls at 63 relatives
 *     by person  3/3 ok, median 107-115ms,   63 calls at 63 relatives
 *
 * At CONCURRENCY below that is about a second of wall clock at 63 relatives — not the
 * ~7s an earlier draft claimed, which wrongly assumed the calls ran one at a time.
 *
 * BOUNDED TWICE, and the second bound is the one that matters. This phase shares
 * `person_read`'s single `OCR_PHASE_BUDGET_MS` deadline with the parent fan-out and
 * memories. The deadline gates whether a request STARTS; `fsFetch`'s timeout bounds one
 * already IN FLIGHT. Without the second, a read beginning just under the deadline runs on
 * `fsFetch`'s own 30s default plus its retry budget and can push the whole call past the
 * 60s Cowork bridge abort — losing the subject, not merely the enrichment.
 */
import type { Principal } from "../auth/principal.js";
import type { GedcomXSourceDescription } from "../types/gedcomx.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import { fsFetch } from "./fs-fetch.js";
import { mapWithConcurrency } from "./place-resolver.js";

const TREE_BASE = "https://api.familysearch.org/platform/tree/persons";
const ACCEPT_HEADER = "application/x-fs-v1+json";

/**
 * How many relatives are read at once. Bounded because a 63-child subject would
 * otherwise open 63 sockets against one host, and FamilySearch sits behind Imperva.
 */
const CONCURRENCY = 6;

/** Per-read ceiling, mirroring `PARENT_READ_TIMEOUT_MS` on the sibling fan-out. The
 *  effective bound is `min(this, whatever is left on the shared deadline)`. */
const RELATIVE_READ_TIMEOUT_MS = 30_000;

export interface RelativeSourcesResult {
  /** RAW FamilySearch descriptions, deduped by id. The caller shapes them — see below. */
  descriptions: GedcomXSourceDescription[];
  /** Relatives whose read failed or was cut short. The caller reports the count in
   *  the response's `notes[]`; this is not diagnostic-only. */
  skipped: string[];
}

/** One person's attached descriptions. Never throws: a relative we cannot read is
 *  skipped, not fatal, because the tree read itself already succeeded. */
async function fetchOne(
  personId: string,
  principal: Principal,
  deadline: number,
): Promise<GedcomXSourceDescription[] | null> {
  const left = deadline - Date.now();
  if (left <= 0) return null;
  try {
    const res = await fsFetch(
      principal,
      `${TREE_BASE}/${encodeURIComponent(personId)}/sources`,
      {
        headers: {
          Accept: ACCEPT_HEADER,
          "Accept-Language": "en",
          // Same host as the memories fetch, which sends this for the reason
          // CLAUDE.md records: FamilySearch sits behind Imperva, which 403s a
          // non-browser UA. The probe got 3/3 without it, so this is consistency
          // with the sibling call rather than a reproduced failure — but the
          // sibling added it after one.
          "User-Agent": BROWSER_USER_AGENT,
        },
      },
      Math.min(RELATIVE_READ_TIMEOUT_MS, left),
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
 * Read the attached sources of every id in `personIds`, deduped by id.
 *
 * RETURNS RAW DESCRIPTIONS ON PURPOSE. They must pass through `shapeSources` before they
 * reach the response: the simplified form carries `resource_type` and `coverage`, which
 * are not allowed tree-source fields, may omit `title`, and skips the `SD_*` metadata
 * filter. `project_create` validates without sanitizing, so one stray key refuses the
 * whole project. An earlier version of this file shaped them here with
 * `simplifySourceDescription` and produced 180 validation errors on a real subject.
 * Shaping belongs in one place, with the subject's own sources.
 *
 * FAIL-SOFT, AND REPORTED. A relative we cannot read is skipped rather than fatal, and the
 * caller names the count in the response's top-level `notes[]` as well as on stderr. An
 * earlier version of this comment said there was "nowhere to report a shortfall" because
 * the top level is pinned to `{persons, relationships, sources}` — that was wrong:
 * `notes[]` already exists for exactly this, "present only when something was silently
 * dropped". A partial read presented as a complete one is the failure mode, because
 * relatives with unread sources look identical to relatives with none.
 */
export async function fetchRelativeSources(
  personIds: string[],
  principal: Principal,
  deadline: number,
): Promise<RelativeSourcesResult> {
  const queue = [...new Set(personIds)];
  const results = await mapWithConcurrency(queue, CONCURRENCY, (pid) =>
    fetchOne(pid, principal, deadline),
  );

  const byId = new Map<string, GedcomXSourceDescription>();
  const skipped: string[] = [];
  results.forEach((got, i) => {
    if (got === null) {
      skipped.push(queue[i]);
      return;
    }
    for (const d of got) {
      // Keyed by id, which IS the dedupe: two relatives genuinely share a source
      // (measured — 1 of 79 on KNDX-MKG) and a repeated id in `sources[]` breaks the
      // tree write.
      if (typeof d.id === "string" && d.id !== "") byId.set(d.id, d);
    }
  });

  return { descriptions: [...byId.values()], skipped };
}

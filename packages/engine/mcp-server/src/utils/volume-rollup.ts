import type { Principal } from "../auth/principal.js";
import { fetchFulltextSearchable } from "./fulltext-searchable.js";
import { mapWithConcurrency } from "./place-resolver.js";
import { RECORD_TYPE_GROUP_NAMES, conceptIdsForGroups } from "./record-type-groups.js";
import type {
  MetadataRmsGroup,
  MetadataRmsSearchRequest,
  MetadataRmsSearchResponse,
  VolumeRollup,
  VolumeRollupBucket,
} from "../types/volume-search.js";

/**
 * The per-record-type count of every volume a `volume_search` matches, so a
 * place survey can say how many volumes of each kind exist without listing
 * them. Hosted locality-guide surveys matched a median of 24–81 volumes and up
 * to 4,261, so a list would rarely be complete; the counts always are.
 *
 * Works on the raw upstream groups, not the tool's mapped rows, so it does not
 * depend on how `volume_search` formats its page.
 */

/** Upstream answers 400 above this (probed 2026-10-22). */
export const ROLLUP_PAGE_SIZE = 1000;
/** Pages fetched for one rollup; beyond this it reports `complete: false`. */
export const ROLLUP_MAX_PAGES = 10;
/** The full-text endpoint fails on 1,000 names in one request. */
export const FULLTEXT_BATCH = 100;
const CONCURRENCY = 5;
const FULLTEXT_CONCURRENCY = 10;

export type GroupSearch = (
  body: MetadataRmsSearchRequest,
  principal: Principal,
) => Promise<MetadataRmsSearchResponse>;

/**
 * Concept ids that put a coverage in each group, exactly as a
 * `recordTypeGroups: [name]` filter would match it: the group's anchor, its
 * strays and its descendants' strays, tested against the coverage's ancestor
 * chain (the anchor's subtree is what upstream containment expands).
 */
const GROUP_CONCEPTS: ReadonlyArray<[string, ReadonlySet<number>]> =
  RECORD_TYPE_GROUP_NAMES.map((name) => [name, new Set(conceptIdsForGroups([name]))]);

/** Every group a volume belongs to, from all of its coverage rows. */
export function groupsForVolume(group: MetadataRmsGroup): Set<string> {
  const out = new Set<string>();
  for (const coverage of group.coverages ?? []) {
    const chain =
      coverage.recordTypeConceptIdHierarchy ??
      (coverage.recordTypeConceptId != null ? [coverage.recordTypeConceptId] : []);
    if (chain.length === 0) continue;
    for (const [name, ids] of GROUP_CONCEPTS) {
      if (chain.some((id) => ids.has(id))) out.add(name);
    }
  }
  return out;
}

/**
 * Every volume the search matches. Fetches the first page of 1,000, then the
 * rest in parallel by the undocumented 1-based `pageNumber`; if that yields a
 * short or duplicated set, it re-walks by `nextPageToken`, slower but exact.
 */
export async function fetchAllGroups(
  base: MetadataRmsSearchRequest,
  principal: Principal,
  search: GroupSearch,
): Promise<{ groups: MetadataRmsGroup[]; total: number; complete: boolean }> {
  const body = { ...base, pageSize: ROLLUP_PAGE_SIZE };
  delete body.nextPageToken;
  const first = await search(body, principal);
  const total = first.totalCount ?? 0;
  const firstGroups = first.groups ?? [];
  const pages = Math.min(Math.ceil(total / ROLLUP_PAGE_SIZE), ROLLUP_MAX_PAGES);
  const complete = Math.ceil(total / ROLLUP_PAGE_SIZE) <= ROLLUP_MAX_PAGES;
  if (pages <= 1) return { groups: firstGroups, total, complete };

  const expected = Math.min(total, pages * ROLLUP_PAGE_SIZE);
  try {
    const rest = await mapWithConcurrency(
      Array.from({ length: pages - 1 }, (_, i) => i + 2),
      CONCURRENCY,
      (pageNumber) => search({ ...body, pageNumber }, principal),
    );
    const groups = dedupe([firstGroups, ...rest.map((r) => r.groups ?? [])]);
    if (groups.length === expected) return { groups, total, complete };
  } catch {
    // fall through to token paging
  }

  const walked: MetadataRmsGroup[][] = [firstGroups];
  let token = first.nextPageToken;
  for (let page = 2; page <= pages && token; page++) {
    const next = await search({ ...body, nextPageToken: token }, principal);
    walked.push(next.groups ?? []);
    token = next.nextPageToken;
  }
  return { groups: dedupe(walked), total, complete };
}

function dedupe(pages: MetadataRmsGroup[][]): MetadataRmsGroup[] {
  const seen = new Map<string, MetadataRmsGroup>();
  for (const page of pages) for (const g of page) if (!seen.has(g.groupName)) seen.set(g.groupName, g);
  return [...seen.values()];
}

/** Which names are full-text searchable, in parallel batches; null if any batch failed. */
async function fulltextFor(names: string[], principal: Principal): Promise<Set<string> | null> {
  const batches: string[][] = [];
  for (let i = 0; i < names.length; i += FULLTEXT_BATCH) batches.push(names.slice(i, i + FULLTEXT_BATCH));
  const sets = await mapWithConcurrency(batches, FULLTEXT_CONCURRENCY, (batch) =>
    fetchFulltextSearchable(batch, principal),
  );
  if (sets.some((s) => s === null)) return null;
  return new Set(sets.flatMap((s) => [...(s as Set<string>)]));
}

/**
 * A volume with no name-indexed images is either full-text-only (reachable by
 * `fulltext_search`) or browse-only (image by image); an indexed one is neither.
 */
function access(group: MetadataRmsGroup, fulltext: Set<string>): "fulltextOnly" | "browseOnly" | null {
  if ((group.indexedChildCount ?? 0) > 0) return null;
  return fulltext.has(group.groupName) ? "fulltextOnly" : "browseOnly";
}

/**
 * Count volumes per record-type group. A volume counts once in every group its
 * coverages reach, ancestors included (a Baptism volume is also Religious), so
 * the buckets can sum past `totalVolumes`. `untyped` holds volumes that reach
 * no group. `browseOnly` and `fulltextOnly` are null when the full-text check
 * did not answer.
 */
export function rollup(
  groups: MetadataRmsGroup[],
  fulltext: Set<string> | null,
  total: number,
  complete: boolean,
): VolumeRollup {
  const buckets = new Map<string, VolumeRollupBucket>();
  const unknown = fulltext ? 0 : null;
  const untyped: VolumeRollup["untyped"] = { volumes: 0, browseOnly: unknown, fulltextOnly: unknown };
  for (const g of groups) {
    const kind = fulltext ? access(g, fulltext) : null;
    const names = groupsForVolume(g);
    const targets: VolumeRollup["untyped"][] = names.size === 0 ? [untyped] : [...names].map((name) => {
      let b = buckets.get(name);
      if (!b) {
        b = { group: name, volumes: 0, browseOnly: unknown, fulltextOnly: unknown };
        buckets.set(name, b);
      }
      return b;
    });
    for (const b of targets) {
      b.volumes++;
      if (kind && b[kind] != null) (b[kind] as number)++;
    }
  }
  const byRecordType = RECORD_TYPE_GROUP_NAMES.flatMap((name) => {
    const b = buckets.get(name);
    return b ? [b] : [];
  });
  return {
    totalVolumes: total,
    complete: complete && groups.length >= total,
    byRecordType,
    untyped,
  };
}

export async function volumeRollup(
  base: MetadataRmsSearchRequest,
  principal: Principal,
  search: GroupSearch,
): Promise<VolumeRollup> {
  const { groups, total, complete } = await fetchAllGroups(base, principal, search);
  // A volume with indexed images is never browse-only, so only the rest need the
  // full-text check — at ~6 s per batch of 100 (2026-10-22), it is the slow step.
  const unindexed = groups.filter((g) => !((g.indexedChildCount ?? 0) > 0)).map((g) => g.groupName);
  const fulltext = unindexed.length > 0
    ? await fulltextFor(unindexed, principal)
    : new Set<string>();
  return rollup(groups, fulltext, total, complete);
}

/**
 * Inline-projection compaction, applied by a search tool once its results are
 * staged.
 *
 * Lives here rather than inline in each tool for one reason: the eval harness
 * has to run the same code. `mock_mcp.py` serves a canned response and then
 * calls the compiled `stageSearchResults` to materialize the sidecar, so its
 * responses reach the agent having skipped whatever the tool does *after*
 * staging. Mirroring these transformations in Python would make a second copy
 * of them, and that copy is what drifts — the harness would hand the agent a
 * field production strips, and every eval graded against it would be scored on
 * a shape production never sends.
 *
 * Both functions are **idempotent**: every step either deletes a key or fills
 * one that is only written when non-empty, so applying them to an
 * already-compacted response is a no-op. The harness depends on that — its
 * fixtures carry both shapes.
 *
 * These modules must stay free of side effects at import: the harness imports
 * the compiled output in a bare `node --input-type=module` process with no
 * credentials, so anything that reads config or a token at module scope would
 * throw there.
 */

import type { RecordSearchResult, RecordSearchToolResponse } from "../types/record-search.js";
import type { FulltextSearchResponse } from "../types/fulltext-search.js";
import type { RankSearchMatchesResult } from "../types/rank-search-matches.js";
import { arkToBareId } from "./ark.js";

/**
 * Slim `record_search`'s INLINE projection so a broad search can't overflow the
 * model's context — the bulk lives in the staged file, which rank_search_matches
 * (and record_read) read host-side, and the remaining flat stub fields still
 * carry names/dates/places for triage. Unconditional once staged (no opt-in
 * flag): nothing needs the dropped fields inline, so the overflow protection
 * can't be forgotten by the caller.
 *
 * Safe because the staged file is already serialized to disk by the awaited
 * stageSearchResults, so mutating the inline copy cannot corrupt the sidecar —
 * the sidecar, the viewer's SidecarResultCard, and the eval fixtures all keep
 * full fidelity. The caller must never apply this when `staged` is null (an
 * un-staged exploratory search — nothing was retained to re-read from).
 *
 * Measured against the 3,380 rows of a real 140-search session: gedcomx aside,
 * collectionUrl was 14.0% of row bytes, collectionTitle 9.4%, empty
 * treeMatches 2.9%. primaryId (4.6%) is deliberately KEPT — rank_search_matches
 * skips any candidate lacking it (rank-search-matches.ts), so dropping it would
 * silently disable the re-ranker.
 *
 * `batchNumber` is KEPT for the same class of reason (#1592): it is the only
 * route to a batch the agent can enumerate, and the staged case is the normal
 * one — dropping it here would leave the field working only in the exploratory
 * searches nobody logs. Being flat and top-level, it survives this function by
 * construction; the test that pins it is what stops a future `delete`.
 *
 * It is not free on every call shape, and the cheap-looking dedupe is declined
 * deliberately. On an ordinary search most rows carry none. On a
 * BATCH-ANCHORED search every row repeats the batch the caller just sent —
 * ~25 bytes x `count`, already echoed in `query.batchNumber`. Suppressing it
 * when it equals `input.batchNumber` would save that, at the cost of making
 * presence depend on how the search was phrased: the same record would carry
 * the field or not depending on the query, and a row read out of the staged
 * sidecar (where `query` is a sibling, not an ancestor) would lose its only
 * copy. A field whose meaning is stable is worth more here than 2.5 KB on the
 * one call shape where the caller demonstrably already knows the value.
 *
 * Mutates and returns `out`.
 */
export function compactStagedRecordSearch(
  out: RecordSearchToolResponse,
): RecordSearchToolResponse {
  const collections: Record<string, string> = {};
  for (const r of out.results ?? []) {
    delete r.gedcomx;

    // Derivable from collectionId; nothing reads it off the inline stub.
    delete r.collectionUrl;

    // Hoist the repeated per-row title into one response-level map.
    if (r.collectionId && r.collectionTitle) {
      collections[r.collectionId] = r.collectionTitle;
      delete r.collectionTitle;
    }

    // `treeMatches: []` on most rows — say nothing instead of saying "none".
    if (Array.isArray(r.treeMatches) && r.treeMatches.length === 0) {
      delete (r as Partial<RecordSearchResult>).treeMatches;
    }

    // FamilySearch repeats identical event entries (e.g. the same Census
    // date+place twice). Exact-duplicate removal only — no type filtering,
    // since Race/MaritalStatus are real triage signal.
    if (Array.isArray(r.events) && r.events.length > 1) {
      const seen = new Set<string>();
      r.events = r.events.filter((e) => {
        const k = JSON.stringify(e);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
  }
  // Guarded so a re-application cannot blank a `collections` map hoisted by an
  // earlier pass: on already-compacted input no row carries `collectionTitle`,
  // so the local map is empty and the existing one is left alone.
  if (Object.keys(collections).length > 0) out.collections = collections;
  return out;
}

/**
 * Drop `fulltext_search`'s heavy inline `textDocument` (the full AI-transcribed
 * page, 79–136 KB across a result set — the overflow driver). The full text
 * lives in the staged sidecar, and **no MCP tool** reads it back: record_read
 * reads a staged sidecar back only for record_search results (it matches on
 * recordId + gedcomx — `readFromSidecar` in record-read.ts — which a fulltext
 * result has neither of). It is NOT unreachable, though: staging serializes the
 * response before this strip runs, so the transcript is on disk at
 * `staged.resultsRef`, and `Read` is not gated by the plugin hook (its matcher
 * is Write|Edit|NotebookEdit|.*device_commit_files|.*research_append). Reading
 * it pulls the whole page back into context, which is the reason to triage from
 * the stubs — not an inability to reach it. Say the cost, not "impossible", or
 * the next reader plans around a wall that is not there. The
 * remaining flat fields (names/places/dates/highlightTerms/title/recordType) are
 * the triage stubs the agent works from. Mirrors record_search's inline-gedcomx
 * strip: unconditional once staged so the overflow protection can't be
 * forgotten, and safe because the staged file is already serialized to disk. The
 * caller must never apply this when `staged` is null (an un-staged exploratory
 * search — nothing was retained, and the transcript is the only copy).
 *
 * Mutates and returns `out`.
 */
export function compactStagedFulltextSearch(
  out: FulltextSearchResponse,
): FulltextSearchResponse {
  for (const r of out.results) {
    delete r.textDocument;
  }
  return out;
}

/**
 * Annotate the search rows with the ranking, in place, and return them best
 * first.
 *
 * ONE ROW LIST, NEVER TWO (#1212 ruling, 2026-09-15). The shape this replaces
 * shipped `ranked.matches` and dropped `results`, which meant the same records
 * existed in two shapes and needed a four-branch conditional to decide which to
 * send and a packaging guard to hold the two field sets in step. Annotating the
 * row removes the question.
 *
 * `searchRank` is what keeps the re-ordering AUDITABLE rather than lossy: the
 * response comes back sorted by match score, so the position FamilySearch
 * actually returned would otherwise be unrecoverable from the response alone.
 *
 * The STAGED SIDECAR IS NOT TOUCHED. It keeps FamilySearch's search order,
 * because it is an audit record of what the repository returned and re-sorting
 * an audit trail by a score computed afterwards is exactly the thing to regret.
 * It is also written before ranking runs, so the divergence is real rather than
 * theoretical — the spec says so.
 *
 * A row the ranker never scored keeps its search position and gains no score
 * fields, and sorts after every scored row rather than being dropped.
 *
 * Matching is by `recordId` reduced with `arkToBareId`: production emits a
 * canonical ARK on both sides, but fixtures predate that and carry a bare
 * `MXHY-TP4` against a full `ark:/61903/1:1:MXHY-TP4`. Exact matching silently
 * annotates nothing there, which is the same failure as not calling this.
 *
 * Mutates and returns `out`.
 */
export function annotateResultsWithRanking(
  out: RecordSearchToolResponse,
): RecordSearchToolResponse {
  const ranked = out.ranked;
  if (!ranked || !ranked.matches || ranked.matches.length === 0) return out;
  if (!out.results || out.results.length === 0) return out;

  const stubById = new Map(
    ranked.matches.map((m) => [arkToBareId(m.recordId), m]),
  );
  for (const row of out.results) {
    const stub = stubById.get(arkToBareId(row.recordId));
    if (!stub) continue;
    row.matchRank = stub.matchRank;
    row.searchRank = stub.searchRank;
    row.matchScore = stub.matchScore;
    if (stub.matchConfidence !== undefined) row.matchConfidence = stub.matchConfidence;
    if (stub.candidateFactCount !== undefined) {
      row.candidateFactCount = stub.candidateFactCount;
    }
    if (stub.attachedToSubject !== undefined) {
      row.attachedToSubject = stub.attachedToSubject;
    }
    if (stub.attachedToOther !== undefined) {
      row.attachedToOther = stub.attachedToOther;
    }
  }

  // Best first. An unscored row has no matchRank and sorts last, keeping its
  // relative search order — it is not dropped, it is simply not ranked.
  out.results.sort((a, b) => {
    const ra = a.matchRank ?? Number.POSITIVE_INFINITY;
    const rb = b.matchRank ?? Number.POSITIVE_INFINITY;
    if (ra !== rb) return ra - rb;
    return (a.searchRank ?? 0) - (b.searchRank ?? 0);
  });

  // `ranked` keeps its metadata and gives up its row list: the rows are on
  // `results` now, and shipping both is the duplication this ruling removed.
  delete (out.ranked as { matches?: unknown }).matches;
  return out;
}

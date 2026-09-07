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
  for (const r of out.results) {
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

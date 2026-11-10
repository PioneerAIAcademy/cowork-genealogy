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
import type { ImageTranscribeToolResponse } from "../types/image-transcribe.js";
import { arkToBareId } from "./ark.js";
import { pageText } from "./text-page.js";

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
 * lives in the staged sidecar: staging serializes the response before this
 * strip runs, so every transcript is on disk at `staged.resultsRef`.
 * `sidecar_read` reads ONE hit's transcript back, paged, via
 * `results/<file>#<hit id>` (staged or finalized), and lists the hits via
 * `results/<file>#hits`; record_read does not serve it (it matches on
 * recordId + gedcomx — `readFromSidecar` in record-read.ts — which a fulltext
 * result has neither of). What the strip saves is the cost of every hit's page
 * in one response, not access to any of them: triage from the stubs, then read
 * back only the hits worth reading. The
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

/** The longest `digest.excerpt` (issue #2489). The tool description and the
 *  search-images body both say "a 300-character excerpt". */
export const DIGEST_EXCERPT_CHARS = 300;

/** The longest inline `transcription`, measured JSON-escaped as `pageText` measures
 *  it. A tool result over about 50,000 characters reaches the caller as a notice
 *  with no data, and the OCR's 16,000-token cap allows about 64,000 characters. */
export const INLINE_TRANSCRIPTION_MAX_CHARS = 36_000;

// A line holding nothing but rule characters, table pipes, colons, plus signs and
// spaces: a markdown table's delimiter row, or the `====` rows the OCR draws
// under a fixed-width table's heading.
const RULE_LINE = /^(?=.*[-=_─━═])[-=_─━═|:+\s]+$/;
const RULE_RUN = /([-=_─━═])\1{3,}/g;
// Two rule characters with only spaces between them: a fixed-width table's column
// rulings (`--------    --   --------`), whose run lengths are the column widths.
const COLUMN_RULING = /[-=_─━═]\s+[-=_─━═]/;
const FENCE_LINE = /^\s*(```|~~~)/;

/**
 * Lossless layout cleanup of an OCR page, run on the text before the found check
 * and before staging, so the staged page, `sidecar_read` and the found check all
 * read the cleaned text. It changes no character of what the page says:
 *
 *  - trailing whitespace on every line goes (a CRLF becomes LF);
 *  - on a line made only of rule characters, every run of four or more of one
 *    rule character becomes three (`|:------|` → `|:---|`), so a markdown table
 *    keeps its delimiter row and a form's blank line keeps its `___`. A line of
 *    column rulings, runs with only spaces between them, is left as it is,
 *    because shortening a run moves every ruling after it out from under its
 *    column;
 *  - three or more line breaks in a row become two.
 *
 * Linear in the length of the text. Idempotent.
 */
export function normalizeTranscription(text: string): string {
  return text
    .split("\n")
    .map((raw) => {
      const line = raw.trimEnd();
      return RULE_LINE.test(line) && !COLUMN_RULING.test(line) ? line.replace(RULE_RUN, "$1$1$1") : line;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * What a caller triages a staged page on without reading it: the id the staged
 * element carries, the page's length, and its opening words. `chars` is the
 * length of the text that was staged, which the e2e orchestrator matches a
 * finalized sidecar element on. The excerpt drops blank lines, code fences and
 * rule lines and collapses the runs of spaces within each line, so a padded
 * register page shows its words rather than its column padding.
 */
export function transcriptionDigest(
  id: string,
  transcription: string,
): { id: string; chars: number; excerpt: string } {
  const lines: string[] = [];
  let length = 0;
  for (const raw of transcription.split("\n")) {
    if (FENCE_LINE.test(raw) || RULE_LINE.test(raw)) continue;
    const line = raw.replace(/\s+/g, " ").trim();
    if (line === "") continue;
    lines.push(line);
    length += line.length + 1;
    if (length > DIGEST_EXCERPT_CHARS) break;
  }
  let excerpt = lines.join("\n").slice(0, DIGEST_EXCERPT_CHARS);
  const last = excerpt.charCodeAt(excerpt.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) excerpt = excerpt.slice(0, -1);
  return { id, chars: transcription.length, excerpt };
}

/**
 * Shape `image_transcribe`'s answer at the MCP boundary, on every leg: in a
 * project, with no project, and when staging failed.
 *
 *  - Staged (issue #2490, lead ruling 2026-10-16): the inline `transcription`
 *    goes; the caller triages on `digest` and `found`, reads the page with
 *    `sidecar_read`, and hands `staged.resultsRef` to record-structurer.
 *  - Inline (no project, or `staged` null): the text stays, cut to
 *    `INLINE_TRANSCRIPTION_MAX_CHARS` at a line boundary with a sentence in
 *    `truncationNotice` saying so. `truncated` is not set, because it means the
 *    OCR stopped at its cap, and `found` stays, because the found check read the
 *    whole page.
 *  - Always: `nameExpansion` goes, and `metadata` keeps only the
 *    `memoryArtifactUrl` a Memories page URL resolved to.
 *
 * Applied at the MCP boundary only (`imageTranscribeMcpTool`), never inside
 * `imageTranscribeTool`: person_read's memories leg calls that function
 * in-process and needs the whole text. Idempotent.
 *
 * Mutates and returns `out`.
 */
export function compactImageTranscribeAnswer(out: ImageTranscribeToolResponse): ImageTranscribeToolResponse {
  if (out.staged) delete out.transcription;
  else if (typeof out.transcription === "string") cutInlineTranscription(out, out.transcription);
  delete (out as { nameExpansion?: unknown }).nameExpansion;
  if (out.metadata !== undefined) {
    const url = out.metadata.memoryArtifactUrl;
    if (url) out.metadata = { memoryArtifactUrl: url };
    else delete out.metadata;
  }
  return out;
}

function cutInlineTranscription(out: ImageTranscribeToolResponse, text: string): void {
  const { content, paging } = pageText(text, undefined, INLINE_TRANSCRIPTION_MAX_CHARS);
  if (!paging?.truncated) return;
  out.transcription = content;
  const n = (v: number) => v.toLocaleString("en-US");
  const cut =
    `Only the first ${n(content.length)} of the page's ${n(text.length)} characters are shown here, ` +
    "to keep this answer under the tool-result limit" +
    (out.found ? "; `found` covers the whole page" : "") +
    ". To get the whole page, transcribe it in a project (with projectPath): the page is then " +
    "staged, and sidecar_read returns it in parts.";
  out.truncationNotice = out.truncationNotice ? `${out.truncationNotice} ${cut}` : cut;
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
    if (stub.candidateFactCount !== undefined) {
      row.candidateFactCount = stub.candidateFactCount;
    }
    if (stub.birthYearConflict !== undefined) {
      row.birthYearConflict = stub.birthYearConflict;
    }
    if (stub.birthYearGap !== undefined) row.birthYearGap = stub.birthYearGap;
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

/**
 * Inline-projection compaction: record_search and fulltext_search apply their
 * compactors to every answer, staged or not.
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
 * Both functions are **idempotent**: applying them to an already-compacted
 * response is a no-op. The harness depends on that — its fixtures carry both
 * shapes.
 *
 * These modules must stay free of side effects at import: the harness imports
 * the compiled output in a bare `node --input-type=module` process with no
 * credentials, so anything that reads config or a token at module scope would
 * throw there.
 */

import type { RecordSearchResult, RecordSearchToolResponse } from "../types/record-search.js";
import type { FulltextResult, FulltextSearchResponse } from "../types/fulltext-search.js";
import type { RankSearchMatchesResult } from "../types/rank-search-matches.js";
import type { ImageTranscribeToolResponse } from "../types/image-transcribe.js";
import { arkToBareId } from "./ark.js";
import { TOOL_RESULT_CHAR_BUDGET } from "../constants.js";
import { pageText } from "./text-page.js";

/**
 * Slim `record_search`'s INLINE projection so a broad search can't overflow the
 * model's context — the bulk lives in the staged file, which rank_search_matches
 * (and record_read) read host-side, and the remaining flat stub fields still
 * carry names/dates/places for triage. Unconditional (no opt-in flag): nothing
 * needs the dropped fields inline, so the overflow protection can't be
 * forgotten by the caller.
 *
 * Applied to EVERY answer, staged or not (lead, 2026-11-09, issue #4386). With
 * no `projectPath` nothing is staged, so a row's `gedcomx` is kept nowhere;
 * `record_read` on its `recordId` gives that record's document. Keeping it
 * would put a 100-result page over Claude Code's ~50k-character cutoff (the
 * Dixon fixture: about 62k characters, about 29k compacted).
 *
 * When the call stages, the caller applies this only after the awaited
 * stageSearchResults has serialized the file to disk, so mutating the inline
 * copy cannot corrupt the sidecar — the sidecar, the viewer's
 * SidecarResultCard, and the eval fixtures all keep full fidelity.
 *
 * Measured against the 3,380 rows of a real 140-search session: gedcomx aside,
 * collectionUrl was 14.0% of row bytes, collectionTitle 9.4%, empty
 * treeMatches 2.9%. primaryId (4.6%) is deliberately KEPT — rank_search_matches
 * skips any candidate lacking it (rank-search-matches.ts), so dropping it would
 * silently disable the re-ranker.
 *
 * `batchNumber` is KEPT for the same class of reason (#1592): it is the only
 * route to a batch the agent can enumerate. Being flat and top-level, it
 * survives this function by construction; the test that pins it is what stops
 * a future `delete`.
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

type FulltextEntityKey = "names" | "places" | "dates";
type FulltextEntityCaps = Record<FulltextEntityKey, number>;

const FULLTEXT_ENTITY_KEYS: readonly FulltextEntityKey[] = ["names", "places", "dates"];

const FULLTEXT_COUNT_KEY = {
  names: "namesCount",
  places: "placesCount",
  dates: "datesCount",
} as const;

/** The most entries a fulltext row's names, places and dates lists keep inline. */
const FULLTEXT_ENTITY_CAPS: FulltextEntityCaps = { names: 60, places: 15, dates: 10 };

/**
 * Shorter caps, tried in turn on the longest rows first, while a page is still
 * over `TOOL_RESULT_CHAR_BUDGET` after the caps above. A newspaper or directory
 * page carries 143–567 names, so 50 such rows still come to ~79k at 60/15/10.
 */
const FULLTEXT_BUDGET_LADDER: readonly FulltextEntityCaps[] = [
  { names: 20, places: 10, dates: 5 },
  { names: 10, places: 5, dates: 3 },
  { names: 5, places: 3, dates: 0 },
  { names: 0, places: 0, dates: 0 },
];

const FAMILYSEARCH_ORIGIN = "https://www.familysearch.org/";

function entityWords(value: string): string[] {
  return value.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Trim, collapse inner whitespace and drop case-insensitive repeats, keeping the first spelling. */
function normalizeEntities(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.replace(/\s+/g, " ").trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/**
 * The `cap` entries worth keeping, returned in page order: first those sharing
 * the most distinct words with the row's `highlightTerms`, then those nearest
 * such an entry in the list (entities come in reading order, so this keeps the
 * deed or article around the hit rather than the top of the page), then page
 * order. Ranking by how many highlight words an entry shares, not by whether it
 * shares one, is what keeps "Patrick Flynn" ahead of the ninety other Flynns on
 * a directory page.
 */
function keepNearestMatches(values: string[], cap: number, highlightWords: Set<string>): string[] {
  const overlap = values.map(
    (v) => new Set(entityWords(v).filter((w) => highlightWords.has(w))).size,
  );
  const far = values.length;
  const distance = values.map(() => far);
  let last = -far;
  for (let i = 0; i < values.length; i++) {
    if (overlap[i] > 0) last = i;
    distance[i] = Math.min(distance[i], i - last);
  }
  let next = 2 * far;
  for (let i = values.length - 1; i >= 0; i--) {
    if (overlap[i] > 0) next = i;
    distance[i] = Math.min(distance[i], next - i);
  }
  return values
    .map((_, i) => i)
    .sort((a, b) => overlap[b] - overlap[a] || distance[a] - distance[b] || a - b)
    .slice(0, cap)
    .sort((a, b) => a - b)
    .map((i) => values[i]);
}

/**
 * Shorten one list to `cap`, recording its full length in `<list>Count`. A
 * count already present is final: it was taken from the full list by an
 * earlier pass, and this list may be that pass's shortened copy.
 */
function capEntityList(row: FulltextResult, key: FulltextEntityKey, cap: number): void {
  const values = row[key];
  if (!values || values.length <= cap) return;
  const countKey = FULLTEXT_COUNT_KEY[key];
  if (row[countKey] === undefined) row[countKey] = values.length;
  const highlightWords = new Set((row.highlightTerms ?? []).flatMap(entityWords));
  const kept = keepNearestMatches(values, cap, highlightWords);
  if (kept.length > 0) row[key] = kept;
  else delete row[key];
}

/**
 * Walk FULLTEXT_BUDGET_LADDER, longest row first, until the serialized answer
 * fits `budget` or the last rung has cut every row's lists to none. Never drops
 * a row, and cuts only `names`, `places` and `dates`: `title`, `recordPlace` and
 * the other row fields stay whole, so a page of long titles and places can end
 * over `budget`. The `volume_search` fitToBudget pattern: compact JSON
 * serializes each row on its own, so a row's change in length is the answer's.
 */
function fitFulltextToBudget(out: FulltextSearchResponse, budget: number): void {
  let size = JSON.stringify(out).length;
  if (size <= budget) return;
  const rows = out.results;
  const lengths = rows.map((r) => JSON.stringify(r).length);
  const longestFirst = rows.map((_, i) => i).sort((a, b) => lengths[b] - lengths[a]);
  for (const caps of FULLTEXT_BUDGET_LADDER) {
    for (const i of longestFirst) {
      for (const key of FULLTEXT_ENTITY_KEYS) capEntityList(rows[i], key, caps[key]);
      const length = JSON.stringify(rows[i]).length;
      size += length - lengths[i];
      lengths[i] = length;
      if (size <= budget) return;
    }
  }
}

/**
 * Shape every `fulltext_search` answer, staged or not, to shrink one page toward
 * TOOL_RESULT_CHAR_BUDGET. A transcript alone runs to 37k characters, and
 * a newspaper page's entity lists to 11k, so neither the unstaged answer nor a
 * staged page of long rows was safe.
 *
 * - `textDocument` goes. With a project it is in the sidecar, which staging
 *   wrote before this runs: `sidecar_read` `<resultsRef>#<hit id>` reads one
 *   hit's page back and `#hits` lists them. Without one, the caller re-runs
 *   with `projectPath` to keep it. record_read does not serve it (it matches on
 *   recordId + gedcomx, which a fulltext result has neither of).
 * - `names`, `places` and `dates` are normalized, then capped at
 *   FULLTEXT_ENTITY_CAPS by `keepNearestMatches`, with `namesCount`,
 *   `placesCount` and `datesCount` giving the full count when a list was
 *   shortened; then, while the page is over TOOL_RESULT_CHAR_BUDGET,
 *   FULLTEXT_BUDGET_LADDER shortens them further, down to none. `title` and
 *   `recordPlace` are never cut, so the page is not guaranteed to fit.
 * - `sourceUrl` goes only when it is exactly the FamilySearch origin plus `id`.
 * - `collectionTitle` moves into one response-level `collections` map.
 *
 * The sidecar keeps every field and every entry. Idempotent: a second pass
 * finds every list within its cap, every count already written, and no title
 * left to hoist.
 *
 * Mutates and returns `out`.
 */
export function compactStagedFulltextSearch(
  out: FulltextSearchResponse,
): FulltextSearchResponse {
  const collections: Record<string, string> = {};
  for (const r of out.results) {
    delete r.textDocument;

    if (r.sourceUrl === FAMILYSEARCH_ORIGIN + r.id) delete r.sourceUrl;

    if (r.collectionId && r.collectionTitle) {
      collections[r.collectionId] = r.collectionTitle;
      delete r.collectionTitle;
    }

    for (const key of FULLTEXT_ENTITY_KEYS) {
      const values = r[key];
      if (!values) continue;
      const normalized = normalizeEntities(values);
      if (normalized.length > 0) r[key] = normalized;
      else delete r[key];
      capEntityList(r, key, FULLTEXT_ENTITY_CAPS[key]);
    }
  }
  if (Object.keys(collections).length > 0) {
    out.collections = { ...out.collections, ...collections };
  }
  fitFulltextToBudget(out, TOOL_RESULT_CHAR_BUDGET);
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

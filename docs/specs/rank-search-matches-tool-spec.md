# `rank_search_matches` Tool — Implementation Spec

## Overview

`rank_search_matches` re-ranks a staged `record_search` result set by **match
score** against the research subject, replacing FamilySearch's unreliable search
ranker with its authoritative person matcher. It reads the host-side staged
results file, scores **every** staged candidate against the subject with the
`matchTwoExamples` engine (the same one `same_person` uses), writes the full
score set to a calibration log, and returns the **top 10 by match score** as
compact, gedcomx-free stubs.

It exists to fix two coupled failures of the raw search flow, both confirmed on
live FamilySearch data (see **Design notes**):

1. **Overflow.** A broad search's full gedcomx set exceeds the model's context
   (a *rare*-surname broad search returned 315,871 chars). This tool keeps the
   bulk gedcomx off-wire — it reads it host-side and returns only stubs.
2. **Unreliable ranker.** FS routinely gives its whole top band an identical
   search score (no ordering), burying correct records. Match-score re-ranking
   floats the genuine matches to the top.

### Relationship to other tools

- **`record_search`** stages its verbatim results host-side and returns a
  `staged.resultsRef` handle (`search-result-staging-spec.md`), and (below)
  **automatically drops the per-result gedcomx from its *inline* return whenever
  it stages** (no flag), so the raw search can't overflow. `rank_search_matches`
  consumes the `resultsRef`.
- **`same_person`** is the pair scorer. `rank_search_matches` reuses its
  `scorePair` / `buildRawWithAnchor` internals (lifted to a shared
  `src/utils/match-engine.ts`), calling them in a bounded host-side fan-out.
- **`research_log_append`** finalizes the *same* staged handle into
  `results/<log_id>.json` after ranking. `rank_search_matches` reads the staged
  file **read-only and never unlinks it**, so finalize still works.

This is a **re-ranker and review surface, not a classifier.** It orders and
returns candidates for the skill's existing role/age cross-checks plus a
needs-review band; it does not accept/reject. (Design notes, guardrails.)

## Input

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `projectPath` | string | yes | Absolute path to the active project directory. |
| `stagedResultsRef` | string | yes | The `staged.resultsRef` handle from `record_search` (`results/.staging/<uuid>.json`). A finalized `results/<log_id>.json` ref is also accepted. |
| `subjectId` | string | yes | A `persons[].id` in the project's `tree.gedcomx.json` — the research subject to match against. |
| `top` | number | no | How many top-ranked stubs to return. **Default 10.** Fixed count, not a score threshold (a good threshold is not yet known — see the score log). |
| `checkAttachments` | boolean | no | Default `false`. When `true`, fold one batch `source_attachments` call in host-side to set `attachedToSubject` / `attachedToOther` on the returned stubs. |

`subjectId`, `projectPath`, `stagedResultsRef` are camelCase (MCP wire
convention). The tool touches only camelCase API surfaces and the staged
snake_case envelope it reads.

## Behavior

1. **Read the staged (or finalized) file.** Guard `stagedResultsRef` with
   `assertInsideProject(projectPath, ref)` (traversal guard), then require the
   resolved path to be **either** under `results/.staging/` (a staged handle)
   **or** a top-level `results/<log_id>.json` (a finalized sidecar). This is a
   *looser* guard than `finalizeStagedResults`, which hard-rejects anything
   outside `results/.staging/` (`results-staging.ts:108-114`) — reuse
   `assertInsideProject` but write the dual-location check yourself; do **not**
   call finalize's guard. Then `JSON.parse(await readFile(...))`. **Read-only;
   never `unlink`** (so `research_log_append` can still finalize a staged
   handle). Both envelopes expose `payload.results`: staged =
   `{ tool, retrieved, returned_count, payload }`; finalized sidecar =
   `{ log_id, tool, retrieved, returned_count, payload }` — read `payload.results`
   from either. The finalized-ref path is only reachable *after* the search is
   logged (finalize unlinks the staged file); it exists for re-ranking a logged
   search.
2. **Build the subject doc.** Read the project's `tree.gedcomx.json`, locate the
   person whose `id === subjectId`, and assemble a minimal simplified-GedcomX
   doc `{ persons: [subject] }` (v1), used directly as `gedcomx2`. `same_person`
   is designed to work **without real FS IDs** — it mints a conforming FS id so
   `matchTwoExamples` never chokes on a malformed/absent id, and the score is
   unaffected because **FS matches on document content** (`same-person.ts:199-206`).
   The live probe confirmed an ark-less subject scores 0.99999 on the correct
   record. **The determinant is content richness, not the id.**

   **Harden the mint (required).** Today's `buildRawWithAnchor` mints only from an
   existing `ark` field (`:242-247`), so an ark-less focus person — the tree
   subject (stores only `id`), and likewise external-website records with no FS
   ark — gets *no* minted id and scores only because the API tolerates a missing
   one, which we should not depend on. In the shared `match-engine`, **extend the
   mint to synthesize a conforming Persistent id for any focus person that lacks a
   valid one (ark-less included), not just to normalize a bad ark.** This makes
   subject scoring deterministic and hardens the external-record path. If
   `subjectId` is absent from the tree, return an LLM-actionable input error.
   *(Future: enrich with 1-hop relatives; deferred — the minimal doc scored decisively.)*

   **Thin / unresolvable subject (guardrail).** A subject that is a sparse local
   stub (few facts, e.g. a not-in-FS `I1` person) can score uniformly near-zero
   against every candidate — the "degenerate score on an unresolvable id" case
   `person-evidence/SKILL.md:510-516` documents. Detect it: when **every**
   `matchScore` is null or below a degenerate floor (≈0.01), set
   `subjectResolvable: false` in the output so the skill treats it as *no match
   signal* (fall back to the manual `same_person` / cross-check path) rather than
   promoting a meaningless order as authoritative.
3. **Score every candidate.** One `getValidToken()`. Wrap each pair in a per-item
   `try/catch` (as `same_person`'s relatives mode does, `same-person.ts:67-91`),
   and **skip candidates with no `gedcomx` or no `primaryId`** (both optional on
   `RecordSearchResult`) with `matchScore: null` and **no FS call** — a
   person-less doc is a certain-400 and must not burn three retries. For the
   rest, `scorePair(result.gedcomx, result.primaryId, subjectDoc, subjectId,
   token)` via `mapWithConcurrency(results, 10, …)` + `withRetry`
   (`place-resolver.ts`). **Concurrency 10** — confirmed with the
   `matchTwoExamples` developer; it deliberately overrides `same_person`'s
   conservative `PAIR_CONCURRENCY = 5` (`same-person.ts:22`), and there is no
   batch endpoint. **Candidate ceiling:** the pool is bounded by the
   `record_search` `count` the skill passes (**50**, per the design) — higher
   than relatives-mode's `MAX_PAIR_CALLS = 30` (`relatives.ts:34`), so 50 is the
   deliberate per-rank ceiling; do not rerank an unbounded set. A pair that still
   fails after retries is kept with `matchScore: null` + `scoringErrors++` —
   **never dropped**. **No local pre-filter**: score every candidate in the pool
   (a name/date gate would re-drop the buried-but-correct records this tool
   rescues).
4. **Rank.** Sort by `matchScore` descending (nulls last). Assign 1-based
   `matchRank`; carry each result's original staged position as `searchRank`.
5. **Write the score log** (see next section) — **all** scored candidates, not
   just the returned top-`top`.
6. **Attachments (optional).** If `checkAttachments`, one batch
   `source_attachments({ uris: recordIds })`; map `attachedToSubject` /
   `attachedToOther` onto the stubs. (Deriving `attachedToSubject` needs the
   local-`subjectId`→FamilySearch-PID mapping — see Owner decisions.)
7. **Return** the top `top` (default 10) stubs (below). Bulk gedcomx is never in
   the return.

## Score log (calibration)

The tool appends **one JSON line per scored candidate** (all of them) to a
project-local append-only JSONL file, so a full score distribution accumulates
across real searches and a match-score threshold can be chosen later from data.

- **Location:** `results/match-scores.jsonl` (append-only). It is **not** a
  `<log_id>.json` sidecar and must be **excluded from the `results/` orphan
  validator** (the validator scans `results/` non-recursively for top-level
  `*.json`; a `.jsonl` name is already outside that glob — keep it so).
- **One line per scored candidate:**
  ```json
  {
    "performed": "2026-07-06T18:44:12.001Z",
    "subject_id": "KNS4-P6W",
    "staged_results_ref": "results/.staging/<uuid>.json",
    "search_rank": 21,
    "match_rank": 1,
    "record_id": "ark:/61903/1:1:…",
    "person_name": "Kenneth Werner Quass Sr",
    "birth_date": "4 Dec 1917",
    "death_date": "17 Sep 1982",
    "collection_title": "Find A Grave Index",
    "match_score": 0.99999,
    "match_confidence": 5
  }
  ```
- snake_case (persisted project artifact, per the repo casing rule).
- **Best-effort:** a score-log write failure never fails a successful rank call
  (mirror staging's best-effort contract — surface a `scoreLogError` note in the
  return, don't throw).
- **Calibration use (intended workflow).** Later, to choose a threshold:
  collect the `record_id`s of the records **ultimately included in the tree** —
  the ARKs carried by the assertions behind concluded facts in
  `tree.gedcomx.json` / `research.json` — and **join them to this log by
  `record_id`**. The match scores of the *kept* records vs. the *discarded*
  ones give the distribution a threshold must separate. This join is a later
  analysis step (a small script over `results/match-scores.jsonl` + the tree),
  not this tool's job.
- **Join requirement (load-bearing).** Log `record_id` as `record_search`'s
  `recordId` **verbatim** (e.g. `ark:/61903/1:1:QPRC-WPBZ`). Note the assertion
  side may be stored in any of several forms (resolver URL, full ARK, `1:1:X`,
  bare `X`); the validator matches them by reducing both to a **bare 8-char id**
  via `arkToBareId` (`validator.ts:1100-1114`). So the calibration join is **not**
  string equality — the analysis script must `arkToBareId`-normalize *both* sides.
  Logging the full ARK verbatim is the safe choice (it reduces cleanly); do
  **not** pre-normalize, shorten, or reformat it in the log.

## Output

Sorted by `matchScore` descending; no gedcomx.

```jsonc
{
  "subjectId": "KNS4-P6W",
  "scoredCount": 50,          // candidates scored (full staged set)
  "returnedCount": 10,        // min(top, scoredCount)
  "scoringErrors": 0,         // pairs whose FS call kept failing (kept, matchScore null)
  "scoreLogError": null,      // present only if the calibration append failed
  "matches": [
    {
      "matchRank": 1,
      "searchRank": 21,       // original FS-staged position — makes the ranker failure auditable
      "recordId": "ark:/61903/1:1:…",
      "primaryId": "…",
      "personName": "Kenneth Werner Quass Sr",
      "sex": "Male",
      "birthDate": "4 Dec 1917", "birthPlace": "Sumner, Bremer, Iowa, United States",
      "deathDate": "17 Sep 1982", "deathPlace": "Grapevine, Tarrant, Texas, United States",
      "collectionTitle": "Find A Grave Index",
      "recordArk": "ark:/61903/1:2:…",
      "matchScore": 0.99999,       // 0–1; null on persistent FS-call failure — never dropped
      "matchConfidence": 5,        // 1–10; omitted on no-match
      "attachedToSubject": false,  // only when checkAttachments
      "attachedToOther": true
    }
    // … up to `top` (default 10)
  ]
}
```

Each stub is ~150 bytes. Returning the top 10 keeps the model-facing payload
small while the full scored set lives in the score log and the staged file.

## Tool schema

Standard `allToolSchemas` entry. `name: "rank_search_matches"`, description
summarizing "re-rank staged record_search results by match score against a tree
subject; returns the top-N matches." `inputSchema` with the five Input fields;
`projectPath`, `stagedResultsRef`, `subjectId` required. `additionalProperties:
false`.

## Authentication

Authenticated tool — obtains the FamilySearch token via
`getValidToken()` (one token reused across the whole fan-out). No new token
plumbing; goes through `src/auth/` like every other authenticated tool. Sends
`BROWSER_USER_AGENT`.

## Error handling

- **Traversal / outside-staging ref**, **missing/invalid staged file**, **no
  `results` array in the envelope** → input error that writes nothing (same
  guards as `finalizeStagedResults`).
- **`subjectId` not found in `tree.gedcomx.json`** → LLM-actionable input error
  naming the id.
- **Per-pair scoring failure** → `matchScore: null` for that candidate, counted
  in `scoringErrors`; the call still succeeds and returns the rest.
- **Empty staged results** → `{ scoredCount: 0, returnedCount: 0, matches: [] }`
  (not an error).
- **Score-log write failure** → `scoreLogError` note in the return; call
  succeeds.
- **No valid session** → the standard `getValidToken()` "call the login tool"
  error.

## Files

- `src/types/rank-search-matches.ts` — input + response types.
- `src/tools/rank-search-matches.ts` — the tool.
- `src/utils/match-engine.ts` — **new shared module** lifted from
  `same-person.ts`. This is a *closure*, not two functions: `scorePair` (`:112`)
  pulls `throwForBadStatus` (`:274`), `parseArkFromTitle` (`:268`), the `URL`
  const, and the `SamePersonApiResponse`/`SamePersonResult` types;
  `buildRawWithAnchor` (`:231`) pulls `toValidFsArk` (`:222`), `randomFsId`
  (`:211`), and the `FS_ID_ALPHABET`/`VALID_FS_ID_RE`/`DEFAULT_ARK_TYPE`/`PERSISTENT_ID`
  consts — plus the mint-hardening from Behavior §2. `same_person` re-imports the
  module; its public contract is unchanged.
- `dev/try-rank-search-matches.ts` — one-shot live smoke test.
- `tests/tools/rank-search-matches.test.ts` — unit tests.
- Wiring: `src/tool-schemas.ts` (`allToolSchemas`), `src/index.ts` (dispatch),
  `manifest.json` (`tools[]`) — kept in sync by the manifest drift test
  (`tests/packaging/manifest.test.ts`).
- `record_search` change: in the `record-search.ts` return path, **unconditionally
  strip inline `results[].gedcomx` after `await stageSearchResults(...)` whenever
  staging succeeded** — no opt-in flag (nothing needs inline gedcomx once staged,
  so the overflow protection can't be forgotten by the caller). The staged file is
  already serialized to disk, so stripping cannot corrupt the sidecar; an un-staged
  (no `projectPath`) search still returns full gedcomx inline.
- **`packages/engine/plugin/skills/search-records/SKILL.md` — required, not
  optional.** Add `rank_search_matches` to `allowed-tools` and rewrite the triage
  step to the flow below. **Without this the tool is unreachable** — the
  compact-stub behavior is automatic on every staged `record_search`, but this
  rewrite is what invokes `rank_search_matches` on the staged results. Plan for:
  the `allowed-tools` change flips the `search-records` eval
  run log inactive (snapshot → re-run + re-grade), and `check_tool_coverage.py`
  warns until the test corpus gains a `rank_search_matches` MCP fixture.

### `search-records` flow (the skill rewrite)

1. `record_search({ …, projectPath, count: 50 })` → compact stubs (inline
   gedcomx auto-omitted) + `staged.resultsRef`. (Page with `offset: 50` if no
   confident match — recall cliff at rank 50.)
2. **Always** `rank_search_matches({ projectPath, stagedResultsRef, subjectId,
   checkAttachments: true })` after any results-returning search → match-ranked
   stubs + scores. The per-result
   `same_person` loop and the separate `source_attachments` call **collapse into
   this one call.** If `subjectResolvable: false`, fall back to the manual
   `same_person` / cross-check path.
3. Treat the ranked list as a **review surface**: apply the existing role/age
   cross-checks; confirm the top matches (needs-review band for scores that don't
   separate, and for sparse/dateless records). `record_read` the top 1–3.
4. `research_log_append` with the **same** `stagedResultsRef` finalizes the
   sidecar — unchanged.

## Testing

`tests/tools/rank-search-matches.test.ts`:

- Reads a staged fixture, scores against a subject fixture (mock
  `matchTwoExamples` responses), returns exactly `top` stubs sorted by
  `matchScore` desc, with `searchRank` preserved.
- Full scored set (not just top-`top`) is appended to `results/match-scores.jsonl`;
  a forced write failure surfaces `scoreLogError` and does **not** fail the call.
- A failing pair yields `matchScore: null` + `scoringErrors++`, never dropped.
- Guard rejections (traversal, missing file, `subjectId` absent) error cleanly.
- Read-only: the staged file still exists and is finalizable after the call.
- `record_search` strips inline `results[].gedcomx` whenever staging succeeded
  (unconditional); keeps it inline for an un-staged (no `projectPath`) search and
  when `staged` is null.

Smoke: `dev/try-rank-search-matches.ts` runs a real `record_search` +
`rank_search_matches` against live FS for a known subject.

## Design notes

- **Premise validated live.** Re-ranking a 50-result broad "Kenneth Quass"
  search against tree person `KNS4-P6W`: FS scored its top 21 hits identically
  (no ranking); match-score re-ranking put all 13 genuine records first (first
  different person at match_rank 14), rescuing a burial FS ranked 21st and a
  second death index FS ranked 15th.
- **Surface for review, not accept/reject (guardrail 1).** A *different*
  same-name/same-state person scored 0.716 — inside the match band. No single
  threshold cleanly separates, which is why v1 returns a fixed **top 10** for the
  skill to confirm, and why the score log exists (to choose a threshold from
  real data later).
- **Sparse records are low-signal (guardrail 2).** Dateless stubs scored
  unstably (0.086 vs 0.668 on a middle-initial difference); the skill must not
  treat a low score on a thin record as a definitive non-match.
- **Concurrency 10, no batch** — confirmed with the matcher's developer.
- **Scope boundary:** this recovers records FS *returned but ranked low*.
  Records FS *never returns* (indexer mis-transcription) remain the
  `search-external-sites` escalation's job — out of scope, no regression.

## Owner decisions (deferred)

1. **Threshold** — intentionally none in v1 (fixed top-10). Set later from
   `results/match-scores.jsonl`.
2. **`checkAttachments` in v1** — needs a local-`subjectId`→FS-PID map
   (`source_attachments` keys on entity PIDs). Build now or defer to the existing
   separate `source_attachments` call.
3. **Subject enrichment** — minimal (subject person only) vs. +1-hop relatives.
   Minimal scored decisively in the probe; revisit if real cases need more.
4. **Score-log path** — `results/match-scores.jsonl` proposed; confirm it stays
   clear of the results-orphan validator.

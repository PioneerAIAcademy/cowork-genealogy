# Scope: `rank_search_matches` — a host-side match-score re-ranker for `record_search`

**Status:** scoped + premise validated by a live probe (for team review) · **Date:** 2026-07-06
· Extends [`search-result-staging-spec.md`](../specs/search-result-staging-spec.md).

## Problem

`record_search` (host-side MCP tool) returns many FamilySearch record hits, each
carrying a full simplified-GedcomX. Two coupled failures:

1. **Overflow.** The full set exceeds the model's context. In a live check, a
   *broad, no-collection* `Kenneth Quass / United States` search (count=50, a
   **rare** surname) returned **315,871 chars / 10,105 lines** and overflowed —
   the agent's only fallback is `bash grep` on the saved file, which is slow and
   **broken in the Cowork VM** (bash restricted), leaving the agent stranded.
2. **Unreliable ranker.** The target is often not in FS's top-10 — and the live
   probe showed it's worse than that: **FS gave the top 21 hits the identical
   search score** (no discrimination at all; order ≈ collection order). "Return
   top-N by FS rank" is therefore not viable.

## Approach (validated)

Move the *matching* host-side: `record_search` stages all hits (it already does)
and returns a compact, gedcomx-free view; a new host-side tool **re-ranks every
staged hit by `same_person` match score** (FamilySearch's match-by-two-examples
engine) against the tree subject and returns a compact, match-ranked list. The
bulk gedcomx never reaches the model; the FS ranker is replaced by the
authoritative content matcher.

### Live-probe evidence (Kenneth Quass, real FS)

Scoring the 50 broad-search hits against tree person `KNS4-P6W`:

- **Reranking works decisively.** match_rank 1–13 were *all* genuine Kenneth
  records (first different person at rank 14). It floated his **burial from FS
  rank 21 → match rank 1**, a **2nd death index from FS 15 → 9**, and a residence
  record FS never tree-matched. Match cluster ≈0.72–1.0 vs no-match ≤0.009.
- **Guardrail 1 — surface, don't classify.** A *different* same-name/same-state
  man (b.1915, Linn Co.) scored **0.716**, inside the match band, tied with the
  weakest correct records. No single threshold separates cleanly.
- **Guardrail 2 — sparse records are unstable.** Two dateless obituary stubs
  differing only by a middle initial scored 0.086 vs 0.668. Thin records need
  corroboration.
- **Simplifiers confirmed:** `same_person` accepts a raw `person_read` tree doc
  as `gedcomx2` (synthesizes a placeholder ARK) → **no `buildSubjectDoc` needed**;
  and trimming a record's non-focus persons did **not** change scores.

## Design

### New tool: `rank_search_matches` (host-side)

**Input:** `{ projectPath, stagedResultsRef, subjectId, top?, checkAttachments? }`
- `stagedResultsRef` — the `staged.resultsRef` handle from `record_search`
  (also accept a finalized `results/<log_id>.json` ref).
- `subjectId` — a `persons[].id` in `tree.gedcomx.json`.
- `top?` — how many ranked stubs to return; **default generous (~all above a
  low score floor, e.g. 0.1)**, because stubs are ~150 bytes and the probe showed
  correct records extend past rank 10 (his as-parent records were match_rank 11–13).
- `checkAttachments?` — fold one batch `source_attachments` in host-side.

**Output** (sorted by `matchScore` desc; no gedcomx):
`{ subjectId, scoredCount, scoringErrors?, matches: [{ matchRank, searchRank,
recordId, primaryId, personName?, sex?, birthDate?, birthPlace?, deathDate?,
deathPlace?, collectionTitle?, recordArk?, matchScore(0–1)|null, matchConfidence?(1–10),
attachedToSubject?, attachedToOther? }] }`. `searchRank` beside `matchRank` makes
the FS ranker's failure auditable; `matchScore:null` on persistent call failure —
**never dropped**.

**Internals (all host-side, all reuse):**
1. Read the staged file via the `assertInsideProject`/`isInsideProject` + `readFile`
   block `finalizeStagedResults` uses (`results-staging.ts:108-124`) — **read-only**,
   never unlink (so `research_log_append` can still finalize the same handle).
2. Subject doc = **raw `person_read(subjectId)` output**, used directly as `gedcomx2`
   (probe-confirmed; no new assembly). Enrich with relatives only if later shown to help.
3. One `getValidToken()`; fan out `scorePair(result.gedcomx, result.primaryId,
   subjectDoc, subjectId, token)` via `mapWithConcurrency(results, 10, …)` + `withRetry`.
4. Optional one batch `source_attachments({uris})`.
5. Sort by score; return flat stubs.

**Score every retrieved hit — no local pre-filter.** A name/date heuristic gate
would reintroduce the exact blindness we're fixing (the probe's rescued records
would have been gated out). Verify all; let `matchScore` sort them.

### Changed tool: `record_search` (auto-omit inline gedcomx when staged)

**Unconditionally** drop the inline `results[]` `gedcomx` (the size driver)
**whenever staging succeeded** — no opt-in flag. Strip **after**
`stageSearchResults` writes, so the on-disk staged file is intact. If `staged` is
null (an un-staged exploratory search), keep gedcomx inline. Safe because nothing
consumes inline gedcomx once staged (the review confirmed `person-evidence` /
`record-extraction` read via `record_read`), so the overflow protection can't be
forgotten by the caller and can't regress.

### New `search-records` flow (default path — pre-prod, so exercise it everywhere)

1. `record_search({ …, projectPath, count: 50 })` → compact stubs (inline gedcomx
   auto-omitted) + `staged.resultsRef`. (Top-50 cap; page with `offset:50` if no
   confident match — recall cliff at rank 50.)
2. `rank_search_matches({ projectPath, stagedResultsRef, subjectId, checkAttachments: true })`
   → match-ranked stubs + scores + attachment flags. The per-result `same_person`
   loop and the separate `source_attachments` call **collapse into this one call.**
3. Treat the ranked list as a **surface-for-review**: apply the existing role/age
   logical cross-checks; **needs-review band** (scores that don't separate, ~0.7–0.85,
   or thin/dateless records) → confirm, don't auto-accept. `record_read` the top 1–3.
4. `research_log_append` with the **same** `stagedResultsRef` finalizes the sidecar — unchanged.

## Decisions

1. **Reranker via `same_person` (match-by-two-examples), host-side.** Validated.
2. **Separate `rank_search_matches` tool, not folded into `record_search`.** Lower
   blast radius on the most-shared tool, graceful degradation (a matcher throttle
   slows ranking, not search), composable (re-rank a logged search later). Owner
   chose separate; the new flow is the **default** in `search-records` (pre-prod →
   maximize exposure), old inline-gedcomx path kept only as documented fallback.
3. **Params:** fetch **top-50** raw, rerank **all 50** at concurrency **10** (5 waves;
   no batch match API — confirmed with the matcher dev), return a **match-ranked list**
   (generous cutoff, not a hard top-10 — correct records ran to rank 13 in the probe).
4. **Surface-for-review, not a classifier** (guardrail 1). Return scores; the skill
   confirms via its existing cross-checks + a needs-review band.
5. **Omit inline gedcomx** to kill the overflow at source; **defer** per-field trimming
   and a `results_read` tool as YAGNI (the flat stubs carry what triage needs; the
   staged file holds the full gedcomx if ever needed).

## Blast radius

New: `src/types/rank-search-matches.ts`, `src/tools/rank-search-matches.ts`,
`dev/try-rank-search-matches.ts`, `tests/tools/rank-search-matches.test.ts`; register
in `tool-schemas.ts` + `index.ts` + `manifest.json`; spec
`docs/specs/rank-search-matches-tool-spec.md`. Move `scorePair` + `buildRawWithAnchor`
from `same-person.ts` into `src/utils/match-engine.ts` (both tools import). Changed:
`record_search` auto-omit inline gedcomx when staged (~3 lines); `search-records/SKILL.md`
+ allowed-tools. **Untouched:** research.json schema/validator/enums/web-mirror, VM code,
`same_person`'s public contract, staging/finalize paths, and (omit is opt-in)
`person-evidence`/`record-extraction`.

## Load-bearing assumption — now validated, with caveats

The premise ("`matchTwoExamples` discriminates a buried-but-correct record above the
top false positives") **held decisively** for fact-bearing records in the live probe.
The two guardrails are design inputs, not blockers: build a **re-ranker + review
surface**, not an accept/reject gate, and flag sparse/dateless records as low-signal.

## Remaining owner calls

1. **Needs-review band thresholds** — where to draw "confident" vs "review" (the probe
   suggests a real overlap ~0.7–0.85). Tune against a few more real cases.
2. **Return cutoff** — `top` default (all-above-floor vs a fixed N); stubs are cheap,
   so lean generous.
3. **`checkAttachments` in v1** — folds a round-trip in but needs a local-`subjectId`→FS-PID
   map (`source_attachments` keys on entity PIDs); build now or defer to the separate call.
4. **Rerank pool depth** — 50 confirmed; revisit only if real cases need paging past 50.

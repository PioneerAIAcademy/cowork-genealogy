# Scope: read staged records from the sidecar instead of re-fetching via `record_read`

**Status:** scoped + partially verified (one live re-probe owed) · **Date:** 2026-07-07
· Extends [`search-result-staging-spec.md`](../specs/search-result-staging-spec.md)
and the `rank_search_matches` reranker.

## Problem

A **passing** elizabeth-geach e2e run made **37 `record_read` calls** — the #1
tool, more than the 28 `record_search` calls — and ~99 min wall. Analysis:

- ~15 of the 37 were **literal duplicate re-reads** of an already-read record
  (the extraction → person-evidence → classification passes re-fetch instead of
  reusing content already retrieved).
- The rest fetched detail (households, named parents, relationships) that the
  **staged search result already held**.

**Live verification (real FamilySearch, before the token lapsed).** Comparing a
`record_search` result's gedcomx to `record_read` on the same ark, across single-
and multi-person records (Ohio births w/ parents, Cook County deaths w/ parents,
NY censuses): **persons, relationships, and fact-types are identical.** `record_read`
returns ~17–65% more *bytes*, not more evidence-bearing structure.

Root cause: **PR #597** made `record_search` stage results host-side and return
compact stubs (gedcomx omitted inline). That killed context overflow, but moved
the detail out of the agent's view — so the agent pays it back as `record_read`
round-trips for content it already has staged on disk.

## What the staged data has vs. what `record_read` adds

- `record_search` stages the **`toSimplified`** tool output: persons, relationships,
  facts, and `sources` **if** the FS search response carried `sourceDescriptions`.
- `record_read` uses **`toSimplifiedStandardized`** = `toSimplified` **+ `standardizePlaces`**
  (resolves free-text places to `standard_place`). Its output also carries the
  source `citation`.

Two deltas, one closable, one **unverified**:

1. **Place standardization** — `record_read` adds `standard_place`; the staged data
   doesn't. **Closable host-side** by re-applying `standardizePlaces` (needs the
   network the VM lacks — so this must live in the host tool, not a skill script).
2. **Source citations** — `record_read`'s output carries the full `citation`;
   whether the FS *search* response carries `sourceDescriptions` per result is
   **unverified** (token expired mid-analysis; test fixtures are trimmed). This is
   the only open question, and by design it does **not** block implementation.

## Design (per owner guidance — "let the skill decide")

Rather than prove the staged data is byte-complete, make the skill **aware of the
tradeoff** and let it choose per record.

**Tool change — `record_read` gains an optional `resultsRef`** (additive,
backward-compatible):

- `record_read({ recordId })` — unchanged: a live FS read.
- `record_read({ recordId, resultsRef, projectPath })` — reads the record's gedcomx
  from the staged sidecar (`results/.staging/<uuid>.json` **or** finalized
  `results/<log_id>.json`) **host-side, no FS round-trip**, re-applies
  `standardizePlaces`, and returns it. Reuses the exact guard+read path
  `rank_search_matches` uses (`assertInsideProject`/`isInsideProject` +
  `readFile` + `envelope.payload.results`), matching the result by `recordId`.
  Returns a `source: "sidecar"` marker so the skill/tests can tell them apart.
  Falls back with a clear error if the record isn't in that sidecar (skill then
  does a live read).

**Skill change — record-extraction (and the search-records handoff) are told:**
> The staged sidecar gives you the *same persons, facts, and relationships* as a
> live read (verified), for free — call `record_read` with the `resultsRef` from
> the search's log entry to get one record from it. A **live** `record_read`
> (omit `resultsRef`) additionally guarantees the authoritative source
> **citation**. Prefer the sidecar for triage and for extracting evidence; do a
> live read when you are finalizing a source and need its full citation, or when
> the record wasn't part of a staged search.

## Why this is safe either way the citation question falls

- Content (persons/facts/relationships) is **verified identical** → extraction
  loses nothing by sourcing it from the sidecar.
- Place standardization: the staged result already has the **correct** standardized
  place; the tool returns it as-is (a live read's own standardization is *less*
  reliable — see Findings).
- If the sidecar carries citations → the win is large (sidecar for nearly
  everything). If it doesn't → the skill still triages from the sidecar and only
  reads live for records it **keeps**, killing the duplicate re-reads regardless.
- One record at a time → **no re-introduction of the #597 context overflow.**

## Blast radius

- `record_read`: additive `resultsRef`/`projectPath` params + the sidecar branch
  (reuse `rank_search_matches`'s read helpers); Vitest for the new branch.
- `search-result-staging-spec.md` / `record_read` tool-spec: note the mode.
- `record-extraction/SKILL.md` (+ `search-records/SKILL.md` handoff): the
  awareness text above → flips those unit runlogs inactive (re-run + re-annotate).
- **Untouched:** `record_search`/`rank_search_matches` core, staging/finalize
  paths, auth, research.json schema.

## Findings (verified live, 2026-07-08)

Ran the search-vs-`record_read` comparison on real records (1940 US census +
England death/burial). For **the person you searched** (the matched persona):

- **Facts** (type / value / original date + place): **identical** search vs read.
- **Source citation: present in the search result** — the staged result already
  carries the working collection + household citation (a live read adds only one
  extra persona-specific source). So the sidecar has the citation; the citation
  question that earlier looked like the blocker is **resolved** — no live read
  needed for it.
- **Standardized place: the search result's is correct; a live `record_read`
  re-standardizes it WRONGLY** (observed `Southampton, NY → Southampton, England`;
  `Rochdale, England → Rochdale, South Africa`). The sidecar is therefore *more*
  reliable, and the sidecar tool returns the staged place **as-is** (no
  `standardizePlaces` re-run). **The live `record_read` path is also fixed:** the
  recapi record response carries **no** FS-normalized place (only `original` +
  parsed County/City/State fields — verified), so `record_read` now uses
  `toSimplified` (FS's provided data) instead of `toSimplifiedStandardized` and
  leaves `standard_place` **unset** rather than resolving the ambiguous name to a
  wrong place. Staged records still carry FS's correct normalized place from the
  search endpoint.

The one genuine "read has more" is **co-residents**: a census search returns other
household members with **reduced facts** (name + a fact or two); a live read fills
in their full facts. Hence the guidance carve-out — sidecar for the searched
person; **live read for a co-resident's full facts** (or an off-search ARK).

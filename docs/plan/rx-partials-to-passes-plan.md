# record-extraction: partials → passes — plan

> **Status:** Queued (rides the `rx-extractor-state-diet` PR for later
> implementation; sequenced INSIDE the judge-infra round — see §4).
> Authored 2026-07-13 against runlog `v1_2026-07-13_06-33-04`
> (8 pass / 8 partial / 0 fail; annotated by Dallan).
> Every item below is root-caused from persisted args, not judge prose.

## 1. Why these are partials

The 8 partials decompose into four causes, none a regression:

| Cause | Tests hit | Mechanism |
|---|---|---|
| **A. Mock geocoder garbage now caught by the place guard** | 005, 006, 009 (and retry-cost echoes elsewhere) | Unit fixtures stage no `place_search` fixture for their places, so the live resolver's fallback geocode returns junk ("Branch" → Newfoundland; "Shenandoah" → New Zealand; cemetery → Chicago). The 2e country-contradiction guard correctly rejects/warns — but the reject/retry cycle costs Tool Arguments 2 (retry policy), and in 006 a junk `standard_place` persisted where the guard's country heuristic couldn't fire (no country token in the place text). |
| **B. Recovered-retry policy charging real-but-recoverable slips** | 008 (persona ids on a no-sidecar record), 010 (`name` vs `names` on add_person), 005/009 (the guard retries above) | First-call errors self-corrected on retry; policy caps Tool Arguments at 2. Some are eliminable at the source (below); the rest is the documented diagnostic-mode cost. |
| **C. Judge noise vs settled doctrine** | 007 (evidence-type rationale contradicts its own analysis), 009 (re-litigates death-cert indirect against the fixture's own passed expected_classifications), 013 ("critical missing action" the transcript shows was done), 014 (FAN hedging) | The doctrine-inversion class; the judge-infra package (board item 1) is the fix. Not addressed by this plan beyond annotation. |
| **D. Real one-line craft gaps** | 007 (narrative prose in a relationship `value` — rule exists, slipped), 010 (marriage witnesses at proximity `self` instead of `witness`), 013 (identity-discrepancy flag not surfaced in summary), 014 (`add_household_children` referenced a stale id per judge; verify) | Genuine, small, each maps to one edit. |

## 2. Changes

### Lane 2 — fixtures/harness (no agent-body flip)

1. **Stage real place resolutions for the unit scenarios (cause A).**
   For every record-extraction fixture whose record carries places
   (Branch Township PA, Shenandoah PA, the 016 Norwegian parishes, the
   marriage/death-cert scenarios): add `place_search` mcp fixtures with
   correct `standardPlace` values (or extend the scenario sidecars where
   the record came from a staged search). The agent then resolves places
   correctly instead of fighting the guard. Files:
   `eval/fixtures/mcp/place-search-*.json` + fixture `mcp_fixtures`
   lists. This also de-noises Tool Arguments across the suite.
2. **Guard hardening follow-up (cause A, 006's silent variant):** the
   country heuristic can't fire when the input place text has no country
   token ("Branch Township, Schuylkill, Pennsylvania" — no "United
   States"). Extend the guard: when the source record/sidecar carries a
   resolved standard_place for the same place text, a geocode that
   *disagrees at the country level with the scenario's other resolved
   places* warns loudly. Keep it heuristic-simple; spec §3.6 delta.
   (packages/engine/mcp-server/src/tools/research-append.ts)
3. **ut_014 stale-id check:** judge claims the `add_household_children`
   call referenced a stale id. Verify from tool_calls; if real, it's a
   projection-staleness bug (project_context snapshot vs tool-assigned
   ids mid-run) → fix in the agent-body ordering (call project_context
   before any tree writes) or tool-side. If not real, judge-noise pile.

### Lane 4 — agent body (one flip, batch with the judge-infra re-run)

4. **Relationship `value` template (007, recurrent):** the no-prose rule
   exists but slips on relationships specifically. Add the concrete
   template where relationship extraction is described: `value:
   "child of Thomas Flynn (inferred)"`; the household-position reasoning
   goes in `informant_bias_notes`. (packages/engine/plugin/agents/
   record-extractor.md)
5. **Marriage witnesses row (010):** add to the marriage informant
   table: witnesses attest the ceremony they watched — informant = the
   witness, proximity `witness`, never `self` (self is for facts about
   *oneself*).
6. **Identity-flag surfacing (013):** the §5d contradiction rule says
   flag the discrepancy; make the *placement* explicit — the flag is a
   REQUIRED line in the return summary (the caller relays it), not
   optional context. One sentence.
7. **FAN-lead surfacing (014):** same placement fix — when a
   differently-surnamed head is stubbed as a FAN lead, the return
   summary MUST carry one line naming the lead and the follow-up
   (hypothesis-tracking). One sentence.

### Explicitly NOT in this plan

- Judge doctrine inversions (cause C) — board item 1 (judge-infra).
- Retry-policy relaxation (cause B residual) — docs/TODOs.md item,
  post-alpha, data-gated.
- person_evidence/proximity enum revisits — settled this window.

## 3. Expected outcome

Items 1–2 remove the geocode-junk retries (three tests' Tool Arguments
recover); items 4–7 close the four real craft gaps; cause C waits for the
sonnet-5 judge. Realistic post-implementation line: 12–14 pass /
2–4 partial / 0 fail, with residual partials being judge-noise cases the
annotations already correct.

## 4. Sequencing & cost

Implement INSIDE the judge-infra round (board item 1), not before:
items 4–7 flip the rx runlog (one run+annotation), and that same run
must be re-graded under the new judge anyway — batching means ONE
annotation round pays for both. Items 1–3 are fixture/tool-side and can
land in the same PR. Total: one rx run + annotation, a handful of mcp
fixtures, two one-line tool changes, four agent one-liners.

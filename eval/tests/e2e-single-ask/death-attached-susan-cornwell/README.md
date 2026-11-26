# death-attached-susan-cornwell

**Ask:** "Can you find the death record for Susan Reynolds Cornwell in New York K8TG-N4H"

**Expected owner:** none (the main thread answers from the attached source) or `search-records`.
**Expected save:** no new source. **Forbidden:** `record_search`. **Required:** `person_read`.

## Where it came from

Row A2 of Issue #3571's adjudication on issue #3527 (2026-11-02): the second ask in `feedback-2026-09-22T15-47-39-065238Z.zip`, issue #2813's
"answer already attached" case. The death source has since been attached on FamilySearch: New York, State
Death Index, 1880-1956, Susan Cornwell, 4 April 1892, Sands Point (source `QQZL-77N` in the tree).

`required_tools: ["person_read"]` is what makes this fixture able to fail: without it an empty turn
passes every other check (the loader refuses an `absent`-only save with no `required_tools`). It follows
the row's "read through `person_read`": a turn that answers only from the local `tree.gedcomx.json`
fails here, though it reaches the same answer. "No new source" is graded stricter than the row ("no source duplicating the
attached entry"): any new `research.json` source fails. A hand-off to `search-records` is allowed by the
row but will almost always fail `forbidden_tools`, since that agent searches with `record_search`.

## Expected result today

PASS. Measured 2026-11-26 in the whole-panel run, on the Haiku 5.5 low main thread
(`main-thread.json`), once `project_context` returned `boundedRequest`:

```
PASS death-attached-susan-cornwell  expected=none|search-records  first=none  save=ok  stop=clean
    units: none  extraction_append=0
```

The main thread read Susan with `person_read`, called no `record_search` and added no source. On `main`
84e94e6c9 without the field it failed `required_tools` the same day: it searched nothing but never
called `person_read` (`units: research`). On `main` 202730796, before that, it bypassed the router and
handed the ask to search-records, which searched for the attached index.

Measured 2026-11-16, when it failed on `save` in the eight-fixture panel run:

```
FAIL death-attached-susan-cornwell  expected=none|search-records  first=none  save=1 new sources, expected none  stop=clean  failed=[save]
    units: research  extraction_append=1
```

The router answered from the attached index entry, as before, then ran `extraction_append` on that same
record (`ark:/61903/1:1:QG5L-ZMP3`), so the attached death index became `src_001` in `research.json`. That
is a source duplicating the attached entry, which the row forbids. It is not from the PR that added the
routing sentence to the panel: the sentence is conditional on no project, and the same fixture on `main`'s
harness that day also failed, worse (no router, `record_search` called, the record extracted; $0.84).

Measured 2026-11-02 (PASS then):

```
PASS death-attached-susan-cornwell  expected=none|search-records  first=none  save=ok  delivered=yes  stop=clean
    units: research  extraction_append=0
```

The `delivered=` column was retired with `research_delivered` (PR #4148); the line above is the output as measured.

The router ran, then the main thread called `person_read` and `record_read` on the attached index entry
and answered.

## Starting state

Starting tree: `person_read` of K8TG-N4H with relatives and sources, snapshotted 2026-11-02 through
`e2e.author`'s `fetch_person_read`, `normalize_tree` and `living_gate(drop_living=True, heuristic=True)`,
with no schema errors (`author snapshot` writes only under `eval/tests/e2e/`, so the same calls were made
directly). `starting-research.json` has the objective set and no questions, plans, log entries or sources.

## Caps

`wall_clock_seconds: 1200`, `tool_calls: 60`, `max_turns: 60`: a lookup. The measured run used 6 tool
calls. `max_cost_usd: 3` only labels a run (spec §6).

## Cost

Measured 2026-11-02: $0.59 (`usage.whole_run_cost_usd_estimated`), `claude-sonnet-4-6` at effort `high`.
One run.
Measured 2026-11-16: $0.44, `claude-sonnet-4-6` at effort `medium`, in the panel run.

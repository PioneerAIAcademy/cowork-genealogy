# mid-research-flynn-1870-census

`mid-research-flynn` plus **one added plan item**: `pli_007` — a *planned* 1870
census search of Schuylkill County, appended to `pl_002` (question `q_001`).
Everything else — questions, log, sources, assertions, person evidence,
conflicts, hypotheses, timelines, proof summaries, and the whole GedcomX tree —
is identical to the base scenario. Read `../mid-research-flynn/README.md` for
all of that; only the delta is documented here.

## Why this variant exists

`ut_search_records_002` asks the skill to *"search the 1870 census for Patrick
Flynn in Schuylkill County."* Against the base scenario there is no plan item
for an 1870 census — the census items are 1850 (`pl_001`, completed) and 1860
(`pli_004`, completed), and the only item overlapping 1870 is `pli_006`, which
is **probate**. So the request had no plan behind it and the skill executed it
as an ad-hoc search.

Once `search-records` routes an unplanned request to `research-plan` instead of
searching ad-hoc, that setup makes 002 unrunnable: the skill would (correctly)
hand off before searching, and 002's actual subject matter — collection-mismatch
triage, `outcome: "partial"` rather than `"negative"`, and writing the sidecar
when results *are* returned — would never be exercised.

`pli_007` gives the request a plan to be accountable to, so the search is
legitimate and 002 goes on testing what it was written to test.

## Why a copy rather than editing the base

`mid-research-flynn` is the suite's workhorse: **138 tests across 20 skills**
start from it. Appending a plan item there would change the starting state for
every one of them, invalidating their run logs and risking behaviour shifts in
tests that never asked for an extra item. Copying is the established pattern
here — `-stale-plan`, `-bad-enum`, `-broken-fk`, `-1880-found` and a dozen more
are all single-tweak variants of this base, most serving one test.

## Delta from the base

| | base | this variant |
|---|---|---|
| `pl_002` items | pli_004, pli_005, pli_006 | + **pli_007** (census, 1870, `planned`) |
| everything else | — | unchanged |

## Used by

- `eval/tests/unit/search-records/negative-no-match-results.json`
  (`ut_search_records_002`)

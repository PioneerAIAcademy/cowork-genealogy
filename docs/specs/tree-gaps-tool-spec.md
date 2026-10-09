# Tree Gaps Tool — Implementation Spec

## Overview

An MCP tool that surveys a person's FamilySearch tree for **holes** — places
where the tree is thin and FamilySearch probably holds records that would fill
it. It runs **before** any research project exists, so it takes no
`projectPath` and writes nothing. The `tree-survey` agent (a separate agent)
calls it, checks what FamilySearch holds for the strongest holes, and suggests
3–5 people and research questions; the user picks one and `init-project` takes
that person and question as its objective.

Requires authentication (OAuth tokens from the `login` tool). Reads
`GET /platform/tree/ancestry` and `GET /platform/tree/descendancy`, plus the
cached collections catalog `collections_search` already uses.

It returns **the holes it computed, not the tree.**

```
tree_gaps({ personId?, ancestorGenerations?, descendantGenerations?, maxHoles? })
  → { root, gaps[], scanned, notes[] }
```

## Probe evidence (`dev/probe-descendancy.ts`)

Measured 2026-10-09 against two live roots. The numbers below are in the probe
header; re-run it before changing a limit.

| Question | Finding |
|---|---|
| Descendancy depth | `generations` ≤ **4**; 5 returns 400. Nothing in the repo called this endpoint before. |
| Ancestry depth | ≤ **8**; 9 returns 400. |
| Vitals on each person | Every person carries `living` and a `display` block. Birth date/place appear in `display` only with `personDetails=true`; so do death date/place and marriage date. |
| Structure | Descendancy relationships are `Couple` only, and may name a person absent from `persons[]`. Parentage is in `display.descendancyNumber`: `1.2.3` is the third child of `1.2`; `1.2-S1` is a spouse of `1.2`. Ancestry gives `ascendancyNumber` (Ahnentafel). |
| Latency | Descendancy 0.26–0.36 s per call. Ancestry at 8 generations: 144 persons in 1.6 s. |
| Coverage data | All 3,622 catalog entries carry `searchMetadata.typeFacet`, `startYear`/`endYear`, `placeIds`, `recordCount`. No new endpoint is needed. |

Live runs of the finished tool: LZJW-C31 (large tree) 21–25 s with 9 descendancy
reads and ~1,100–1,700 persons; a small personal tree 6 s with 16 reads.

## Decided (lead, 2026-10-09)

- Walk **8 generations up and 4 down**, both **configurable**, with an **early
  exit** once enough targets are found (`maxHoles`).
- Coverage comes from the **collections catalog**, filtered by place, period and
  record type.

## What it reads

1. **Ancestry**, one call: `generations=ancestorGenerations`, `personDetails=true`.
2. **Descendancy** with `personDetails=true`, anchored so each read's levels meet
   the next one's:
   - the **root** with `descendantGenerations` levels (the root's own
     descendants), then
   - the ancestors at depth `A`, `A−4`, … (`A` = `ancestorGenerations`), each with
     `min(4, depth)` levels. A read from an ancestor 4 levels up reaches the root's
     generation, so it returns the direct line's siblings and their lines without
     one call per couple. With the defaults the anchors are depths 4 and 8.

The tool does not use `person_read` (too heavy to walk a tree) and does not use
`person_ancestors`' `descendants=true` (it drops people with no ascendancy number).

### Reads, time and early exit

Cowork cuts every MCP call at 60 s. The tool stays inside it by design, not by
raising the timeout:

- At most **60** descendancy reads, run with `mapWithConcurrency` (6 at a time).
- A **40 s** time budget; reads not started by then are skipped and the result
  says so (`stopReason: "timeBudget"`).
- The catalog is fetched in parallel from the start and waited on for at most
  15 s; if it is late the holes are returned with `coverage: null` and a note.
- **Early exit.** Waves run nearest the root first. The **near tier** — the root's
  descendants and every anchor within 4 generations — always runs: its holes
  outrank anything farther out, and a pedigree edge alone can hold `maxHoles`
  holes. The **far anchors** (depth > 4) are skipped once `maxHoles` holes
  (not counting `no_death_date`, which is filler) are in hand
  (`stopReason: "maxHoles"`).

## Input

| Field | Type | Default | Notes |
|---|---|---|---|
| `personId` | string | the logged-in user | As `person_ancestors`. |
| `ancestorGenerations` | integer 1–8 | 8 | |
| `descendantGenerations` | integer 0–4 | 4 | 0 skips the root's descendants. |
| `maxHoles` | integer 1–50 | 20 | Also the early-exit threshold. |

Out-of-range values throw; they are not clamped.

## Hole types

The thresholds are named constants in `src/utils/tree-gap-detect.ts`; **a
genealogist sets them**. The values below are proposals pending that review.

| Type | Fires when | Search range | Place |
|---|---|---|---|
| `missing_parents` | A deceased ancestor **short of the cap** has no father and/or no mother in the pedigree. At the cap the endpoint never returns parents, so absence there is unknowable and is not reported. | birth year −1 … +3 | birthplace |
| `no_children` | A deceased couple (exactly one spouse) whose children were read, with none. Needs the mother's birth year, or a marriage year. The window must be ≥ `MIN_WINDOW_YEARS` (4). | the mother's fertile window: `max(mb+15, marriage)` … `min(mb+45, her death, his death+1)` | marriage place, else mother's birthplace |
| `child_gap` | Consecutive known births more than `CHILD_GAP_YEARS` (4) apart while the mother was 15–40 at the earlier one. | earlier+1 … later−1 | marriage place, else mother's birthplace |
| `early_last_child` | The last known child was born when the mother was under `EARLY_LAST_CHILD_AGE` (34), she lived to ≥ 40, and the window to age 45 / her death / his death is ≥ 4 years. | last+1 … end of window | as above |
| `no_spouse` | A deceased person who died at ≥ `NO_SPOUSE_MIN_DEATH_AGE` (25) and has no spouse in the tree. | birth+18 … death | birthplace |
| `no_death_date` | `living` is false and no death date. | birth … birth+90 | birthplace |

The mother of a family is the person if female, else the single spouse if
female; with a man and several spouses the mother is unknown and the
interval-based types are skipped (the endpoint does not say which spouse a child
belongs to). Children are judged only when some read actually listed them: a
person at the bottom level of a descendancy read is a leaf, and its empty child
list means *not read*.

**Living people.** A hole is never reported on a living person, and never on a
couple when either spouse is living. A missing `living` flag is treated as
living. The tool still reads through living people to reach the ancestors behind
them. A living root whose descendants are all living yields no holes.

## Output

```ts
{
  root: { personId, name },
  gaps: [{
    type,                       // one of the six above
    personId, name,
    spouseId?, spouseName?,     // couple-level holes
    lifespan,                   // FamilySearch's string, e.g. "1809-1865", or null
    generation,                 // signed from the root: + above, 0 same, − below
    detail,                     // plain words
    yearRange: {start,end}|null,
    place: string|null,
    coverage: {collections, records, recordTypes[]}|null
  }],
  scanned: { ancestorGenerations, descendantGenerations, persons,
             descendancyReads, stoppedEarly, stopReason },
  notes: string[]
}
```

`generation` is `anchor depth − steps down`: a direct ancestor at depth 3 is `3`,
the root's sibling is `0`, the root's child is `−1`.

**Selection.** Holes are sorted nearest the root first, then picked
**round-robin across types** so one common type (`no_spouse`) cannot fill the
answer; `maxHoles` of them are returned, nearest first.

## Coverage

For a hole with a place and a year range, `coverage` counts catalog collections
that (a) match the place's collection scope — the same title match
`collections_search` uses (US state, `Country, State` for Canada/Mexico,
country elsewhere), (b) overlap the year range, and (c) carry a record-type
facet that could hold the record:

| Hole | Facets |
|---|---|
| `missing_parents`, `no_spouse` | `VITAL`, `CHURCH_RECORD` |
| `no_children`, `child_gap`, `early_last_child` | `VITAL`, `CHURCH_RECORD`, `CENSUS` |
| `no_death_date` | `VITAL`, `CHURCH_RECORD`, `CENSUS`, `NEWSPAPER` |

`coverage` is `null` when the hole has no place or no year range, or when the
catalog was unavailable. **It is a floor, not a verdict:** the catalog counts
collections that exist for the jurisdiction, not records indexed for this
person. The agent confirms with per-person checks (hints, `record_search`).

**Not done:** the lead's example URL filters by `placeId`. The catalog carries
`searchMetadata.placeIds`, but matching them needs the place's ancestry chain
(county → state → country), so v1 reuses the title-scope match. A placeId
filter is a refinement, not a requirement.

## Errors

LLM-actionable, as `person_ancestors`: 401 → call `login`; 403/404/410 → the
person is restricted / not found / deleted; 429 → wait and retry; 400 → the
upstream message. A root that cannot be read fails the call. A failed
descendancy read from an ancestor anchor is skipped and counted in `notes` (that anchor adds no
holes); a failed read of the root's own descendancy fails the call.

## Not in scope

- Reading a project, writing `research.json` or the tree.
- Ranking by record availability across the person (the `tree-survey` agent's
  job).
- Holes on living people.
- Merged-person redirects (a 301 on ancestry is surfaced as an error).

## Files

`src/tools/tree-gaps.ts` (fetch, budget, coverage), `src/utils/tree-gap-detect.ts`
(pure detection), `src/types/tree-gaps.ts`, `src/tools/collections-search.ts`
(`collectionCoverage`), `dev/probe-descendancy.ts`, `dev/try-tree-gaps.ts`,
`tests/utils/tree-gap-detect.test.ts`, `tests/tools/tree-gaps.test.ts`,
`eval/fixtures/mcp/tree-gaps-*.json`.

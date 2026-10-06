# survey-surname agent spec

## Purpose

Tabulate every household of a surname across a place's US federal censuses.
The agent searches each census year in a given span, stages results, groups
stubs by household, and writes a markdown table sectioned by census year.

## Scope rule

The agent searches at state level by default. It passes the state as
`recordCountry: "United States"` + `recordSubdivision: "<State>"`. A county
narrows further with `residencePlace: "<County>, <State>, United States"`.

Results are staged: the agent passes `projectPath` to `record_search`, so
rows come back as staged stubs (~400-540 B each). The search log is the
agent's one `research.json` write (via `research_log_append`), and the tree
is untouched.

## Per-year threshold: 600 `totalMatches`

The agent reads `totalMatches` on each census year's first page. When a year
exceeds 600 matches, the agent fetches no more pages for that year. Instead
it reports the count and asks the user which counties to survey for that
year.

**Why 600:**
- Clears Dixon 1840 in Virginia (441) with ~35% headroom.
- Stops Dixon 1850 in Virginia (2,218).
- Caps one year at ~230 KB of stubs.
- 500 was considered too close to 441 on an index that moves.
- 1,000 was considered too high: three such years is ~1.1 MB, the size the
  ruling rejected.

**Re-measure command** (from `packages/engine/mcp-server/`):
```
npx tsx dev/try-record-search.ts Dixon --country "United States" --subdivision Virginia --residence-year <y> <y> --type census --count 1
```
Read `totalMatches` from the response. Measured 2026-09-29: 1820: 366,
1830: 407, 1840: 441, 1850: 2,218. If the numbers have moved, move the
threshold rather than the rule.

## `recordArk` grouping

Stubs are grouped by `recordArk` (the 1:2: record ARK, which identifies a
household). For 1790-1840 every stub is its own household (only the head of
household is named). For 1850+ multiple stubs can share a `recordArk` (each
named person in the household is a separate stub).

Measured 2026-09-29: 100 rows of 1850 Virginia yielded 81 distinct
`recordArk` values.

## Table columns

One row per household:
- Census year
- County (extracted from `events[].place`, e.g. "Wheeling, Ohio, Virginia,
  United States" yields county "Ohio")
- Head of household (`personName` where `role` is Principal)
- Other members carrying the surname, with `birthDate` where the stub has one
- Record ARK (`recordId`)
- Ruled out (empty by default; filled only with reasons the delegation carries)

## Schedule sectioning

Sections are ordered by census year, and within a year by collection title
(from the response's `collections` map). `recordType: census` also returns
non-population schedules. For example, 1850 Virginia includes "United States,
Census (Slave Schedule), 1850". Non-population schedules go in their own
sub-section, never merged into households.

## Out of scope

- Writing to the tree or to `research.json` beyond the search log.
- Linking households across census years.
- Spelling variants beyond what `record_search`'s fuzzy surname matching
  already provides.
- Ruling out households on its own (the `Ruled out` column is filled only
  with reasons the delegation carries or the user later edits in).

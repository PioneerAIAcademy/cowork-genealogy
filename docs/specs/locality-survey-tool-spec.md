# `locality_survey` — tool spec

> **Status:** Live (issue #4602). `src/tools/locality-survey.ts`; types in
> `src/types/locality-survey.ts`; tests in `tests/tools/locality-survey.test.ts`.

## 1. What it does

One call runs locality-guide's whole records survey for one place and period and returns one
answer under the tool-result budget. It replaces the six calls the agent made by hand
(`place_population`, `collections_search`, `volume_search`, `catalog_search`,
`external_links_search`, `wiki_place_page` ×4) and the constructed-URL `{Jurisdiction}_Vital_Records`
read. locality-guide holds this tool and none of the six.

**Why.** An instruction to make a call is the first thing a cheaper model drops. On Haiku 5.5 at
low, the most common hard failure of the locality-guide suite was a survey that skipped calls
(issue #4602, 29 tests × 3 on 2026-11-15: 9 pass, 61 partial, 17 fail). One call cannot be
half-made.

## 2. Input

`{ standardPlace, startYear?, endYear?, projectPath? }`

- `standardPlace` — the place as delegated, from `place_search`. A trailing ` (Type)` is kept
  for the calls that resolve the place (`Halifax, Nova Scotia, Canada (Independent City)`); every
  level, wiki slug and climb is built from the **place name**, the string without it.
- `startYear`, `endYear` — whole years; `endYear` ≥ `startYear`.
- `projectPath` — stages the whole answer and stores the outside links (§6).

## 3. The calls

`surveyCallPlan(input)` (exported) lists every call the survey could make, climbs included; each
depends only on the input. The survey stops each ladder at its first hit.

| part | call | levels |
|---|---|---|
| `population` | `populationTool` | the place, then each parent; first with data |
| `collections` | `collectionsSearchTool` (with the years) | the place name |
| `volumes` | `volumeSearchTool({ summary: true })` | the place, and its parent (below) |
| `catalog` | `catalogSearchTool` | the place; on `totalHits: 0`, once, the text after its first comma |
| `externalLinks` | `externalLinkRows` (factored out of `external_links_search`) | the place, and its parent (below) |
| `wikiPages.home` | `findPlacePage(home)` | the place, then each parent; first found |
| `wikiPages.{getting_started, online_records, research_tips}` | `findPlacePage` | the two-part state/country level, then the country |
| `vitalRecords` | `fetchPage` by slug | `{J}_Vital_Records`, then `{J}_Civil_Registration`; J the two-part level's leaf, then the country |

**The parent level** (lead, 2026-11-19). `volume_search` returns only volumes filed at the exact
place, so a city misses its county's series (Detroit's probate under Wayne County) and a village
search alone misses its region's. `external_links_search` follows the hierarchy of the place id it
resolves to, not the text parent: `Halifax, Yorkshire, England, United Kingdom (Town)` returns no
Yorkshire rows, and `yorkshirebmd.org.uk` comes only from `Yorkshire, England, United Kingdom`
(probed 2026-11-19). Both therefore also run at the parent (the place name after its first comma),
unless the parent is a country (one comma part) or the place is county level or larger by its Places
API type (`placeTypeOf`: County, Parish, Borough, Census Area, State, Province, Territory, Country,
Nation, Kingdom, Commonwealth, Region, Department, District, Governorate, Oblast, Canton). An Irish
or English `Civil Parish` is not a county; Louisiana's `Parish` is. An unknown type keeps the parent.
The type lookup waits at most 8 s.

**Section pages at the state level.** `getting_started`, `online_records` and `research_tips` exist
only for a state or a country (`findPlacePage` reads them only at `parts.length <= 2`), so the
survey asks there directly rather than climbing from a city.

**A state-level topic page** (`{J}_Vital_Records`) is refused when its breadcrumb names a place
outside the delegated one (`topicPageNamesOtherPlace`: `Georgia_Vital_Records` is the US state's,
not Tbilisi's). A page with no breadcrumb names none.

## 4. Deadline and outcomes

One clock of 50 s (`SURVEY_DEADLINE_MS`; the Cowork bridge aborts a call at 60 s); the Legacy-notice
lookups stop 5 s before it. Each part, and each level of `volumes` and `externalLinks`, settles on
its own:

- a value — the part;
- a thrown error — `{ error }`, the resolver's "retry with a (Type)" advice removed;
- still running at the deadline — `{ error: "timed out" }`;
- a page missing at every level — `found: false`, no `outcome`;
- a page whose read threw or timed out — `found: false, outcome: "unreachable"`.

A failed parent level never costs the place's own level or `volumeSummary`.

`pagesRead` is `localities.pages_read` for the four sections. A page found keeps `found: true` and
its url even when every section was left out. `volumeSummary` is `localities.volume_summary`, the
place's own level's summary in snake_case with the years searched, or null when that level failed
or had no summary.

## 5. Size

The answer, measured as compact `JSON.stringify` (as `server.ts` sends it), fits
`TOOL_RESULT_CHAR_BUDGET` (40,000). Measured on the 7 e2e runs from 2026-11-17 on, after every
survey tool's own cut, one survey's parts sum to about 110,000 at the median (wiki sections 34,000,
vital-records page 25,000, outside links 32,000, the rest 20,000).

- **Data parts**, 12,000: collections 2,500, volumes 3,000 (split over the levels), catalog 3,000,
  outside links 3,500. Each says how many rows it `omitted`. Collections sort by person count
  (the call already keeps only those overlapping the years); outside links by how many of the
  template's record types they cover, then whether they overlap the years, then the most specific
  place; catalog hits as the tool returns them; volumes as each level's summary and first page,
  deduplicated across levels by `imageGroupNumber`, the place's own level first.
- **Wiki text**, the rest: `40,000 − JSON.stringify(answer with every page's content empty)`, less
  the names of every heading a page could leave out. The vital-records page goes first, up to 8,000.
  The other pages are split at their `#`–`###` headings and filled best-first: a page's opening and
  its record-type sections share the top rank, other sections the next, skip-list sections never;
  no one section takes more than 6,000; a section larger than the room left is cut at a line end and
  marked `[cut at offset N of <url>; wiki_read it with offset N to read on]`. Each page is one
  `content` string in page order, beside `url`, `found`, `totalChars` and the `omitted` headings.
- A final fit loop re-ranks into a smaller share, then drops the data parts' last rows.

**The heading lists** were measured, not guessed. Over the 336 pages 151 saved e2e guides read
(5,562 sections; a section counts as used when it shares a run of six words with the guide):
skip-list sections held 4.4% of the page text and 0.4% of the text guides used; record-type headings
were used in 16.7% of their appearances against 3.6% for the rest; page openings held 48% of the text
and 70% of the used text. Replayed at a 28,000-character share, the guides' matched phrases kept rose
from 22.7% (first lists) to 34.4%, and used sections kept from 24% to 56%.
`dev/probe-wiki-section-use.py` and `dev/replay-wiki-section-rules.py` reproduce both.

## 6. With a project

- The whole answer, untrimmed, is staged as `{ query, results: [answer] }` through
  `stageSearchResults`, and `staged.resultsRef` returned. `research_append` takes it as
  `surveyRef` on a `localities` write and writes `pages_read` and `volume_summary` from it
  (`research-append-tool-spec.md` §5.14). A staging failure is `stagingError`.
- Each outside-links level is stored with its own rows (one `recordExternalCollections` call per
  level, under the string that level fetched with), only when it settled inside the deadline. The
  cross-level dedup applies to the answer only: storing deduplicated rows would replace a shared
  parent's entry with a partial list.

## 7. The eval mock

`locality_survey` is live in every suite (`LIVE_TOOLS`). `_make_locality_survey_handler`
(`eval/harness/harness/mock_mcp.py`) asks the compiled `surveyCallPlan` for the calls, answers each
from the test's own per-tool fixtures, and runs the compiled `runLocalitySurvey` over them; a wiki
read matched only by the bare `"~"` catch-all is a missing page, so the vital-records ladder reaches
a test's own `_Civil_Registration` fixture. One call is logged, with `survey_parts` naming the
fixture that answered each sub-call.

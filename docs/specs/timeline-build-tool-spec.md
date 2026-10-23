# `timeline_build` — person timeline tool — Spec

Built from `docs/plan/attached-records-baseline.md` (§ PR C, "The census table"
and "`timeline_build`").

## 1. Why this exists

A person's timeline was built by the timeline agent: read every linked
assertion, standardize places, measure distances, read each country's census
schedule from the wiki, write the timeline. That took 66–135 s per subject in
unit runs, and a /research job now builds one per subject before its first
question. Every step of it but the judgement is mechanical, so `timeline_build`
does those steps in code: the timeline agent's Mode A Steps 2–4 and 7. The agent
keeps travel feasibility, chronology anomalies and hypothesis timelines (Mode B).

Two rules shape it:

- **A timeline is never built from tree facts** (decision 1). Events come only
  from live `person_evidence` links (`superseded_by` null). A tree fact with no
  link becomes no event.
- **Census years come from a table in code, never the catalog** (decision 14). A
  census gap means FamilySearch likely holds a record that could be attached and
  is not, and a false `high` gap is worse than a missed one.

## 2. Callers

- The /research job, once per subject after `extraction_append({ personId })`
  and before the first question-selection (PR D).
- "Create a timeline for <PID>", a bounded ask (PR D).
- The timeline agent's Mode A, and Mode C on a person timeline (PR D).

## 3. Inputs

| Field | Type | Required | Notes |
|---|---|---|---|
| `projectPath` | string | yes | The project holding `research.json` and `tree.gedcomx.json`. |
| `personId` | string | yes | A tree person id, or the FamilySearch id a tree person's `ark` links to (`findAnchor`). |

The exported function also takes injectable `deps` for tests and the harness:
`resolvePlace` (place text → standard place), `placeCoords` (standard place →
coordinates), `now`, and `deadlineMs`. No tool caller can set them.

## 4. The rules

### 4.1 Events

- One event per (record, party, event type, date), where the party is the
  assertion's `record_persona_id`, else its `record_role`. Every assertion that
  makes or joins it is in `assertion_ids`, so one record's death and burial stay
  two events.
- Event types are timeline.md Step 3's, mapped from the normalized `fact_type`
  (`christening` → `baptism`, `census_residence` → `residence`, `census` →
  `census`, …). A `fact_type` with no event type (`relationship`, `name`, `age`,
  `occupation`, …):
  - dated, joins the same record and party's event with the same date (the
    first in Step 3's type order when two qualify), else makes an `other` event;
  - undated, makes none.
- An undated assertion with an event type joins the same record, party and
  type's event, else makes none. Code extraction splits a derived birth into a
  place half and a date half (`record-extract.ts`); this joins them.
- `standard_place` is copied from the event's assertions; when none carries one,
  each distinct `place` text is resolved once.
- `distance_from_previous_km` is the haversine distance between consecutive
  events' standard places (0 for the same place), each place looked up once;
  null when either place or its coordinates is missing.
- An event every one of whose links is `speculative` starts its description
  "Unverified attachment:" when every link is an attachment link
  (`isAttachmentLink`: the fixed rationale, speculative, no score), else
  "Unverified:".

### 4.2 Dates

Written year-first: `YYYY`, `YYYY-MM` or `YYYY-MM-DD`, from `stdDate` then
`parseStdDate` (`date-helpers.ts`), which strips a trailing `(?)` first.

| Std date | Written | Certainty |
|---|---|---|
| `1850`, `Mar 1860`, `12 Mar 1908` | `1850`, `1860-03`, `1908-03-12` | the assertion's, else `exact` |
| `Abt 1845` | `~1845` | `approximate` |
| `Est 1845` / `Cal 1845` | `1845` | `estimated` / `calculated` |
| `Bef 8 Feb 1890` / `Aft 1850` | `1890-02-07` / `1851`, with "(before …)" / "(after …)" in the description | `estimated` |
| `Bet 1836 and 1848` | `1836-1848` | `estimated` |
| `9 Mar 1878 or 3 Sep 1878` | the earlier, `1878-03-09`, with "(or …)" | `estimated` |
| `Q2 1850` / `1623/24` | `1850-04` / `1624` | as above |
| `""` (unparseable) | undated | — |

A stored certainty of `before`, `after` or `between` is written `estimated`
(the event schema refuses them); `approximate` adds the `~`. The record's own
wording stays in `description`. Events sort by the date string with a leading
`~` ignored, the timeline suite's `_event_sort_key`.

Each event also keeps the span of years its date allows (`earliestYear`,
`latestYear`, and whether each side is unbounded); an assertion certainty of
`approximate`, `estimated`, `before` or `after` widens it when the date string
carries no modifier. The gap rules judge on that span, never on the written
point.

### 4.3 Conflicts

- **Resolved with a winner** (`resolution_kind: "competitor"`, or no kind and a
  `preferred_assertion_id`): the other competing assertions make no event; the
  preferred assertion's event carries the conflict id.
- **Resolved without one** (a deferral, `tree`, `synthesis`): nothing dropped;
  marked as unresolved, with the note quoting `resolved_value`, else
  `resolution_rationale`.
- **Moot:** marks nothing.
- **Unresolved:** every event citing a competing assertion carries the id. A
  competing assertion on no event (a name-only identity conflict) marks each
  event built from its record and `record_role`. The note quotes an identity
  conflict's `identity_question`, else names the competing assertions and their
  values.

On 2026-10-21, 13 of the 71 resolved conflicts in the 213 committed e2e final
states named no preferred assertion (12 with no kind, 1 `synthesis`).

### 4.4 Gaps

`start` and `end` are copied from the bounding events and never padded. No gap
has an empty `expected_events`. No census, marriage or 20-year gap starts at or
after the earliest linked death or burial, and no census year is expected at or
after the earliest year that event allows. When its earlier side is open
("before 1880"), that is the latest year any event before it allows.

- **Census, `high`.** Between consecutive placed events A and B, year Y is
  expected when it falls after every year A allows and before every year B
  allows (an unbounded side expects nothing), one census-table row of year Y
  covers both A's and B's places, and no event's span is exactly Y. A heads-only
  row is expected only for a male whose latest possible linked birth year makes
  him 21 or older in Y and whose linked marriage ends before Y; with no linked
  birth or marriage, or a birth or marriage open on its later side, never. Such
  a schedule names only household heads, and a man of 21 was often not yet one;
  a missed gap is better than a false one (lead, 2026-10-23). Each entry reads
  `"<year> <label> census"`, the national row's label when a national and a
  state row both cover Y. Before the write, each entry is tested with
  `timelineCensus1890Invariants`; a refused one is dropped and noted.
- **Twenty or more years, `high`.** Between consecutive events. When both lie at
  or between one census gap's bounding events, it folds into that gap as a final
  "residence"; otherwise it is its own gap naming "residence".
- **Marriage, `high`.** A child of the person is another persona in one of the
  person's linked records with a `relationship` assertion whose
  `structured_value.relationship_type` reads as child (not `_inferred`) and whose
  `related_person_role` is the person's own role there. The first child's birth
  is that persona's own `birth` assertion in the record (not linked to the
  person). A gap when no linked marriage can precede it; an undated linked
  marriage can precede any child, so it gives none. `start` is the person's
  latest event before the birth, `end` the record's first event that can follow
  it (in a census, the person's own age-derived birth comes earlier and is
  skipped).
- **Death without burial, or burial without death, `medium`.** `start` = `end` =
  the date of the one present. A linked assertion of the other type counts as
  present even when undated.

### 4.5 The census table

`src/data/census-table.ts`, a typed constant. One row per census collection-year
a FamilySearch index covers: `year`, `label`, `covers` (every standard-place
suffix the area takes, since Places names change with the era — "Kent, England"
before 1801, "Kent, England, United Kingdom" after), `collectionId`,
`headsOnly`. A row covers a place when one of its `covers` is a whole-segment
suffix of it.

Rows hold only population censuses: no school, church, mortality, veterans,
Native American, electoral or poll-tax collections. The year comes from the
collection's title, and a title naming a range gives no row. A collection whose
indexed records are under 75% of that census's population (of households, for
a heads-only schedule) gets no row, and a partial national index lists only
the areas known covered (US federal 1790–1880 rows list their states). City
censuses have no rows yet. Rows were sought in North and South America, Europe
and Australia; Australia has none. A
named fragment list stays out: US 1890, Ireland 1821–1851, New
South Wales 1841.

A place no row covers is named in the summary as unchecked: its country, or its
first-level subdivision when the table covers that country elsewhere, or
"places given only as <country>". `dev/check-census-table.ts` checks every row
against the live catalog.

What the live catalog showed on 2026-10-21 and 2026-10-22:

- Record counts do not separate fragments from full censuses: US 1790 is 0.26%
  of the US maximum and the US 1890 veterans schedule 0.55%, while Ireland 1821
  is 6.27% and England and Wales 1851, a partial index, 4.09%.
- 91 census-titled collections with records span several years in their
  metadata, including Mexico National Census 1930 (1929–1931), so a filter on
  single-year metadata misses them.
- The filing place is not the coverage: about ten French département censuses
  are filed under France's id, and Canada's national 1871–1911 censuses each
  under one province.

### 4.6 Budget

One deadline of 50 s, under Cowork's 60 s per-call cap. Raw-place resolution
and coordinates for already-standard places start together; coordinates for
newly resolved places follow within what remains. A lookup still open then
answers null, and `summary` names the checks it skipped.

## 5. Output

```
{ ok: true, status: "written" | "updated", timelineId, events, unverifiedEvents,
  gaps: { high, medium, low }, summary }
{ ok: true, status: "no_linked_evidence",
  summary: "No record yet places this person; no timeline was written." }
```

`summary` is one code-written passage the caller relays: the event count, how
many come from records nobody has checked, the `high` gaps, that checking the
attachments is a separate request, that census years are those FamilySearch has
indexed, and every place or country for which no census was checked.

**The write.** Through `researchAppend` with `allowedSections: {timelines}`.
The person's timeline is one with no `hypothesis_id` and exactly one
`person_ids` entry that resolves to the anchor (a FamilySearch id there matches;
a stale one does not, and does not crash). None: append. One or more: update the
newest in place, restamping `generated` and keeping its `person_ids`, and name
the others in `summary`. The choice is re-checked on `research.json` as read
under the writer's lock (`researchAppend`'s `precondition`); when a person
timeline was written or restamped since the first read, the choice is made
again, at most three times. A
hypothesis or multi-person timeline is never touched. Ownership: the
`timelines` row of `ownership.json` (`toolAuthorized`).

## 6. Errors

- `projectPath` missing or naming no directory, or one project file missing or
  unparseable: `{ ok: false, errors }` naming it. A folder holding neither file:
  `noProjectResult("write")`.
- `personId` missing, or naming no tree person: `{ ok: false, errors }`.
- A write `research_append` refuses: its `{ ok: false, errors }`, and nothing
  written.
- `no_linked_evidence` is `ok: true`.

## 7. Not in scope

- Hypothesis timelines (Mode B), travel feasibility and chronology anomalies —
  the timeline agent's.
- The military and immigration gap rules (Mode B only).
- Verifying attachments: a separate request, which runs person-evidence.
- Reading the catalog or the wiki.

## 8. Measured

`dev/try-timeline-build.ts <fixture> <personId> --extract`, live Places, on
2026-10-22:

| Fixture | Records extracted / links | Events | Cold | Warm |
|---|---|---|---|---|
| william-sloan-spouse (LHG6-L26) | 20 / 119 | 25 | 1,075–1,302 ms | 44–47 ms |
| joao-sousa-death (GLRZ-VRK) | 16 / 67 | 6 | 50 ms | 45 ms |

The cold time is the Places lookups for places the assertions did not
standardize; the warm rerun updates the timeline in place.

## 9. Files

- `packages/engine/mcp-server/src/tools/timeline-build.ts`, `src/types/timeline-build.ts`
- `packages/engine/mcp-server/src/data/census-table.ts`
- `packages/engine/mcp-server/tests/tools/timeline-build.test.ts`, `tests/data/census-table.test.ts`
- `packages/engine/mcp-server/dev/try-timeline-build.ts`, `dev/check-census-table.ts`
- Harness: `_make_timeline_build_handler` in `eval/harness/harness/mock_mcp.py`

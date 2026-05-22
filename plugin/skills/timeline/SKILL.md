---
name: timeline
model: claude-sonnet-4-6
description: Builds candidate timelines (written to research.json) from assertions, surfaces gaps and
  chronological impossibilities, and supports identity-testing by checking
  whether records cohere into one life. GPS Step 3 — Analysis and
  Correlation (chronological analysis). Use when the user says "build a
  timeline", "show me the timeline", "what's the chronology?", "test
  whether these records are the same person", "do these events fit one
  life?", "build a candidate timeline for [hypothesis]", "what's missing
  in the timeline?", "find gaps", after new assertions are linked to a
  person via person-evidence, or when the user wants to visualize a
  person's documented life. Do NOT use when the user wants to resolve a
  conflict between sources (use conflict-resolution), wants to link
  assertions to persons (use person-evidence), or wants to write a
  conclusion (use proof-conclusion).
allowed-tools:
  - place_search
  - place_distance
  - validate_research_schema
---

# Timeline

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

Builds chronological timelines from assertions linked to persons.
A timeline is the primary **correlation tool** — it arranges events
from multiple independent sources in chronological order to:

1. **Correlate:** Surface agreement/discrepancy patterns across sources.
2. **Detect gaps:** Find undocumented periods where records should
   exist (negative evidence — see `references/timeline-analysis-guide.md`).
3. **Test identity:** Determine whether records cohere into one
   plausible life or reveal conflated identities.

## Key design principle

Timelines are keyed by a unique ID with a label, NOT by person ID.
This supports building **candidate timelines** for identity
resolution — testing whether records from different sources cohere
into one person's life.

A timeline labeled "John Smith assuming Augusta = Rockingham" can
aggregate person_ids from two different GedcomX persons that might
be the same individual. If the events fit one life without
impossibilities, that's evidence supporting the merge.

## Steps

### 1. Determine what to build

Three modes:

**Mode A — Person timeline:** Build a timeline for a specific
GedcomX person. Gather all assertions linked to this person via
person_evidence entries (where `superseded_by` is null).

**Mode B — Hypothesis-testing timeline:** Build a timeline that
tests a specific hypothesis. Gather assertions linked to ALL
persons in the hypothesis (e.g., two persons that might be the same
individual). Set `hypothesis_id` on the timeline.

**Mode C — Refresh:** Regenerate an existing timeline after new
assertions were added. Timelines are regeneratable — replaced
wholesale when regenerated.

### 2. Gather assertions

Read `research.json`:
- Find all `person_evidence` entries for the target person(s)
  where `superseded_by` is null
- Collect the `assertion_id` from each
- Read the full assertion objects

Filter to assertions with date or place information — assertions
without temporal or geographic data (e.g., name-only assertions)
don't contribute to chronological analysis but may be noted.

### 3. Build timeline events

For each assertion (or group of assertions about the same event),
create a timeline event. The goal is to produce a structure
analogous to the standard correlation format:
**Date | Place | Event / People / Relationships | Source | Notes**

```json
{
  "date": "1850",
  "date_certainty": "exact",
  "event_type": "census",
  "place": "Schuylkill County, Pennsylvania",
  "description": "Enumerated age 5 in Thomas Flynn household, dwelling 84",
  "assertion_ids": ["a_003", "a_004"]
}
```

**Sort events chronologically.** For approximate dates (`~1845`),
use the year as the sort key. For ranges (`1840-1850`), use the
start year.

**Combine related assertions into single events.** Multiple
assertions from the same record about the same event should produce
ONE timeline event with multiple assertion_ids. Example: a_003
(residence) and a_004 (relationship) from the 1850 census are
one event — "enumerated in Thomas Flynn household" — not two.

**Event types:** `birth`, `baptism`, `marriage`, `death`, `burial`,
`residence`, `census`, `military`, `immigration`, `emigration`,
`land_transaction`, `probate`, `other`

**Date certainty for timeline events:** Use the subset:
`exact`, `approximate`, `estimated`, `calculated`. Directional
qualifiers (`before`, `after`, `between`) from assertions should
be converted: `before 1850` → `estimated` with date `1849` and a
note; `after 1840` → `estimated` with date `1841` and a note.

### 3.5. Enrich with place data and distances

After building and sorting events, resolve place strings to
FamilySearch place IDs and compute distances between consecutive
events.

**Phase 1 — Resolve places:**

1. Collect all unique non-null `place` strings from the built events.
2. For each unique place string, call the `place_search` MCP tool to
   resolve it to a place ID. Pass the place string as `query` —
   e.g. `place_search({ query: "Schuylkill County, Pennsylvania" })`.
3. If the tool returns one or more results, use the first (best)
   match and write its `place_id` onto all events sharing that
   place string.
4. If it returns no results, leave `place_id` null. Do not retry
   or error.

**Phase 2 — Compute distances:**

1. Walk events in chronological order as consecutive pairs.
2. For each pair where both events have a non-null `place_id`:
   - If the two `place_id` values are the same, set
     `distance_from_previous_km` to `0` (no API call needed).
   - If they differ, call `place_distance` with the two IDs and
     write the result onto the later event's
     `distance_from_previous_km`.
3. Skip (leave `distance_from_previous_km` null) when either event
   lacks a `place_id`.

**Example enriched event:**

```json
{
  "date": "1850",
  "date_certainty": "exact",
  "event_type": "census",
  "place": "Schuylkill County, Pennsylvania",
  "place_id": "325",
  "description": "Enumerated age 5 in Thomas Flynn household, dwelling 84",
  "assertion_ids": ["a_003", "a_004"],
  "distance_from_previous_km": 5400
}
```

### 4. Identify gaps

Analyze the timeline for missing periods. A gap is **negative
evidence** — the absence of expected records carries meaning.

**Gaps as migration clues:** When a person disappears from records
at a known location, the default hypothesis should be "they moved,"
not "the records are lost." Research should broaden geographically.
(See the Eliza Olds pattern in `references/timeline-analysis-guide.md`.)

```json
{
  "start": "1860-01-01",
  "end": "1908-03-12",
  "expected_events": ["marriage", "1870_census", "1880_census", "1900_census", "residence", "occupation"],
  "severity": "high"
}
```

**Gap severity:**
- **High:** Missing a census year where the person should appear
  (alive, in the country, in a state that was enumerated). Missing
  marriage when children exist. Missing 20+ years of documentation.
- **Medium:** Missing one census year (the person may have been
  traveling or the enumeration missed them). Missing occupation data.
- **Low:** Missing minor events (church attendance, tax records)
  in a period where the person's location is established by other
  records.

**How to determine expected events:**
- Census: Every 10 years (1850, 1860, 1870, 1880, 1890, 1900, 1910,
  1920). Note: 1890 census was mostly destroyed by fire.
- Marriage: If children exist, a marriage event is expected before
  the first child's birth.
- Death/burial: If the person is known to have died, both death
  and burial events are expected.
- Military: During wartime (Civil War 1861-1865, WWI 1917-1918,
  WWII 1941-1945), military-age males may have service records.
- Immigration: If born abroad but later in the US, an immigration
  event is expected.

### 5. Identify impossibilities

Check for chronological contradictions that are visible from the
timeline's event sequence. Focus on what the timeline uniquely
reveals — contradictions that only emerge when events are arranged
in order:

```json
{
  "description": "Born in Ireland ~1845 but enumerated in Ohio in 1844",
  "event_1_assertion_id": "a_002",
  "event_2_assertion_id": "a_025"
}
```

**Timeline-visible impossibilities:**
- Events occurring before birth or after death
- Two events in distant locations with insufficient travel time
  (use `distance_from_previous_km` from Step 3.5 and the travel
  speed reference in `references/timeline-analysis-guide.md`)
- Same person enumerated in two different states in the same census
  year (suggests two different persons, not one)

**Impossibilities are strong evidence of identity problems.** If a
timeline built from two candidate persons has impossibilities, the
persons are probably NOT the same individual.

After writing the timeline, invoke `check-warnings` for the full
set of biological and logical checks (parent-child age gaps,
marriage ages, etc.) per the validation protocol.

### 6. Identity-testing analysis

When building a hypothesis-testing timeline (Mode B), evaluate
coherence and report one of three results:

- **Pass:** No impossibilities. Ages progress correctly, locations
  are geographically plausible, and identifying details (occupation,
  birthplace, family members) remain consistent across records.
  Evidence SUPPORTING the hypothesis.

- **Fail:** Impossibilities exist, or identifying details contradict
  (different birthplaces, incompatible ages, different spouse names).
  Evidence AGAINST the hypothesis.

- **Inconclusive:** Events are consistent but too sparse to confirm
  or deny. Consistency alone does not prove identity when the
  profile is thin (name + approximate age may match multiple people).

Report the coherence result to the user. If fail or inconclusive,
suggest `hypothesis-tracking` for next steps.

### 7. Write the timeline

Add or replace the timeline in `research.json` `timelines[]`:

```json
{
  "id": "t_001",
  "label": "Patrick Flynn — assuming Thomas Flynn parentage",
  "hypothesis_id": "h_001",
  "person_ids": ["KWCJ-RN4"],
  "generated": "2026-05-04T16:00:00Z",
  "events": [ ... ],
  "gaps": [ ... ],
  "impossibilities": [ ... ]
}
```

**Regeneration:** If a timeline with this label or person_ids already
exists, replace it entirely. Timelines are regeneratable — they're
cached analysis, not primary data. Set `generated` to the current
timestamp so downstream skills know how fresh the analysis is.

### 8. Validate and present

Call `validate_research_schema({ projectPath: "<absolute-path-to-project-directory>" })`
to verify both research.json and tree.gedcomx.json are valid. If validation
fails, fix the errors before presenting. Then present the timeline:

**Display format:**

```
Timeline: Patrick Flynn — assuming Thomas Flynn parentage
Generated: 2026-05-04

~1845  BIRTH        Ireland (estimated from census ages)
                    [a_002, a_009]
                                                    ── 5,400 km ──
1850   CENSUS       Schuylkill County, PA — age 5 in Thomas Flynn
                    household, dwelling 84 [a_003, a_004]
                                                    ── 0 km ──
1860   CENSUS       Schuylkill County, PA — age 15, listed as "son"
                    in Thomas Flynn household [a_008, a_010]
                                                    ── 0 km ──
1908   DEATH        Schuylkill County, PA — death certificate names
                    Thomas Flynn as father [a_011, a_013]

GAPS:
  1860–1908 (HIGH) — Missing: marriage, 1870/1880/1900 censuses,
  residence, occupation. 48-year gap in documentation.

IMPOSSIBILITIES: None

Coherence: Events form a plausible life in Schuylkill County, PA.
No impossibilities. Large gap 1860-1908 needs investigation.
```

Distance lines appear between consecutive events when both have
resolved place IDs. Omit the distance line when either event has
no resolved place. Show `0 km` for same-place consecutive events
— this confirms the person stayed in the same location.

Suggest next steps:
- Gaps identified → "The 1860-1908 gap is high severity. Would you
  like me to select a question to fill it?" (question-selection)
- Impossibilities found → "This timeline has contradictions —
  these records may not be the same person. Would you like me to
  investigate?" (conflict-resolution or hypothesis-tracking)
- Hypothesis test complete → "The timeline is coherent — this
  supports the hypothesis that [claim]." or "The timeline has
  impossibilities — this contradicts the hypothesis."

## Important rules

- **Timelines are regeneratable.** Replace wholesale on update.
  They're derived analysis, not source data.
- **Sort chronologically.** Always. Use year as sort key for
  approximate dates.
- **Combine related assertions.** One event per occurrence, not
  one event per assertion.
- **Date certainty uses the timeline subset.** Only `exact`,
  `approximate`, `estimated`, `calculated` — not `before`/`after`/
  `between`.
- **Impossibilities are identity signals.** Report them prominently.
  They often mean two persons are being confused for one.
- **Gaps are negative evidence.** The absence of expected records
  is itself evidence that drives the next research cycle. Do not
  dismiss gaps — high-severity gaps become new research questions.
- **Timelines are correlation tools.** Their value comes from
  placing information from independent sources side by side. A
  timeline built from a single source has limited analytical power.
  Always note which sources contribute to each event.

## Handoff rules

- **Impossibilities found** → suggest `conflict-resolution` (if
  fact-level) or `hypothesis-tracking` (if identity-level).
- **High-severity gaps** → suggest `question-selection` to plan
  research filling the gap.
- **Hypothesis test fails** → suggest `hypothesis-tracking` to
  update the hypothesis status to ruled_out.
- **User asks to resolve a conflict** between two assertions shown
  in the timeline → hand off to `conflict-resolution`. Do not
  attempt weighing evidence within this skill.
- **User asks to link new assertions** to persons → hand off to
  `person-evidence`.

## GPS grounding

This skill implements **GPS Element 3 (Analysis and Correlation)**
through chronological arrangement. See
`references/timeline-analysis-guide.md` for the full framework
(correlation patterns, negative evidence, assumption categories,
travel plausibility by era, and identity-testing techniques).

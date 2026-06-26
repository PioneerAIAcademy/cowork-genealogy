---
name: timeline
model: claude-sonnet-4-6
description: Builds candidate timelines (written to research.json) from assertions, surfaces gaps and
  chronological impossibilities, and supports identity-testing by checking
  whether records cohere into one life. GPS Step 3 — Analysis and
  Correlation (chronological analysis). Use when the user says "build a
  timeline", "show me the timeline", "what's the chronology?", "test
  whether a set of records describe one person", "do these events fit one
  life?", "build a candidate timeline for [hypothesis]", "what's missing
  in the timeline?", "find gaps", after new assertions are linked to a
  person via person-evidence, or when the user wants to visualize a
  person's documented life. Do NOT use when the user wants to resolve a
  conflict between sources (use conflict-resolution), wants to attach a
  record to a person or decide which of several same-name persons a
  specific record belongs to (use person-evidence), or wants to write a
  conclusion (use proof-conclusion).
allowed-tools:
  - place_search
  - place_search_all
  - place_distance
  - validate_research_schema
---

# Timeline

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

**Places:** When resolving or writing places, follow `references/places-guidance.md` — resolve with `place_search` / `place_search_all` and record the `standardPlace` (and `standard_place` on persisted facts/assertions/events).

Builds chronological timelines from assertions linked to persons.
A timeline is the primary **correlation tool** — it arranges events
from multiple independent sources in chronological order to:

1. **Correlate:** Surface agreement/discrepancy patterns across sources.
2. **Detect gaps:** Find undocumented periods where records should
   exist (negative evidence — see `references/timeline-analysis-guide.md`).
3. **Test identity:** Determine whether records cohere into one
   plausible life or reveal conflated identities.

A timeline built from a single source has limited analytical power;
always note which sources contribute to each event.

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
(see the enriched event example in Step 3.5 for the full field shape).

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

**Phase 1 — Resolve places to standard place names:**

1. Collect all unique non-null `place` strings from the built events.
2. For each unique place string, call the `place_search` MCP tool to
   standardize it. Pass the place string as `placeName` —
   e.g. `place_search({ placeName: "Schuylkill County, Pennsylvania" })`.
3. If the tool returns one or more results, take the first (best)
   match's `standardPlace` field and write it as `standard_place` onto
   all events sharing that place string.
4. If it returns no results, leave `standard_place` null. Do not retry
   or error.

**Phase 2 — Compute distances:**

1. Walk events in chronological order as consecutive pairs.
2. For each pair where both events have a non-null `standard_place`:
   - If the two `standard_place` values are the same, set
     `distance_from_previous_km` to `0` (no API call needed).
   - Otherwise call
     `place_distance({ standardPlace1, standardPlace2 })` with the two
     `standard_place` names and write its `kilometers` onto the later
     event's `distance_from_previous_km`.
3. Skip (leave `distance_from_previous_km` null) when either event lacks
   a `standard_place`.

**Example enriched event:**

```json
{
  "date": "1850",
  "date_certainty": "exact",
  "event_type": "census",
  "place": "Schuylkill County, Pennsylvania",
  "standard_place": "Schuylkill, Pennsylvania, United States",
  "description": "Enumerated age 5 in Thomas Flynn household, dwelling 84",
  "assertion_ids": ["a_003", "a_004"],
  "distance_from_previous_km": 5400
}
```

### 4. Identify gaps

Analyze the timeline for missing periods. A gap is **negative
evidence** — the absence of expected records carries meaning.

**Gaps as migration clues:** treat a disappearance from records as a
likely move (broaden the search geographically), not lost records —
see `references/timeline-analysis-guide.md` (Eliza Olds pattern).

Each gap has `start`, `end`, `expected_events` (the record types that
should fill it), and `severity`.

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

Each impossibility has a `description` and the two conflicting event
assertion ids (`event_1_assertion_id`, `event_2_assertion_id`).

**Timeline-visible impossibilities:**
- Events occurring before birth or after death
- Two events in distant locations with insufficient travel time
  (use `distance_from_previous_km` from Step 3.5 and the travel
  speed reference in `references/timeline-analysis-guide.md`)
- Same person enumerated in two different states in the same census
  year (suggests two different persons, not one)

**`impossibilities[]` is for chronological contradictions ONLY.**
Identity uncertainty ("which Patrick Flynn is this?"), source
disagreement ("informant said X, another said Y"), and any other
non-chronological dispute belong in `conflicts[]` — not here. If
those questions are already captured as `c_*` entries (resolved or
unresolved), reference them via the affected event's `conflict_ids`
field; do not duplicate the signal as an impossibility. If the
underlying identity conflict is unresolved and the affected events
cannot be safely attributed to one person, either omit those events
from the timeline or annotate them in the event's `conflict_note`
field. Putting "this might be a different person per c_002" into
`impossibilities` misuses the section and produces noise downstream.

**Impossibilities are strong evidence of identity problems.** If a
timeline built from two candidate persons has impossibilities, the
persons are probably NOT the same individual.

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

**Schema discipline:** Write only the fields defined in the
`research.schema.json` timeline and timeline_event schemas. Do not
invent or attach additional fields (e.g., conflict context, metadata,
or analysis annotations). Conflict identification is the job of
conflict-resolution, not this skill — use the existing `conflict_ids`
and `conflict_note` fields on timeline events to reference conflicts
that conflict-resolution has already created.

For a resolved conflict, `assertion_ids` lists **only the preferred
assertions** for that event. `conflict_ids` gets the `c_*` ID of the
conflict that resolved the disagreement (not the rejected assertion's
`a_*` ID). If you want to name the rejected assertion for context, put
its `a_*` ID in the free-text `conflict_note` field. The rejected
`a_*` ID **never** goes in `assertion_ids` or `conflict_ids`.
`assertion_ids` is "what produced this event," not "everything anyone
said about it."

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

**Display format** — chronological rows, a distance line between
consecutive placed events, then gaps, impossibilities, and a coherence
summary:

```
Timeline: <label>     Generated: <date>

~1845  BIRTH    Ireland (estimated from census ages)  [a_002, a_009]
                                    ── 5,400 km ──
1850   CENSUS   Schuylkill County, PA — age 5, Thomas Flynn household
                [a_003, a_004]

GAPS:            1860–1908 (HIGH) — missing marriage, 1870/1880/1900
                 censuses. 48-year gap.
IMPOSSIBILITIES: None
Coherence:       Plausible life in Schuylkill County, PA; large gap
                 1860–1908 needs investigation.
```

Distance lines appear between consecutive events when both have
resolved place IDs. Omit the distance line when either event has
no resolved place. Show `0 km` for same-place consecutive events
— this confirms the person stayed in the same location.

For next steps after presenting, see **Handoff rules** below.

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
- **After writing the timeline** → suggest `check-warnings` for the
  biological/logical checks (parent-child age gaps, marriage ages)
  the timeline's chronological view doesn't cover.

## GPS grounding

This skill implements **GPS Element 3 (Analysis and Correlation)**
through chronological arrangement. See
`references/timeline-analysis-guide.md` for the full framework
(correlation patterns, negative evidence, assumption categories,
travel plausibility by era, and identity-testing techniques).

## Re-invocation behavior

Writes only `timelines[]`; regeneratable — a re-invocation recomputes and replaces the matching timeline wholesale (others untouched), so never create a duplicate for the same candidate.

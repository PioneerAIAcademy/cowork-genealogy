---
name: timeline
model: claude-sonnet-4-6
description: Builds candidate timelines (written to research.json) from assertions, surfaces gaps,
  and supports identity-testing by checking whether records cohere into one
  life. Logical-impossibility checks (events after death, impossible ages)
  belong to check-warnings, not here. GPS Step 3 — Analysis and
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
  - research_append
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
contradictions — ages progress, locations are geographically
plausible — that's evidence supporting the merge.

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
2. For each unique place string, call the `place_search` MCP tool
   **exactly once** to standardize it. Pass the place string as
   `placeName` — e.g. `place_search({ placeName: "Schuylkill County,
   Pennsylvania" })`. **Issue all of these `place_search` calls together
   in a single turn (they are independent) rather than one per turn** —
   each turn re-reads the whole context, so serializing independent calls
   is the main avoidable cost here. Cache the resulting `standard_place`
   keyed by the raw string and reuse it for every event sharing that
   string; never re-resolve a string you have already resolved.
3. If the tool returns one or more results, take the first (best)
   match's `standardPlace` field and write it as `standard_place` onto
   all events sharing that place string.
4. If it returns no results, leave `standard_place` null. Do not retry
   or error.

**Phase 2 — Compute distances:**

1. Walk events in chronological order as consecutive pairs.
2. First determine every pair that needs a distance, then **issue all the
   needed `place_distance` calls together in one turn** (they are
   independent) instead of one per turn. For each pair where both events
   have a non-null `standard_place`:
   - If the two `standard_place` values are the same, set
     `distance_from_previous_km` to `0` (no API call needed).
   - Otherwise call
     `place_distance({ standardPlace1, standardPlace2 })` with the two
     `standard_place` names and write its `kilometers` onto the later
     event's `distance_from_previous_km`. Compute each unordered place
     pair only once — `place_distance` is symmetric, so
     `place_distance(A, B)` equals `place_distance(B, A)`; cache the
     result by unordered pair and never re-call it with the arguments
     reversed.
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
should fill it), and `severity`. Set `start` and `end` to the **actual
boundary values, copied verbatim** — the `date` of the bounding event
(in whatever format that event uses), or the year of the expected
record when the boundary is only known to the year (a bare `"1850"` for
a missing census is correct and valid). **Do not pad a year to
`YYYY-01-01` / `YYYY-12-31`** — that fabricates a January-1 precision the
boundary doesn't have. Boundaries stay as precise, and no more precise,
than the events they come from.

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

### 5. Note chronology-visible anomalies — do NOT judge possibility

Arranging events can make anomalies visible, but deciding whether a
single person's data is *logically impossible* — an event after death,
a birth after death, an impossible age — is **check-warnings'** job, not
this skill's. check-warnings runs that check deterministically via
`person_warnings` and even tells a genuine identity mix-up apart from a
record that merely mentions the deceased (a posthumous probate/obituary).
Do **not** detect or record those contradictions here.

- **The timeline has no impossibilities field — do not record logical
  contradictions here.** When the sorted timeline surfaces a possible
  vital-limit contradiction — e.g. a record dated after the person's recorded
  death — do **not** flag it as an impossibility yourself and do **not**
  silently fold it in as a normal late-life event. State it plainly in your
  reply ("the 1912 deed postdates the recorded 1908 death") and recommend a
  data-integrity check (check-warnings' `person_warnings`), which will
  classify it — misattribution vs. wrong death date vs. posthumous mention.

- **Geographic / travel feasibility is the exception — it IS this skill's,**
  because it depends on arranging events across sources and `person_warnings`
  does not do geography. When two place-bound events sit close together in
  time, use `distance_from_previous_km` (Step 3.5) and the era's travel speed
  (`references/timeline-analysis-guide.md`) to judge whether one person could
  have been at both — including the same person enumerated in two different
  states in one census year. Report an infeasible pair **in your reply** as a
  coherence signal (this identity-coherence finding has no persisted field).

Identity uncertainty ("which Patrick Flynn is this?"), source disagreement
("informant said X, another said Y"), and any other non-chronological dispute
belong in `conflicts[]`, not here. If those are already captured as `c_*`
entries, reference them from the affected event via its `conflict_ids` /
`conflict_note` field; do not re-derive them.

### 6. Identity-testing analysis

When building a hypothesis-testing timeline (Mode B), evaluate
coherence and report one of three results:

- **Pass:** No contradictions. Ages progress correctly, locations are
  geographically plausible (Step 5), and identifying details (occupation,
  birthplace, family members) remain consistent across records.
  Evidence SUPPORTING the hypothesis. When several independent records
  agree on age progression **and** at least one further stable identifier
  (birthplace, residence, occupation, or family), that is a Pass —
  conclude it. A common or high-frequency name is **not** a reason to
  downgrade to Inconclusive when the records otherwise cohere on multiple
  independent axes; note the common name as a caution to keep verifying,
  not as grounds to withhold the verdict.

- **Fail:** Identifying details contradict (different birthplaces,
  incompatible ages, different spouse names), or a geographic
  infeasibility (Step 5) shows the records cannot describe one person.
  If you also suspect a vital-limit impossibility (an event after death),
  recommend check-warnings to confirm it before concluding. Evidence
  AGAINST the hypothesis.

- **Inconclusive:** Reserve this for a genuinely THIN profile — one or
  two records matching on little more than a name and an approximate age,
  with no corroborating birthplace, residence, occupation, or family to
  tie them together. Do **not** use Inconclusive as a hedge when several
  records already agree on age progression plus a stable birthplace or
  residence — that is a Pass, not an Inconclusive.

Report the coherence result to the user, and **name the specific signals
that drove the verdict** — the actual age progression, birthplace
stability (or drift), geographic plausibility of the moves, and
family-member consistency you observed — not just the Pass / Fail /
Inconclusive label. This identity-coherence judgment has no persisted
field; your chat reply is its only record, so a bare label without the
deciding signals is an incomplete finding. If fail or inconclusive,
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

Persist the timeline to `research.json` `timelines[]` through
`research_append`. Pass **only the timeline object** — never read and
re-serialize the whole `research.json`. The persisted timeline's fields
are `label`, optional `hypothesis_id`, `person_ids`, `generated`,
`events[]`, and `gaps[]`. There is no `impossibilities` field —
impossibility detection has moved to check-warnings. On
`{ ok: false, errors }` it writes nothing — surface those errors and fix
the input rather than retrying blindly.

**New timeline** — `op: "append"`. The tool assigns the `t_` id and
stamps `generated`, so omit both from the entry:

```json
research_append({
  "section": "timelines",
  "op": "append",
  "entry": {
    "label": "Patrick Flynn — assuming Thomas Flynn parentage",
    "hypothesis_id": "h_001",
    "person_ids": ["KWCJ-RN4"],
    "events": [ ... ],
    "gaps": [ ... ]
  }
})
```

**Regeneration (replace an existing timeline for the same
person/hypothesis)** — read that timeline's `t_` id from
`research.json` `timelines[]` and update it in place with
`op: "update"`. The `fields` you pass are shallow-merged and array
fields (`events`, `gaps`) are replaced **wholesale**,
so pass the full recomputed arrays. `update` does **not** re-stamp
`generated`, so include it yourself with the current timestamp so
downstream skills know how fresh the analysis is:

```json
research_append({
  "section": "timelines",
  "op": "update",
  "entryId": "t_001",
  "fields": {
    "generated": "2026-05-04T16:00:00Z",
    "events": [ ... ],
    "gaps": [ ... ]
  }
})
```

Timelines are regeneratable — cached analysis, not primary data — so
never leave a stale duplicate for the same candidate.

### 8. Present

`research_append` validates the whole project before persisting, so no
separate `validate_research_schema` pass is needed — a successful write
means the timeline (and `tree.gedcomx.json`) are valid.

OUTPUT ECONOMY (latency): The timeline is ALREADY persisted to
`research.json` by `research_append`. Wall-clock time is ~linear in the
tokens you generate (~16–20 ms/token, independent of model tier), so
the single biggest latency lever is generating fewer tokens. In your
FINAL chat response, do NOT reproduce the persisted content — the full
event table, the distance ladder, or a per-event walkthrough. Present a
terse summary ONLY: what was written, the key findings, and the
recommended next step. The full chronological table belongs in the
persisted timeline (the viewer renders it), not echoed in chat. Reserve
one short line per finding, not a paragraph.

Report:

- **Written:** the timeline `t_` id and label plus event / gap
  counts — e.g. "t_003 — 7 events, 2 gaps; persisted for the viewer".
- **Gaps:** one line per gap — its span and severity (the actionable
  negative evidence). Omit if none.
- **Anomalies:** any geographic/travel-feasibility problem you found
  (Step 5); and, if a record falls outside the person's recorded
  lifespan, one line noting it and recommending a data-integrity check
  (check-warnings) rather than flagging it here. Omit if none.
- **Coherence** (Mode B hypothesis test): the Pass / Fail /
  Inconclusive verdict with a one-sentence rationale.
- **Recommended next step** (see Handoff rules below).

Do NOT re-render every event row or the distance ladder in chat — the
events, places, and distances are persisted and the viewer renders the
full chronological table.

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

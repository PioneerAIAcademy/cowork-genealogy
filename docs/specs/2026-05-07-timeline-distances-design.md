# Timeline Distances Design Spec

Enhance the timeline skill to compute and display great-circle distances
between consecutive events, using the `places` and `place_distance` MCP
tools.

## Context

The timeline skill (GPS Step 3 — chronological analysis) already
identifies impossibilities like "two events in distant locations with
insufficient travel time," but relies on Claude's judgment rather than
concrete distance data. This enhancement adds structured place
resolution and measured distances so the timeline presents factual
geographic data. Impossibility judgment remains the responsibility of
the `check_warnings` MCP endpoint — the timeline only shows distances.

## Schema Changes

Two new optional fields on timeline events in `research.json`
(Section 5.10 of `docs/specs/research-schema-spec.md`):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `place_id` | string or null | no | FamilySearch place ID resolved from `place` via the `places` tool. Null if unresolvable or `place` is null. |
| `distance_from_previous_km` | number or null | no | Great-circle distance in km from the previous event's place. Null for the first event, or when either event lacks a resolved `place_id`. |

Both fields are additive and optional. Existing timelines without these
fields remain valid.

## SKILL.md Changes

### New `allowed-tools`

Add `places` and `place_distance` to the frontmatter. The timeline skill
currently has no MCP tool dependencies — this is the first.

### New Step 3.5: Enrich with place data and distances

Inserted between Step 3 (Build timeline events) and Step 4 (Identify
gaps).

**Phase 1 — Resolve places:**

1. Collect all unique non-null `place` strings from the built events.
2. For each unique place string, call the `places` MCP tool to resolve
   it to a place ID.
3. If the tool returns one or more results, use the first (best) match
   and write its `place_id` onto all events sharing that place string.
4. If it returns no results, leave `place_id` null. Do not retry or
   error.

**Phase 2 — Compute distances:**

1. Walk events in chronological order as consecutive pairs.
2. For each pair where both events have a non-null `place_id`:
   - If the two `place_id` values are the same, set
     `distance_from_previous_km` to `0` (no API call needed).
   - If they differ, call `place_distance` with the two IDs and write
     the result onto the later event's `distance_from_previous_km`.
3. Skip (leave null) when either event lacks a `place_id`.

**MCP call count:** at most (number of unique place strings) +
(number of consecutive pairs with two distinct resolved place IDs).

### Display format update

Show distances between events when available. Omit when either event
has no resolved place:

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
```

The `0 km` entries for same-place consecutive events are shown — they
confirm the person stayed in the same location.

## Scope Boundaries

- **No impossibility judgment.** The timeline shows distances; the
  `check_warnings` endpoint decides if a distance is implausible for
  the time period.
- **No all-pairs distance matrix.** Only consecutive events get
  distances.
- **No `place_distance` endpoint implementation.** That endpoint is
  being built separately in TypeScript. This spec assumes it exists
  and returns a distance in km given two place IDs.
- **Research schema spec update is in scope.** The two new optional
  fields must be added to the timeline events table in
  `docs/specs/research-schema-spec.md` Section 5.10.

## Files Modified

1. `plugin/skills/timeline/SKILL.md` — add `allowed-tools`, new
   Step 3.5, updated display format.
2. `docs/specs/research-schema-spec.md` — add `place_id` and
   `distance_from_previous_km` to the timeline events table in
   Section 5.10.

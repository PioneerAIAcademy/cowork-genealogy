# Warnings as Identity Signals

The primary value of warning detection in genealogy is not just
catching typos — it is identifying records that have been incorrectly
linked to a person. Timeline impossibilities are among the strongest
signals that a profile contains data from multiple distinct
individuals.

## Why Identity Confusion Matters

Professional genealogists regularly encounter pedigrees where
untrained researchers merged records from different people into a
single profile. The most common causes:

- Same name, same area, same time period (very common in areas
  with limited surname variety)
- Father and son with identical names
- Cousins with the same name in the same community
- Clerical errors in compiled databases

When records from two people are merged, the resulting profile
will exhibit logical impossibilities — and those impossibilities
are detectable through warning checks.

## Timeline Impossibilities as Split Points

When a warning fires, ask: "If I split this person into two
separate individuals at this point in the timeline, do the
impossibilities disappear?"

Example pattern:
- Person born 1820 in Virginia
- Marriage 1842 in Ohio (reasonable: migration westward)
- Child born 1845 in Ohio
- Child born 1847 in Virginia (warning: geographic inconsistency)
- Death 1890 in Ohio

The 1847 Virginia child may belong to a different person with the
same name (perhaps a sibling or cousin who stayed in Virginia).
The split point is between 1845 and 1847.

## Pedigree Analysis for Error Detection

Before beginning deep research on any individual, scan their
profile for these quick checks derived from pedigree analysis
principles:

### Date sequence logic
- Birth < marriage < death (always)
- Each event date should be plausible given the others
- Ages should progress at 1 year per calendar year across records

### Location consistency
- Do birthplaces of sequential children trace a plausible
  geographic path?
- Are event locations reachable from each other given the dates
  and available transportation?
- Do all events occur in jurisdictions that existed at the stated
  times?

### Reasonable age differences
- Parent-child: typically 15-50 years
- Spouses: typically within 20 years of each other (wider gaps
  occur but are worth noting)
- Siblings: typically 1-20 years between oldest and youngest

### Jurisdictional existence
- Did the named county, parish, district, or town exist at the
  date of the event?
- Was the jurisdiction named differently at that time?
- Was the area part of a different political entity?

## Distinguishing Warnings from Conflicts

This distinction is critical for routing work to the correct skill:

### Warnings (handled by check-warnings)
- Single person's data violates physical, biological, or temporal
  constraints
- Do not require comparing multiple sources — they can be detected
  from the assembled profile alone
- Indicate errors or identity confusion
- Examples: died before born, child after mother's death, impossible
  travel between events

### Conflicts (handled by conflict-resolution)
- Two or more sources disagree about the same fact for the same
  person
- Require comparing sources against each other
- Indicate that at least one source contains inaccurate information
  (but don't necessarily indicate identity confusion)
- Examples: one record says born 1845, another says 1847; census
  says born in Ireland, death record says born in England

### Overlap cases
Some situations can be analyzed as either warnings or conflicts:
- A death date that makes the person impossibly old might be a
  warning (lifespan > 120) AND a conflict (if multiple sources give
  different death dates). In these cases, check-warnings flags the
  impossibility, and conflict-resolution handles the source
  disagreement.

## Clustered Warnings

A single low-severity warning on an otherwise clean profile is
usually noise. But multiple warnings clustering on the same person
— especially across different categories — is a strong signal of
systematic problems.

Escalation guidance:
- 1 Low warning: note and move on
- 2+ Low warnings on same person: mention the pattern
- 1 High warning: investigate the specific condition
- 1 High + 1+ Medium/Low: likely identity confusion; recommend
  timeline review
- 2+ High warnings: almost certainly two people merged; recommend
  splitting the profile and rebuilding person_evidence links
- Any Critical warning: stop and investigate immediately regardless
  of other warning count

## Connecting Warnings to Research Actions

When warnings are found, they should drive specific research
activities:

1. **Build a timeline** if one doesn't exist — chronological
   arrangement of all events often reveals the exact point where
   two identities were merged

2. **Check person_evidence links** for the assertions involved
   in the warning — which sources support linking that record to
   this person?

3. **Search for same-name individuals** in the same locality and
   time period — the "other person" whose records were merged is
   often easily findable

4. **Verify jurisdiction existence** for any location-based
   warnings — original records may use different place names than
   compiled databases

5. **Examine the specific source** for assertions involved in
   warnings — derivative sources (indexes, transcriptions) are
   more error-prone than originals

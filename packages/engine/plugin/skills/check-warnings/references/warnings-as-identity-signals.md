# Warnings as Identity Signals

The primary value of warning detection in genealogy is not just
catching typos -- it is identifying records that have been incorrectly
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
will exhibit logical impossibilities -- and those impossibilities
are detectable through warning checks.

## Timeline Impossibilities as Split Points

When a warning fires, ask: "If I split this person into two
separate individuals at this point in the timeline, do the
impossibilities disappear?"

Example pattern:
- Person born 1820
- Marriage 1842 (consistent)
- Child born 1845 (consistent)
- Death 1850 (consistent)
- Census record 1860 listing this person as living
  (warning: `hasEventAfterDeath1`)

The 1860 census record may belong to a different same-name
individual. The split point is the death in 1850 -- records dated
before belong to one person, records dated after belong to
another.

### Exception -- posthumous mentions are NOT identity signals

A `hasEventAfterDeath1` warning does not always mean identity
confusion. A third legitimate cause is the **posthumous mention**:
a record created after the deceased's death that REFERENCES them
without describing actions by them. Examples:

- An obituary for the deceased (or for a descendant) that names
  the deceased as a parent or family member.
- A descendant's death certificate listing the deceased as a
  parent (the certificate's own date is after the deceased's
  death).
- An estate, probate, or guardianship record naming the deceased
  as a prior owner, testator, or parent of a minor heir.

If a source of this type is attached to the deceased's profile as
a Residence-style fact (rather than as a reference), the tool
will correctly flag `hasEventAfterDeath1` -- but the corrective
action is to unlink the source from the deceased's events and
re-treat it as a reference, NOT to split the profile. Splitting
on a posthumous mention is a false-positive identity-split that
damages the data.

The rule: before recommending an identity split for
`hasEventAfterDeath1`, look at the type of the late-dated source.
If it is a record about the deceased's life (a census, marriage,
or vital record purportedly performed by them), identity
confusion is likely. If it is a record about someone else where
the deceased is merely named, treat it as a posthumous mention
and recommend re-linking instead.

Phrase all recommendations as research actions the user can
take, not as instructions to run a specific skill. The user does
not know which skills exist; the orchestrator will route their
follow-up question to the right skill automatically. See
SKILL.md Step 3's special case for `hasEventAfterDeath1`.

## Pedigree Analysis for Error Detection

Before beginning deep research on any individual, scan their
profile for these quick checks. The tool's emitted warnings are
already organized around them:

### Date sequence logic
- Birth must precede every other event (`hasEventBeforeBirth365_2`)
- Death must follow every other event (`hasEventAfterDeath1`)
- Burial must follow death (`hasBurialBeforeDeath`)
- Christening must follow birth (`hasChristeningBeforeBirth`)
- Each event date should be plausible given the others

### Reasonable age differences
- Parent-child age gap: typically 12-55 years for mothers, 14+ for
  fathers -- covered by `earliestChildBirthToBirth12`,
  `earliestChildBirthToBirthMale14`, `latestChildBirthToBirthFemale55`,
  `latestChildBirthToBirth80`
- Marriage age: typically 14-90 -- covered by `hasEarlyMarriage14`
  and `hasLateMarriage90`
- Child-spacing across a family: under 40 years between oldest
  and youngest -- covered by `childBirthRange40`

### One-of-a-kind records
- A person has one birth and one death -- multiple distinct ones
  are conflated records (`tooManyBirthDates2`, `tooManyDeathDates2`,
  `deathRangeGreaterThan2`)
- A person has one biological mother and one biological father
  (`tooManyFathers2`, `tooManyMothers2`)
- A person's surnames usually agree with each other
  (`hasDiffSurnameMale`)

## Distinguishing Warnings from Conflicts

This distinction is critical for routing work to the correct skill:

### Warnings (handled by check-warnings)
- Single person's data violates physical, biological, or temporal
  constraints
- Do not require comparing multiple sources -- they can be detected
  from the assembled profile alone
- Indicate errors or identity confusion
- Examples: event before birth (`hasEventBeforeBirth365_2`), event
  after death (`hasEventAfterDeath1`), child born after mother's
  death (`hasDeathBeforeChildBirthFemale365`)

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
  warning (`hasAgeRangeGreaterThan120`) AND a conflict (if
  multiple sources give different death dates). In these cases,
  check-warnings flags the impossibility, and conflict-resolution
  handles the source disagreement.

## Clustered Warnings

A single `severity: "warning"` on an otherwise clean profile is
usually noise. But multiple warnings clustering on the same person
-- especially mixing error and warning severities -- is a strong
signal of systematic problems.

Escalation guidance:
- 1 `warning` on its own: note and move on
- 2+ `warning`s on same person: mention the pattern
- 1 `error` on its own: investigate the specific condition
- 1 `error` + 1+ `warning`s: likely identity confusion; recommend
  timeline review
- 2+ `error`s: almost certainly two people merged; recommend
  splitting the profile and rebuilding person_evidence links
- Any `error` involving the death-vs-event sequence
  (`hasEventAfterDeath1`, `hasEventBeforeBirth365_2`): stop and
  investigate immediately regardless of other warning count

## Connecting Warnings to Research Actions

When warnings are found, they should drive specific research
activities:

1. **Build a timeline** if one doesn't exist -- chronological
   arrangement of all events often reveals the exact point where
   two identities were merged.

2. **Check person_evidence links** for the assertions involved
   in the warning -- which sources support linking that record to
   this person?

3. **Search for same-name individuals** in the same locality and
   time period -- the "other person" whose records were merged is
   often easily findable.

4. **Examine the specific source** for assertions involved in
   warnings -- derivative sources (indexes, transcriptions) are
   more error-prone than originals.

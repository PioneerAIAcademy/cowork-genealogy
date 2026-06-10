# Warning Checks Reference

Complete catalog of the conditions the `person_warnings` MCP tool
currently checks. Each entry shows the tag emitted in `issueType`,
the rule, and what it usually means.

The tool emits two severities:

- **`error`** — violates a Fundamental assumption (physical /
  biological / temporal impossibility). Almost always a data error
  or two distinct identities merged into one profile.
- **`warning`** — violates a Valid assumption (biologically or
  socially improbable). Exceptions exist; verification recommended.

See `assumption-categories.md` for the framework these severities
map to.

## Fundamental violations (`severity: "error"`)

These conditions are impossible under physical or biological law.
Always investigate.

### `hasEventBeforeBirth365_2`
- Rule: at least one event is dated more than 2 years before the
  person's earliest birth-like fact.
- Cause: wrong birth date, wrong event attribution, or identity
  confusion.
- Action: verify the birth date and whether the early-dated event
  really belongs to this person.

### `hasEventAfterDeath1`
- Rule: at least one event is dated more than 1 year after the
  person's latest death-like fact.
- Cause: a same-name individual's records merged in, or wrong
  death date.
- Action: check person_evidence links for the post-death event.

### `hasAgeRangeGreaterThan120`
- Rule: latest possible death year minus latest possible birth
  year is greater than 120.
- Cause: wrong birth or death date, or two people merged.
- Action: verify both vital dates against source documents.

### `hasChristeningBeforeBirth`
- Rule: the latest Christening day is strictly before the earliest
  Birth day (year-only dates get a year of slack on each side).
- Cause: data-entry error or wrong attribution.
- Action: verify both vital dates.

### `hasEventBeforeChristening365_3`
- Rule: at least one non-Birth event is dated more than 3 years
  before the latest Christening.
- Cause: wrong event attribution or records from two persons
  merged.
- Action: verify event ownership.

### `hasBurialBeforeDeath`
- Rule: every recorded burial day precedes every recorded death
  day (both must be perfect day-month-year).
- Cause: data error or transcription mistake.
- Action: verify burial / death dates against sources.

### `hasDeathBeforeChildBirth30_10` (male anchor)
- Rule: the father's latest exact Death day was more than 300 days
  before a child's exact Birth day.
- Cause: wrong death date or wrong child attribution.
- Action: verify the death date and the parent-child link.

### `hasDeathBeforeChildBirth365_2` (male anchor)
- Rule: the father's latest death-like fact is more than 2 years
  before a child's earliest birth-like fact (family-level looser
  variant of the above).
- Cause: as above.
- Action: verify the parent-child link or vital dates.

### `hasDeathBeforeChildBirthFemale365` (female anchor)
- Rule: the mother's latest death-like fact is more than 1 year
  before a child's earliest birth-like fact.
- Cause: wrong death date or wrong mother attribution.
- Action: verify the link.

### `hasDeathBeforeChildBirthFemale2` (female anchor)
- Rule: the mother's latest exact Death day was more than 2 days
  before a child's exact Birth day. A mother can give birth and
  die the same day, but not 2+ days before.
- Cause: data error or wrong mother attribution.
- Action: verify dates.

## Valid violations (`severity: "warning"`)

These conditions are improbable but not impossible. Exceptions are
documented but rare. Verify against original sources before
treating as established.

### Parent at extreme age
- `earliestChildBirthToBirth12` — parent had a child before age 12.
- `earliestChildBirthToBirthMale14` — father had a child before age 14.
- `latestChildBirthToBirth80` — child born 80+ years after this person's birth.
- `latestChildBirthToBirthFemale55` — mother was age 55 or older at a child's birth.

### Marriage timing
- `hasEarlyMarriage14` — married before age 14.
- `hasLateMarriage90` — married more than 90 years after birth.
- `hasYoungSpouse15` — a spouse died at age < 15.
- `earliestChildMarriageToBirth30` — a child married before this person reached age 30.
- `latestChildBirthToMarriage35` — a child was born 35+ years after this person's latest marriage.
- `childMarriageToMarriage15` — a child married within 15 years of this person's earliest marriage (implies very young parenthood).

### Multiple records of a unique event
- `tooManyBirthDates2` — two or more distinct perfect-DMY birth dates spaced > 30 days apart.
- `tooManyDeathDates2` — two or more distinct perfect-DMY death dates spaced > 14 days apart.
- `deathRangeGreaterThan2` — death-like dates span more than 2 years.
- `hasBurialAfterDeath31` — earliest burial is more than 31 days before the latest death. (Despite the Java name, this fires on "burial before death" outliers; preserved for parity.)

### Family structure
- `tooManyChildren18` — 18 or more children.
- `tooManyFathers2` — multiple fathers (only one biological father is possible).
- `tooManyMothers2` — multiple mothers.
- `childBirthRange40` — span between earliest and latest child's birth is 40+ years.
- `missingFactsAndRelatives` — empty stub record (no facts other than `GenderChange`, no relatives).
- `hasBlankName` — no name on the record.
- `hasDiffSurnameMale` — male anchor has surnames that don't match each other (similarity ≤ 0.5). Suggests records from two same-given-name persons were merged.

### Extreme lifetimes after specific events
- `hasDeathAfterChildBirth90` — died more than 90 years after the earliest child's birth.
- `hasChildDeathAfterParentBirth200` — died more than 200 years after the earliest parent's birth.

## Relative-mob variants

Most checks above have a "relatives" variant that fires when the
same condition is detected on a parent, spouse, or child of the
focal person. They emit `severity: "warning"` regardless of the
original severity, because the focal person's own data isn't
necessarily wrong — the issue is in the relationship.

Naming patterns:

- `relatives<CheckName>` — any relative triggers it.
- `maleRelatives<CheckName>` — only male relatives are considered.
- `femaleRelatives<CheckName>` — only female relatives are considered.

The relative being flagged is named in the warning's `personName`
/ `personId`, not the focal person.

The current set of relative-mob tags: `relativesDeathRangeGreaterThan2`,
`relativesEarliestChildBirthToBirth12`,
`relativesHasEventBeforeChristening365_3`,
`maleRelativesEarliestChildBirthToBirth14`,
`femaleRelativesLatestChildBirthToBirth55`,
`relativesHasDeathBeforeChildBirth365_2`,
`relativesHasDeathBeforeChildBirth30_10`,
`relativesEarliestChildMarriageToBirth30`,
`femaleRelativesHasDeathBeforeChildBirth365`,
`femaleRelativesHasDeathBeforeChildBirth2`,
`relativesLatestChildBirthToMarriage35`,
`relativesLatestChildBirthToBirth80`,
`relativesChildMarriageToMarriage15`,
`relativesHasDeathAfterChildBirth90`,
`relativesHasAgeRangeGreaterThan120`,
`relativesHasChildDeathAfterParentBirth200`,
`maleRelativesHasDiffSurname`.

## NOT currently checked

The tool does NOT currently emit warnings for these. Do NOT
manufacture warnings of your own for these conditions; surface
them only if the user explicitly asks for an analysis of them.

- Geographic impossibilities (impossible travel, jurisdiction
  didn't exist, birthplace inconsistencies with parents' residence)
- Future dates (date is after the current year)
- Child-spacing (two children born less than 9 months apart)
- Birth before parents' marriage
- Sibling age gap at the year-by-year level (the tool covers only
  40+ year spans via `childBirthRange40`)
- Same-surname-and-area inferences

These may be added in later releases. Until then, they are out of
scope for the tool — and therefore for this skill.

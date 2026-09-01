# Person Warnings Tool — Implementation Spec

## Overview

A deterministic, offline MCP tool that reads `tree.gedcomx.json` from a
project directory and checks person data for impossible or unlikely
genealogical facts. No authentication required — the tool operates
entirely on local file data.

Adapted from FamilySearch's `MobWarnings.java`. This spec starts with
three starter warnings and is designed for easy extension.

### Scope: anchor person and their one-hops

The tool always evaluates warnings **from the point of view of a single
anchor person**, named by the required `personId`. The anchor and their
**one-hop relatives** (parents, spouses, children) plus the
relationships between them are what MobWarnings calls the "relative
mob."

- `personId` identifies the **target/anchor** — it is *not* a scope
  filter and there is no "check every person in the file" mode.
- The `tree.gedcomx.json` file may contain everyone gathered for the
  project so far (potentially many people across generations). The tool
  does **not** check the whole file — only the anchor's mob.
- **Single-person warnings** (e.g. `hasEventAfterDeath1`,
  `hasAgeRangeGreaterThan120`) report on the anchor person.
- **Relationship warnings** (e.g. `earliestChildBirthToBirthMale14`)
  report on a relationship between the anchor and a one-hop relative.

**Single-person warnings run on the anchor *and* its one-hop relatives,
not the anchor alone.** 27 of the 47 self-checks have a relative-mob variant
(`relatives*`, `maleRelatives*`, `femaleRelatives*`) that fires the same
condition on a parent, spouse, or child; the flagged relative is named in
the warning's `personId`/`personName`. The other 20 run on the anchor only.
The relative-variant tags in § Warning Definitions are the evidence.

---

## Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `projectPath` | string | Yes | Absolute path to the directory containing `tree.gedcomx.json` |
| `personId` | string | Yes | The anchor person to check. Names the target; warnings are evaluated over this person and their one-hop relatives |

Example:
```json
{ "projectPath": "/home/user/projects/flynn", "personId": "I1" }
```

---

## Output

| Field | Type | Description |
|-------|------|-------------|
| `warningCount` | number | Total warnings produced |
| `warnings` | object[] | Array of warning objects (see below). Empty array when no warnings |

> **Review decision (2026-05-27):** `personsChecked` and the top-level
> human-readable `message` summary were removed — "keep it simple"
> (Dallan). `warningCount` is **kept**: unlike the removed `message` (a
> natural-language summary — the kind of phrasing better left to the
> LLM), `warningCount` is a plain deterministic count produced in code
> (`warnings.length`), so it belongs in the tool output. The per-warning
> `message` field below also survives (see the warning-list note).

### Warning Object

The shipped shape is `PersonWarning` in
`src/types/person-warnings.ts`.

| Field | Type | Description |
|-------|------|-------------|
| `scoreType` | string | Always `"COHERENCE"`. The quality-score family the check belongs to (ported from FamilySearch's MobWarnings, which groups checks by score type) |
| `issueType` | string | The warning tag (e.g., `hasEventAfterDeath1`). One of the tags catalogued under § Warning Definitions; each tag is a FamilySearch quality-score tag |
| `severity` | string | `contradiction` (impossible) or `implausible` (unlikely but possible) |
| `personId` | string | Person ID the warning applies to |
| `personName` | string | Display name of the person (see below) |
| `message` | string | Human-readable description of the problem |
| `factIds` | string[]? | Fact IDs involved in the check, for UI highlighting. Optional — MobWarnings carries only the tag; the TS port attaches contributing facts when cheaply retrievable |
| `relatedPersonId` | string? | Person ID of the related person, when the check involves a relationship (e.g., the father in `earliestChildBirthToBirthMale14`). Omitted when not applicable |
| `mobRole` | string? | Merge-mode only (`merge_warnings`): which mob surfaced the warning — `"target"`, `"candidate"`, `"merged"`, or `"relative"`. Single-anchor `person_warnings` never sets it. See `match-merge-workflow-spec.md` §7.5 |

**`personName` resolution:** Use the preferred name (the one with
`preferred: true`), falling back to the first name in the array. Format
as `"{given} {surname}"`. If the person has no names array or it is
empty, use `"Unknown (personId)"`.

Example output:
```json
{
  "warningCount": 1,
  "warnings": [
    {
      "scoreType": "COHERENCE",
      "issueType": "hasEventAfterDeath1",
      "severity": "contradiction",
      "personId": "I1",
      "personName": "Patrick Flynn",
      "message": "An event is dated more than 1 year after this person's latest death-like fact.",
      "factIds": ["F1", "F2"]
    }
  ]
}
```

The FamilySearch quality-score tag list (the placeholder note that
originally stood here anticipated) has arrived and shipped: the tool
emits the FamilySearch tags in `issueType`, and § Warning Definitions
below is the catalogue of all of them. The tags — not the retired
`UPPER_SNAKE_CASE` placeholders — are the source of truth an
implementation is checked against.

---

## Tool Schema

```typescript
{
  name: "person_warnings",
  description:
    "Check a person in tree.gedcomx.json for impossible or unlikely genealogical " +
    "data (e.g., death before birth, father too young). Reads the local project " +
    "file — no authentication or network access required. personId is the anchor " +
    "person; warnings are evaluated over that person and their one-hop relatives.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectPath: {
        type: "string",
        description:
          "Absolute path to the directory containing tree.gedcomx.json",
      },
      personId: {
        type: "string",
        description:
          "The anchor person to check. Warnings are evaluated over this person and their one-hop relatives.",
      },
    },
    required: ["projectPath", "personId"],
  },
}
```

---

## Authentication

None required. The tool reads a local file only.

---

## Date Parsing Rules

The two questions the retired PENDING DECISION block held open have both
landed, and the year-only helpers it planned for were superseded before
they shipped:

- **Full-date precision** is available. Checks compare **day ranges**,
  not years — `factDaysDiffLatestLatest` (`src/utils/fact-helpers.ts`)
  and the day-range comparisons in `src/utils/date-comparison.ts` give
  day/month resolution, which is why tolerances read as `365`, `31`,
  `30_10`, etc. rather than whole years.
- **Standardized dates in simplified GedcomX** shipped. The converter
  emits a `standard_date` sidecar (GEDCOM-form) on facts that come from
  FamilySearch, so consumers no longer re-parse freeform text.

Dates therefore resolve, per fact, through **`getStandardDate`**
(`src/utils/fact-helpers.ts`): it prefers the fact's `standard_date`
sidecar and falls back to **`stdDate`** (`src/utils/date-standardize.ts`)
for LLM-authored stubs that lack the sidecar. Returns `null` when no
parseable date exists — the fact is then skipped silently.

A standardized date string is turned into a `[min, max]` day-number
range by **`getDayRange`** (`src/utils/date-helpers.ts`), which widens
the range for imprecise (non day-month-year) dates via its
`imperfectDateFudgeDays` parameter — the port of MobWarnings'
`getDateRange` fudge. All temporal checks compare these day ranges;
there are no `extractYear`/`extractEarliestYear`/`extractLatestYear`
helpers.

---

## Warning Definitions

All warnings are evaluated relative to the **anchor person** (the
required `personId`) and its one-hop relatives. Single-person checks
read the anchor's own facts; relationship checks consider relationships
in which the anchor participates (as parent, spouse, or child); and 27 of
the 47 self-checks have a `relatives*`/`maleRelatives*`/`femaleRelatives*`
variant that fires the same condition on a one-hop relative.

The full catalogue of the **74 tags** the tool emits in `issueType` is
the § Tag Catalogue below. It is the source of truth an implementation is
checked against, and the drift lint
(`tests/packaging/person-warnings-spec-drift.test.ts`) fails if it and
the shipped tags disagree in either direction.

### Conservative range principle

Dates resolve to `[min, max]` day ranges (see § Date Parsing Rules).
Each check reads the bound that gives the data the **most generous**
interpretation, so a warning fires only when even the most generous
reading produces an impossible or unlikely result. Imprecise dates are
widened further by `getDayRange`'s `imperfectDateFudgeDays`, so a
year-only value does not naively trip a day-level check.

---

### W1: `DEATH_BEFORE_BIRTH`

> **SUPERSEDED — this section describes a design that was never shipped.**
> The tool emits no `DEATH_BEFORE_BIRTH` tag. The shipped birth/death
> ordering checks are the `hasEventBeforeBirth365_2` family (§ Tag
> Catalogue): they compare day ranges rather than years and reason about
> birth-like/death-like fact *families* rather than a single Birth and
> Death fact, so a Death dated before the earliest birth-like fact trips
> `hasEventBeforeBirth365_2` (a Death being an event more than a year
> before birth). The placeholder note at the top of this file anticipated
> the move to FamilySearch tags; that migration happened and these
> definitions were not updated with it. Kept here as the record of the
> original design, not as a description of current behaviour — the old
> pseudocode below calls `extractEarliestYear`/`extractLatestYear`, helpers
> that no longer exist; see § Tag Catalogue for shipped behaviour.

**Severity:** `contradiction`

**Condition:** The anchor has both a Birth and a Death fact with
parseable years, and the latest possible death is before the earliest
possible birth.

**Logic:**

```
birthFact = anchor.facts.find(f => f.type === "Birth")
deathFact = anchor.facts.find(f => f.type === "Death")
if (!birthFact || !deathFact) → skip

birthYear = extractEarliestYear(birthFact.date)
deathYear = extractLatestYear(deathFact.date)

if (birthYear != null && deathYear != null && deathYear < birthYear)
  → emit warning
```

**Message:** `"Death year ({deathYear}) is before birth year ({birthYear}) for {personName}."`

**factIds:** `[birthFact.id, deathFact.id]`

**relatedPersonId:** omitted

---

### W2: `YOUNG_BIRTH`

> **SUPERSEDED — this section describes a design that was never shipped.**
> The tool emits no `YOUNG_BIRTH` tag. The shipped equivalent is
> `earliestChildBirthToBirthMale14` (§ Tag Catalogue), with a
> `relatives`/`maleRelatives` mob variant that fires the same condition on
> a one-hop relative. The placeholder note at the top of this file
> anticipated the move to FamilySearch tags; that migration happened and
> these definitions were not updated with it. Kept here as the record of
> the original design, not as a description of current behaviour — the old
> pseudocode below calls `extractEarliestYear`/`extractLatestYear`, helpers
> that no longer exist; see § Tag Catalogue for shipped behaviour.

**Severity:** `implausible`

**Condition:** A ParentChild relationship involving the anchor exists
where the parent is male, and even the maximum possible age at the
child's birth is < 14.

**Logic:**

```
for each relationship where type === "ParentChild"
    AND (relationship.parent === anchor.id OR relationship.child === anchor.id):
  parent = persons.find(p => p.id === relationship.parent)
  child  = persons.find(p => p.id === relationship.child)
  if (!parent || !child) → skip
  if (parent.gender !== "Male") → skip

  parentBirthFact = parent.facts.find(f => f.type === "Birth")
  childBirthFact  = child.facts.find(f => f.type === "Birth")
  if (!parentBirthFact || !childBirthFact) → skip

  parentBirthYear = extractEarliestYear(parentBirthFact.date)
  childBirthYear  = extractLatestYear(childBirthFact.date)

  if (parentBirthYear != null && childBirthYear != null):
    maxAge = childBirthYear - parentBirthYear
    if (maxAge < 14) → emit warning on the CHILD person
```

**Message:** `"Father {parentName} would have been {maxAge} at the birth of {childName} (father born {parentBirthYear}, child born {childBirthYear})."`

**factIds:** `[parentBirthFact.id, childBirthFact.id]`

**relatedPersonId:** `parent.id`

**Note:** The warning is emitted on the child's `personId` (since the
child's data is what typically needs correction), with the father as
`relatedPersonId`.

---

### W3: `EVENT_AFTER_DEATH`

> **SUPERSEDED — this section describes a design that was never
> shipped.** The tool emits `hasEventAfterDeath1`, not
> `EVENT_AFTER_DEATH`, and it uses a death-like *family* rather than the
> exclusion list below. See "How `hasEventAfterDeath1` actually decides"
> immediately after this section for the shipped behaviour. The
> placeholder note at the top of this file anticipated the move to
> FamilySearch tags; that migration happened and these definitions were
> not updated with it. Kept here as the record of the original design,
> not as a description of current behaviour.

**Severity:** `contradiction`

**Condition:** The anchor has a Death fact with a parseable year, and
another fact (not in the exclusion list) whose earliest possible year
is after the latest possible death year.

**Post-death exclusions** (not flagged):
`Burial`, `Cremation`, `Obituary`, `Probate`, `Will`, `Estate`, `Funeral`

**Logic:**

```
POST_DEATH_TYPES = ["Burial", "Cremation", "Obituary", "Probate",
                    "Will", "Estate", "Funeral"]

deathFact = anchor.facts.find(f => f.type === "Death")
if (!deathFact) → skip

deathYear = extractLatestYear(deathFact.date)
if (deathYear == null) → skip

for each fact in anchor.facts:
  if (fact.type === "Death") → skip
  if (POST_DEATH_TYPES.includes(fact.type)) → skip

  eventYear = extractEarliestYear(fact.date)
  if (eventYear == null) → skip

  if (eventYear > deathYear) → emit warning
```

**Message:** `"{factType} ({eventYear}) is after death year ({deathYear}) for {personName}."`

**factIds:** `[deathFact.id, fact.id]`

**relatedPersonId:** omitted

---

### How `hasEventAfterDeath1` actually decides

This is the shipped behaviour, and it lives nowhere else in prose — only
in the docstring on `hasEventAfterDeath` in `src/tools/person-warnings.ts`.
Recorded here
because three separate pieces of skill doctrine were written against a
mental model this contradicts.

**There is no exclusion list.** The tag fires on

```
latest(every fact) - latest(death-like fact) > 365 days
```

(`hasEventAfterDeath` in `src/tools/person-warnings.ts`, via the predicate
`factDaysDiffLatestLatest` in `src/utils/fact-helpers.ts`.)

**"Death-like" is a family of nine fact types** (`DEATHLIKE_FACT_TYPES` in
`src/utils/mob.ts`):

`Death`, `Burial`, `Cremation`, `Funeral`, `Obituary`, `Probate`, `Will`,
`DeathRegistration`, `BurialRegistration`

Family membership *is* the mechanism. A fact of any of those nine types
raises the death-side anchor, so it can never fire the tag on its own —
however long after the death it is dated. That is why no exclusion list is
needed, and why adding one would be a behaviour change rather than a
tidy-up.

Three consequences a reader has to hold:

1. **A probate twenty years after death is silent.** It moves the anchor
   forward instead of tripping the check.
2. **The fact type is the trigger, not the date.** The same estate file is
   silent attached as a `Probate` fact and fires attached as a
   `Residence` fact. A posthumous record raises the tag only when it was
   typed outside the death-like family.
3. **A wrong date does damage in both directions.** A transcription or
   digitization date recorded as the event date, on a death-like fact,
   pushes the anchor *forward* and hides genuine post-death events (and
   inflates `hasAgeRangeGreaterThan120`). The same wrong date on any other
   fact type manufactures a post-death event that never happened.

Note the divergences from the superseded W3 above, since a reader
checking implementation against spec will hit them: the shipped code
requires no `Death` fact specifically, compares at 365-day tolerance
rather than year granularity, and has no `Estate` type anywhere in the
tool.

---

### Tag Catalogue

The full set of **74** tags the tool emits in `issueType`. Each row is
`Tag`, `Severity`, `Rule` (the condition that fires it), and `Cause`
(what it usually indicates). `scoreType` is `COHERENCE` for every tag.
The bidirectional drift lint
(`tests/packaging/person-warnings-spec-drift.test.ts`) keeps this
catalogue and `ALL_WARNING_TAGS` in exact agreement.

Numeric suffixes on a tag encode its threshold (e.g. `365` = 1 year of
day-level tolerance, `30_10` = a 300-day exact-day window, `2` = a
count-of-two). Tolerances are day-level unless the rule says otherwise;
imprecise dates are widened per § Date Parsing Rules.

#### Contradictions (`severity: "contradiction"`) — physically impossible

| Tag | Severity | Rule | Cause |
|-----|----------|------|-------|
| `hasEventBeforeBirth365_2` | contradiction | The person's earliest fact of any type is dated more than 2 years before their latest birth-like fact | Wrong birth date, wrong event attribution, or identity confusion |
| `hasEventAfterDeath1` | contradiction | An event is dated more than 1 year after the person's latest death-like fact (the nine-type death-like family raises the anchor; see the `hasEventAfterDeath1` section above) | A same-name person's records merged in, a wrong death date, or a posthumous mention typed outside the death-like family |
| `hasAgeRangeGreaterThan120` | contradiction | Earliest death-like year minus latest birth-like year is greater than 120 | Wrong birth or death date, or two people merged |
| `hasChristeningBeforeBirth` | contradiction | The latest Christening day is strictly before the earliest Birth day (year-only dates get a year of slack each side) | Data-entry error or wrong attribution |
| `hasEventBeforeChristening365_3` | contradiction | An event other than a Birth or event registration is dated more than 3 years before the latest Christening or Baptism | Wrong event attribution or two persons merged |
| `hasBurialBeforeDeath` | contradiction | Every recorded burial precedes every recorded death — compared on exact day-month-year dates when both sides have them, otherwise on years | Data error or transcription mistake |
| `hasDeathBeforeChildBirth30_10` | contradiction | Male anchor: the father's latest Death day is more than 300 days before a child's earliest Birth day (exact Death and Birth fact types, not the death-like/birth-like families; day-level, not restricted to full day-month-year dates) | Wrong death date or wrong child attribution |
| `hasDeathBeforeChildBirth365_2` | contradiction | Male anchor: the father's latest death-like fact is more than 2 years before a child's earliest birth-like fact (looser family-level variant) | Wrong death date or wrong parent-child link |
| `hasDeathBeforeChildBirthFemale365` | contradiction | Female anchor: the mother's latest death-like fact is more than 1 year before a child's earliest birth-like fact | Wrong death date or wrong mother attribution |
| `hasDeathBeforeChildBirthFemale2` | contradiction | Female anchor: the mother's latest Death day is more than 2 days before a child's earliest Birth day (exact Death and Birth fact types, not the death-like/birth-like families; a mother may die the day of birth, not 2+ days before) | Data error or wrong mother attribution |
| `hasEventsOutsideLifespanFar` | contradiction | Merge-mode only: merging places an event far outside the other record's lifespan (before its birth or after its death) | The two records are not the same person |
| `hasSameCensus` | contradiction | Merge-mode only: both records cite the same census collection (a census enumerates each person once) | The two records are distinct people captured in one enumeration |

#### Parent / child age and timing (`implausible`)

| Tag | Severity | Rule | Cause |
|-----|----------|------|-------|
| `earliestChildBirthToBirth12` | implausible | The person had a child at age 12 or younger | Wrong birth date on person or child, or wrong parent-child link |
| `earliestChildBirthToBirthMale14` | implausible | Father had a child at age 14 or younger | As above, male-gated |
| `latestChildBirthToBirth80` | implausible | A child was born 80 or more years after this person's birth | Wrong date or a generation skipped in the link |
| `latestChildBirthToBirthFemale45` | implausible | Mother was age 45 or older at a child's birth | Wrong date or wrong mother attribution |
| `earliestChildMarriageToBirth30` | implausible | A child married before this person reached age 30 | Very young parenthood, or a wrong date/link |
| `latestChildBirthToMarriage35` | implausible | A child was born 35 or more years after this person's latest marriage | A record from a later, unrecorded union, or a wrong date |
| `childMarriageToMarriage15` | implausible | A child married within 15 years of this person's earliest marriage (implies very young parenthood) | Wrong date or wrong link |
| `hasDeathAfterChildBirth90` | implausible | Died more than 90 years after the earliest child's birth | Wrong death date or wrong child attribution |
| `hasChildDeathAfterParentBirth200` | implausible | Died more than 200 years after the earliest parent's birth | Merged generations or a wrong date |
| `childBirthRange40` | implausible | The span between earliest and latest child's birth is 40 or more years | Children of two different people merged onto one parent |

#### Marriage timing (`implausible`)

| Tag | Severity | Rule | Cause |
|-----|----------|------|-------|
| `hasEarlyMarriage14` | implausible | Married before age 14 | Wrong marriage or birth date, or wrong attribution |
| `hasLateMarriage90` | implausible | Married more than 90 years after birth | Wrong date, or a record belonging to a same-name descendant |
| `hasYoungSpouse15` | implausible | A spouse died at age < 15 | An early-childhood record misattributed as a marriage |

#### Duplicate / conflicting records (`implausible`)

| Tag | Severity | Rule | Cause |
|-----|----------|------|-------|
| `tooManyBirthDates2` | implausible | Two or more distinct exact-DMY Birth dates spaced more than 30 days apart | Unreconciled conflicting sources, or two identities merged |
| `tooManyDeathDates2` | implausible | Two or more distinct exact-DMY Death dates spaced more than 14 days apart | As above |
| `deathRangeGreaterThan2` | implausible | Death-like dates span more than 2 years | Unreconciled conflicting death records |
| `hasBurialAfterDeath31` | implausible | Earliest Burial is more than 31 days before the latest Death (despite the Java name, fires on burial-before-death outliers; preserved for parity) | Conflicting or mis-typed burial/death dates |
| `birthRangeGreaterThan3` | implausible | Merge-mode only: the merged record's Birth facts span more than 3 years, with no shared marriage date to corroborate the join | The two records are different people |
| `birthLikeRangeGreaterThan8` | implausible | Merge-mode only: the merged record's birth-like facts span more than 8 years, with no shared marriage date | As above, at the looser birth-like tolerance |
| `hasCloseChildBirthsIgnoreSimilarChildren` | implausible | Two of this person's children (that are not already flagged as similar) have Birth dates suspiciously close together | Two records of one child attached as two children |
| `hasCloseChildChristenings6_30` | implausible | Two of this person's children whose names are similar have Christening/Baptism dates 2 to 180 days apart | Two records of one child attached as two children, on christening dates |
| `similarChildren` | implausible | Two children look like the same individual recorded twice (similar names and dates) | One child duplicated under two records |
| `similarChildrenConflictingDates` | implausible | Two children have similar names but conflicting dates | Same child recorded twice with a date discrepancy |
| `similarSpouses` | implausible | Two spouses look like the same individual recorded twice | One spouse duplicated |
| `similarSpousesConflictingDates` | implausible | Two spouses have similar names but conflicting dates | Same spouse recorded twice with a date discrepancy |
| `hasDissimilarSpousesWithSameMarriageYear` | implausible | Two spouses share a marriage year but have dissimilar names | Two marriage records conflated, or a mis-transcribed name |
| `hasEventsOutsideLifespanNear` | implausible | Merge-mode only: merging places an event slightly outside the other record's lifespan | A borderline mismatch worth checking before the merge |

#### Family structure and names (`implausible`)

| Tag | Severity | Rule | Cause |
|-----|----------|------|-------|
| `tooManyChildren18` | implausible | 18 or more children | Children of more than one person merged, or duplicate child records |
| `tooManyFathers2` | implausible | Two or more male parents (only one biological father is possible) | A step/adoptive father recorded as biological, or a wrong link |
| `tooManyMothers2` | implausible | Two or more female parents | As above |
| `missingFactsAndRelatives` | implausible | Empty stub: no facts other than `GenderChange`, and no relatives | An unfinished record |
| `hasBlankName` | implausible | A name entry carries a blank (empty-string) given name or surname part — distinct from a name part that is simply absent (see `missingSurnames`/`missingGivenNamesWithoutExactBirthLikeDate`) | An incomplete record |
| `hasDiffSurnameMale` | implausible | Male anchor has surnames that do not match each other (similarity ≤ 0.5) | Records from two same-given-name men merged |
| `missingSurnames` | implausible | No recorded surname | Incomplete record; hard to distinguish from same-given-name persons |
| `missingGivenNamesWithoutExactBirthLikeDate` | implausible | No recorded given name AND no exact birth-like date | Record too sparse to identify |

#### Relative-mob mirrors (`implausible`)

27 of the 47 self-checks above have a relative-mob variant that fires the
same condition on a one-hop relative (parent, spouse, or child) instead of
the anchor; the other 20 run on the anchor only. They are **always
`implausible`** regardless of the self-check's
severity — the anchor's own data isn't necessarily wrong; the issue is in
the relationship — and the flagged relative is named in the warning's
`personId`/`personName`. Prefix conventions: `relatives*` = any relative,
`maleRelatives*`/`femaleRelatives*` = gender-restricted. See each row's
mirrored self-check for the rule.

| Tag | Severity | Mirrors |
|-----|----------|---------|
| `relativesHasEventBeforeBirth365_2` | implausible | `hasEventBeforeBirth365_2` |
| `relativesHasEventAfterDeath1` | implausible | `hasEventAfterDeath1` |
| `relativesHasAgeRangeGreaterThan120` | implausible | `hasAgeRangeGreaterThan120` |
| `relativesHasEventBeforeChristening365_3` | implausible | `hasEventBeforeChristening365_3` |
| `relativesHasBurialBeforeDeath` | implausible | `hasBurialBeforeDeath` |
| `relativesHasBurialAfterDeath31` | implausible | `hasBurialAfterDeath31` |
| `relativesDeathRangeGreaterThan2` | implausible | `deathRangeGreaterThan2` |
| `relativesTooManyBirthDates2` | implausible | `tooManyBirthDates2` |
| `relativesTooManyDeathDates2` | implausible | `tooManyDeathDates2` |
| `relativesBirthLikeRangeGreaterThan8` | implausible | `birthLikeRangeGreaterThan8` |
| `relativesChildBirthRange40` | implausible | `childBirthRange40` |
| `relativesEarliestChildBirthToBirth12` | implausible | `earliestChildBirthToBirth12` |
| `maleRelativesEarliestChildBirthToBirth14` | implausible | `earliestChildBirthToBirthMale14` |
| `relativesLatestChildBirthToBirth80` | implausible | `latestChildBirthToBirth80` |
| `femaleRelativesLatestChildBirthToBirth45` | implausible | `latestChildBirthToBirthFemale45` |
| `relativesEarliestChildMarriageToBirth30` | implausible | `earliestChildMarriageToBirth30` |
| `relativesLatestChildBirthToMarriage35` | implausible | `latestChildBirthToMarriage35` |
| `relativesChildMarriageToMarriage15` | implausible | `childMarriageToMarriage15` |
| `relativesHasDeathAfterChildBirth90` | implausible | `hasDeathAfterChildBirth90` |
| `relativesHasChildDeathAfterParentBirth200` | implausible | `hasChildDeathAfterParentBirth200` |
| `relativesHasDeathBeforeChildBirth30_10` | implausible | `hasDeathBeforeChildBirth30_10` |
| `relativesHasDeathBeforeChildBirth365_2` | implausible | `hasDeathBeforeChildBirth365_2` |
| `femaleRelativesHasDeathBeforeChildBirth365` | implausible | `hasDeathBeforeChildBirthFemale365` |
| `femaleRelativesHasDeathBeforeChildBirth2` | implausible | `hasDeathBeforeChildBirthFemale2` |
| `relativesHasEarlyMarriage14` | implausible | `hasEarlyMarriage14` |
| `relativesHasLateMarriage90` | implausible | `hasLateMarriage90` |
| `maleRelativesHasDiffSurname` | implausible | `hasDiffSurnameMale` |

---

## Error Handling

### Why data-level conditions now throw

This changed as a direct result of the 2026-05-27 review, and the chain
is worth recording so it isn't "fixed" back later by mistake:

1. **What the original spec did.** Data-level conditions (missing file,
   unknown person, empty tree) **returned** a result carrying an
   explanatory string, e.g.
   `{ personsChecked: 0, message: "tree.gedcomx.json not found... Run person_read first." }`.
   The `message` field is what told the user what went wrong and what to
   do next.
2. **What the review removed.** Both `personsChecked` and the top-level
   `message` field were deleted ("keep it simple").
3. **The consequence of that removal.** The success output is now just
   `{ warningCount, warnings[] }`. So an empty result —
   `{ "warningCount": 0, "warnings": [] }` — became **ambiguous**: it
   could mean "checked the anchor, found nothing wrong" *or* "couldn't
   run at all, so nothing was checked." No field is left to tell those
   apart, which risks a silent failure (the user thinks the tree is
   clean when the tool never ran).
4. **What we resorted to.** These data-level conditions now **throw**
   instead of returning. The `index.ts` CallTool handler catches the
   throw and serializes it into a readable `{ error: ... }` result
   (`isError: true`), so the user still gets the actionable message
   ("run person_read first") — it is just framed as a failure rather than
   mistaken for a clean tree. The only normal-result case left is
   "anchor checked, no warnings found."

| Condition | Behavior |
|-----------|----------|
| `projectPath` not provided | Throw: `"projectPath is required"` |
| `personId` not provided | Throw: `"personId is required"` |
| `tree.gedcomx.json` is invalid JSON | Throw: `"Failed to parse tree.gedcomx.json: {parseError}"` |
| `projectPath` is a real directory holding **neither** project file | **Return**, do not throw: `{ ok: false, reason: "no_project", errors }`. The user is not in a research project, which is an answer rather than a failure. This is the one tool that owes this answer without reading through `readProjectJson`, so it calls `classifyProjectPath` itself. Discriminate the result with `"ok" in result` — the success shape has no `ok` field. See the write-boundary invariants in `guardrail-enforcement-spec.md` |
| `projectPath` is not an existing directory | Throw: `"projectPath does not exist: {projectPath}"` |
| `tree.gedcomx.json` not found at path, in a folder that *does* hold `research.json` | Throw: `"tree.gedcomx.json not found at {projectPath}. Run person_read first to populate the tree file."` — a broken project stays loud, and this message is the more useful one |
| `personId` not found | Throw: `"Person '{personId}' not found in tree.gedcomx.json."` |
| File has no `persons` array | Throw: `"No persons found in tree.gedcomx.json."` |
| Date is unparseable | `getStandardDate` returns `null`, warning check skips the fact silently |

The throw-vs-return behaviour above shipped. The `no_project` return row
was re-decided when the write-boundary invariants were settled, and the
diagnostic-field alternative to throwing was not adopted.

---

## Files

### `packages/engine/mcp-server/src/types/person-warnings.ts`

- `PersonWarningsInput` — `{ projectPath: string; personId: string }`
- `PersonWarning` — the warning object shape
- `PersonWarningsResult` — the output shape

### `packages/engine/mcp-server/src/tools/person-warnings.ts`

- `personWarningsTool(input)` — main function
- `personWarningsToolSchema` — MCP tool schema
- `ALL_WARNING_TAGS` — the array of every `issueType` tag the tool emits;
  imported by the drift lint as the shipped source of truth
- `getPersonName(person)` — display-name resolution, exported for tests
- One predicate function per check (e.g. `hasEventAfterDeath`,
  `earliestChildBirthToBirth`, `hasAgeRangeGreaterThan`), each exported
  for unit testing. Date handling is delegated to `src/utils/fact-helpers.ts`,
  `src/utils/date-standardize.ts`, and `src/utils/date-helpers.ts`
  (see § Date Parsing Rules) — there are no date-parsing helpers in this
  file.

### `packages/engine/mcp-server/src/index.ts`

Registered following the existing tool pattern (import, ListTools,
CallTool).

### `packages/engine/mcp-server/dev/try-person-warnings.ts`

Smoke-test script:

```bash
cd packages/engine/mcp-server
npx tsx dev/try-person-warnings.ts /path/to/project I1        # anchor person (required)
```

### `packages/engine/mcp-server/tests/tools/person-warnings.test.ts`

Unit tests (see Testing section below).

---

## Testing

Unit tests live in
`packages/engine/mcp-server/tests/tools/person-warnings.test.ts`. They
exercise the per-check predicates and the tool end-to-end against
fixture trees; there are no `extractYear`/`extractEarliestYear`/
`extractLatestYear` tests, because those helpers do not exist (date
handling is tested where it lives, under `src/utils/`).

**Per-tag coverage is partial.** Roughly half of the 74 tags are named
in that test file; the rest are covered indirectly or not at all. The
drift lint proves a tag is *documented and emitted*, never that its
catalogue entry reads correctly — so a reviewer verifying a
newly-derived entry must read the predicate, not lean on a test.

### Integration tests

| # | Scenario | Expected |
|---|----------|----------|
| 1 | File not found | Throws; message mentions "not found" |
| 2 | Invalid JSON | Throws parse error |
| 3 | Empty persons array | Throws "No persons found" |
| 4 | `personId` not in file | Throws; message mentions "not found" |
| 5 | Anchor with no facts | `warningCount: 0`, empty `warnings` array |
| 6 | Multiple warnings on the anchor | All warnings returned |
| 7 | File contains a person outside the anchor's mob with impossible data | That person is NOT reported (scoping) |
| 8 | Clean data, no warnings | `warningCount: 0`, empty `warnings` array |
| 9 | `personId` omitted | Throws "personId is required" |

---

## Extensibility

### This spec is the full catalogue

§ Tag Catalogue documents **every** tag the tool emits, and the drift
lint enforces that. The check-warnings skill's
`references/warning-checks.md` is a **curated, agent-facing subset** — it
does not have to list every tag. So a new tag must be documented here
and need not be added to that reference.

### How to add a new warning

1. Choose a camelCase tag name (e.g. `hasSomethingImplausible`), matching
   the FamilySearch MobWarnings convention already used.
2. Add its `const TAG = "hasSomethingImplausible";` and a `checkX(mob)`
   emitter in `src/tools/person-warnings.ts`, returning a `PersonWarning`
   with `scoreType: "COHERENCE"`, the chosen `issueType`, and a
   `severity` of `contradiction` or `implausible`.
3. Wire the check into `calculateWarnings` so it is emitted.
4. Add the tag to the `ALL_WARNING_TAGS` array.
5. Add unit tests in `tests/tools/person-warnings.test.ts`.
6. Add the tag's row to § Tag Catalogue in this spec.
7. Bump the three hardcoded tag-count assertions in
   `tests/packaging/person-warnings-spec-drift.test.ts` (the `toBe(74)` guards)
   to the new total.
8. **Run the drift lint** (`make engine-test`, or the
   `tests/packaging/person-warnings-spec-drift.test.ts` suite directly).
   It is bidirectional: it fails if the tag is emitted but undocumented,
   or documented but not emitted. Steps 4 and 6 both feed it.

No schema changes needed — warnings are a flat array of the same
`PersonWarning` shape.

### Future warning candidates

These are not yet implemented but are good candidates for extension.
Severities use the shipped vocabulary (`contradiction` / `implausible`),
renamed from the retired `error` / `warning`.

| Candidate | Severity | Description |
|-----------|----------|-------------|
| `FATHER_TOO_OLD` | `implausible` | Father's age at child's birth > 75. No shipped tag; the closest, `latestChildBirthToBirth80`, fires at 80+ |
| `BORN_TOO_EARLY` | `implausible` | Birth year < 1000 |

> **Struck — shipped:** several rows this table once listed have shipped,
> so they are struck the way `MOTHER_TOO_OLD` was:
> - `MOTHER_TOO_YOUNG` → `earliestChildBirthToBirth12`.
> - `LIVED_TOO_LONG` → `hasAgeRangeGreaterThan120`.
> - `BIRTH_AFTER_MOTHER_DEATH` → `hasDeathBeforeChildBirthFemale365`
>   (loose) and `hasDeathBeforeChildBirthFemale2` (exact-day).
> - `BIRTH_AFTER_FATHER_DEATH` → `hasDeathBeforeChildBirth365_2` (loose)
>   and `hasDeathBeforeChildBirth30_10` (exact-day).
> - `MARRIAGE_BEFORE_BIRTH` → covered by `hasEventBeforeBirth365_2`, which
>   fires on any event dated more than 2 years before birth, marriage
>   included.
> - `CHILD_TOO_OLD` → covered by the `earliestChildBirthToBirth` family: a
>   child older than the parent yields a parent-age below the cutoff and
>   fires the check.
>
> **Removed in review:** `DUPLICATE_FACTS` (multiple facts of the same
> type with identical dates) was dropped — the same birth date
> legitimately appears in, e.g., a civil registration and a christening
> record, so it isn't a problem (Richard). Some candidates above —
> notably mother/father child-spacing checks — need **full-date**
> precision, not year-only; see the date-parsing note.
>
> **`MOTHER_TOO_OLD` struck — built:** shipped as
> `latestChildBirthToBirthFemale45` (`person-warnings.ts`), female-gated,
> on a >= cutoff (not the `> 50` this table listed). Cutoff is 45, lowered
> from an original 55; severity unchanged (`implausible`, not promoted — the
> check fired 0 times at 55 across the e2e corpus, so promotion would be
> an unmeasured doctrine commitment). Two alternatives were rejected: a
> gender-neutral 45 (flags 31 people vs. 6, 25 of them men — a 45-74 gap
> is unremarkable for a father, unlike a mother); and keeping 55 plus a
> second check banded to [50, 55) (superseded once both bands share one
> severity, since two checks on one predicate double-fire on a single fact
> and double-count in the check-warnings cluster rule).

---

## Verification

### Automated

```bash
cd packages/engine/mcp-server && npm run build && npm test
```

### Manual Layer 1 (MCP Inspector)

```bash
npx @modelcontextprotocol/inspector node build/index.js
```

- Call `person_warnings({ projectPath: "/path/to/project", personId: "I1" })`
  — checks the anchor and its one-hops
- Call `person_warnings({ projectPath: "/path/to/project" })` — throws
  (personId is required)
- Call `person_warnings({ projectPath: "/nonexistent", personId: "I1" })`
  — throws file-not-found
- Call `person_warnings({ projectPath: "/path/to/project", personId: "ZZZZ" })`
  — throws person-not-found

### Manual Layer 2 (Claude Code)

- "Check Patrick (I1) for data problems" — Claude should call
  `person_warnings` with `personId: "I1"`
- "Are there any warnings for person I1?" — Claude should call
  `person_warnings` with `personId: "I1"`

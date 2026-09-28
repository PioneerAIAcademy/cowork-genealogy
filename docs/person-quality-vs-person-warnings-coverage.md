# FamilySearch quality issues vs. `person_warnings` — coverage table

**Measured 2026-09-26 against `main` at `d4ee13393`; #2727's changes to `person_warnings` (the D6 facts, the burial pairing) move no row.** Step 2 of issue #2225: every
FamilySearch quality `issueType` set against the `person_warnings` tag catalogue, so
the uncovered set is counted rather than asserted. Step 3 was to add checks only for what
this table leaves uncovered; it was ruled none (§ Step 3: ruled none). The tally is under "The count" below.

## What was compared

- **FamilySearch side:** the 58 distinct `issueType`s with a sentence template in
  [`person-quality-templates.ts`](../packages/engine/mcp-server/src/tools/person-quality-templates.ts):
  55 in `BY_ISSUE_TYPE`, 2 that vary by conclusion type (`OLD_BIRTH`, `YOUNG_BIRTH`
  in `BY_ISSUE_AND_CONCLUSION`), and `IMPOSSIBLE_EVENT_ORDER`, whose event pairs are
  broken out in its own row below. That set is **what has been transcribed, not
  everything the API can return.** The source PDF has rows with a blank or "Coming
  Soon" template (`NO_INDEXED_CONCLUSION_SOURCES` and `MISSING_GIVEN_NAME` are named
  in [`person-quality-tool-spec.md`](specs/person-quality-tool-spec.md) § Missing-template
  fallback), and the API may add types. Those are not counted, and a live profile can
  surface one through the fallback sentence.
- **`person_warnings` side:** the 74 tags in the § Tag Catalogue of
  [`person-warnings-tool-spec.md`](specs/person-warnings-tool-spec.md): 47 self-checks
  plus 27 relative mirrors. `person-warnings-spec-drift.test.ts` holds that catalogue
  and `ALL_WARNING_TAGS` in exact agreement, so 74 is the shipped count.
- **No live profiles were read.** Every verdict comes from the template text and the
  tag rules, not from observed co-occurrence on a real person. Where the FamilySearch
  threshold is unpublished (its `profile*` fields come from a norm we never see), the
  row says so.

**Verdicts.** *Covered*: `person_warnings` fires on the same condition, possibly at a
different threshold. *Partial*: it catches a narrower case, catches it only in merge
mode, or catches it only indirectly through another rule. *Uncovered*: no tag fires on
the condition. **Unsure** marks a row where the verdict is a judgement a genealogist
should confirm.

One structural fact decides most of the table: **every `person_warnings` tag is
`scoreType: COHERENCE`.** It reads a person's own facts and one-hop relationships and
nothing else. It never reads source tagging, source content or a place authority. So the
COMPLETENESS, VERIFIABILITY and CONSISTENCY categories are almost entirely uncovered
**by design**, and the column "Tree-decidable?" separates those from real gaps.
*Tree-decidable* means the condition can be decided from `tree.gedcomx.json` alone,
which is the only thing an offline check can read.

## COMPLETENESS (12)

| FamilySearch `issueType` | Verdict | `person_warnings` tag(s) | Tree-decidable? | Note |
|---|---|---|---|---|
| `DAY_NOT_SPECIFIED` | Uncovered | — | yes | A completeness nag, not a coherence fault |
| `MONTH_NOT_SPECIFIED` | Uncovered | — | yes | As above |
| `YEAR_NOT_SPECIFIED` | Uncovered | — | yes | As above |
| `MISSING_EVENT` | Uncovered | — | yes | `missingFactsAndRelatives` fires only on an empty stub, not a missing single event |
| `MISSING_EVENT_PLACE` | Uncovered | — | yes | |
| `MISSING_PLACE_JURISDICTIONS` | Uncovered | — | no | Needs the place hierarchy |
| `MISSING_EVENT_DATE` | Uncovered | — | yes | |
| `NON_STANDARD_PLACE` | Uncovered | — | partly | Tree carries `standard_place`; its absence is visible |
| `NON_STANDARD_DATE` | Uncovered | — | partly | Tree carries `standard_date`; as above |
| `NO_GIVEN_NAME_FOUND` | Partial | `missingGivenNamesWithoutExactBirthLikeDate`, `hasBlankName` | yes | The first fires only when there is also no exact birth-like date |
| `NO_SURNAME_FOUND` | Covered | `missingSurnames` (also `hasBlankName`) | yes | |
| `NO_GENDER_FOUND` | Uncovered | — | yes | |

## VERIFIABILITY (6)

| FamilySearch `issueType` | Verdict | `person_warnings` tag(s) | Tree-decidable? | Note |
|---|---|---|---|---|
| `MISSING_TAGGED_SOURCE` | Uncovered | — | no | Tagging lives on the live profile |
| `MISSING_TAGGED_SOURCE_INFORMATIONAL` | Uncovered | — | no | |
| `TOO_FEW_TAGGED_SOURCES` | Uncovered | — | no | |
| `TOO_FEW_TAGGED_SOURCES_INFORMATIONAL` | Uncovered | — | no | |
| `MISSING_EXPECTED_CENSUS` | Uncovered | — | no | Needs collection coverage |
| `MULTIPLE_TAGS_IN_SAME_CENSUS` | Partial | `hasSameCensus` | partly | Merge mode only: fires when two records being merged cite one census, never on a single profile carrying two same-year census sources |

## CONSISTENCY (11)

All profile-versus-source comparisons, which `person_warnings` never makes.

| FamilySearch `issueType` | Verdict | `person_warnings` tag(s) | Tree-decidable? | Note |
|---|---|---|---|---|
| `DATE_MISMATCH` | Uncovered | — | no | Needs the source's indexed value |
| `DATE_PARTIAL_MISMATCH` | Uncovered | — | no | |
| `GENDER_MISMATCH` | Uncovered | — | no | |
| `PLACE_MISMATCH` | Uncovered | — | no | |
| `GIVEN_NAME_MISMATCH` | Uncovered | — | no | |
| `SURNAME_MISMATCH` | Uncovered | — | no | |
| `MISSING_SURNAME` | Uncovered | — | no | "A possible last name is in this source" |
| `NO_SOURCES` | Uncovered | — | yes | Tree `sources[]` is visible, but this is not a coherence fault |
| `NO_INDEXED_SOURCES` | Uncovered | — | partly | |
| `GIVEN_NAME_FIELD_MISMATCH` | Uncovered | — | yes | Name-shape: no given name, several surnames |
| `SURNAME_FIELD_MISMATCH` | Uncovered | — | yes | Name-shape: no surname, several given names |

## COHERENCE (29)

| FamilySearch `issueType` | Verdict | `person_warnings` tag(s) | Tree-decidable? | Note |
|---|---|---|---|---|
| `FATHER_COUNT` | Covered | `tooManyFathers2` | yes | |
| `MOTHER_COUNT` | Covered | `tooManyMothers2` | yes | |
| `PARTNER_DIED_TOO_YOUNG_FOR_COUPLE_RELATIONSHIP` | Covered | `hasYoungSpouse15` | yes | Ours fires at spouse death age < 15; FamilySearch's age is unpublished |
| `CHILDREN_BORN_TOO_CLOSE` | Covered | `hasCloseChildBirthsIgnoreSimilarChildren` | yes | Ours: two non-similar children's exact births 2–240 days apart |
| `COPARENTS_CHILDREN_BORN_TOO_CLOSE` | Covered | `hasCloseChildBirthsIgnoreSimilarChildren` | yes | Same check run on the father: the coparent's children are his |
| `YOUNG_BIRTH` | Covered | `earliestChildBirthToBirth12`, `earliestChildBirthToBirthMale14` (+ mirrors) | yes | Thresholds 12 / male 14; FamilySearch's are unpublished |
| `CHILD_COUNT` | Partial | `tooManyChildren18` | yes | Ours is a fixed 18; FamilySearch compares to a per-profile norm (`profileChildCount`), likely lower |
| `OLD_DEATH` | Partial | `hasAgeRangeGreaterThan120` | yes | Ours fires above 120, as an impossibility; FamilySearch's "older than usual" is a lower norm |
| `OLD_MARRIAGE` | Partial | `hasLateMarriage90` | yes | Same shape: our extreme vs. their norm |
| `YOUNG_MARRIAGE` | Partial | `hasEarlyMarriage14` | yes | **Unsure** whether this is Covered: depends on FamilySearch's unpublished norm |
| `OLD_BIRTH` | Partial | `latestChildBirthToBirth80`, `latestChildBirthToBirthFemale45` (+ mirrors) | yes | A father has only the 80-year check |
| `PARENT_DIED_TOO_YOUNG_FOR_CHILDREN` | Partial | indirect: `earliestChildBirthToBirth12` / `hasDeathBeforeChildBirth*` mirrors | yes | **Unsure.** A parent dead at D years has a child born at age ≤ D or after death, so one of ours fires when D ≤ 12. Between 12 and FamilySearch's age, nothing fires |
| `DIED_TOO_YOUNG_FOR_CHILDREN` | Partial | indirect, as above, on the anchor | yes | **Unsure**, same gap |
| `COPARENT_DIED_TOO_YOUNG_FOR_CHILDREN` | Partial | indirect, through the relative mirrors | yes | **Unsure**, same gap |
| `DIED_TOO_YOUNG_FOR_COUPLE_RELATIONSHIP` | Partial | `hasEarlyMarriage14`; `hasYoungSpouse15` when run on the spouse | yes | On the anchor, fires only if a marriage date exists |
| `IMPOSSIBLE_EVENT_ORDER` | Partial | see the breakdown below | yes | Covered in substance, but ours tolerates 1–2 years where FamilySearch's order is strict |
| `DELAYED_BURIAL` | Uncovered | — | yes | **Naming trap:** `hasBurialAfterDeath31` fires on burial *before* death (its spec row says so). Burial is in the death-like family, so `hasEventAfterDeath1` cannot fire on it either |
| `OLD_CHRISTENING` | Uncovered | — | yes | `hasEventBeforeChristening365_3` is a different condition |
| `BORN_BEFORE_PARENTS_MARRIED` | Uncovered | — | yes | Listed under "NOT currently checked" in `warning-checks.md`. **Unsure** whether it should be a warning at all: it is common and often true |
| `CHILD_BORN_BEFORE_MARRIAGE` | Uncovered | — | yes | The same condition from the parent's side |
| `CHILD_OF_CHILDLESS_COUPLE` | Uncovered | — | yes | Needs a "No Children" fact. The converter keeps FamilySearch's fact type name, but no fixture in the repo carries one |
| `NO_CHILDREN_CONFLICT` | Uncovered | — | yes | As above, person-level fact |
| `COUPLE_NEVER_HAD_CHILDREN_FACT_YET_HAS_CHILDREN` | Uncovered | — | yes | As above, couple-level fact |
| `NO_COUPLE_RELATIONSHIPS_CONFLICT` | Uncovered | — | yes | As above, "No Couple Relationships" fact |
| `STILLBIRTH_CONFLICT` | Uncovered | — | yes | Needs a stillbirth fact; same caveat |
| `DATE_PLACE_MISMATCH` | Uncovered | — | no | Needs a place's valid date range from the Places API |
| `DATE_PLACE_MISMATCH_UNKNOWN_FROM_YEAR` | Uncovered | — | no | As above |
| `DATE_PLACE_MISMATCH_UNKNOWN_TO_YEAR` | Uncovered | — | no | As above |
| `ALTERNATING_LOCATIONS` | Uncovered | — | no | Needs distances between places |

### `IMPOSSIBLE_EVENT_ORDER`, by event pair

| Pair (first happened before second) | Our coverage |
|---|---|
| `DEATH:CHILD_BIRTH` | `hasDeathBeforeChildBirth*` (father 300 days / 2 years, mother 2 days / 1 year) |
| `PARENT_DEATH:BIRTH` | The same checks through their relative mirrors |
| `BIRTH:PARENT_BIRTH`, `CHILD_BIRTH:BIRTH` | `earliestChildBirthToBirth12` (a negative parental age is ≤ 12) |
| `DEATH:PARENT_BIRTH` | Indirect, as the row above |
| `CHRISTENING:PARENT_BIRTH` | **Unsure**: indirect only if the child's birth is also recorded |
| `DEATH:SPOUSE_BIRTH`, `SPOUSE_DEATH:BIRTH` | **Unsure**: no rule compares one spouse's death with the other's birth. A dated marriage may trip `relativesHasEventBeforeBirth365_2` |
| Same-person pairs (burial before death, christening before birth, any event before birth or after death) | `hasBurialBeforeDeath`, `hasChristeningBeforeBirth`, `hasEventBeforeBirth365_2`, `hasEventAfterDeath1` |

## The count

| Category | Covered | Partial | Uncovered | Total |
|---|---|---|---|---|
| COMPLETENESS | 1 | 1 | 10 | 12 |
| VERIFIABILITY | 0 | 1 | 5 | 6 |
| CONSISTENCY | 0 | 0 | 11 | 11 |
| COHERENCE | 6 | 10 | 13 | 29 |
| **All** | **7** | **12** | **39** | **58** |

**39 of 58 FamilySearch issue types are uncovered.** Most of those gaps are
structural, not missing checks:

- **26** are COMPLETENESS, VERIFIABILITY or CONSISTENCY. They need source tags, source
  content or the place hierarchy, or they are completeness nags rather than
  contradictions. None of them is coherence, which is all `person_warnings` checks.
- **4** are COHERENCE but need a place authority (`DATE_PLACE_MISMATCH` ×3,
  `ALTERNATING_LOCATIONS`), so an offline check cannot decide them.
- **9** are COHERENCE and decidable from the tree alone. **These are the step-3
  candidates.** They reduce to **6 distinct conditions**, because FamilySearch reports
  some conditions from several people's points of view:
  1. burial long after death (`DELAYED_BURIAL`);
  2. christening at an old age (`OLD_CHRISTENING`);
  3. a child born before the parents' marriage (`BORN_BEFORE_PARENTS_MARRIED`,
     `CHILD_BORN_BEFORE_MARRIAGE`);
  4. a "No Children" fact contradicted by children (`CHILD_OF_CHILDLESS_COUPLE`,
     `NO_CHILDREN_CONFLICT`, `COUPLE_NEVER_HAD_CHILDREN_FACT_YET_HAS_CHILDREN`);
  5. a "No Couple Relationships" fact contradicted (`NO_COUPLE_RELATIONSHIPS_CONFLICT`);
  6. a stillbirth fact contradicted by a later life (`STILLBIRTH_CONFLICT`).

The 12 partials are mostly **threshold** differences: ours fires at an extreme, while
FamilySearch compares against a norm it does not publish. Four of the partials are
marked unsure.

## Step 3: ruled none

**Ruling (Promise, 2026-09-26): add no checks.** For any person linked to FamilySearch,
`person_quality` already reports all 6 conditions, and check-warnings calls it beside
`person_warnings`. A local copy would add something only for a person with no
FamilySearch link. For everyone else it would put two answers to one question in front
of the researcher, which step 3 of #2225 warns against. So step 3 of #2225 is "none",
and this table closes the issue.

What that leaves: a person with no FamilySearch link gets none of the 6 conditions. If
that case turns out to matter, the narrowest design is to report them only when
`person_quality` cannot score the person, and only conditions 1, 4, 5 and 6. Condition 3,
a birth before the parents' marriage, is common and frequently true, and
`warning-checks.md` excludes it on purpose.

## The reverse direction: `person_warnings` checks with no FamilySearch counterpart

Context, not gaps. None of these appears among the 58 templates:

- **Duplicate and conflicting records:** `similarChildren`, `similarChildrenConflictingDates`,
  `similarSpouses`, `similarSpousesConflictingDates`, `hasDissimilarSpousesWithSameMarriageYear`,
  `hasCloseChildChristenings6_30`, `tooManyBirthDates2`, `tooManyDeathDates2`,
  `deathRangeGreaterThan2`.
- **Generation-span and timing extremes:** `childBirthRange40`, `earliestChildMarriageToBirth30`,
  `latestChildBirthToMarriage35`, `childMarriageToMarriage15`, `hasDeathAfterChildBirth90`,
  `hasChildDeathAfterParentBirth200`.
- **Identity:** `hasDiffSurnameMale` (two same-given-name men merged), `missingFactsAndRelatives`.
- **Merge mode only:** `hasEventsOutsideLifespanFar`, `hasEventsOutsideLifespanNear`,
  `birthRangeGreaterThan3`, `birthLikeRangeGreaterThan8`.
- `hasBurialAfterDeath31` overlaps FamilySearch's strict burial-before-death ordering, with a
  31-day tolerance.

## Two discrepancies this measurement turned up

Both are in `packages/engine/plugin/skills/check-warnings/references/warning-checks.md`.
That file is inside check-warnings' run-log snapshot, so correcting it buys a paid run.
With step 3 ruled none, it rides with check-warnings' next scheduled run.

- **Its "NOT currently checked" list names child spacing** ("two children born less than
  9 months apart"), but `hasCloseChildBirthsIgnoreSimilarChildren` checks exactly that, at
  2–240 days. A skill following the file is told not to report a condition its own tool
  returns.
- **Its relative-mob list names 17 tags;** the spec's catalogue has 27.

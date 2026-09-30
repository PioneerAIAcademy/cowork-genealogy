# FamilySearch quality issues vs. `person_warnings` — coverage table

**Measured 2026-09-26 against `main` at `d4ee13393`; #2727's changes to `person_warnings` (the D6 facts, the burial pairing) move no row. Updated for PR #2994, which adds four checks and corrects the rows that counted a merge-only check.** Step 2 of issue #2225: every
FamilySearch quality `issueType` set against the `person_warnings` tag catalogue, so
the uncovered set is counted rather than asserted. Step 3 was to add checks only for what
this table leaves uncovered; PR #2994 added four (§ Step 3), and the rows below include them. The tally is under "The count" below.

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
- **`person_warnings` side:** the 78 tags in the § Tag Catalogue of
  [`person-warnings-tool-spec.md`](specs/person-warnings-tool-spec.md): 51 self-checks
  plus 27 relative mirrors. `person-warnings-spec-drift.test.ts` holds that catalogue
  and `ALL_WARNING_TAGS` in exact agreement, so 78 is the shipped count. Not every tag
  fires in `person_warnings`: the catalogue marks the ones that fire only in merge mode
  (`merge_warnings`), and a verdict below counts only what `person_warnings` runs.
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
| `NO_GIVEN_NAME_FOUND` | Partial | `missingGivenNamesWithoutExactBirthLikeDate`, `hasBlankName` | yes | The first fires only in merge mode, and only when there is also no exact birth-like date. In `person_warnings`, `hasBlankName` fires on a blank given name, not an absent one |
| `NO_SURNAME_FOUND` | Partial | `missingSurnames`, `hasBlankName` | yes | `missingSurnames` fires only in merge mode. In `person_warnings`, `hasBlankName` fires on a blank surname, not an absent one |
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
| `DELAYED_BURIAL` | Partial | `hasDelayedBurial365` | yes | Ours fires above 365 days, as `implausible`; FamilySearch compares against a norm it does not publish. **Naming trap:** `hasBurialAfterDeath31` is the opposite condition, burial *before* death |
| `OLD_CHRISTENING` | Uncovered | — | yes | `hasEventBeforeChristening365_3` is a different condition |
| `BORN_BEFORE_PARENTS_MARRIED` | Uncovered | — | yes | Listed under "NOT currently checked" in check-warnings' tag catalogue. **Unsure** whether it should be a warning at all: it is common and often true |
| `CHILD_BORN_BEFORE_MARRIAGE` | Uncovered | — | yes | The same condition from the parent's side |
| `CHILD_OF_CHILDLESS_COUPLE` | Covered | `hasNoChildrenConflict` | yes | The person is a biological or unspecified child of both partners of a couple marked `CoupleNeverHadChildren` |
| `NO_CHILDREN_CONFLICT` | Covered | `hasNoChildrenConflict` | yes | The person's own `NoChildren` fact. Adoptive, step, foster and guardian children do not count |
| `COUPLE_NEVER_HAD_CHILDREN_FACT_YET_HAS_CHILDREN` | Covered | `hasNoChildrenConflict` | yes | A biological or unspecified child of both partners |
| `NO_COUPLE_RELATIONSHIPS_CONFLICT` | Covered | `hasNoCoupleRelationshipsConflict` | yes | |
| `STILLBIRTH_CONFLICT` | Covered | `hasStillbirthConflict` | yes | A spouse, a marriage, a child, or a death at least a year after birth |
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
| `DEATH:SPOUSE_BIRTH`, `SPOUSE_DEATH:BIRTH` | None in `person_warnings`: no rule compares one spouse's death with the other's birth. `relativesHasEventBeforeBirth365_2`, which a dated marriage could trip, fires only in merge mode |
| Same-person pairs (burial before death, christening before birth, any event before birth or after death) | `hasBurialBeforeDeath`, `hasChristeningBeforeBirth`, `hasEventBeforeBirth365_2`, `hasEventAfterDeath1` |

## The count

| Category | Covered | Partial | Uncovered | Total |
|---|---|---|---|---|
| COMPLETENESS | 0 | 2 | 10 | 12 |
| VERIFIABILITY | 0 | 1 | 5 | 6 |
| CONSISTENCY | 0 | 0 | 11 | 11 |
| COHERENCE | 11 | 11 | 7 | 29 |
| **All** | **11** | **14** | **33** | **58** |

**33 of 58 FamilySearch issue types are uncovered.** Most of those gaps are
structural, not missing checks:

- **26** are COMPLETENESS, VERIFIABILITY or CONSISTENCY. They need source tags, source
  content or the place hierarchy, or they are completeness nags rather than
  contradictions. None of them is coherence, which is all `person_warnings` checks.
- **4** are COHERENCE but need a place authority (`DATE_PLACE_MISMATCH` ×3,
  `ALTERNATING_LOCATIONS`), so an offline check cannot decide them.
- **3** are COHERENCE and decidable from the tree alone, and left out on purpose:
  `OLD_CHRISTENING`, `BORN_BEFORE_PARENTS_MARRIED` and `CHILD_BORN_BEFORE_MARRIAGE`
  (§ Step 3).

Half of the 14 partials are **threshold** differences: ours fires at an extreme, while
FamilySearch compares against a norm it does not publish. The rest catch a narrower
case, catch it only in merge mode, or catch it only indirectly. Four of the partials
are marked unsure.

## Step 3: four checks added

The 2026-09-26 ruling (Promise) was to add no checks, because check-warnings called
`person_quality` beside `person_warnings`. The lead has since asked for
`person_quality` to be dropped from check-warnings (issue #2967, 2026-09-28), so that
premise no longer holds. At the lead's request, PR #2994 adds `hasDelayedBurial365`,
`hasNoChildrenConflict`, `hasNoCoupleRelationshipsConflict` and `hasStillbirthConflict`.
They run for every person in the project tree, linked to FamilySearch or not.

Still uncovered on purpose: an old christening, and a birth before the parents'
marriage. The second is common and frequently true, and check-warnings' tag
catalogue excludes it.

## The reverse direction: `person_warnings` checks with no FamilySearch counterpart

Context, not gaps. None of these appears among the 58 templates:

- **Duplicate and conflicting records:** `similarChildren`, `similarChildrenConflictingDates`,
  `similarSpouses`, `similarSpousesConflictingDates`, `hasDissimilarSpousesWithSameMarriageYear`,
  `tooManyBirthDates2`, `tooManyDeathDates2`, `deathRangeGreaterThan2`.
- **Generation-span and timing extremes:** `childBirthRange40`, `earliestChildMarriageToBirth30`,
  `latestChildBirthToMarriage35`, `childMarriageToMarriage15`, `hasDeathAfterChildBirth90`,
  `hasChildDeathAfterParentBirth200`.
- **Identity:** `hasDiffSurnameMale` (two same-given-name men merged), `missingFactsAndRelatives`.
- **Merge mode only:** `hasEventsOutsideLifespanFar`, `hasEventsOutsideLifespanNear`,
  `birthRangeGreaterThan3`, `birthLikeRangeGreaterThan8`, `hasCloseChildChristenings6_30`.
- `hasBurialAfterDeath31` overlaps FamilySearch's strict burial-before-death ordering, with a
  31-day tolerance.

## What this measurement turned up in check-warnings' tag catalogue

Appendix A of `packages/engine/plugin/agents/check-warnings.md` (formerly
`skills/check-warnings/references/warning-checks.md`) is check-warnings' tag catalogue.
PR #2994 corrects it, with the check-warnings run that needs:

- **Its "NOT currently checked" list named child spacing** ("two children born less
  than 9 months apart"), but `hasCloseChildBirthsIgnoreSimilarChildren` checks two exact
  births 2–240 days apart. A skill following the file was told not to report a condition
  its own tool returns. The list now names only what falls outside that window.
- **Six tags `person_warnings` emits had no entry:** `similarChildren`,
  `similarChildrenConflictingDates`, `similarSpouses`, `similarSpousesConflictingDates`,
  `hasCloseChildBirthsIgnoreSimilarChildren` and `hasDissimilarSpousesWithSameMarriageYear`.
  Each now has one.
- **Its relative-mob list names 17 tags, and that is correct.** An earlier version of this
  section called it a discrepancy against the spec's 27. The other 10 relative mirrors fire
  only in merge mode, which `person_warnings` never enters, and the spec now marks them.

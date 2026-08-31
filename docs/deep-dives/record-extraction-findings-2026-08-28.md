# record-extraction deep dive — findings, 2026-08-28

Issue #1666. Procedure: [`docs/skill-deep-dive-guide.md`](../skill-deep-dive-guide.md).
Step-1 output lives beside this file as
[`record-extraction-prohibition-list.md`](./record-extraction-prohibition-list.md) —
107 transcript-checkable rules from the router and the agent. Read that first; the
findings below are numbered against it where a rule exists.

**Corpus.** The five unit run logs committed when this dive started — `v1_2026-08-15_12-52-37`,
`v1_2026-08-16_11-26-54`, `v1_2026-08-16_13-06-08`, `v1_2026-08-17_18-57-51`,
`v1_2026-08-24_17-40-15` — 138 runs, 121 of which persisted, 2,416 assertions and 121
sources written. Transcripts, `tool_calls` and `file_changes` read before any
`outcome_summary`, judge rationale or `.ann.json`, per the guide.

> **Three of those five are not on `main` any more, and this PR is what removed them.**
> The harness keeps the newest 5 candidates per skill and prunes on every write
> (`prune_old_candidates`, `DEFAULT_KEEP_CANDIDATES`), so committing the three fresh runs
> below evicted `v1_2026-08-15_12-52-37`, `v1_2026-08-16_11-26-54` and
> `v1_2026-08-16_13-06-08` with their `.ann.json` siblings. Every count on this page was
> computed before that, against all five. To re-derive any of them, read the three evicted
> logs at this PR's merge-base:
> `git show <base>:eval/runlogs/unit/record-extraction/v1_2026-08-15_12-52-37.json`.
> The two surviving logs plus the three fresh ones are what a reader finds on `main`.

**Fourteen findings. Nine convert to validator requests** (§Validator requests). Two
lane-2 fixes were attempted on a paid run: one is kept (§F5), one was reverted after it
misgraded (§F1, §Lane-2 fixes attempted). A third is deliberately *not* attempted and §F7
says why.

---

## Read this before quoting any number from this corpus

**The five logs span two incompatible `evidence_type` doctrines.** Commit `61d7f919`
(2026-08-21, #1628/#1706) rewrote the agent body to "Stated-vs-inferred, NOT who
reported it — and there is no exception" **and** flipped this suite's matchers in the
same PR: `death-certificate-named-informant.json` went from requiring
`age: indirect`, `birth/place: indirect`, `father_of_deceased/name: indirect` to
requiring `direct` for all three.

So `ut_record_extraction_009` writes those facts `indirect` in the three logs before
2026-08-17 and `direct` in the two after. **That is not three failures.** The three
older runs were correct under the doctrine of their day, and their
`test_expected_classifications` passed for the right reason. The 2026-08-17 log is the
fresh run that PR bought — it was executed on 08-17 against the edited working tree
and committed with the doctrine change on 08-21, which is why its timestamp precedes
the commit that changed what it asserts.

The agent body was edited **eight times between 2026-08-14 and 2026-08-24**. Any rate
computed across all 138 runs for a classification behaviour is meaningless.

Practical rule I used, and recommend to the next auditor:

- **Classification findings** (evidence_type, information_quality, proximity): cite
  only `v1_2026-08-17_18-57-51` and `v1_2026-08-24_17-40-15` — 56 runs, 50 persisting.
- **Structural findings** (role tokens, `record_id`, negative-evidence shape,
  delegation contents, output economy): all five logs are fair, because those rules
  have been stable since 2026-07-12 (`84a6422e`) or 2026-08-03 (`36edfdec`).
  Each finding below states the `git log -S` check that establishes its window.

This trap cost me three draft findings. It is the single most useful thing on this page.

---

## What the three fresh runs changed

#1666 buys this skill's eval slot, and it was spent three times: `v1_2026-08-28_17-43-01`
with both lane-2 fixes in place, then `v1_2026-08-28_18-23-42` after the `ut_014` bullet
was reverted (see below), then `v1_2026-08-31_10-34-08` after the `ut_021` judge_context
was repinned off `record-extractor.md`'s line numbers (`eadfee34`). 28 tests each; $8.82,
$9.00 and $8.89; 26, 26 and 72 minutes. Outcomes went 20 pass / 4 partial / 4 fail →
**24 pass / 3 partial / 1 fail** → **23 pass / 4 partial / 1 fail**. All three used judge
prompt `03f306ff`, so they are comparable to each other but none is comparable to the
08-24 baseline, which `check_runlogs` flags as scored under `0d186137`.

**The third run is jitter, not a regression, and it is not yet annotated.** Seven tests
moved and they moved both ways — `ut_005` and `ut_027` partial→pass, `ut_014` fail→pass,
against `ut_016`, `ut_023` and `ut_026` pass→partial and `ut_022` pass→fail; the single
fail relocated from `ut_014` to `ut_022` rather than persisting. `ut_021`, the only test
whose fixture this run changed, scored identically in both runs (`Correctness` 2, every
other dimension 3) for the same reason — §F5's blank-field negative reproducing. Its
`review_sample` (`ut_010`, `ut_014`, `ut_020`, `ut_024`, `ut_026`) has no `.ann.json`
yet, so unlike `v1_2026-08-28_18-23-42` this log carries no human overlay.

**The pair is a clean natural experiment**, because `judge_context` reaches the judge and
never the skill: the revert cannot have changed what the skill wrote, so the difference
between the two `ut_014` runs is pure run-to-run variance in the skill, and the difference
in *grading* is the bullet.

### F1 and F2 both reproduced live — this is the headline

| | run 1 (bullet present) | run 2 (bullet reverted) |
|---|---|---|
| roles written | `head_of_household`, `resident_1`, `resident_2`, `resident_3` | `head_of_household`, **`child_1` = Thomas Flynn (42)**, **`child_2` = Mary Flynn (38)**, `child_3` = Patrick Flynn (15) |
| relationship assertions | 0 | 0 |
| `test_expected_classifications` | passed (nothing matched the optional `child_1` matcher) | **failed** |
| judge | ran, `Correctness 1` | **skipped** — the validator decided it first |

Run 2 reproduced the exact 2026-08-17 defect, and failed with the **identical** message:

> `assertions[a_012] (record_role='child_1', fact_type='birth' attribute='place'): value='Ireland' — expected to contain 'Pennsylvania'`

Every birthplace in that run is correct. So **F2 is confirmed verbatim on a fresh run**:
the only check that catches the fabrication reports it as a birthplace error, because the
matcher selects on `record_role` and asserts on `value`.

And **F1 is no longer a stale-doctrine artifact of the 08-17 log** — the
42-year-old-as-`child_1` fabrication recurred today, under current doctrine. Role choice
across the seven runs now on record is pure variance: 2 of 7 fabricate, and run 1's
`resident_N` and `ut_022`'s `member_N` are two more distinct vocabularies again.

### The two lane-2 fixes went opposite ways, and the difference is the lesson

**`ut_021`'s bullet worked.** Run 2's skill wrote the field-level negatives again, reworded
— "Groom's parents not named in this index entry…", "Bride's parents not named…" — and the
judge docked them, quoting the rule back:

> "Per the per-test context (`record-extractor.md:896-905`), negative evidence applies to
> PERSONS expected-but-absent, not blank FIELDS on present persons. The parents' names are
> unrecorded optional fields, not evidence of absent persons. The skill should have
> remained silent on parents…"

Under the old bullet that behaviour was ungradeable **by construction** ("do not dock the
skill for creating one, and do not dock it for omitting one"). It is now docked, correctly.

**`ut_014`'s bullet over-applied, and is reverted.** In run 1 the judge scored a run that
wrote tie-neutral roles and zero relationship assertions `Correctness = 1`, on this:

> "The skill fabricated relationship assertions that the 1860 census does not state. The
> persisted `record_role` values encode kinship and household relationships
> (`head_of_household`, `resident_1`, `resident_2`, `resident_3`) that imply family
> structure."

That is factually false — verified in `file_changes`, not inferred — and
`head_of_household` is the agent body's own first-listed role token
(`record-extractor.md:199-200`).

**The difference between the two is not "prose works / prose does not".** `ut_021`'s bullet
states a **test applied to something the skill wrote**: does this `value` name the absent
person? `ut_014`'s asked the judge to **classify a label against an open vocabulary** —
which token encodes a relationship? — and it generalised the ban to every role carrying
household structure. The second shape has no natural boundary, which is why it belongs in
validator request **V1 (#2019)**, where the check is a surname comparison and cannot
over-apply. That is `docs/skill-lifecycle.md` §5 and ADR-0011, now with a measured instance.

Net effect: `record_role` is once again graded by nothing, which is F1 unchanged — but F1
now carries a reproduction *and* evidence that the prose route to fixing it does not work.

### Three violations the earlier corpus never produced

All three are rules my scan found **zero** violations of across 2,416 assertions.

- **`ut_027` (1910 census) — prohibition item 41. Reproduced in both runs.** Source written
  `source_classification: original` where the fixture pins `derivative`. `partial` both
  times. The most persistent of the new findings.
- **`ut_023` (burial index) — prohibition item 87.** Run 1: `a_004` burial place at
  `informant_proximity: official_duty` / `information_quality: primary`; the matcher expects
  `unknown` / `indeterminate`. `record-extractor.md:592-595` is explicit. Passed in run 2,
  so 1 of 2.
- **`ut_017` (obituary) — a validator I had not seen fire.** Run 1 tripped
  `test_relationship_type_agrees_with_its_value`: `a_037` carried
  `relationship_type: "child"` while its `value` read "Sister of Harold Dean Whitaker". The
  message names the consequence — "materialisation reads `structured_value`, so this writes
  the wrong family edge (or the right one backwards) while the value still reads
  correctly". Passed in run 2, so 1 of 2.

### Correction to §What I did not find

That section attributes every second `extraction_append` call to a permitted `op: "update"`
correction or a resubmit after a validation rejection. **A third cause exists and I could
not have seen it:** the harness caps its `node --eval` subprocess at 30 seconds
(`_run_node_eval`'s `timeout` default, in `eval/harness/harness/mock_mcp.py`). Run 1
timed out twice — `ut_009` (18 ops) and `ut_028` (21 ops) — while 14 calls of 15–41 ops
succeeded in the same run, including 41 and 39. It is
concurrency load, not batch size, and run 2 confirms it: **0 transient retries, no
timeouts, and both `ut_009` and `ut_028` went `partial` → `pass` with nothing changed that
they touch.**

I could not have seen it because **the four older run logs record no tool responses at
all**; `response` appears on `tool_calls` for the first time in these two. So that
section's attribution holds only for what was visible, and any earlier timeout is invisible
in the committed corpus.

Filed as **#2025**. In run 1 it cost `ut_009` and `ut_028` their Tool Arguments scores, and
`ut_009`'s retry dropped `source_id` because the source op died with the batch.

The same change makes the "an identifier must trace to something a tool returned" class of
validator writable for the first time.

### The annotation confirms the `ut_021` fix

`v1_2026-08-28_18-23-42.ann.json`: 37 cells across 7 tests, **zero score changes**. That
is unremarkable by itself — `review_sample.py` records 0.55% of cells changing across the
whole committed corpus — but the **single written comment in the entire file** is on
`ut_021` Correctness (judge 2, human 2):

> "Skill wrote `a_009`/`a_010` as negative evidence for unrecorded parent name fields on
> present persons. Per `record-extractor.md:896-905`, negative evidence applies to
> expected-but-absent persons, not blank fields."

A genealogist, reviewing blind, docked the behaviour on the same lines F5 cites — and under
the `judge_context` this PR replaced, that dock was impossible by construction. That is
independent confirmation of the lane-2 fix, not just of the finding.

**`ut_014` is not in the sample, and that is by design.** Its judge was skipped because the
validator failed first, so it has zero graded dimensions, and
`review_sample.is_gradeable()` excludes such tests because there are no cells to correct.
The docstring names the compensating control — "Excluded is not unnoticed:
`rule3_completeness` warns about these" — and `check_runlogs` does warn on it. I checked
this before treating it as a gap in the calibration loop; it is not one.

### `make judge-report` reads differently after these runs — read it against the run, not the rubric

#1666 points the auditor at `make judge-report SKILL=record-extraction` and reported **1 of
6** non-discriminating on 2026-08-27. Against the newest log it now reports **3 of 6**.
Nothing about the rubric changed; the command reads the newest log per skill, and that log
is now run 2.

| dimension | 08-24 | run 1 (17-43) | run 2 (18-23, newest) |
|---|---|---|---|
| base/Correctness | [1, 2, 3] | [1, 2, 3] | [1, 2, 3] |
| base/Completeness | [1, 3] | [1, 3] | [1, 3] |
| base/Tool Arguments | [2, 3] | [2, 3] | **[3] flat** |
| rubric/Assertion atomicity | **[3] flat** | [2, 3] | **[3] flat** |
| rubric/Evidence type accuracy | [2, 3] | [2, 3] | **[3] flat** |
| rubric/Informant identification | [2, 3] | **[3] flat** | [2, 3] |

**Flatness here is mostly run quality, not a dead dimension.** Run 2 was the cleanest run
in the corpus (24 pass / 3 partial / 1 fail), and a dimension no test failed is flat at 3
for that reason alone. The two runs are 40 minutes apart with only a `judge_context`
revert between them — which reaches the judge, not the skill — and they disagree about
*which* dimension is dead: `Assertion atomicity` is flat in run 2 and varies [2, 3] in run
1; `Informant identification` is the reverse.

Consequences worth carrying forward: a single-log flatness reading is not a property of
the rubric, so **`make judge-report` is an entry point, not a verdict** — exactly as #1666
frames it — and `rubric-critic`, which consumes flatness, inherits the same confound.
F13's claim below is the one that depends on this, and it survives: `Assertion atomicity`
is flat at 3 across n=24 in both the 08-24 baseline and run 2, and the F13 violation it
fails to fire on is present in both.

No rubric change follows from this. Acting on it would flip the snapshot and buy a paid
run this PR cannot fund, so it rides the next `record-extraction` rubric or body change
alongside F10.

### Judge-side advisories worth a look during annotation

Counts are run 2's.

- `dropped_unknown_rubric_dimension` ×2 (`ut_023`, `ut_025`) — the judge emitted
  `Completeness` / `Information quality` as *rubric* dimensions; this rubric has three
  (`Assertion atomicity`, `Evidence type accuracy`, `Informant identification`).
- `dropped_duplicate_dimension` ×3 — `Informant identification` emitted twice in one run.
- `routing_negative_judge_fail` on `ut_011`, whose advisory notes a human confirmed that
  score in 20 of 24 such cells across the corpus. Relevant to F12: `ut_011` is the only
  coverage of the refinement path and it is a 0-turn routing test.

---

## F1 — `record_role` encodes a relationship the record does not state, and no dimension grades `record_role`

**Lane 2 (attempted, reverted) + validator.** The sharpest finding of the dive.

**Did.** `ut_record_extraction_014` (`census-1860-different-surname-head`) gives the
same four people a different role vocabulary in each of the five logs:

| log | Silas Kerrigan, 62 | Thomas Flynn, 42 | Mary Flynn, 38 | Patrick Flynn, 15 |
|---|---|---|---|---|
| 2026-08-15 | `head_of_household` | `adult_male_1` | `adult_female_1` | `child_1` |
| 2026-08-16_11-26 | `head_of_household` | `lodger_1` | `lodger_2` | `lodger_3` |
| 2026-08-16_13-06 | `head_of_household` | `head_2` | `wife` | `child_1` |
| **2026-08-17** | `head_of_household` | **`child_1`** | **`child_2`** | `child_3` |
| 2026-08-24 | `head_of_household` | `co_resident_1` | `co_resident_2` | `co_resident_3` |

Two of those encode an unstated relationship in the field person-evidence binds on.
The 2026-08-17 run roled a **42-year-old man `child_1`** and a **38-year-old woman
`child_2`** of a 62-year-old head — while its own narration said the opposite:
"Silas Kerrigan is a significant FAN lead. He heads the household under a different
surname. **His relationship to the Flynns is unstated** (boarder, in-law, uncle?)" and
"zero explicit relationship assertions were written." The 2026-08-16_11-26 run roled
all three `lodger_N`, which asserts the *non*-kinship reading just as firmly.

**Should.** Prohibition-list item 49, `record-extractor.md:219–226` —
"**`record_role` = apparent within-group structure, not raw position after the head.**
Don't number everyone after the head `child_1, child_2, …` — that fabricates a
parent-child link the record never states… an adult too old to be the head's child
isn't `child_N` of that head." And the fixture's own `judge_context`: "the skill should
NOT fabricate a relationship assertion (e.g., Silas as Mary's father) from this
record", with the fabrication ban explicitly covering "the intra-family
household-position inferences (Thomas–Mary as a couple, Patrick as their child)".

`record_role` is not incidental: `record-extractor.md:368` states that
"person-evidence binds by `record_id` + `record_role`", so a fabricated role token is
the input to the next skill's identity work.

**Gap.** Nothing grades it. `rubric.md:11` says "**Do not read a `record_role` label**
(e.g. `wife`, `child_1`, `deceased`) **as an `evidence_type`** — grade only the
persisted `evidence_type` of an actual assertion" — sound advice against a specific
judge error, but combined with the "grade the persisted assertion" framing it leaves
`record_role` correctness graded by no dimension at all. `record_role` is an open enum
(`record_role_recommended` in `enums.schema.json`, pattern `^[a-z][a-z0-9_]*$`), so the
schema does not constrain it either. The rule dates from 2026-08-03
(`git log -S"Don't number everyone after the head"` → `36edfdec`), so it was live for
all five runs.

**Fix attempted, then reverted — the file in this PR matches `origin/main`.** A
`judge_context` bullet on `census-1860-different-surname-head.json` making role
fabrication gradeable in both directions (kinship *and* boardinghouse) scored run 1 —
which wrote tie-neutral `resident_N` roles and zero relationship assertions —
`Correctness = 1`, calling `head_of_household` itself a fabricated relationship. It asks
the judge to classify a label against an open vocabulary, and that has no boundary it
will hold; §Lane-2 fixes attempted has the comparison with the bullet that did hold.
**Validator request V1** carries the mechanical half, where the check is a surname
comparison and cannot over-apply.

---

## F2 — the only check that caught F1 reported it as a birthplace error

**Lane 2 → developer.**

**Did.** The 2026-08-17 run is the one `ut_record_extraction_014` failure in the
corpus, and its message is:

> `assertions[a_012] (record_role='child_1', fact_type='birth' attribute='place'): value='Ireland' — expected to contain 'Pennsylvania'`

**Should.** Every birthplace in that run is correct — Thomas Flynn *was* recorded born
Ireland. What was wrong is that Thomas Flynn was roled `child_1`.

**Gap.** The fixture's matcher is
`{record_role: "child_1", fact_type: "birth", attribute: "place", value: "Pennsylvania", optional: true}`.
It selects on `record_role` and asserts on `value`, so a role fabrication surfaces as a
value mismatch. Two consequences:

1. **The message misdirects.** A reader — or an annotator filling in a `.ann.json` —
   sees "Ireland vs Pennsylvania" and records a birthplace defect that did not happen.
2. **It only fires by luck.** The 2026-08-16_11-26 `lodger_N` run is the same class of
   defect and passed clean: no assertion matched `child_1`, `optional: true` skipped
   the matcher, green.

And there is a third edge: the matcher names `child_1` as the expected role in the one
test whose whole point is that the census states no such relationship. It cannot be
re-keyed to a role-independent selector, because `test_expected_classifications`
requires a `record_role` on every matcher.

**Not fixed here.** Deleting the matcher removes the only deterministic pin on
Patrick's Pennsylvania birthplace, and it did fire. It stays; V1 covers the real
defect directly, and this finding records why the existing failure message must not be
read at face value.

---

## F3 — one record's assertions split across two `record_id`s

**Validator.**

**Did.** `ut_record_extraction_005` (`record-read-via-ark`), delegated with
`recordId: ark:/61903/1:1:68Q9-K34P`. In **2 of the 5 analysed logs — including
`v1_2026-08-24_17-40-15`, the newest of them** — the head-of-household's three
assertions carry
`ark:/61903/1:1:68Q9-K34Q` (Thomas Flynn's own persona ARK) while the subject's five
carry `…K34P`:

```
a_001–a_003  head_of_household  record_id = ark:/61903/1:1:68Q9-K34Q
a_004–a_008  child_1            record_id = ark:/61903/1:1:68Q9-K34P
```

The run's own relay names the split out loud: "Thomas Flynn (household head persona,
`68Q9-K34Q`)" / "Patrick Flynn (child persona, `68Q9-K34P`)".

**Should.** Prohibition-list item 63, `record-extractor.md:351–356` — "**`record_id`**
— copy the caller's recordId… **Same `record_id` on every assertion from one record.**"
Live since 2026-07-12 (`git log -S"Same .record_id"` → `84a6422e`), so both runs are in
window.

**Gap.** One record becomes two in the persisted state. `project_context.sources[]`
reports `recordIds` per source, and person-evidence binds on `record_id` +
`record_role`, so a downstream lookup by the delegated `recordId` finds five of the
eight assertions and silently misses the head entirely. Nothing checks it: the schema
requires the field, not its constancy. **Validator request V2.**

---

## F4 — a negative assertion given a record informant

**Validator.**

**Did.** `ut_record_extraction_017` (obituary), the three "preceded in death by"
assertions:

| log | `informant` | `informant_proximity` |
|---|---|---|
| 2026-08-15 | `the researcher` | `researcher` ✓ |
| **2026-08-16_11-26** | `family member (unnamed)` | `household_member` ✗ |
| **2026-08-16_13-06** | `unknown family informant` | `family_not_present` ✗ |
| 2026-08-17 | `the researcher` | `researcher` ✓ |
| 2026-08-24 | `the researcher` | `researcher` ✓ |

**Should.** Prohibition-list item 83, `record-extractor.md:533–537` — "A **negative**
assertion (`record_role: "absent"`) **always** takes `informant: "the researcher"` +
`informant_proximity: "researcher"` — no record informant reported an absence,
**whatever the record type**; the table's `witness`/`household_member` rows never apply
to one." Verified present in the body as committed on 2026-08-16
(`git show ba27a53d:…record-extractor.md` → lines 534–535), so both violating runs are
in window.

**Gap.** `rubric.md:42` already calls this "a fail-level error", and
`test_negative_evidence_uses_absent_role` checks the *role* but not the *informant*.
The two fields are prescribed in the same sentence; only one is checked. It is a
two-field equality on a closed enum — pure arithmetic, no judgement.
**Validator request V3.**

*Worth flagging separately for the lead:* the obituary genuinely does report these
deaths, so an agent arguing for a record informant is not being stupid. The rule as
written is unconditional and the agent should follow it; if the doctrine is wrong, that
is a `needs-decision` question, not a prose tweak. I did not change the body.

---

## F5 — a `"No X recorded"` negative the body prohibits by name, licensed by the fixture

**Lane 2 — fix made.**

**Did.** `ut_record_extraction_021` (`marriage-index-no-parents-recorded`), the
**2026-08-24** run — the newest in the corpus — wrote:

```json
{"id": "a_007", "record_role": "absent", "fact_type": "name", "evidence_type": "negative",
 "value": "No parents' names recorded for groom Wm. H. Ferber in this index entry"}
{"id": "a_008", "record_role": "absent", "fact_type": "name", "evidence_type": "negative",
 "value": "No parents' names recorded for bride Emma Becker in this index entry"}
```

The other four logs wrote no such assertion.

**Should.** Prohibition-list items 103 and 105, `record-extractor.md:896–905` —
"**Negative evidence is about a PERSON expected-but-absent, never a blank FIELD on a
person who is present**… **Never** manufacture a `"No middle name recorded"` /
`"No X on this certificate"` negative assertion for an unrecorded optional field — that
is over-extraction, not thoroughness" — and item 103, `:883–886`: `value` is "the
**expected-but-missing** fact" naming the person.

The `value` here is the tell. It names *the groom and the bride*, who are present, not
the absent persons — because the absent persons cannot be named, which is exactly why
this is a blank field and not a person expected-but-absent.

**Gap.** The test's `judge_context` licenses it in terms that make the behaviour
ungradeable in both directions:

> "it does NOT forbid a negative-evidence assertion (record_role 'absent',
> evidence_type 'negative') documenting that the entry records no parents. Such an
> assertion is PERMITTED BUT NOT REQUIRED: **do not dock the skill for creating one,
> and do not dock it for omitting one**"

A bullet that instructs the judge not to dock either branch cannot discriminate, and
here it licenses the one shape the body forbids by name.

**Fix made:** the bullet now states the body's own test — a negative is permitted only
when its `value` names the specific absent *person*; a `"No X recorded"` value about an
unfilled field is the over-extraction `record-extractor.md:896–905` prohibits. It keeps
the original bullet's real point (do not *invent* parent names) intact.

**Confirmed by a human.** The 2026-08-28 annotation's only written comment docks exactly
this behaviour, citing `record-extractor.md:896-905` — see §The annotation confirms the
`ut_021` fix.

The body is not perfectly self-consistent on this boundary — `:266–269` makes a missing
consent signature recordable as `record_role: "absent"` — so the fix states the test
(*can you name the absent person?*) rather than picking a side the lead has not ruled
on.

---

## F6 — the image-reader delegation never carries `project_path`, so no scan is ever citable

**Validator.**

**Did.** Every `@plugin:image-reader` delegation in the corpus — all four of them
(`ut_record_extraction_015`, logs 2026-08-16_11-26 through 2026-08-24) — is a bare
transcription request:

> "Please transcribe the FamilySearch page scan at image ARK 3:1:3QS7-99QG-KBTG. Return
> a full text transcription of everything visible on the page."

No `project_path`. No `looking_for`. **Read the caveat F9 forces on this:** three of
the four prompts are 145, 147 and 197 characters, so they are recorded whole and the
absence is real. The fourth (2026-08-17) is exactly 200 — the truncation cap — so for
that one run the log cannot show whether `project_path` followed, and I do not claim it.
The finding rests on the three complete prompts and on the independent corpus-wide
count, which no truncation touches: **`image_filename` appears on 0 of 121 persisted
sources; `transcription` on 1 of 121.**

**Should.** Prohibition-list item 11, `SKILL.md:100–106` — "**Pass `project_path` so
the scan is saved for the source.** Include `project_path: <your working folder>` in
the delegation; the reader's default read then saves the JPEG and reports `Saved image:
images/<key>.jpg`. Set the source's **`image_filename`** to that path (alongside
`transcription`) in the append, so the viewer can show the scan." Live since
2026-07-18 (`9a7fef79`).

**Gap.** The whole chain is dead: no `project_path` → no saved JPEG → no
`image_filename` → the viewer can never display a scan for any source this skill
writes. `image-reader.md:53` marks `project_path` optional in *its* contract, which is
right for the reader and is why nothing errors. The obligation is the caller's, and
nothing checks the caller. **Validator request V4.**

`looking_for` is genuinely optional (`image-reader.md:52`), so its absence is not a
violation — but `SKILL.md` spends a paragraph on how to phrase it and it has never been
used once. Worth knowing before anyone invests in tuning that paragraph.

---

## F7 — the suspect-name test passes without any attempt to reach the image

**Lane 2 — deliberately NOT fixed. See "Why not fixed".**

**Did.** `ut_record_extraction_016` (`suspect-required-name-confirm-via-image`). The
user says the indexed patronymic "Nadnesen" is probably wrong. In **5 of 5 runs** the
router called no `volume_search`, delegated to no `@plugin:image-reader`, and went
straight to `record-extractor` with a "record it tentative" flag — and the three fresh
runs make it **8 of 8**. Every run makes the same five MCP calls and only those:
`project_context` and `record_read` in either order, then `research_log_append`, a second
`project_context`, *(delegate)*, `extraction_append`. (The second `project_context` is the
router-then-agent split V8 describes, not a violation.)

**Should.** Prohibition-list items 9 and 15. `SKILL.md:126–138` — "treat the indexed
value as a lead: **route to the original register image (`volume_search` +
`@plugin:image-reader`) to confirm the spelling** before it is recorded as
established… **If the image is unreachable**, tell the extractor to record the name
tentative". And `SKILL.md:74–80`, on the image path generally: "Do NOT decide on your
own that the image can't be read and skip the call… Reporting 'image unreachable'
without an actual delegation attempt is **a completeness failure**."

**Gap.** The `judge_context` accepts narration in place of the attempt:

> "the router should route toward the image (call volume_search…, delegate to the
> image-reader subagent…, **or explicitly state that the original register image must
> be read** …)"

and its PASS condition reduces to "the suspect name is recorded tentatively … AND
original-image confirmation is named as the outstanding step". Saying the image must be
read is a full pass. So the body's first limb — *attempt, then fall back* — is
unexercised, and 5 of 5 runs take the fallback without the attempt.

The `judge_context`'s stated reason ("real image content is not available in the unit
test harness") justifies not requiring a *resolved spelling*. It does not justify
dropping the *attempt*, which the harness observes perfectly well: a `volume_search` is
a tool call and an image-reader spawn is a `builtin_tool_calls` entry.

**Why not fixed.** Tightening the pass condition to require the attempt makes the test
fail 5 of 5 with no way to pass: `suspect-required-name-confirm-via-image.json` declares
`mcp_fixtures: ["record-read-birkeland-1817-baptism"]` and nothing else, so there is no
`volume_search` response for the router to receive. The fix is a **fixture**, not a
`judge_context` edit, and it needs a paid re-run to land — which is why it is filed
rather than made. What I did change: nothing. What the issue should carry is in
§Follow-on work.

---

## F8 — the router re-prints per-assertion detail in 24 of 25 runs, and the rubric forbids docking it

**Validator.**

**Did.** In `v1_2026-08-24_17-40-15` alone — the newest log in the analysed corpus —
**24 of 25 persisting runs** end in a markdown table and **10 of 25** enumerate three or
more `a_` ids. Corpus-wide: 116 of 121. Median relay is 21 non-blank lines and 2,077
characters. `ut_record_extraction_005`, 2026-08-24, is representative:

```
### 9 assertions written:
**Thomas Flynn** (household head persona, `68Q9-K34Q`):
| ID | Assertion |
|----|-----------|
| a_001 | Name: Thomas Flynn |
| a_002 | Sex: Male |
| a_003 | Residence: 1850, Branch Township, Schuylkill, Pennsylvania |
```

**Should.** Prohibition-list items 24 and 39. `SKILL.md:212–215` — "Relay the agent's
compact summary… **Do not re-print per-assertion detail; it is already persisted.**"
`record-extractor.md:966–983` caps the agent's own return at **≤10 lines** and forbids
"per-assertion tables, per-field walkthroughs, or classification rationale".

**Gap.** `rubric.md:5` — "Narrative style, verbosity, and presentation are **never**
grounds for a deduction in these dimensions" — and `:10` — "**Grade the persisted
assertion, not the chat narrative**". Those lines are deliberate and correct: they stop
verbosity from contaminating the classification dimensions, which is a real past failure
mode. But together they make one named prohibition undockable by any dimension.

**Do not fix this by weakening the rubric.** Length is arithmetic, and the
conflict-resolution dive reached the same conclusion about word caps: it belongs in a
validator, not in a dimension an LLM has to eyeball. **Validator request V5.**

---

## F9 — five delegation-only prohibitions are unauditable, because the run log truncates the delegation

**Developer / `nothing-checks`.**

**Did.** `builtin_tool_calls[].args` is truncated at 200 characters. Across the corpus,
**100 of 103 `Agent` prompts are exactly 200 characters long**; the four distinct
lengths recorded are 145, 147, 197 and 200.

**Should.** `SKILL.md` carries five prohibitions that live *only* in the delegation
message — prohibition-list items 11, 12, 20, 21, 22: pass `project_path` to the image
reader; phrase `looking_for` as a search key and never the expected answer; carry
`recordId`/`logId`/question ids; **never frame the task as "fix" or "correct" the
existing tree** (":177–179 — corrective framing has induced destructive edits"); and
**never instruct the agent to create `person_evidence` links or assign an identity
confidence** (":181–187 — a delegation that ordered it produced a fabricated identity
link carrying a match score no tool had computed").

**Gap.** None of the five can be checked from a committed run log. Both of the last two
are documented as having *already caused* a destructive or fabricated outcome, and both
are invisible to every reader of the corpus. F6 is in this document only because **three
of the four** image-reader prompts happened to be shorter than 200 characters — every
one of the three under-cap prompts in the whole corpus is one of them. The fourth is at
the cap and is unreadable for exactly the reason this finding describes; F6 says so and
leans on its corpus-wide count instead.

My first pass at this dive reported "recordId missing from 80 of 99 delegations" —
which is an artifact of the truncation, not a finding. That is how the gap presents:
not as an absence of evidence, but as false evidence.

**Not a validator request** — the validator cannot be written until the data exists.
See §Follow-on work.

---

## F10 — the router improvises `projectPath` discovery, three different ways, in every run

**SKILL.md gap; low severity, stated for the record.**

**Did.** `SKILL.md`'s delegation contract requires `projectPath` ("absolute path to the
project directory") and never says where to get it. Across the four logs that record
builtins, the router:

- `Glob`s for `research.json` in **56 runs** (patterns `research.json`, `**/research.json`,
  `**\research.json`, `**/*`, `**/*.json`);
- `Read`s the whole of `research.json` in **22 runs**;
- shells out — `PowerShell Get-Location`, `(Get-Item "research.json").Directory.FullName`
  — in **5 runs**.

**Should.** No rule forbids this; `SKILL.md:49–51` forbids reading the *sidecar*, not
`research.json`. The agent is barred from reading project files (item 28,
`record-extractor.md:118`) precisely to keep them out of context — and the router, which
has no such bar, pulls the whole file in one run in five.

**Gap.** In these fixtures the project is empty, so the read is cheap and the cost is
latent. In a real project `research.json` is the largest artifact the system owns, and
the router loads it to learn one string. One line in `SKILL.md` naming where
`projectPath` comes from would remove all three improvisations. That is a body edit and
therefore lane 4 — **not made, and deliberately not filed either**: it arms this skill's
eval slot, so it should ride the next `record-extraction` body change. §Follow-on work
says the same; recorded in both places so the next person editing that body picks it up.

---

## F11 — role tokens drift off the sequential-numbering convention

**Validator.**

**Did.** Corpus-wide, 59 distinct `record_role` values. Seven runs use a bare token
where a numbered one is the convention, **two of them in `v1_2026-08-24_17-40-15`**, the
newest log in the analysed corpus:

- `ut_record_extraction_027`, 2026-08-24: `head_of_household`, **`daughter`**, `son_1`,
  `son_2` — one unnumbered sibling among numbered ones.
- `ut_record_extraction_016`, 2026-08-24: **`child`**, **`father`**, **`mother`** — where
  other runs of the same fixture use `father_of_child` / `mother_of_child`.
- Also `informant` vs `informant_1`, `officiant` vs `officiant_1`, `child_in_law_1` vs
  the body's prescribed `son_in_law_N`/`daughter_in_law_N`.

**Should.** Prohibition-list item 47, `record-extractor.md:199–200` — "**Number roles
sequentially**", and `enums.schema.json`'s `record_role_recommended`: "Numbered roles
use the pattern `{role}_{n}`". Stable since 2026-07-12.

**Gap.** The pattern in the schema is `^[a-z][a-z0-9_]*$`, which every one of these
satisfies. Person-evidence binds on `record_role`, so the same persona on the same
fixture being `father` in one run and `father_of_child` in another is a coupling risk,
not a cosmetic one. **Validator request V6.**

---

## F12 — the classification-refinement path has zero coverage

**Fixture request.**

**Did.** `ut_record_extraction_011` (`negative-classify-vs-extract`) is the only test
covering "reclassify these assertions". It is `type: negative` and runs in
triggering-only mode: **`num_turns: 0`, `text_response` empty, zero tool calls, in all
five logs, all passing.** It establishes that the request routes to
`record-extraction` and nothing more.

**Should.** Prohibition-list items 23 and 38. `SKILL.md:203–208` describes a whole
refinement branch — find the record from `record_id`/`source_id`, delegate per record,
never re-classify inline. `record-extractor.md:947–964` describes the matching
`update`-op path — "re-examine the named assertions against the doctrine above and
update only the classification fields that should change… one batched call, one
`update` op per changed assertion, immutable extraction fields left alone". A third of
the skill's `description` frontmatter is about this path.

**Gap.** No test in the 28 exercises it. Every scenario is
`empty-project-just-created` or `mid-research-flynn`, and the only `update` ops in the
entire corpus are same-run self-corrections (`ut_record_extraction_014`'s 19 updates,
`ut_record_extraction_017`'s single-field patches) — never a refinement of an assertion
that existed before the run. Re-invocation and source reuse
(`sourceReuse: "updated_existing"`) are equally untested.

This is a coverage hole, not a defect, so it is a fixture request rather than a
validator. It is also the most likely place for a silent regression, because the tool
path it uses (`op: "update"` by `a_` id) is exercised nowhere else.

---

## F13 — reasoning prose in `value`

**Validator.**

**Did.** `ut_record_extraction_009`, the computed birth-year assertion, in three of the
five analysed logs — **including `v1_2026-08-24_17-40-15`, the newest of them**:

- 2026-08-15: `"Calculated birth year approximately 1845, derived from stated age of 63y 2m 10d at death on March 12, 1908"`
- 2026-08-17: `"approximately 1845 (computed from stated age of 63 years, 2 months, 10 days at death on March 12, 1908)"`
- 2026-08-24: `"Born approximately 1844 (computed from stated age of 63 years, 2 months, 10 days at death on March 12, 1908)"`

**Should.** Prohibition-list item 67, `record-extractor.md:391–395` — "**`value`** —
human-readable, what the record says, not your interpretation… **One fact only, no
reasoning prose** — the justification for a doubted reading belongs in
`informant_bias_notes`, never inside `value`."

**Gap.** Each of those assertions already carries an `informant_bias_notes` saying the
same thing, so the derivation is stored twice and `value` is no longer the fact. The
`Assertion atomicity` dimension names the failure — "mixes a fact with justification
narrative" is its `partial` branch — and it is the dimension `make judge-report`
reports as flat at 3 across n=24, which is what issue #1666 says to look at first. It
does not fire here. (Read that flatness with §`make judge-report` reads differently after
these runs: it holds in both the 08-24 baseline and run 2, and run 1 is the exception.)
**Validator request V7.**

The rate is 3 of the 5 analysed logs, but the shape has survived a doctrine flip and
recurs in **both** fresh runs — `v1_2026-08-28_17-43-01`, "born approximately 1845
(computed from stated age of 63y 2m 10d at death on 12 March 1908)", and
`v1_2026-08-28_18-23-42`, "birth year computed from stated age of 63y 2m 10d at death on
March 12, 1908". That is 5 of the 7 logs on record, the two most recent included, so it
is current behaviour rather than history.

---

## F14 — the schema tells you to document a new `fact_type` in a field that does not exist

**Developer / `nothing-checks`; small.**

**Did.** `docs/specs/schemas/enums.schema.json`, `fact_type_recommended`: "Open enum.
Skills should prefer these values; new values may be added when existing values don't
fit. **Document new values in the assertion's notes.**"

**Should.** `record-extractor.md:335–345` — "Do not invent fields — **`notes` is a
source field, not an assertion field**." `tree-shape.ts` / the validator enforce
`additionalProperties: false`, so an assertion carrying `notes` is rejected on write.

**Gap.** The instruction is unfollowable. The corpus contains six `fact_type` values
outside the enum's example list — `marital_status`, `parent_child`, `presence`, `event`,
`legitimacy`, `legal_status` — and, correctly, not one of them is documented anywhere,
because there is nowhere to put it. Either the sentence should name
`informant_bias_notes`, or it should be struck. Both schema trees carry the same text.

While you are there: `marital_status` is on that off-list because the **agent body
prescribes it** (`record-extractor.md:250–257`, "A `marital_status` assertion per party
whenever the record designates one"). The example list is simply stale; adding it costs
nothing and removes a false signal for the next person who greps this.

---

## Validator requests

Written to the guide's Step-6 template. I supply the genealogical rule; a developer
writes the Python. Each is decidable from a run log with no judgement.

### V1 — `record_role` must not encode a relationship the record does not state

> **Rule:** on a record whose fixture declares no relationship column (a pre-1880 US
> census), no persona may carry a `record_role` that names a relationship **to a
> different surname group** — neither kinship (`child_N`, `wife`, `son_N`,
> `daughter_N`) nor non-kinship (`lodger_N`, `boarder_N`, `servant_N`) — for a persona
> whose tie to the head the record does not state. Within one surname group,
> `head`/`wife`/`child_N` remains correct.
> **Where to look:** `research.json` `assertions[].record_role` in the after-state,
> grouped by the surname in the matching `name` assertion's `value`.
> **Why it is not judgment:** surname equality and the fixture's census year are both
> literals; the rule needs no reading of the record.
> **What a violation looks like:** `ut_record_extraction_014`, run
> `v1_2026-08-17_18-57-51` — `child_1` = Thomas Flynn (42) and `child_2` = Mary Flynn
> (38) under `head_of_household` = Silas Kerrigan (62), a different surname; and run
> `v1_2026-08-16_11-26-54` — `lodger_1..3` for the same three.

*Cheaper first cut, if the surname grouping is too much for one afternoon:* flag any
`child_N` whose `age` assertion value is within 18 years of the `head_of_household`'s.
That catches the 2026-08-17 run on its own and needs no name parsing.

### V2 — every assertion from one extraction carries one `record_id`

> **Rule:** all assertions written by a single `extraction_append` batch must carry the
> same `record_id`, and it must be the `recordId` the delegation named.
> **Where to look:** `research.json` `assertions[]` added in the run, plus the
> `extraction_append` call's own ops.
> **Why it is not judgment:** string equality across one batch.
> **What a violation looks like:** `ut_record_extraction_005`, runs
> `v1_2026-08-16_11-26-54` and `v1_2026-08-24_17-40-15` — `a_001`–`a_003` carry
> `ark:/61903/1:1:68Q9-K34Q`, `a_004`–`a_008` carry `…K34P`.

### V3 — a negative assertion has no record informant

**Filed as a comment on #986**, which already owns the `record_role: "absent"` half of this
cross-field rule at the `validator.ts` level. `record-extractor.md:533-537` prescribes both
fields in one sentence.

> **Rule:** every assertion with `evidence_type: "negative"` must carry
> `informant_proximity: "researcher"` and an `informant` naming the researcher; and
> every assertion with `record_role: "absent"` must carry `evidence_type: "negative"`
> (and the converse).
> **Where to look:** `research.json` `assertions[]` in the after-state.
> **Why it is not judgment:** `informant_proximity` and `evidence_type` are closed
> enums; `record_role: "absent"` is a literal the body already fixes.
> **What a violation looks like:** `ut_record_extraction_017`, run
> `v1_2026-08-16_11-26-54` — `a_032`–`a_034` carry `informant: "family member
> (unnamed)"`, `informant_proximity: "household_member"`.

*Note for the implementer:* `test_negative_evidence_uses_absent_role` already exists and
checks the role half. This is an extension of that file, not a new one.

### V4 — an image delegation carries `project_path`, and a source citing a transcription cites its scan

> **Rule:** (a) every `image-reader` / `image-reader-opus` subagent delegation must
> carry `project_path`; (b) any source whose `transcription` field is set must also
> carry `image_filename`.
> **Where to look:** (a) `builtin_tool_calls[]` where `tool == "Agent"` and
> `subagent_type` contains `image-reader`; (b) `research.json` `sources[]`.
> **Why it is not judgment:** presence of a key.
> **What a violation looks like:** `ut_record_extraction_015`, all four runs that
> delegated — the prompt is a bare "Please transcribe the FamilySearch page scan at
> image ARK 3:1:3QS7-99QG-KBTG…" with no `project_path`; and 0 of 121 sources in the
> corpus carry `image_filename`.
> **Blocked on F9 for half of it:** limb (a) needs the delegation prompt untruncated
> past 200 characters. Limb (b) is writable today.

### V5 — the router's relay does not re-print per-assertion detail

> **Rule:** the run's `text_response` must not name more than two `a_` ids, and must not
> contain a markdown table row whose first cell is an `a_` id.
> **Where to look:** `output.text_response`.
> **Why it is not judgment:** counting ids and matching `^\s*\|\s*a_\d+`. The rubric
> deliberately refuses to grade presentation (`rubric.md:5,10`), so this is the only
> place the rule can live.
> **What a violation looks like:** `ut_record_extraction_005`, run
> `v1_2026-08-24_17-40-15` — a table with rows `| a_001 | Name: Thomas Flynn |` through
> `| a_008 | Residence: … |`. 24 of 25 persisting runs in that log end in a table.

*Threshold note:* two ids is a genealogist's call, and I set it deliberately — a relay
legitimately names a specific assertion or two in a key finding. Enumerating a whole
persona's ids is the behaviour the rule forbids.

### V6 — role tokens are numbered consistently within a run

**Filed as a comment on #1442**, which already owns the single-role matcher pin and cites
this exact instability on `ut_018`. Finding F2 went there too.

> **Rule:** within one run, if any `record_role` matches `{stem}_{n}`, no assertion may
> carry the bare `{stem}` for a different persona; and the sibling stems
> `child`/`son`/`daughter` must not be mixed as parallel numbering schemes for members
> of one household group.
> **Where to look:** `research.json` `assertions[].record_role` in the after-state.
> **Why it is not judgment:** string-stem comparison; the convention is stated in
> `enums.schema.json`'s `record_role_recommended` ("Numbered roles use the pattern
> `{role}_{n}`") and in `record-extractor.md:199–200`.
> **What a violation looks like:** `ut_record_extraction_027`, run
> `v1_2026-08-24_17-40-15` — `daughter` alongside `son_1`, `son_2`.

### V7 — `value` holds a fact, not its derivation

> **Rule:** an assertion whose `evidence_type` is not `negative` must not carry a
> `value` containing derivation language — `computed from`, `derived from`,
> `calculated from`, `based on`, `inferred from` — when `informant_bias_notes` is
> populated. The derivation belongs there.
> **Where to look:** `research.json` `assertions[].value` and
> `assertions[].informant_bias_notes`.
> **Why it is not judgment:** a fixed phrase list against one field, gated on another
> field being non-empty; `record-extractor.md:391–395` names `informant_bias_notes` as
> the correct home.
> **What a violation looks like:** `ut_record_extraction_009`, run
> `v1_2026-08-24_17-40-15` — `a_006` `value: "Born approximately 1844 (computed from
> stated age of 63 years, 2 months, 10 days at death on March 12, 1908)"`, while its own
> `informant_bias_notes` already records the derivation.

### V8 — one `project_context` call per agent invocation

> **Rule:** at most one `project_context` call may follow the `record-extractor` spawn
> in a run.
> **Where to look:** `tool_calls[]` ordered against the `Agent` entry in
> `builtin_tool_calls[]`.
> **Why it is not judgment:** call counting.
> **What a violation looks like:** none found — this is a **guard, not a fix**. 80 of
> 138 runs make two `project_context` calls, and in every one I traced the split is
> router-then-agent (the router calls it before spawning; the agent calls it once
> after), which no rule forbids. The agent's "ONE call, up front" rule
> (`record-extractor.md:110`) is currently honoured; nothing would notice if it stopped
> being, because a raw count of 2 already looks normal.

### V9 — `record_persona_id` presence follows the `resultsRef`, not the content

> **Rule:** in a run whose delegation carried a `resultsRef`, **every** new assertion
> carries `record_persona_id`; in a run with no `resultsRef`, **no** assertion carries
> it. Partial population is always wrong.
> **Where to look:** `research.json` `assertions[]`, against the test's declared inputs.
> **Why it is not judgment:** presence of a key, all-or-nothing;
> `record-extractor.md:373–389` states both halves and names partial population as "the
> known failure mode".
> **What a violation looks like:** none in this corpus — 0 partial-population runs
> across 121 persisting runs. Filed because the body calls it the known failure mode,
> it is free to check, and only `ut_record_extraction_006` currently exercises the
> sidecar path at all.

---

## Lane-2 fixes attempted in this PR

**One kept, one tried and reverted.** Both were measured on a paid run; see §What the two
fresh runs changed.

1. **`marriage-index-no-parents-recorded.json` — kept, and it works.** Replaced the "do not
   dock the skill for creating one, and do not dock it for omitting one" clause with the
   body's own test: a negative is permitted only when its `value` names the specific absent
   person (F5). The don't-invent-parent-names point is preserved. Run 2 wrote the
   field-level negatives again and the judge docked them, quoting
   `record-extractor.md:896-905` back. Under the old clause that was ungradeable by
   construction.
2. **`census-1860-different-surname-head.json` — tried, reverted, and the reason is a
   finding.** A `judge_context` bullet making `record_role` fabrication gradeable made the
   judge score a run with tie-neutral roles and zero relationship assertions
   `Correctness = 1`, calling `head_of_household` a fabricated relationship. Reverted;
   `ut_014` matches `origin/main`. The rule belongs in validator V1 (#2019), where a
   surname comparison cannot over-apply.

   The two together are the useful result: a bullet that states a **test applied to what
   the skill wrote** held; a bullet that asked the judge to **classify a label against an
   open vocabulary** did not.

**No `rubric.md` change.** Every finding that touches the rubric (F8's presentation
rule, F13's atomicity dimension) is better served by a validator: both are arithmetic,
and `rubric.md:5` refuses presentation deductions for a good reason I did not want to
erode.

**No SKILL.md or agent-body prose added.** The only body change in this PR is the
settled pre-edit from #1635 (deleting the dead ToolSearch passage). Every behavioural
finding above is a rule the body already states and the run ignored; per the guide,
restating it would lengthen the prompt and change nothing.

## Follow-on work — filed

Grouped by lane and by which paid eval run they ride, per the guide's "do not open one
issue per finding". The one search before filing (`gh issue list --state open` over 194
open issues, plus a grep of every `**Touches:**` line) found two existing owners, so two
of the nine validator requests became comments rather than new issues.

- **#2019** — `developer`, `nothing-checks`. Validators V1, V2, V4(b), V5, V7, V8, V9.
  All read the committed corpus; none costs an eval run. V1 and V5 carry the
  genealogist's threshold calls, quoted above.
- **#2020** — `developer`, `nothing-checks`. F9: `BUILTIN_ARG_TRUNCATE = 200`
  (in `eval/harness/harness/skill_runner.py`) cuts the `Agent` prompt, hiding the
  delegation message and with it five `SKILL.md` prohibitions — two documented as having
  already caused a destructive edit and a fabricated identity link. Unblocks V4(a). F14
  (the `fact_type_recommended` "assertion's notes" instruction, plus `marital_status`
  missing from its examples) rides here as a schema-text fix in both trees.
- **#2021** — `genealogist`, `nothing-checks`. F7 (a `volume_search` fixture for
  `suspect-required-name-confirm-via-image`, so the image-confirmation *attempt* can be
  required rather than narrated) and F12 (a re-invocation/refinement fixture, the only
  path to the `op: "update"` branch). Both are fixture work on this suite, so they share
  one paid run and one annotation pass.

Two went to existing issues instead of new ones:

- **V3 → comment on #986** (`validator.ts: evidence_type "negative" is not tied to
  record_role "absent"`). That issue already owns the role half of the cross-field rule.
  The comment adds the informant half — `record-extractor.md:533-537` prescribes both
  fields in one sentence — with the F4 violations, and notes that the `a_012` blank-field
  negative its "Why it was deferred" section describes reproduces live in F5.
- **F2 + F11 (V6) → comment on #1442** (`expected_classifications can't express "either
  party's record_role"`). That issue already owns the single-role matcher pin. The comment
  adds two failure directions its body does not describe: the pin produced a **false-positive
  report** on `ut_014` (a role fabrication surfaced as "Ireland vs Pennsylvania") and a
  **silent miss** on the `lodger_N` run, and its §2 role-naming instability is now visible
  *within* a single run (`ut_027`: `son_1`, `son_2`, bare `daughter`).

**F10** is not filed. It is a one-line `SKILL.md` addition naming where `projectPath`
comes from — lane 4, and it arms this skill's eval slot, so it should ride the next
`record-extraction` body change rather than buy a run of its own. Recorded here so the
next person editing that body picks it up.

## What I did not find

Stated because a clean result is evidence too, and the next auditor should not re-run
these. Across 2,416 assertions and 121 sources:

- **Zero** relationship assertions on any pre-1880 census test (items 69, 96) — the
  rule #1626 landed for is holding, including on `ut_record_extraction_005` where the
  fixture's gedcomx carries a `ParentChild` edge.
- **Zero** `_inferred` `relationship_type` values (item 71).
- **Zero** enum violations: `informant_proximity`, `evidence_type`,
  `information_quality`, `date_certainty`, `source_classification` (items 62, 74, 79,
  93) — and no `no_evidence`, no `analyst`, no `inferred_from_structure`.
- **Zero** invented assertion or source fields (items 43, 61).
- **Zero** `birthplace` / `deathplace` fact types (item 58).
- **Zero** personas with facts but no `name` assertion (item 55).
- **Zero** missing `sex` assertions on any census test (item 72).
- **Zero** `informant_proximity: "self"` on any census assertion (item 84).
- **Zero** `record_role` variants of `absent` (item 46), and no partial
  `record_persona_id` population (item 66).
- **Zero** prohibited framings in the delegation prompts — but see F9: the prompts are
  truncated at 200 characters, so that particular zero means nothing.
- The apparent "15 runs made two `extraction_append` calls" is **not** a violation of the
  one-call rule — but the supporting count is not a clean zero, and the correction is
  mine. **Exactly one** duplicate `(record_role, fact_type, value)` tuple exists across
  the 2,416 assertions: `ut_record_extraction_017`, 2026-08-16_11-26, writes
  `deceased`/`death`/"passed away peacefully on March 14, 2021" twice — `a_003` with no
  `date` or `place`, `a_004` carrying both. That is one fact written twice, which is what
  item 38 forbids; it is a single instance in one run, not the shape of the two-call
  behaviour, and it sits in a log this PR prunes. **A second appears in fresh run 1**
  (`ut_record_extraction_017` again: `sibling_1`/`relationship`/"Sister of Harold Dean
  Whitaker" ×2), so the count on the 7 logs now on record is 2, both on the same test.
  Worth a validator; folded into V2's neighbourhood rather than given its own number, and
  named here so the next auditor does not re-derive a zero I got wrong.
  **Superseded in part:** I attributed every second call to a
  permitted `op: "update"` correction (`record-extractor.md:849–855`) or a resubmit after
  `{ ok: false }` (`:843–847`). The fresh run shows a third cause — a 30-second harness
  subprocess timeout (#2025) — that the four older logs cannot show, because they do not
  record tool responses. See §What the fresh run changed.

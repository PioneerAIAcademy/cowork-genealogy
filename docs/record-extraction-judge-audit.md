# Record-extraction judge audit

**Issue:** #974. **Sibling:** #975 (ut_record_extraction_009).
**Date:** 2026-08-04. **Scope:** the `record-extraction` unit suite only.

This is a measurement write-up, not a plan. It answers one question — **which
of this skill's grading dimensions can be trusted, and which are noise** — and
routes each finding to its owner. Nothing here edits `rubric.md` or
`eval/harness/judge/prompt.md`; both are owned outside this loop.

## Provenance — read this before trying to reproduce a number

Every figure below was computed from **39 run logs and 26 `.ann.json` files** as
they existed at commit **`a2d5a4cf`** (this branch's first commit).

Since then, main's run-log retention policy (**#1238**, "prune what nothing
reads") has been merged in, and it pruned most of them. In the current working
tree only **5 run logs and 4 annotation files** survive for record-extraction.

**No evidence is lost — it is all in git history.** To reproduce any figure:

```sh
git show a2d5a4cf:eval/runlogs/unit/record-extraction/<file>   # one file
git checkout a2d5a4cf                                          # the whole set
```

Which receipts can still be checked straight from the working tree:

| finding | checkable in tree? |
|---|---|
| Receipt 1 — ut_022 false pass (`v1_2026-07-30_18-56-55` + sibling `18-18-19`) | **yes** |
| Receipt 3 — ut_020 fabricated sex-assertion (`v1_2026-07-25_01-28-31`) | **yes** |
| Finding 0 — noise-floor pair `v1_2026-07-24_17-33-35` → `17-48-31` | **yes** |
| Receipt 2 — ut_009, the 07-25 and both 07-30 runs | **yes** |
| Receipt 2 — ut_009, the 07-13 / 07-21 / 07-24_15-52-42 quotes | needs history |
| Receipt 4 — all 5 invented dimensions | needs history |
| Finding 0 — noise-floor pair `07-19_22-34-49` → `07-21_15-04-23` | needs history |
| Finding 1 — the 26-pass annotation split | needs history |

That the prune landed mid-audit is itself worth noting: **this report is now the
only surviving summary of what those 34 pruned runs showed.** #1238 is a sound
policy — nothing read those files — but "nothing reads them" stopped being true
for the duration of this audit.

## What was read, and what limits the read

- **39 run logs**, `v1_2026-07-07_07-34-47` → `v1_2026-07-30_18-56-55`, all on
  the `v1` candidate line. **There is no released `v1.json`**, so cross-*version*
  trend is unavailable; the 39 candidates are treated as a time series.
- **26 `.ann.json` siblings** — 2,332 reviewed dimension-instances, out of
  **3,412** graded across 651 test-instances.
- **Skill under test:** `claude-sonnet-4-6` on all 39 runs (the envelope's
  `model` field). **Judge:** `DEFAULT_JUDGE_MODEL = "claude-haiku-4-5-20251001"`
  at `JUDGE_TEMPERATURE = 0.0` (`eval/harness/harness/judge.py:30`, `:40`) —
  the judge model is project-global and is *not* recorded per run, so it is read
  from the harness, not the run log. Minor caveat: only the **first** judge
  attempt is temperature-pinned (`judge.py:410`); a re-sample after a malformed
  response falls back to default sampling by design.
- **Six distinct `judge_prompt_hash` values** across the window, so run-to-run
  movement is confounded by judge-prompt edits as well as skill edits.
- The corpus **grew from 13 to 27 tests** over the window. Only the last two run
  logs (both 2026-07-30) cover all 27. ut_021–ut_028 have **2 runs each** —
  any claim about them is a two-sample claim.

## Finding 0 — the noise floor, which governs every number below

Across all 38 adjacent run-log pairs, exactly **two** are identical on **both**
the `snapshot` and the `judge_prompt_hash` — genuine no-change pairs. Their
grades still moved:

| pair | dimension-instances changed | test outcomes flipped |
|---|---|---|
| `v1_2026-07-19_22-34-49` → `v1_2026-07-21_15-04-23` | **17 / 99 (17.2%)** | 4 / 18 |
| `v1_2026-07-24_17-33-35` → `v1_2026-07-24_17-48-31` (15 min apart) | **9 / 99 (9.1%)** | 5 / 19 |

Two-step swings inside the first pair, with nothing committed in between:

```
ut_record_extraction_014  Evidence type accuracy    1 -> 3
ut_record_extraction_010  Evidence type accuracy    3 -> 1
ut_record_extraction_016  Informant identification  3 -> 2
```

**The noise floor of this suite is 9–17% of dimension-instances and 22–26% of
test outcomes.** Part is the skill sampling freely (`eval/CLAUDE.md`: no
`temperature=0` on the skill run) and part is the judge, but the total is what
an optimizer sees. **Any per-dimension delta below ~17% on this suite is
indistinguishable from noise.**

Related: `flaky: true` appears **zero times in 651 test-instances**. Under
`runs_per_test: 1` the field cannot fire — the harness's own flakiness signal is
dead by construction, not healthy.

## Finding 1 — 75% of the annotation corpus is not review

Of 26 annotation passes, **19 contain zero comments and zero disagreements** —
the CRUD UI "Agree with all" signature — contributing **1,759 of 2,332 rows**.
Every recorded disagreement in the corpus comes from the other 7 passes.

An "Agree with all" bulk click and a considered review are **indistinguishable
in the file format**. This is why the headline agreement figure is inflated, and
why `check-runlogs` rule 3 (an annotation entry for every dimension) passes on
data that was never examined.

**This is a tooling gap, not a diligence failure.** "Agree with all" is a button
the CRUD UI offers, and on a pass where the judge got nearly everything right it
is a reasonable thing to press. The defect is that pressing it leaves a file
byte-indistinguishable from a pass someone read line by line — so the corpus
cannot tell the reviewer's *intent*, and any calibration computed from it
silently inherits that ambiguity. The fix is a `reviewed` marker distinct from
`corrected_score == llm_score`; until that exists, agreement figures over this
corpus need the split below to mean anything.

<details>
<summary><strong>Re-annotation queue</strong> — the 19 passes with no comment on any row (click to expand)</summary>

Listed so the work can be planned, not to attribute blame. A pass appears here
if **zero** of its rows carry a comment; that is the only signal the format
offers. Re-review is done in the CRUD UI — per `eval/CLAUDE.md`, unit `.ann.json`
files are never hand-edited.

| run log | rows | annotator |
|---|---|---|
| `v1_2026-07-07_21-14-10` | 69 | ernestjacob789@gmail.com |
| `v1_2026-07-08_11-47-33` | 69 | dallan@quass.org |
| `v1_2026-07-09_02-19-15` | 75 | judmc.26@gmail.com |
| `v1_2026-07-09_23-42-07` | 75 | dallan@quass.org |
| `v1_2026-07-10_08-24-22` | 75 | judmc.26@gmail.com |
| `v1_2026-07-11_19-34-39` | 87 | dallan@quass.org |
| `v1_2026-07-11_21-43-59` | 88 | dallan@quass.org |
| `v1_2026-07-12_00-32-42` | 75 | dallan@quass.org |
| `v1_2026-07-12_16-23-36` | 75 | dallan@quass.org |
| `v1_2026-07-13_06-33-04` | 88 | dallan@quass.org |
| `v1_2026-07-16_21-39-40` | 100 | dallan@quass.org |
| `v1_2026-07-17_00-10-25` | 100 | dallan@quass.org |
| `v1_2026-07-17_16-13-28` | 93 | dallan@quass.org |
| `v1_2026-07-19_03-22-09` | 81 | dallan@quass.org |
| `v1_2026-07-19_22-34-49` | 99 | dallan@quass.org |
| `v1_2026-07-21_15-04-23` | 99 | edesonchristopher@gmail.com |
| `v1_2026-07-24_17-48-31` | 105 | dallan@quass.org |
| `v1_2026-07-30_18-18-19` | 153 | dallan@quass.org |
| `v1_2026-07-30_18-56-55` | 153 | dallan@quass.org |

**Priority.** `v1_2026-07-30_18-56-55` is the one that matters most: it is the
newest pass, it covers all 27 tests, and it is the pass that affirmed the ut_022
false pass (Receipt 1) as human-reviewed ground truth.

</details>

Restricting to the 7 passes that show evidence of review:

| dimension | agree% (all rows) | agree% (reviewed passes) |
|---|---|---|
| base / Correctness | 97.7% | **90.6%** |
| base / Tool Arguments | 98.6% | **94.3%** |
| rubric / Informant identification | 98.9% | **95.3%** |
| rubric / Evidence type accuracy | 99.1% | **96.5%** |
| base / Completeness | 99.8% | 99.1% |
| rubric / Assertion atomicity | 100% | 100% |

**Further caveat, and it is a serious one.** Of the 24 recorded disagreements,
**18 come from a single pass** (`v1_2026-07-25_01-28-31.ann.json`) whose comment
fields are largely the judge's own rationale pasted back with no added human
reasoning — and two of whose rows are demonstrably wrong (see Receipt 5). The
judge-vs-human divergence check cannot be run at the confidence #974 implies.
The trustworthy annotation signal is the opposite shape: `v1_2026-07-08_15-47-10`
(15 comments, 0 disagreements), `v1_2026-07-15_13-37-42` (14, 0),
`v1_2026-07-15_18-06-50` (14, 0), `v1_2026-07-21_15-30-31` (8, 0) — **51
reasoned agreements, worth more than the 18 unreasoned disagreements.**

## Dimension scorecard

Pass% is the score-3 rate over all 39 runs.

| dimension | pass% (positive tests) | reviewed agree% | correction direction | verdict |
|---|---|---|---|---|
| base / **Correctness** | **61%** | **90.6%** | 5 fail / 5 pass — no direction | **Discriminates, not trustworthy** |
| base / **Completeness** | 94% | 99.1% | — | Non-discriminating, honest |
| base / **Tool Arguments** | 81% | 94.3% | **5 of 6 are `2 → 3`** | **Trustworthy** |
| rubric / **Assertion atomicity** | 93% | 100% | — | **Noise — see Receipt 1** |
| rubric / **Informant identification** | 81% | 95.3% | **4 of 4 are `3 → 2`** | Noise per-run; direction readable |
| rubric / **Evidence type accuracy** | 81% | 96.5% | 2 fail / 1 pass | Noise per-run; direction readable |

**Trustworthy: `Tool Arguments`, and only that.** Its N/A policy is honored in
**117 of 117** zero-tool-call instances, and its disagreements point one way —
the judge is too harsh on clean validation recoveries, 5 times in 6, which
`rubric.md` §"Recovered validation retries" already legislates and the judge
still misses. That single systematic gap is a real flag-#4 signal.

**Noise: `Assertion atomicity`, `Informant identification`, `Evidence type
accuracy.`** All three swing on snapshot-identical reruns. Their *aggregate*
direction over many runs is meaningful — `Informant identification` errs
**only** toward leniency (0 false fails, 4 false passes) — but their per-run
score is not. An improver must never chase single-run movement in these.

**`Correctness` is the dangerous one.** Widest spread (61%), so it *looks* like
the best discriminator, and worst human agreement (90.6%). Its content is a
mixture: genuine defects blended with classification re-grading that **both**
governing documents forbid — `rubric.md` line 13 ("Do not fail or dock
**Correctness** for a classification call") and `eval/harness/judge/prompt.md`
lines 114–118. An improver optimizing Correctness will chase classification
prose it cannot win.

**`Assertion atomicity`'s 100% agreement means "never contested", not
"correct".** It is the dimension that shipped the false pass (Receipt 1).

**Non-discriminating tests, cleanly.** `ut_004`, `ut_011`, `ut_012` are
**39/39 pass, 351 dimension-instances, zero variance** — ~23% of the graded
base-dimension mass, and they cannot fail. Keep them as routing tripwires;
exclude them from any pass-rate an improver optimizes.

## The receipts, adjudicated

**Net result first, so the detail below reads correctly: this audit confirms
#974.** Its two named false-fail receipts hold up — one verbatim, one
substantially strengthened — and its false pass is real and did ship. **One
correction is owed: the false pass is on `Assertion atomicity`, not the
evidence-type dimension.** That matters operationally (looking for it under
evidence-type will not find it), not directionally.

Receipts 4 and 5 below were surfaced *by* this audit and are not #974's claims;
they are labelled as such where they appear. Receipt 5 in particular refutes an
annotation, not the issue.

### Receipt 1 — the false pass. Real, but on a different dimension than claimed.

#974 says a run "wrote `direct` on all eight birth years — against doctrine —
and the judge scored the evidence-type dimension a 3."

**The run exists: `ut_record_extraction_022`** (1870 census, John Baker
household of eight) in `v1_2026-07-30_18-56-55.json`. It emits two birth
assertions per person, and for all eight the `direct` one is shaped:

```json
{"record_role": "child_1", "fact_type": "birth",
 "value": "born about 1845, Ohio", "place": "Ohio, United States",
 "date": null, "evidence_type": "direct"}
```

The year is not in a structured field — it is **smuggled into the `value`
string** of a `place`-keyed assertion. This is why a scan of `date`-bearing
assertions finds nothing.

**Two corrections to the issue's framing, both load-bearing:**

1. **The evidence-type 3 is defensible, not a false pass.** Every *structured*
   `evidence_type` in ut_022 is correct: all eight `place`-keyed assertions are
   `direct`, all eight `date`-keyed assertions are `indirect`. That is exactly
   what `rubric.md` line 78 prescribes. The claim "wrote `direct` on all eight
   birth years" is not true of the persisted classification — the eight birth
   *years* are all `indirect`.
2. **The false pass is on `Assertion atomicity`.** Scored **3**, with the
   rationale *"No compound facts mixing multiple distinct information into one
   value field"* — **affirmatively false about the file it is grading, eight
   times.** `rubric.md`'s own **partial** bullet describes this exact pattern
   ("a single assertion whose `value` mixes two distinct facts — 'age 5, born
   Ireland'"). It should have been a 2.

**And it shipped.** Test outcome `pass`;
`v1_2026-07-30_18-56-55.ann.json` is a 153-row silent bulk-agree pass, so the
false pass entered the corpus as human-affirmed ground truth.

**The sibling run 38 minutes earlier half-caught it.**
`v1_2026-07-30_18-18-19.json` scored `Assertion atomicity` **2**, correctly
naming the pattern — but counted *"2 of 62 assertions"*. It was 8 of 62: the
judge found it in the two adults and did not check the six children.

**This qualifies Finding 3 below.** ut_022 carries 6 `expected_classifications`
matchers and `test_expected_classifications` **passed — correctly**, because
the matchers key on structured attributes (`attribute: place` → `direct`,
`attribute: date` → `indirect`) and are **blind to free text in `value`**.
Matcher coverage immunizes against the shapes the matchers key on; it does not
immunize against false passes generally.

To be precise about whose claim that narrows: #974 says matchers are "the only
instrument that catches a false pass," and **that stands** — nothing else in the
harness can. What ut_022 refutes is the stronger reading, that matcher coverage
*eliminates* false passes on a test. It does not.

**No other candidate exists.** Every assertion-shaped object in all 39 run logs
was walked (recursing through `runs[].output.tool_calls[].args` and
`file_changes`, not pattern-matched — a flat regex misses these, which is why
the first search for this receipt came up empty). ut_026 (1900 census, states
birth month+year, so `direct` is right) and ut_027 (correctly `indirect`) are
both correct behavior.

### Receipt 2 — ut_009 penalized for the assertion pair its ground truth authorizes. Confirmed, and understated.

`v1_2026-07-30_18-56-55`, ut_009, `Informant identification = 2`:

> "Critical error: Patrick's name (a_001), sex (a_002), and race (a_003) are
> attributed to Mary Flynn with family_not_present proximity... **These should be
> attributed to the certificate/recorder** or marked differently."

The test's own `judge_context`, bullet 9:

> "**Do NOT penalize the decedent's name/occupation attributed to the named
> personal informant at family_not_present** — that is the doctrine."

And `rubric.md` line 52 says the same. **But the judge holds three mutually
exclusive doctrines across the 13 runs where the validator affirmed the run:**

| run | demand |
|---|---|
| `v1_2026-07-24_15-52-42` | **age, birthplace, both parents' names must be `direct`, not `indirect`** |
| `v1_2026-07-21_15-30-31`, `v1_2026-07-25_01-28-31` | **name/sex/race/occupation must be `indirect`** |
| `v1_2026-07-30_18-56-55` | **name/sex/race must not be attributed to Mary Flynn at all** |
| `v1_2026-07-30_18-18-19`, `v1_2026-07-13_06-33-04` | the same shape is correct |

The first is the sharpest defect in the corpus: all four values it demands be
flipped are `expected_classifications` matchers set to `indirect`, and
`test_expected_classifications` returned `passed: true` **in that same run**.
The judge docked the skill for the four values the deterministic validator had
just affirmed — precisely what `rubric.md` line 67 forbids ("when it passes,
**do not contradict it**").

**#975 is correct and understates it.** ut_009 is **1 pass in 39 runs** (30
partial, 7 fail, 1 aborted) — the worst test in the suite. The single pass
predates the matchers. And **`Correctness` = 2 in all 13 validator-affirmed
runs without exception**, for three different reasons across runs, so even
fixing both classification dimensions leaves ut_009 at `partial`.

#### Doctrine settled for the #975 follow-up (2026-08-04)

The dispute is entirely about the decedent's **own** `name` / `sex` / `race` /
`occupation` — his birth, birthplace, parents and age are already settled as
`indirect` and already have matchers. Adjudicated by the genealogist on the
record above:

> **`evidence_type: direct`, `informant_proximity: family_not_present`.**
> The certificate *states* these, so `direct`; Mary Flynn supplied them, so
> `family_not_present`.

This is what the run already persists, what `judge_context` bullet 9 endorses by
name, and what `rubric.md` line 52 prescribes. It is also consistent with
`rubric.md`'s strictly-graded list, which names **only** birth / birthplace /
parents / age as the death-certificate `indirect` exceptions — the decedent's own
name and occupation are not in it, so the general rule (stated ⇒ `direct`)
applies.

The follow-on work is therefore four `expected_classifications` entries on
`death-certificate-named-informant.json`, encoding exactly that. It is **not**
done in this PR: the edit changes the run-log snapshot, which flips every prior
run log inactive and requires a full 27-test re-run before release
(`check-runlogs` rule 2). Tracked as #975.

Note what this buys. Once those four are matchers, `rubric.md` line 13 ("settled
ground truth wherever the deterministic `expected_classifications` check
verified them") and line 67 ("when it passes, **do not contradict it**") both
bind, and the judge's three incompatible positions become a validator message
naming each id and its expected value. This does **not** on its own make ut_009
pass — `Correctness` is pinned at 2 for reasons outside these four fields — so
#975 should not be closed on the matcher edit alone.

### Receipt 3 — the fabricated sex-assertion defect. Confirmed verbatim.

`ut_record_extraction_020`, `Correctness` = **1**:

> "The skill failed to extract sex assertions for all household members... The
> skill extracted sex assertions for Thomas, Bridget, Patrick, and John (a_015,
> a_024, a_032, a_040), **so sex assertions ARE present** in the persist..."

Asserts the defect, names the four assertions that disprove it, concedes the
requirement was met, scores 1.

### Receipt 4 — five invented dimensions, and two more ways the join key breaks.

**Attribution note:** surfaced by this audit, not claimed in #974. Found by
noticing four dimension names that appear in exactly **one** annotation row each
across all 26 passes, then checking every name in the run logs against every
`rubric.md` snapshot — which turned up a fifth never-annotated invention, plus
the casing and duplication problems below.

`rubric.md` has had **the same three `##` headings in all 39 snapshots**. There
is no superseded rubric version. Each of these is a **dimension the judge
invented** for one test in one run:

| invented name | run | test |
|---|---|---|
| `Handling of suspect required identifier` | `v1_2026-07-11_21-43-59` | ut_016 |
| `Suspect required-identifier handling` | `v1_2026-07-11_23-19-58` | ut_016 |
| `FAN lead treatment` | `v1_2026-07-13_06-33-04` | ut_014 |
| `Judge context — schema facts` | `v1_2026-07-16_21-39-40` | ut_009 |
| `Relationship roles` | `v1_2026-07-17_00-10-25` | ut_017 |

`eval/harness/judge/prompt.md` line 29 says **"Do not invent new ones."**
Nothing checks. Two are the same invented concept under two names, eight hours
apart. And `Judge context — schema facts` is a `###` **sub-heading inside**
`rubric.md` — the judge read a defensive sub-section as a gradeable dimension.

**A sixth instance is worse.** In `v1_2026-07-11_23-19-58` the judge
Title-Cased all three real dimensions — `Assertion Atomicity`,
`Informant Identification`, `Evidence Type Accuracy`, one instance each.
Annotations key on `(test_id, dimension_source, dimension_name)`, and
`ann.schema.json` requires `dimension_name` to match the run log exactly "so the
monthly review can join across files." A casing variant therefore **silently
forks the join key**: those three grades cannot be compared against the
correctly-cased instances (506 `Assertion atomicity`, 506 `Evidence type
accuracy`, 520 `Informant identification`), and `check-runlogs` rule 3 is
satisfied by an annotation on the *variant* name. Same silent-corruption shape
as a duplicate `test.id` under rule 4.

**A seventh pathology, same root cause: duplicate emission.** `Informant
identification` is emitted **twice in a single run** on 14 occasions —
`v1_2026-07-17_00-10-25` (ut_013, ut_016), `v1_2026-07-19_03-22-09` (ut_013,
ut_016), `v1_2026-07-19_22-34-49` (ut_018), `v1_2026-07-21_15-04-23` (ut_017),
`v1_2026-07-21_15-30-31` (ut_009), `v1_2026-07-24_15-52-42` (ut_009),
`v1_2026-07-24_16-31-04` (ut_017), `v1_2026-07-24_17-33-35` (ut_014),
`v1_2026-07-24_17-48-31` (ut_001, ut_016, ut_017), `v1_2026-07-30_18-18-19`
(ut_013). This is the whole of the 520-vs-506 gap.

**No grade is currently corrupted** — the paired scores agree in all 14 cases.
But nothing makes that true: two conflicting scores under one join key would
collapse to whichever the annotation lookup reached first, silently, and rule 3
would still pass. Every run emits either 0 or all 3 rubric dimensions (checked:
zero incomplete sets), so this is duplication, not omission.

### Receipt 5 — refuted. The annotation is the error, not the judge.

**Attribution note:** this item is **not one of #974's five receipts** — the
issue does not mention it. It was surfaced during this audit from an annotator's
comment inside `v1_2026-07-25_01-28-31.ann.json` and is recorded here because it
is a real defect in the calibration data, but the claim being refuted belongs to
that annotation, not to the issue.

The claim is that the judge says "N/A" then emits **3** on zero-tool-call runs.
It is **not correct on either half**:

- The judge emits `null` in **117 of 117** zero-tool-call instances — verified
  exhaustively. Never 3.
- `ann.schema.json` **fully supports null**: `$defs/score` is
  `anyOf: [{integer 1–3}, {null}]`, and 74 of 76 annotated rows on those tests
  record `null → null`.

The two exceptions are both in `v1_2026-07-25_01-28-31.ann.json`, where
`corrected_score: 3` sits against `llm_score: null` with the comment *"Rationale
says 'N/A' then emits 3... Should be N/A."* **The annotator misread the run log
and "corrected" a correct `null` to an incorrect `3`.** Not a judge defect, not
a schema defect — an annotation defect that moved a right answer to a wrong one.

## Finding 3 — where false passes occur

Cross-tabulating every *recorded* correction against whether the test carries
`expected_classifications` matchers (10 of 27 tests do; 73 matchers total):

| test group | agreed | false FAIL | false PASS |
|---|---|---|---|
| matcher-covered | 358 | 3 | **0** |
| judge-only | 1,950 | 8 | **11** |

Every *recorded* false pass is in a judge-only test. **Read with Receipt 1's
qualification:** this measures recorded corrections, and ut_022's false pass was
never recorded as one — it was bulk-agreed. Matchers are blind to free text in
`value`. The honest statement is that matchers eliminate false passes **on the
fields they key on**, which is a strong argument for widening them (#995,
#1108) and not an argument that coverage alone closes the class.

Measured asymmetry: of 38 runs where `test_expected_classifications` genuinely
passed, **16 were still docked** on a classification dimension (42%) —
concentrated in ut_009 (11 of 13, 85%) versus ut_003 (3 of 17, 18%).

## Finding 4 — the defensive prose is now part of the problem

`rubric.md` appears in **11 distinct revisions** across the 39 snapshots:

| first seen in | lines | chars |
|---|---|---|
| `v1_2026-07-07_07-34-47` | 27 | 2,545 |
| `v1_2026-07-09_02-19-15` | 40 | 4,668 |
| `v1_2026-07-11_19-34-39` | 62 | 7,064 |
| `v1_2026-07-12_16-23-36` | 66 | 8,653 |
| `v1_2026-07-16_21-39-40` | 79 | 15,013 |
| `v1_2026-07-19_03-22-09` | 81 | 16,029 |
| `v1_2026-07-30_18-18-19` | 87 | **17,076** |

(Four intermediate revisions between 7,064 and 8,653 omitted for brevity.)

A **6.7× expansion in 23 days**. For scale, `eval/harness/judge/prompt.md`
(project-global, 274 lines) is 12,652 chars — **this one skill's rubric is 135%
of the global judge prompt.** With ut_009's `judge_context` (2,938 chars, 9
bullets) the grading scaffold reaches **32,666 chars ≈ 8,200 tokens before any
skill output**, containing **37 prohibitive directives** — 31 in `rubric.md`,
6 in that `judge_context` (counting "do not" / "don't" / "never") — several
restating the same doctrine in three places. The grader is `claude-haiku-4-5`.

Score-3 rate on the tests present throughout the window (ut_001–ut_012), by
rubric size — the five eras with usable sample sizes:

| rubric.md | Evidence type acc | Informant ident | Assertion atom | Correctness |
|---|---|---|---|---|
| 2,545 | 78% (69/89) | 82% (73/89) | 92% (82/89) | 75% (89/119) |
| 7,064 | 77% (34/44) | 55% (24/44) | 91% (40/44) | 56% (33/59) |
| 8,653 | 65% (22/34) | 82% (28/34) | 88% (30/34) | 63% (31/49) |
| 16,029 | 87% (67/77) | 92% (74/80) | 97% (75/77) | 81% (84/104) |
| 17,076 | 83% (15/18) | 83% (15/18) | 94% (17/18) | 71% (17/24) |

The prose does help — Evidence type accuracy 78% → 83–87%, Informant
identification 82% → 83–92% — but that is confounded with genuine skill
improvement over the same window, so treat it as an upper bound. **The decisive
comparison: the entire measured gain from a 6.7× expansion is 5–8 points. The
noise floor is 9–17 points.** The rubric has been enlarged past the point where
more of it can be distinguished from variance.

The final era reads *worse* than the one before it on **all four** dimensions
(87→83, 92→83, 97→94, 81→71) — but on 18–24 observations against 77–104, so
that is suggestive, not established. Six further eras are omitted above for
sample sizes of 9–18.

Three symptoms confirm the judge no longer reads it as a whole: it graded a
`###` sub-heading as a dimension; on ut_009 it *cites* the ⚠️ callout by name
and applies it to the wrong record type (the exact generalization line 77
forbids in its next sentence); on ut_022 it wrote "no compound facts" about a
file with eight. That is the failure mode of a **long** prompt, not an ambiguous
one — and since the sonnet-5 bump showed the same inversion at 3.4× cost,
**prompt length is the remaining lever, not model capability.**

## Routing

| finding | action | owner |
|---|---|---|
| R1 — ut_022 false pass on 8 compound `direct` birth assertions | extend `expected_classifications` in `census-1870-indexed-surname-variant.json` to all 8 roles | loop-runner |
| R1 — durable fix | validator: a `birth` assertion with `place` set and `direct` must carry no 4-digit year in `value` | **developer** |
| R2 — ut_009 cannot pass; 3 incompatible judge doctrines; Correctness pinned at 2 in 13/13 | add matchers for `name` / `sex` / `race` / `occupation` — the exact locus of every dispute | **loop-runner (highest leverage on #975)** |
| R4 — judge invents dimensions (5), re-cases real ones (3), and emits one twice (14 runs) | mechanical check in `judge.py::_extract_dimensions`: reject unknown names, casing-only variants, and duplicate `(source, name)` pairs. `harness/rubric.py` already parses the valid set and `judge.py` already holds the `Rubric` | **developer / maintainer** |
| R2 — Correctness re-grades classification against `rubric.md` L13 | global judge prompt — suggestion only | maintainer |
| R5 — two annotation rows corrected a right `null` to a wrong `3` | re-review in the CRUD UI (never hand-edit) | loop-runner |
| F1 — bulk-agree indistinguishable from review in the file format; 75% of corpus unusable | schema/UI gap — needs a `reviewed` marker distinct from `corrected_score == llm_score` | **developer** |
| F4 — rubric at 135% of the global judge prompt; gains below the noise floor | prompt-architecture decision; no wording proposed | maintainer |
| F0 — noise floor 9–17%; `flaky` structurally dead under `runs_per_test: 1` | gate any improver claim on this suite at >17% delta | loop-runner (advisory) |

## What looks healthy — do not touch

- **`base/Tool Arguments`** — the only trustworthy dimension; 117/117 correct
  N/A handling.
- **The deterministic layer.** `test_expected_classifications` is the
  highest-value artifact in this suite: right every time it fired, with
  specific actionable failure notes and honest "skipped:" notes. Both of the
  most serious findings are cases where the **judge contradicted or out-ran a
  passing validator** — never the reverse.
- **`ut_004` / `ut_011` / `ut_012`** — boring by design; keep as tripwires.
- **`base/Completeness`** — not a discriminator, but not misleading.
- **The 51 reasoned agreements** in the four commented passes. That is what a
  usable annotation pass looks like. Four of 26.

## The one-line answer to #974's question

Of six dimensions, **one is trustworthy** (`Tool Arguments`), **one is
misleading in the dangerous direction** (`Correctness` — widest spread, worst
agreement, re-grades what it is told not to), **three are per-run noise** whose
aggregate direction is still readable, and **one scored 100% human agreement
because nobody ever contested it, while shipping the corpus's only false pass**.

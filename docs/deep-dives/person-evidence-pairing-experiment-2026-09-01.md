# person-evidence pairing experiment — measured result, 2026-09-01

The conversion of `person-evidence` into a skill-agent pair was run as an
experiment: does pairing grade better, or cost less, when it is **not** bought to
stop a bypass? This skill was chosen because it has the weakest bypass case of
the four guardrail skills — 10% of the runs that write `person_evidence` never
invoke the skill, against `conflict-resolution`'s 84%.

Three paid arms were run against two committed pre-conversion baselines. All
figures are from `eval/runlogs/unit/person-evidence/`. **Re-measure rather than
quoting these** — the corpus and the fixtures both move.

## The arms

| arm | config | skill $ | vs baseline mean | output tok | turns | wall | pass / partial / fail |
|---|---|---:|---:|---:|---:|---:|---|
| baseline 08-24 | monolithic skill | 6.5653 | — | 133,056 | 271 | 2,379s | 15 / 5 / 2 |
| baseline 08-27 | monolithic skill | 7.1441 | — | 154,947 | 307 | 1,349s | 19 / 3 / 0 |
| **A** | paired, sonnet-4-6, **warnings pass missing** | 5.4861 | **−20.0%** | 118,480 | 114 | 1,104s | 7 / 4 / 11 |
| **B** | paired, sonnet-4-6, corrected | 7.9442 | **+15.9%** | 152,049 | 263 | 1,555s | 9 / 4 / 8 (+1 abort) |
| **C** | paired, **haiku-4-5** pin, corrected | 4.7757 | **−30.3%** | 128,536 | 217 | 1,258s | 10 / 5 / 7 |

Baseline mean skill cost: $6.8547. Arms A and B are committed as candidate run
logs. **Arm C is not committed** — its snapshot pins a model the shipped agent
does not use, which would make it the latest run log and fail the runlog gate's
rule 2. Its figures are recorded here instead; reproducing the file is one
`run_tests.py` invocation with the pin moved.

## Result 1 — grading did not improve in any arm

**Zero tests improved, in any of the three arms**, against 10–14 regressions
each (measured against best-of-baseline per test).

| arm | regressed | improved |
|---|---:|---:|
| A | 14 | 0 |
| B | 12 raw, **11 after human annotation** | 0 |
| C | 10 | 0 |

**One of arm B's regressions was a judge error, not a fold regression.** The
annotator moved `ut_person_evidence_018` from 1 to 3 on all three base dimensions
— the run did create the link and correctly redirected the merge to `tree-edit`
— so the honest count for arm B is 11. Two further corrections raised `_001`
(Correctness, Rationale quality: a wording slip, not a reasoning error) and
`_021` (Correctness, Person minting: the fixture's synthetic ids meant the
FamilySearch quality check could not apply and the warnings tool was
unavailable), without changing either test's outcome tier. Seven score changes in
all, across three tests; `_025`'s eight dimensions were reviewed and the judge
agreed with.

**A third of the suite is unannotated by design.** Seven tests produced no graded
dimensions at all — `_012`, `_013`, `_015`, `_022`, `_023` among them — because
validators gate before the judge runs. Their outcomes rest on validator results,
not on human-checked judge scores, and the review sample could only draw from the
graded remainder.

Section 3b of `docs/skill-to-agent-pair-conversion.md` predicts that
boundary/routing tests are the one place a conversion is likely to *help* — a
reliable xfail-to-xpass boundary flip was measured on the first conversion. **No
such effect appeared here.** The eight tests that held steady across all arms
include the negative/routing set, but none moved up.

## Result 2 — the cost saving in arm A was the missing work, not efficiency

Arm A read as a 20% saving. It was not one. The warnings pass had silently fallen
out of the fold (Result 4 below), and turns tell the story: **114 against a
baseline of ~289**. With the step restored, arm B ran 263 turns and cost **16%
more** than baseline.

**Cost only improves via the model pin.** Arm C's −30.3% exists because an agent
can carry a `model:` and a skill cannot — per-step model routing exists nowhere
else. That is the fold's one demonstrated benefit, and it is bought at the cost
of Result 3.

Arms A and B differ by **45%** in skill cost from one another. One paired run is
therefore not a cost measurement, and the −30.3% is a single observation.

## Result 3 — a prose gate that must *hold* weakens across the delegation boundary, and degrades further on a cheaper model

The residual failures are almost entirely one rule: the agent stops calling
`same_person` before asserting an identity.

| arm | `same_person` validator failures |
|---|---:|
| A (sonnet) | 9 (5 + 4) |
| B (sonnet) | 9 (5 + 4) |
| C (haiku) | **11 (6 + 5)** |

Identical to the count across two independent sonnet runs, and **worse on the
cheaper model**. Arm C also introduced a failure the sonnet arms never showed —
a confidence-calibration miss (`high_score_conflict_not_confident`), which is
the judgement half of the skill rather than its bookkeeping.

This is section 2 of the conversion guide measured directly: *a prose gate
weakens when it crosses a delegation boundary*. It is also the strongest evidence
yet for the ADR-0011 ordering rule — **move a rule that must hold into the writer
tool before the prose moves.** That step was skipped here for a documented
reason: the candidate precondition is satisfiable by 437 of 6,550 reachable links
(6.7%), so a refusal would break 144 of the 151 runs that link a person, and the
conversion guide's step 3 sanctions saying so rather than inventing a gate. The
consequence of skipping it is this table.

## Result 4 — an agent cannot invoke a skill, and a fold can drop a step silently

The monolithic body instructed itself to invoke `check-warnings` after writing.
Folded into an agent, that instruction became unexecutable: **no shipped plugin
agent grants a `Skill` tool**, and the routing skill did not mention the step
either. It existed nowhere and ran zero times in arm A.

Measured, before and after moving the pass to the router:

| | arm A | arms B and C |
|---|---:|---:|
| `check-warnings` invoked | **0 of 22** | **17 of 22** |
| `test_check_warnings_runs_after_a_write` failures | 4 | **0** |

Two further failures cleared with it incidentally (a tree `sources` write outside
the agent's ownership, and a null `match_score`).

**This generalises to every remaining conversion.** Any skill body that delegates
to another skill loses that delegation when folded, and nothing in CI catches it —
it cost one paid run to find here.

## Result 5 — the per-model ledger still does not separate the agent

Both arms report the same two keys in `model_usage`
(`claude-sonnet-4-6`, `claude-haiku-4-5-20251001`) **including arm C, where the
agent and main thread ran different models**. So the residual question left open
by the token-accounting fix — whether an agent's usage can be attributed
separately — is **still unanswered**, and a cost split between router and agent
cannot be read off a run log today.

## Result 6 — a missing lane row disables the out-of-lane check entirely

Not a run result; found by breaking each new guard to watch it fail. Removing the
agent's `AGENT_WRITABLE_SECTIONS` row broke **no test**, and because
`owner_denied` gates that arm on `writable is not None`, a missing row skips the
check completely — the agent could write any section unchecked. That is the
2026-08-19 proof-conclusion incident with a different actor. Three hook tests
were added; the row now has a guard.

The **class** outlives this conversion: a lane row with no behavioural test is a
gap every future pair reproduces.

## What the experiment answers

On the question as posed — does pairing grade better or cost less when nothing is
bypassing?

- **Grade better: no.** Zero improvements across three arms, 10–14 regressions
  (11 for the shipped configuration after human annotation).
- **Cost less: only with the pin**, at −30.3%, and the pin costs two further
  `same_person` failures plus a calibration miss.

The trade on offer is therefore roughly **−30% cost for −10 tests** on the step
every downstream conclusion rests on. What a pair buys beyond that is caller
attribution, which is worth least on this skill of the four, since 135 of the 150
runs that write the section already invoke its skill.

## Limits of this measurement

- Two baseline arms and one arm per paired configuration. Cost variance between
  two identically-configured arms was 45%.
- One test aborted on wall clock in arm B, suppressing its outcome.
- The judge was skipped on 11 of 22 runs in arm A, because validators gate before
  grading — so arm A's outcome counts are validator-driven, not judge-driven.
- Only 4 of 22 tests pass in every pre-conversion run they appear in. The suite's
  own instability is wide, and a whole-suite delta of one or two tests is inside
  it.

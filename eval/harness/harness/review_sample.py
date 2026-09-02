"""Pick the tests a run log's annotation must cover.

CI rule 3 used to require a correction for every dimension of every test. Over
the committed corpus that produced 9,753 annotation cells, 54 score changes
(0.55%), and 8,918 cells (91.4%) confirmed with no comment written at all — 67%
of annotation files are wordless end to end. Coverage was forced and agreement
was one click, so the pass attested rather than reviewed.

This module picks N tests per run instead. Four slots, and the split is the
point — each answers a different question:

- **Rotation (3)** — coverage. Deterministic, so a suite is swept in
  `ceil(T/3)` runs. Random sampling at the same N would average ~17 runs for a
  15-test suite (coupon-collector), which is why coverage rotates rather than
  randomizes.
- **Targeted (1)** — defect yield. One rule, below: a rubric null standing in
  for a 1, which neither the outcome nor the mandatory slot can see.
- **Random (1)** — the only unbiased estimator of judge accuracy. Every other
  slot is chosen, so only this one supports an honest error rate.
- **Mandatory (uncapped)** — every test that scored a 1 or 2 on any dimension,
  or whose outcome is not `pass`/`xfail`. `is_mandatory` below carries the
  evidence for both triggers. Appended last so the three slots above keep
  drawing from the whole eligible pool.

**The mandatory slot does not replace the other three, and must not be made to.**
It keys on the judge's own scores, so it is blind by construction to a false
green — and 27 of the corpus's 66 human score changes (41%) are exactly that:
judge 3, human 1 or 2, on a test with no failing dimension. Rotation and the
random slot are the only things that reach those. This is the same
self-confirming-gate argument that killed dead-dimension skipping below.

**Every dimension of a sampled test is reviewed.** An earlier design also
skipped "dead" dimensions inside a sampled test; measured over the corpus that
would have removed 64-69% of cells and hidden 41-50% of every correction ever
made, six of them judge-3 -> human-below-3. Deadness is computed from judge
scores, and the only evidence a judge is wrong is the annotation the rule would
skip — a self-confirming gate. Do not reintroduce it.

The rotation cursor is **carried in the run log**, not derived from annotation
history: `prune_old_candidates` deletes each pruned candidate with its
`.ann.json`, keeping 5, so derived history spans at most 15 tests and 10 suites
are larger (up to 27).
"""

from __future__ import annotations

import random
from typing import Any


N_ROTATION = 3
N_TARGETED = 1
N_RANDOM = 1

# No DEFAULT_N. The sample is no longer a fixed size — the mandatory slot is
# uncapped — so a constant claiming otherwise would be wrong wherever it was
# read. It had no callers when it was removed; keep it that way.

# Outcomes that do NOT make a test mandatory. Everything else does, including
# `fail`, `partial`, `xpass` and `aborted`. `xfail` is a failure someone
# declared in advance, and `pass` is the ordinary case.
_NON_FAILING_OUTCOMES = frozenset({"pass", "xfail"})


def _dimensions(entry: dict[str, Any]) -> list[dict[str, Any]]:
    return entry.get("outcome_summary", {}).get("aggregated_dimensions") or []


def is_gradeable(entry: dict[str, Any]) -> bool:
    """True when the test produced at least one graded dimension.

    The judge is skipped when validators fail or a run aborts, leaving
    `aggregated_dimensions` empty — and `rule3_completeness` iterates exactly
    that array, so such a test demands zero corrections. Sampling one wastes a
    slot: on `project-status` 3 of 11 tests are empty, and **76 of the 79** empty
    tests in the corpus failed or aborted — which is exactly what `is_mandatory`
    matches — so without this filter the mandatory slot would be biased *toward*
    tests with nothing to annotate.

    Excluded is not unnoticed: `rule3_completeness` warns about these
    separately, because an ungraded test is a signal, not an absence.
    """
    return bool(_dimensions(entry))


def zero_dimension_test_ids(tests: list[dict[str, Any]]) -> list[str]:
    return [t["test_id"] for t in tests if not is_gradeable(t)]


def _has_rubric_null_on_positive(entry: dict[str, Any]) -> bool:
    if entry.get("test_type") == "negative":
        return False
    return any(
        d.get("source") != "base" and d.get("score") is None
        for d in _dimensions(entry)
    )


def is_mandatory(entry: dict[str, Any]) -> bool:
    """A test a human must read this run, whatever the other three slots picked.

    Two triggers, both measured over the 102 committed run logs that carry a
    `review_sample`:

    - **A dimension scored 1 or 2.** 131 of the 216 tests carrying one were
      never sampled, so nobody read them; 65 of 102 runs shipped with at least
      one, and 26 of those owed not a single written comment. Per cell, a human
      changed the judge's score on 5.92% of cells belonging to such a test
      (38/642) against 0.61% everywhere else (28/4,581) — 9.7x the yield.
    - **An outcome that is not `pass` or `xfail`.** 14 tests fail on routing or
      activation with every dimension scored 3 or null, which the first trigger
      cannot see. 11 were already sampled, so this one costs 3 tests across the
      whole corpus.

    **Non-gating tests are deliberately included.** A routing negative renders
    `outcome: pass` beside a diagnostic 1 by design — `dimensions_gate_outcome`
    exists to mark exactly that — and the obvious call is to skip it. The corpus
    says the opposite: those cells carry the highest correction rate in it,
    17.28% (14/81), against 4.28% (24/561) for gating tests with a 1 or 2. The
    likely reason is that nobody was ever made to look, while `rubric-critic`
    and `skill-improver` read those dimensions as real signal. Deterministic
    routing deference explains only 4 of the 77, so the harness is not
    manufacturing them. Do not "fix" this by keying on
    `dimensions_gate_outcome`; that was proposed, measured, and rejected.
    """
    if entry.get("outcome") not in _NON_FAILING_OUTCOMES:
        return True
    return any(d.get("score") in (1, 2) for d in _dimensions(entry))


def select_review_sample(
    *,
    tests: list[dict[str, Any]],
    prior_sample: dict[str, Any] | None = None,
    seed: int = 0,
    n_rotation: int = N_ROTATION,
    n_targeted: int = N_TARGETED,
    n_random: int = N_RANDOM,
) -> dict[str, Any]:
    """Return `{"tests": [...], "cursor": [...], "seed": seed}`.

    `cursor` is every test **sampled by any slot** since the sweep last
    wrapped — not just the rotation picks. That distinction is load-bearing:
    while the cursor tracked rotation alone it reset on every wrap, so a test
    matching a targeted rule was nearly always "unswept" and won the slot
    again. Simulated over the committed corpus that pinned one test on 20 of
    20 chained runs in 10 of 25 suites, making the effective sample 4 rather
    than 5. Counting every sampled test also makes coverage faster, since a
    targeted or random pick is a review like any other.

    It rides in the run log so it survives candidate pruning.

    Pure: same inputs, same output. `seed` drives the random slot only.
    """
    eligible = [t for t in tests if is_gradeable(t)]
    ids = sorted(t["test_id"] for t in eligible)
    by_id = {t["test_id"]: t for t in eligible}
    if not ids:
        return {"tests": [], "cursor": [], "seed": seed}

    cursor = [tid for tid in (prior_sample or {}).get("cursor", []) if tid in by_id]

    picked: list[str] = []

    # --- Rotation: deterministic sweep -----------------------------------
    remaining = [tid for tid in ids if tid not in cursor]
    for _ in range(min(n_rotation, len(ids))):
        if not remaining:
            # Sweep complete — wrap. Everything becomes eligible again, minus
            # what this run already picked, so a wrap cannot pick a duplicate.
            cursor = []
            remaining = [tid for tid in ids if tid not in picked]
            if not remaining:
                break
        tid = remaining.pop(0)
        picked.append(tid)
        cursor.append(tid)

    # --- Targeted: ranked rules, first UNSWEPT match wins ------------------
    #
    # ONE rule now. Six were tried, then two, then this. Every cut was scored
    # against the only ground truth available — a human changed the judge's
    # score — and the bar for adding one back is the same: score it, because a
    # rule that fires often is not the same as a rule that finds anything.
    #
    # Of the original six, four earned nothing: `_score_moved` caught zero
    # uniquely while owning the heaviest plumbing (a previous-run baseline
    # threaded through the whole call), a `not previous` rule matched every test
    # on a first run, and neither `_validator_judge_conflict` nor
    # `_rationale_hedges` added a catch the survivors missed.
    #
    # `_outcome_disagrees` was the fifth, deleted when the mandatory slot landed
    # because that slot subsumes it **structurally**. `expected_outcome` is only
    # `pass` or `xfail`, and `build_test_entry` normalizes an xfail run to
    # `xfail`/`xpass`, so a disagreement can only ever be `partial`, `fail`,
    # `aborted` or `xpass` — and `is_mandatory` takes all four. It was a strict
    # subset: across the corpus it matched 170 tests, every one already
    # mandatory, and reached none of the 66 human score changes the surviving
    # rule and the mandatory slot do not. The shape that would have escaped
    # (expected a failure, got a plain `pass`) cannot be constructed. Its own
    # unit test could no longer be written either — a fixture matching it puts
    # every test in the sample and isolates nothing. Do not re-add it.
    #
    # `_has_rubric_null_on_positive` survives because it is the one rule that
    # reaches a shape nothing else can. It selects the corpus's one documented
    # rubber-stamped test, and blind grading was closed `not planned` naming
    # this slot as the mitigation. A rubric null on a positive test is also the
    # one shape `_compute_outcome` cannot see: it gates on 1 and 2, and null is
    # neither, so a null standing in for a 1 records the run as a pass — which
    # is exactly why the mandatory slot, keyed on 1s and 2s, misses it too.
    #
    # The rule carries an exhaustion guard. These signals are structural, not
    # transient: a test that matches matches on every run forever — a rubric
    # dimension the fixture never exercises. Without the guard, simulation over
    # the committed corpus showed **10 of 25 suites pinning one test on 20 of 20
    # chained runs**, making the effective sample 4 distinct tests rather than
    # 5. So the rule only wins with a candidate this sweep has not covered; when
    # its matches are all swept the slot falls through to the degradation below.
    # The list survives a single rule so a second can be scored in without
    # reshaping the loop.
    rules = [
        _has_rubric_null_on_positive,
    ]
    available = [tid for tid in ids if tid not in picked]
    targeted: list[str] = []
    for matches in rules:
        fresh = sorted(
            tid
            for tid in available
            if tid not in cursor and matches(by_id[tid])
        )
        if fresh:
            targeted = fresh[:n_targeted]
            break

    # Two ways to arrive here, and the same answer serves both. A clean suite
    # matches no rule at all — every dimension passed and no rubric null stood
    # in for a 1. Or the rule matched only tests this sweep has already covered,
    # which the freshness filter above rejects on purpose.
    #
    # Degrade to an UNSWEPT test rather than re-picking a swept match. A repeat
    # buys no coverage, and not pinning is the whole point of that filter — an
    # earlier version preferred the swept match here and simulation showed 10 of
    # 25 suites pinning one test on 20 of 20 chained runs. Falling back to any
    # unpicked test keeps the slot from ever being empty, so the sample size
    # stays what the docstring, the CI error message and the behaviour all say.
    if n_targeted and not targeted:
        spare = [tid for tid in ids if tid not in picked and tid not in cursor]
        if not spare:
            spare = [tid for tid in ids if tid not in picked]
        targeted = spare[:n_targeted]
    picked.extend(targeted)
    cursor.extend(t for t in targeted if t not in cursor)

    # --- Random: the unbiased slot ----------------------------------------
    available = [tid for tid in ids if tid not in picked]
    if available and n_random:
        rng = random.Random(seed)
        picked.extend(rng.sample(available, min(n_random, len(available))))

    # --- Mandatory: every failing test, uncapped ---------------------------
    #
    # Appended LAST, deliberately. Seeding `picked` before rotation would pick
    # duplicates — rotation's pool excludes the CURSOR, not `picked` — and it
    # would quietly redefine the mid-rotation wrap's trigger from "the sweep
    # completed" to "the pool is empty", which on a red suite empties the cursor
    # every run forever. Appending here leaves all three slots above drawing from
    # the whole eligible pool, so the random slot stays the unbiased estimator
    # its own bullet claims it is.
    #
    # Uncapped, because the rule is "always". Replaying this sampler over the
    # 102 committed run logs: sample 5 -> median 6, mean 6.6, max 11; cells per
    # run 30.5 -> 36.5 median (1.28x across the corpus); comments owed median
    # 1 -> 3, mean 1.6 -> 4.0. Those are LOWER bounds — committed run logs are
    # converged states, so the failing intermediate runs are not in the corpus
    # they came from. The cost therefore scales with how red a run is, which is
    # the intended incentive: a run that expensive to annotate should not be
    # released.
    picked.extend(
        tid for tid in ids if is_mandatory(by_id[tid]) and tid not in picked
    )

    # Every sampled test counts as covered, whichever slot chose it — see the
    # docstring. Rotation already appended its own; this adds the targeted,
    # random and mandatory picks so they cannot be re-chosen next run.
    #
    # Mandatory picks are folded in like any other. A chronically failing test
    # therefore completes the sweep sooner, and the wrap below fires sooner —
    # which is correct, not degenerate: a wrap means everything really was
    # reviewed since the last one. A second, rotation-only cursor was considered
    # and rejected as a redundant guard on both schema trees.
    covered = sorted(set(cursor) | set(picked))
    # A sweep that now covers everything wraps here rather than on the next
    # call, so the next run starts a clean sweep instead of finding one id left.
    if set(covered) >= set(ids):
        covered = []
    return {"tests": sorted(picked), "cursor": covered, "seed": seed}

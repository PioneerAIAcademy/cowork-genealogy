"""Pick the tests a run log's annotation must cover.

CI rule 3 used to require a correction for every dimension of every test. Over
the committed corpus that produced 9,753 annotation cells, 54 score changes
(0.55%), and 8,918 cells (91.4%) confirmed with no comment written at all — 67%
of annotation files are wordless end to end. Coverage was forced and agreement
was one click, so the pass attested rather than reviewed.

This module picks N tests per run instead. Three slots, and the split is the
point — each answers a different question:

- **Rotation (3)** — coverage. Deterministic, so a suite is swept in
  `ceil(T/3)` runs. Random sampling at the same N would average ~17 runs for a
  15-test suite (coupon-collector), which is why coverage rotates rather than
  randomizes.
- **Targeted (1)** — defect yield. The ranked rules below.
- **Random (1)** — the only unbiased estimator of judge accuracy. Every other
  slot is chosen, so only this one supports an honest error rate.

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

from harness.rubric import COVERED_BY_PREFIX


N_ROTATION = 3
N_TARGETED = 1
N_RANDOM = 1
DEFAULT_N = N_ROTATION + N_TARGETED + N_RANDOM

_HEDGES = ("unclear", "appears to", "cannot determine", "difficult to tell",
           "hard to say", "ambiguous")


def _dimensions(entry: dict[str, Any]) -> list[dict[str, Any]]:
    return entry.get("outcome_summary", {}).get("aggregated_dimensions") or []


def is_gradeable(entry: dict[str, Any]) -> bool:
    """True when the test produced at least one graded dimension.

    The judge is skipped when validators fail or a run aborts, leaving
    `aggregated_dimensions` empty — and `rule3_completeness` iterates exactly
    that array, so such a test demands zero corrections. Sampling one wastes a
    slot: on `project-status` 3 of 11 tests are empty, and **all** the empty
    tests in the corpus have `outcome != expected_outcome`, which is targeted
    rule 4 — so without this the targeted slot is biased *toward* tests with
    nothing to annotate.

    Excluded is not unnoticed: `rule3_completeness` warns about these
    separately, because an ungraded test is a signal, not an absence.
    """
    return bool(_dimensions(entry))


def zero_dimension_test_ids(tests: list[dict[str, Any]]) -> list[str]:
    return [t["test_id"] for t in tests if not is_gradeable(t)]


def _has_rubric_null_on_positive(entry: dict[str, Any]) -> bool:
    """A rubric dimension the judge returned `null` on a positive test.

    Targeted rule 1 exists because a null standing in for a 1 records the run as
    a pass — `_compute_outcome` gates on 1 and 2 and null is neither.

    A **covered_by** null is the opposite of that: a deterministic validator ran,
    passed, and answered the dimension, so the judge was never asked. Treating it
    as the signal would hand the targeted slot to the very dimensions we retired
    to save effort — on every run, in every suite that adopts `covered_by`.
    """
    if entry.get("test_type") == "negative":
        return False
    return any(
        d.get("source") != "base"
        and d.get("score") is None
        and not (d.get("rationale") or "").startswith(COVERED_BY_PREFIX)
        for d in _dimensions(entry)
    )


def _validator_judge_conflict(entry: dict[str, Any]) -> bool:
    """A validator failed while the judge saw nothing wrong, or the inverse.

    Reads the run's `validators.passed` **aggregate**, never the individual
    `results[].passed`. `compute_validators_passed` exempts the file-validity
    validators on a test declaring `intentionally_invalid` — those tests fail
    `test_project_files_pass_full_validation` by design on every run, and the
    judge still grades clean. Scanning raw results reports a permanent conflict
    for them: 5 of 10 `validate-schema` tests plus `ut_project_status_005`
    match, which pins the targeted slot to one test forever.
    """
    scores = [d.get("score") for d in _dimensions(entry)]
    numeric = [s for s in scores if isinstance(s, int)]
    if not numeric:
        return False
    runs = entry.get("runs") or []
    verdicts = [
        run.get("validators", {}).get("passed")
        for run in runs
        if isinstance(run.get("validators"), dict)
        and run["validators"].get("passed") is not None
    ]
    if not verdicts:
        return False
    any_validator_failed = any(v is False for v in verdicts)
    judge_clean = all(s == 3 for s in numeric)
    judge_failed = any(s == 1 for s in numeric)
    return (any_validator_failed and judge_clean) or (judge_failed and not any_validator_failed)


def _score_moved(entry: dict[str, Any], previous: dict[str, dict[str, Any]]) -> bool:
    """A dimension's score differs from the previous releasable run of this test.

    Cross-run, deliberately: that detects a regression. The within-invocation
    reading (`runs[].judge.dimensions`) would only detect flakiness, and
    `runs_per_test` is pinned to 1 repo-wide.
    """
    prev = previous.get(entry.get("test_id"))
    if not prev:
        return False
    before = {(d.get("source"), d.get("name")): d.get("score") for d in _dimensions(prev)}
    for d in _dimensions(entry):
        key = (d.get("source"), d.get("name"))
        if key in before and before[key] != d.get("score"):
            return True
    return False


def _outcome_disagrees(entry: dict[str, Any]) -> bool:
    expected = entry.get("expected_outcome")
    return bool(expected) and entry.get("outcome") != expected


def _rationale_hedges(entry: dict[str, Any]) -> bool:
    for d in _dimensions(entry):
        text = (d.get("rationale") or "").lower()
        if any(h in text for h in _HEDGES):
            return True
    return False


def select_review_sample(
    *,
    tests: list[dict[str, Any]],
    prior_sample: dict[str, Any] | None = None,
    previous_tests: list[dict[str, Any]] | None = None,
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
    previous = {t["test_id"]: t for t in (previous_tests or [])}

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
    # Every rule carries the same exhaustion guard, not just rule 1. These
    # signals are structural, not transient: a test that matches one match it
    # on every run forever — a permanently-`intentionally_invalid` validator
    # result, a rubric dimension the fixture never exercises, an `xfail`. An
    # earlier version guarded only rule 1 and simulation over the committed
    # corpus showed **10 of 25 suites pinning one test on 20 of 20 chained
    # runs**, making the effective sample 4 distinct tests rather than 5.
    #
    # So a rule only wins with a candidate this sweep has not covered. When its
    # matches are all swept, the slot falls through to the next rule; when
    # every rule is exhausted, the highest-ranked match wins anyway — a
    # repeated targeted pick beats an empty slot.
    rules = [
        _has_rubric_null_on_positive,
        _validator_judge_conflict,
        lambda e: _score_moved(e, previous),
        _outcome_disagrees,
        lambda e: not previous,
        _rationale_hedges,
    ]
    available = [tid for tid in ids if tid not in picked]
    fallback: list[str] = []
    targeted: list[str] = []
    for matches in rules:
        hits = sorted(tid for tid in available if matches(by_id[tid]))
        if not hits:
            continue
        fresh = [tid for tid in hits if tid not in cursor]
        if fresh:
            targeted = fresh[:n_targeted]
            break
        if not fallback:
            fallback = hits
    else:
        targeted = fallback[:n_targeted] if fallback else []

    # A clean suite matches no rule at all — every dimension passed, nothing
    # moved, no outcome disagreed. The slot then degrades to rotation rather
    # than to nothing, so the sample stays N and the docstring, the CI error
    # message and the behaviour agree. Leaving it empty silently sampled 4 on a
    # fully-green suite while everything claimed 5.
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

    # Every sampled test counts as covered, whichever slot chose it — see the
    # docstring. Rotation already appended its own; this adds the targeted and
    # random picks so they cannot be re-chosen next run.
    covered = sorted(set(cursor) | set(picked))
    # A sweep that now covers everything wraps here rather than on the next
    # call, so the next run starts a clean sweep instead of finding one id left.
    if set(covered) >= set(ids):
        covered = []
    return {"tests": sorted(picked), "cursor": covered, "seed": seed}

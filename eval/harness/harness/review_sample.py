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


N_ROTATION = 3
N_TARGETED = 1
N_RANDOM = 1
DEFAULT_N = N_ROTATION + N_TARGETED + N_RANDOM


def _dimensions(entry: dict[str, Any]) -> list[dict[str, Any]]:
    return entry.get("outcome_summary", {}).get("aggregated_dimensions") or []


def is_gradeable(entry: dict[str, Any]) -> bool:
    """True when the test produced at least one graded dimension.

    The judge is skipped when validators fail or a run aborts, leaving
    `aggregated_dimensions` empty — and `rule3_completeness` iterates exactly
    that array, so such a test demands zero corrections. Sampling one wastes a
    slot: on `project-status` 3 of 11 tests are empty, and **all** the empty
    tests in the corpus have `outcome != expected_outcome`, which is exactly
    what `_outcome_disagrees` matches — so without this the targeted slot is
    biased *toward* tests with nothing to annotate.

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


def _outcome_disagrees(entry: dict[str, Any]) -> bool:
    expected = entry.get("expected_outcome")
    return bool(expected) and entry.get("outcome") != expected


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
    # TWO rules, not six. Scored against the only ground truth available — a
    # human changed the judge's score, n=37 across the committed corpus — the
    # six-rule stack caught 17 and `_outcome_disagrees` ALONE caught 18. The
    # four that were cut earned nothing: `_score_moved` caught zero uniquely
    # while owning the heaviest plumbing (a previous-run baseline threaded
    # through the whole call), a `not previous` rule matched every test on a
    # first run, and neither `_validator_judge_conflict` nor `_rationale_hedges`
    # added a catch the survivors missed. Do not re-add a rule without scoring
    # it against that n=37; a rule that fires often is not the same as a rule
    # that finds anything.
    #
    # `_has_rubric_null_on_positive` stays FIRST despite ranking below
    # `_outcome_disagrees` on that metric. It is the only rule that selects the
    # corpus's one documented rubber-stamped test, and blind grading was closed
    # `not planned` naming this slot as the mitigation. A rubric null on a
    # positive test is also the one shape `_compute_outcome` cannot see: it
    # gates on 1 and 2, and null is neither, so a null standing in for a 1
    # records the run as a pass.
    #
    # BOTH rules carry the same exhaustion guard. These signals are structural,
    # not transient: a test that matches one matches it on every run forever — a
    # rubric dimension the fixture never exercises, an `xfail`. An earlier
    # version guarded only the first rule and simulation over the committed
    # corpus showed **10 of 25 suites pinning one test on 20 of 20 chained
    # runs**, making the effective sample 4 distinct tests rather than 5. So a
    # rule only wins with a candidate this sweep has not covered; when its
    # matches are all swept the slot falls through to the next rule, and when
    # every rule is exhausted the highest-ranked match wins anyway — a repeated
    # targeted pick beats an empty slot.
    rules = [
        _has_rubric_null_on_positive,
        _outcome_disagrees,
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

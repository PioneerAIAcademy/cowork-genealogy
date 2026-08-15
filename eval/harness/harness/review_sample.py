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
    if entry.get("test_type") == "negative":
        return False
    return any(
        d.get("source") != "base" and d.get("score") is None
        for d in _dimensions(entry)
    )


def _validator_judge_conflict(entry: dict[str, Any]) -> bool:
    """A validator failed while the judge saw nothing wrong, or the inverse."""
    scores = [d.get("score") for d in _dimensions(entry)]
    numeric = [s for s in scores if isinstance(s, int)]
    if not numeric:
        return False
    judge_clean = all(s == 3 for s in numeric)
    runs = entry.get("runs") or []
    results = [r for run in runs for r in (run.get("validators", {}).get("results") or [])]
    if not results:
        return False
    any_validator_failed = any(r.get("passed") is False for r in results)
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

    `cursor` is the set of test ids already covered by rotation since the sweep
    last wrapped. It rides in the run log so it survives candidate pruning.

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

    # --- Targeted: ranked rules, first match wins -------------------------
    def rule1_exhausted() -> bool:
        """Rule 1 stops winning once every null-bearing positive test has been
        swept. Without this it eats the slot forever: the null set is
        structural, not transient — `search-familysearch-wiki` carries 11-12 of
        16 across every committed log, `init-project` 3-7 of 11 — so rules 2
        and 3 would never reach the targeted slot in exactly the suites where
        the null permission keeps widening."""
        nulls = [tid for tid in ids if _has_rubric_null_on_positive(by_id[tid])]
        return bool(nulls) and all(tid in cursor for tid in nulls)

    rules = [
        (lambda e: _has_rubric_null_on_positive(e) and not rule1_exhausted()),
        _validator_judge_conflict,
        lambda e: _score_moved(e, previous),
        _outcome_disagrees,
        lambda e: e["test_id"] not in cursor and not previous,
        _rationale_hedges,
    ]
    available = [tid for tid in ids if tid not in picked]
    for matches in rules:
        # Within a matched rule, prefer a test this sweep has not covered —
        # otherwise a lowest-test_id implementation re-picks the same test
        # forever and every acceptance test still passes.
        hits = sorted(
            (tid for tid in available if matches(by_id[tid])),
            key=lambda tid: (tid in cursor, tid),
        )
        if hits:
            picked.extend(hits[:n_targeted])
            break

    # --- Random: the unbiased slot ----------------------------------------
    available = [tid for tid in ids if tid not in picked]
    if available and n_random:
        rng = random.Random(seed)
        picked.extend(rng.sample(available, min(n_random, len(available))))

    return {"tests": sorted(picked), "cursor": sorted(cursor), "seed": seed}

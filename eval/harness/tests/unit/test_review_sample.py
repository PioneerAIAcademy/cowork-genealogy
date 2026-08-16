"""Unit tests for the review-sample selector."""

import math

from harness.review_sample import (
    is_gradeable,
    select_review_sample,
    zero_dimension_test_ids,
)


def _dim(name="Correctness", score=3, source="base", rationale="ok"):
    return {"source": source, "name": name, "score": score, "rationale": rationale}


def _test_entry(
    test_id,
    *,
    dims=None,
    test_type="positive",
    outcome="pass",
    expected_outcome="pass",
    validators=None,
):
    entry = {
        "test_id": test_id,
        "test_type": test_type,
        "outcome": outcome,
        "expected_outcome": expected_outcome,
        "outcome_summary": {
            "aggregated_dimensions": [_dim()] if dims is None else dims
        },
    }
    if validators is not None:
        entry["runs"] = [{"validators": {"results": validators}}]
    return entry


def _suite(n, **kw):
    return [_test_entry(f"ut_{i:03d}", **kw) for i in range(n)]


# --- Eligibility --------------------------------------------------------


def test_zero_dimension_tests_are_not_sampled():
    """A test whose judge was skipped has no dimensions, so rule 3 would demand
    zero corrections for it — sampling one wastes a slot. All such tests in the
    corpus also match targeted rule 4 (outcome != expected), so without this the
    targeted slot is biased toward tests with nothing to annotate."""
    tests = _suite(4)
    tests.append(
        _test_entry("ut_empty", dims=[], outcome="aborted", expected_outcome="pass")
    )
    out = select_review_sample(tests=tests)
    assert "ut_empty" not in out["tests"]
    assert not is_gradeable(tests[-1])
    assert zero_dimension_test_ids(tests) == ["ut_empty"]


def test_empty_suite_returns_empty_sample():
    assert select_review_sample(tests=[])["tests"] == []


# --- Rotation -----------------------------------------------------------


def test_rotation_picks_least_recently_annotated():
    """Rotation takes tests the sweep has not covered, in deterministic order."""
    tests = _suite(10)
    out = select_review_sample(tests=tests, n_targeted=0, n_random=0)
    assert out["tests"] == ["ut_000", "ut_001", "ut_002"]

    nxt = select_review_sample(tests=tests, prior_sample=out, n_targeted=0, n_random=0)
    assert nxt["tests"] == ["ut_003", "ut_004", "ut_005"]


def test_rotation_covers_every_test_in_ceil_t_over_n_runs():
    """The coverage guarantee, asserted rather than assumed. Random sampling at
    the same N would average ~17 runs for a 15-test suite."""
    tests = _suite(15)
    seen, sample = set(), None
    for _ in range(math.ceil(15 / 3)):
        sample = select_review_sample(
            tests=tests, prior_sample=sample, n_targeted=0, n_random=0
        )
        seen.update(sample["tests"])
    assert seen == {t["test_id"] for t in tests}


def test_rotation_cursor_survives_candidate_pruning():
    """The cursor rides in the run log rather than being derived from
    annotation history. `prune_old_candidates` deletes each pruned candidate
    WITH its `.ann.json`, keeping 5, so derived history spans at most 15 tests —
    and 10 suites are larger, up to 27. Here the cursor alone carries a
    27-test sweep past that horizon."""
    tests = _suite(27)
    sample, seen = None, set()
    for _ in range(9):
        sample = select_review_sample(
            tests=tests, prior_sample=sample, n_targeted=0, n_random=0
        )
        seen.update(sample["tests"])
    assert seen == {t["test_id"] for t in tests}
    # The cursor wraps to empty the moment the sweep completes, so the next run
    # starts clean rather than finding one straggler id left over.
    assert sample["cursor"] == []


def test_rotation_wraps_without_repeating_within_a_run():
    tests = _suite(4)
    sample = select_review_sample(tests=tests, n_targeted=0, n_random=0)
    sample = select_review_sample(
        tests=tests, prior_sample=sample, n_targeted=0, n_random=0
    )
    assert len(set(sample["tests"])) == len(sample["tests"])


# --- Targeted -----------------------------------------------------------


def test_rubric_null_on_positive_test_wins_targeted_slot():
    tests = _suite(6)
    tests[5]["outcome_summary"]["aggregated_dimensions"] = [
        _dim(), _dim(name="Tier justification", score=None, source="rubric")
    ]
    out = select_review_sample(tests=tests, n_random=0)
    assert "ut_005" in out["tests"]


def test_rubric_null_on_negative_test_does_not_win():
    """The hazard is a null standing in for a 1 on a positive test, where
    `_compute_outcome` gates on 1 and 2 and null is neither."""
    tests = _suite(6)
    tests[5]["test_type"] = "negative"
    tests[5]["outcome_summary"]["aggregated_dimensions"] = [
        _dim(), _dim(name="Tier justification", score=None, source="rubric")
    ]
    out = select_review_sample(tests=tests, n_random=0)
    assert "ut_005" not in out["tests"]


def test_targeted_falls_through_when_all_null_tests_recently_sampled():
    """A rule stops winning once every test it matches has been swept.

    Simulation over the committed corpus showed the un-guarded version pinning
    one test on 20 of 20 chained runs in 10 of 25 suites. Here ut_000-ut_002
    carry a null and are already swept, so rule 1 has no fresh candidate and the
    slot falls through to ut_003, which carries no null but matches rule 4."""
    tests = _suite(4)
    for t in tests[:3]:
        t["outcome_summary"]["aggregated_dimensions"] = [
            _dim(), _dim(name="Tier justification", score=None, source="rubric")
        ]
    tests[3]["outcome"] = "fail"
    prior = {"cursor": ["ut_000", "ut_001", "ut_002"]}
    out = select_review_sample(
        tests=tests, prior_sample=prior, n_rotation=0, n_random=0
    )
    assert out["tests"] == ["ut_003"]


def test_targeted_prefers_a_test_the_sweep_has_not_covered():
    """Within a matched rule, order by not-yet-covered first. Otherwise a
    lowest-test_id implementation re-picks one test forever."""
    tests = _suite(4, outcome="fail")  # all match rule 4
    prior = {"cursor": ["ut_000", "ut_001"]}
    out = select_review_sample(
        tests=tests, prior_sample=prior, n_rotation=0, n_random=0
    )
    assert out["tests"] == ["ut_002"]


def test_targeted_pick_is_distinct_from_rotation():
    """Without the exclusion the effective N is 4, not 5.

    Uses a 3-test suite so rotation consumes ALL of them. The cursor tie-break
    cannot help here — every candidate is in the cursor, so ordering is neutral
    — which leaves the `not in picked` exclusion as the only thing preventing
    the targeted slot from re-picking a rotation pick. On a larger suite both
    mechanisms protect the same case and the test cannot fail.
    """
    tests = _suite(3, outcome="fail")  # every test matches rule 4
    out = select_review_sample(tests=tests, n_random=0)
    assert out["tests"] == ["ut_000", "ut_001", "ut_002"]
    assert len(set(out["tests"])) == len(out["tests"])


def test_validator_judge_conflict_wins_over_lower_rules():
    tests = _suite(6, outcome="fail")  # every test matches rule 4
    # The rule reads the `passed` AGGREGATE, which `compute_validators_passed`
    # computes with the intentionally_invalid exemption applied — not the raw
    # results, which report a permanent conflict for those tests.
    tests[4]["runs"] = [
        {"validators": {"passed": False, "results": [{"name": "v", "passed": False}]}}
    ]
    out = select_review_sample(tests=tests, n_rotation=0, n_random=0)
    assert out["tests"] == ["ut_004"]


def test_score_moved_against_previous_run_is_targeted():
    tests = _suite(6)
    previous = _suite(6)
    previous[4]["outcome_summary"]["aggregated_dimensions"] = [_dim(score=2)]
    out = select_review_sample(
        tests=tests, previous_tests=previous, n_rotation=0, n_random=0
    )
    assert out["tests"] == ["ut_004"]


# --- Random -------------------------------------------------------------


def test_random_slot_is_deterministic_for_a_seed():
    tests = _suite(20)
    a = select_review_sample(tests=tests, seed=7)
    b = select_review_sample(tests=tests, seed=7)
    assert a == b


def test_random_slot_varies_with_the_seed():
    tests = _suite(40)
    picks = {
        select_review_sample(tests=tests, seed=s)["tests"][-1] for s in range(12)
    }
    assert len(picks) > 1


def test_sample_never_exceeds_the_suite():
    tests = _suite(2)
    out = select_review_sample(tests=tests)
    assert set(out["tests"]) <= {"ut_000", "ut_001"}
    assert len(set(out["tests"])) == len(out["tests"])


def test_sample_is_full_size_on_a_clean_suite():
    """A fully-green suite with a previous run matches no targeted rule, so the
    slot degrades to rotation rather than to nothing. Leaving it empty sampled 4
    while the docstring and the CI error message both claimed 5."""
    tests = _suite(12)
    previous = _suite(12)
    out = select_review_sample(tests=tests, previous_tests=previous)
    assert len(out["tests"]) == 5
    assert len(set(out["tests"])) == 5


# --- Cursor provenance ---------------------------------------------------


def test_unannotated_run_log_does_not_supply_the_cursor(tmp_path):
    """A run nobody annotated must not advance the rotation cursor.

    Taking its cursor marks its 5 sampled tests covered and rotates straight
    past them — the same hole the scratch-run guard closes, by another route.
    12 of the 121 committed run logs have no `.ann.json`, and CI only ever
    checks the newest one, so nothing downstream would catch it.
    """
    import json
    import sys

    sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[2]))
    from run_tests import _newest_releasable_runlog

    d = tmp_path / "timeline"
    d.mkdir()

    def write(name, sample, annotated):
        (d / name).write_text(
            json.dumps({"review_sample": sample, "tests": []}), encoding="utf-8"
        )
        if annotated:
            (d / name.replace(".json", ".ann.json")).write_text(
                json.dumps({"run_log": name, "annotator": "a", "corrections": []}),
                encoding="utf-8",
            )

    write("v1_2026-01-01_00-00-00.json", {"tests": ["ut_a"], "cursor": ["ut_a"], "seed": 0}, True)
    write("v1_2026-02-01_00-00-00.json", {"tests": ["ut_b"], "cursor": ["ut_b"], "seed": 0}, False)

    got = _newest_releasable_runlog(d)
    assert got is not None
    # The NEWER log is unannotated, so the older annotated one supplies the cursor.
    assert got["review_sample"]["cursor"] == ["ut_a"]


def test_no_annotated_predecessor_starts_a_fresh_sweep(tmp_path):
    import json
    import sys

    sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[2]))
    from run_tests import _newest_releasable_runlog

    d = tmp_path / "timeline"
    d.mkdir()
    (d / "v1_2026-01-01_00-00-00.json").write_text(
        json.dumps({"review_sample": {"tests": [], "cursor": [], "seed": 0}, "tests": []}),
        encoding="utf-8",
    )
    assert _newest_releasable_runlog(d) is None

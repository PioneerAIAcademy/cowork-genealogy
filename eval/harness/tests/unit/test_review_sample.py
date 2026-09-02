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
    corpus failed or aborted, which is what `is_mandatory` matches, so without
    this filter the mandatory slot is biased toward tests with nothing to
    annotate."""
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
    carry a null and are already swept, so the rule has no fresh candidate and
    the slot degrades to the one unswept test, ut_003 — rather than re-picking a
    swept match, which would buy no coverage.

    ut_003 is left a clean pass on purpose: were it failing, the mandatory slot
    would sample it and the assertion would hold without the targeted slot doing
    anything."""
    tests = _suite(4)
    for t in tests[:3]:
        t["outcome_summary"]["aggregated_dimensions"] = [
            _dim(), _dim(name="Tier justification", score=None, source="rubric")
        ]
    prior = {"cursor": ["ut_000", "ut_001", "ut_002"]}
    out = select_review_sample(
        tests=tests, prior_sample=prior, n_rotation=0, n_random=0
    )
    assert out["tests"] == ["ut_003"]


def test_targeted_prefers_a_test_the_sweep_has_not_covered():
    """Within a matched rule, order by not-yet-covered first. Otherwise a
    lowest-test_id implementation re-picks one test forever.

    Built on rubric nulls, not on `outcome="fail"`: a failing outcome is now
    mandatory, so such a fixture would put every test in the sample and isolate
    nothing — see `is_mandatory`.
    """
    tests = _suite(4)
    for entry in tests:  # all four match _has_rubric_null_on_positive
        entry["outcome_summary"]["aggregated_dimensions"] = [
            _dim(), _dim(name="Tier justification", score=None, source="rubric")
        ]
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
    tests = _suite(3, outcome="fail")  # every test is mandatory
    out = select_review_sample(tests=tests, n_random=0)
    assert out["tests"] == ["ut_000", "ut_001", "ut_002"]
    assert len(set(out["tests"])) == len(out["tests"])


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
    """A fully-green suite matches no targeted rule, so the slot degrades to
    rotation rather than to nothing. Leaving it empty sampled 4 while the
    docstring and the CI error message both claimed 5."""
    tests = _suite(12)
    out = select_review_sample(tests=tests)
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


def test_released_runlog_outranks_a_superseded_candidate(tmp_path):
    """A released `v{N}.json` has timestamp=None and must sort LAST within its
    version. Release renames the candidate in place and leaves the earlier ones
    behind, so treating None as "" lets a superseded candidate win and hands the
    next run a stale cursor."""
    import json
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from run_tests import _newest_releasable_runlog

    d = tmp_path / "citation"
    d.mkdir()

    def write(name, cursor):
        (d / name).write_text(
            json.dumps({"review_sample": {"tests": [], "cursor": cursor, "seed": 0}, "tests": []}),
            encoding="utf-8",
        )
        (d / name.replace(".json", ".ann.json")).write_text(
            json.dumps({"run_log": name, "annotator": "a", "corrections": []}),
            encoding="utf-8",
        )

    write("v1_2026-01-01_00-00-00.json", ["superseded"])
    write("v1.json", ["released"])

    got = _newest_releasable_runlog(d)
    assert got["review_sample"]["cursor"] == ["released"]


# --- Mandatory slot -----------------------------------------------------
#
# These four are the only coverage the mandatory slot has. Every test above
# stays green under it, because `_dim()` defaults to score 3 and no fixture in
# this file scores 1 or 2 — so without these the slot would ship untested.
#
# The shared fixture is load-bearing. Both suites use the SAME 15 ids, so the
# four non-mandatory slots pick identically and only the scores differ. Varying
# the suite SIZE instead would move the random slot's draw (`rng.sample` over 11
# candidates lands elsewhere than over 6) and the two runs would differ for a
# reason unrelated to this feature.
#
# At seed 0 the five chosen picks are ut_000..ut_003 and ut_010, so every mandatory id
# below is chosen to sit outside that set — otherwise the case passes today and
# proves nothing.

_MANDATORY_IDS = ("ut_004", "ut_005", "ut_006", "ut_007", "ut_008")
_FREE_ID = "ut_011"  # outside the five chosen picks at seed 0


def _clean_15():
    return _suite(15)


def _failing_15():
    """ut_004..ut_007 partial, ut_008 fail. Outcomes match the scores."""
    suite = _suite(15)
    for entry in suite:
        if entry["test_id"] not in _MANDATORY_IDS:
            continue
        fail = entry["test_id"] == "ut_008"
        entry["outcome"] = "fail" if fail else "partial"
        entry["expected_outcome"] = entry["outcome"]
        entry["outcome_summary"]["aggregated_dimensions"] = [_dim(score=1 if fail else 2)]
    return suite


def test_every_failing_test_is_sampled_however_many():
    got = select_review_sample(tests=_failing_15(), seed=0)["tests"]
    assert set(_MANDATORY_IDS) <= set(got)
    assert len(got) == 10
    assert len(got) == len(set(got))


def test_mandatory_does_not_consume_the_other_five_slots():
    """The additive property — this is what protects false-green detection.

    The five chosen picks must be the same tests whether or not the suite has
    failures, so the mandatory slot ADDS to coverage instead of eating it.
    """
    clean = select_review_sample(tests=_clean_15(), seed=0)["tests"]
    failing = select_review_sample(tests=_failing_15(), seed=0)["tests"]
    assert set(clean) <= set(failing)
    assert set(failing) - set(clean) == set(_MANDATORY_IDS)


def test_a_non_gating_failing_dimension_is_still_mandatory():
    """Pins the ruling that a routing negative's diagnostic 1 is reviewed.

    Those cells carry the highest correction rate in the corpus (17.28%), which
    is why keying the slot on `dimensions_gate_outcome` was rejected.
    """
    suite = _clean_15()
    entry = next(t for t in suite if t["test_id"] == _FREE_ID)
    entry["test_type"] = "negative"
    entry["dimensions_gate_outcome"] = False
    entry["outcome"] = entry["expected_outcome"] = "pass"
    entry["outcome_summary"]["aggregated_dimensions"] = [_dim(score=1)]
    assert _FREE_ID in select_review_sample(tests=suite, seed=0)["tests"]


def test_a_failed_test_with_clean_dimensions_is_mandatory():
    """A routing or activation failure the judge saw nothing wrong with.

    The outcome trigger is the only thing that reaches this: every dimension is
    a 3, so the score trigger is blind to it.
    """
    suite = _clean_15()
    entry = next(t for t in suite if t["test_id"] == _FREE_ID)
    entry["outcome"] = "fail"
    del entry["expected_outcome"]
    assert all(d["score"] == 3 for d in entry["outcome_summary"]["aggregated_dimensions"])
    assert _FREE_ID in select_review_sample(tests=suite, seed=0)["tests"]


def test_a_declared_xfail_is_not_mandatory_but_an_xpass_is():
    """Pins both halves of `_NON_FAILING_OUTCOMES` against each other.

    `xfail` is a failure someone declared in advance, so it must NOT be
    mandatory — otherwise every suite carrying one pays for it on every run
    forever, and the slot is uncapped. `xpass` is the same test unexpectedly
    passing, which must be. Narrowing the set to `{"pass"}` — or rewriting the
    check as `outcome != "pass"`, which looks like a simplification — breaks the
    first half, and nothing else in the suite notices.
    """
    suite = _clean_15()
    entry = next(t for t in suite if t["test_id"] == _FREE_ID)
    entry["expected_outcome"] = "xfail"

    entry["outcome"] = "xfail"
    assert _FREE_ID not in select_review_sample(tests=suite, seed=0)["tests"]

    entry["outcome"] = "xpass"
    assert _FREE_ID in select_review_sample(tests=suite, seed=0)["tests"]


def test_mandatory_picks_count_toward_the_sweep_cursor():
    """Pins the rejected alternative: a second, rotation-only cursor.

    The comment above `covered` argues that mandatory picks fold into the sweep
    like any other — so a chronically failing test completes the sweep sooner and
    the wrap fires sooner. Excluding them (i.e. building the rotation-only cursor
    that was considered and rejected) changed no test, so the whole argument was
    unguarded. Since the wrap is what the ceil(T/3) coverage guarantee rests on,
    that alternative could have been reintroduced with CI green.
    """
    first = select_review_sample(tests=_failing_15(), seed=0)
    assert set(_MANDATORY_IDS) <= set(first["cursor"]), (
        "mandatory picks must count as covered — they were reviewed"
    )

    # And the sweep advances because of them: with 10 of 15 covered, rotation's
    # next three come from the five the first run did not reach. Asserting the
    # rotation picks are all fresh, rather than that the whole sample is, keeps
    # the random slot — which draws from every unpicked id, covered or not —
    # from making this flaky.
    second = select_review_sample(tests=_failing_15(), prior_sample=first, seed=0)
    fresh = set(second["tests"]) - set(first["cursor"])
    assert len(fresh) >= 3, (
        f"the sweep did not advance: only {sorted(fresh)} were uncovered before"
    )

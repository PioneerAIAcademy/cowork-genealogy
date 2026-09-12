"""Unit tests for the review-sample selector."""

import math

from harness.review_sample import (
    is_gradeable,
    is_mandatory,
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
    """A test with no AGGREGATED dimensions -- aborted, judge raised, or a
    validator failed and its scores excluded -- has rule 3 demand
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


def test_the_targeted_degradation_skips_a_test_the_mandatory_slot_takes():
    """The degraded slot must buy a DISTINCT test, not shadow a mandatory one.

    Spending it on a test the mandatory slot is about to append costs a distinct
    test for nothing — the same waste that got `_outcome_disagrees` deleted.
    Observable as sample size: unfiltered the slot picks ut_003 and the mandatory
    append then skips it (5 tests); filtered it picks ut_004 and ut_003 still
    arrives (6).

    No rubric nulls anywhere, so the targeted rule matches nothing and the
    degradation is what runs.
    """
    suite = _suite(15)
    entry = next(t for t in suite if t["test_id"] == "ut_003")
    entry["outcome"] = "partial"
    entry["expected_outcome"] = "partial"
    entry["outcome_summary"]["aggregated_dimensions"] = [_dim(score=2)]

    got = select_review_sample(tests=suite, seed=0)["tests"]
    assert "ut_003" in got, "the mandatory slot must still take it"
    assert "ut_004" in got, "the degraded slot must spend on a non-mandatory test"
    assert len(got) == 6


# --- Third mandatory trigger: a coerced routing-negative cell (#2196) --------


def _coerced_entry(test_id="ut_c_001", *, kind="coerced_routing_negative_to_na"):
    """A test whose only signal is the coercion warning.

    Deliberately the hardest shape for `is_mandatory` to catch: outcome `pass`
    (routing decided it), and every dimension null or 3 — so neither of the two
    original triggers fires. This is exactly what coercion manufactures.
    """
    entry = _test_entry(
        test_id,
        test_type="negative",
        outcome="pass",
        dims=[
            _dim("Correctness", score=None, rationale="[coerced-to-na] ..."),
            _dim("Completeness", score=None, rationale="[coerced-to-na] ..."),
            _dim("Tool Arguments", score=None, rationale="no calls"),
        ],
    )
    entry["runs"] = [{
        "validators": {"passed": True, "results": []},
        "output": {"warnings": [{
            "kind": kind,
            "advisory": "judge scored Correctness 1 ...; coerced to null",
            "name": "Correctness",
            "score": 1,
            "rationale": "did nothing",
        }]},
    }]
    return entry


def test_a_coerced_routing_negative_is_mandatory():
    """Without this trigger the coercion silently deletes the highest-
    correction-rate class in the corpus from human review.

    `is_mandatory`'s first trigger keys on `score in (1, 2)` and the second on a
    non-pass outcome. Coercion turns the diagnostic 1 into null — neither 1 nor
    2 — on a test whose outcome is `pass` by design. So both original triggers
    go blind on exactly the cells measured at a 17.28% (14/81) correction rate,
    against 4.28% for gating tests with a 1 or 2.
    """
    assert is_mandatory(_coerced_entry()) is True


def test_the_third_trigger_is_specific_to_its_own_kind():
    """A different warning kind must not make a test mandatory — otherwise the
    trigger is really 'any warning at all' and would drag in every
    prose_observation and uncovered_tool_call in the corpus."""
    assert is_mandatory(_coerced_entry(kind="prose_observation")) is False
    assert is_mandatory(_coerced_entry(kind="uncovered_tool_call")) is False


def test_is_mandatory_survives_entries_with_no_runs_or_no_output():
    """The read must be defensive at every level, not a subscript chain.

    Warnings live at `entry["runs"][i]["output"]["warnings"]`, and there is no
    `entry["output"]`. But a test entry has no `runs` key at all until a run is
    recorded, and this file's own `_test_entry` builds run dicts as
    `{"validators": {...}}` with no `output` key. A literal
    `entry["runs"][i]["output"]["warnings"]` KeyErrors across most of this file.
    """
    no_runs = _test_entry("ut_c_002", dims=[_dim(score=3)])
    assert "runs" not in no_runs
    assert is_mandatory(no_runs) is False

    no_output = _test_entry("ut_c_003", dims=[_dim(score=3)], validators=[])
    assert "output" not in no_output["runs"][0]
    assert is_mandatory(no_output) is False

    empty_runs = _test_entry("ut_c_004", dims=[_dim(score=3)])
    empty_runs["runs"] = []
    assert is_mandatory(empty_runs) is False

    null_output = _test_entry("ut_c_005", dims=[_dim(score=3)])
    null_output["runs"] = [{"output": None}, {"output": {"warnings": None}}]
    assert is_mandatory(null_output) is False


def test_a_coerced_test_still_reaches_the_sample():
    """The trigger is worthless if `is_gradeable` filters the test out first.

    Every slot in `select_review_sample` draws from `[t for t in tests if
    is_gradeable(t)]`, and `is_gradeable` is `bool(aggregated_dimensions)`. A
    coerced entry's dimensions are present with null scores, so the array is
    non-empty and it survives the filter — unlike a validator-failing entry,
    whose aggregate #2057 deliberately leaves empty.
    """
    coerced = _coerced_entry("ut_c_010")
    assert is_gradeable(coerced) is True
    # 30 clean tests, not 4. With only 5 eligible tests against 3+1+1 slots every
    # test is sampled whatever is_mandatory says, so the membership assertion
    # below would hold with the third trigger deleted. That is how this test
    # first shipped. 30 makes the chosen slots a minority of the pool, so the
    # coerced test can only be there via the mandatory slot.
    pool = [coerced] + _suite(30)
    sample = select_review_sample(tests=pool, seed=0)
    assert len(sample["tests"]) < len(pool), (
        "the pool must be bigger than the sample or membership proves nothing"
    )
    assert "ut_c_010" in sample["tests"], sample["tests"]

    # And the control: with the warning renamed away it drops out of the sample.
    import copy
    unflagged = copy.deepcopy(coerced)
    for r in unflagged["runs"]:
        for w in r["output"]["warnings"]:
            w["kind"] = "prose_observation"
    assert is_mandatory(unflagged) is False
    sample2 = select_review_sample(tests=[unflagged] + _suite(30), seed=0)
    assert "ut_c_010" not in sample2["tests"], (
        "without the coercion warning the test must NOT be pulled in by the "
        "mandatory slot - otherwise the assertion above is about pool size, "
        "not about the trigger"
    )


# --- The corpus replay: #2196's own acceptance requirement -------------------
#
# The card is explicit: "The acceptance check must fail on `main` against real
# data, not a hand-built dict." Every other test in this file builds a dict, and
# on committed data the third trigger fires ZERO times (no run log carries a
# coerced_routing_negative_to_na warning yet, because nothing emitted one before
# this change). So without this replay nothing distinguishes a correct third
# trigger from one that never fires at all.


def _committed_unit_logs():
    from pathlib import Path
    root = Path(__file__).resolve().parents[3] / "runlogs" / "unit"
    if not root.is_dir():  # pragma: no cover - layout guard
        return []
    return sorted(p for p in root.glob("*/*.json") if not p.name.endswith(".ann.json"))


def _simulate_coercion(entry):
    """Apply this PR's coercion to a COMMITTED test entry.

    Wherever a run carries the retired `routing_negative_judge_fail` warning,
    rewrite that warning to the new kind and null the matching dimension scores
    (per-run and aggregated), which is exactly what
    `orchestrator.flag_routing_negative_judge_fail` now does at run time.
    """
    import copy
    e = copy.deepcopy(entry)
    touched = False
    for r in e.get("runs") or []:
        ws = (r.get("output") or {}).get("warnings") or []
        names = {w.get("name") for w in ws if w.get("kind") == "routing_negative_judge_fail"}
        if not names:
            continue
        touched = True
        for w in ws:
            if w.get("kind") == "routing_negative_judge_fail":
                w["kind"] = "coerced_routing_negative_to_na"
        for d in (r.get("judge") or {}).get("dimensions") or []:
            if d.get("name") in names and d.get("score") == 1:
                d["score"] = None
        for d in (e.get("outcome_summary") or {}).get("aggregated_dimensions") or []:
            if d.get("name") in names and d.get("score") == 1:
                d["score"] = None
    return e, touched


def _strip_the_new_kind(entry):
    """The same entry with the coercion warning renamed away, i.e. what the
    corpus would look like if the third trigger did not exist."""
    import copy
    e = copy.deepcopy(entry)
    for r in e.get("runs") or []:
        for w in ((r.get("output") or {}).get("warnings") or []):
            if w.get("kind") == "coerced_routing_negative_to_na":
                w["kind"] = "__not_a_registered_kind__"
    return e


def test_the_third_trigger_returns_exactly_what_coercion_removes():
    """Over every committed unit run log: coercion must not shrink the set of
    tests a human is required to read.

    Three assertions, and the third is the one that stops this being vacuous:
    the mandatory total must be unchanged, no sampled-id set may move, and a
    meaningful number of tests must be kept mandatory BY THIS TRIGGER
    SPECIFICALLY — verified by renaming the warning away and watching them drop
    out. A trigger that keeps nothing would satisfy the first two on its own.
    """
    import json
    logs = _committed_unit_logs()
    assert logs, "no committed unit run logs found - the replay would be vacuous"

    touched = kept_by_trigger = 0
    mand_before = mand_after = 0
    moved_samples = []

    for path in logs:
        d = json.loads(path.read_text(encoding="utf-8"))
        tests = d.get("tests") or []
        if not tests:
            continue
        coerced, flags = [], []
        for t in tests:
            c, hit = _simulate_coercion(t)
            coerced.append(c); flags.append(hit)
        touched += sum(flags)

        mand_before += sum(1 for t in tests if is_gradeable(t) and is_mandatory(t))
        mand_after += sum(1 for t in coerced if is_gradeable(t) and is_mandatory(t))

        for c, hit in zip(coerced, flags):
            if hit and is_gradeable(c) and is_mandatory(c) \
                    and not is_mandatory(_strip_the_new_kind(c)):
                kept_by_trigger += 1

        if d.get("review_sample") is not None:
            seed = d["review_sample"].get("seed", 0)
            b = select_review_sample(tests=tests, prior_sample=None, seed=seed)
            a = select_review_sample(tests=coerced, prior_sample=None, seed=seed)
            if set(b["tests"]) != set(a["tests"]):
                moved_samples.append(path.name)

    assert touched > 0, (
        "no committed log still carries routing_negative_judge_fail. The kind is "
        "retired and its population only shrinks with pruning, so this replay has "
        "aged out - delete this test rather than trying to restore the corpus."
    )
    assert mand_after == mand_before, (
        f"coercion changed how many tests a human must read: "
        f"{mand_before} -> {mand_after}"
    )
    assert not moved_samples, (
        f"coercion moved the sampled-id set for {len(moved_samples)} run log(s): "
        f"{moved_samples[:5]}"
    )
    # RELATIVE to the population this run actually found, not a hard floor. A
    # hard 40 against a measured 49 does not survive routine use: every full
    # skill run prunes to the newest 5 candidates, and four `make eval-skill
    # SKILL=timeline` runs take it to 39 and red the suite with no code change.
    # The population can only shrink, never grow -- _simulate_coercion counts
    # entries carrying the RETIRED warning kind, and every log written after
    # this lands carries the new one.
    assert kept_by_trigger >= touched - 1, (
        f"only {kept_by_trigger} of {touched} affected entries are kept mandatory "
        f"by the third trigger (46 of 47 on 2026-09-11). A number near zero means "
        f"the trigger is not doing the work it was added for, and the two "
        f"assertions above would pass anyway."
    )

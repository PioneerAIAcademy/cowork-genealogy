"""Unit tests for skill_latency_report — the per-skill unit-runlog analyzer.

Pure math over synthetic run-log envelope dicts (the run-log.schema shape). No
live run, no Anthropic API — runs in `make harness-test`.
"""

from __future__ import annotations

from skill_latency_report import (
    SkillLatency,
    analyze_runlog,
    diff_skill,
    format_diff,
    format_markdown_table,
    format_skill,
    same_test_inputs,
)


def _runlog(skill="timeline", tests=None, totals="default", snapshot=None):
    if tests is None:
        tests = [
            {"test_id": "ut_a", "outcome": "pass",
             "totals": {"output_tokens": 1000, "num_turns": 10}},
            {"test_id": "ut_b", "outcome": "pass",
             "totals": {"output_tokens": 500, "num_turns": 5}},
        ]
    d = {"skill": skill, "tests": tests}
    if totals == "default":
        d["totals"] = {"output_tokens": 1500, "num_turns": 15,
                       "total_cost_usd": 1.2, "duration_api_ms": 200.0}
    elif totals is not None:
        d["totals"] = totals
    if snapshot is not None:
        d["snapshot"] = snapshot
    return d


def test_analyze_sums_and_per_test():
    sl = analyze_runlog(_runlog(), "eval/runlogs/unit/timeline/v1.json")
    assert sl.skill == "timeline"
    assert sl.n_tests == 2
    assert sl.output_tokens == 1500
    assert sl.num_turns == 15
    assert sl.total_cost_usd == 1.2
    assert sl.per_test["ut_a"] == {"output_tokens": 1000, "num_turns": 10, "outcome": "pass"}


def test_analyze_prefers_envelope_output_tokens():
    """Envelope totals is authoritative even if it disagrees with the per-test sum."""
    sl = analyze_runlog(_runlog(totals={"output_tokens": 9999}))
    assert sl.output_tokens == 9999


def test_analyze_num_turns_falls_back_to_test_sum():
    """No envelope num_turns, but every test has one -> sum the tests."""
    sl = analyze_runlog(_runlog(totals={"output_tokens": 1500}))
    assert sl.num_turns == 15  # 10 + 5


def test_analyze_num_turns_none_when_a_test_lacks_it():
    """A legacy (pre-instrumentation) test with no num_turns -> aggregate is None."""
    tests = [
        {"test_id": "ut_a", "outcome": "pass", "totals": {"output_tokens": 1000, "num_turns": 10}},
        {"test_id": "ut_b", "outcome": "pass", "totals": {"output_tokens": 500}},  # no num_turns
    ]
    sl = analyze_runlog(_runlog(tests=tests, totals={"output_tokens": 1500}))
    assert sl.num_turns is None
    assert sl.output_tokens == 1500


def test_same_inputs_true_when_test_snapshots_identical():
    snap = {"eval/tests/unit/timeline/a.json": "X", "packages/engine/plugin/skills/timeline/SKILL.md": "prose1"}
    before = _runlog(snapshot=snap)
    # SKILL.md differs (the prose edit) but test-side snapshot is identical.
    after = _runlog(snapshot={"eval/tests/unit/timeline/a.json": "X",
                              "packages/engine/plugin/skills/timeline/SKILL.md": "prose2"})
    assert same_test_inputs(before, after, "timeline") is True


def test_same_inputs_false_when_test_changed():
    before = _runlog(snapshot={"eval/tests/unit/timeline/a.json": "X"})
    after = _runlog(snapshot={"eval/tests/unit/timeline/a.json": "Y"})  # test JSON changed
    assert same_test_inputs(before, after, "timeline") is False


def test_same_inputs_false_when_snapshot_absent():
    assert same_test_inputs(_runlog(), _runlog(), "timeline") is False


def test_diff_basic_aggregate_and_sort():
    before = analyze_runlog(_runlog())  # a:1000, b:500
    after = analyze_runlog(_runlog(tests=[
        {"test_id": "ut_a", "outcome": "pass", "totals": {"output_tokens": 600, "num_turns": 7}},
        {"test_id": "ut_b", "outcome": "pass", "totals": {"output_tokens": 400, "num_turns": 4}},
    ], totals={"output_tokens": 1000, "num_turns": 11}))
    d = diff_skill(before, after, inputs_stable=True)
    assert d.agg_before == 1500
    assert d.agg_after == 1000
    assert d.agg_delta == -500
    assert round(d.agg_pct, 1) == -33.3
    # most-improved (most negative delta) first: ut_a (-400) before ut_b (-100).
    assert [t.test_id for t in d.per_test] == ["ut_a", "ut_b"]
    assert d.per_test[0].delta == -400
    assert round(d.per_test[0].pct, 1) == -40.0
    # turn aggregate available (both sides carry num_turns).
    assert d.turns_before == 15
    assert d.turns_after == 11


def test_diff_concision_excludes_activation_flips():
    """A test going to 0 output is an activation/abort change, not concision.

    It must be excluded from the concision aggregate (else its whole value
    inflates the apparent reduction) but still counted in the raw aggregate.
    """
    before = analyze_runlog(_runlog(tests=[
        {"test_id": "ut_a", "totals": {"output_tokens": 1000, "num_turns": 5}},  # both-active
        {"test_id": "ut_b", "totals": {"output_tokens": 2000, "num_turns": 5}},  # -> 0 (flip)
    ], totals=None))
    after = analyze_runlog(_runlog(tests=[
        {"test_id": "ut_a", "totals": {"output_tokens": 600, "num_turns": 5}},
        {"test_id": "ut_b", "totals": {"output_tokens": 0, "num_turns": 5}},
    ], totals=None))
    d = diff_skill(before, after, inputs_stable=True)
    # raw over both shared tests: 3000 -> 600  (-80%), badly overstated.
    assert d.agg_before == 3000 and d.agg_after == 600
    # concision over the one both-active test: 1000 -> 600  (-40%), the honest number.
    assert d.active_before == 1000 and d.active_after == 600
    assert d.n_both_active == 1
    assert d.n_activation_changed == 1
    assert round(d.concision_pct, 1) == -40.0


def test_diff_shared_tests_only():
    before = analyze_runlog(_runlog(tests=[
        {"test_id": "ut_a", "totals": {"output_tokens": 1000, "num_turns": 1}},
        {"test_id": "ut_c", "totals": {"output_tokens": 300, "num_turns": 1}},
    ], totals=None))
    after = analyze_runlog(_runlog(tests=[
        {"test_id": "ut_a", "totals": {"output_tokens": 800, "num_turns": 1}},
        {"test_id": "ut_d", "totals": {"output_tokens": 200, "num_turns": 1}},
    ], totals=None))
    d = diff_skill(before, after, inputs_stable=False)
    assert [t.test_id for t in d.per_test] == ["ut_a"]  # only shared test
    assert d.agg_before == 1000 and d.agg_after == 800
    assert d.before_only == ["ut_c"]
    assert d.after_only == ["ut_d"]


def test_diff_turns_none_when_a_shared_test_lacks_turns():
    before = analyze_runlog(_runlog(tests=[
        {"test_id": "ut_a", "totals": {"output_tokens": 1000}},  # no num_turns
    ], totals=None))
    after = analyze_runlog(_runlog(tests=[
        {"test_id": "ut_a", "totals": {"output_tokens": 800, "num_turns": 3}},
    ], totals=None))
    d = diff_skill(before, after, inputs_stable=True)
    assert d.turns_before is None
    assert d.turns_after is None
    assert d.agg_delta == -200


def test_format_skill_renders():
    text = format_skill(analyze_runlog(_runlog(), "x/v1.json"))
    assert "timeline" in text
    assert "1500" in text  # output tokens
    assert "/turn" in text


def test_format_diff_flags_changed_inputs():
    before = analyze_runlog(_runlog())
    after = analyze_runlog(_runlog(tests=[
        {"test_id": "ut_a", "totals": {"output_tokens": 600, "num_turns": 7}},
        {"test_id": "ut_b", "totals": {"output_tokens": 400, "num_turns": 4}},
    ], totals={"output_tokens": 1000, "num_turns": 11}))
    stable = format_diff(diff_skill(before, after, inputs_stable=True))
    changed = format_diff(diff_skill(before, after, inputs_stable=False))
    assert "prose-only" in stable
    assert "CHANGED" in changed


def test_markdown_table_row_per_skill():
    sls = [analyze_runlog(_runlog(skill="timeline")), analyze_runlog(_runlog(skill="citation"))]
    table = format_markdown_table(sls)
    assert table.count("\n") == 3  # header + separator + 2 rows
    assert "timeline" in table and "citation" in table


def test_missing_tests_is_safe():
    sl = analyze_runlog({"skill": "empty"})
    assert isinstance(sl, SkillLatency)
    assert sl.n_tests == 0
    assert sl.output_tokens == 0
    assert sl.num_turns is None

"""Unit tests for e2e.latency_report — the Phase 0 latency analyzer.

Pure math over a synthetic result dict (the e2e/result.py schema). No live
run, no Anthropic API — this runs in `make harness-test`. The synthetic
timeline is hand-computed so the tool-vs-non-tool split is checkable by eye.
"""

from __future__ import annotations

import pytest

from e2e.latency_report import (
    LatencyBreakdown,
    analyze_result,
    exclusion_reason,
    format_breakdown,
    format_markdown_table,
    format_skill_phases,
    _skill_phase_breakdown,
    _timeline_decomposition,
)


def _result(**overrides):
    """A modern (timeline-bearing) result dict; override any key."""
    base = {
        "test_id": "kenneth-quass-death",
        "verdict": "pass",
        "stop_reason": "completed",
        "usage": {
            "duration_ms": 100_000,
            "duration_api_ms": 98_000,
            "num_turns": 100,
            "total_cost_usd": 6.5,
            "wall_clock_seconds": 101.0,
            "usage": {
                "input_tokens": 200,
                "output_tokens": 80_000,
                "cache_read_input_tokens": 12_000_000,
                "cache_creation_input_tokens": 400_000,
            },
            # gaps by later-message kind: 8->10 tool_result(=2 tool),
            # 10->13 assistant(=3 non-tool), 13->14 system(=1 non-tool),
            # 14->20 assistant(=6 non-tool)  => tool=2, non_tool=10
            "timeline": [
                [8.0, "assistant"],
                [10.0, "tool_result"],
                [13.0, "assistant"],
                [14.0, "system:status"],
                [20.0, "assistant"],
            ],
        },
        "tool_calls": [
            {"tool": "mcp__genealogy__record_search", "args": {}},
            {"tool": "mcp__genealogy__record_search", "args": {}},
            {"tool": "Read", "args": {}},
            {"tool": "Edit", "args": {}},
        ],
    }
    base.update(overrides)
    return base


def test_headline_api_percentage():
    bd = analyze_result(_result())
    assert bd.api_pct == 98_000 / 100_000
    assert bd.duration_s == 100.0
    assert bd.api_s == 98.0
    assert bd.wall_clock_s == 101.0  # harness clock preferred over duration_ms


def test_output_tokens_per_turn():
    bd = analyze_result(_result())
    assert bd.output_tokens == 80_000
    assert bd.num_turns == 100
    assert bd.output_tokens_per_turn == 800.0


def test_tool_counts_bare_names_and_order():
    bd = analyze_result(_result())
    # most_common: record_search:2 first, then the singletons.
    assert bd.tool_counts[0] == ("record_search", 2)
    names = {n for n, _ in bd.tool_counts}
    assert names == {"record_search", "Read", "Edit"}
    assert bd.n_tool_calls == 4


def test_timeline_decomposition_math():
    d = _timeline_decomposition(_result()["usage"]["timeline"])
    # 5 points -> 4 gaps, bucketed by the *later* entry's kind:
    #   8->10 tool_result   = 2   (tool)
    #   10->13 assistant    = 3   (non-tool, gen gap)
    #   13->14 system:status= 1   (non-tool)
    #   14->20 assistant    = 6   (non-tool, gen gap)
    assert d["tool_time_s"] == 2.0
    assert d["non_tool_time_s"] == 10.0  # 3 + 1 + 6
    assert d["tool_time_pct"] == 2.0 / 12.0
    assert d["timeline_span_s"] == 12.0  # 20 - 8
    # slowest generation gap is the 6s one ending at t=20.
    assert d["slowest_gen_gaps"][0] == (20.0, 6.0)


def test_timeline_present_flag_set():
    bd = analyze_result(_result())
    assert bd.timeline_present is True
    assert bd.tool_time_pct == 2.0 / 12.0
    # wall_clock (101) exceeds timeline span (12) -> the rest is stall/idle.
    assert bd.stall_s == 101.0 - 12.0


def test_legacy_result_without_timeline():
    """A pre-2026-06 run: no timeline, no wall_clock_seconds. Must not crash;
    timeline fields stay None, usage-based headline still computed."""
    legacy = _result()
    legacy["usage"].pop("timeline")
    legacy["usage"].pop("wall_clock_seconds")
    bd = analyze_result(legacy)
    assert bd.timeline_present is False
    assert bd.tool_time_pct is None
    assert bd.stall_s is None
    assert bd.api_pct == 0.98
    assert bd.wall_clock_s == 100.0  # falls back to duration_ms/1000


def test_missing_usage_is_safe():
    """A skipped/crashed run may have an empty usage dict."""
    bd = analyze_result({"test_id": "x", "verdict": "skipped", "stop_reason": "error"})
    assert isinstance(bd, LatencyBreakdown)
    assert bd.api_pct is None
    assert bd.num_turns is None
    assert bd.n_tool_calls == 0


def test_zero_num_turns_no_divide_by_zero():
    r = _result()
    r["usage"]["num_turns"] = 0
    bd = analyze_result(r)
    assert bd.output_tokens_per_turn is None


def test_format_breakdown_renders_headline():
    bd = analyze_result(_result())
    text = format_breakdown(bd)
    assert "kenneth-quass-death" in text
    assert "98.0%" in text  # api_pct
    assert "model" in text


def test_markdown_table_has_row_per_run():
    bds = [analyze_result(_result()), analyze_result(_result(test_id="morris"))]
    table = format_markdown_table(bds)
    assert table.count("\n") == 3  # header + separator + 2 rows
    assert "morris" in table


# --- --by-skill (timeline tool-name tags, added 2026-07-26) ------------------

_SKILL_TIMELINE = [
    [0.0, "assistant", ["Skill:question-selection"]],
    [5.0, "tool_result", []],
    [8.0, "assistant", ["Skill:research-plan"]],
    [15.0, "tool_result", []],
    [20.0, "assistant", ["Skill:person-evidence"]],
    [45.0, "tool_result", ["record_search"]],
    [50.0, "assistant", []],
]


def test_skill_phase_breakdown_segments_by_skill_boundary():
    phases = _skill_phase_breakdown(_SKILL_TIMELINE)
    assert [p["skill"] for p in phases] == [
        "question-selection",
        "research-plan",
        "person-evidence",
    ]
    # Each phase runs from its own Skill tag to the NEXT one's (not to its own
    # tool_result) — the final phase runs to the timeline's last point.
    assert phases[0] == {"skill": "question-selection", "start_s": 0.0, "end_s": 8.0, "duration_s": 8.0}
    assert phases[1] == {"skill": "research-plan", "start_s": 8.0, "end_s": 20.0, "duration_s": 12.0}
    assert phases[2] == {"skill": "person-evidence", "start_s": 20.0, "end_s": 50.0, "duration_s": 30.0}


def test_skill_phase_breakdown_empty_for_legacy_timeline_rows():
    """2-element rows (pre-2026-07-26, no tool_names at all) -> no crash, []."""
    assert _skill_phase_breakdown(_result()["usage"]["timeline"]) == []


def test_skill_phase_breakdown_empty_when_tagged_but_no_skill_calls():
    """3-element rows present, but nothing is a Skill call (e.g. a run that
    crashed before routing to any skill) -> []. not an error."""
    timeline = [[0.0, "assistant", []], [3.0, "tool_result", ["record_search"]]]
    assert _skill_phase_breakdown(timeline) == []


def test_analyze_result_populates_skill_phases():
    bd = analyze_result(_result(usage={**_result()["usage"], "timeline": _SKILL_TIMELINE}))
    assert [p["skill"] for p in bd.skill_phases] == [
        "question-selection",
        "research-plan",
        "person-evidence",
    ]


def test_format_skill_phases_renders_each_phase():
    bd = analyze_result(_result(usage={**_result()["usage"], "timeline": _SKILL_TIMELINE}))
    text = format_skill_phases(bd)
    assert "question-selection" in text
    assert "research-plan" in text
    assert "person-evidence" in text


def test_format_skill_phases_no_data_message_for_legacy_run():
    bd = analyze_result(_result())  # legacy 2-element timeline, no tags
    text = format_skill_phases(bd)
    assert "no skill-phase data" in text
    assert "kenneth-quass-death" in text


# --- a Windows-slept run (issue #2983): timeline offsets include standby -----


def _windows_slept():
    # Timeline 0 -> 50 s on the raw monotonic clock, 30 s of which was standby
    # the heartbeat counted, so the persisted active wall-clock is 60 - 30.
    return _result(
        usage={
            **_result()["usage"],
            "timeline": _SKILL_TIMELINE,
            "wall_clock_seconds": 30.0,
            "counted_sleep_seconds": 30.0,
        }
    )


def test_windows_slept_stall_is_measured_on_the_timeline_clock():
    bd = analyze_result(_windows_slept())
    assert bd.counted_sleep_s == 30.0
    assert bd.timeline_clock_s == 60.0
    # 60 on the timeline's clock minus a 50 s span, not max(0, 30 - 50) = 0.
    assert bd.stall_s == 10.0


def test_windows_slept_phase_share_never_exceeds_the_run():
    text = format_skill_phases(analyze_result(_windows_slept()))
    # person-evidence ran 30 of 60 s on the timeline's clock: 50%, not 100%.
    assert "50% of wall-clock" in text
    assert "100% of wall-clock" not in text


def test_windows_slept_breakdown_names_the_host_sleep_without_placing_it():
    text = format_breakdown(analyze_result(_windows_slept()))
    assert "host sleep:      0.5m" in text
    # Only a total is persisted: the line must not claim which bucket holds it.
    host = next(line for line in text.splitlines() if "host sleep" in line)
    assert "counted in non-tool" not in host
    assert "tool, non-tool or stall/idle" in host
    assert "host sleep" not in format_breakdown(analyze_result(_result()))


def test_windows_slept_standby_during_a_tool_call_is_not_called_non_tool():
    # 1200 s standby while record_search was pending: the gap ends at a
    # tool_result, so the timeline puts it in TOOL time.
    timeline = [
        [0.0, "system:init", []],
        [10.0, "assistant", ["Skill:research"]],
        [20.0, "assistant", ["record_search"]],
        [1220.0, "tool_result", []],
        [1250.0, "assistant", []],
        [1260.0, "result", []],
    ]
    bd = analyze_result(
        _result(
            usage={
                **_result()["usage"],
                "timeline": timeline,
                "wall_clock_seconds": 60.0,
                "counted_sleep_seconds": 1200.0,
            }
        )
    )
    assert bd.tool_time_s == 1200.0
    text = format_breakdown(bd)
    assert "host sleep:      20.0m" in text
    assert "counted in non-tool" not in text


def test_windows_slept_phase_block_names_its_denominator():
    text = format_skill_phases(analyze_result(_windows_slept()))
    assert "wall-clock plus 0.5m host sleep" in text
    assert "host sleep" not in format_skill_phases(
        analyze_result(_result(usage={**_result()["usage"], "timeline": _SKILL_TIMELINE}))
    )


def test_a_counted_sleep_under_a_minute_is_still_shown():
    # The detector's floor is gap - tick, about 55 s; the line must not hide it.
    bd = analyze_result(_windows_slept())
    bd.counted_sleep_s = 55.0
    assert "host sleep:      0.9m" in format_breakdown(bd)


# ---------------------------------------------------------------------------
# Multi-query runs (#3128): their ResultMessage figures cover the last query
# only, so the summary and the table name them instead of printing them. The
# per-skill phases read the timeline and wall clock, which are whole-run.
# ---------------------------------------------------------------------------


def _multi_query_result(**overrides):
    """`_result()` with a second query: a background subagent's notification and
    then a fresh `system:init`, the anders-monsen-ancestry 2026-09-24 shape."""
    usage = {
        **_result()["usage"],
        "num_turns": 3,
        "timeline": [
            [0.0, "system:init", []],
            [8.0, "assistant", ["Skill:question-selection"]],
            [10.0, "tool_result", ["Skill"]],
            [12.0, "system:task_notification", []],
            [12.5, "system:init", []],
            [20.0, "assistant", []],
        ],
    }
    return _result(usage=usage, test_id="anders-monsen-ancestry", **overrides)


def test_exclusion_reason_names_a_multi_query_run():
    assert exclusion_reason(_multi_query_result()) == "multi-query"


def test_exclusion_reason_is_none_for_a_one_query_run_and_for_no_usage():
    assert exclusion_reason(_result()) is None
    assert exclusion_reason({"fixture": "found-slug"}) is None


def _write(tmp_path, name, result):
    import json

    p = tmp_path / name
    p.write_text(json.dumps(result), encoding="utf-8")
    return p


@pytest.mark.parametrize("mode", [[], ["--markdown"]])
def test_summary_and_table_name_a_multi_query_run_instead_of_printing_it(
    mode, tmp_path, capsys
):
    from e2e import latency_report

    flagged = _write(tmp_path, "run-2026-09-24_07-23-44.json", _multi_query_result())
    assert latency_report.main([*mode, str(flagged)]) == 0
    out = capsys.readouterr().out
    assert "excluded (multi-query)" in out
    assert str(flagged) in out
    assert "anders-monsen-ancestry" not in out.replace(str(flagged), "")


def test_a_clean_run_still_prints_beside_an_excluded_one(tmp_path, capsys):
    from e2e import latency_report

    flagged = _write(tmp_path, "run-2026-09-24_07-23-44.json", _multi_query_result())
    clean = _write(tmp_path, "run-2026-09-25_00-00-00.json", _result())
    assert latency_report.main([str(flagged), str(clean)]) == 0
    out = capsys.readouterr().out
    assert "=== kenneth-quass-death" in out
    assert "excluded (multi-query)" in out


def test_by_skill_still_prints_a_multi_query_runs_phases(tmp_path, capsys):
    from e2e import latency_report

    flagged = _write(tmp_path, "run-2026-09-24_07-23-44.json", _multi_query_result())
    assert latency_report.main(["--by-skill", str(flagged)]) == 0
    out = capsys.readouterr().out
    assert "anders-monsen-ancestry — per-skill phase breakdown" in out
    assert "excluded" not in out

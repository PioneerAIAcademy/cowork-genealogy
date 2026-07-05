"""Unit tests for e2e.latency_report — the Phase 0 latency analyzer.

Pure math over a synthetic result dict (the e2e/result.py schema). No live
run, no Anthropic API — this runs in `make harness-test`. The synthetic
timeline is hand-computed so the bucketed model/tool/overhead split is
checkable by eye.
"""

from __future__ import annotations

from e2e.latency_report import (
    LatencyBreakdown,
    analyze_result,
    format_breakdown,
    format_markdown_table,
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
            # gaps: 8->assistant(=8 model), 8->10 tool_result(=2 tool),
            # 10->13 assistant(=3 model), 13->14 system(=1 overhead),
            # 14->20 assistant(=6 model)
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
    assert "kenneth-quass-death" in table

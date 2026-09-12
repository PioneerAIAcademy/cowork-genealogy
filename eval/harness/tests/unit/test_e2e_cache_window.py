"""Unit tests for e2e.cache_window -- the 5-minute prompt-cache window costing.

Pure math over a synthetic timeline shaped like a real one (a main-thread
message emitted as two content-block rows, a delegation window whose subagent
rows are each preceded by `system:task_progress`, the launch ack and the Agent
result as main-thread `tool_result` rows). No live run, no API."""

from __future__ import annotations

import pytest

from e2e.cache_window import (
    BASE_PREFIX_CALLS,
    CACHE_READ_PER_MTOK,
    CACHE_TTL_S,
    CACHE_WRITE_5M_PER_MTOK,
    COLUMNS,
    analyze_run,
    format_summary,
    format_table,
    model_calls,
    row_threads,
    scan,
)

TIMELINE = [
    [1.0, "system:init", []],
    [10.0, "assistant", []],                 # main call 1, thinking block
    [10.1, "assistant", ["Agent"]],          # same message, tool_use block
    [11.0, "system:task_started", []],
    [11.0, "tool_result", []],               # launch ack -> main
    [15.0, "system:task_progress", []],
    [15.0, "assistant", ["record_read"]],    # sub call 1
    [15.1, "tool_result", ["record_read"]],  # sub (inherits from the row before)
    [20.0, "system:task_progress", []],
    [20.0, "assistant", []],                 # sub call 2
    [30.0, "system:task_notification", []],
    [30.0, "tool_result", ["Agent"]],        # Agent result -> main
    [400.0, "assistant", ["Read"]],          # main call 2, 390 s after call 1
    [401.0, "tool_result", ["Read"]],
    [402.0, "assistant", []],                # main call 3
    [403.0, "result", []],
]


def _doc(timeline=TIMELINE, **usage_overrides):
    usage = {
        "timeline": timeline,
        "total_cost_usd": 1.5,
        "usage": {
            "cache_read_input_tokens": 500,
            "cache_creation_input_tokens": 100,
            "cache_creation": {"ephemeral_1h_input_tokens": 100, "ephemeral_5m_input_tokens": 0},
        },
    }
    usage.update(usage_overrides)
    return {"test_id": "x", "usage": usage}


def test_bursts_collapse_and_threads_split():
    calls = model_calls(TIMELINE)
    assert [(c.thread, c.t) for c in calls] == [
        ("main", 10.0), ("sub", 15.0), ("sub", 20.0), ("main", 400.0), ("main", 402.0),
    ]
    assert [c.gap_s for c in calls] == [None, None, 5.0, 390.0, 2.0]
    assert [c.depth for c in calls] == [0, 0, 1, 1, 2]


def test_subagent_second_block_stays_on_sub_thread():
    # A two-block subagent message: only its first row follows task_progress.
    # The second row must continue that sub call, not open a main-thread one.
    timeline = [
        [10.0, "assistant", ["Agent"]],          # main call 1
        [11.0, "system:task_started", []],
        [11.0, "tool_result", []],               # launch ack -> main
        [15.0, "system:task_progress", []],
        [15.0, "assistant", []],                 # sub call 1, thinking block
        [15.1, "assistant", ["record_read"]],    # same message, tool_use block
        [15.2, "tool_result", ["record_read"]],
        [30.0, "system:task_notification", []],
        [30.0, "tool_result", ["Agent"]],        # Agent result -> main
        [400.0, "assistant", []],                # main call 2, 390 s after call 1
    ]
    assert row_threads(timeline) == [
        "main", None, "main", None, "sub", "sub", "sub", None, "main", "main",
    ]
    calls = model_calls(timeline)
    assert [(c.thread, c.t) for c in calls] == [("main", 10.0), ("sub", 15.0), ("main", 400.0)]
    assert [c.gap_s for c in calls] == [None, None, 390.0]


def test_compact_boundary_resets_main_depth_and_task_started_resets_sub():
    timeline = [
        [1.0, "assistant", []],
        [2.0, "tool_result", []],
        [3.0, "system:compact_boundary", []],
        [4.0, "assistant", []],
        [5.0, "system:task_started", []],
        [6.0, "system:task_progress", []],
        [6.0, "assistant", []],
        [7.0, "tool_result", []],
        [8.0, "system:task_started", []],
        [9.0, "system:task_progress", []],
        [9.0, "assistant", []],
    ]
    calls = model_calls(timeline)
    assert [(c.thread, c.depth) for c in calls] == [
        ("main", 0), ("main", 0), ("sub", 0), ("sub", 0),
    ]
    # A compaction keeps the main clock; a task_started restarts the sub one.
    assert [c.gap_s for c in calls] == [None, 3.0, None, None]


def test_lost_tokens_avg_and_grow():
    row = analyze_run(_doc(), fixture="fx", run="run-2026-09-01_00-00-00")
    assert row.n_calls == {"main": 3, "sub": 2}
    assert row.gaps[("main", CACHE_TTL_S)] == 1
    assert row.gaps[("sub", CACHE_TTL_S)] == 0
    assert row.gaps[("main", 60.0)] == 1
    assert row.gaps[("main", 1800.0)] == 0
    # 5 calls, 1 lost -> one fifth of the run's reads.
    assert row.lost_avg == pytest.approx(100.0)
    # depths 0,0,1,1,2 (+BASE each); the lost call is main call 2 at depth 1.
    total = 4 + 5 * BASE_PREFIX_CALLS
    assert row.lost_grow == pytest.approx(500 * (1 + BASE_PREFIX_CALLS) / total)
    assert row.delta_avg == pytest.approx(100 * (CACHE_WRITE_5M_PER_MTOK - CACHE_READ_PER_MTOK) / 1e6)
    assert row.write_price_delta == pytest.approx(100 * (3.75 - 6.00) / 1e6)
    assert row.write_ttl == "1h"
    assert row.cost == 1.5 and not row.cost_estimated
    # The main gap spans the sub calls at 15 and 20 -> a delegation window; the
    # literal thread-agnostic rule sees 20.0 -> 400.0 as its one gap.
    assert row.delegation_gaps == 1 and row.agnostic_gaps == 1


def test_delegation_window_counts_per_thread_but_not_thread_agnostic():
    # A sub call at 200 s splits the 10 -> 400 span for the thread-agnostic rule
    # (200 s, then 200 s) while the main thread still idles 390 s.
    timeline = [
        [10.0, "assistant", ["Agent"]],
        [11.0, "system:task_started", []],
        [11.0, "tool_result", []],
        [200.0, "system:task_progress", []],
        [200.0, "assistant", []],
        [201.0, "tool_result", ["Agent"]],
        [400.0, "assistant", []],
    ]
    row = analyze_run(_doc(timeline=timeline), fixture="fx", run="run-1")
    assert row.gaps[("main", CACHE_TTL_S)] == 1
    assert row.delegation_gaps == 1 and row.agnostic_gaps == 0
    # A subagent active inside the gap without a model call of its own in it
    # (its call landed before the gap; only its tool_result falls inside).
    busy = [
        [5.0, "assistant", ["Agent"]],           # main call 1: delegate
        [6.0, "system:task_started", []],
        [6.0, "tool_result", []],                # launch ack -> main
        [8.0, "system:task_progress", []],
        [8.0, "assistant", ["record_read"]],     # sub call, before the main gap opens
        [9.0, "tool_result", ["record_read"]],   # -> sub
        [12.0, "assistant", ["Read"]],           # main call 2
        [13.0, "tool_result", ["Read"]],         # -> main
        [100.0, "system:task_progress", []],
        [100.0, "tool_result", ["record_read"]], # sub activity inside the gap, no sub call in it
        [400.0, "assistant", []],                # main call 3, 388 s after call 2
    ]
    row = analyze_run(_doc(timeline=busy), fixture="fx", run="run-3")
    assert row.n_calls == {"main": 3, "sub": 1}
    assert row.gaps[("main", CACHE_TTL_S)] == 1 and row.delegation_gaps == 1
    # No subagent inside the gap: a plain long tool call, not a delegation window.
    plain = [[10.0, "assistant", ["Read"]], [11.0, "tool_result", ["Read"]], [400.0, "assistant", []]]
    row = analyze_run(_doc(timeline=plain), fixture="fx", run="run-2")
    assert row.gaps[("main", CACHE_TTL_S)] == 1
    assert row.delegation_gaps == 0 and row.agnostic_gaps == 1


def test_write_ttl_classification():
    def split(h, m):
        return {"cache_read_input_tokens": 1, "cache_creation_input_tokens": 1,
                "cache_creation": {"ephemeral_1h_input_tokens": h, "ephemeral_5m_input_tokens": m}}
    tl = [[1.0, "assistant", []]]
    assert analyze_run(_doc(tl, usage=split(5, 0)), fixture="f", run="r").write_ttl == "1h"
    assert analyze_run(_doc(tl, usage=split(0, 5)), fixture="f", run="r").write_ttl == "5m"
    assert analyze_run(_doc(tl, usage=split(5, 5)), fixture="f", run="r").write_ttl == "both"
    assert analyze_run(_doc(tl, usage=split(0, 0)), fixture="f", run="r").write_ttl == "none"
    no_split = {"cache_read_input_tokens": 1, "cache_creation_input_tokens": 1}
    assert analyze_run(_doc(tl, usage=no_split), fixture="f", run="r").write_ttl == "no-split"


def test_missing_cost_is_estimated_from_tokens_and_marked():
    row = analyze_run(_doc(total_cost_usd=None), fixture="fx", run="run-1")
    assert row.cost_estimated
    assert row.cost == pytest.approx(500 * 0.30 / 1e6 + 100 * 6.00 / 1e6)


def test_exclusion_reasons():
    assert analyze_run({"usage": {}}, fixture="fx", run="r") == "no-timeline"
    assert analyze_run(_doc(usage={}), fixture="fx", run="r") == "no-cache-figures"


def test_scan_counts_unreadable_and_excluded(tmp_path):
    good = tmp_path / "fx" / "run-2026-09-01_00-00-00.json"
    good.parent.mkdir()
    good.write_text(
        '{"usage": {"timeline": [[1.0, "assistant", []]], "usage": {"cache_read_input_tokens": 5}}}',
        encoding="utf-8",
    )
    bad = tmp_path / "fx" / "run-2026-09-02_00-00-00.json"
    bad.write_text("not json", encoding="utf-8")
    empty = tmp_path / "fx" / "run-2026-09-03_00-00-00.json"
    empty.write_text('{"usage": {}}', encoding="utf-8")
    rows, excluded = scan([good, bad, empty])
    assert [r.run for r in rows] == ["run-2026-09-01_00-00-00"]
    assert dict(excluded) == {"unreadable": 1, "no-timeline": 1}


def test_table_and_summary_render_one_row_per_run():
    rows, excluded = [analyze_run(_doc(), fixture="fx", run="run-2026-09-01_00-00-00")], {}
    md = format_table(rows, markdown=True).splitlines()
    assert md[0].startswith("| fixture |") and md[1] == "|" + "---|" * len(COLUMNS)
    assert len(md) == 3 and "| fx | 2026-09-01_00-00-00 | 3+2 | 1 | 1 | 0 | 0 |" in md[2]
    plain = format_table(rows, markdown=False).splitlines()
    assert len(plain) == 2 and plain[0].startswith("fixture")
    summary = format_summary(rows, excluded, n_runs=1)
    assert "human think time between turns is NOT in it" in summary
    assert "3.75" in summary and "0.30" in summary
    assert "(1 of 1 main gaps here)" in summary and "would be 1 in 1 runs" in summary
    assert "PRODUCTION DELTA" in summary and "write-price term is $0" in summary
    assert "Corpus write TTL, from the 5m/1h split: 1 1h --" in summary
    assert "Reference only, vs. the subscription-run corpus" in summary
    assert "Net over" not in summary

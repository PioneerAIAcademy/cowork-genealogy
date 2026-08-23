"""Unit tests for e2e.compaction_report — record_search subjectId supply by
compaction segment (issue #1155)."""

from __future__ import annotations

import json
from pathlib import Path

from e2e.compaction_report import (
    EARLY_MAX_SEGMENT,
    RecordSearchCall,
    format_report,
    main,
    scan,
    segment_run,
)


def _assistant(names):
    return [0.0, "assistant", names]


def _boundary():
    return [0.0, "system:compact_boundary"]


def _tool_call(tool, subject_id=None):
    call = {"tool": tool}
    if subject_id is not None:
        call["args"] = {"subjectId": subject_id}
    else:
        call["args"] = {}
    return call


def test_segmentable_run_splits_on_compact_boundary():
    """The acceptance check: a run with two compact boundaries lands its
    record_search calls in the correct segments (0, 1, 2)."""
    doc = {
        "usage": {
            "timeline": [
                _assistant(["record_search"]),
                _boundary(),
                _assistant(["record_search"]),
                _boundary(),
                _assistant(["record_search"]),
            ]
        },
        "tool_calls": [
            _tool_call("mcp__genealogy__record_search", subject_id="I1"),
            _tool_call("mcp__genealogy__record_search", subject_id=None),
            _tool_call("mcp__genealogy__record_search", subject_id="I2"),
        ],
    }
    calls, reason = segment_run(doc)
    assert reason is None
    assert calls == [(0, True), (1, False), (2, True)]


def test_two_element_timeline_is_unsegmentable_and_excluded():
    doc = {
        "usage": {"timeline": [[0.0, "assistant"], [0.0, "system:compact_boundary"]]},
        "tool_calls": [_tool_call("mcp__genealogy__record_search", subject_id="I1")],
    }
    calls, reason = segment_run(doc)
    assert calls == []
    assert reason == "unsegmentable-timeline"


def test_tool_count_mismatch_is_excluded_not_misattributed():
    doc = {
        "usage": {"timeline": [_assistant(["record_search", "Read"])]},
        "tool_calls": [_tool_call("mcp__genealogy__record_search", subject_id="I1")],
    }
    calls, reason = segment_run(doc)
    assert calls == []
    assert reason == "tool-count-mismatch"


def test_more_tool_calls_than_timeline_names_is_excluded_not_undercounted():
    """The other mismatch direction: trailing tool_calls the timeline never
    accounted for must exclude the run, not go silently unexamined."""
    doc = {
        "usage": {"timeline": [_assistant(["record_search"])]},
        "tool_calls": [
            _tool_call("mcp__genealogy__record_search", subject_id="I1"),
            _tool_call("mcp__genealogy__record_search", subject_id=None),
        ],
    }
    calls, reason = segment_run(doc)
    assert calls == []
    assert reason == "tool-count-mismatch"


def test_early_late_boundary_is_exactly_at_segment_three():
    """Segment 2 is early, segment 3 is late — the issue's own split point."""
    assert EARLY_MAX_SEGMENT == 2
    doc = {
        "usage": {
            "timeline": [
                _assistant(["record_search"]),  # segment 0
                _boundary(),
                _boundary(),
                _assistant(["record_search"]),  # segment 2 -> early
                _boundary(),
                _assistant(["record_search"]),  # segment 3 -> late
            ]
        },
        "tool_calls": [
            _tool_call("mcp__genealogy__record_search", subject_id="I1"),
            _tool_call("mcp__genealogy__record_search", subject_id="I1"),
            _tool_call("mcp__genealogy__record_search", subject_id="I1"),
        ],
    }
    calls, reason = segment_run(doc)
    assert reason is None
    assert calls == [(0, True), (2, True), (3, True)]


def test_falsy_subject_id_variants_all_read_as_not_supplied():
    """Matches record-search.ts's own gate: `input.subjectId &&`, truthiness
    not `=== undefined` — an empty string must not count as supplied."""
    doc = {
        "usage": {"timeline": [_assistant(["record_search", "record_search"])]},
        "tool_calls": [
            _tool_call("mcp__genealogy__record_search", subject_id=""),
            _tool_call("mcp__genealogy__record_search", subject_id=None),
        ],
    }
    calls, reason = segment_run(doc)
    assert reason is None
    assert calls == [(0, False), (0, False)]


def test_non_record_search_calls_are_not_counted():
    doc = {
        "usage": {"timeline": [_assistant(["Read", "research_append", "record_search"])]},
        "tool_calls": [
            _tool_call("Read"),
            _tool_call("mcp__genealogy__research_append"),
            _tool_call("mcp__genealogy__record_search", subject_id="I1"),
        ],
    }
    calls, reason = segment_run(doc)
    assert reason is None
    assert calls == [(0, True)]


def _write_run(tmp_path: Path, doc: dict, *, stem="run-2026-08-09_00-00-00", fixture="a-fixture"):
    d = tmp_path / fixture
    d.mkdir(parents=True, exist_ok=True)
    p = d / f"{stem}.json"
    p.write_text(json.dumps(doc), encoding="utf-8")
    return p


def test_scan_counts_exclusions_across_multiple_runs(tmp_path):
    segmentable = _write_run(
        tmp_path,
        {
            "usage": {"timeline": [_assistant(["record_search"])]},
            "tool_calls": [_tool_call("mcp__genealogy__record_search", subject_id="I1")],
        },
        stem="run-2026-08-01_00-00-00",
    )
    unsegmentable = _write_run(
        tmp_path,
        {"usage": {"timeline": [[0.0, "assistant"]]}, "tool_calls": []},
        stem="run-2026-08-02_00-00-00",
    )
    calls, excluded, unreadable_files = scan([segmentable, unsegmentable])
    assert calls == [RecordSearchCall(f"a-fixture/{segmentable.stem}", 0, True)]
    assert excluded == {"unsegmentable-timeline": 1}
    assert unreadable_files == []


def test_corrupt_json_is_excluded_as_unreadable_not_a_crash(tmp_path):
    """A run log that fails to even parse must be tallied and named, never
    raise out of scan() or be silently skipped."""
    d = tmp_path / "a-fixture"
    d.mkdir(parents=True, exist_ok=True)
    corrupt = d / "run-2026-08-03_00-00-00.json"
    corrupt.write_text("{not valid json", encoding="utf-8")
    calls, excluded, unreadable_files = scan([corrupt])
    assert calls == []
    assert excluded == {"unreadable": 1}
    assert unreadable_files == [f"a-fixture/{corrupt.stem}"]


def test_non_dict_top_level_json_is_excluded_as_unreadable_not_a_crash(tmp_path):
    """`json.loads` succeeds on a bare `null`/list/number; segment_run must
    never be handed one of those, or `doc.get(...)` raises AttributeError."""
    d = tmp_path / "a-fixture"
    d.mkdir(parents=True, exist_ok=True)
    not_a_dict = d / "run-2026-08-04_00-00-00.json"
    not_a_dict.write_text("null", encoding="utf-8")
    calls, excluded, unreadable_files = scan([not_a_dict])
    assert calls == []
    assert excluded == {"unreadable": 1}
    assert unreadable_files == [f"a-fixture/{not_a_dict.stem}"]


def test_format_report_states_exclusions_and_early_late_split():
    calls = [
        RecordSearchCall("fixture-a/run-1", 0, True),
        RecordSearchCall("fixture-a/run-1", 3, False),
        RecordSearchCall("fixture-b/run-1", 3, False),
    ]
    out = format_report(calls, n_runs=3, excluded={"unsegmentable-timeline": 1})
    assert "1 of 3 run(s) excluded" in out
    assert "unsegmentable-timeline" in out
    assert "EARLY (segments 0-2): 1 record_search call(s), 1 carrying subjectId (100.0%)" in out
    assert "LATE (segments 3+): 2 record_search call(s), 0 carrying subjectId (0.0%)" in out
    assert "0/1 (0.0%)  fixture-a/run-1" in out
    assert "0/1 (0.0%)  fixture-b/run-1" in out


def test_format_report_with_no_calls_is_a_real_result_not_an_empty_one():
    out = format_report([], n_runs=5, excluded={})
    assert "0 of 5 run(s) excluded" in out
    assert "real result" in out


def test_main_reports_window_and_exclusion_line(tmp_path, monkeypatch, capsys):
    import e2e.runlog_selection as runlog_selection

    monkeypatch.setattr(runlog_selection, "E2E_RUNLOGS", tmp_path)
    _write_run(
        tmp_path,
        {
            "usage": {"timeline": [_assistant(["record_search"])]},
            "tool_calls": [_tool_call("mcp__genealogy__record_search", subject_id="I1")],
        },
        stem="run-2026-08-09_00-00-00",
    )
    _write_run(
        tmp_path,
        {"usage": {"timeline": [[0.0, "assistant"]]}, "tool_calls": []},
        stem="run-2026-08-10_00-00-00",
        fixture="another-fixture",
    )

    rc = main(["--since", "all"])
    out = capsys.readouterr().out
    assert rc == 0
    assert "Window: entire corpus (2 run(s))." in out
    assert "1 of 2 run(s) excluded from segmentation: 1 unsegmentable-timeline" in out
    assert "EARLY (segments 0-2): 1 record_search call(s), 1 carrying subjectId (100.0%)" in out


def test_main_exits_nonzero_when_nothing_in_the_window_is_readable(tmp_path, monkeypatch):
    import e2e.runlog_selection as runlog_selection

    monkeypatch.setattr(runlog_selection, "E2E_RUNLOGS", tmp_path)
    d = tmp_path / "a-fixture"
    d.mkdir(parents=True, exist_ok=True)
    (d / "run-2026-08-09_00-00-00.json").write_text("not json", encoding="utf-8")

    assert main(["--since", "all"]) == 1


def test_main_test_flag_still_honors_the_since_cutoff(tmp_path, monkeypatch, capsys):
    """Unlike latency_report.py's --test (one latest run, where a date filter
    is meaningless), this --test still aggregates EVERY run for the fixture —
    an aggregate read, which is exactly what SINCE exists to protect. A stale
    fixture's runs must stay filtered under the default window, and only
    reappear under --since all."""
    import e2e.runlog_selection as runlog_selection

    monkeypatch.setattr(runlog_selection, "E2E_RUNLOGS", tmp_path)
    _write_run(
        tmp_path,
        {
            "usage": {"timeline": [_assistant(["record_search"])]},
            "tool_calls": [_tool_call("mcp__genealogy__record_search", subject_id="I1")],
        },
        stem="run-2020-01-01_00-00-00",
        fixture="old-fixture",
    )

    rc = main(["--test", "old-fixture"])
    captured = capsys.readouterr()
    assert rc == 1
    assert "No committed runs found" in captured.err

    rc = main(["--test", "old-fixture", "--since", "all"])
    out = capsys.readouterr().out
    assert rc == 0
    assert "Fixture: old-fixture" in out
    assert "Window: entire corpus (1 run(s))." in out

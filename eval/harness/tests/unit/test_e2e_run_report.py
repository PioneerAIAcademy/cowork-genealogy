"""Tests for the e2e readable report (`make e2e-report`, and the one written
after every run).

The rule that matters most: until a run is graded, its report must not carry
the judge's verdict, recall or per-finding results — a genealogist grades each
run blind (spec §7.4), and this file sits in the folder they grade from.
"""

from __future__ import annotations

import json
from pathlib import Path

from e2e.agent_spend_report import collect
from e2e.run_report import (
    GRADE_HIDDEN,
    agent_call_durations,
    keep_newest_reports,
    prune_orphan_reports,
    render,
    txt_path_for,
    write_reports,
)

REAL = Path(__file__).resolve().parents[3] / "runlogs" / "e2e" / "anders-monsen-ancestry" / "run-2026-10-05_16-07-18.json"


def _log(**over):
    log = {
        "test_id": "fx",
        "captured_at": "2026-10-06_10-00-00",
        "harness_schema_version": 3,
        "verdict": "fail",
        "compliance": "clean",
        "outcome": "fail",
        "stop_reason": "completed",
        "judge_output": {"verdict": "fail", "recall_required": 0.25, "recall_total": 0.5,
                         "per_finding": [{"finding_id": "f1", "matched": "false"}]},
        "usage": {"total_cost_usd": 4.2, "wall_clock_seconds": 600.0,
                  "usage": {"input_tokens": 5, "output_tokens": 900,
                            "cache_read_input_tokens": 100_000, "cache_creation_input_tokens": 9_000}},
        "tool_calls": [],
    }
    log.update(over)
    return log


_VERDICT_WORDS = ("verdict", "recall", "matched", "proof_quality", "EXPECTED FINDINGS")


def test_an_ungraded_report_carries_no_grade():
    text = render(_log(), "run-x.json", graded=False)
    for word in _VERDICT_WORDS:
        assert word not in text, word
    assert GRADE_HIDDEN in text
    assert "compliance       clean" in text  # harness facts still show


def test_a_graded_report_shows_the_grade_and_findings():
    text = render(_log(), "run-x.json", graded=True)
    assert "verdict          fail" in text
    assert "recall required  0.25" in text
    assert "f1     matched: false" in text
    assert GRADE_HIDDEN not in text


def test_a_real_committed_run_renders_its_measured_figures_and_no_grade():
    log = json.loads(REAL.read_text(encoding="utf-8"))
    text = render(log, REAL.name, graded=False)
    assert "$15.66   (the SDK's own figure)" in text
    assert "107.1 min" in text
    assert "165,460 tokens   · squeezed 3" in text
    assert "  20  gps-mentor" in text
    for word in _VERDICT_WORDS:
        assert word not in text, word


def test_an_aborted_run_shows_an_estimate_not_a_missing_cost():
    """Aborted runs carry no recorded cost by design; they are the costliest ones."""
    usage = dict(_log()["usage"], total_cost_usd=None, total_cost_usd_estimated=6.5)
    assert "$6.50   (ESTIMATE" in render(_log(usage=usage), "r.json", graded=False)
    usage = dict(_log()["usage"], total_cost_usd=None)
    text = render(_log(usage=usage), "r.json", graded=False)
    assert "ESTIMATE, main thread only" in text


def test_an_old_run_says_not_recorded_never_zero():
    log = _log(usage={"total_cost_usd": 7.46})
    text = render(log, "r.json", graded=False)
    assert "busiest moment   not recorded" in text
    assert "none recorded (capture status: unknown)" in text
    assert " 0 tokens" not in text


def test_compliance_is_derived_for_a_log_without_the_field():
    """138 of 202 committed runs have no top-level `compliance`."""
    log = _log()
    log.pop("compliance")
    log.pop("harness_schema_version")
    assert "compliance       not recorded" not in render(log, "r.json", graded=False)


def test_a_judge_error_is_shown_as_a_harness_fact():
    log = _log(judge_output={"error": "submit_grading.dimensions is not a list"})
    assert "judge error      submit_grading" in render(log, "r.json", graded=False)


def _write_log(tmp_path: Path, **over) -> Path:
    fixture = tmp_path / "fx"
    fixture.mkdir(exist_ok=True)
    path = fixture / "run-2026-10-06_10-00-00.json"
    path.write_text(json.dumps(_log(**over)), encoding="utf-8")
    return path


def test_the_hidden_report_is_rerendered_once_the_run_is_graded(tmp_path: Path):
    path = _write_log(tmp_path)
    write_reports([path])
    assert GRADE_HIDDEN in txt_path_for(path).read_text(encoding="utf-8")

    written, skipped, _ = write_reports([path])  # still ungraded: left alone
    assert written == [] and skipped

    (path.parent / f"{path.stem}.ann.json").write_text("{}", encoding="utf-8")
    written, _, _ = write_reports([path])  # graded now: re-rendered without FORCE
    assert written == [txt_path_for(path)]
    assert "verdict          fail" in txt_path_for(path).read_text(encoding="utf-8")


def test_a_non_run_json_is_unreadable_not_written(tmp_path: Path):
    bad = tmp_path / "run-x.json"
    bad.write_text(json.dumps({"no": "usage"}), encoding="utf-8")
    written, _, unreadable = write_reports([bad])
    assert written == [] and unreadable == [bad]


def test_orphan_reports_are_removed(tmp_path: Path):
    path = _write_log(tmp_path)
    write_reports([path])
    orphan = path.parent / "reports" / "run-gone.txt"
    orphan.write_text("x", encoding="utf-8")
    assert prune_orphan_reports(path.parent) == [orphan]
    assert txt_path_for(path).exists()


def test_a_real_committed_run_shows_helper_time_and_who_spent_what():
    """Its helpers were captured before `duration_seconds` existed, so their
    time comes from each Agent call's own `duration_ms` trailer."""
    log = json.loads(REAL.read_text(encoding="utf-8"))
    assert len(agent_call_durations(log)) == 20
    text = render(log, REAL.name, graded=False, per_agent=collect([REAL])[0])
    summary = text.split("SUMMARY")[1]
    assert "main $7.70 (45%) · helpers $9.35 (55%)   of the $17.06 whole-run flat estimate" in summary
    assert "57.4 min summed over 20 launch(es)" in summary
    assert "busiest moment   165,460 tokens (main researcher)" in summary
    assert "squeezes         main 3 · helpers 0" in summary
    assert "  1  question-selection            11    $0.15      33 s" in text


def test_a_helpers_own_meters_fill_its_row():
    """No committed run carries helper meters yet (they postdate the corpus), so
    the busiest / squeezed / model columns are pinned on a built log."""
    sub = dict(_SUB, peak_window_tokens=148_200, compactions=[{"trigger": "auto"}],
               models=["claude-sonnet-5"])
    log = _log(subagents=[sub], subagent_capture_status="captured")
    row = next(line for line in render(log, "r.json", graded=False).splitlines()
               if line.startswith("    1  record-extractor"))
    assert "148,200" in row and "claude-sonnet-5" in row
    assert row.split()[-2] == "1"  # squeezed once


_SUB = {"agent_type": "record-extractor", "num_assistant_turns": 6,
        "usage": {"input_tokens": 1, "output_tokens": 500,
                  "cache_read_input_tokens": 20_000, "cache_creation_input_tokens": 2_000},
        "peak_window_tokens": 26_000, "compactions": [], "models": ["claude-sonnet-4-6"]}


def test_a_helpers_own_duration_wins_over_the_call_trailer():
    sub = dict(_SUB, duration_seconds=61.0, transcript="agent-abc123.jsonl")
    call = {"tool": "Agent", "response_summary": "agentId: abc123 … <usage>duration_ms: 99000</usage>"}
    log = _log(subagents=[sub], subagent_capture_status="captured", tool_calls=[call])
    assert "      61 s" in render(log, "r.json", graded=False)


def test_a_failed_capture_never_reads_as_main_100_percent():
    """Capture failed: `subagents` is [] and the whole-run figure equals main."""
    usage = dict(_log()["usage"], whole_run_cost_usd_estimated=3.0)
    log = _log(usage=usage, subagents=[], subagent_capture_status="no_cache_dir")
    text = render(log, "r.json", graded=False)
    assert "who spent it     not recorded" in text
    assert "100%" not in text


def test_no_helper_ran_is_main_100_percent():
    log = _log(subagents=[], subagent_capture_status="matched_no_transcripts")
    assert "main 100% — no helper ran" in render(log, "r.json", graded=False)


def test_retention_keeps_the_five_newest_run_reports_and_ignores_scratch(tmp_path: Path):
    reports = tmp_path / "fx" / "reports"
    reports.mkdir(parents=True)
    for day in range(1, 7):
        (reports / f"run-2026-10-0{day}_00-00-00.txt").write_text("x", encoding="utf-8")
    (reports / "scratch_2026-10-09_00-00-00.txt").write_text("x", encoding="utf-8")
    removed = keep_newest_reports(tmp_path / "fx")
    assert [p.name for p in removed] == ["run-2026-10-01_00-00-00.txt"]
    kept = sorted(p.name for p in reports.glob("run-*.txt"))
    assert kept[0] == "run-2026-10-02_00-00-00.txt" and len(kept) == 5


def test_a_scratch_run_gets_no_report(tmp_path: Path):
    fixture = tmp_path / "fx"
    fixture.mkdir()
    crashed = fixture / "scratch_2026-10-06_10-00-00.json"
    crashed.write_text(json.dumps(_log()), encoding="utf-8")
    written, _, _ = write_reports([crashed])
    assert written == []
    assert not (fixture / "reports").exists()

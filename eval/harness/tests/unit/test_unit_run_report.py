"""Tests for `make unit-report` — one readable `.txt` per unit run log.

Two directions. The report must say a figure is missing rather than print a
fake one (a log written before the subagent capture has no busiest moment, and
a `0` there would read as "this agent read nothing"), and it must print the real
figures — the log's own totals, each model's own SDK cost, each helper's peak —
the moment they exist.
"""

from __future__ import annotations

import json
from pathlib import Path

from unit_run_report import is_run_log, render, run_logs, txt_path_for, write_reports


def _run(**over):
    run = {
        "outcome": "pass",
        "aborted_reason": None,
        "num_turns": 2,
        "duration_ms": 14_389.3,
        "started_at": 1_000.0,
        "ended_at": 1_023.1,
        "skill_cost_usd": 0.1047,
        "model_usage": {
            "claude-haiku-4-5-20251001": {"costUSD": 0.000593},
            "claude-sonnet-4-6": {"costUSD": 0.10413},
        },
        "judge": {"judge_cost_usd": 0.0118, "duration_ms": 8_591.5},
    }
    run.update(over)
    return run


def _log(runs_by_test, totals=None):
    return {
        "skill": "check-warnings",
        "timestamp": "2026-10-02_16-46-15",
        "model": "claude-sonnet-4-6",
        "invocation": "skill",
        "tests": [
            {"test_id": tid, "outcome": runs[0]["outcome"], "runs": runs}
            for tid, runs in runs_by_test.items()
        ],
        "totals": totals
        or {
            "skill_cost_usd": 1.569,
            "judge_cost_usd": 0.1439,
            "total_cost_usd": 1.7129,
            "num_turns": 26,
            "wall_clock_ms": 509_658.1,
        },
    }


def test_each_test_shows_turns_costs_and_times():
    text = render(_log({"ut_check_warnings_001": [_run()]}), "v1.json")
    block = text.split("ut_check_warnings_001")[1].split("SUMMARY")[0]
    assert "pass" in block
    assert "turns            2" in block
    assert "$0.1041   claude-sonnet-4-6" in block
    assert "$0.0006   claude-haiku-4-5-20251001" in block
    assert "agent cost         $0.1047" in block
    assert "judge cost         $0.0118" in block
    assert "agent time       14.4 s" in block
    assert "judge time       8.6 s" in block
    assert "wall clock       23.1 s" in block


def test_the_summary_uses_the_logs_own_totals():
    """The totals are the harness's, not re-added here, so they always match."""
    text = render(_log({"ut_check_warnings_001": [_run()]}), "v1.json")
    summary = text.split("SUMMARY")[1]
    assert "agent cost         $1.5690" in summary
    assert "judge cost         $0.1439" in summary
    assert "total cost         $1.7129" in summary
    assert "suite wall clock 509.7 s" in summary


def test_the_suite_clock_is_the_makespan_not_the_sum_of_tests():
    """Tests run side by side: two 23.1 s tests in a 30 s suite is 30 s, not 46 s."""
    log = _log(
        {"ut_a": [_run()], "ut_b": [_run()]},
        totals={"wall_clock_ms": 30_000.0},
    )
    summary = render(log, "v1.json").split("SUMMARY")[1]
    assert "suite wall clock 30.0 s" in summary
    assert "46.2" not in summary
    assert "average per test 23.1 s" in summary


def test_a_log_without_the_capture_says_not_recorded_never_zero():
    text = render(_log({"ut_check_warnings_001": [_run()]}), "v1.json")
    assert "busiest moment   not recorded (this log predates the capture)" in text
    assert "busiest moment   not recorded in this log" in text
    assert " 0 tokens" not in text


def _main(peak, compactions=()):
    return {"peak_window_tokens": peak, "compactions": list(compactions),
            "models": ["claude-sonnet-4-6"]}


_SQUEEZE = {"trigger": "auto", "pre_tokens": 167_000, "post_tokens": None}


def test_a_direct_test_shows_the_relay_and_the_agent_under_test_labelled():
    sub = {"agent_type": "check-warnings", "peak_window_tokens": 41_230,
           "compactions": [], "models": ["claude-sonnet-4-6"]}
    log = _log({"ut_a": [_run(main_thread=_main(9_100), subagents=[sub],
                              subagent_capture_status="captured")]})
    text = render(log, "v1.json")
    assert "main thread    9,100 tokens  (squeezed 0, claude-sonnet-4-6)" in text
    assert "helper         41,230 tokens  (squeezed 0, claude-sonnet-4-6)  check-warnings" in text


def test_a_routed_test_shows_the_main_thread_where_the_skill_ran():
    log = _log({"ut_a": [_run(main_thread=_main(88_000), subagents=[],
                              subagent_capture_status="matched_no_transcripts")]})
    text = render(log, "v1.json")
    assert "main thread    88,000 tokens" in text
    assert "helpers        none captured (capture status: matched_no_transcripts)" in text


def test_the_summary_names_the_tallest_thread_and_counts_squeezes_across_all():
    sub = {"agent_type": "record-extractor", "peak_window_tokens": 166_900,
           "compactions": [_SQUEEZE], "models": ["claude-sonnet-4-6"]}
    log = _log({
        "ut_a": [_run(main_thread=_main(40_000), subagents=[sub], subagent_capture_status="captured")],
        "ut_b": [_run(main_thread=_main(120_000, [_SQUEEZE]), subagents=[],
                      subagent_capture_status="matched_no_transcripts")],
    })
    summary = render(log, "v1.json").split("SUMMARY")[1]
    assert "166,900 tokens (record-extractor) · squeezed 2 of 3 thread(s) measured" in summary


def test_a_run_that_aborted_before_capture_is_not_called_old():
    log = _log({"ut_a": [_run(outcome="aborted", aborted_reason="not_runnable")]})
    text = render(log, "v1.json")
    assert "not recorded (the run aborted before the capture)" in text
    assert "predates" not in text.split("SUMMARY")[0]


def test_cost_by_model_adds_up_to_the_agent_cost_on_a_real_log():
    """A figure the report works out itself, checked against one it copies.

    Committed log, so this reads real SDK output rather than a fixture.
    """
    real = Path(__file__).resolve().parents[3] / "runlogs" / "unit" / "check-warnings" / "v1_2026-10-02_16-46-15.json"
    log = json.loads(real.read_text(encoding="utf-8"))
    summary = render(log, real.name).split("SUMMARY")[1]
    by_model = [line for line in summary.splitlines() if "claude-" in line and "$" in line]
    added = sum(float(line.split("$")[1].split()[0]) for line in by_model)
    assert abs(added - log["totals"]["skill_cost_usd"]) < 0.0002
    assert "agent cost         $1.5690" in summary


def test_a_multi_run_test_shows_every_run_and_an_aborted_one_says_why():
    log = _log({"ut_a": [_run(), _run(outcome="aborted", aborted_reason="sdk_stream_silence")]})
    text = render(log, "v1.json")
    assert "-- run 1 of 2: pass" in text
    assert "-- run 2 of 2: aborted" in text
    assert "aborted          sdk_stream_silence" in text


def test_missing_figures_print_dashes_not_zeros():
    run = {"outcome": "aborted", "runs": []}
    log = _log({"ut_a": [run]}, totals={})
    text = render(log, "v1.json")
    assert "agent cost              --" in text
    assert "$0.0000" not in text


def test_only_run_logs_are_reported(tmp_path: Path):
    for name in ("v1_2026-10-02_16-46-15.json", "v1_2026-10-02_16-46-15.ann.json",
                 ".partial_x.json", "scratch_2026-10-03_00-00-00.json", "notes.txt"):
        (tmp_path / "check-warnings").mkdir(exist_ok=True)
        (tmp_path / "check-warnings" / name).write_text("{}", encoding="utf-8")
    names = [p.name for p in run_logs("check-warnings", root=tmp_path)]
    assert names == ["scratch_2026-10-03_00-00-00.json", "v1_2026-10-02_16-46-15.json"]
    assert not is_run_log(Path("v1.ann.json"))


def test_writes_one_txt_per_log_into_a_reports_folder_and_skips_existing(tmp_path: Path):
    skill = tmp_path / "check-warnings"
    skill.mkdir()
    log_path = skill / "v1_2026-10-02_16-46-15.json"
    log_path.write_text(json.dumps(_log({"ut_a": [_run()]})), encoding="utf-8")

    written, skipped, bad = write_reports([log_path])
    assert written == [skill / "reports" / "v1_2026-10-02_16-46-15.txt"]
    assert txt_path_for(log_path).read_text(encoding="utf-8").startswith("check-warnings — unit run")

    written, skipped, bad = write_reports([log_path])
    assert written == [] and skipped == [txt_path_for(log_path)]

    written, _, _ = write_reports([log_path], force=True)
    assert written == [txt_path_for(log_path)]


def test_an_unreadable_or_non_run_log_is_counted_not_written(tmp_path: Path):
    bad = tmp_path / "v1_broken.json"
    bad.write_text("{not json", encoding="utf-8")
    other = tmp_path / "v1_other.json"
    other.write_text(json.dumps({"not": "a run log"}), encoding="utf-8")
    written, _, unreadable = write_reports([bad, other])
    assert written == [] and unreadable == [bad, other]
    assert not (tmp_path / "reports").exists()


def test_an_empty_capture_names_its_status_and_a_missing_main_thread():
    """`[]` means three different things; the status says which."""
    log = _log({"ut_a": [_run(subagents=[], subagent_capture_status="no_cache_dir")]})
    text = render(log, "v1.json")
    assert "helpers        none captured (capture status: no_cache_dir)" in text
    assert "main thread    not captured" in text

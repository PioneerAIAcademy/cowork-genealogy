"""Unit tests for e2e.guardrail_shadow_report — the retroactive §7
shadow-window calibration tool (docs/specs/guardrail-enforcement-spec.md,
GitHub issue #911).

Pure filesystem + aggregation logic over synthetic result JSONs written to
tmp_path. `find_unguarded_protected_writes` itself is already covered by
test_skill_invocation.py; these tests are about correctly discovering,
loading, and aggregating across a corpus of files.
"""

from __future__ import annotations

import json

from e2e.guardrail_shadow_report import (
    _is_result_json,
    all_result_jsons,
    format_detail,
    format_summary,
    result_jsons_for,
    scan_corpus,
    scan_one,
)


def _write_run(dir_, name, tool_calls):
    dir_.mkdir(parents=True, exist_ok=True)
    (dir_ / name).write_text(json.dumps({"tool_calls": tool_calls}), encoding="utf-8")
    return dir_ / name


def _unguarded_write():
    return {
        "tool": "mcp__genealogy__research_append",
        "args": {"section": "person_evidence", "op": "append", "entry": {"person_id": "I1"}},
    }


# --- _is_result_json ----------------------------------------------------


def test_is_result_json_accepts_a_run_file(tmp_path):
    assert _is_result_json(tmp_path / "run-2026-07-27_20-01-40.json") is True


def test_is_result_json_rejects_ann_and_final_and_transcript(tmp_path):
    assert _is_result_json(tmp_path / "run-2026-07-27_20-01-40.ann.json") is False
    assert _is_result_json(tmp_path / "run-2026-07-27_20-01-40.final-research.json") is False
    assert _is_result_json(tmp_path / "run-2026-07-27_20-01-40.final-tree.gedcomx.json") is False
    assert _is_result_json(tmp_path / "run-2026-07-27_20-01-40.transcript.md") is False


def test_is_result_json_rejects_scratch(tmp_path):
    assert _is_result_json(tmp_path / "scratch_2026-07-27_20-01-40.json") is False


# --- discovery: all_result_jsons / result_jsons_for -----------------------


def test_all_result_jsons_finds_every_fixture(tmp_path, monkeypatch):
    import e2e.guardrail_shadow_report as mod

    monkeypatch.setattr(mod, "E2E_RUNLOGS", tmp_path)
    _write_run(tmp_path / "fixture-a", "run-2026-07-01_00-00-00.json", [])
    _write_run(tmp_path / "fixture-a", "run-2026-07-02_00-00-00.json", [])
    _write_run(tmp_path / "fixture-b", "run-2026-07-01_00-00-00.json", [])
    # siblings that must be excluded
    (tmp_path / "fixture-a" / "run-2026-07-01_00-00-00.ann.json").write_text("{}")

    found = all_result_jsons()
    assert len(found) == 3  # not the latest-per-fixture-only; every run


def test_result_jsons_for_scopes_to_one_fixture(tmp_path, monkeypatch):
    import e2e.guardrail_shadow_report as mod

    monkeypatch.setattr(mod, "E2E_RUNLOGS", tmp_path)
    _write_run(tmp_path / "fixture-a", "run-2026-07-01_00-00-00.json", [])
    _write_run(tmp_path / "fixture-b", "run-2026-07-01_00-00-00.json", [])

    assert len(result_jsons_for("fixture-a")) == 1
    assert result_jsons_for("nonexistent-fixture") == []


# --- scan_one / scan_corpus ------------------------------------------------


def test_scan_one_finds_a_violation_and_tags_it_with_the_source_file(tmp_path, monkeypatch):
    import e2e.guardrail_shadow_report as mod

    monkeypatch.setattr(mod, "REPO_ROOT", tmp_path)
    path = _write_run(tmp_path / "eval" / "runlogs" / "e2e" / "fixture-a", "run-x.json", [_unguarded_write()])

    violations = scan_one(path, window=40)
    assert len(violations) == 1
    assert violations[0]["required_skill"] == "person-evidence"
    assert violations[0]["fixture"] == "fixture-a"
    assert "fixture-a" in violations[0]["file"]


def test_scan_one_finds_nothing_on_a_clean_run(tmp_path):
    path = _write_run(
        tmp_path,
        "run-x.json",
        [
            {"tool": "Skill", "args": {"skill": "person-evidence"}},
            _unguarded_write(),
        ],
    )
    assert scan_one(path, window=40) == []


def test_scan_corpus_aggregates_across_multiple_windows_and_files(tmp_path):
    p1 = _write_run(tmp_path / "f1", "run-x.json", [_unguarded_write()])
    p2 = _write_run(
        tmp_path / "f2",
        "run-y.json",
        [{"tool": "Skill", "args": {"skill": "person-evidence"}}] + [_unguarded_write()] * 2,
    )
    by_window = scan_corpus([p1, p2], windows=[1, 40])
    # window=1: the Skill call in p2 is only 1 call before the FIRST unguarded
    # write, not the second -> p2 contributes 1 violation; p1 contributes 1.
    assert len(by_window[1]) == 2
    # window=40: p2's Skill call covers both of its writes -> only p1's violation remains.
    assert len(by_window[40]) == 1


def test_scan_corpus_skips_unreadable_files_without_crashing(tmp_path, capsys):
    bad = tmp_path / "f1" / "run-bad.json"
    bad.parent.mkdir(parents=True)
    bad.write_text("not json")
    good = _write_run(tmp_path / "f2", "run-good.json", [_unguarded_write()])

    by_window = scan_corpus([bad, good], windows=[40])
    assert len(by_window[40]) == 1
    assert "skip" in capsys.readouterr().err


# --- formatting --------------------------------------------------------


def test_format_summary_reports_per_window_counts_and_skill_breakdown():
    by_window = {
        40: [
            {"required_skill": "person-evidence", "file": "a"},
            {"required_skill": "person-evidence", "file": "b"},
            {"required_skill": "proof-conclusion", "file": "a"},
        ]
    }
    out = format_summary(by_window, n_runs=2)
    assert "person-evidence=2" in out
    assert "proof-conclusion=1" in out


def test_format_summary_handles_a_window_with_no_violations():
    out = format_summary({40: []}, n_runs=5)
    assert "(none)" in out


def test_format_detail_lists_every_violation():
    violations = [
        {"fixture": "f1", "index": 3, "tool": "mcp__genealogy__research_append", "required_skill": "person-evidence", "question_id": None},
    ]
    out = format_detail(violations)
    assert "f1" in out and "person-evidence" in out


def test_format_detail_empty_list():
    assert "none" in format_detail([])

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
from pathlib import Path

from e2e.guardrail_shadow_report import (
    _is_result_json,
    all_result_jsons,
    format_citation_nulling,
    format_detail,
    format_summary,
    format_provenance,
    scan_citation_nulling,
    scan_corpus,
    scan_provenance,
    scan_one,
)
from harness.skill_invocation import CITATION_NULLING_KIND


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
    bad.write_text("not json", encoding="utf-8")
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


# --- scan_provenance / format_provenance (issue #963 stored shadow entries) ---
# These are READ from each run's stored `guardrail_shadow_violations`, not
# replayed from tool_calls: the #963 check depends on the seed tree and on what
# the live hook could see, neither of which a committed log lets you recompute.


def _write_result(dir_, name, violations):
    dir_.mkdir(parents=True, exist_ok=True)
    (dir_ / name).write_text(
        json.dumps({"tool_calls": [], "guardrail_shadow_violations": violations}),
        encoding="utf-8",
    )
    return dir_ / name


def _provenance_entry(pid="I1", index=3):
    return {
        "index": index,
        "tool": "research_append",
        "required_skill": "person-evidence",
        "question_id": None,
        "detail": f"person_evidence link written for new tree person(s) {pid} with no prior same_person",
    }


def test_scan_provenance_picks_up_stored_entries(tmp_path):
    p = _write_result(tmp_path / "fx", "run-1.json", [_provenance_entry()])
    out = scan_provenance([p])
    assert len(out) == 1
    assert out[0]["fixture"] == "fx"
    assert "I1" in out[0]["detail"]


def test_scan_provenance_ignores_section_7_entries():
    """The two sources share one list; only the hook's entries carry `detail`,
    so a §7 recency violation must not be counted as a #963 provenance gap."""
    import tempfile

    with tempfile.TemporaryDirectory() as td:
        d = Path(td) / "fx"
        section7 = {
            "index": 1,
            "tool": "mcp__genealogy__research_append",
            "required_skill": "proof-conclusion",
            "question_id": "q_001",
        }
        p = _write_result(d, "run-1.json", [section7, _provenance_entry()])
        out = scan_provenance([p])
    assert len(out) == 1
    assert out[0]["required_skill"] == "person-evidence"


def test_scan_provenance_tolerates_runs_written_before_the_check(tmp_path):
    """A pre-#963 log has no such entries; it contributes nothing rather than
    erroring."""
    p = _write_result(tmp_path / "fx", "run-1.json", [])
    assert scan_provenance([p]) == []


def test_scan_provenance_skips_unreadable_file(tmp_path, capsys):
    d = tmp_path / "fx"
    d.mkdir(parents=True, exist_ok=True)
    bad = d / "run-1.json"
    bad.write_text("{ not json", encoding="utf-8")
    assert scan_provenance([bad]) == []
    assert "skip" in capsys.readouterr().err


def test_format_provenance_counts_runs_not_just_entries(tmp_path):
    a = _write_result(tmp_path / "fx1", "run-1.json", [_provenance_entry("I1"), _provenance_entry("I2")])
    b = _write_result(tmp_path / "fx2", "run-1.json", [_provenance_entry("I3")])
    text = format_provenance(scan_provenance([a, b]))
    assert "3 person_evidence link(s)" in text
    assert "across 2 run(s)" in text


# --- scan_citation_nulling / format_citation_nulling (issue #1133) ------------
# The #1133 citation-nulling class ALSO carries `detail`, so it must be told
# apart from the #963 provenance gaps by its `kind` key — else the shadow
# fire-rate measurement the graduation decision is gated on double-counts.


def _citation_entry(sid="src_001"):
    return {
        "index": -1,
        "tool": "research.json",
        "required_skill": "citation",
        "question_id": "q_001",
        "kind": CITATION_NULLING_KIND,
        "detail": f"concluded source {sid} (via assertion a_001, proof_summary ps_001) has a null/empty citation string",
    }


def test_scan_citation_nulling_picks_up_only_citation_entries(tmp_path):
    p = _write_result(tmp_path / "fx", "run-1.json", [_provenance_entry(), _citation_entry()])
    out = scan_citation_nulling([p])
    assert len(out) == 1
    assert out[0]["kind"] == CITATION_NULLING_KIND
    assert out[0]["fixture"] == "fx"


def test_scan_provenance_excludes_citation_entries(tmp_path):
    """A citation-nulling entry carries `detail` too, but must NOT be counted as
    a #963 person_evidence-provenance gap."""
    p = _write_result(tmp_path / "fx", "run-1.json", [_provenance_entry(), _citation_entry()])
    prov = scan_provenance([p])
    assert len(prov) == 1
    assert prov[0]["required_skill"] == "person-evidence"


def test_format_citation_nulling_counts_runs_not_just_entries(tmp_path):
    a = _write_result(tmp_path / "fx1", "run-1.json", [_citation_entry("src_001"), _citation_entry("src_002")])
    b = _write_result(tmp_path / "fx2", "run-1.json", [_citation_entry("src_003")])
    text = format_citation_nulling(scan_citation_nulling([a, b]))
    assert "3 concluded source(s)" in text
    assert "across 2 run(s)" in text

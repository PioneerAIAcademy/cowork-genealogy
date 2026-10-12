"""`unit_pg_parity` (U15): a store fault in a live response is the finding and
fails the report; an outcome flip with none behind it is reported as wobble."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import unit_pg_parity


def _log(ts: str, tests: list[dict]) -> dict:
    return {"skill": "skill-a", "timestamp": ts, "tests": tests}


def _test(tid: str, outcome: str, response: object) -> dict:
    return {
        "test_id": tid,
        "outcome": outcome,
        "runs": [{"output": {"tool_calls": [
            {"tool": "mcp__genealogy__research_query", "matched": {"kind": "live"}, "response": response},
            {"tool": "mcp__genealogy__record_search", "matched": {"kind": "fixture", "index": 0},
             "response": {"error": "postgres would match here, but this call is a fixture"}},
        ]}}],
    }


def _write(root: Path, name: str, log: dict) -> None:
    d = root / "skill-a"
    d.mkdir(parents=True, exist_ok=True)
    (d / name).write_text(json.dumps(log), encoding="utf-8")


@pytest.fixture
def roots(tmp_path):
    pg, fs = tmp_path / "unit-pg", tmp_path / "unit"
    _write(fs, "v1_2026-10-01_00-00-00.json", _log("2026-10-01_00-00-00", [
        _test("t1", "pass", {"ok": True}), _test("t2", "pass", {"ok": True}),
    ]))
    return pg, fs


@pytest.mark.parametrize(
    "response",
    [
        {"ok": False, "errors": ["'results/x.json' does not exist in project h-abc-123"]},
        {"ok": False, "errors": ["ref '/w/results/.staging/x.json' escapes the project: it is an absolute path"]},
        {"ok": False, "errors": ["connect ECONNREFUSED 127.0.0.1:5434"]},
        {"ok": False, "errors": ["NoSuchKey: The specified key does not exist."]},
        "pg_store_prelude: PROTO_* store environment incomplete",
    ],
)
def test_a_store_fault_in_a_live_response_fails_and_is_named(roots, capsys, response):
    pg, fs = roots
    _write(pg, "scratch_2026-10-12_00-00-00.json", _log("2026-10-12_00-00-00", [
        _test("t1", "fail", response), _test("t2", "pass", {"ok": True}),
    ]))
    rc = unit_pg_parity.main(["--pg-root", str(pg), "--fs-root", str(fs)])
    out = capsys.readouterr().out
    assert rc == 1
    assert "STORE FAULT t1 research_query" in out
    assert "t1: pass → fail" in out
    assert "(no store fault)" not in out


def test_a_flip_with_no_fault_is_wobble_and_passes(roots, capsys):
    pg, fs = roots
    _write(pg, "scratch_2026-10-12_00-00-00.json", _log("2026-10-12_00-00-00", [
        _test("t1", "fail", {"ok": True, "persons": [{"id": "I1", "sourceRefs": ["S1", "S3"]}], "film": "S3TP-9"}), _test("t2", "pass", {"ok": True}),
    ]))
    rc = unit_pg_parity.main(["--pg-root", str(pg), "--fs-root", str(fs)])
    out = capsys.readouterr().out
    assert rc == 0
    assert "t1: pass → fail (no store fault)" in out
    assert "1 flip(s), 2 live call(s), 0 store fault(s)" in out


def test_a_node_timeout_is_reported(roots, capsys):
    pg, fs = roots
    _write(pg, "scratch_2026-10-12_00-00-00.json", _log("2026-10-12_00-00-00", [
        _test("t1", "pass", {"ok": False, "errors": ["Command '['node']' timed out after 60 seconds"]}),
    ]))
    unit_pg_parity.main(["--pg-root", str(pg), "--fs-root", str(fs)])
    assert "node timeout t1 research_query" in capsys.readouterr().out


def test_no_pg_logs_is_an_error(tmp_path, capsys):
    assert unit_pg_parity.main(["--pg-root", str(tmp_path / "none"), "--fs-root", str(tmp_path)]) == 2


def test_results_across_several_pg_logs_merge_newest_wins(roots, capsys):
    pg, fs = roots
    _write(pg, "scratch_2026-10-12_00-00-00.json", _log("2026-10-12_00-00-00", [_test("t1", "fail", {"ok": True})]))
    _write(pg, "scratch_2026-10-12_01-00-00.json", _log("2026-10-12_01-00-00", [
        _test("t1", "pass", {"ok": True}), _test("t2", "pass", {"ok": True}),
    ]))
    assert unit_pg_parity.main(["--pg-root", str(pg), "--fs-root", str(fs)]) == 0
    out = capsys.readouterr().out
    assert "2/2 pass on pg, 2 shared, 0 flip(s)" in out
    assert "scratch_2026-10-12_00-00-00.json, scratch_2026-10-12_01-00-00.json" in out


def test_a_pg_store_fault_warning_fails_the_report(roots, capsys):
    """A fault the mock-side pipelines swallowed reaches the run log only as a
    warning; the report must count it, not call the flip wobble."""
    pg, fs = roots
    t1 = _test("t1", "fail", {"ok": True})
    t1["runs"][0]["output"]["warnings"] = [
        {"kind": "pg_store_fault", "advisory": "x", "faults": [{"op": "writeBytes", "message": "NoSuchBucket"}]}
    ]
    _write(pg, "scratch_2026-10-12_00-00-00.json", _log("2026-10-12_00-00-00", [t1, _test("t2", "pass", {"ok": True})]))
    assert unit_pg_parity.main(["--pg-root", str(pg), "--fs-root", str(fs)]) == 1
    out = capsys.readouterr().out
    assert "STORE FAULT t1 writeBytes (recorded by the prelude): NoSuchBucket" in out
    assert "(no store fault)" not in out

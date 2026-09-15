"""The end-of-run count line for `blocked_context_calls` (issue #1281).

PR #1196 writes the array into every run log and the per-deny lines stream
during the run, but the end-of-run summary never mentioned it, so a reader who
scrolled past the stream saw nothing. This pins the line that fixes that.

The array is NOT a gate: `result.compliance` is derived from
`guardrail_bypass_violations` alone and stays that way. Case 3 below is what
holds the two axes apart.
"""

from __future__ import annotations

import asyncio

import pytest
from e2e import run_e2e
from e2e.result import E2eResult


def _result(*, compliance_violations: list[str], blocked: int) -> E2eResult:
    return E2eResult(
        test_id="fx",
        captured_at="2026-09-14_10-00-00",
        verdict="pass",
        stop_reason="completed",
        guardrail_bypass_violations=list(compliance_violations),
        blocked_context_calls=[
            {"tool": "research_append", "args": {}, "blocked_by": "context"}
            for _ in range(blocked)
        ],
    )


def _summary_for(monkeypatch, tmp_path, capsys, result: E2eResult) -> str:
    """Drive the real `_run_one` and return what it printed.

    Deliberately NOT a direct call to the print helper. The helper never reads
    `result.compliance`, so calling it straight would behave identically whether
    it is wired at the call site or back inside `_print_compliance` — which is
    the bug case 3 exists to catch.
    """
    paths = {"result": tmp_path / "run.json", "transcript": tmp_path / "t.md"}

    async def _fake(**kwargs):
        return result, paths

    monkeypatch.setattr(run_e2e, "run_e2e_test", _fake)
    asyncio.run(run_e2e._run_one(tmp_path))
    return capsys.readouterr().out


def test_summary_counts_the_blocked_context_calls(monkeypatch, tmp_path, capsys):
    out = _summary_for(
        monkeypatch, tmp_path, capsys,
        _result(compliance_violations=["skipped a guardrail"], blocked=2),
    )
    assert "[blocked context call] 2" in out


def test_summary_stays_silent_when_there_are_none(monkeypatch, tmp_path, capsys):
    """No zero-line.

    146 of the 172 committed runs predate the field and cannot carry it, so a
    printed `0` would read as a measured zero rather than a structural one.
    """
    out = _summary_for(
        monkeypatch, tmp_path, capsys,
        _result(compliance_violations=["skipped a guardrail"], blocked=0),
    )
    assert "blocked context call" not in out


def test_summary_counts_them_on_a_compliance_pass_run(monkeypatch, tmp_path, capsys):
    """The case the corpus cannot supply.

    `_print_compliance` returns early on the pass branch, so a count line added
    inside it is unreachable exactly here. All five carrier runs in the corpus
    are `compliance: fail`, so a fixture built from real data would land on the
    fail branch and never exercise this.
    """
    out = _summary_for(
        monkeypatch, tmp_path, capsys,
        _result(compliance_violations=[], blocked=1),
    )
    assert "compliance: pass" in out
    assert "[blocked context call] 1" in out

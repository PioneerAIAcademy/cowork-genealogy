"""Unit tests for the orchestrator's judge-failure branch (#1023).

`test_e2e_result.py` covers what `result.py` *does* with an `ungraded` verdict —
that it is committable, that `runlog_prefix` gives it `run-`, that its outcome
derives correctly. Nothing covered the line that *produces* it. Swapping
`orchestrator.py`'s `verdict = "ungraded"` back to `"fail"` left the whole suite
green, which is the one regression this change exists to prevent.

These drive the real `run_e2e_test` with the agent, the workspace and the judge
stubbed, so the assertion is on the orchestrator's own three-way distinction:

- judge raised      → `ungraded` (tree exists, never graded → committed, re-gradable)
- judge returned    → the judge's verdict (committed)
- no tree at all    → `skipped` (nothing to grade → gitignored scratch run)

The middle and last cases are controls: without them a mutation that hardcodes
`ungraded` for every run would pass the first assertion alone.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from e2e import judge as judge_module
from e2e import orchestrator
from e2e.orchestrator import load_fixture, run_e2e_test


def _fixture(tmp_path: Path):
    """A minimal valid fixture on disk, loaded via the real `load_fixture`."""
    fixture_dir = tmp_path / "fx"
    fixture_dir.mkdir()
    (fixture_dir / "fixture.json").write_text(
        json.dumps(
            {
                "id": "fx",
                "name": "fx",
                "source_pid": "ABCD-123",
                "captured": "2026-05-26",
                "researcher_question": "Who were John's parents?",
                "tags": {"question_type": "parents", "era": "1850s", "geography": "US-VA"},
                "model": {"agent": "claude-sonnet-4-6", "judge": "claude-haiku-4-5-20251001"},
                "caps": {},
            }
        ),
        encoding="utf-8",
    )
    (fixture_dir / "starting-research.json").write_text(
        json.dumps({"project": {"objective": "x"}}), encoding="utf-8"
    )
    (fixture_dir / "starting-tree.gedcomx.json").write_text(
        json.dumps({"persons": []}), encoding="utf-8"
    )
    (fixture_dir / "expected-findings.json").write_text(
        json.dumps({"findings": []}), encoding="utf-8"
    )
    return load_fixture(fixture_dir)


def _drive(tmp_path, monkeypatch, *, judge, final_tree):
    """Run `run_e2e_test` with everything but the judge branch stubbed out.

    `judge` is installed as `judge_module.run_judge` — pass a callable that
    raises to exercise the failure branch. `final_tree` of None is the treeless
    (agent-crashed) case the `skipped` verdict exists for.
    """
    fixture = _fixture(tmp_path)
    workspace = tmp_path / "ws"
    workspace.mkdir()
    entry = tmp_path / "index.js"  # only `.exists()` is checked
    entry.write_text("", encoding="utf-8")

    async def fake_run_agent(**kwargs):
        # (tool_calls, narration, usage, aborted, error, blocked_tree_reads,
        #  blocked_context_calls, guardrail_shadow_violations,
        #  unnamed_delegate_violations)
        return ([], [], {}, None, None, [], [], [], [])

    monkeypatch.setattr(orchestrator, "load_fixture", lambda _dir: fixture)
    monkeypatch.setattr(orchestrator, "build_workspace", lambda *a, **k: workspace)
    monkeypatch.setattr(orchestrator, "_run_agent", fake_run_agent)
    monkeypatch.setattr(orchestrator, "read_research_json", lambda _ws: {"project": {}})
    monkeypatch.setattr(orchestrator, "read_tree_json", lambda _ws: final_tree)
    monkeypatch.setattr(orchestrator, "check_guardrail_compliance", lambda *a, **k: [])
    monkeypatch.setattr(orchestrator, "collect_subagents", lambda _ws: [])
    monkeypatch.setattr(orchestrator, "_find_session_transcript", lambda _ws: None)
    monkeypatch.setattr(judge_module, "run_judge", judge)

    return asyncio.run(
        run_e2e_test(
            fixture_dir=tmp_path / "fx",
            runlog_root=tmp_path / "runlogs",
            mcp_server_entry=entry,
        )
    )


def test_judge_exception_yields_ungraded_and_commits_the_run(tmp_path, monkeypatch):
    """The line this whole change is about: a judge crash must not discard a
    run that produced a tree."""

    def boom(**kwargs):
        raise RuntimeError("submit_grading.dimensions is not a list")

    result, paths = _drive(tmp_path, monkeypatch, judge=boom, final_tree={"persons": []})

    assert result.verdict == "ungraded"
    assert result.judge_output["error"].startswith("RuntimeError:")
    # Committed, not scratch — the tree survives for /grade-e2e-run.
    assert paths["result"].name.startswith("run-")


def test_successful_judge_verdict_passes_through(tmp_path, monkeypatch):
    """Control: the except branch must not swallow a successful grading."""
    result, _ = _drive(
        tmp_path,
        monkeypatch,
        judge=lambda **kwargs: {"verdict": "partial", "per_finding": {}},
        final_tree={"persons": []},
    )

    assert result.verdict == "partial"


def test_no_final_tree_stays_skipped_and_scratch(tmp_path, monkeypatch):
    """Control: `ungraded` must not swallow `skipped`. No tree means nothing to
    grade or re-grade, so the run stays gitignored."""

    def never_called(**kwargs):  # pragma: no cover - asserts it is not reached
        raise AssertionError("the judge must not run without a final tree")

    result, paths = _drive(tmp_path, monkeypatch, judge=never_called, final_tree=None)

    assert result.verdict == "skipped"
    assert paths["result"].name.startswith("scratch_")

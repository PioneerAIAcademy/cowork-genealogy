"""Unit tests for e2e.rule_adherence_report — per-instruction adherence.

Tests both directions, as the issue requires:

**Accept (hand-built fixtures whose ground truth is the author's):**
- project_context via capture blocks scores as obeyed
- project_context via tool_calls (mcp__genealogy__ spelling) scores as obeyed
- A pre-rule run leaves the denominator
- A different agent leaves the denominator

**Break:**
- Removing a project_context block drops obeyed by 1, denominator unchanged
- Zero episodes exits non-zero
- Stale instruction exits non-zero
- Unobservable tool exits non-zero
- Unobservable pattern exits non-zero
"""

from __future__ import annotations

import json
import shutil
from datetime import date
from pathlib import Path
from unittest.mock import patch

import pytest

from e2e.rule_adherence_report import (
    AdherenceRule,
    RuleResult,
    _introduced_date_cache,
    check_results,
    check_stale_rules,
    format_report,
    is_post_rule,
    main,
    scan_rules,
)

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures" / "rule_adherence"

# The introduced commit (09c8195d3) has date 2026-07-31.  Post-rule fixture
# filenames use 2026-08-15; pre-rule ones use 2026-07-01.
INTRODUCED_DATE = date(2026, 7, 31)


# ── helpers ────────────────────────────────────────────────────────────────


def _write(dir_: Path, name: str, payload: dict) -> Path:
    path = dir_ / name
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def _capture(agent_type: str, tools: list[str]) -> dict:
    """A ``subagents[]`` entry that called ``tools`` (each as one turn block)."""
    return {
        "agent_type": agent_type,
        "turns": [{"blocks": [f"tool_use:{t}" for t in tools]}],
    }


def _make_rule(
    *,
    id: str = "test-rule",
    file: str = "packages/engine/plugin/agents/gps-mentor.md",
    instruction: str = "Open every invocation with:",
    introduced: str = "09c8195d3",
    agent: str = "gps-mentor",
    enumerate_episodes=None,
    is_obeyed=None,
    observable_tool: str | None = "project_context",
    observable_pattern: str | None = None,
) -> AdherenceRule:
    """Build a rule with sensible defaults, overridable for each test."""
    from e2e.rule_adherence_report import (
        _capture_called_project_context,
        _gps_mentor_tool_using_captures,
    )

    return AdherenceRule(
        id=id,
        file=file,
        instruction=instruction,
        introduced=introduced,
        agent=agent,
        enumerate_episodes=enumerate_episodes or _gps_mentor_tool_using_captures,
        is_obeyed=is_obeyed or _capture_called_project_context,
        observable_tool=observable_tool,
        observable_pattern=observable_pattern,
    )


def _patch_introduced(d: date = INTRODUCED_DATE):
    """Patch ``_introduced_date`` so tests use the filename-date path."""
    return patch("e2e.rule_adherence_report._introduced_date", return_value=d)


# ── accept direction: hand-built fixtures prove correct scoring ────────────


def test_capture_with_project_context_in_blocks_scores_obeyed(tmp_path: Path):
    """project_context reached as bare ``tool_use:project_context`` in
    subagents[].turns[].blocks must score as obeyed."""
    src = FIXTURES / "post_rule_obeyed_capture.json"
    dest = tmp_path / "run-2026-08-15_10-00-00.json"
    shutil.copy(src, dest)

    rule = _make_rule()

    with _patch_introduced():
        _introduced_date_cache.clear()
        results, problems = scan_rules([dest], [rule])

    assert not problems
    r = results[0]
    assert r.episodes == 1
    assert r.obeyed == 1
    assert r.not_obeyed == 0


def test_capture_with_project_context_in_toolcalls_scores_obeyed(tmp_path: Path):
    """project_context reached as ``mcp__genealogy__project_context`` inside
    tool_calls[] must also score as obeyed — the capture's own blocks do NOT
    have it."""
    src = FIXTURES / "post_rule_obeyed_toolcalls.json"
    dest = tmp_path / "run-2026-08-15_10-00-00.json"
    shutil.copy(src, dest)

    rule = _make_rule()

    with _patch_introduced():
        _introduced_date_cache.clear()
        results, _ = scan_rules([dest], [rule])

    r = results[0]
    assert r.episodes == 1
    assert r.obeyed == 1, "tool_calls attribution must count as obeyed"


def test_pre_rule_run_leaves_denominator(tmp_path: Path):
    """A run dated before the introduced commit leaves the denominator —
    it is not an episode of the rule and never counts as a miss."""
    src = FIXTURES / "pre_rule_run.json"
    dest = tmp_path / "run-2026-07-01_10-00-00.json"
    shutil.copy(src, dest)

    rule = _make_rule()

    with _patch_introduced():
        _introduced_date_cache.clear()
        results, _ = scan_rules([dest], [rule])

    r = results[0]
    assert r.episodes == 0
    assert r.pre_rule_excluded == 1


def test_different_agent_leaves_denominator(tmp_path: Path):
    """A capture by a different agent (record-extractor) is not an episode
    of a gps-mentor rule."""
    _write(
        tmp_path,
        "run-2026-08-15_10-00-00.json",
        {
            "subagents": [_capture("record-extractor", ["record_read"])],
            "tool_calls": [],
        },
    )

    rule = _make_rule()

    with _patch_introduced():
        _introduced_date_cache.clear()
        results, _ = scan_rules(
            [tmp_path / "run-2026-08-15_10-00-00.json"], [rule]
        )

    r = results[0]
    assert r.episodes == 0
    # The run IS post-rule (dated 2026-08-15 > 2026-07-31), but a
    # record-extractor capture is not an episode of a gps-mentor rule.
    assert r.pre_rule_excluded == 0


# ── break direction: each check must fail loudly ───────────────────────────


def test_removing_project_context_block_drops_obeyed_not_denominator(
    tmp_path: Path,
):
    """Delete the tool_use:project_context block — obeyed drops by 1,
    denominator does not move."""
    # Run WITH project_context
    with_pc = _write(
        tmp_path,
        "run-2026-08-15_10-00-00.json",
        {
            "subagents": [
                _capture("gps-mentor", ["project_context", "research_query"])
            ],
            "tool_calls": [],
        },
    )
    # Run WITHOUT project_context (same structure, tool removed)
    without_pc = _write(
        tmp_path,
        "run-2026-08-16_10-00-00.json",
        {
            "subagents": [_capture("gps-mentor", ["research_query"])],
            "tool_calls": [],
        },
    )

    rule = _make_rule()

    with _patch_introduced():
        _introduced_date_cache.clear()
        results_both, _ = scan_rules([with_pc, without_pc], [rule])

    r = results_both[0]
    assert r.episodes == 2  # both are episodes
    assert r.obeyed == 1  # only the one with project_context
    assert r.not_obeyed == 1

    # Now scan with only the one where we "deleted" project_context
    with _patch_introduced():
        _introduced_date_cache.clear()
        results_without, _ = scan_rules([without_pc], [rule])

    r2 = results_without[0]
    assert r2.episodes == 1  # denominator unchanged for this run
    assert r2.obeyed == 0  # obeyed drops


def test_zero_episodes_exits_nonzero(tmp_path: Path):
    """A misspelled agent name or too-new introduced commit -> zero denominator
    -> the report must exit non-zero, never print a clean zero."""
    _write(
        tmp_path,
        "run-2026-08-15_10-00-00.json",
        {
            "subagents": [_capture("gps-mentor", ["research_query"])],
            "tool_calls": [],
        },
    )

    # Rule with misspelled agent — no episodes will be found
    def _no_episodes(run_data: dict) -> list[dict]:
        return []  # simulates misspelled agent

    rule = _make_rule(
        enumerate_episodes=_no_episodes,
        observable_tool=None,  # don't trigger observable check
    )

    with _patch_introduced():
        _introduced_date_cache.clear()
        results, _ = scan_rules(
            [tmp_path / "run-2026-08-15_10-00-00.json"], [rule]
        )

    errors = check_results([rule], results)
    assert any("zero episodes" in e for e in errors)


def test_stale_instruction_exits_nonzero():
    """Editing the quoted instruction so it no longer matches the file must
    fail with 'stale rule'."""
    rule = _make_rule(instruction="This text is NOT in gps-mentor.md")
    errors = check_stale_rules([rule])
    assert len(errors) == 1
    assert "stale rule" in errors[0]
    assert rule.id in errors[0]


def test_unobservable_tool_exits_nonzero(tmp_path: Path):
    """If observable_tool names a tool that appears nowhere in the corpus,
    fail with 'rule unobservable'."""
    _write(
        tmp_path,
        "run-2026-08-15_10-00-00.json",
        {
            "subagents": [_capture("gps-mentor", ["research_query"])],
            "tool_calls": [],
        },
    )

    rule = _make_rule(observable_tool="misspelled_project_contex")

    with _patch_introduced():
        _introduced_date_cache.clear()
        results, _ = scan_rules(
            [tmp_path / "run-2026-08-15_10-00-00.json"], [rule]
        )

    errors = check_results([rule], results)
    assert any("rule unobservable" in e for e in errors)
    assert any("misspelled_project_contex" in e for e in errors)


def test_unobservable_pattern_exits_nonzero(tmp_path: Path):
    """If observable_pattern names a string that appears in no episode's args,
    fail with 'rule unobservable'. This catches a misspelled args pattern
    in the obeyed predicate for rule 2."""
    _write(
        tmp_path,
        "run-2026-08-15_10-00-00.json",
        {
            "subagents": [],
            "tool_calls": [
                {
                    "tool": "Read",
                    "agent_type": "gps-mentor",
                    "args": {"file_path": "/tmp/project/tree.gedcomx.json"},
                }
            ],
        },
    )

    from e2e.rule_adherence_report import (
        _gps_mentor_read_calls,
        _read_does_not_open_research_json,
    )

    rule = _make_rule(
        id="test-read-rule",
        instruction="**Do not open `research.json`.**",
        enumerate_episodes=_gps_mentor_read_calls,
        is_obeyed=_read_does_not_open_research_json,
        observable_tool=None,
        # Misspelled pattern — won't appear in args
        observable_pattern="reserach.json",
    )

    with _patch_introduced():
        _introduced_date_cache.clear()
        results, _ = scan_rules(
            [tmp_path / "run-2026-08-15_10-00-00.json"], [rule]
        )

    errors = check_results([rule], results)
    assert any("rule unobservable" in e for e in errors)
    assert any("reserach.json" in e for e in errors)


# ── rule-presence dating ───────────────────────────────────────────────────


def test_git_sha_ancestry_determines_post_rule(tmp_path: Path):
    """When a run has git_sha and git succeeds, the ancestry check is used."""
    rule = _make_rule()
    run_data = {"git_sha": "abc123"}
    run_path = tmp_path / "run-2026-08-15_10-00-00.json"

    with patch("e2e.rule_adherence_report._is_ancestor", return_value=True):
        post, method = is_post_rule(rule, run_data, run_path)
    assert post is True
    assert method == "git_sha"

    with patch("e2e.rule_adherence_report._is_ancestor", return_value=False):
        post, method = is_post_rule(rule, run_data, run_path)
    assert post is False
    assert method == "git_sha"


def test_filename_date_fallback_when_no_git_sha(tmp_path: Path):
    """When no git_sha, fall back to filename date vs introduced commit date."""
    rule = _make_rule()
    run_data = {}  # no git_sha
    post_rule_path = tmp_path / "run-2026-08-15_10-00-00.json"
    pre_rule_path = tmp_path / "run-2026-07-01_10-00-00.json"

    with _patch_introduced():
        _introduced_date_cache.clear()
        post, method = is_post_rule(rule, run_data, post_rule_path)
        assert post is True
        assert method == "filename_date"

        post, method = is_post_rule(rule, run_data, pre_rule_path)
        assert post is False
        assert method == "filename_date"


def test_dating_method_counts_reported(tmp_path: Path):
    """The report shows how many episodes were dated by each method."""
    _write(
        tmp_path,
        "run-2026-08-15_10-00-00.json",
        {
            "subagents": [
                _capture("gps-mentor", ["project_context", "research_query"])
            ],
            "tool_calls": [],
        },
    )
    _write(
        tmp_path,
        "run-2026-08-16_10-00-00.json",
        {
            "subagents": [
                _capture("gps-mentor", ["project_context"])
            ],
            "tool_calls": [],
        },
    )

    rule = _make_rule()
    paths = [
        tmp_path / "run-2026-08-15_10-00-00.json",
        tmp_path / "run-2026-08-16_10-00-00.json",
    ]

    with _patch_introduced():
        _introduced_date_cache.clear()
        results, _ = scan_rules(paths, [rule])

    r = results[0]
    assert r.dated_by_filename == 2
    assert r.dated_by_sha == 0

    report = format_report([rule], results)
    assert "by filename: 2" in report


# ── Read-call rule (rule 2) ────────────────────────────────────────────────


def test_read_of_research_json_is_not_obeyed(tmp_path: Path):
    """Rule 2: a Read call to research.json is NOT obeyed."""
    from e2e.rule_adherence_report import (
        _gps_mentor_read_calls,
        _read_does_not_open_research_json,
    )

    _write(
        tmp_path,
        "run-2026-08-15_10-00-00.json",
        {
            "subagents": [],
            "tool_calls": [
                {
                    "tool": "Read",
                    "agent_type": "gps-mentor",
                    "args": {"file_path": "/tmp/project/research.json"},
                }
            ],
        },
    )

    rule = _make_rule(
        id="test-read-rule",
        instruction="**Do not open `research.json`.**",
        enumerate_episodes=_gps_mentor_read_calls,
        is_obeyed=_read_does_not_open_research_json,
        observable_tool=None,
        observable_pattern="research.json",
    )

    with _patch_introduced():
        _introduced_date_cache.clear()
        results, _ = scan_rules(
            [tmp_path / "run-2026-08-15_10-00-00.json"], [rule]
        )

    r = results[0]
    assert r.episodes == 1
    assert r.obeyed == 0
    assert r.not_obeyed == 1


def test_read_of_other_file_is_obeyed(tmp_path: Path):
    """Rule 2: a Read call to a file other than research.json IS obeyed."""
    from e2e.rule_adherence_report import (
        _gps_mentor_read_calls,
        _read_does_not_open_research_json,
    )

    _write(
        tmp_path,
        "run-2026-08-15_10-00-00.json",
        {
            "subagents": [],
            "tool_calls": [
                {
                    "tool": "Read",
                    "agent_type": "gps-mentor",
                    "args": {"file_path": "/tmp/project/tree.gedcomx.json"},
                }
            ],
        },
    )

    rule = _make_rule(
        id="test-read-rule",
        instruction="**Do not open `research.json`.**",
        enumerate_episodes=_gps_mentor_read_calls,
        is_obeyed=_read_does_not_open_research_json,
        observable_tool=None,
        observable_pattern=None,  # no pattern check for this test
    )

    with _patch_introduced():
        _introduced_date_cache.clear()
        results, _ = scan_rules(
            [tmp_path / "run-2026-08-15_10-00-00.json"], [rule]
        )

    r = results[0]
    assert r.episodes == 1
    assert r.obeyed == 1
    assert r.not_obeyed == 0


# ── CLI integration ────────────────────────────────────────────────────────


def test_main_unknown_rule_exits_nonzero(capsys):
    assert main(["--rule", "nonexistent-rule", "--since", "all"]) == 1
    assert "Unknown rule" in capsys.readouterr().err

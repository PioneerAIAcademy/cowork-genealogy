"""`check_tool_coverage`'s reverse arm and `execution.run_agents` (#3568).

A test that runs an agent live must stock fixtures for that agent's tools —
runnability.py refuses it otherwise — so a fixture for a tool the agent declares
is not a gap in the skill's `allowed-tools`. Before this, the reverse arm told
the author to delete exactly the fixtures the gate requires.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

REPO = next(
    q for q in Path(__file__).resolve().parents
    if (q / "eval/harness/scripts/check_tool_coverage.py").is_file()
)
_spec = importlib.util.spec_from_file_location(
    "check_tool_coverage", REPO / "eval/harness/scripts/check_tool_coverage.py"
)
check_tool_coverage = importlib.util.module_from_spec(_spec)
sys.modules["check_tool_coverage"] = check_tool_coverage
_spec.loader.exec_module(check_tool_coverage)


def _reverse_warnings(capsys) -> list[str]:
    check_tool_coverage.main()
    captured = capsys.readouterr()
    return [line for line in (captured.out + captured.err).splitlines() if "references an mcp_fixture" in line]


def test_an_opted_in_agents_fixtures_raise_no_reverse_warning(capsys):
    """The real corpus: ut_research_rpn runs research-plan and question-selection,
    and 016/017 run search-images. None of their catch-all fixtures is a gap."""
    offending = [
        line for line in _reverse_warnings(capsys)
        if any(name in line for name in (
            "handle-negative-probate-result.json",
            "negative-indexed-search.json",
            "negative-research-plan.json",
            "negative-next-question.json",
            "negative-research-plan-exhaustiveness.json",
        ))
    ]
    assert not offending, "a run_agents agent's fixture was reported as a gap:\n  " + "\n  ".join(offending)


def test_a_fixture_no_skill_or_opted_in_agent_declares_still_warns(capsys):
    """The other direction: the exemption must not swallow the arm. research's
    attached-before-searching runs no agent and stocks a record_search fixture
    research does not declare."""
    warnings = _reverse_warnings(capsys)
    assert any(
        "attached-before-searching.json" in line and "`record_search`" in line for line in warnings
    ), "the reverse arm stopped reporting a fixture nothing declares"


def test_an_agents_tools_block_is_read_past_its_opening_comment(tmp_path):
    """Every shipped agent opens `tools:` with a comment naming the three
    spellings; stopping at it read search-images as declaring nothing."""
    agent = tmp_path / "a.md"
    agent.write_text(
        "---\nname: a\ntools:\n  # three spellings\n  - Read\n"
        "  - mcp__genealogy__image_search\n  # trailing note\n  - mcp__genealogy__volume_search\n"
        "model: x\n---\nbody\n",
        encoding="utf-8",
    )
    assert check_tool_coverage.declared_tools(agent, key="tools") == ["Read", "image_search", "volume_search"]


def test_a_real_agent_declares_the_tools_its_opt_in_test_stocks():
    assert {"image_search", "image_transcribe", "volume_search"} <= set(
        check_tool_coverage.declared_tools(
            REPO / "packages/engine/plugin/agents/search-images.md", key="tools"
        )
    )

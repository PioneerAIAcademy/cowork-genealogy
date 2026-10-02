"""Direct tests for project-status's validators.

Same reason as the sibling `test_*_validators.py` files: `pyproject.toml` sets
`testpaths = ["tests"]`, so nothing under `validators/` is collected on its own.
"""

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

# Aliased away from the `test_` prefix so pytest does not collect it here.
from test_project_status import test_no_mcp_tools_called as check_read_only  # noqa: E402


def _calls(*tools: str) -> list[dict]:
    return [{"tool": t} for t in tools]


@pytest.mark.parametrize("tools", [
    # The real ut_project_status_003 run, 2026-10-02: read-only state queries.
    ("mcp__genealogy__project_context", "mcp__genealogy__research_query"),
    ("mcp__remote-devices__Genealogy_Research__research_query",),
    ("mcp__genealogy__validate_research_schema",),
    (),
])
def test_read_only_state_tools_are_allowed(tools):
    check_read_only(_calls(*tools))


@pytest.mark.parametrize("tools", [
    ("mcp__genealogy__research_query", "mcp__genealogy__research_append"),
    ("mcp__genealogy__tree_edit",),
    ("mcp__genealogy__record_search",),
    ("mcp__genealogy__brand_new_tool",),  # an allowlist fails closed
])
def test_writers_searches_and_unknown_tools_fail(tools):
    with pytest.raises(AssertionError, match="may only read project state"):
        check_read_only(_calls(*tools))

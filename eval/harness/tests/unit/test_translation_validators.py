"""`test_only_logs_translation` allows the Narration `project_context` read and
still bans every other MCP tool."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "validators"))

from test_translation import test_only_logs_translation as check_only_logs  # noqa: E402


def _call(name):
    return {"tool": f"mcp__genealogy__{name}", "args": {}}


def test_project_context_is_allowed_beside_the_log_append():
    check_only_logs([_call("project_context"), _call("research_log_append")], {"type": "positive"})


def test_any_other_tool_still_fires():
    with pytest.raises(AssertionError, match="no MCP tool other than"):
        check_only_logs([_call("project_context"), _call("tree_query")], {"type": "positive"})

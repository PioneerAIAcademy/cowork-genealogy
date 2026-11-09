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


def test_upload_readers_are_allowed():
    check_only_logs(
        [_call("project_context"), _call("image_transcribe"), _call("sidecar_read"), _call("research_log_append")],
        {"type": "positive"},
    )


# --- reads-upload (issue #4311) ----------------------------------------------

from test_translation import test_upload_read_through_tools as check_upload  # noqa: E402

_UPLOAD = {"type": "positive", "tags": ["reads-upload"]}


def _mcp(name, **args):
    return {"tool": f"mcp__remote-devices__Genealogy_Research__{name}", "args": args}


_TRANSCRIBE = _mcp("image_transcribe", projectPath="/p", file="uploads/scan.jpg")


def test_upload_read_through_both_tools_passes():
    check_upload([_TRANSCRIBE, _mcp("sidecar_read", projectPath="/p", ref="results/.staging/a.json")], [], _UPLOAD)


def test_upload_read_with_refs_list_passes():
    check_upload([_TRANSCRIBE, _mcp("sidecar_read", projectPath="/p", refs=["results/.staging/a.json"])], [], _UPLOAD)


def test_digest_only_fires():
    with pytest.raises(AssertionError, match="never read with sidecar_read"):
        check_upload([_TRANSCRIBE], [], _UPLOAD)


def test_no_transcribe_fires():
    with pytest.raises(AssertionError, match="never transcribed"):
        check_upload([_mcp("sidecar_read", ref="results/.staging/a.json")], [], _UPLOAD)


def test_agent_read_of_upload_fires():
    read = {"tool": "Read", "args": {"file_path": "/p/uploads/scan.jpg"}, "agent_id": "a1"}
    with pytest.raises(AssertionError, match="used Read"):
        check_upload([_TRANSCRIBE, _mcp("sidecar_read", ref="results/.staging/a.json")], [read], _UPLOAD)


def test_untagged_test_skips():
    with pytest.raises(pytest.skip.Exception):
        check_upload([], [], {"type": "positive", "tags": []})

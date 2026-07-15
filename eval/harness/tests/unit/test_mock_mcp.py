"""Tests for harness.mock_mcp — in-process MCP fixture server.

These tests exercise the handler logic directly (bypassing the SDK) so they
stay fast and don't require network. Real SDK integration is covered by the
e2e test.
"""

import asyncio
import json
import tempfile
from pathlib import Path

import pytest

from harness.fixtures import InvalidFixtureError
from harness.mock_mcp import create_mock_server


REPO_ROOT = Path(__file__).resolve().parents[4]
FIXTURES_DIR = REPO_ROOT / "eval/fixtures/mcp"


def _extract_response_dict(handler_result):
    """The mock handler returns {'content': [{'type':'text','text': '<json>'}]}."""
    return json.loads(handler_result["content"][0]["text"])


def _invoke(tools_by_name, tool_name: str, args: dict):
    """Invoke a mock tool handler directly, bypassing the SDK transport."""
    return asyncio.run(tools_by_name[tool_name].handler(args))


def test_returns_fixture_response_for_known_tool():
    server, call_log, tools_by_name = create_mock_server(
        ["wikipedia-search-schuylkill-county"], FIXTURES_DIR
    )
    result = _invoke(tools_by_name, "wikipedia_search", {"query": "Schuylkill County"})
    body = _extract_response_dict(result)
    assert body["title"] == "Schuylkill County, Pennsylvania"
    assert call_log[0]["tool"] == "mcp__genealogy__wikipedia_search"
    assert call_log[0]["matched"]["kind"] == "predicate"
    assert call_log[0]["response_fixture"] == "wikipedia-search-schuylkill-county"
    # expected_args carries the matched fixture's args block.
    assert call_log[0]["expected_args"] == {"query": "~Schuylkill"}


def test_only_registers_tools_for_loaded_fixtures():
    server, call_log, tools_by_name = create_mock_server(
        ["wikipedia-search-schuylkill-county"], FIXTURES_DIR
    )
    # Live tools (e.g. validate_research_schema) are always registered
    # regardless of fixture_names, so subtract LIVE_TOOLS before asserting.
    from harness.mock_mcp import LIVE_TOOLS
    fixture_backed = set(tools_by_name.keys()) - LIVE_TOOLS
    assert fixture_backed == {"wikipedia_search"}


def test_predicate_match_dispatches_to_matching_fixture():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        (tmp / "ohio.json").write_text(json.dumps({
            "tool": "record_search",
            "args": {"args.q": "Ohio"},
            "response": {"hits": "ohio-fixture"},
        }))
        (tmp / "iowa.json").write_text(json.dumps({
            "tool": "record_search",
            "args": {"args.q": "Iowa"},
            "response": {"hits": "iowa-fixture"},
        }))
        server, call_log, tools_by_name = create_mock_server(
            ["ohio", "iowa"], tmp
        )
        result = _invoke(tools_by_name, "record_search", {"q": "Ohio"})
        body = _extract_response_dict(result)
        assert body["hits"] == "ohio-fixture"
        assert call_log[0]["matched"]["kind"] == "predicate"
        assert call_log[0]["expected_args"] == {"args.q": "Ohio"}

        result2 = _invoke(tools_by_name, "record_search", {"q": "Iowa"})
        body2 = _extract_response_dict(result2)
        assert body2["hits"] == "iowa-fixture"
        assert call_log[1]["expected_args"] == {"args.q": "Iowa"}


def test_unmatched_call_returns_fixture_not_found_error():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        (tmp / "only.json").write_text(json.dumps({
            "tool": "record_search",
            "args": {"args.q": "Ohio"},
            "response": {"hits": "ohio"},
        }))
        server, call_log, tools_by_name = create_mock_server(["only"], tmp)
        result = _invoke(tools_by_name, "record_search", {"q": "Texas"})
        body = _extract_response_dict(result)
        assert body.get("error") == "fixture_not_found"
        # No fixture matched → matched.kind == "none" and expected_args is null.
        assert call_log[0]["matched"]["kind"] == "none"
        assert call_log[0]["expected_args"] is None
        assert call_log[0]["response_fixture"] is None


def test_fixture_without_args_is_rejected():
    """Spec change: `args` is now required on every fixture. The mock
    server constructor surfaces the InvalidFixtureError at build time."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        (tmp / "noargs.json").write_text(json.dumps({
            "tool": "record_search",
            "response": {"hits": "x"},
        }))
        with pytest.raises(InvalidFixtureError):
            create_mock_server(["noargs"], tmp)


def test_fixture_input_schema_honored_for_tool_absent_from_build():
    """A fixture-provided input_schema is the escape hatch for aspirational
    tools that have fixtures but no compiled .ts source. For a tool absent
    from the build, the fixture's declared schema is advertised verbatim."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        (tmp / "typed.json").write_text(json.dumps({
            "tool": "future_tool_not_in_build",
            "args": {"query": "X"},
            "input_schema": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
            "response": {"title": "X"},
        }))
        server, _, tools_by_name = create_mock_server(["typed"], tmp)
        tool_obj = tools_by_name["future_tool_not_in_build"]
        assert tool_obj.input_schema["required"] == ["query"]
        assert "query" in tool_obj.input_schema["properties"]


def test_build_schema_advertised_for_fixture_backed_tool():
    """The core of the drift fix: a fixture-backed tool that exists in the
    compiled build advertises the real production input schema, not a
    permissive stub. Regression for rx_007/008 (match-tool fixtures had no
    schema, so the model probed with `{}`). Skips gracefully if the build
    is absent (the loader degrades to a permissive schema, no schema to
    assert)."""
    from harness.mock_mcp import _load_build_tool_catalog

    if not _load_build_tool_catalog().get("record_person_matches"):
        pytest.skip("mcp-server build not present; build catalog unavailable")

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        # A fixture with NO input_schema of its own — the schema must come
        # from the build, not the permissive fallback.
        (tmp / "match.json").write_text(json.dumps({
            "tool": "record_person_matches",
            "args": {"id": "9XKV-ABC"},
            "response": {"matches": []},
        }))
        server, _, tools_by_name = create_mock_server(["match"], tmp)
        schema = tools_by_name["record_person_matches"].input_schema
        # Real production schema: `id` is required and it is not the
        # permissive `additionalProperties: True` fallback.
        assert schema.get("required") == ["id"]
        assert schema.get("additionalProperties") is not True


def test_live_tool_advertises_build_schema():
    """Live tools pull their input schema from the same build catalog. The
    `ops` batch array on research_append is the field the old hand-maintained
    mirror once dropped — assert it is advertised. Skips if the build is
    absent."""
    from harness.mock_mcp import _load_build_tool_catalog

    if not _load_build_tool_catalog().get("research_append"):
        pytest.skip("mcp-server build not present; build catalog unavailable")

    # Live tools register regardless of fixtures, so any fixture set works.
    server, _, tools_by_name = create_mock_server(
        ["wikipedia-search-schuylkill-county"], FIXTURES_DIR
    )
    schema = tools_by_name["research_append"].input_schema
    assert "ops" in schema["properties"]
    assert schema["properties"]["ops"]["type"] == "array"

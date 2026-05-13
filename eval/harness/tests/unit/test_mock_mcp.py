"""Tests for harness.mock_mcp — in-process MCP fixture server.

These tests exercise the handler logic directly (bypassing the SDK) so they
stay fast and don't require network. Real SDK integration is covered by the
e2e test.
"""

import asyncio
import json
from pathlib import Path

import pytest

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
        ["wikipedia-schuylkill-county"], FIXTURES_DIR
    )
    result = _invoke(tools_by_name, "wikipedia_search", {"query": "Schuylkill"})
    body = _extract_response_dict(result)
    assert body["title"] == "Schuylkill County, Pennsylvania"
    assert call_log[0]["tool"] == "mcp__genealogy__wikipedia_search"
    assert call_log[0]["matched"]["kind"] == "queue"
    # v1.5: response_fixture must carry the source fixture name (spec §10).
    # Previously always None.
    assert call_log[0]["response_fixture"] == "wikipedia-schuylkill-county"


def test_only_registers_tools_for_loaded_fixtures():
    server, call_log, tools_by_name = create_mock_server(
        ["wikipedia-schuylkill-county"], FIXTURES_DIR
    )
    # The mock server registers exactly one tool — the one with a fixture.
    # Other tools the skill might call (e.g. places) would 404 at the SDK
    # transport layer; the test for that lives in the e2e flow.
    assert set(tools_by_name.keys()) == {"wikipedia_search"}


def test_predicate_match_wins_over_queue():
    # Build a fixture manifest manually using a temporary fixtures dir.
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        (tmp / "predicated.json").write_text(json.dumps({
            "tool": "search",
            "when": {"args.q": "Ohio"},
            "response": {"hits": "predicated-ohio"},
        }))
        (tmp / "fallback.json").write_text(json.dumps({
            "tool": "search",
            "response": {"hits": "queue-fallback"},
        }))
        server, call_log, tools_by_name = create_mock_server(
            ["predicated", "fallback"], tmp
        )
        result = _invoke(tools_by_name, "search", {"q": "Ohio"})
        body = _extract_response_dict(result)
        assert body["hits"] == "predicated-ohio"
        assert call_log[0]["matched"]["kind"] == "predicate"

        # A non-matching query falls through to the queue.
        result2 = _invoke(tools_by_name, "search", {"q": "Texas"})
        body2 = _extract_response_dict(result2)
        assert body2["hits"] == "queue-fallback"
        assert call_log[1]["matched"]["kind"] == "queue"


def test_queue_reuses_last_response_when_exhausted():
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        (tmp / "only.json").write_text(json.dumps({
            "tool": "search",
            "response": {"hits": "the-only-one"},
        }))
        server, call_log, tools_by_name = create_mock_server(["only"], tmp)
        # First call: normal queue match (kind="queue").
        _invoke(tools_by_name, "search", {"q": "first"})
        assert call_log[0]["matched"]["kind"] == "queue"
        # Subsequent calls: queue exhausted → reuse flagged.
        _invoke(tools_by_name, "search", {"q": "second"})
        _invoke(tools_by_name, "search", {"q": "third"})
        assert call_log[1]["matched"]["kind"] == "queue_reused"
        assert call_log[2]["matched"]["kind"] == "queue_reused"
        # All three got the same response.
        for entry in call_log:
            assert entry["response"]["hits"] == "the-only-one"


def test_queue_pops_through_multiple_fixtures_before_reuse():
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        for i, payload in enumerate(("a", "b")):
            (tmp / f"q{i}.json").write_text(json.dumps({
                "tool": "search",
                "response": {"hits": payload},
            }))
        server, call_log, tools_by_name = create_mock_server(["q0", "q1"], tmp)
        # Two fixtures, three calls: two queue, one queue_reused.
        _invoke(tools_by_name, "search", {"q": "1"})
        _invoke(tools_by_name, "search", {"q": "2"})
        _invoke(tools_by_name, "search", {"q": "3"})
        assert call_log[0]["matched"]["kind"] == "queue"
        assert call_log[1]["matched"]["kind"] == "queue"
        assert call_log[2]["matched"]["kind"] == "queue_reused"


def test_fixture_with_input_schema_is_advertised():
    """Fixture authors can declare a typed input schema."""
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        (tmp / "typed.json").write_text(json.dumps({
            "tool": "wikipedia_search",
            "input_schema": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
            "response": {"title": "X"},
        }))
        server, _, tools_by_name = create_mock_server(["typed"], tmp)
        # The SdkMcpTool's input_schema should match what the fixture declared.
        tool_obj = tools_by_name["wikipedia_search"]
        assert tool_obj.input_schema["required"] == ["query"]
        assert "query" in tool_obj.input_schema["properties"]

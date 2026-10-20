"""Offline checks for `dev/probe_session_start_cache.py`'s verdict logic.

The probe is billed and live, so only the judging is tested here. Each planted break must
be NAMED in the verdict, and each legitimate variant -- what a real second request looks
like -- must pass, so the check can fail in both directions."""
import copy
import json

import pytest

from dev.probe_session_start_cache import (
    MCP_PREFIX,
    REWRITE_MIN_TOKENS,
    always_load_tools,
    exit_code,
    judge_session,
    parse_usage,
    prefix_breaks,
)

ALWAYS = ["research_query", "project_context"]
TOOLS = [{"name": "Agent", "input_schema": {"type": "object", "properties": {}}},
         {"name": "ToolSearch", "input_schema": {"type": "object"}}] + [
    {"name": MCP_PREFIX + n, "input_schema": {"type": "object"}} for n in ALWAYS]
CALL = {"type": "tool_use", "id": "tu_1", "name": MCP_PREFIX + "project_context",
        "input": {"projectPath": "/p"}}
RESULT = {"type": "tool_result", "tool_use_id": "tu_1", "content": "{}"}


def _req(messages, usage=None, beta="b1", **over):
    body = {"model": "claude-sonnet-4-6", "system": [{"type": "text", "text": "S"}],
            "tools": copy.deepcopy(TOOLS), "thinking": {"type": "adaptive"},
            "messages": messages}
    body.update(over)
    return {"body": body, "headers": {"anthropic-beta": beta}, "usage": usage}


def _pair(ctx1=40_000, read2=40_000):
    first = [{"role": "user",
              "content": [{"type": "text", "text": "go", "cache_control": {"type": "ephemeral"}}]}]
    second = [{"role": "user", "content": [{"type": "text", "text": "go"}]},
              {"role": "assistant", "content": [CALL]},
              {"role": "user", "content": [dict(RESULT, cache_control={"type": "ephemeral"})]}]
    return (_req(first, {"input_tokens": 3, "cache_creation_input_tokens": ctx1 - 3,
                         "cache_read_input_tokens": 0}),
            _req(second, {"input_tokens": 3, "cache_creation_input_tokens": 200,
                          "cache_read_input_tokens": read2}))


def test_a_legitimate_second_request_passes():
    """(f) the cache marker moved to the newest message, and an assistant call plus its
    tool result appended -- what every real request 2 looks like."""
    r1, r2 = _pair(ctx1=40_000, read2=39_997)
    assert prefix_breaks(r1, r2) == []
    v = judge_session([r1, r2], ALWAYS)
    assert v["breaks"] == [] and v["void"] == []
    assert exit_code([v]) == 0


def test_tools_reserialised_in_another_key_order_pass():
    """(g) the same tools with their keys in a different order are the same JSON."""
    r1, r2 = _pair()
    r2["body"]["tools"] = [dict(reversed(list(t.items()))) for t in TOOLS]
    assert json.dumps(r2["body"]["tools"]) != json.dumps(r1["body"]["tools"])
    assert prefix_breaks(r1, r2) == []


@pytest.mark.parametrize("plant, field", [
    ("extra_tool", "tools"),
    ("system_byte", "system"),
    ("messages", "messages"),
    ("beta", "anthropic-beta"),
    ("thinking", "thinking"),
])
def test_each_planted_break_is_named(plant, field):
    r1, r2 = _pair()
    if plant == "extra_tool":
        r2["body"]["tools"].append({"name": MCP_PREFIX + "record_read", "input_schema": {}})
    elif plant == "system_byte":
        r2["body"]["system"] = [{"type": "text", "text": "T"}]
    elif plant == "messages":
        r2["body"]["messages"][0]["content"][0]["text"] = "gone"
    elif plant == "beta":
        r2["headers"]["anthropic-beta"] = "b2"
    elif plant == "thinking":
        r2["body"]["thinking"] = {"type": "enabled", "budget_tokens": 1024}
    assert field in prefix_breaks(r1, r2)
    v = judge_session([r1, r2], ALWAYS)
    assert any(field in b for b in v["breaks"]), v
    assert exit_code([v]) == 1


def test_rewrite_threshold_boundary():
    r1, r2 = _pair(ctx1=40_000, read2=40_000 - (REWRITE_MIN_TOKENS - 1))
    assert judge_session([r1, r2], ALWAYS)["breaks"] == []
    r1, r2 = _pair(ctx1=40_000, read2=40_000 - REWRITE_MIN_TOKENS)
    assert any(b.startswith("rewrite") for b in judge_session([r1, r2], ALWAYS)["breaks"])


def test_late_tools_on_request_1_is_a_break():
    r1, r2 = _pair()
    r1["body"]["tools"] = TOOLS[:1]
    v = judge_session([r1, r2], ALWAYS)
    assert any(b.startswith("late-tools") for b in v["breaks"])


def test_one_main_call_is_void_not_a_pass():
    """The 'exit 0 having done nothing' class: a session that never reached call 2."""
    r1, _ = _pair()
    v = judge_session([r1], ALWAYS)
    assert v["void"] and not v["breaks"]
    assert exit_code([v]) == 2


def test_engine_never_answering_is_void():
    r1, r2 = _pair()
    r2["body"]["messages"][-1]["content"][0]["is_error"] = True
    v = judge_session([r1, r2], ALWAYS)
    assert any("project_context" in x for x in v["void"])
    assert exit_code([v]) == 2


def test_a_break_outranks_a_void_session():
    r1, r2 = _pair(read2=0)
    assert exit_code([judge_session([r1], ALWAYS), judge_session([r1, r2], ALWAYS)]) == 1


def test_usage_is_read_from_the_stream_head():
    start = {"type": "message_start", "message": {"usage": {
        "input_tokens": 3, "cache_creation_input_tokens": 10, "cache_read_input_tokens": 7}}}
    head = (b"event: message_start\ndata: " + json.dumps(start).encode()
            + b"\n\nevent: ping\ndata: {\"type\": \"ping\"}\n\n")
    assert parse_usage(head)["cache_read_input_tokens"] == 7
    assert parse_usage(b"event: error\ndata: {\"type\": \"error\"}\n\n") is None


def test_always_load_is_read_from_the_engine_source():
    names = always_load_tools()
    assert "project_context" in names and "research_delivered" in names
    assert always_load_tools('x ALWAYS_LOAD: S = new Set([\n  "a", // c\n  // "b"\n  "c",\n]);'
                             ) == ["a", "c"]


def test_tool_search_off_is_a_break():
    """Tool search off loads every schema up front: a 12-14% dearer run, not a pass."""
    r1, r2 = _pair()
    for r in (r1, r2):
        r["body"]["tools"] = [t for t in r["body"]["tools"] if t["name"] != "ToolSearch"]
    v = judge_session([r1, r2], ALWAYS)
    assert any(b.startswith("no-search") for b in v["breaks"]) and not v["tool_search_offered"]
    assert exit_code([v]) == 1

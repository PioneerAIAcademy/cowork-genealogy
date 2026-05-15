"""In-process mock MCP server for unit-test harness per spec §15.

Builds a claude_agent_sdk SDK MCP server from a fixture manifest. The server's
tools dispatch via predicate matching first, then queue order, then return a
structured fixture_not_found error so the run log can flag missing coverage.

Tool responses are JSON-encoded into a single text content block — the SDK's
contract for tool results.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from claude_agent_sdk import create_sdk_mcp_server, tool

from harness.fixtures import build_manifest, load_fixtures, matches


def create_mock_server(fixture_names: list[str], fixtures_dir: Path):
    """Build the in-process MCP server and return (server_config, call_log, tools_by_name).

    Call log accumulates {"tool", "args", "matched", "response_fixture",
    "response"} dicts as the SDK invokes the mock tools. The caller is
    responsible for assembling tool_calls into the run log.

    tools_by_name maps the bare tool name (e.g. "wikipedia_search") to the
    SdkMcpTool object. Tests can invoke `tools_by_name[name].handler(args)`
    directly without going through the SDK transport.
    """
    fixtures = load_fixtures(fixture_names, fixtures_dir)
    manifest = build_manifest(fixtures)
    call_log: list[dict[str, Any]] = []

    tools = []
    for tool_name, bucket in manifest.items():
        predicated = list(bucket["predicated"])
        queue = list(bucket["queue"])
        # Track how many times the queue has been hit so we can flag "reuse"
        # only after exhaustion. First call to a single-fixture queue is a
        # normal queue match; the 2nd+ calls are queue_reused.
        queue_hits = {"n": 0}
        original_queue_length = len(queue)
        # Fixture-provided input schema (optional) — when absent, use a
        # permissive shape so the LLM can still pass any args.
        input_schema = bucket.get("input_schema") or {
            "type": "object",
            "properties": {},
            "additionalProperties": True,
        }

        # Capture loop variables via default args so closures bind by value.
        async def handler(
            args,
            _predicated=predicated,
            _queue=queue,
            _name=tool_name,
            _queue_hits=queue_hits,
            _orig_len=original_queue_length,
        ):
            entry: dict[str, Any] = {
                "tool": f"mcp__genealogy__{_name}",
                "args": dict(args),
                "matched": {"kind": "none", "index": None},
                "response_fixture": None,
            }

            response: dict[str, Any] | None = None
            source_name: str | None = None
            for i, (predicate, resp, src) in enumerate(_predicated):
                if matches(predicate, args):
                    entry["matched"] = {"kind": "predicate", "index": i}
                    response = resp
                    source_name = src
                    break

            if response is None and _queue:
                # Queue mode: pop from front while items remain; once the
                # queue is exhausted, reuse the last fixture. Flag the reuse
                # case separately so reviewers can see when a skill called a
                # tool more times than fixtures exist for it.
                _queue_hits["n"] += 1
                if _queue_hits["n"] > _orig_len:
                    resp_pair = _queue[-1] if _queue else (None, None)
                    response, source_name = resp_pair
                    entry["matched"] = {"kind": "queue_reused", "index": None}
                elif len(_queue) == 1:
                    # Last available item, first time taking it — normal queue.
                    response, source_name = _queue[0]
                    entry["matched"] = {"kind": "queue", "index": None}
                else:
                    response, source_name = _queue.pop(0)
                    entry["matched"] = {"kind": "queue", "index": None}

            if response is None:
                response = {
                    "error": "fixture_not_found",
                    "tool": _name,
                    "message": (
                        f"No fixture matched call to {_name}. "
                        "Add a fixture for this argument shape."
                    ),
                }

            entry["response"] = response
            entry["response_fixture"] = source_name
            call_log.append(entry)
            return {
                "content": [
                    {"type": "text", "text": json.dumps(response)},
                ],
            }

        decorated = tool(
            tool_name,
            f"Mock {tool_name} — fixture-backed.",
            input_schema,
        )(handler)
        tools.append(decorated)

    server = create_sdk_mcp_server(name="genealogy", version="1.0.0", tools=tools)
    tools_by_name = {t.name: t for t in tools}
    return server, call_log, tools_by_name


def expected_tool_names(call_log: list[dict[str, Any]]) -> list[str]:
    """Return tool names recorded in the call log, in invocation order."""
    return [c["tool"] for c in call_log]

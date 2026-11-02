#!/usr/bin/env python3
"""R11 / handoff F7 — which parts of a Messages call a gateway's trace export carries.

Plan: R11 in ``docs/plan/search-agent-prototype.md``. Sends calls through ``--base`` (a
local agentgateway carrying TAP's ``/bedrock`` route and ``tap-tracing``'s ``gen_ai.*``
fields, exporting to a local Jaeger: ``tap-local-gateway.yaml`` here, whose header says
how to run both) in which every content type carries its own marker,
then reads the spans back from ``--jaeger`` and reports which markers left.

    uv run python -m dev.p1.probe_trace_export --base URL --jaeger URL

Content types: system, user text, assistant text, a replayed ``tool_use`` input, a
``tool_result`` as text blocks, a ``tool_result`` as a JSON string, and the model's own
tool call in the response (``gen_ai.tool_calls``), plain and streamed. A few cents of
Haiku. Exit 0 when every call answered and its spans were found, 2 otherwise. Stdlib only.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from typing import Any

HAIKU = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
TOOL = {"name": "record_search", "description": "search records by surname",
        "input_schema": {"type": "object", "properties": {"surname": {"type": "string"}},
                         "required": ["surname"]}}


def post(base: str, body: dict[str, Any]) -> bytes:
    req = urllib.request.Request(base.rstrip("/") + "/v1/messages", json.dumps(body).encode("utf-8"),
                                 {"content-type": "application/json", "anthropic-version": "2023-06-01"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--base", required=True, help="gateway route root, e.g. http://127.0.0.1:3939/bedrock")
    p.add_argument("--jaeger", required=True, help="Jaeger query root, e.g. http://127.0.0.1:16686")
    p.add_argument("--service", default="agentgateway", help="Jaeger service name (default agentgateway)")
    args = p.parse_args()

    stamp = int(time.time())
    m = {k: f"Zqx{k.replace('_', '')}{stamp}" for k in
         ("system", "user", "assistanttext", "tooluseinput", "toolresulttext", "toolresultjson", "toolcallargs")}
    history = {
        "model": HAIKU, "max_tokens": 64, "system": f"You are a test. {m['system']}", "tools": [TOOL],
        "messages": [
            {"role": "user", "content": f"Search the records. {m['user']}"},
            {"role": "assistant", "content": [
                {"type": "text", "text": f"Searching. {m['assistanttext']}"},
                {"type": "tool_use", "id": "toolu_01", "name": "record_search",
                 "input": {"surname": m["tooluseinput"]}}]},
            {"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": "toolu_01", "content": [
                    {"type": "text", "text": f"John Flynn b. 1850. {m['toolresulttext']}"}]},
                {"type": "text", "text": "Summarise in five words."}]}]}
    as_json = json.loads(json.dumps(history))
    as_json["messages"][2]["content"][0]["content"] = json.dumps({"persons": [{"name": "Mary Flynn", "marker": m["toolresultjson"]}]})
    call = {"model": HAIKU, "max_tokens": 200, "tools": [TOOL],
            "messages": [{"role": "user", "content": f"Call record_search with surname exactly '{m['toolcallargs']}'. Do nothing else."}]}
    try:
        for body in (history, as_json, call, {**call, "stream": True}):
            post(args.base, body)
    except Exception as e:  # noqa: BLE001 - report and exit, this is a probe
        print(f"call failed: {e}", file=sys.stderr)
        return 2
    time.sleep(8)
    url = f"{args.jaeger.rstrip('/')}/api/traces?service={args.service}&limit=50&lookback=1h"
    with urllib.request.urlopen(url, timeout=30) as r:
        spans = [s for t in json.loads(r.read().decode("utf-8"))["data"] for s in t["spans"]]
    mine = [s for s in spans if str(stamp) in json.dumps(s)]
    if len(mine) < 4:
        print(f"found {len(mine)} of 4 spans for this run; is the gateway exporting to {args.jaeger}?", file=sys.stderr)
        return 2
    # Each marker is looked for only in the tag it would leave in: the call request's user
    # text names the toolcallargs marker, and a reply may echo any marker, so a match
    # anywhere in the span would report a field present that the gateway never exported.
    tags = {key: "\n".join(str(t.get("value")) for s in mine for t in s.get("tags", []) if t.get("key") == key)
            for key in ("gen_ai.prompt", "gen_ai.tool_calls")}
    for k, v in m.items():
        key = "gen_ai.tool_calls" if k == "toolcallargs" else "gen_ai.prompt"
        print(f"{k:16} {'EXPORTED' if v in tags[key] else 'absent'} (in {key})")
    blob = "\n".join(json.dumps(s) for s in mine)
    print(f"image bytes      {'EXPORTED' if 'iVBORw0KGgo' in blob else 'absent'} (only meaningful after an image call)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

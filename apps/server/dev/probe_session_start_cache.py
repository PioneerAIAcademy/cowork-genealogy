#!/usr/bin/env python3
"""Does the hosted main thread's second request re-write the cache its first one wrote?

Dallan's hosted finding 5 (2026-10-19): since always-load (#2953), in 10 of 11 hosted
sessions on CLI 2.1.215-2.1.220 the main thread's call 2 re-wrote 20-47k tokens of call 1's
prefix, about $0.13 a session, and CLI 2.1.294 did not. A request re-writes its prefix when
something in it differs from the previous request's, so this captures the first two
main-thread requests of fresh sessions and names the field that moved.

Answered 2026-10-20, `MODEL` claude-sonnet-4-6: **2.1.220 breaks every session, 2.1.294
none.** On 2.1.220 the engine registers after request 1 is sent, so request 1 carries none
of the genealogy tools and request 2 re-writes the prefix; 2.1.294 waits for it.

    CLI      engine delay  sessions  call 1 ctx  call 2 cache read  verdict
    2.1.220  3 s           2         48,815      20,691             BREAK  tools, rewrite 28k
    2.1.220  none          1         48,753      20,691             BREAK  tools, rewrite 28k
    2.1.294  3 s           2         51,732      51,729             ok
    2.1.294  none          3         51,742      51,739             ok, ToolSearch + 6 MCP tools

2.1.220 is SDK 0.2.128 (`--cli` not needed on that checkout); 2.1.294 is SDK 0.2.165.

HOW

The capture proxy from `probe_effort_capture.py` (a local server behind
`ANTHROPIC_BASE_URL`, the real `real_agent.build_options`, the same environment scrub and
`MODEL`) records every `/v1/messages` request with its headers and the `usage` its reply
opened with. A main-thread request is one whose `system` holds `anthropic_proxy._MAIN_MARKER`.
Each session runs on a temporary copy of `eval/fixtures/scenarios/empty-project-just-created`
with a fresh `HOME` and `CLAUDE_CONFIG_DIR`, as a new hosted sandbox starts with no CLI
state. The prompt asks for one `project_context` call and then `OK`, so a session is two
main-thread requests.

`AUTONOMOUS_MAX_NUDGES=0` keeps the hosted Stop hook from pushing the agent past its `OK`;
it plays no part before call 2.

`--engine-delay D` starts the engine D seconds late through a wrapper module, which forces
the case where the MCP server registers after the CLI has sent request 1.

A session BREAKS (exit 1) when any of these holds, and the line names which:

    prefix      `prefix_breaks` finds a field of request 1 that request 2 changed: `model`,
                the `anthropic-beta` header, `tools`, `system`, `thinking`, `tool_choice`,
                or `messages` (request 2's not starting with request 1's), each compared
                as parsed JSON with `cache_control` keys removed
    rewrite     call 1's context minus call 2's `cache_read_input_tokens` is >= 1,024,
                the measure and threshold the hosted read-out counts (`REWRITE_MIN_TOKENS`)
    late-tools  request 1 lacks one of the `ALWAYS_LOAD` tools
    no-search   request 1 offers no `ToolSearch`: tool search is off, and every genealogy
                schema loads up front (+12-14% a run, T1.7), whatever `ENABLE_TOOL_SEARCH` says

A session is VOID (exit 2, unless another session broke cleanly) when it has fewer than two main-thread
requests, its last main-thread request lacks one of the `ALWAYS_LOAD` tools, or
`project_context` never returned a non-error result -- a run where the engine never
connected has proved nothing. Exit 0 otherwise.

Costs about $0.20-0.35 a session (call 1 writes ~40k tokens). Needs a compiled engine
(`make engine-build`) and a key in $ANTHROPIC_API_KEY or eval/.env. Run from apps/server:
`uv run python dev/probe_session_start_cache.py [--sessions N] [--engine-delay D] [--cli PATH]`.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import shutil
import sys
import tempfile
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.anthropic_proxy import _MAIN_MARKER  # noqa: E402
from dev.probe_effort_capture import (  # noqa: E402
    ENGINE_BUILD,
    PLUGIN_DIR,
    REPO,
    SCRUBBED_NAMES,
    SCRUBBED_PREFIXES,
    api_key,
    cli_version,
    make_handler,
    parse_usage,
    system_text,
)

FIXTURE = REPO / "eval" / "fixtures" / "scenarios" / "empty-project-just-created"
TOOL_SCHEMAS = REPO / "packages" / "engine" / "mcp-server" / "src" / "tool-schemas.ts"
MCP_PREFIX = "mcp__genealogy__"
REWRITE_MIN_TOKENS = 1024
PREFIX_FIELDS = ("model", "tools", "system", "thinking", "tool_choice")


def always_load_tools(source: str | None = None) -> list[str]:
    """The engine's `ALWAYS_LOAD` names, read from its source so a change there moves this."""
    text = TOOL_SCHEMAS.read_text(encoding="utf-8") if source is None else source
    m = re.search(r"ALWAYS_LOAD\b[^=]*=\s*new Set\(\[(.*?)\]\)", text, re.S)
    if not m:
        raise SystemExit(f"no ALWAYS_LOAD set in {TOOL_SCHEMAS}")
    names = re.findall(r'^\s*"([a-z_]+)"', m.group(1), re.M)
    if not names:
        raise SystemExit(f"ALWAYS_LOAD in {TOOL_SCHEMAS} parsed to no names")
    return names


def strip_cache_control(obj):
    if isinstance(obj, dict):
        return {k: strip_cache_control(v) for k, v in obj.items() if k != "cache_control"}
    if isinstance(obj, list):
        return [strip_cache_control(v) for v in obj]
    return obj


def prefix_breaks(req1: dict, req2: dict) -> list[str]:
    """The fields of request 1's cacheable prefix that request 2 changed.

    Each request is `{"body": <parsed JSON>, "headers": {lower-case name: value}}`."""
    b1, b2 = strip_cache_control(req1["body"]), strip_cache_control(req2["body"])
    out = [f for f in PREFIX_FIELDS if b1.get(f) != b2.get(f)]
    beta1 = req1.get("headers", {}).get("anthropic-beta")
    beta2 = req2.get("headers", {}).get("anthropic-beta")
    if beta1 != beta2:
        out.insert(1, "anthropic-beta")
    m1, m2 = b1.get("messages") or [], b2.get("messages") or []
    if m2[:len(m1)] != m1:
        out.append("messages")
    return out


def context_tokens(usage: dict | None) -> int | None:
    if not usage:
        return None
    return sum(int(usage.get(k) or 0) for k in
               ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"))


def tool_names(body: dict) -> set[str]:
    return {t.get("name") for t in body.get("tools") or [] if isinstance(t, dict)}


def project_context_ok(body: dict) -> bool:
    """True when a `tool_result` answering a `project_context` call is in these messages
    and is not an error."""
    ids = set()
    for msg in body.get("messages") or []:
        content = msg.get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_use" and str(block.get("name", "")).endswith(
                    "project_context"):
                ids.add(block.get("id"))
            if (block.get("type") == "tool_result" and block.get("tool_use_id") in ids
                    and not block.get("is_error")):
                return True
    return False


def judge_session(main_requests: list[dict], always_load: list[str]) -> dict:
    """Verdict for one session's main-thread requests, in the order they were sent.

    Each request is `{"body", "headers", "usage"}`."""
    wanted = {MCP_PREFIX + n for n in always_load}
    out: dict = {"main_calls": len(main_requests), "breaks": [], "void": []}
    if len(main_requests) < 2:
        out["void"].append(f"{len(main_requests)} main-thread request(s), need 2")
        return out
    req1, req2 = main_requests[0], main_requests[1]
    first_tools = tool_names(req1["body"])
    out["mcp_tools_at_start"] = sum(1 for n in first_tools if str(n).startswith(MCP_PREFIX))
    out["tool_search_offered"] = "ToolSearch" in first_tools
    if not out["tool_search_offered"]:
        out["breaks"].append("no-search: request 1 offers no ToolSearch")
    missing_at_start = sorted(wanted - first_tools)
    if missing_at_start:
        out["breaks"].append(f"late-tools: request 1 lacks {missing_at_start}")
    changed = prefix_breaks(req1, req2)
    if changed:
        out["breaks"].append(f"prefix: {', '.join(changed)}")
    ctx1 = context_tokens(req1.get("usage"))
    read2 = (req2.get("usage") or {}).get("cache_read_input_tokens")
    out["call1_ctx"], out["call2_cache_read"] = ctx1, read2
    if ctx1 is None or read2 is None:
        out["void"].append("no usage on call 1 or call 2")
    elif ctx1 - int(read2) >= REWRITE_MIN_TOKENS:
        out["breaks"].append(f"rewrite: {ctx1 - int(read2):,} tokens (>= {REWRITE_MIN_TOKENS:,})")
    last = main_requests[-1]["body"]
    missing_at_end = sorted(wanted - tool_names(last))
    if missing_at_end:
        out["void"].append(f"last main request lacks {missing_at_end}")
    if not project_context_ok(last):
        out["void"].append("project_context never returned a non-error result")
    return out


def exit_code(verdicts: list[dict]) -> int:
    """1 when a session broke and was not void; else 2 when any was void; else 0. Within one
    session a void outranks a break: an engine that never connected also leaves request 1
    without its tools, and that must not read as the session-start defect."""
    if any(v["breaks"] and not v["void"] for v in verdicts):
        return 1
    if any(v["void"] for v in verdicts):
        return 2
    return 0


class Capture:
    """What `make_handler` drives in exchange mode: every request, its headers and usage."""

    wants_exchange = True

    def __init__(self):
        self.rows: list[dict] = []
        self.statuses: list[int | str] = []
        self.lock = threading.Lock()

    def record(self, path: str, raw: bytes, headers: dict) -> int | None:
        try:
            body = json.loads(raw)
        except ValueError:
            return None
        row = {"main": _MAIN_MARKER in system_text(body), "body": body, "headers": headers,
               "usage": None}
        with self.lock:
            self.rows.append(row)
            return len(self.rows) - 1

    def record_response(self, key: int, head: bytes) -> None:
        with self.lock:
            self.rows[key]["usage"] = parse_usage(head)


def write_delay_wrapper(directory: Path, delay: float) -> Path:
    """An ES module that waits, then runs the real engine (the engine is `"type": "module"`)."""
    wrapper = directory / "delayed-engine.mjs"
    wrapper.write_text(
        f"await new Promise((r) => setTimeout(r, {int(delay * 1000)}));\n"
        f"await import({json.dumps(ENGINE_BUILD.as_uri())});\n",
        encoding="utf-8",
    )
    return wrapper


async def run_session(key: str, cli: str | None, engine: Path) -> list[dict]:
    from claude_agent_sdk import ClaudeSDKClient

    from app.agent import real_agent

    cap = Capture()
    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(cap))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    saved = {k: os.environ.get(k) for k in ("ANTHROPIC_BASE_URL", "HOME", "CLAUDE_CONFIG_DIR")}
    try:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            project = tmp / "project"
            shutil.copytree(FIXTURE, project, ignore=shutil.ignore_patterns("README.md"))
            home = tmp / "home"
            (home / ".claude").mkdir(parents=True)
            os.environ["ANTHROPIC_BASE_URL"] = f"http://127.0.0.1:{server.server_address[1]}"
            os.environ["HOME"] = str(home)
            os.environ["CLAUDE_CONFIG_DIR"] = str(home / ".claude")
            real_agent._PLUGIN_DIR = str(PLUGIN_DIR)
            real_agent._MCP_BUILD = str(engine)
            real_agent._SECRETS_PATH = str(tmp / "absent-secrets.json")
            options = real_agent.build_options(project, api_key=key)
            if cli:
                options.cli_path = cli
            client = ClaudeSDKClient(options=options)
            await client.connect()
            try:
                await client.query(
                    f"Call the project_context tool once with projectPath {project}, "
                    "then reply with the single word OK. Do nothing else.")

                async def drain():
                    async for _ in client.receive_response():
                        pass

                try:
                    await asyncio.wait_for(drain(), 240)
                except TimeoutError:
                    print("  session timed out after 240s; judging what was captured",
                          flush=True)
            finally:
                try:
                    await asyncio.wait_for(client.disconnect(), 30)
                except Exception:
                    pass
    finally:
        server.shutdown()
        server.server_close()
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
    return [r for r in cap.rows if r["main"]]


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sessions", type=int, default=3)
    ap.add_argument("--engine-delay", type=float, default=0.0,
                    help="seconds to hold the engine back before it starts")
    ap.add_argument("--cli", help="path to the claude CLI to run (default: the SDK's bundled one)")
    ap.add_argument("--out", help="write the JSON report here")
    args = ap.parse_args()
    if args.sessions < 1:
        sys.exit("--sessions must be at least 1")
    if not args.engine_delay >= 0:
        sys.exit("--engine-delay must be a number >= 0")

    key = api_key()
    if not key:
        sys.exit("no ANTHROPIC_API_KEY in the environment or eval/.env")
    if not ENGINE_BUILD.exists():
        sys.exit(f"missing {ENGINE_BUILD}: run `make engine-build`")
    always_load = always_load_tools()

    scrubbed = sorted(k for k in list(os.environ)
                      if k.startswith(SCRUBBED_PREFIXES) or k in SCRUBBED_NAMES)
    for k in scrubbed:
        del os.environ[k]
    from app.config import Settings
    os.environ["MODEL"] = Settings.model_fields["default_model"].default
    # Read once, at real_agent's import. Left on, the Stop hook nudges the agent past its
    # `OK` until the session times out, and calls 1 and 2 never get judged.
    os.environ["AUTONOMOUS_MAX_NUDGES"] = "0"
    import claude_agent_sdk

    verdicts = []
    with tempfile.TemporaryDirectory() as wd:
        engine = write_delay_wrapper(Path(wd), args.engine_delay) if args.engine_delay \
            else ENGINE_BUILD
        for i in range(args.sessions):
            reqs = await run_session(key, args.cli, engine)
            v = judge_session(reqs, always_load)
            verdicts.append(v)
            state = "VOID" if v["void"] else ("BREAK" if v["breaks"] else "ok")
            print(f"session {i + 1}: {state:5} main_calls={v['main_calls']} "
                  f"call1_ctx={v.get('call1_ctx')} call2_cache_read={v.get('call2_cache_read')} "
                  f"tool_search={v.get('tool_search_offered')} "
                  f"mcp_tools_at_start={v.get('mcp_tools_at_start')} "
                  f"{'; '.join(v['breaks'] + v['void'])}", flush=True)
    code = exit_code(verdicts)
    report = {
        "sdk": getattr(claude_agent_sdk, "__version__", "?"),
        "cli": cli_version(args.cli),
        "main_model_env": os.environ["MODEL"],
        "engine_delay_s": args.engine_delay,
        "scrubbed_env": scrubbed,
        "sessions": verdicts,
        "exit": code,
    }
    print(f"sdk={report['sdk']} cli={report['cli']} engine_delay={args.engine_delay}s "
          f"exit={code} scrubbed_env={scrubbed}")
    if args.out:
        Path(args.out).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    sys.exit(code)


if __name__ == "__main__":
    asyncio.run(main())

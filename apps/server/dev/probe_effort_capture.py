#!/usr/bin/env python3
"""What reasoning effort does the hosted CLI actually SEND on a subagent's request?

Issue #3263. Hosted subagents (person-evidence, locality-guide) stopped on
`max_tokens` after one turn of pure thinking. `real_agent.build_options` sets no
`effort`, so the question was whether the subagent ran on some lower CLI default
and pinning `effort="high"` would change anything. This reads the answer off the
wire instead of inferring it from the CLI's source.

Answered 2026-10-12 under agent SDK 0.2.128, on CLI 2.1.215 (the version the #3159
bundle's transcripts record, via `--cli`) and CLI 2.1.220 (the one that SDK bundles,
which the image now pins), each a full five-arm run of this script, identically on
both: **the subagent already runs at `high`.**

    arm                 person-evidence subagent's first request
    a-none              effort high    max_tokens 32000  thinking adaptive, display omitted
    b-option-high       effort high    max_tokens 32000
    b-option-medium     effort medium  max_tokens 32000
    c-settings-high     effort high    max_tokens 32000
    c-settings-medium   effort medium  max_tokens 32000

Every request, subagent and main thread (on production's `MODEL`), ran
`claude-sonnet-4-6` at `max_tokens` 32000 with the same effort. Pinning `effort="high"`
sends the same body hosted already sends, so it cannot change the runaway. Both levers
reach the subagent: the `medium` controls change its body.

HOW

A local proxy on 127.0.0.1 logs every `/v1/messages` request body (`model`,
`thinking`, `output_config`, `max_tokens`) and forwards everything, streaming, to
api.anthropic.com. `ANTHROPIC_BASE_URL` points at it, and the REAL
`real_agent.build_options` passes that through `_sdk_env`, so the hosted option set
is what runs, hooks included: production's PreToolUse hook forces every delegation into
the foreground, and a backgrounded subagent sends a different `thinking` body. Only the
returned object is mutated, per arm.
The CLI inherits the operator's environment, and some variables move exactly the
fields reported here (`CLAUDE_CODE_EFFORT_LEVEL` outranks both levers,
`CLAUDE_CODE_MAX_OUTPUT_TOKENS` changes `max_tokens`, `MAX_THINKING_TOKENS` changes
`thinking`, `ANTHROPIC_DEFAULT_*_MODEL` changes `model`). Every variable with a
`SCRUBBED_PREFIXES` prefix or in `SCRUBBED_NAMES` is removed for the run and its NAME
reported (never its value: the prefix also matches the operator's session tokens). `MODEL` is then set to `Settings.default_model`, the model `_agent_env` hands a hosted
sandbox unless the deploy (`DEFAULT_MODEL`) or the project overrides it. The main thread is told
to delegate one trivial task to `person-evidence`; a request whose system prompt
carries that agent's body is the subagent's, and the arm ends as soon as one is
logged.

ARMS

    a-none              nothing set (what hosted runs today)
    b-option-high       options.effort = "high"
    b-option-medium     options.effort = "medium"      (positive control)
    c-settings-high     <project>/.claude/settings.json {"effortLevel": "high"}
    c-settings-medium   <project>/.claude/settings.json {"effortLevel": "medium"}

The `medium` arms are what make a `high` arm readable. If the default is already
`high`, an arm setting `high` sends the same body whether or not the lever reached
the subagent; only a lever that CHANGES the subagent's body proves it reaches it.

WHICH CLI

Until issue #3263 the E2B image installed `claude-agent-sdk>=0.2.93` unpinned, so
production ran whatever CLI was newest at image build: 2.1.215 in the #3159 bundle. It
now pins the uv.lock version, whose bundled CLI runs by default. Pass another binary
with `--cli <path>`; the report says which ran.

A localhost base URL is not first-party, which is also true of production's proxy
(`.../api/anthropic-proxy`), so the two match on that axis.

Costs a few cents: five short sessions, each cut at the subagent's first request.
Needs a compiled engine (`make engine-build`) and a key in $ANTHROPIC_API_KEY or
eval/.env. Run from apps/server:
`uv run python dev/probe_effort_capture.py [--cli PATH] [--only ARM,ARM]`.
"""
from __future__ import annotations

import argparse
import asyncio
import http.client
import json
import os
import shutil
import ssl
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
if not (REPO / "apps" / "server" / "app" / "agent" / "real_agent.py").exists():
    sys.exit(f"{__file__} is not inside a cowork-genealogy checkout")

SERVER_DIR = REPO / "apps" / "server"
PLUGIN_DIR = REPO / "packages" / "engine" / "plugin"
ENGINE_BUILD = REPO / "packages" / "engine" / "mcp-server" / "build" / "index.js"
AGENT_MD = PLUGIN_DIR / "agents" / "person-evidence.md"
sys.path.insert(0, str(SERVER_DIR))

UPSTREAM = "api.anthropic.com"

SCRUBBED_PREFIXES = ("CLAUDE_CODE_", "ANTHROPIC_DEFAULT_")
SCRUBBED_NAMES = (
    "CLAUDE_EFFORT",
    "MAX_THINKING_TOKENS",
    "DISABLE_INTERLEAVED_THINKING",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_SMALL_FAST_MODEL",
    "MODEL",
)

QUERY = (
    "Use the Agent tool to delegate exactly one task to the person-evidence agent. "
    "The task text is: 'Reply with the single word OK. Do not call any tools.' "
    "Do nothing else."
)

ARMS = [
    ("a-none", None, None),
    ("b-option-high", "high", None),
    ("b-option-medium", "medium", None),
    ("c-settings-high", None, "high"),
    ("c-settings-medium", None, "medium"),
]


def api_key() -> str:
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip().strip("\"'")
    if key:
        return key
    env = REPO / "eval" / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("ANTHROPIC_API_KEY="):
                return line.split("=", 1)[1].strip().strip("\"'")
    return ""


def agent_marker() -> str:
    """A line only person-evidence's system prompt carries, read from the shipped body."""
    text = AGENT_MD.read_text(encoding="utf-8")
    body = text.split("---", 2)[2]
    for line in body.splitlines():
        if line.startswith("# "):
            return line.strip()
    raise SystemExit(f"no heading in {AGENT_MD}")


def system_text(body: dict) -> str:
    sys_field = body.get("system")
    if isinstance(sys_field, str):
        return sys_field
    if isinstance(sys_field, list):
        return "\n".join(b.get("text", "") for b in sys_field if isinstance(b, dict))
    return ""


class Capture:
    def __init__(self, marker: str):
        self.marker = marker
        self.rows: list[dict] = []
        self.subagent_seen = threading.Event()
        self.lock = threading.Lock()

    def record(self, path: str, raw: bytes) -> None:
        try:
            body = json.loads(raw)
        except ValueError:
            return
        sys_text = system_text(body)
        row = {
            "path": path,
            "who": "subagent" if self.marker in sys_text else "main-or-aux",
            "model": body.get("model"),
            "max_tokens": body.get("max_tokens"),
            "thinking": body.get("thinking"),
            "output_config": body.get("output_config"),
            "delegates": any(isinstance(t, dict) and t.get("name") in ("Agent", "Task")
                             for t in body.get("tools") or []),
        }
        with self.lock:
            self.rows.append(row)
        if row["who"] == "subagent":
            self.subagent_seen.set()


def make_handler(cap: Capture):
    ctx = ssl.create_default_context()

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *a):  # quiet
            pass

        def _forward(self):
            length = int(self.headers.get("content-length") or 0)
            raw = self.rfile.read(length) if length else b""
            if self.command == "POST" and self.path.startswith("/v1/messages") \
                    and not self.path.startswith("/v1/messages/count_tokens"):
                cap.record(self.path, raw)
            headers = {k: v for k, v in self.headers.items()
                       if k.lower() not in ("host", "content-length", "connection",
                                            "accept-encoding")}
            headers["host"] = UPSTREAM
            if raw:
                headers["content-length"] = str(len(raw))
            conn = http.client.HTTPSConnection(UPSTREAM, context=ctx, timeout=300)
            try:
                conn.request(self.command, self.path, body=raw or None, headers=headers)
                resp = conn.getresponse()
                self.send_response(resp.status)
                for k, v in resp.getheaders():
                    if k.lower() in ("transfer-encoding", "connection", "content-length"):
                        continue
                    self.send_header(k, v)
                self.send_header("transfer-encoding", "chunked")
                self.send_header("connection", "close")
                self.end_headers()
                while True:
                    chunk = resp.read1(65536) if hasattr(resp, "read1") else resp.read(65536)
                    if not chunk:
                        break
                    self.wfile.write(b"%x\r\n%s\r\n" % (len(chunk), chunk))
                    self.wfile.flush()
                self.wfile.write(b"0\r\n\r\n")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
            finally:
                conn.close()

        do_GET = do_POST = do_PUT = do_DELETE = do_PATCH = _forward

    return Handler


def cli_version(path: str | None) -> str:
    if path is None:
        import claude_agent_sdk
        bundled = Path(claude_agent_sdk.__file__).parent / "_bundled" / "claude"
        path = str(bundled)
    try:
        return subprocess.run([path, "--version"], capture_output=True, text=True,
                              encoding="utf-8", timeout=30).stdout.strip()
    except OSError as exc:
        return f"unreadable ({exc})"


async def run_arm(name: str, option_effort: str | None, settings_effort: str | None,
                  key: str, cli: str | None, marker: str) -> dict:
    from claude_agent_sdk import ClaudeSDKClient
    from app.agent import real_agent

    cap = Capture(marker)
    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(cap))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    old_base = os.environ.get("ANTHROPIC_BASE_URL")
    os.environ["ANTHROPIC_BASE_URL"] = base
    try:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            plugin = tmp / "plugin"
            shutil.copytree(PLUGIN_DIR, plugin)
            project = tmp / "project"
            project.mkdir()
            if settings_effort:
                (project / ".claude").mkdir()
                (project / ".claude" / "settings.json").write_text(
                    json.dumps({"effortLevel": settings_effort}) + "\n", encoding="utf-8")
            real_agent._PLUGIN_DIR = str(plugin)
            real_agent._MCP_BUILD = str(ENGINE_BUILD)
            options = real_agent.build_options(project, api_key=key)
            if option_effort:
                options.effort = option_effort
            if cli:
                options.cli_path = cli

            client = ClaudeSDKClient(options=options)
            await client.connect()
            try:
                await client.query(QUERY)

                async def drain():
                    async for _ in client.receive_response():
                        pass

                drainer = asyncio.create_task(drain())
                waiter = asyncio.create_task(asyncio.to_thread(cap.subagent_seen.wait, 240))
                await asyncio.wait({drainer, waiter}, return_when=asyncio.FIRST_COMPLETED)
                cap.subagent_seen.set()
                for t in (drainer, waiter):
                    t.cancel()
            finally:
                try:
                    await asyncio.wait_for(client.disconnect(), 30)
                except Exception:
                    pass
    finally:
        server.shutdown()
        if old_base is None:
            os.environ.pop("ANTHROPIC_BASE_URL", None)
        else:
            os.environ["ANTHROPIC_BASE_URL"] = old_base

    sub = [r for r in cap.rows if r["who"] == "subagent"]
    main = [r for r in cap.rows if r["who"] != "subagent" and r["delegates"]]
    return {
        "arm": name,
        "set": {"options.effort": option_effort, "settings.effortLevel": settings_effort},
        "subagent_first_request": sub[0] if sub else None,
        "main_first_request": main[0] if main else None,
        "requests_logged": len(cap.rows),
        "verdict": "CAPTURED" if sub else "VOID (no subagent request seen)",
    }


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cli", help="path to the claude CLI to run (default: the SDK's bundled one)")
    ap.add_argument("--only", help="comma-separated arm names")
    ap.add_argument("--out", help="write the JSON report here")
    args = ap.parse_args()

    key = api_key()
    if not key:
        sys.exit("no ANTHROPIC_API_KEY in the environment or eval/.env")
    if not ENGINE_BUILD.exists():
        sys.exit(f"missing {ENGINE_BUILD}: run `make engine-build`")
    arms = ARMS
    if args.only is not None:
        wanted = {a.strip() for a in args.only.split(",") if a.strip()}
        arms = [a for a in ARMS if a[0] in wanted]
        unknown = wanted - {a[0] for a in ARMS}
        if unknown or not arms:
            sys.exit(f"--only matched nothing usable; unknown: {sorted(unknown)}")

    scrubbed = sorted(k for k in list(os.environ)
                      if k.startswith(SCRUBBED_PREFIXES) or k in SCRUBBED_NAMES)
    for k in scrubbed:
        del os.environ[k]
    from app.config import Settings
    os.environ["MODEL"] = Settings.model_fields["default_model"].default
    import claude_agent_sdk
    report = {
        "scrubbed_env": scrubbed,
        "main_model_env": os.environ["MODEL"],
        "sdk": getattr(claude_agent_sdk, "__version__", "?"),
        "cli": cli_version(args.cli),
        "arms": [],
    }
    marker = agent_marker()
    for name, opt, setting in arms:
        res = await run_arm(name, opt, setting, key, args.cli, marker)
        report["arms"].append(res)
        sub = res["subagent_first_request"] or {}
        print(f"{name:20} {res['verdict']:10} model={sub.get('model')} "
              f"max_tokens={sub.get('max_tokens')} thinking={json.dumps(sub.get('thinking'))} "
              f"output_config={json.dumps(sub.get('output_config'))}", flush=True)
    print(f"sdk={report['sdk']} cli={report['cli']} scrubbed_env={scrubbed}")
    if args.out:
        Path(args.out).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if any(a["verdict"] != "CAPTURED" for a in report["arms"]):
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())

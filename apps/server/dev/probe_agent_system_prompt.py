#!/usr/bin/env python3
"""What agent does the credential proxy name behind real hosted requests?

`anthropic_proxy._agent_name` names the agent behind each metered call from the request's
`system` field: `main` when it holds the hosted main thread's marker, otherwise the text of
its first `# ` line, which every plugin agent body opens with. That rests on two things the
CLI decides: it copies an agent's body into its subagent's system prompt verbatim, and the
main thread's appended prompt never reaches a subagent. This checks both on real requests,
because no CI job sees what the CLI sends and the proxy is inactive locally.

Answered 2026-10-19 under agent SDK 0.2.128 and its bundled CLI 2.1.220 (the version the
image pins), `MODEL` claude-sonnet-4-6, one session of four requests: **both hold.**

    request   model                      marker  first `# ` line     named
    other     claude-haiku-4-5-20251001  no      none                None
    main      claude-sonnet-4-6          yes     # System            main
    subagent  claude-sonnet-4-6          no      # Person Evidence   Person Evidence
    main      claude-sonnet-4-6          yes     # System            main

The main thread's first `# ` line is the preset's `# System`, so the marker must be tested
first. The CLI's own Haiku call carries neither and reads None, which `make alpha-costs`
prints as `(none)`.

HOW

The capture proxy from `probe_effort_capture.py` (a local server behind
`ANTHROPIC_BASE_URL`, the real `real_agent.build_options`, the same environment scrub and
`MODEL`) records every `/v1/messages` request. The main thread is told to delegate one
trivial task to `person-evidence`, and the session stops at the subagent's first request.
Each request is classified without `_agent_name`: a subagent's when its `system` holds
person-evidence's heading or `cc_is_subagent=true` (the CLI's billing block), the main
thread's when its tools include `Agent` or `Task`, otherwise neither. Then `_agent_name`
reads each one.

Exit 0 when at least one request of each kind was seen, every main-thread request reads
`main`, every subagent request reads person-evidence's heading, and the body (frontmatter
removed, stripped) is verbatim in each subagent request's `system`. Exit 1 otherwise. Re-run
it when the SDK pin, and so the CLI, moves.

Costs a few cents: one short session cut at the subagent's first request. Needs a compiled
engine (`make engine-build`) and a key in $ANTHROPIC_API_KEY or eval/.env. Run from
apps/server: `uv run python dev/probe_agent_system_prompt.py [--cli PATH]`.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import tempfile
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.anthropic_proxy import _MAIN_MARKER, _agent_name  # noqa: E402
from dev.probe_effort_capture import (  # noqa: E402
    AGENT_MD,
    ENGINE_BUILD,
    PLUGIN_DIR,
    QUERY,
    SCRUBBED_NAMES,
    SCRUBBED_PREFIXES,
    api_key,
    cli_version,
    make_handler,
    system_text,
)


def agent_body() -> tuple[str, str]:
    """person-evidence's body with its frontmatter removed, and its heading's text."""
    body = AGENT_MD.read_text(encoding="utf-8").split("---", 2)[2].strip()
    heading = next(line for line in body.splitlines() if line.startswith("# "))
    return body, heading[2:].strip()


class Capture:
    """What `make_handler` drives (`record`, `lock`, `statuses`), keeping every request."""

    def __init__(self, heading: str):
        self.heading_line = f"# {heading}"
        self.rows: list[dict] = []
        self.statuses: list[int | str] = []
        self.lock = threading.Lock()
        self.subagent_seen = threading.Event()

    def record(self, path: str, raw: bytes) -> None:
        try:
            body = json.loads(raw)
        except ValueError:
            return
        text = system_text(body)
        tools = {t.get("name") for t in body.get("tools") or [] if isinstance(t, dict)}
        if self.heading_line in text or "cc_is_subagent=true" in text:
            who = "subagent"
        elif tools & {"Agent", "Task"}:
            who = "main"
        else:
            who = "other"
        row = {
            "who": who,
            "model": body.get("model"),
            "marker": _MAIN_MARKER in text,
            "first_heading": next((ln for ln in text.splitlines() if ln.startswith("# ")), None),
            "named": _agent_name(raw),
            "system": text,
        }
        with self.lock:
            self.rows.append(row)
        if who == "subagent":
            self.subagent_seen.set()


async def run(key: str, cli: str | None, heading: str) -> Capture:
    from claude_agent_sdk import ClaudeSDKClient

    from app.agent import real_agent

    cap = Capture(heading)
    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(cap))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    old_base = os.environ.get("ANTHROPIC_BASE_URL")
    os.environ["ANTHROPIC_BASE_URL"] = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            project = tmp / "project"
            project.mkdir()
            real_agent._PLUGIN_DIR = str(PLUGIN_DIR)
            real_agent._MCP_BUILD = str(ENGINE_BUILD)
            # `_current_base_url` reads a secrets file before the environment; a missing one
            # keeps the CLI on this proxy.
            real_agent._SECRETS_PATH = str(tmp / "absent-secrets.json")
            options = real_agent.build_options(project, api_key=key)
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
                for task in (drainer, waiter):
                    task.cancel()
            finally:
                try:
                    await asyncio.wait_for(client.disconnect(), 30)
                except Exception:  # noqa: BLE001 — the capture is already complete
                    pass
    finally:
        server.shutdown()
        server.server_close()
        if old_base is None:
            os.environ.pop("ANTHROPIC_BASE_URL", None)
        else:
            os.environ["ANTHROPIC_BASE_URL"] = old_base
    return cap


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--cli", help="path to the claude CLI to run (default: the SDK's bundled one)")
    args = ap.parse_args()

    key = api_key()
    if not key:
        sys.exit("no ANTHROPIC_API_KEY in the environment or eval/.env")
    if not ENGINE_BUILD.exists():
        sys.exit(f"missing {ENGINE_BUILD}: run `make engine-build`")
    scrubbed = sorted(k for k in list(os.environ)
                      if k.startswith(SCRUBBED_PREFIXES) or k in SCRUBBED_NAMES)
    for k in scrubbed:
        del os.environ[k]
    from app.config import Settings

    os.environ["MODEL"] = Settings.model_fields["default_model"].default
    import claude_agent_sdk

    body, heading = agent_body()
    cap = asyncio.run(run(key, args.cli, heading))
    print(f"sdk={getattr(claude_agent_sdk, '__version__', '?')} cli={cli_version(args.cli)} "
          f"MODEL={os.environ['MODEL']} scrubbed_env={scrubbed}")
    print(f"{'request':9} {'model':26} {'marker':6} {'first # line':34} named")
    for r in cap.rows:
        print(f"{r['who']:9} {str(r['model']):26} {str(r['marker']):6} "
              f"{str(r['first_heading'])[:34]:34} {r['named']}")

    main_rows = [r for r in cap.rows if r["who"] == "main"]
    sub_rows = [r for r in cap.rows if r["who"] == "subagent"]
    failures = []
    if not main_rows:
        failures.append("no main-thread request seen")
    if not sub_rows:
        failures.append(f"no subagent request seen (statuses {cap.statuses})")
    failures += [f"a main-thread request read {r['named']!r}" for r in main_rows if r["named"] != "main"]
    failures += [f"a subagent request read {r['named']!r}" for r in sub_rows if r["named"] != heading]
    failures += ["the agent body is not verbatim in a subagent request's system prompt"
                 for r in sub_rows if body not in r["system"]]
    print("RESULT: " + ("OK: main-thread requests read 'main', the subagent's read "
                        f"{heading!r}, and its body is verbatim" if not failures
                        else "FAIL: " + "; ".join(failures)))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""The P1 prototype's ``ClaudeAgentOptions`` — the PROTOTYPE set, not the hosted one.

Contract: `PLAN.md` at the repo root ("apps/server/dev/p1/options.py"), which
implements "P1. Cross-process resume" of `docs/plan/search-agent-prototype.md`.

What differs from ``real_agent.build_options`` (the hosted set), on purpose:
agents come from ``ClaudeAgentOptions.agents`` (``dev.p1.plugin_agents``), never
``stage_plugin_agents``; ``setting_sources=[]`` explicitly; no ``add_dirs``; a
``session_store`` with ``session_store_flush="eager"``; ``CLAUDE_CONFIG_DIR``
pinned to a per-run directory; and a PreToolUse hook that only LOGS (the hosted
``_pretool_hook`` is the session's restraint — this one records what fired).

``canonical_input_sha256`` is the plan's ledger key: sha256 over canonical JSON
of a tool's input with the top-level ``projectPath`` removed. The driver hashes
``ToolUseBlock.input`` with the same function so the hook's hash and the
stream's hash agree.

The logging hook also reports each PreToolUse through ``hook_emit`` (the driver
passes its JSONL emitter) as ``{"ev": "pretool", "tool_name", "tool_use_id",
"agent_id", "agent_type", "input_sha256", "ts"}``. That line is the harness's
forced-kill key: it fires after the CLI has committed to dispatching the call,
whereas the stream's ``tool_use`` block arrives before the hook round-trip.

The engine's debug hold (``HOLD_ENV``) is passed twice: in ``env`` (inherited
by the CLI child) and in ``mcp_servers["genealogy"]["env"]`` — the CLI switches
its stdio-server environment to a six-variable allowlist whenever
``CLAUDE_CODE_MCP_ALLOWLIST_ENV`` is truthy in the operator's shell, and only
the server config survives both branches.

Zero-token handshake (spawns the CLI, no query):

    uv run python -m dev.p1.options --handshake --project <seeded dir>
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import shutil
import sys
import tempfile
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SERVER_DIR = Path(__file__).resolve().parents[2]
REPO = Path(__file__).resolve().parents[4]
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from app.agent import real_agent  # noqa: E402 - needs SERVER_DIR on sys.path

from .plugin_agents import load_agent_definitions  # noqa: E402

DEFAULT_MODEL = "claude-sonnet-4-6"
DISALLOWED_TOOLS = ["Bash", "WebFetch", "WebSearch", "NotebookEdit"]
PLUGIN_COMMAND_PREFIX = "genealogy-research:"
HOLD_ENV = "GENEALOGY_DEBUG_HOLD_BEFORE_COMMIT_MS"
HOLD_AFTER_ENV = "GENEALOGY_DEBUG_HOLD_AFTER_COMMIT_MS"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def api_key() -> str:
    """$ANTHROPIC_API_KEY, else this repo's eval/.env line (probe_agent_binding's rule)."""
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if key:
        return key
    env = REPO / "eval" / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("ANTHROPIC_API_KEY="):
                return line.split("=", 1)[1].strip()
    return ""


def canonical_input_sha256(tool_input: Any) -> str:
    """sha256 of canonical JSON of ``tool_input`` minus a top-level ``projectPath``."""
    doc = tool_input
    if isinstance(doc, dict) and "projectPath" in doc:
        doc = {k: v for k, v in doc.items() if k != "projectPath"}
    canonical = json.dumps(
        doc, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _make_logging_hook(
    hook_log: list[dict[str, Any]] | None,
    emit: Callable[[dict[str, Any]], None] | None = None,
):
    async def _log_pretool(input_data: Any, tool_use_id: str | None, _context: Any) -> dict:
        data = input_data if isinstance(input_data, dict) else {}
        try:
            record = {
                "tool_name": data.get("tool_name"),
                "tool_use_id": data.get("tool_use_id") or tool_use_id,
                "agent_id": data.get("agent_id"),
                "agent_type": data.get("agent_type"),
                "input_sha256": canonical_input_sha256(data.get("tool_input") or {}),
                "ts": _now_iso(),
            }
            if hook_log is not None:
                hook_log.append(record)
            if emit is not None:
                emit({"ev": "pretool", **record})
        except Exception:  # noqa: BLE001 - a logging hook must never fail a tool call
            pass
        return {}

    return _log_pretool


def build_prototype_options(
    project_dir: Path,
    *,
    api_key: str,
    store: Any | None,
    config_dir: Path,
    resume: str | None = None,
    model: str | None = DEFAULT_MODEL,
    extra_env: dict[str, str] | None = None,
    hook_log: list[dict[str, Any]] | None = None,
    hook_emit: Callable[[dict[str, Any]], None] | None = None,
    plugin_dir: str = real_agent._PLUGIN_DIR,
    mcp_build: str = real_agent._MCP_BUILD,
    disallowed_tools: list[str] | None = None,
    max_turns: int | None = None,
):
    from claude_agent_sdk import ClaudeAgentOptions, HookMatcher

    # disallowed_tools: None = the default four; a list = exactly that list; [] = none.
    denied = list(DISALLOWED_TOOLS) if disallowed_tools is None else list(disallowed_tools)
    # max_turns: None = the SDK default (unbounded; what the driver runs). The
    # probes pass a small cap so a retry loop cannot bill more than a few turns.

    genealogy_server: dict[str, Any] = {"type": "stdio", "command": "node", "args": [mcp_build]}
    holds = {k: v for k, v in (extra_env or {}).items() if k in (HOLD_ENV, HOLD_AFTER_ENV)}
    if holds:
        genealogy_server["env"] = holds

    # The hosted project note from real_agent.build_options, verbatim.
    project_note = (
        "You are the hosted genealogy research agent. The active research "
        f"project lives in your current working directory ({project_dir}). It "
        "contains research.json and tree.gedcomx.json — read and update those "
        "files there (do NOT look in the home directory). Follow the genealogy "
        "skills, and apply researcher_profile.narration_guidance from "
        "research.json as your narration style."
    )
    kwargs: dict[str, Any] = dict(
        cwd=str(project_dir),
        permission_mode="bypassPermissions",
        system_prompt={"type": "preset", "preset": "claude_code", "append": project_note},
        setting_sources=[],
        plugins=[{"type": "local", "path": plugin_dir}],
        agents=load_agent_definitions(Path(plugin_dir)),
        mcp_servers={"genealogy": genealogy_server},
        disallowed_tools=denied,
        hooks={"PreToolUse": [HookMatcher(matcher=None,
                                          hooks=[_make_logging_hook(hook_log, hook_emit)])]},
        include_partial_messages=True,
        env={
            "ANTHROPIC_API_KEY": api_key,
            "ENABLE_TOOL_SEARCH": "true",
            "CLAUDE_CONFIG_DIR": str(config_dir),
            **(extra_env or {}),
        },
        model=model,
    )
    if store is not None:
        # store=None: no transcript mirror at all (a probe that never resumes).
        kwargs["session_store"] = store
        kwargs["session_store_flush"] = "eager"
    if resume:
        kwargs["resume"] = resume
    if max_turns is not None:
        kwargs["max_turns"] = max_turns
    return ClaudeAgentOptions(**kwargs)


# ── --handshake ─────────────────────────────────────────────────────────


class _ThrowawayStore:
    """Minimal in-memory ``SessionStore`` for the zero-token handshake."""

    def __init__(self) -> None:
        self.appended = 0

    async def append(self, key: Any, entries: list[Any]) -> None:
        self.appended += len(entries)

    async def load(self, key: Any) -> list[Any] | None:
        return None


def _command_name(entry: Any) -> str:
    if isinstance(entry, dict):
        return str(entry.get("name") or "")
    return str(entry)


async def handshake(client: Any) -> dict[str, Any]:
    """Read the init handshake off a CONNECTED ``ClaudeSDKClient`` (zero tokens).

    ``expected`` is what the client's own ``options.agents`` registered. Keys:
    ``expected``, ``registered`` (every agent name the CLI reports),
    ``bare_plugin`` (expected names present bare), ``missing`` (expected names
    absent), ``other_bare`` (CLI built-ins), ``namespaced`` (``plugin:agent``
    spellings), ``plugin_commands`` (``genealogy-research:`` command names),
    ``commands_total``, ``info`` (the raw ``get_server_info()`` dict).
    """
    info = await client.get_server_info() or {}
    options = getattr(client, "options", None)
    expected = sorted((getattr(options, "agents", None) or {}))
    registered = sorted(
        a["name"] for a in info.get("agents", []) if isinstance(a, dict) and "name" in a
    )
    bare_plugin = [n for n in registered if n in expected]
    commands = info.get("commands", []) or []
    plugin_commands = sorted(
        n for n in (_command_name(c) for c in commands) if n.startswith(PLUGIN_COMMAND_PREFIX)
    )
    return {
        "expected": expected,
        "registered": registered,
        "bare_plugin": bare_plugin,
        "missing": sorted(set(expected) - set(bare_plugin)),
        "other_bare": [n for n in registered if ":" not in n and n not in expected],
        "namespaced": [n for n in registered if ":" in n],
        "plugin_commands": plugin_commands,
        "commands_total": len(commands),
        "info": info,
    }


async def _handshake(args: argparse.Namespace) -> int:
    from claude_agent_sdk import ClaudeSDKClient

    key = api_key()
    if not key:
        print("no ANTHROPIC_API_KEY in env or eval/.env", file=sys.stderr)
        return 2
    project = Path(args.project).resolve()
    if not project.is_dir():
        print(f"--project is not a directory: {project}", file=sys.stderr)
        return 2
    plugin_dir = args.plugin_dir or real_agent._PLUGIN_DIR
    mcp_build = args.mcp_build or real_agent._MCP_BUILD
    if not Path(mcp_build).exists():
        print(f"engine build missing: {mcp_build} (run `make engine-build`)", file=sys.stderr)
        return 2

    config_dir = Path(tempfile.mkdtemp(prefix="p1-handshake-cfg-"))
    hook_log: list[dict[str, Any]] = []
    store = _ThrowawayStore()
    options = build_prototype_options(
        project,
        api_key=key,
        store=store,
        config_dir=config_dir,
        model=args.model,
        hook_log=hook_log,
        plugin_dir=plugin_dir,
        mcp_build=mcp_build,
    )
    client = ClaudeSDKClient(options=options)
    try:
        await client.connect()
        try:
            hs = await handshake(client)
        finally:
            await client.disconnect()
    finally:
        shutil.rmtree(config_dir, ignore_errors=True)

    expected, bare_plugin = hs["expected"], hs["bare_plugin"]
    other_bare, namespaced = hs["other_bare"], hs["namespaced"]
    plugin_commands, commands = hs["plugin_commands"], hs["info"].get("commands", []) or []

    print(f"config_dir (removed): {config_dir}")
    print(f"plugin agents registered under their bare names ({len(bare_plugin)}/{len(expected)}):")
    for name in bare_plugin:
        print(f"  {name}")
    if other_bare:
        print(f"other bare agents (CLI built-ins) ({len(other_bare)}): {', '.join(other_bare)}")
    if namespaced:
        print(f"plugin-namespaced agents ({len(namespaced)}): {', '.join(namespaced)}")
    print(f"{PLUGIN_COMMAND_PREFIX} commands: {len(plugin_commands)} (of {len(commands)} total)")
    if args.verbose:
        for name in plugin_commands:
            print(f"  {name}")
    if hs["missing"]:
        print(f"MISSING bare agents: {hs['missing']}", file=sys.stderr)
        return 1
    if not plugin_commands and commands:
        print(f"first command entry (for diagnosis): {commands[0]!r}", file=sys.stderr)
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m dev.p1.options",
        description="P1 prototype options; --handshake connects, reads the init "
                    "handshake (agents + commands), disconnects — no query, no tokens.",
    )
    p.add_argument("--handshake", action="store_true")
    p.add_argument("--project", help="a seeded project directory (research.json + tree)")
    p.add_argument("--model", default=DEFAULT_MODEL)
    p.add_argument("--plugin-dir", default=None, help="default: real_agent._PLUGIN_DIR")
    p.add_argument("--mcp-build", default=None, help="default: real_agent._MCP_BUILD")
    p.add_argument("--verbose", action="store_true", help="also list the plugin commands")
    return p


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    parser = build_parser()
    args = parser.parse_args(argv)
    if not args.handshake:
        parser.error("nothing to do — pass --handshake --project DIR")
    if not args.project:
        parser.error("--handshake requires --project DIR")
    return asyncio.run(_handshake(args))


if __name__ == "__main__":
    sys.exit(main())

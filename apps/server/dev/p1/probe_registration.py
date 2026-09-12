#!/usr/bin/env python3
"""Does ``agents=`` register the plugin agents under their BARE names — and does
the CLI actually spawn one by that name?

Contract: `PLAN.md` at the repo root ("D1–2 parallel probes — implementation
contract", `probe_registration.py`). The billed half of the registration probe;
the zero-token half is `python -m dev.p1.options --handshake`.

One session on the PROTOTYPE option set (`dev.p1.options.build_prototype_options`:
the real plugin dir under `plugins=[…]`, `setting_sources=[]`, the six shipped
agents passed as `AgentDefinition`s via `agents=`), on a fresh temp project
seeded from `eval/fixtures/scenarios/empty-project-just-created`, a fresh
`CLAUDE_CONFIG_DIR`, no session store, and the logging PreToolUse hook.

Before the query (zero tokens): `dev.p1.options.handshake` must show every
plugin agent under its bare name and one `genealogy-research:` command per
shipped skill (28 today), else exit 1 without querying. Then ONE query that
delegates to `image-reader` with "reply PONG; call no tool".

Recorded: the `Agent`/`Task` tool_use's `subagent_type`; whether any message
carried a non-null `parent_tool_use_id` (a real subagent ran); the delegation
tool_result (first 300 chars) and whether it is an error; the hook's
`agent_type` on any call the subagent made (it is told to make none, so this
is usually empty).

Verdict:
    bare name spawns   a subagent message was seen and the tool_result is not an
                       error naming an unknown/denied agent                exit 0
    anything else      (no delegation, unknown-agent error, no subagent
                       message, session error)                            exit 1

    uv run python -m dev.p1.probe_registration [--model …]   (or: make probe-registration)

Costs one short session (main thread capped at `MAX_TURNS` turns) plus one
subagent turn (cents; the token/cost totals are printed). Needs a compiled
engine (`make engine-build`) and a key in $ANTHROPIC_API_KEY or eval/.env.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import tempfile
from pathlib import Path
from typing import Any

# /repo/apps/server/dev/p1/probe_registration.py -> parents[2] = apps/server
SERVER_DIR = Path(__file__).resolve().parents[2]
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from dev.p1._probe_common import (  # noqa: E402
    MAX_TURNS,
    one_line,
    result_text,
    seed_project,
    usage_summary,
)
from dev.p1.options import DEFAULT_MODEL, PLUGIN_COMMAND_PREFIX, api_key, handshake  # noqa: E402
from dev.p1.plugin_agents import EXPECTED_AGENT_COUNT  # noqa: E402

SESSION_TIMEOUT_S = 300

TARGET_AGENT = "image-reader"
QUERY = (
    "Use the Agent tool to delegate to the agent named exactly `image-reader` with "
    "this instruction: 'Reply with exactly the word PONG and stop; do not call any "
    "tool.' Then reply with whatever it returned."
)
DELEGATION_TOOLS = ("Agent", "Task")   # the CLI accepts either name for the same tool

# The CLI's own wording: "agent({agentType}): agent type '<x>' not found. Available
# agents: …" and "Agent type '<x>' has been denied by permission rule …".
_UNKNOWN_AGENT_RE = re.compile(
    r"agent type '[^']*' not found|not found\.?\s*Available agents|"
    r"has been denied by permission rule|unknown agent",
    re.IGNORECASE,
)


def expected_plugin_commands(plugin_dir: Path) -> int:
    """One `genealogy-research:<skill>` command per shipped `skills/<skill>/SKILL.md`."""
    return len(list((plugin_dir / "skills").glob("*/SKILL.md")))


async def run_session(key: str, model: str) -> dict[str, Any]:
    from claude_agent_sdk import (
        AssistantMessage,
        ClaudeSDKClient,
        ResultMessage,
        TextBlock,
        ToolResultBlock,
        ToolUseBlock,
        UserMessage,
    )
    from app.agent import real_agent
    from dev.p1.options import build_prototype_options

    plugin_dir = Path(real_agent._PLUGIN_DIR)
    obs: dict[str, Any] = {
        "query": QUERY,
        "handshake": None,
        "handshake_ok": False,
        "expected_commands": expected_plugin_commands(plugin_dir),
        "delegations": [],          # every Agent/Task tool_use: id, name, subagent_type, input_preview
        "subagent_type": None,      # of the FIRST delegation
        "saw_subagent_message": False,
        "subagent_message_count": 0,
        "subagent_tool_uses": [],   # tool_use names the subagent issued (told to issue none)
        "delegation_result": None,  # {tool_use_id, is_error, text}
        "delegation_error_names_unknown_agent": False,
        "hook_main_thread": [],     # tool_name of main-thread PreToolUse hits
        "hook_subagent": [],        # {tool_name, agent_type} of subagent PreToolUse hits
        "hook_agent_types": [],
        "pong_in_delegation_result": False,
        "final_text": "",
        "result": None,
        "error": None,
    }
    hook_log: list[dict[str, Any]] = []
    delegation_ids: set[str] = set()
    last_text = ""

    with tempfile.TemporaryDirectory(prefix="p1-registration-") as td:
        tmp = Path(td)
        project = seed_project(tmp / "project")
        config_dir = tmp / "config"
        config_dir.mkdir()
        options = build_prototype_options(
            project, api_key=key, store=None, config_dir=config_dir, model=model,
            hook_log=hook_log, max_turns=MAX_TURNS,
        )
        client = ClaudeSDKClient(options=options)
        await client.connect()
        try:
            # Zero tokens so far: the handshake gate. A registration that is already
            # wrong here is reported without spending the query.
            hs = await handshake(client)
            obs["handshake"] = {k: v for k, v in hs.items() if k != "info"}
            n_bare, n_cmds = len(hs["bare_plugin"]), len(hs["plugin_commands"])
            print(f"handshake: {n_bare}/{len(hs['expected'])} plugin agents bare "
                  f"({', '.join(hs['bare_plugin'])}); {PLUGIN_COMMAND_PREFIX} commands: "
                  f"{n_cmds} (expected {obs['expected_commands']}; {hs['commands_total']} total)")
            if hs["missing"]:
                print(f"handshake: MISSING bare agents: {hs['missing']}")
            if hs["namespaced"]:
                print(f"handshake: namespaced agents also present: {hs['namespaced']}")
            obs["handshake_ok"] = (
                not hs["missing"]
                and len(hs["expected"]) >= EXPECTED_AGENT_COUNT
                and n_cmds == obs["expected_commands"]
            )
            if not obs["handshake_ok"]:
                obs["error"] = (f"handshake gate failed: {n_bare}/{len(hs['expected'])} bare "
                                f"agents (need all {EXPECTED_AGENT_COUNT}+), {n_cmds} plugin "
                                f"commands (need {obs['expected_commands']}) — no query sent")
                return obs

            await client.query(QUERY)
            async for msg in client.receive_response():
                parent = getattr(msg, "parent_tool_use_id", None)
                if parent:
                    obs["saw_subagent_message"] = True
                    obs["subagent_message_count"] += 1
                if isinstance(msg, (AssistantMessage, UserMessage)):
                    content = msg.content if isinstance(msg.content, list) else []
                    for block in content:
                        if isinstance(block, ToolUseBlock):
                            if parent:
                                obs["subagent_tool_uses"].append(block.name)
                            elif block.name in DELEGATION_TOOLS:
                                delegation_ids.add(block.id)
                                sub = block.input.get("subagent_type") if isinstance(block.input, dict) else None
                                obs["delegations"].append({
                                    "id": block.id, "name": block.name, "subagent_type": sub,
                                    "input_preview": json.dumps(block.input, default=str)[:200],
                                })
                                if obs["subagent_type"] is None:
                                    obs["subagent_type"] = sub
                        elif isinstance(block, ToolResultBlock):
                            if block.tool_use_id in delegation_ids and obs["delegation_result"] is None:
                                text = one_line(result_text(block.content))
                                obs["delegation_result"] = {
                                    "tool_use_id": block.tool_use_id,
                                    "is_error": bool(block.is_error),
                                    "text": text,
                                }
                                obs["delegation_error_names_unknown_agent"] = bool(
                                    block.is_error and _UNKNOWN_AGENT_RE.search(text)
                                )
                                obs["pong_in_delegation_result"] = "PONG" in text.upper()
                        elif isinstance(block, TextBlock) and isinstance(msg, AssistantMessage):
                            if not parent and block.text.strip():
                                last_text = block.text
                elif isinstance(msg, ResultMessage):
                    obs["result"] = {
                        "session_id": msg.session_id, "subtype": msg.subtype,
                        "is_error": bool(msg.is_error), **usage_summary(msg),
                    }
                    if not last_text and msg.result:
                        last_text = msg.result
                    break
        finally:
            await client.disconnect()

    obs["hook_main_thread"] = [h.get("tool_name") for h in hook_log if not h.get("agent_id")]
    obs["hook_subagent"] = [{"tool_name": h.get("tool_name"), "agent_type": h.get("agent_type")}
                            for h in hook_log if h.get("agent_id")]
    obs["hook_agent_types"] = sorted({str(h["agent_type"]) for h in obs["hook_subagent"]
                                      if h.get("agent_type")})
    obs["final_text"] = one_line(last_text)
    return obs


def verdict(obs: dict[str, Any]) -> tuple[str, int, str]:
    """(verdict, exit code, detail)."""
    if obs.get("error"):
        return "VOID", 1, obs["error"]
    res = obs.get("delegation_result")
    if not obs["delegations"]:
        return "VOID", 1, "the main thread never issued an Agent/Task tool_use"
    if res is None:
        return "VOID", 1, "an Agent/Task tool_use was issued but no tool_result came back"
    if obs["delegation_error_names_unknown_agent"]:
        return "unknown agent", 1, f"tool_result error: {res['text'][:160]}"
    if not obs["saw_subagent_message"]:
        return "no subagent ran", 1, (f"no message carried parent_tool_use_id; tool_result "
                                      f"is_error={res['is_error']}: {res['text'][:120]}")
    if res["is_error"]:
        return "spawned but errored", 1, f"subagent messages seen, tool_result error: {res['text'][:120]}"
    return "bare name spawns", 0, (
        f"subagent_type={obs['subagent_type']!r}, {obs['subagent_message_count']} subagent "
        f"message(s), PONG in tool_result={obs['pong_in_delegation_result']}"
    )


def print_summary(obs: dict[str, Any]) -> None:
    print("\n" + "=" * 100)
    print(f"{'field':<38}value")
    print("-" * 100)
    hs = obs.get("handshake") or {}
    rows = [
        ("bare plugin agents (handshake)", f"{len(hs.get('bare_plugin', []))}/{len(hs.get('expected', []))}"),
        (f"{PLUGIN_COMMAND_PREFIX} commands", f"{len(hs.get('plugin_commands', []))} (expected {obs.get('expected_commands')})"),
        ("Agent/Task tool_use subagent_type", repr(obs.get("subagent_type"))),
        ("delegation tool_uses", str(len(obs.get("delegations") or []))),
        ("subagent message seen (parent set)", f"{obs.get('saw_subagent_message')} ({obs.get('subagent_message_count')} msgs)"),
        ("subagent tool_uses", ", ".join(obs.get("subagent_tool_uses") or []) or "(none)"),
        ("hook agent_type on subagent calls", ", ".join(obs.get("hook_agent_types") or []) or "(none)"),
        ("hook main-thread tools", ", ".join(str(t) for t in obs.get("hook_main_thread") or []) or "(none)"),
    ]
    res = obs.get("delegation_result")
    rows.append(("delegation tool_result is_error", "?" if res is None else str(res["is_error"])))
    rows.append(("delegation tool_result text", "?" if res is None else res["text"][:60]))
    rows.append(("final assistant text", (obs.get("final_text") or "")[:60]))
    for k, v in rows:
        print(f"{k:<38}{v}")
    print("=" * 100)


def print_costs(obs: dict[str, Any]) -> None:
    res = obs.get("result") or {}
    if not res:
        print("\ntokens/cost: no ResultMessage (nothing billed beyond the handshake)")
        return
    cost = res.get("total_cost_usd") or 0.0
    i, o = res.get("input_tokens") or 0, res.get("output_tokens") or 0
    cr, cc = res.get("cache_read_input_tokens") or 0, res.get("cache_creation_input_tokens") or 0
    print(f"\ntokens/cost (from ResultMessage): ${cost:.4f}  in={i} (+cache read {cr}, "
          f"create {cc})  out={o}  turns={res.get('num_turns')}  {res.get('duration_ms')} ms")


async def run(model: str) -> int:
    key = api_key()
    if not key:
        print("no ANTHROPIC_API_KEY in env or eval/.env", file=sys.stderr)
        return 2
    from app.agent import real_agent
    if not Path(real_agent._MCP_BUILD).exists():
        print(f"no compiled engine at {real_agent._MCP_BUILD} — run `make engine-build`",
              file=sys.stderr)
        return 2

    print(f"... one session: delegate to `{TARGET_AGENT}` by bare name (model {model})", flush=True)
    try:
        obs = await asyncio.wait_for(run_session(key, model), timeout=SESSION_TIMEOUT_S)
    except Exception as exc:  # noqa: BLE001 - report, do not crash
        obs = {"error": f"{type(exc).__name__}: {exc}", "delegations": [],
               "delegation_result": None, "saw_subagent_message": False}

    print_summary(obs)
    print("\nfull record:")
    print(json.dumps(obs, indent=2, ensure_ascii=False, default=str))
    print_costs(obs)
    name, code, detail = verdict(obs)
    print(f"\nVERDICT: {name} — {detail}")
    return code


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m dev.p1.probe_registration",
        description="D1–2 probe: do the plugin agents register under bare names via "
                    "agents=, and does the CLI spawn `image-reader` by that name? One "
                    "billed session; exit 0 only on `bare name spawns`.",
    )
    p.add_argument("--model", default=DEFAULT_MODEL)
    return p


def main(argv: list[str] | None = None) -> int:
    # House pattern: a Windows console defaults to cp1252.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    args = build_parser().parse_args(argv)
    return asyncio.run(run(args.model))


if __name__ == "__main__":
    sys.exit(main())

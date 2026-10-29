#!/usr/bin/env python3
"""Issue #3542 lead 1, step 0: does a PostToolUse halt end a hosted turn?

Lead 1 ends the turn after the main-thread Agent call that completes a project, so the
patron sees the agent's own `summary_for_user` instead of a paraphrase written by one more
model call. The alpha already halts a turn from PreToolUse (`research_delivered`,
`real_agent.py`); nothing has measured a halt returned from **PostToolUse**, which is the
only place this one can sit: the Agent call has to run before its summary exists.

ARMS (one session each, same queued prompt)

  A  PostToolUse on the main-thread Agent call returns {"continue": False, "stopReason": S}
  B  control: the same hook returns {}
  C  A with the prototype's spelling, {"continue_": False, "stopReason": S}, exactly that
     dict (no deny half: `_halt` carries a PreToolUse deny, meaningless after the call ran)

The prompt queues a Write after the delegation. B must do the Write, or the turn ending in
A is not attributable to the halt (the attribution rule `probe_step_deny.py` learned).

WHAT IT RECORDS, per arm

  (a) tool calls and assistant text after the Agent result: none means no further model call
  (b) whether a ResultMessage still arrives, and its subtype / num_turns / cost
  (d) how many times a recording Stop hook fired
  (e) the Agent tool_response as PostToolUse sees it, saved whole to the output file so the
      `summary_for_user` parser is tested on a real return

VERDICTS

  HALTS   A and C: no tool call and no assistant text after the Agent result; B did the Write
  LEAKS   A or C: a tool call or assistant text after the Agent result
  VOID    the model never delegated, or B did not do the Write

Production's hooks are kept (`build_options`), with the probe's PostToolUse added and a Stop
counter beside the production Stop hook; the copied plugin's own hooks are removed. Run 1
replaced the hooks wholesale, which dropped `foreground_rewrite`: the control's Agent call ran
async and the arms could not be compared (VOID). The project is EMPTY, so no Stop veto
applies either way. The main model is Haiku unless PROBE_MODEL says otherwise: the
question is the runtime's handling of the hook output, not the model's judgment, and
`citation` inherits the main model.

ANSWERED 2026-10-27, alpha plane, Haiku main thread. A POSTTOOLUSE HALT ENDS THE TURN.

    arm            after the Agent result          num_turns  Write  Stop fired  cost
    A continue     nothing                         2          no     0           $0.048
    B control      Write, then 1,286 chars of text 3          yes    1           $0.045
    C continue_    nothing                         2          no     0           $0.044

  (a) No model call follows the halt; the control's extra turn is the one the halt removes.
  (b) A ResultMessage still arrives (`success`) with an EMPTY `result`: `stopReason` is not
      in it, so a plane that wants the patron to see the summary has to emit it itself.
  (c) The prototype's `continue_` spelling halts the same way.
  (d) The Stop hook does NOT fire after the halt, so a plane that labels the turn from its
      Stop hook must label a halted turn itself.
  (e) The PostToolUse `tool_response` is a dict: `content` (text blocks, unframed, no
      `agentId`/`<usage>` trailer; those reach only the model-facing tool result),
      `agentType`, `status`, usage counters. `agentType` came as `genealogy-research:citation`
      in A and C and `citation` in B, so both spellings occur.

Run 1 (same day) was VOID: it replaced the hooks wholesale, dropping `foreground_rewrite`, and
the control's Agent call ran async. Both runs together cost about $0.25.

Costs three short sessions. Needs a compiled engine (`make engine-build`) and a key in
$ANTHROPIC_API_KEY or eval/.env. Run from inside the checkout:

    cd apps/server && uv run python dev/probe_posttool_halt.py [--out PATH]
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

for parent in [Path.cwd(), *Path.cwd().parents]:
    if (parent / "apps" / "server" / "app" / "agent" / "real_agent.py").exists():
        REPO = parent
        break
else:
    sys.exit("run this from inside the cowork-genealogy checkout")

SERVER_DIR = REPO / "apps" / "server"
PLUGIN_DIR = REPO / "packages" / "engine" / "plugin"
ENGINE_BUILD = REPO / "packages" / "engine" / "mcp-server" / "build" / "index.js"
sys.path.insert(0, str(SERVER_DIR))


def api_key() -> str:
    """$ANTHROPIC_API_KEY, else eval/.env in this checkout or the main one (a worktree has
    none: it is gitignored). Copied from `probe_step_deny.py`, which cannot be imported: it
    runs its own billed probe at module level."""
    import subprocess

    key = os.environ.get("ANTHROPIC_API_KEY", "").strip().strip("\"'")
    if key:
        return key
    envs = [REPO / "eval" / ".env"]
    common = subprocess.run(
        ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
        cwd=str(REPO), capture_output=True, text=True, encoding="utf-8", timeout=10, check=False,
    ).stdout.strip()
    if common:
        envs.append(Path(common).parent / "eval" / ".env")
    for env in envs:
        if env.exists():
            for line in env.read_text(encoding="utf-8").splitlines():
                if line.startswith("ANTHROPIC_API_KEY="):
                    found = line.split("=", 1)[1].strip().strip("\"'")
                    if found:
                        return found
    sys.exit("no ANTHROPIC_API_KEY in $ANTHROPIC_API_KEY or " + ", ".join(map(str, envs)))

SENTINEL = "POSTTOOL_HALT_PROBE"
STOP_REASON = f"{SENTINEL}: the research is finished."
QUERY = (
    "Two things, in order.\n"
    "1. Delegate to the `citation` agent: format a source citation for the "
    "1880 United States Federal Census.\n"
    "2. Use the Write tool to create notes.txt containing the single line: done"
)
DELEGATIONS = ("Agent", "Task")
MODEL = os.environ.get("PROBE_MODEL", "claude-haiku-5-5")

ARMS = {
    "A-continue": {"continue": False, "stopReason": STOP_REASON},
    "B-control": {},
    "C-continue_": {"continue_": False, "stopReason": STOP_REASON},
}


async def run_arm(arm: str, *, key: str) -> dict:
    from claude_agent_sdk import (
        AssistantMessage,
        ClaudeSDKClient,
        HookMatcher,
        ResultMessage,
        ToolResultBlock,
        ToolUseBlock,
        UserMessage,
    )

    from app.agent import real_agent

    halt = ARMS[arm]
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        plugin = tmp / "plugin"
        shutil.copytree(PLUGIN_DIR, plugin)
        shutil.rmtree(plugin / "hooks", ignore_errors=True)
        project = tmp / "project"
        project.mkdir()
        real_agent._PLUGIN_DIR = str(plugin)
        real_agent._MCP_BUILD = str(ENGINE_BUILD)
        options = real_agent.build_options(project, api_key=key)
        options.model = MODEL

        seen: dict = {"posttool": [], "stops": 0}

        async def posttool(input_data, tool_use_id, _ctx):
            data = input_data or {}
            if data.get("tool_name") in DELEGATIONS and "agent_id" not in data:
                seen["posttool"].append({
                    "tool_use_id": tool_use_id,
                    "tool_input": data.get("tool_input"),
                    "tool_response": data.get("tool_response"),
                })
                return dict(halt)
            return {}

        async def stop(_input_data, _tool_use_id, _ctx):
            seen["stops"] += 1
            return {}

        # Production's own PreToolUse stays: its `foreground_rewrite` is what makes an Agent
        # call return the agent's report rather than an async launch receipt. Run 1 dropped
        # it and the control went async, so the arms could not be compared. Production's
        # Stop hook stays too (an empty project allows every stop); the probe's counter
        # rides beside it.
        options.hooks = dict(options.hooks or {})
        options.hooks["PostToolUse"] = [HookMatcher(matcher=None, hooks=[posttool], timeout=20)]
        options.hooks["Stop"] = [*options.hooks.get("Stop", []), HookMatcher(matcher=None, hooks=[stop], timeout=20)]

        stream: list[dict] = []
        result: dict = {}
        client = ClaudeSDKClient(options=options)
        await client.connect()
        try:
            await client.query(QUERY)
            async for msg in client.receive_response():
                if isinstance(msg, (AssistantMessage, UserMessage)):
                    for b in msg.content if isinstance(msg.content, list) else []:
                        if isinstance(b, ToolUseBlock):
                            stream.append({"kind": "use", "name": b.name, "id": b.id})
                        elif isinstance(b, ToolResultBlock):
                            stream.append({"kind": "result", "id": b.tool_use_id})
                        elif isinstance(msg, AssistantMessage) and getattr(b, "text", None):
                            stream.append({"kind": "text", "chars": len(b.text), "head": b.text[:200]})
                if isinstance(msg, ResultMessage):
                    result = {
                        "is_error": bool(getattr(msg, "is_error", False)),
                        "subtype": getattr(msg, "subtype", None),
                        "num_turns": getattr(msg, "num_turns", None),
                        "cost_usd": getattr(msg, "total_cost_usd", None),
                        "result_head": (getattr(msg, "result", None) or "")[:300],
                        "sentinel_in_result": SENTINEL in (getattr(msg, "result", None) or ""),
                    }
                    break
        finally:
            await client.disconnect()

    delegation_ids = [e["id"] for e in stream if e["kind"] == "use" and e["name"] in DELEGATIONS]
    after: list[dict] = []
    if delegation_ids:
        hit = False
        for e in stream:
            if e["kind"] == "result" and e["id"] == delegation_ids[0]:
                hit = True
                continue
            if hit and e["kind"] in ("use", "text"):
                after.append(e)
    return {
        "arm": arm,
        "delegated": len(delegation_ids),
        "write_done": any(e["kind"] == "use" and e["name"] == "Write" for e in stream),
        "after_agent_result": after,
        "result_message": result,
        "stop_hook_fired": seen["stops"],
        "posttool_calls": seen["posttool"],
    }


def verdict(arms: dict) -> str:
    b = arms["B-control"]
    if not all(a["delegated"] for a in arms.values()) or not b["write_done"]:
        return "VOID"
    halted = [not arms[k]["after_agent_result"] for k in ("A-continue", "C-continue_")]
    return "HALTS" if all(halted) else "LEAKS"


async def main() -> None:
    out = Path(sys.argv[sys.argv.index("--out") + 1]) if "--out" in sys.argv else Path("probe_posttool_halt.json")
    key = api_key()
    arms = {}
    for arm in ARMS:
        arms[arm] = await run_arm(arm, key=key)
        r = arms[arm]
        print(f"{arm}: delegated={r['delegated']} write_done={r['write_done']} "
              f"after_agent_result={[(e['kind'], e.get('name') or e.get('chars')) for e in r['after_agent_result']]} "
              f"stop_hook_fired={r['stop_hook_fired']} result={r['result_message']}")
    report = {"model": MODEL, "verdict": verdict(arms), "arms": arms}
    out.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    print(f"VERDICT: {report['verdict']}  (full output, Agent tool_response included: {out})")


if __name__ == "__main__":
    asyncio.run(main())

#!/usr/bin/env python3
"""Can a plugin agent spawn another agent in the hosted SDK loader, and is the
spawning tool granted as `Task` or `Agent` in its `tools:`? (issue #2817)

Answered 2026-09-23 against agent SDK 0.2.128 and its bundled Claude Code
2.1.220, hosted options: **a plugin agent can spawn another, and the tool is
`Agent` — a `Task` grant resolves to it.**

    arm    grant        verdict      called  drv msgs  leaf msgs  relayed
    task   Task         SPAWNED      Agent   3         0          PROBE_RESULT: CALLED 1751
    agent  Agent        SPAWNED      Agent   3         0          PROBE_RESULT: CALLED 1751
    both   Task+Agent   SPAWNED      Agent   3         0          PROBE_RESULT: CALLED 1751
    none   (none)       NOT SPAWNED          1         0          PROBE_RESULT: NO_SPAWN_TOOL

Three things follow:

1. `Task` is an alias. A driver granted only `Task` called a tool named
   `Agent`, so grant spelling and called name are not the same fact; either
   grant binds.
2. The SDK does not stream depth-2 messages. Nothing arrived with the leaf's
   spawn as its `parent_tool_use_id`, so the leaf's own `convert_calendar`
   call is invisible here; the depth-2 spawn itself is read off the driver's
   `Agent` tool_use and its non-error result, which carried the leaf's
   `CALLED 1751` line. A harness that must see what a nested agent did cannot
   read it from this stream.
3. The `none` driver never called `ToolSearch` despite its body; it reported
   `NO_SPAWN_TOOL` at once. Harmless to the verdict — `ToolSearch` cannot load
   an ungranted tool — but the arm is only as strong as "the tool was absent".

Cowork: unmeasured. Depth 3: unmeasured. Cost: $1.11 for the four arms
(each session loads the whole plugin). Re-run when the CLI or the SDK moves:
`make probe-agent-nesting`.

WHAT THE PROBE DOES

Four arms, one SDK session each, built from the hosted options
(`real_agent.build_options`, via `probe_agent_binding.build_arm_options`)
against a temp copy of the real plugin with five probe agents staged into it.
The main thread spawns `probe-driver-<arm>` (depth 1); the driver is told to
spawn `probe-leaf` (depth 2); the leaf calls `convert_calendar` with fixed
arguments, exactly as `probe_agent_binding.py`'s control arm does.

    arm     driver tools:                  question
    task    Read, ToolSearch, Task         does a `Task` grant spawn?
    agent   Read, ToolSearch, Agent        does an `Agent` grant spawn?
    both    Read, ToolSearch, Task, Agent  does either spawn?
    none    Read, ToolSearch               must NOT spawn (the control)

No driver holds `convert_calendar`, so a spawn grant that misses cannot turn
into an inline call that reads as success. Every driver holds `Read`, so a
miss never trips the zero-tools refusal, and `ToolSearch`, because the hosted
path runs with tool search on and the spawn tool might be deferred. The driver
body names no spawn tool, so the answer to "which name is called" is not fed
to it.

VERDICTS (read off the message stream, never the agents' prose)

  D is the main thread's spawn of the driver.

  SPAWNED      inside D, an `Agent`/`Task` tool_use targeting `probe-leaf` came
               back non-error. The row records the tool name called, which can
               differ from the grant spelling if one aliases the other.
  ATTEMPTED    the driver called a spawn tool and it errored.
  NOT SPAWNED  the driver's messages streamed and it made no spawn call — a
               result, not a failure of the probe.
  VOID         no D; D spawned more than once; the main thread spawned the leaf;
               `convert_calendar` was called by the main thread or the driver;
               no message streamed from inside D (the probe saw nothing); or D
               relayed `CALLED 1751` with no spawn visible inside D (the leaf ran
               and the detector is blind to it).

Arm `none` must not be SPAWNED, or the whole run is VOID.

Costs four short sessions. Needs a compiled engine (`make engine-build`) and a
key in $ANTHROPIC_API_KEY or eval/.env. Run it with `make probe-agent-nesting`.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import shutil
import sys
import tempfile
from pathlib import Path

import probe_agent_binding as binding  # also puts apps/server on sys.path
from p1._probe_common import one_line, result_text

SPAWN_TOOLS = ("Agent", "Task")
LEAF = "probe-leaf"

DRIVER_BODY = f"""
You are a delegation probe. Do exactly this, in order, and nothing else.

1. Delegate to the subagent whose type is exactly `{LEAF}`, using whatever
   agent-spawning tool you have. Give it this instruction, verbatim and
   complete: "Run your probe now."

2. If you see no agent-spawning tool, call `ToolSearch` once with the query
   `subagent`. If you still have none, output exactly
   `PROBE_RESULT: NO_SPAWN_TOOL` and stop.

3. When the subagent returns, output its final PROBE_RESULT line verbatim and
   nothing else.

Do not do the subagent's work yourself. Do not call any other tool. Do not ask
for permission. Do not explain.
""".strip()

DRIVER_DESCRIPTION = (
    "Internal delegation probe. Spawns probe-leaf once and relays its\n"
    "result line."
)

ARMS = {
    "task": ["Read", "ToolSearch", "Task"],
    "agent": ["Read", "ToolSearch", "Agent"],
    "both": ["Read", "ToolSearch", "Task", "Agent"],
    "none": ["Read", "ToolSearch"],
}

QUERY = (
    "Delegate to the subagent whose type is exactly \"probe-driver-{arm}\", "
    "using your agent-spawning tool. Give it this instruction, verbatim and "
    "complete:\n\n  Run your probe now.\n\n"
    "Do not call any tool other than your agent-spawning tool. Do not spawn "
    f"\"{LEAF}\" yourself and do not perform the probe's work yourself. When the "
    "subagent returns, repeat its final PROBE_RESULT line verbatim and stop."
)


def driver_name(arm: str) -> str:
    return f"probe-driver-{arm}"


def stage_agents(plugin: Path) -> None:
    agents = plugin / "agents"
    (agents / f"{LEAF}.md").write_text(
        binding.agent_md(LEAF, binding.SPELLINGS + ["ToolSearch"], []), encoding="utf-8")
    for arm, tools in ARMS.items():
        (agents / f"{driver_name(arm)}.md").write_text(
            binding.agent_md(driver_name(arm), tools, [],
                             body=DRIVER_BODY, description=DRIVER_DESCRIPTION),
            encoding="utf-8")


def _target(call: dict) -> str:
    return str(call["input"].get("subagent_type", ""))


def verdict(capture: dict, driver: str) -> dict:
    """The arm's verdict from the captured stream alone — no SDK objects.

    ``capture`` holds ``calls`` (tool_use_id -> {name, parent, input}),
    ``results`` (tool_use_id -> {is_error, text}) and ``msgs_by_parent``
    (parent_tool_use_id -> count of messages streamed under it).
    """
    calls, results, counts = capture["calls"], capture["results"], capture["msgs_by_parent"]

    def spawns(parent, target):
        return [cid for cid, c in calls.items()
                if c["parent"] == parent and c["name"] in SPAWN_TOOLS and _target(c) == target]

    main_driver = spawns(None, driver)
    row = {"verdict": "", "reason": "", "tool_called": "", "leaf_1751": False,
           "driver_msgs": 0, "leaf_msgs": 0, "driver_tools": [], "relayed": ""}

    def void(reason):
        row.update(verdict="VOID", reason=reason)
        return row

    if not main_driver:
        return void("the main thread never spawned the driver")
    if len(main_driver) > 1:
        return void(f"the main thread spawned the driver {len(main_driver)} times")
    d = main_driver[0]
    row["driver_msgs"] = counts.get(d, 0)
    row["relayed"] = one_line((results.get(d) or {}).get("text", "<no result>"))
    row["driver_tools"] = sorted({c["name"] for c in calls.values() if c["parent"] == d})

    if spawns(None, LEAF):
        return void("the main thread spawned the leaf itself")
    inline = [c["parent"] for c in calls.values()
              if c["name"].endswith(binding.TOOL) and c["parent"] in (None, d)]
    if inline:
        who = "main thread" if None in inline else "driver"
        return void(f"convert_calendar was called by the {who}, not the leaf")
    if row["driver_msgs"] == 0:
        return void("no message streamed from inside the driver; the probe saw nothing")

    driver_spawns = [cid for cid, c in calls.items()
                     if c["parent"] == d and c["name"] in SPAWN_TOOLS]
    if not driver_spawns:
        if "CALLED 1751" in row["relayed"]:
            return void("the driver relayed CALLED 1751 but no spawn was visible inside it")
        row.update(verdict="NOT SPAWNED",
                   reason=f"driver called {row['driver_tools'] or 'nothing'}")
        return row

    ok = [cid for cid in driver_spawns
          if _target(calls[cid]) == LEAF and cid in results and not results[cid]["is_error"]]
    if not ok:
        cid = driver_spawns[0]
        row.update(verdict="ATTEMPTED", tool_called=calls[cid]["name"],
                   reason=one_line((results.get(cid) or {}).get("text", "<no result>")))
        return row

    leaf = ok[0]
    row["tool_called"] = calls[leaf]["name"]
    row["leaf_msgs"] = counts.get(leaf, 0)
    row["leaf_1751"] = any(
        c["parent"] == leaf and c["name"].endswith(binding.TOOL)
        and cid in results and not results[cid]["is_error"] and "1751" in results[cid]["text"]
        for cid, c in calls.items())
    row["verdict"] = "SPAWNED"
    if row["leaf_msgs"] == 0:
        row["reason"] = "depth-2 stream not surfaced by the SDK"
    return row


async def run_arm(arm: str, key: str) -> dict:
    from claude_agent_sdk import (
        AssistantMessage,
        ClaudeSDKClient,
        ResultMessage,
        ToolResultBlock,
        ToolUseBlock,
        UserMessage,
    )

    capture: dict = {"calls": {}, "results": {}, "msgs_by_parent": {}}
    cost: dict = {"cost_usd": None, "num_turns": None, "usage": binding._usage_totals(None)}
    registered: list[str] = []
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        plugin = tmp / "plugin"
        shutil.copytree(binding.PLUGIN_DIR, plugin)
        stage_agents(plugin)
        project = tmp / "project"
        project.mkdir()
        config_dir = tmp / "config"
        config_dir.mkdir()
        options = binding.build_arm_options("hosted", plugin, project, config_dir, key, "true")

        client = ClaudeSDKClient(options=options)
        await client.connect()
        try:
            info = await client.get_server_info() or {}
            registered = sorted(a["name"] for a in info.get("agents", [])
                                if a["name"].startswith("probe-"))
            await client.query(QUERY.format(arm=arm))
            async for msg in client.receive_response():
                parent = getattr(msg, "parent_tool_use_id", None)
                if parent:
                    capture["msgs_by_parent"][parent] = capture["msgs_by_parent"].get(parent, 0) + 1
                if isinstance(msg, (AssistantMessage, UserMessage)):
                    for block in msg.content if isinstance(msg.content, list) else []:
                        if isinstance(block, ToolUseBlock):
                            capture["calls"][block.id] = {"name": block.name, "parent": parent,
                                                          "input": dict(block.input or {})}
                        elif isinstance(block, ToolResultBlock):
                            capture["results"][block.tool_use_id] = {
                                "is_error": bool(block.is_error),
                                "text": result_text(block.content)[:4000],
                            }
                if isinstance(msg, ResultMessage):
                    cost = {"cost_usd": msg.total_cost_usd, "num_turns": msg.num_turns,
                            "usage": binding._usage_totals(msg.usage)}
                    break
        finally:
            await client.disconnect()

    row = verdict(capture, driver_name(arm))
    return {"arm": arm, "grant": [t for t in ARMS[arm] if t in SPAWN_TOOLS] or ["(none)"],
            **row, "registered_probe_agents": registered, **cost,
            "calls": [{"id": cid, **c, "input": json.dumps(c["input"])[:300]}
                      for cid, c in capture["calls"].items()]}


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python dev/probe_agent_nesting.py",
        description="Can a plugin agent spawn another in the hosted loader, "
                    "and under which grant spelling? See the module docstring.",
    )
    p.add_argument("--version-only", action="store_true",
                   help="print the SDK / bundled CLI / resolved CLI path lines and exit")
    p.add_argument("--arm", choices=tuple(ARMS), action="append",
                   help="run only this arm (repeatable); default all four")
    return p


async def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    args = build_parser().parse_args()

    binding.print_versions()
    if args.version_only:
        return
    key = binding.api_key()
    if not key:
        sys.exit("no ANTHROPIC_API_KEY in env or eval/.env")
    if not binding.ENGINE_BUILD.exists():
        sys.exit(f"no compiled engine at {binding.ENGINE_BUILD} — run `make engine-build`")

    rows = []
    for arm in args.arm or ARMS:
        print(f"... running arm {arm}", flush=True)
        try:
            rows.append(await asyncio.wait_for(run_arm(arm, key), timeout=300))
        except Exception as exc:  # noqa: BLE001
            rows.append({"arm": arm, "grant": [], "verdict": "VOID",
                         "reason": f"{type(exc).__name__}: {exc}", "tool_called": "",
                         "leaf_1751": False, "driver_msgs": 0, "leaf_msgs": 0})

    print("\n" + "=" * 100)
    print(f"{'arm':<7}{'grant':<14}{'verdict':<13}{'called':<8}{'leaf 1751':<11}"
          f"{'drv msgs':<10}{'leaf msgs':<11}reason")
    print("-" * 100)
    for r in rows:
        print(f"{r['arm']:<7}{'+'.join(r['grant']):<14}{r['verdict']:<13}{r['tool_called']:<8}"
              f"{str(r['leaf_1751']):<11}{r['driver_msgs']:<10}{r['leaf_msgs']:<11}"
              f"{r['reason'][:60]}")
    print("=" * 100)
    cost = sum(r["cost_usd"] for r in rows if isinstance(r.get("cost_usd"), (int, float)))
    print(f"cost_usd={cost:.4f}")
    print("\nfull rows:")
    for r in rows:
        print(json.dumps(r, indent=2))

    control = [r for r in rows if r["arm"] == "none"]
    if any(r["verdict"] == "SPAWNED" for r in control):
        print("\n*** RUN IS VOID: the `none` control spawned. The detector cannot say no. ***")
    elif any(r["verdict"] == "VOID" for r in rows):
        print("\n*** At least one arm is VOID; its row is not a result. Fix the probe and re-run. ***")


if __name__ == "__main__":
    asyncio.run(main())

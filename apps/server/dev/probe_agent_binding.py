#!/usr/bin/env python3
"""Does an agent's `tools:` allow-list -- and its `disallowedTools:` deny -- bind
under `permission_mode="bypassPermissions"`, which the hosted path runs?

Answered 2026-08-30 against Claude Code 2.1.251 / agent SDK 0.2.128:
**both bind**, reproduced twice.

    arm               tool_search  verdict   probe line
    probe-a-control   false        CALLED    PROBE_RESULT: CALLED 1751
    probe-b-deny      false        BLOCKED   subagent could not be spawned
    probe-c-omit      false        BLOCKED   PROBE_RESULT: ABSENT
    probe-a-control   true         CALLED    PROBE_RESULT: CALLED 1751
    probe-b-deny      true         BLOCKED   PROBE_RESULT: ABSENT
    probe-c-omit      true         BLOCKED   PROBE_RESULT: ABSENT

Two things that follow, both of which corrected the docs:

1. A tool merely OMITTED from `tools:` is absent from the agent under
   `bypassPermissions` (arm C). The repo said the opposite -- "a deny binds even
   under bypassPermissions; an omission alone is not" -- across CLAUDE.md, the
   architecture doc, three ADRs, two specs, the packaging test and three agent
   bodies, seven of which cited issue #695 for it. That issue is the birkeland
   lane breach and says nothing about bypassPermissions, denies, or omissions.
   So `disallowedTools:` was redundant with omitting the tool, and all five
   blocks were deleted in the same change -- every one named a tool already
   absent from its agent's `tools:`.
2. The deny is applied BEFORE the zero-tools spawn check. Arm B granted the
   tool under all three spellings plus `ToolSearch` and denied the same tool;
   with tool search off the runtime refused the agent outright -- "would be
   spawned with zero tools -- refusing. Its tools list resolved to nothing:
   unrecognized [ToolSearch]" -- naming only `ToolSearch`, because the deny had
   already removed the three MCP entries. Guarded by the "never denies a tool it
   also grants" case in `tests/packaging/agent-tool-names.test.ts`.

Re-run it when the CLI or the SDK moves, or before adding a deny on the
strength of it binding: `make probe-agent-binding`.

WHAT THE PROBE DOES

Six arms = three frontmatter configurations x two ENABLE_TOOL_SEARCH settings.
Each arm is its own SDK session built from the EXACT hosted options
(`real_agent.build_options`), against a temp copy of the real plugin with three
extra probe agents staged into it, driven by one query that delegates to one of
them.

The probe tool is `convert_calendar` -- pure computation, no auth, no network,
no project state, and it writes nothing. Its arguments are fixed in the agent
body so a wrong-arguments failure can never be read as a deny. A correct call
returns converted year 1751, and the verdict reads that off the `tool_result`
in the message stream rather than off the agent's prose, which the model could
otherwise assert without having called anything.

VERDICTS

  CALLED  - a `convert_calendar` tool_result came back non-error carrying 1751,
            from inside the subagent (`parent_tool_use_id` set)
  BLOCKED - no such result: the tool was absent from the agent, refused, or the
            agent could not be spawned
  VOID    - the main thread never delegated, or called the tool itself

Arm A is the control. If it is not CALLED the run proves nothing, and the
script says so rather than letting the other rows be read.

Costs six short sessions (~13k subagent tokens). Needs a compiled engine
(`make engine-build`) and a key in $ANTHROPIC_API_KEY or eval/.env.
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve()
# Allow running from anywhere: locate the repo by walking up for apps/server.
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
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if key:
        return key
    env = REPO / "eval" / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("ANTHROPIC_API_KEY="):
                return line.split("=", 1)[1].strip()
    return ""


# ── the three frontmatter configurations ─────────────────────────────

TOOL = "convert_calendar"
SPELLINGS = [
    f"mcp__genealogy__{TOOL}",
    f"mcp__remote-devices__Genealogy_Research__{TOOL}",
    f"mcp__Genealogy_Research__{TOOL}",
]

BODY = """
You are a capability probe. Do exactly this, in order, and nothing else.

1. Look for a tool named `convert_calendar`. It may appear under a prefixed
   name such as `mcp__genealogy__convert_calendar`. If you do not see it in
   your available tools, call `ToolSearch` once with the query
   `+convert_calendar` to try to load it.

2. If you now have that tool, call it EXACTLY ONCE with EXACTLY these
   arguments and no others:

   {"date": {"year": 1750, "doubleYear": 1}, "corrections": {"doubleDatedYear": true}}

3. Then output ONE line and nothing else:
   - if the call returned a result, write:  PROBE_RESULT: CALLED <converted year>
   - if the tool is not available to you at all, write:  PROBE_RESULT: ABSENT
   - if the call was refused, blocked, or denied, write:  PROBE_RESULT: REFUSED <exact refusal text>

Do not retry. Do not call any tool other than the two named above. Do not ask
for permission. Do not explain. Do not do anything else.
""".strip()


def agent_md(name: str, tools: list[str], denied: list[str]) -> str:
    lines = [
        "---",
        f"name: {name}",
        "description: >-",
        "  Internal capability probe. Calls convert_calendar once with fixed",
        "  arguments and reports whether the tool was available.",
        "model: claude-sonnet-4-6",
        "tools:",
    ]
    lines += [f"  - {t}" for t in tools]
    if denied:
        lines.append("disallowedTools:")
        lines += [f"  - {t}" for t in denied]
    lines += ["---", "", BODY, ""]
    return "\n".join(lines)


ARMS = {
    # A: granted, not denied. The control. If this is not CALLED, the whole run is VOID.
    "probe-a-control": (SPELLINGS + ["ToolSearch"], []),
    # B: granted AND denied. Does `disallowedTools:` bind under bypassPermissions?
    "probe-b-deny": (SPELLINGS + ["ToolSearch"], SPELLINGS),
    # C: neither granted nor denied. Does the `tools:` allow-list bind under bypassPermissions?
    "probe-c-omit": (["Read", "ToolSearch"], []),
}

QUERY = (
    "Use the Task tool to delegate to the subagent whose type is exactly "
    '"{name}". Give it this instruction, verbatim and complete:\n\n'
    "  Run your probe now.\n\n"
    "Do not call any tool other than Task. Do not perform the probe's work "
    "yourself. When the subagent returns, repeat its final PROBE_RESULT line "
    "verbatim and stop."
)


async def run_arm(name: str, tool_search: str, key: str) -> dict:
    from claude_agent_sdk import (
        AssistantMessage,
        ClaudeSDKClient,
        ResultMessage,
        ToolResultBlock,
        ToolUseBlock,
        UserMessage,
    )
    from app.agent import real_agent

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        plugin = tmp / "plugin"
        shutil.copytree(PLUGIN_DIR, plugin)
        for agent_name, (tools, denied) in ARMS.items():
            (plugin / "agents" / f"{agent_name}.md").write_text(
                agent_md(agent_name, tools, denied), encoding="utf-8"
            )
        project = tmp / "project"
        project.mkdir()

        real_agent._PLUGIN_DIR = str(plugin)
        real_agent._MCP_BUILD = str(ENGINE_BUILD)
        options = real_agent.build_options(project, api_key=key)
        options.env["ENABLE_TOOL_SEARCH"] = tool_search

        calls: dict[str, dict] = {}   # tool_use_id -> {name, parent}
        results: dict[str, dict] = {} # tool_use_id -> {is_error, text}
        text_lines: list[str] = []
        saw_subagent_msg = False
        registered: list[str] = []

        client = ClaudeSDKClient(options=options)
        await client.connect()
        try:
            info = await client.get_server_info() or {}
            registered = sorted(a["name"] for a in info.get("agents", []))
            await client.query(QUERY.format(name=name))
            async for msg in client.receive_response():
                parent = getattr(msg, "parent_tool_use_id", None)
                if parent:
                    saw_subagent_msg = True
                if isinstance(msg, (AssistantMessage, UserMessage)):
                    for block in msg.content if isinstance(msg.content, list) else []:
                        if isinstance(block, ToolUseBlock):
                            calls[block.id] = {"name": block.name, "parent": parent,
                                               "input": json.dumps(block.input)[:600]}
                        elif isinstance(block, ToolResultBlock):
                            results[block.tool_use_id] = {
                                "is_error": bool(block.is_error),
                                "text": json.dumps(block.content)[:4000],
                            }
                        elif getattr(block, "text", None):
                            text_lines.append(block.text)
                if isinstance(msg, ResultMessage):
                    break
        finally:
            await client.disconnect()

    subagent_tools = sorted({c["name"] for c in calls.values() if c["parent"]})
    main_tools = sorted({c["name"] for c in calls.values() if not c["parent"]})
    delegation = [
        {"name": c["name"], "input": c["input"],
         "result": (results.get(cid) or {}).get("text", "<no result>")[:1500],
         "is_error": (results.get(cid) or {}).get("is_error")}
        for cid, c in calls.items()
        if not c["parent"] and c["name"] in ("Task", "Agent")
    ]
    saw_delegation = saw_subagent_msg or bool(delegation)
    ok, from_subagent = False, False
    for cid, call in calls.items():
        if not call["name"].endswith(TOOL):
            continue
        res = results.get(cid)
        if res and not res["is_error"] and "1751" in res["text"]:
            ok = True
            from_subagent = from_subagent or bool(call["parent"])
    probe_line = next(
        (ln.strip() for blob in reversed(text_lines)
         for ln in reversed(blob.splitlines()) if "PROBE_RESULT" in ln),
        "",
    )

    if not saw_delegation:
        verdict = "VOID (main thread never delegated)"
    elif ok and not from_subagent:
        verdict = "VOID (tool call came from the main thread, not the subagent)"
    elif ok:
        verdict = "CALLED"
    else:
        verdict = "BLOCKED"

    return {
        "arm": name,
        "tool_search": tool_search,
        "verdict": verdict,
        "probe_line": probe_line,
        "subagent_tool_calls": subagent_tools,
        "main_thread_tool_calls": main_tools,
        "delegation_calls": delegation,
        "final_text": " | ".join(t.strip().replace("\n", " ") for t in text_lines)[-1200:],
        "registered_probe_agents": [a for a in registered if a.startswith("probe-")],
    }


async def main() -> None:
    key = api_key()
    if not key:
        sys.exit("no ANTHROPIC_API_KEY in env or eval/.env")
    if not ENGINE_BUILD.exists():
        sys.exit(f"no compiled engine at {ENGINE_BUILD} — run `make engine-build`")

    rows = []
    for tool_search in ("false", "true"):
        for name in ARMS:
            print(f"... running {name}  ENABLE_TOOL_SEARCH={tool_search}", flush=True)
            try:
                rows.append(await asyncio.wait_for(run_arm(name, tool_search, key), timeout=300))
            except Exception as exc:  # noqa: BLE001
                rows.append({"arm": name, "tool_search": tool_search,
                             "verdict": f"VOID ({type(exc).__name__}: {exc})",
                             "probe_line": "", "subagent_tool_calls": [],
                             "registered_probe_agents": []})

    print("\n" + "=" * 78)
    print(f"{'arm':<18}{'tool_search':<13}{'verdict':<12}probe line")
    print("-" * 78)
    for r in rows:
        print(f"{r['arm']:<18}{r['tool_search']:<13}{r['verdict'][:11]:<12}{r['probe_line'][:34]}")
    print("=" * 78)
    print("\nfull rows:")
    for r in rows:
        print(json.dumps(r, indent=2))

    controls = [r for r in rows if r["arm"] == "probe-a-control"]
    if any(r["verdict"] != "CALLED" for r in controls):
        print("\n*** RUN IS VOID: the control arm did not call the tool. "
              "Nothing else on this table means anything. ***")


if __name__ == "__main__":
    asyncio.run(main())

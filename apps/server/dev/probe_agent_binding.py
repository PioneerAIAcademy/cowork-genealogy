#!/usr/bin/env python3
"""Does an agent's `tools:` allow-list -- and its `disallowedTools:` deny -- bind
under `permission_mode="bypassPermissions"`, which the hosted path runs?

Answered 2026-08-30 against agent SDK 0.2.128 and its bundled Claude Code 2.1.220
(an earlier docstring said 2.1.251 -- the PATH `claude --version`, which the SDK never
spawns; since 2026-09-10 the run prints the resolved binary): **both bind**, reproduced
twice, and again on 2026-09-10 under the prototype option set (`agents=`,
`setting_sources=[]`, `plugins=[...]`, `--option-set prototype`):

    option_set  arm               tool_search  verdict   probe line
    hosted      probe-a-control   false        CALLED    PROBE_RESULT: CALLED 1751
    hosted      probe-b-deny      false        BLOCKED   subagent could not be spawned
    hosted      probe-c-omit      false        BLOCKED   PROBE_RESULT: ABSENT
    hosted      probe-a-control   true         CALLED    PROBE_RESULT: CALLED 1751
    hosted      probe-b-deny      true         BLOCKED   PROBE_RESULT: ABSENT
    hosted      probe-c-omit      true         BLOCKED   PROBE_RESULT: ABSENT
    prototype   probe-a-control   false        CALLED    PROBE_RESULT: CALLED 1751
    prototype   probe-b-deny      false        BLOCKED
    prototype   probe-c-omit      false        BLOCKED
    prototype   probe-a-control   true         CALLED    PROBE_RESULT: CALLED 1751
    prototype   probe-b-deny      true         BLOCKED
    prototype   probe-c-omit      true         BLOCKED

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
Each arm is its own SDK session built from the hosted options
(`real_agent.build_options`) or, with `--option-set prototype`, from the prototype set
(`dev.p1.options.build_prototype_options`), against a temp copy of the real plugin with three
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

import argparse
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

OPTION_SETS = ("hosted", "prototype")


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


def print_versions() -> None:
    """The SDK, the CLI it bundles, and the CLI binary it will actually spawn.

    `_find_cli()` is resolved off a transport instance whose constructor only
    records its arguments -- nothing is spawned, so this costs no session and
    no tokens. The third line says whether that path IS the bundled binary,
    because `__cli_version__` describes the bundled one and nothing else.
    """
    import claude_agent_sdk
    from claude_agent_sdk import ClaudeAgentOptions
    from claude_agent_sdk._cli_version import __cli_version__
    from claude_agent_sdk._internal.transport.subprocess_cli import SubprocessCLITransport

    cli = SubprocessCLITransport(prompt="", options=ClaudeAgentOptions())._find_cli()
    bundled_dir = (Path(claude_agent_sdk.__file__).parent / "_bundled").resolve()
    is_bundled = Path(cli).resolve().parent == bundled_dir
    print(f"claude-agent-sdk {claude_agent_sdk.__version__}")
    print(f"bundled Claude Code CLI {__cli_version__}")
    print(
        f"_find_cli() -> {cli} "
        + ("(the bundled binary)" if is_bundled
           else "(NOT the bundled binary -- __cli_version__ does not describe it)")
    )


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


def _usage_totals(usage: dict | None) -> dict[str, int]:
    keys = ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens")
    out = {k: 0 for k in keys}
    for k in keys:
        v = (usage or {}).get(k)
        if isinstance(v, (int, float)):
            out[k] = int(v)
    return out


def build_arm_options(option_set: str, plugin: Path, project: Path, config_dir: Path,
                      key: str, tool_search: str):
    """The session options for one arm under one option set.

    ``config_dir`` is the prototype set's ``CLAUDE_CONFIG_DIR``. The caller owns
    it (it sits inside the arm's temp dir), so a failure here leaks nothing.
    """
    from app.agent import real_agent

    if option_set == "hosted":
        real_agent._PLUGIN_DIR = str(plugin)
        real_agent._MCP_BUILD = str(ENGINE_BUILD)
        options = real_agent.build_options(project, api_key=key)
    elif option_set == "prototype":
        from dev.p1.options import build_prototype_options

        options = build_prototype_options(
            project,
            api_key=key,
            store=None,
            config_dir=config_dir,
            plugin_dir=str(plugin),
            mcp_build=str(ENGINE_BUILD),
        )
        # Arm B is the only definition with a deny. If the loader dropped it, the
        # bare-name definition the query targets would be arm A under another name.
        dropped = [
            n for n, (_tools, denied) in ARMS.items()
            if denied and not getattr((options.agents or {}).get(n), "disallowedTools", None)
        ]
        if dropped:
            raise RuntimeError(f"load_agent_definitions carried no disallowedTools for {dropped}")
    else:
        raise ValueError(f"unknown option set {option_set!r}")

    options.env["ENABLE_TOOL_SEARCH"] = tool_search
    return options


async def run_arm(name: str, tool_search: str, key: str, option_set: str) -> dict:
    from claude_agent_sdk import (
        AssistantMessage,
        ClaudeSDKClient,
        ResultMessage,
        ToolResultBlock,
        ToolUseBlock,
        UserMessage,
    )

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
        config_dir = tmp / "config"
        config_dir.mkdir()

        options = build_arm_options(option_set, plugin, project, config_dir, key, tool_search)

        calls: dict[str, dict] = {}   # tool_use_id -> {name, parent}
        results: dict[str, dict] = {} # tool_use_id -> {is_error, text}
        text_lines: list[str] = []
        saw_subagent_msg = False
        registered: list[str] = []
        cost: dict = {"cost_usd": None, "duration_ms": None, "num_turns": None,
                      "usage": _usage_totals(None)}

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
                    cost = {
                        "cost_usd": msg.total_cost_usd,
                        "duration_ms": msg.duration_ms,
                        "num_turns": msg.num_turns,
                        "usage": _usage_totals(msg.usage),
                    }
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
        "option_set": option_set,
        "arm": name,
        "tool_search": tool_search,
        "verdict": verdict,
        "probe_line": probe_line,
        "subagent_tool_calls": subagent_tools,
        "main_thread_tool_calls": main_tools,
        "delegation_calls": delegation,
        "final_text": " | ".join(t.strip().replace("\n", " ") for t in text_lines)[-1200:],
        "registered_probe_agents": [a for a in registered if a.startswith("probe-")],
        **cost,
    }


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python dev/probe_agent_binding.py",
        description="Do an agent's tools:/disallowedTools: bind under bypassPermissions? "
                    "Six arms per option set; see the module docstring.",
    )
    p.add_argument(
        "--option-set", choices=(*OPTION_SETS, "both"), default="both",
        help="hosted = real_agent.build_options (staged agents, setting_sources=['project']); "
             "prototype = dev.p1.options.build_prototype_options (agents=, setting_sources=[], "
             "fresh CLAUDE_CONFIG_DIR per arm); default both",
    )
    p.add_argument(
        "--version-only", action="store_true",
        help="print the SDK / bundled CLI / resolved CLI path lines and exit (no session)",
    )
    return p


def _print_cost_totals(rows: list[dict]) -> None:
    print("\ntoken / cost totals (from ResultMessage; a VOID-by-exception arm contributes nothing):")
    groups = [(s, [r for r in rows if r.get("option_set") == s]) for s in OPTION_SETS]
    groups = [(s, rs) for s, rs in groups if rs] + [("all", rows)]
    for label, rs in groups:
        usage = {k: sum((r.get("usage") or {}).get(k, 0) for r in rs)
                 for k in _usage_totals(None)}
        cost = sum(r["cost_usd"] for r in rs if isinstance(r.get("cost_usd"), (int, float)))
        priced = sum(1 for r in rs if isinstance(r.get("cost_usd"), (int, float)))
        print(
            f"  {label:<10} arms={len(rs)} priced={priced} cost_usd={cost:.4f} "
            f"input={usage['input_tokens']} cache_create={usage['cache_creation_input_tokens']} "
            f"cache_read={usage['cache_read_input_tokens']} output={usage['output_tokens']}"
        )


async def main() -> None:
    # The house pattern (`eval/harness/e2e/author.py`). A Windows console defaults
    # to cp1252 and dies on the arrows and box glyphs this module prints; the team
    # it is written for is on Windows. Guarded by test_encoding_lint.py.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    args = build_parser().parse_args()

    print_versions()
    if args.version_only:
        return

    key = api_key()
    if not key:
        sys.exit("no ANTHROPIC_API_KEY in env or eval/.env")
    if not ENGINE_BUILD.exists():
        sys.exit(f"no compiled engine at {ENGINE_BUILD} — run `make engine-build`")

    option_sets = list(OPTION_SETS) if args.option_set == "both" else [args.option_set]
    rows = []
    for option_set in option_sets:
        for tool_search in ("false", "true"):
            for name in ARMS:
                print(f"... running {option_set}/{name}  ENABLE_TOOL_SEARCH={tool_search}",
                      flush=True)
                try:
                    rows.append(await asyncio.wait_for(
                        run_arm(name, tool_search, key, option_set), timeout=300))
                except Exception as exc:  # noqa: BLE001
                    rows.append({"option_set": option_set, "arm": name,
                                 "tool_search": tool_search,
                                 "verdict": f"VOID ({type(exc).__name__}: {exc})",
                                 "probe_line": "", "subagent_tool_calls": [],
                                 "registered_probe_agents": []})

    print("\n" + "=" * 90)
    print(f"{'option_set':<12}{'arm':<18}{'tool_search':<13}{'verdict':<12}probe line")
    print("-" * 90)
    for r in rows:
        print(f"{r['option_set']:<12}{r['arm']:<18}{r['tool_search']:<13}"
              f"{r['verdict'][:11]:<12}{r['probe_line'][:34]}")
    print("=" * 90)
    _print_cost_totals(rows)
    print("\nfull rows:")
    for r in rows:
        print(json.dumps(r, indent=2))

    for option_set in option_sets:
        controls = [r for r in rows
                    if r["option_set"] == option_set and r["arm"] == "probe-a-control"]
        if any(r["verdict"] != "CALLED" for r in controls):
            print(f"\n*** {option_set.upper()} RUN IS VOID: its control arm did not call the "
                  "tool. Nothing else in that option set's rows means anything. ***")


if __name__ == "__main__":
    asyncio.run(main())

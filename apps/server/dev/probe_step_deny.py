#!/usr/bin/env python3
"""Phase 0, the one question the committed corpus cannot answer.

`docs/plan/research-step-mode.md` makes every turn end at a step boundary, and on
the hosted planes the boundary is a `PreToolUse` **deny** on the delegation that
would start the next step. Most of what that needs is already measured for free:

  * the SDK honours a plain deny on `Agent`/`Task`, the reason text reaches the
    model, and the session closes cleanly afterwards -- the unit harness does
    exactly this on every stubbed spawn (`skill_runner.py:497-512`,
    `skill_stubs.py:107-125`), through the same `hooks=` path both hosted planes
    bind, across committed billed suites;
  * the arm order, and its input-shape dependence, are unit facts
    (`apps/server/tests/test_step_boundary_premises.py`).

What none of that covers is the INSTRUCTION. Every stub tells the model to carry
on and finish; a step boundary tells it the opposite -- report and end. Whether
the model actually ends is prompt-following behaviour, and only a live turn
answers it.

ARM A / ARM B

  A  the hook denies the delegation with a report-and-end reason
  B  the same turn, deny disarmed

B is not decoration. If the turn ends in B too, the ending was not the deny --
the model simply had nothing more to do -- and A proves nothing. That is the
attribution discipline `probe_hook_binding.py` established after its own arm B
caught a tool's refusal being read as a hook's.

THREE THINGS THIS DELIBERATELY DOES NOT DO

  * **No Stop hook.** Both planes veto a voluntary stop while `research.json` is
    not `completed` (alpha `_DEFAULT_MAX_NUDGES = 30`, `real_agent.py:608`;
    text `CONTINUE_REASON`, `continue_policy.py:330` -- "keep going"). Left
    armed, the model would be denied, report, try to stop, and be nudged onward
    up to 30 times: the probe would record "retried" caused by the veto's own
    instruction, not by the deny. PR 1 DELETES the veto, so measuring with it
    armed would record a world PR 1 does not ship. The project is also left
    empty, so `read_research_json` -> None would allow the stop anyway
    (`continue_policy.py:266`) -- belt and braces, because this is the single
    confound that would invert the result.

  * **No instruction about what to do after a deny.** The prompt sets up the
    delegation and stops talking. `probe_hook_binding.py`'s QUERY commands "Do
    not retry... Do not do anything else", which for THAT probe is right -- it
    measures the deny, not the model -- and here would make the answer true by
    construction.

  * **No verdict read off the model's prose.** "Ended" is a non-error
    `ResultMessage`; "retried by another route" is a streamed `ToolUseBlock`
    after the deny. Read off the stream, not off the wrapped hook, because the
    alpha's matcher omits `Skill` (`real_agent.py:255-262`) so a Skill-route
    retry is invisible to the hook and visible on the stream.

VERDICTS

  ENDS          A: denied, no further tool call, non-error result. B: did not end
                on the deny (there was none), so the ending in A is attributable.
  RETRIES       A: denied, then another tool call. Names the route.
  VOID          the model never delegated, or B is indistinguishable from A.

STATUS: NOT YET RUN -- no answer recorded here yet

Unlike `probe_hook_binding.py`, whose docstring carries its 2026-09-09 result,
this one has measured nothing. It could not run on the machine it was written on:
no `ANTHROPIC_API_KEY` in the environment and no `eval/.env`. That is not an
oversight to route around -- `build_options` -> `_sdk_env` (`real_agent.py:588`)
always hardwires `ANTHROPIC_API_KEY` into the SDK subprocess, so this path is
API-key-billed by construction, with no subscription route through it.

**When it is run, write the verdict into this docstring**, in the table form the
sibling probe uses, so the answer lives with the instrument rather than in a
chat log -- and record it in ADR-0005 beside the 2026-07-30 Cowork findings, as
phase 0 asks. Until then, treat every question above as open.

Costs two short sessions. Needs a compiled engine (`make engine-build`) and a key
in $ANTHROPIC_API_KEY or eval/.env.
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

# The sentinel makes the deny attributable to THIS probe. Generated here rather
# than imported, because nothing in the product emits a step-boundary reason yet.
SENTINEL = "STEP_BOUNDARY_PROBE"
DENY_REASON = (
    f"{SENTINEL}: this step is complete. Report what you did in one short "
    "paragraph, then end your turn."
)

# Sets up the delegation and says nothing about what follows. `citation` is a
# real staged agent and the cheapest one that cannot be done convincingly
# inline, so the model has a reason to actually delegate.
QUERY = (
    "Delegate this to the `citation` agent: format a source citation for the "
    "1880 United States Federal Census."
)

DELEGATIONS = ("Agent", "Task")


def api_key() -> str:
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip().strip("\"'")
    if key:
        return key
    env = REPO / "eval" / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("ANTHROPIC_API_KEY="):
                return line.split("=", 1)[1].strip().strip("\"'")
    sys.exit("no ANTHROPIC_API_KEY (env or eval/.env)")


async def run_arm(*, deny: bool, key: str) -> dict:
    from claude_agent_sdk import (
        AssistantMessage,
        ClaudeSDKClient,
        ResultMessage,
        ToolResultBlock,
        ToolUseBlock,
        UserMessage,
    )
    from app.agent import real_agent

    arm = "A-deny" if deny else "B-control"
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        plugin = tmp / "plugin"
        shutil.copytree(PLUGIN_DIR, plugin)
        # The plugin's own PreToolUse would fire alongside the probe's and make a
        # deny unattributable. Same reason the precedent clears options.hooks.
        shutil.rmtree(plugin / "hooks", ignore_errors=True)
        project = tmp / "project"
        project.mkdir()  # EMPTY: no research.json, so no stop is vetoed

        real_agent._PLUGIN_DIR = str(plugin)
        real_agent._MCP_BUILD = str(ENGINE_BUILD)
        options = real_agent.build_options(project, api_key=key)

        denied_ids: list[str] = []

        async def probe_hook(input_data, tool_use_id, ctx):
            name = (input_data or {}).get("tool_name", "")
            # Main thread only: `agent_id` is absent there, the discriminator the
            # shipped hook and the worker's decision arm both use. A subagent's
            # own delegation is not a step boundary.
            if deny and name in DELEGATIONS and "agent_id" not in (input_data or {}):
                denied_ids.append(tool_use_id or name)
                return {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": DENY_REASON,
                    }
                }
            return {}

        from claude_agent_sdk import HookMatcher

        # ONLY the probe's PreToolUse. No Stop hook: see the docstring.
        options.hooks = {
            "PreToolUse": [HookMatcher(matcher=None, hooks=[probe_hook], timeout=20)]
        }

        stream: list[dict] = []
        text: list[str] = []
        result = {}

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
                            stream.append({
                                "kind": "result",
                                "id": b.tool_use_id,
                                "is_error": bool(b.is_error),
                                "text": json.dumps(b.content)[:700],
                            })
                        elif getattr(b, "text", None):
                            text.append(b.text)
                if isinstance(msg, ResultMessage):
                    result = {
                        "is_error": bool(getattr(msg, "is_error", False)),
                        "subtype": getattr(msg, "subtype", None),
                        "num_turns": getattr(msg, "num_turns", None),
                        "cost_usd": getattr(msg, "total_cost_usd", None),
                    }
                    break
        finally:
            await client.disconnect()

    uses = [e for e in stream if e["kind"] == "use"]
    delegated = [e for e in uses if e["name"] in DELEGATIONS]
    # Everything the model called AFTER the first denied delegation. This is the
    # retry signal, and it is read here rather than from the hook so a
    # Skill-route retry (which the alpha's matcher never sees) still counts.
    after: list[dict] = []
    if denied_ids:
        seen = False
        for e in stream:
            if e["kind"] == "use" and e["id"] in denied_ids:
                seen = True
                continue
            if seen and e["kind"] == "use":
                after.append(e)

    return {
        "arm": arm,
        "delegated": [e["name"] for e in delegated],
        "denied": len(denied_ids),
        "tools_after_deny": [e["name"] for e in after],
        "result": result,
        "sentinel_reached_model": any(
            SENTINEL in (e.get("text") or "") for e in stream if e["kind"] == "result"
        ),
        "text_tail": (" ".join(text))[-400:],
    }


def verdict(a: dict, b: dict) -> str:
    if not a["delegated"]:
        return "VOID: the model never delegated in arm A, so nothing was denied"
    if not a["denied"]:
        return "VOID: a delegation happened but the probe hook never denied it"
    if not a["sentinel_reached_model"]:
        return "VOID: the deny fired but its reason never reached the model"
    if b["denied"]:
        return "VOID: the control arm denied too -- attribution broken"
    if a["tools_after_deny"]:
        return f"RETRIES: called {a['tools_after_deny']} after the deny"
    if a["result"].get("is_error"):
        return f"ENDS-IN-ERROR: result subtype={a['result'].get('subtype')!r}"
    return "ENDS: denied, no further tool call, non-error result"


async def main() -> int:
    if not ENGINE_BUILD.exists():
        sys.exit(f"no engine build at {ENGINE_BUILD} -- run `make engine-build`")
    key = api_key()
    print(f"prompt: {QUERY}\n")
    a = await run_arm(deny=True, key=key)
    print("ARM A:", json.dumps(a, indent=2)[:1500], "\n")
    b = await run_arm(deny=False, key=key)
    print("ARM B:", json.dumps(b, indent=2)[:1500], "\n")
    v = verdict(a, b)
    cost = sum(x["result"].get("cost_usd") or 0 for x in (a, b))
    print("=" * 66)
    print(f"VERDICT: {v}")
    print(f"cost: ${cost:.4f}")
    print("=" * 66)
    return 0 if v.startswith(("ENDS", "RETRIES")) else 2


sys.exit(asyncio.run(main()))

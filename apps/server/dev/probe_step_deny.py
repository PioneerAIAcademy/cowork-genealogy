#!/usr/bin/env python3
"""Phase 0, the one question the committed corpus cannot answer.

`docs/plan/research-step-mode.md` makes every turn end at a step boundary, and on
the hosted planes the boundary is a `PreToolUse` **deny** on the delegation that
would start the next step. Most of what that needs is already measured for free:

  * the SDK honours a plain deny on `Agent`/`Task`, the reason text reaches the
    model, and the session closes cleanly afterwards -- the unit harness does
    exactly this on every stubbed spawn (`skill_runner.spawn_stub_denial`,
    `skill_stubs.stub_denial`), through the same `hooks=` path both hosted planes
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

ANSWERED 2026-10-19, alpha plane. A DENY IS NOT A STEP BOUNDARY.

    run  prompt            arm A (denied)                       verdict
    1    one task          no further tool call, clean end      ENDS*
    2    two tasks         Write + research_delivered after     LEAKS
                           the deny; second task DONE

    * run 1 is not evidence. Its control ended after one delegation too, because
      a single-task prompt leaves nothing to do either way -- "no retry" was
      attributable, "it ended" was not. That is why run 2 queued a second task.

**Run 2 is the result.** Denied at the boundary, the model reported the failure,
then carried straight on: it did the queued `Write` AND called
`research_delivered`. The control did the second task too, so arm A skipping it
would have been meaningful -- it did not skip it. The boundary leaked.

So the design premise in `research-step-mode.md` -- "the boundary is a deny on
the delegation that would start the next step" -- is FALSIFIED for the only case
that matters, a turn with more than one thing to do. A deny is a tool RESULT;
the model treats it as one failed item on its list and continues. That is
exactly what `options.py:359-363` already says about denies ("the model reads
it, argues with it, and picks another tool"), now measured at the turn level.

A caveat on the arms: this replaces `options.hooks` wholesale, which drops
`foreground_rewrite` (`real_agent.py`). So both arms ran with a delegation shape
production does not use. It does not affect the result -- the leak was the model
continuing after a deny, not the delegation's background/foreground mode -- but a
re-run that wants production's shape has to re-add that hook.

What this does NOT say: that this settles the instrument. It was written
believing `_halt` was no better, on the reading that halt fields end the turn
only AFTER the call runs. That is true of the stop fields alone, but `_halt`
(`options.py:391-392`) ships `**_deny(reason)` with them, so it does stop the
call it fires on. Decision 25 (2026-10-19) chose the halt, on the FamilySearch
prototype only; Cowork gets no hook and the alpha gets nothing. This probe's
result stands as the reason the deny was not chosen.

Two further observations from the transcripts, both costing nothing extra:

  * The model read the deny as an ERROR, not an instruction, in both runs --
    "the Agent call came back with an error rather than a result" -- despite the
    reason saying the step was complete. At a real boundary a researcher would
    see a broken tool call, not "step done, continue?".
  * In run 2 arm A it called `research_delivered` of its own accord, i.e. the
    existing finish line fired on a turn the boundary was supposed to own.

Cost: $3.33 across four sessions. Prototype plane NOT measured -- it needs a
live store and bearer to assemble its options, and the alpha's answer is
negative, so the design needs rework before the second plane is worth buying.

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

# `--queued`: the same setup with WORK LEFT AFTER the delegation.
#
# Run 1 (2026-10-19) came back ENDS on the bare query, and the control could not
# carry it: arm B ended after one delegation too, because a single-task prompt
# leaves nothing to do either way. "No retry" was attributable; "it ended" was
# not. With a second task queued, the two arms separate -- if the deny stops
# work the model would otherwise have done, that is a step boundary holding, and
# if the model carries on to the second task the boundary leaks.
#
# The second task is a `Write`, not prose, so it is read off the stream rather
# than off the model's narration. Still no instruction about what to do after a
# deny: the queued task is the setup, not a hint.
QUERY_QUEUED = (
    "Two things, in order.\n"
    "1. Delegate to the `citation` agent: format a source citation for the "
    "1880 United States Federal Census.\n"
    "2. Use the Write tool to create notes.txt containing the single line: done"
)

# How the second task is recognised in the stream.
SECOND_TASK_TOOL = "Write"

DELEGATIONS = ("Agent", "Task")


def _candidate_env_files() -> list[Path]:
    """`eval/.env` in this checkout AND in the main one.

    `eval/.env` is gitignored, so a WORKTREE never has it -- and `REPO` above
    resolves to whichever checkout the probe is run from, which for this work is
    a worktree. Looking only there reports "no key on this machine" when the key
    is sitting in the main checkout, which is exactly what happened the first
    time this ran. `--git-common-dir` is the main checkout's `.git` from inside
    any worktree, so its parent is the main checkout.
    """
    out = [REPO / "eval" / ".env"]
    try:
        import subprocess

        common = subprocess.run(
            ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
            cwd=str(REPO), capture_output=True, text=True, encoding="utf-8",
            timeout=10, check=False,
        ).stdout.strip()
        if common:
            out.append(Path(common).parent / "eval" / ".env")
    except (OSError, subprocess.SubprocessError):
        pass
    return out


def api_key() -> str:
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip().strip("\"'")
    if key:
        return key
    tried = []
    for env in _candidate_env_files():
        tried.append(str(env))
        if not env.exists():
            continue
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("ANTHROPIC_API_KEY="):
                # Quotes are NOT stripped by the harness's own reader, so a
                # quoted key reads as a bad key rather than a bad quote
                # (eval/.env says so itself). Strip here so both forms work.
                found = line.split("=", 1)[1].strip().strip("\"'")
                if found:
                    return found
    sys.exit(
        "no ANTHROPIC_API_KEY. Checked $ANTHROPIC_API_KEY and:\n  "
        + "\n  ".join(tried)
    )


async def run_arm(*, deny: bool, key: str, query: str) -> dict:
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
            await client.query(query)
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
        # Anywhere in the stream, not just after the deny: in the control there
        # IS no deny, so an "after" window would be empty by construction and
        # the control could not carry the comparison. That is exactly how run 1
        # produced an unattributable "ends".
        "second_task_done": any(
            e["kind"] == "use" and e["name"] == SECOND_TASK_TOOL for e in stream
        ),
        "denied": len(denied_ids),
        "tools_after_deny": [e["name"] for e in after],
        "result": result,
        "sentinel_reached_model": any(
            SENTINEL in (e.get("text") or "") for e in stream if e["kind"] == "result"
        ),
        "text_tail": (" ".join(text))[-400:],
    }


def verdict(a: dict, b: dict, queued: bool) -> str:
    if not a["delegated"]:
        return "VOID: the model never delegated in arm A, so nothing was denied"
    if not a["denied"]:
        return "VOID: a delegation happened but the probe hook never denied it"
    if not a["sentinel_reached_model"]:
        return "VOID: the deny fired but its reason never reached the model"
    if b["denied"]:
        return "VOID: the control arm denied too -- attribution broken"
    # A RETRY is another DELEGATION. Any OTHER tool after the deny is the model
    # carrying on with different work, which is a leak, not a retry -- and run 2
    # produced exactly that (Write + research_delivered). Reporting it as
    # "RETRIES" named the wrong failure: nothing re-attempted the delegation.
    retried = [t for t in a["tools_after_deny"] if t in DELEGATIONS]
    if retried:
        return f"RETRIES: re-attempted the delegation via {retried} after the deny"
    if a["result"].get("is_error"):
        return f"ENDS-IN-ERROR: result subtype={a['result'].get('subtype')!r}"
    if not queued:
        if a["tools_after_deny"]:
            return f"CARRIED-ON: called {a['tools_after_deny']} after the deny"
        # Run 1's shape. "No retry" is attributable; "ended" is not, because a
        # single-task prompt leaves the control nothing to do either.
        return "ENDS (no-retry attributable; 'ended' NOT attributable -- see --queued)"
    if not b["second_task_done"]:
        return ("VOID: the control never did the second task either, so arm A "
                "skipping it says nothing about the deny")
    if a["second_task_done"]:
        return ("LEAKS: the deny did not stop queued work -- arm A went on to do "
                "the second task the control also did")
    return ("ENDS-AND-STOPS-QUEUED-WORK: arm A was denied and did NOT do the "
            "second task; the control did. The boundary held.")


async def main() -> int:
    if not ENGINE_BUILD.exists():
        sys.exit(f"no engine build at {ENGINE_BUILD} -- run `make engine-build`")
    queued = "--queued" in sys.argv
    query = QUERY_QUEUED if queued else QUERY
    key = api_key()
    print(f"mode: {'queued (second task after the delegation)' if queued else 'bare'}")
    print(f"prompt: {query}\n")
    a = await run_arm(deny=True, key=key, query=query)
    print("ARM A:", json.dumps(a, indent=2)[:1500], "\n")
    b = await run_arm(deny=False, key=key, query=query)
    print("ARM B:", json.dumps(b, indent=2)[:1500], "\n")
    v = verdict(a, b, queued)
    cost = sum(x["result"].get("cost_usd") or 0 for x in (a, b))
    print("=" * 66)
    print(f"VERDICT: {v}")
    print(f"cost: ${cost:.4f}")
    print("=" * 66)
    return 0 if v.startswith(("ENDS", "RETRIES", "LEAKS")) else 2


sys.exit(asyncio.run(main()))

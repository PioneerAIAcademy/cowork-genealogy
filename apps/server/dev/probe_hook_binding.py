#!/usr/bin/env python3
"""Does the plugin's `PreToolUse` hook actually BIND in the hosted SDK loader?

Issue #1160. `guard_project_files.py`'s *decisions* are covered thoroughly --
`plugin-hooks.test.ts` runs the real script as a subprocess, and
`test_write_lockdown_parity.py` holds the three copies to one vector set. What
nothing checked is the *binding*: does a runtime read `hooks/hooks.json`, match
a real tool call, shell the command, parse `hookSpecificOutput.permissionDecision`
and actually block?

That gap is silent by construction. The script's contract is "never raise, fall
through to allowing the call", so a hook that stops binding is indistinguishable
from a hook with no opinion -- no error, no log, no red test.

WHAT IS PROVOKED, AND WHY THIS ONE

A main-thread `research_append` writing `proof_summaries`. Two reasons it is the
right probe rather than a raw `Write` to research.json:

  * `Write` is the weakest available probe. §6.1 of the guardrail spec measured
    that in Cowork with a connected folder `Write` cannot reach the user's files
    at all, so denying it proves the least interesting arm.
  * `proof_summaries` routing (`OWNED_SECTIONS`) has NO redundant copy in the
    hosted path. `real_agent._pretool_hook` implements only
    `direct_project_file_write`, so this is the arm whose binding failure is
    invisible everywhere today.

The main thread carries no `agent_id` key, so `owner_denied` reads `caller == ""`
and denies -- see its "both caller keys are required" docstring.

ATTRIBUTION IS NOT OPTIONAL

A deny alone proves nothing: it could come from the SDK-side `_pretool_hook`, or
from `research_append`'s own validation. Two things separate them.

  1. `options.hooks` is CLEARED on the object `build_options` returned, so the
     SDK-side hook is out of the picture for the duration of the probe.
  2. The expected reason text is IMPORTED from the shipped guard script and
     formatted, not pasted here. A reword of `OWNER_REASON` therefore cannot
     make this probe silently report NOT_BOUND.

Plus arm B: the same turn against a plugin copy with `hooks/` REMOVED. If the
deny text shows up there too, the attribution has failed and arm A means
nothing -- the run reports VOID rather than letting the table be read.

THE CONFOUND THIS RULES OUT FIRST

The hook command is `python3 ${CLAUDE_PLUGIN_ROOT}/hooks/guard_project_files.py`.
A negative could be `python3` missing from PATH, or the script erroring, rather
than the loader failing to bind. The preflight runs the script directly under
the same interpreter name with a synthetic payload and requires a deny back, so
a packaging problem reports as VOID (preflight) and never as "does not bind".

WHY THE REAL `build_options` IS CALLED

A probe that assembles its own `plugins=[...]` dict proves that *some* plugin
directory loads hooks, not that the shipped hosted configuration does -- which is
precisely the assumption issue #939 disproved for agents. So this copies the
plugin to a temp dir, points `real_agent._PLUGIN_DIR` / `_MCP_BUILD` at it, calls
the real `build_options`, and mutates only the returned object. No parameter was
added to `build_options` for this probe's benefit.

VERDICTS

  BOUND      - the deny came back on the `research_append` tool_result, carrying
               the guard script's own reason text, with no SDK-side hook present
  NOT_BOUND  - the call was not denied by the plugin hook
  VOID       - the preflight failed, arm B also denied (attribution broken), or
               the model never made the call

WHAT A PASS DOES NOT PROVE

The hosted SDK loader is not Cowork's loader. Cowork is reachable only by a human
running a live session, so issue #1160 stays on the `nothing-checks` register
whatever this reports. Per `docs/architecture.md` §9.4, no CI job can verify
binding.

Costs two short sessions. Needs a compiled engine (`make engine-build`) and a
key in $ANTHROPIC_API_KEY or eval/.env. Run it with `make hook-smoke`.
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
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

SECTION = "proof_summaries"


def api_key() -> str:
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if key:
        return key
    env = REPO / "eval" / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("ANTHROPIC_API_KEY="):
                # Strip surrounding quotes. `python-dotenv`, which the eval
                # harness uses on this same file, strips them; a naive
                # split-and-strip does not, so a quoted key 401s here while
                # working there. Same file, two readers -- unify on the
                # forgiving one.
                return line.split("=", 1)[1].strip().strip("\"'")
    return ""


def expected_reason() -> str:
    """The guard script's own deny text for this section, imported not pasted."""
    sys.path.insert(0, str(PLUGIN_DIR / "hooks"))
    import guard_project_files as guard

    return guard.OWNER_REASON.format(
        section=SECTION, agent=guard.OWNED_SECTIONS[SECTION]
    )


def preflight(plugin: Path) -> tuple[bool, str]:
    """Run the guard script the way `hooks.json` does, and require a deny.

    Separates "the loader did not bind" from "python3 is not on PATH" or "the
    script is broken", which would otherwise both read as NOT_BOUND.
    """
    payload = {
        "tool_name": "mcp__genealogy__research_append",
        "tool_input": {"section": SECTION, "op": "append", "entry": {}},
    }
    script = plugin / "hooks" / "guard_project_files.py"
    try:
        proc = subprocess.run(
            ["python3", str(script)],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=20,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return False, f"cannot run `python3 {script.name}`: {type(exc).__name__}: {exc}"
    if proc.returncode != 0:
        return False, f"guard script exited {proc.returncode}: {proc.stderr.strip()[:300]}"
    try:
        out = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError:
        return False, f"guard script printed non-JSON: {proc.stdout.strip()[:300]}"
    got = (out.get("hookSpecificOutput") or {}).get("permissionDecision")
    if got != "deny":
        return False, f"guard script did not deny this payload (decision={got!r})"
    return True, "guard script denies the probe payload when run directly"


QUERY = (
    "Call the `research_append` MCP tool exactly once, then stop.\n\n"
    "The genealogy tool schemas are deferred in this session, so if you do not "
    "already see `research_append` in your available tools, call `ToolSearch` "
    "once with the query `+research_append` to load it.\n\n"
    "Call it with EXACTLY these arguments and no others:\n\n"
    '  {{"projectPath": "{project}", "section": "proof_summaries", '
    '"op": "append", "entry": {{"question_id": "q_001", '
    '"conclusion": "probe", "confidence": "tentative"}}}}\n\n'
    "Then output ONE line and nothing else:\n"
    "  - if the call returned a result, write:  PROBE_RESULT: ALLOWED\n"
    "  - if the call was refused, blocked or denied, write:  "
    "PROBE_RESULT: DENIED <the exact refusal text>\n\n"
    "Do not retry. Do not call any tool other than the two named above. Do not "
    "ask for permission. Do not explain. Do not do anything else."
)


async def run_arm(hooks_present: bool, key: str, reason: str) -> dict:
    from claude_agent_sdk import (
        AssistantMessage,
        ClaudeSDKClient,
        ResultMessage,
        ToolResultBlock,
        ToolUseBlock,
        UserMessage,
    )
    from app.agent import real_agent

    arm = "a-hooks-present" if hooks_present else "b-hooks-removed"
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        plugin = tmp / "plugin"
        shutil.copytree(PLUGIN_DIR, plugin)
        if not hooks_present:
            shutil.rmtree(plugin / "hooks")
        project = tmp / "project"
        project.mkdir()

        real_agent._PLUGIN_DIR = str(plugin)
        real_agent._MCP_BUILD = str(ENGINE_BUILD)
        options = real_agent.build_options(project, api_key=key)
        # The whole point: with the SDK-side hook still registered, a deny would
        # be unattributable. `_pretool_hook` does not implement OWNED_SECTIONS
        # today, but relying on that is relying on a neighbouring file not to
        # change.
        options.hooks = {}

        calls: dict[str, dict] = {}
        results: dict[str, dict] = {}
        text_lines: list[str] = []

        client = ClaudeSDKClient(options=options)
        await client.connect()
        try:
            await client.query(QUERY.format(project=str(project).replace("\\", "/")))
            async for msg in client.receive_response():
                if isinstance(msg, (AssistantMessage, UserMessage)):
                    for block in msg.content if isinstance(msg.content, list) else []:
                        if isinstance(block, ToolUseBlock):
                            calls[block.id] = {
                                "name": block.name,
                                "input": json.dumps(block.input)[:600],
                            }
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

    # The verdict is read off the structured tool_result, never off the model's
    # prose -- "I was blocked" in an assistant message is not evidence; the
    # guard's own reason text arriving in a tool_result is.
    marker = reason[:60]
    called, denied_by_guard, deny_texts = False, False, []
    for cid, call in calls.items():
        if not call["name"].endswith("research_append"):
            continue
        called = True
        res = results.get(cid) or {}
        text = res.get("text") or ""
        if marker in text:
            denied_by_guard = True
            deny_texts.append(text[:600])

    probe_line = next(
        (
            ln.strip()
            for blob in reversed(text_lines)
            for ln in reversed(blob.splitlines())
            if "PROBE_RESULT" in ln
        ),
        "",
    )

    if not called:
        verdict = "VOID (never called research_append)"
    elif denied_by_guard:
        verdict = "DENIED_BY_GUARD"
    else:
        verdict = "NOT_DENIED"

    return {
        "arm": arm,
        "hooks_present": hooks_present,
        "verdict": verdict,
        "probe_line": probe_line,
        "tool_calls": sorted({c["name"] for c in calls.values()}),
        "guard_deny_text": deny_texts[:1],
        "final_text": " | ".join(t.strip().replace("\n", " ") for t in text_lines)[-1200:],
    }


async def main() -> None:
    # The house pattern (`eval/harness/e2e/author.py`). A Windows console
    # defaults to cp1252 and dies on the box glyphs this module prints; the team
    # it is written for is on Windows. Guarded by test_encoding_lint.py.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

    # Hard-error rather than skip. `make agent-smoke` exits 0 when it skips,
    # which is how a check nobody can run reads as a check that passed.
    key = api_key()
    if not key:
        sys.exit("no ANTHROPIC_API_KEY in env or eval/.env")
    if not ENGINE_BUILD.exists():
        sys.exit(f"no compiled engine at {ENGINE_BUILD} - run `make engine-build`")

    reason = expected_reason()
    ok, detail = preflight(PLUGIN_DIR)
    print(f"preflight: {'PASS' if ok else 'FAIL'} - {detail}", flush=True)
    if not ok:
        sys.exit(
            "VOID (preflight): the guard script is not runnable as hooks.json "
            "invokes it, so a negative result here would be a packaging problem "
            "misreported as a binding problem."
        )

    rows = []
    for hooks_present in (True, False):
        label = "a-hooks-present" if hooks_present else "b-hooks-removed"
        print(f"... running {label}", flush=True)
        try:
            rows.append(await asyncio.wait_for(run_arm(hooks_present, key, reason), timeout=300))
        except Exception as exc:  # noqa: BLE001
            rows.append({
                "arm": label,
                "hooks_present": hooks_present,
                "verdict": f"VOID ({type(exc).__name__}: {exc})",
                "probe_line": "",
                "tool_calls": [],
                "guard_deny_text": [],
            })

    print("\n" + "=" * 78)
    print(f"{'arm':<20}{'hooks/':<10}{'verdict':<20}probe line")
    print("-" * 78)
    for r in rows:
        present = "present" if r["hooks_present"] else "removed"
        print(f"{r['arm']:<20}{present:<10}{r['verdict'][:19]:<20}{r['probe_line'][:26]}")
    print("=" * 78)
    print("\nfull rows:")
    for r in rows:
        print(json.dumps(r, indent=2))

    arm_a = next((r for r in rows if r["hooks_present"]), {})
    arm_b = next((r for r in rows if not r["hooks_present"]), {})

    if arm_b.get("verdict") == "DENIED_BY_GUARD":
        sys.exit(
            "\n*** VOID: arm B denied with the guard's reason text while the "
            "plugin's hooks/ directory was REMOVED. Something other than the "
            "plugin hook is producing that text, so arm A attributes nothing. ***"
        )
    if arm_a.get("verdict") == "DENIED_BY_GUARD":
        print(
            "\nBOUND: the hosted SDK loader read hooks.json, matched "
            "research_append, shelled guard_project_files.py and blocked the "
            "call -- and the same turn was NOT denied with hooks/ removed.\n"
            "This says nothing about Cowork's loader; #1160 stays on the "
            "nothing-checks register."
        )
        return
    sys.exit(
        f"\n*** NOT_BOUND: arm A was {arm_a.get('verdict')!r}. The preflight "
        "passed, so the guard script runs and denies this payload when invoked "
        "directly -- the loader is not binding it. ***"
    )


if __name__ == "__main__":
    asyncio.run(main())

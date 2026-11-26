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

Answered 2026-09-09 against Claude Code 2.1.258 / agent SDK 0.2.128:
**the hosted SDK loader DOES bind it.**

    arm               hooks/    verdict            what came back
    a-hooks-present   present   DENIED_BY_GUARD    OWNER_REASON on the tool_result
    b-hooks-removed   removed   NOT_DENIED         no guard text; tool's own error

**Arm B earned its place on the first run.** With `hooks/` removed the model
still reported `PROBE_RESULT: DENIED` -- but the refusal was `research_append`'s
own "This folder is not a research project", from the TOOL, not the hook. A
probe reading the model's prose would have scored that as a deny and either
called the run VOID or, worse, let arm A stand on a deny it had not attributed.
Keying on the guard's own imported reason text is what separates them, and this
is the concrete case that shows why the card insists on it.

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

The hook command is `python3 "${CLAUDE_PLUGIN_ROOT}/hooks/guard_project_files.py"`.
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

THE FORK CASE

A second pair of arms provokes an `Agent` call with `subagent_type: "fork"`, which
the guard denies (`FORK_REASON`) because Cowork's Claude Code offers forks by default
from 2.1.302 and every path we test turns them off. These arms DROP
`CLAUDE_CODE_FORK_SUBAGENT` from the options `build_options` returned, so the CLI
offers a fork as Cowork's would; arm B, with `hooks/` removed, is therefore also
the evidence that a fork is reachable at all. Same attribution rule: the verdict
is the guard's own imported reason text on the `Agent` tool_result.

THE AGENT-ONLY CASE

A third pair provokes a main-thread `convert_calendar` call, a tool only agents
hold (`AGENT_ONLY_TOOLS`, issue #3528), which the guard denies with
`agent_only_reason`. It is the cheapest member to provoke: pure computation, no
network, no project, so arm B gets the tool's own answer back rather than an
upstream error. It also proves the matcher's widened alternative binds, since
`convert_calendar` reaches the script through no other arm. First run
2026-10-29 (Claude Code 2.1.308 / SDK 0.2.172): BOUND.

WHAT A PASS DOES NOT PROVE

The hosted SDK loader is not Cowork's loader. Cowork is reachable only by a human
running a live session, so issue #1160 stays on the `nothing-checks` register
whatever this reports. Per `docs/architecture.md` §9.4, no CI job can verify
binding.

Costs six short sessions. Needs a compiled engine (`make engine-build`) and a
key in $ANTHROPIC_API_KEY or eval/.env. Run it with `make hook-smoke`.
"""
from __future__ import annotations

import asyncio
import importlib.util
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
AGENT_ONLY_TOOL = "convert_calendar"
READ_FILE = "research.json"
RELAY_AGENT = "search-wikipedia"


def api_key() -> str:
    # Strip on the environment branch too, not only on the eval/.env one
    # below. `make hook-smoke` sets ANTHROPIC_API_KEY from a raw `grep | cut`
    # of that same file, so the environment branch always wins and a quoted
    # key would reach the API with its quotes -- the .env branch's stripping
    # is unreachable through the documented entry point.
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip().strip("\"'")
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


def expected_fork_reason() -> str:
    """The guard's fork deny text from its first word after the tool name, which
    the marker must not depend on."""
    sys.path.insert(0, str(PLUGIN_DIR / "hooks"))
    import guard_project_files as guard

    return guard.FORK_REASON.format(tool="").lstrip()


def expected_agent_only_reason() -> str:
    """The guard's deny text for a main-thread call to an agent-only tool."""
    sys.path.insert(0, str(PLUGIN_DIR / "hooks"))
    import guard_project_files as guard

    return guard.agent_only_reason(AGENT_ONLY_TOOL)


def expected_read_reason() -> str:
    """The guard's deny text for a built-in Read of research.json."""
    sys.path.insert(0, str(PLUGIN_DIR / "hooks"))
    import guard_project_files as guard

    return guard.READ_REASON.format(
        tool="Read", name=READ_FILE, route=guard.READ_ROUTES[READ_FILE]
    )


def expected_relay_note() -> str:
    """The relay hook's own note, read from the script the loader is meant to shell."""
    spec = importlib.util.spec_from_file_location(
        "_probe_relay", PLUGIN_DIR / "hooks" / "agent_relay_note.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.RELAY_NOTE


def relay_preflight(plugin: Path) -> tuple[bool, str]:
    """The relay script, run as hooks.json runs it, adds its note on a hosted plane."""
    script = plugin / "hooks" / "agent_relay_note.py"
    payload = json.dumps({"tool_name": "Agent", "tool_input": {}, "tool_response": {}})
    env = {**os.environ, "GENEALOGY_HOSTED_PLANE": "1"}
    try:
        out = subprocess.run(
            ["python3", str(script)], input=payload, capture_output=True, text=True,
            encoding="utf-8", env=env, timeout=30,
        )
        got = json.loads(out.stdout or "{}").get("hookSpecificOutput", {}).get("additionalContext")
    except Exception as exc:  # noqa: BLE001
        return False, f"relay script did not run: {exc}"
    if got != expected_relay_note():
        return False, f"relay script did not add its note when run directly (got {got!r})"
    return True, "relay script adds its note when run directly"


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
    # `hooks.json` shells the literal name `python3`. On stock Windows that is
    # not an interpreter but a Microsoft Store alias which prints an install
    # advert and exits 9009, so the probe must establish that the name resolves
    # before it can say anything about binding.
    #
    # Deliberately NOT falling back to `py -3`: the hook itself shells `python3`,
    # so a machine where that name does not launch Python is a machine where the
    # hook genuinely cannot run. Resolving a different interpreter here would
    # hide that fact behind a green preflight.
    try:
        probe = subprocess.run(
            ["python3", "--version"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=20,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return False, f"no `python3` on this machine: {type(exc).__name__}: {exc}"
    if probe.returncode != 0 or not probe.stdout.startswith("Python 3"):
        return False, (
            "`python3` does not launch a Python 3 interpreter here -- stock "
            "Windows resolves the name to a Microsoft Store alias. hooks.json "
            "shells that exact name, so the hook cannot run on this machine and "
            "this probe cannot measure binding. Run it on macOS or Linux."
        )
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
    fork = subprocess.run(
        ["python3", str(script)],
        input=json.dumps({"tool_name": "Agent", "tool_input": {"subagent_type": "fork"}}),
        capture_output=True, text=True, encoding="utf-8", timeout=20, check=False,
    )
    try:
        fork_got = (json.loads(fork.stdout or "{}").get("hookSpecificOutput") or {}).get(
            "permissionDecision")
    except json.JSONDecodeError:
        fork_got = None
    if fork_got != "deny":
        return False, f"guard script did not deny a fork (decision={fork_got!r})"
    agent_only = subprocess.run(
        ["python3", str(script)],
        input=json.dumps({"tool_name": f"mcp__genealogy__{AGENT_ONLY_TOOL}", "tool_input": {}}),
        capture_output=True, text=True, encoding="utf-8", timeout=20, check=False,
    )
    try:
        agent_only_got = (
            json.loads(agent_only.stdout or "{}").get("hookSpecificOutput") or {}
        ).get("permissionDecision")
    except json.JSONDecodeError:
        agent_only_got = None
    if agent_only_got != "deny":
        return False, (
            f"guard script did not deny a main-thread {AGENT_ONLY_TOOL} "
            f"(decision={agent_only_got!r})"
        )
    read = subprocess.run(
        ["python3", str(script)],
        input=json.dumps({"tool_name": "Read", "tool_input": {"file_path": f"/p/{READ_FILE}"}}),
        capture_output=True, text=True, encoding="utf-8", timeout=20, check=False,
    )
    try:
        read_got = (json.loads(read.stdout or "{}").get("hookSpecificOutput") or {}).get(
            "permissionDecision")
    except json.JSONDecodeError:
        read_got = None
    if read_got != "deny":
        return False, f"guard script did not deny a Read of {READ_FILE} (decision={read_got!r})"
    return True, "guard script denies all four probe payloads when run directly"


FORK_QUERY = (
    "Call the `Agent` tool exactly once, then stop. Call it with EXACTLY these "
    "arguments and no others:\n\n"
    '  {"subagent_type": "fork", "description": "probe", '
    '"prompt": "Reply with the single word OK and do nothing else."}\n\n'
    "Then output ONE line and nothing else:\n"
    "  - if the call returned a result, write:  PROBE_RESULT: ALLOWED\n"
    "  - if the call was refused, blocked or denied, write:  "
    "PROBE_RESULT: DENIED <the exact refusal text>\n\n"
    "Do not retry. Do not call any other tool. Do not ask for permission. Do not "
    "explain. Do not do anything else."
)


AGENT_ONLY_QUERY = (
    "Call the `convert_calendar` MCP tool exactly once, then stop. Do not delegate "
    "it to an agent.\n\n"
    "The genealogy tool schemas are deferred in this session, so if you do not "
    "already see `convert_calendar` in your available tools, call `ToolSearch` "
    "once with the query `+convert_calendar` to load it.\n\n"
    "Call it with EXACTLY these arguments and no others:\n\n"
    '  {"date": {"year": 1750, "month": 2, "day": 10}, '
    '"corrections": {"osNsYear": true}}\n\n'
    "Then output ONE line and nothing else:\n"
    "  - if the call returned a result, write:  PROBE_RESULT: ALLOWED\n"
    "  - if the call was refused, blocked or denied, write:  "
    "PROBE_RESULT: DENIED <the exact refusal text>\n\n"
    "Do not retry. Do not call any tool other than the two named above. Do not "
    "ask for permission. Do not explain. Do not do anything else."
)


READ_QUERY = (
    "Call the built-in `Read` tool exactly once on the file `{project}/research.json`, "
    "then stop.\n\n"
    "Then output ONE line and nothing else:\n"
    "  - if the call returned file contents, write:  PROBE_RESULT: ALLOWED\n"
    "  - if the call was refused, blocked, denied or errored, write:  "
    "PROBE_RESULT: DENIED <the exact refusal text>\n\n"
    "Do not retry. Do not call any other tool. Do not ask for permission. Do not "
    "explain. Do not do anything else."
)


RELAY_QUERY = (
    "Call the `Agent` tool exactly once, then stop. Call it with EXACTLY these "
    "arguments and no others:\n\n"
    '  {"subagent_type": "%s", "description": "probe", '
    '"prompt": "Reply with the single word OK. Call no tool."}\n\n'
    "Then output ONE line and nothing else:  PROBE_RESULT: DONE\n\n"
    "Do not retry. Do not call any other tool. Do not ask for permission. Do not "
    "explain. Do not do anything else."
) % RELAY_AGENT


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


async def run_arm(case: str, hooks_present: bool, key: str, reason: str) -> dict:
    from claude_agent_sdk import (
        AssistantMessage,
        ClaudeSDKClient,
        ResultMessage,
        ToolResultBlock,
        ToolUseBlock,
        UserMessage,
    )
    from app.agent import real_agent

    arm = f"{case}/{'a-hooks-present' if hooks_present else 'b-hooks-removed'}"
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        plugin = tmp / "plugin"
        shutil.copytree(PLUGIN_DIR, plugin)
        if not hooks_present:
            shutil.rmtree(plugin / "hooks")
        project = tmp / "project"
        project.mkdir()
        if case == "read":
            # A real file, so the control arm (hooks/ removed) shows a Read that succeeds.
            (project / READ_FILE).write_text('{"project": {"id": "rp_probe"}}', encoding="utf-8")

        real_agent._PLUGIN_DIR = str(plugin)
        real_agent._MCP_BUILD = str(ENGINE_BUILD)
        options = real_agent.build_options(project, api_key=key)
        # The whole point: with the SDK-side hook still registered, a deny would
        # be unattributable. `_pretool_hook` does not implement OWNED_SECTIONS
        # today, but relying on that is relying on a neighbouring file not to
        # change.
        options.hooks = {}
        if case == "fork":
            # Cowork's default: the CLI offers a fork unless this is set.
            options.env.pop("CLAUDE_CODE_FORK_SUBAGENT", None)

        calls: dict[str, dict] = {}
        results: dict[str, dict] = {}
        text_lines: list[str] = []
        session_id = None

        client = ClaudeSDKClient(options=options)
        await client.connect()
        try:
            if case == "relay":
                query = RELAY_QUERY
            elif case == "fork":
                query = FORK_QUERY
            elif case == "agent_only":
                query = AGENT_ONLY_QUERY
            elif case == "read":
                query = READ_QUERY.format(project=str(project).replace("\\", "/"))
            else:
                query = QUERY.format(project=str(project).replace("\\", "/"))
            await client.query(query)
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
                    session_id = getattr(msg, "session_id", None)
                    break
        finally:
            await client.disconnect()

        if case == "relay":
            # No tool result carries a PostToolUse note: the CLI writes it into the
            # session transcript as a hook_additional_context attachment. Read there,
            # never off the model's prose.
            spawned = any(c["name"] in ("Agent", "Task") and RELAY_AGENT in c["input"] for c in calls.values())
            config = Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude")
            transcripts = list((config / "projects").glob(f"*/{session_id}.jsonl")) if session_id else []
            marker = json.dumps(reason[:60])[1:-1]
            delivered = any(marker in t.read_text(encoding="utf-8") for t in transcripts)
            if not spawned:
                verdict = f"VOID (never spawned {RELAY_AGENT})"
            elif not transcripts:
                verdict = "VOID (no session transcript found)"
            else:
                verdict = "NOTE_DELIVERED" if delivered else "NO_NOTE"
            return {
                "case": case,
                "arm": arm,
                "hooks_present": hooks_present,
                "verdict": verdict,
                "probe_line": "",
                "tool_calls": sorted({c["name"] for c in calls.values()}),
                "guard_deny_text": [],
                "final_text": " | ".join(t.strip().replace("\n", " ") for t in text_lines)[-600:],
            }

    # The verdict is read off the structured tool_result, never off the model's
    # prose -- "I was blocked" in an assistant message is not evidence; the
    # guard's own reason text arriving in a tool_result is.
    # Escaped the same way the payload is, because the payload is JSON and the
    # reason is not. OWNER_REASON's em-dash currently sits at index 64 for both
    # owned sections (their names are the same length), four characters past
    # this window -- so a reword that moves it five characters earlier, or a
    # double quote entering the window, would make `json.dumps` escape it to
    # `\u2014` in the payload while the raw marker still carries the literal
    # character. The probe would then report NOT_BOUND while the hook binds
    # perfectly, which is the one failure this file's docstring promises cannot
    # happen. Measured: with the em-dash inside the window the raw marker misses
    # and the escaped one matches.
    marker = json.dumps(reason[:60])[1:-1]
    called, denied_by_guard, deny_texts = False, False, []
    target = ("Agent", "Task") if case == "fork" else None
    for cid, call in calls.items():
        if target is not None:
            if call["name"] not in target or '"fork"' not in call["input"]:
                continue
        elif case == "agent_only":
            if not call["name"].endswith(AGENT_ONLY_TOOL):
                continue
        elif case == "read":
            if call["name"] != "Read":
                continue
        elif not call["name"].endswith("research_append"):
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
        what = {"fork": "a fork", "agent_only": AGENT_ONLY_TOOL, "read": "Read"}.get(
            case, "research_append")
        verdict = f"VOID (never called {what})"
    elif denied_by_guard:
        verdict = "DENIED_BY_GUARD"
    else:
        verdict = "NOT_DENIED"

    return {
        "case": case,
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

    reasons = {
        "owner": expected_reason(),
        "fork": expected_fork_reason(),
        "agent_only": expected_agent_only_reason(),
        "read": expected_read_reason(),
        "relay": expected_relay_note(),
    }
    ok, detail = preflight(PLUGIN_DIR)
    if ok:
        ok, detail = relay_preflight(PLUGIN_DIR)
    print(f"preflight: {'PASS' if ok else 'FAIL'} - {detail}", flush=True)
    if not ok:
        sys.exit(
            "VOID (preflight): the guard script is not runnable as hooks.json "
            "invokes it -- either a packaging problem or no `python3` on this "
            "machine. Either way a negative result here would be misreported as "
            "a binding problem. See the detail line above."
        )

    rows = []
    for case in ("owner", "fork", "agent_only", "read", "relay"):
        for hooks_present in (True, False):
            label = f"{case}/{'a-hooks-present' if hooks_present else 'b-hooks-removed'}"
            print(f"... running {label}", flush=True)
            try:
                # A VOID arm made no call to read a verdict off: the main thread
                # (Haiku 5.5 low since main-thread.json moved) sometimes does not
                # make the one call the probe asks for. That says nothing about
                # binding, so the arm runs again, up to three times in all.
                for _attempt in range(3):
                    row = await asyncio.wait_for(
                        run_arm(case, hooks_present, key, reasons[case]), timeout=300)
                    if not str(row["verdict"]).startswith("VOID"):
                        break
                rows.append(row)
            except Exception as exc:  # noqa: BLE001
                rows.append({
                    "case": case,
                    "arm": label,
                    "hooks_present": hooks_present,
                    "verdict": f"VOID ({type(exc).__name__}: {exc})",
                    "probe_line": "",
                    "tool_calls": [],
                    "guard_deny_text": [],
                })

    print("\n" + "=" * 78)
    print(f"{'arm':<26}{'hooks/':<10}{'verdict':<20}probe line")
    print("-" * 78)
    for r in rows:
        present = "present" if r["hooks_present"] else "removed"
        print(f"{r['arm']:<26}{present:<10}{r['verdict'][:19]:<20}{r['probe_line'][:20]}")
    print("=" * 78)
    print("\nfull rows:")
    for r in rows:
        print(json.dumps(r, indent=2))

    tool = {
        "owner": "research_append",
        "fork": "an Agent call with subagent_type fork",
        "agent_only": f"a main-thread {AGENT_ONLY_TOOL}",
        "read": f"a built-in Read of {READ_FILE}",
    }
    failures = []
    relay_a = next((r for r in rows if r["case"] == "relay" and r["hooks_present"]), {})
    relay_b = next((r for r in rows if r["case"] == "relay" and not r["hooks_present"]), {})
    if relay_b.get("verdict") != "NO_NOTE":
        failures.append(
            f"VOID (relay): arm B was {relay_b.get('verdict')!r}, not 'NO_NOTE'. With hooks/ "
            "removed the note must not appear, or arm A's note is unattributed."
        )
    elif relay_a.get("verdict") == "NOTE_DELIVERED":
        print(
            "\nBOUND (relay): the hosted SDK loader read hooks.json, matched the Agent "
            "return on PostToolUse, shelled agent_relay_note.py, and its note reached the "
            "session -- and the same turn carried no note with hooks/ removed."
        )
    else:
        failures.append(
            f"NOT_BOUND (relay): arm A was {relay_a.get('verdict')!r}. The relay script adds "
            "its note when run directly, so the loader is not binding its PostToolUse hook."
            if relay_a.get("verdict") == "NO_NOTE"
            else f"VOID (relay): arm A was {relay_a.get('verdict')!r}. Re-run it."
        )
    for case in ("owner", "fork", "agent_only", "read"):
        arm_a = next((r for r in rows if r["case"] == case and r["hooks_present"]), {})
        arm_b = next((r for r in rows if r["case"] == case and not r["hooks_present"]), {})
        if arm_b.get("verdict") != "NOT_DENIED":
            failures.append(
                f"VOID ({case}): arm B was {arm_b.get('verdict')!r}, not 'NOT_DENIED'. "
                "The control arm has to run the same turn with hooks/ REMOVED and "
                "come back undenied. Anything else -- a deny carrying the guard's "
                "own text, a turn that never made the call, an exception -- "
                "leaves arm A unattributed."
            )
        elif arm_a.get("verdict") == "DENIED_BY_GUARD":
            print(
                f"\nBOUND ({case}): the hosted SDK loader read hooks.json, matched "
                f"{tool[case]}, shelled guard_project_files.py and blocked the "
                "call -- and the same turn was NOT denied with hooks/ removed."
            )
        elif str(arm_a.get("verdict", "")).startswith("VOID"):
            failures.append(
                f"VOID ({case}): arm A was {arm_a.get('verdict')!r}. The turn made "
                "no call to read a verdict off, so this run says nothing about "
                "binding either way. Re-run it."
            )
        else:
            failures.append(
                f"NOT_BOUND ({case}): arm A was {arm_a.get('verdict')!r}. The "
                "preflight passed, so the guard script denies this payload when "
                "invoked directly -- the loader is not binding it."
            )
    print(
        "\nThis says nothing about Cowork's loader; #1160 stays on the "
        "nothing-checks register."
    )
    if failures:
        sys.exit("\n" + "\n".join(f"*** {f} ***" for f in failures))


if __name__ == "__main__":
    asyncio.run(main())

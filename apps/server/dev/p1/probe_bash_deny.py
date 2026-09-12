#!/usr/bin/env python3
"""Is ``disallowed_tools=["Bash", …]`` a POOL removal or a CALL-TIME refusal?

Contract: `PLAN.md` at the repo root ("D1–2 parallel probes — implementation
contract", `probe_bash_deny.py`), for the "Removing the shell" question in
`docs/plan/search-agent-prototype.md`.

Three short sessions on the PROTOTYPE option set (`dev.p1.options.
build_prototype_options`), each on a fresh temp project seeded from
`eval/fixtures/scenarios/empty-project-just-created`, a fresh
`CLAUDE_CONFIG_DIR`, no session store, and the logging PreToolUse hook:

    pool-baseline  disallowed_tools=[]   "Reply with the single word READY."
                   -> is Bash in the init SystemMessage's data["tools"]?  (the control)
    pool-denied    the default four      same query, same read
    call-denied    the default four      "Use the Bash tool to run `echo p1-probe` …"
                   -> did a Bash tool_use appear, did the hook see Bash, what came back?

The pool read is the CLI's `system`/`init` frame, which the SDK parses as
`SystemMessage(subtype="init", data={"session_id", "tools": [<name>, …], …})`
(bundled CLI: `tools: e.tools.map(o => name(o))`), so a tool removed from the
pool is simply absent from that list.

Verdicts (one line at the end):
    NOT DENIED         the echo output came back                            exit 1
    pool removal       Bash absent from pool-denied's init tools (a stray Bash
                       tool_use in call-denied is reported, not judged)     exit 0
    call-time refusal  Bash present in pool-denied's init tools, a Bash
                       tool_use appeared, and its tool_result is a
                       PERMISSION refusal (pool-absence wording — "no such
                       tool", "not available" — does not count)             exit 0
    VOID               the control lacks Bash, an init frame was never seen,
                       an arm errored, or call-denied's session ended in an
                       error (no ResultMessage, is_error, the turn cap) so
                       the call arm never exercised the tool                exit 2
    inconclusive       none of the above matched                            exit 2

    uv run python -m dev.p1.probe_bash_deny [--model …]      (or: make probe-bash-deny)

Costs three short sessions, each capped at `MAX_TURNS` turns (cents; the
token/cost totals are printed). Needs a compiled engine (`make engine-build`)
and a key in $ANTHROPIC_API_KEY or eval/.env.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# /repo/apps/server/dev/p1/probe_bash_deny.py -> parents[2] = apps/server
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
from dev.p1.options import DEFAULT_MODEL, DISALLOWED_TOOLS, api_key  # noqa: E402

ARM_TIMEOUT_S = 300

READY_QUERY = "Reply with the single word READY."
BASH_QUERY = (
    "Use the Bash tool to run `echo p1-probe` and paste the output verbatim. "
    "Do not use any other tool."
)
ECHO_MARKER = "p1-probe"

# Two wordings, two mechanisms. Permission wording means the tool was in the
# pool and the call was stopped; pool-absence wording means the model reached
# for a tool the session never had. Only the first is a call-time refusal.
_PERMISSION_RE = re.compile(
    r"permission|denied|not allowed|disallowed|not permitted|blocked", re.IGNORECASE
)
_POOL_ABSENCE_RE = re.compile(
    r"unavailable|not available|no such tool|unknown tool", re.IGNORECASE
)


@dataclass(frozen=True)
class Arm:
    name: str
    disallowed_tools: list[str] | None   # None = the default four; [] = none
    query: str


ARMS = (
    Arm("pool-baseline", [], READY_QUERY),
    Arm("pool-denied", None, READY_QUERY),
    Arm("call-denied", None, BASH_QUERY),
)


async def run_arm(arm: Arm, key: str, model: str) -> dict[str, Any]:
    from claude_agent_sdk import (
        AssistantMessage,
        ClaudeSDKClient,
        ResultMessage,
        SystemMessage,
        TextBlock,
        ToolResultBlock,
        ToolUseBlock,
        UserMessage,
    )
    from dev.p1.options import build_prototype_options

    obs: dict[str, Any] = {
        "arm": arm.name,
        "disallowed_tools": list(DISALLOWED_TOOLS) if arm.disallowed_tools is None
                            else list(arm.disallowed_tools),
        "query": arm.query,
        "init_seen": False,
        "init_session_id": None,
        "init_tools": None,          # list[str] from the init frame, or None if never seen
        "bash_in_init_tools": None,
        "tool_uses": [],             # every ToolUseBlock: id, name, parent, input_preview
        "tool_results": [],          # every ToolResultBlock: tool_use_id, is_error, text
        "bash_tool_use_seen": False,
        "bash_results": [],          # tool_results whose tool_use was named Bash
        "hook_tools": [],            # tool_name of every PreToolUse the hook saw
        "hook_saw_bash": False,
        "final_text": "",
        "result": None,
        "error": None,
    }
    hook_log: list[dict[str, Any]] = []
    bash_ids: set[str] = set()
    last_text = ""

    with tempfile.TemporaryDirectory(prefix="p1-bash-deny-") as td:
        tmp = Path(td)
        project = seed_project(tmp / "project")
        config_dir = tmp / "config"
        config_dir.mkdir()
        options = build_prototype_options(
            project,
            api_key=key,
            store=None,
            config_dir=config_dir,
            model=model,
            hook_log=hook_log,
            disallowed_tools=arm.disallowed_tools,
            max_turns=MAX_TURNS,
        )
        client = ClaudeSDKClient(options=options)
        await client.connect()
        try:
            await client.query(arm.query)
            async for msg in client.receive_response():
                if isinstance(msg, SystemMessage) and msg.subtype == "init":
                    tools = msg.data.get("tools") or []
                    obs["init_seen"] = True
                    obs["init_session_id"] = msg.data.get("session_id")
                    obs["init_tools"] = [str(t) for t in tools]
                    obs["bash_in_init_tools"] = "Bash" in obs["init_tools"]
                elif isinstance(msg, (AssistantMessage, UserMessage)):
                    parent = msg.parent_tool_use_id
                    content = msg.content if isinstance(msg.content, list) else []
                    for block in content:
                        if isinstance(block, ToolUseBlock):
                            obs["tool_uses"].append({
                                "id": block.id, "name": block.name, "parent": parent,
                                "input_preview": json.dumps(block.input, default=str)[:200],
                            })
                            if block.name == "Bash":
                                obs["bash_tool_use_seen"] = True
                                bash_ids.add(block.id)
                        elif isinstance(block, ToolResultBlock):
                            rec = {
                                "tool_use_id": block.tool_use_id,
                                "is_error": bool(block.is_error),
                                "text": one_line(result_text(block.content)),
                            }
                            obs["tool_results"].append(rec)
                            if block.tool_use_id in bash_ids:
                                obs["bash_results"].append(rec)
                        elif isinstance(block, TextBlock) and isinstance(msg, AssistantMessage):
                            if block.text.strip():
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

    obs["hook_tools"] = [h.get("tool_name") for h in hook_log]
    obs["hook_saw_bash"] = any(h.get("tool_name") == "Bash" for h in hook_log)
    obs["final_text"] = one_line(last_text)
    return obs


def _is_permission_refusal(rec: dict[str, Any]) -> bool:
    text = rec["text"]
    if _PERMISSION_RE.search(text):
        return True
    return bool(rec["is_error"]) and not _POOL_ABSENCE_RE.search(text)


def _echoed_back(rec: dict[str, Any]) -> bool:
    text = rec["text"]
    return (not rec["is_error"]) and ECHO_MARKER in text and not (
        _PERMISSION_RE.search(text) or _POOL_ABSENCE_RE.search(text)
    )


def _stray_bash_detail(call: dict[str, Any]) -> str:
    """What call-denied did with Bash, for a verdict that does not rest on it."""
    if not call["bash_tool_use_seen"]:
        return "call-denied issued no Bash tool_use"
    if call["bash_results"]:
        first = call["bash_results"][0]
        return (f"call-denied issued a Bash tool_use anyway; result is_error="
                f"{first['is_error']}: {first['text'][:120]}")
    return "call-denied issued a Bash tool_use anyway; no tool_result came back"


def verdict(rows: dict[str, dict[str, Any]]) -> tuple[str, int, str]:
    """(verdict, exit code, detail)."""
    errored = [f"{n}: {r['error']}" for n, r in rows.items() if r.get("error")]
    if errored:
        return "VOID", 2, "arm errored — " + "; ".join(errored)
    base, den, call = rows["pool-baseline"], rows["pool-denied"], rows["call-denied"]
    for r in (base, den):
        if not r["init_seen"]:
            return "VOID", 2, f"{r['arm']}: no system/init frame in the stream; pool unread"
    if not base["bash_in_init_tools"]:
        return "VOID", 2, ("control: Bash absent from pool-baseline's init tools even with "
                           "disallowed_tools=[] — the pool read proves nothing")
    if any(_echoed_back(r) for r in call["bash_results"]):
        return "NOT DENIED", 1, f"{ECHO_MARKER!r} came back in a non-error Bash tool_result"
    # Both mechanism verdicts rest on call-denied having run its turn. A session
    # that ended in an API error or at the turn cap never exercised the call,
    # and its silence about Bash is not evidence of anything.
    res = call.get("result")
    if res is None or res["is_error"]:
        why = "no ResultMessage" if res is None else f"subtype={res['subtype']} is_error=True"
        return "VOID", 2, f"call-denied session errored ({why}); the call arm never exercised the tool"
    if not den["bash_in_init_tools"]:
        return "pool removal", 0, ("Bash absent from pool-denied's init tools; "
                                   + _stray_bash_detail(call))
    if call["bash_tool_use_seen"] and any(_is_permission_refusal(r) for r in call["bash_results"]):
        first = next(r for r in call["bash_results"] if _is_permission_refusal(r))
        return "call-time refusal", 0, (f"Bash present in pool-denied's init tools; a Bash "
                                        f"tool_use appeared; result is_error="
                                        f"{first['is_error']}: {first['text'][:120]}")
    return "inconclusive", 2, (
        f"pool-denied Bash in init tools={den['bash_in_init_tools']}, call-denied Bash "
        f"tool_use seen={call['bash_tool_use_seen']}, Bash results={len(call['bash_results'])}, "
        f"hook saw Bash={call['hook_saw_bash']}"
    )


def _yn(v: Any) -> str:
    return "?" if v is None else ("yes" if v else "no")


def print_table(rows: dict[str, dict[str, Any]]) -> None:
    hdr = f"{'arm':<15}{'Bash in init tools':<21}{'Bash tool_use':<15}{'hook saw Bash':<15}result/text excerpt"
    print("\n" + "=" * 100)
    print(hdr)
    print("-" * 100)
    for name, r in rows.items():
        if r.get("error"):
            print(f"{name:<15}{'ERROR':<21}{'':<15}{'':<15}{one_line(str(r['error']), 60)}")
            continue
        n_tools = len(r["init_tools"] or [])
        pool = f"{_yn(r['bash_in_init_tools'])} ({n_tools} tools)" if r["init_seen"] else "? (no init)"
        excerpt = (r["bash_results"][0]["text"] if r["bash_results"] else r["final_text"])[:60]
        print(f"{name:<15}{pool:<21}{_yn(r['bash_tool_use_seen']):<15}"
              f"{_yn(r['hook_saw_bash']):<15}{excerpt}")
    print("=" * 100)


def print_costs(rows: dict[str, dict[str, Any]]) -> None:
    print("\ntokens/cost per arm (from ResultMessage):")
    tot_cost, tot_in, tot_out = 0.0, 0, 0
    for name, r in rows.items():
        res = r.get("result") or {}
        cost = res.get("total_cost_usd") or 0.0
        i, o = res.get("input_tokens") or 0, res.get("output_tokens") or 0
        cr, cc = res.get("cache_read_input_tokens") or 0, res.get("cache_creation_input_tokens") or 0
        tot_cost += cost
        tot_in += i + cr + cc
        tot_out += o
        print(f"  {name:<15} ${cost:.4f}  in={i} (+cache read {cr}, create {cc})  out={o}  "
              f"turns={res.get('num_turns')}  {res.get('duration_ms')} ms")
    print(f"  {'TOTAL':<15} ${tot_cost:.4f}  in={tot_in} (incl. cache)  out={tot_out}")


async def run_all(model: str) -> int:
    key = api_key()
    if not key:
        print("no ANTHROPIC_API_KEY in env or eval/.env", file=sys.stderr)
        return 2
    from app.agent import real_agent
    if not Path(real_agent._MCP_BUILD).exists():
        print(f"no compiled engine at {real_agent._MCP_BUILD} — run `make engine-build`",
              file=sys.stderr)
        return 2

    rows: dict[str, dict[str, Any]] = {}
    for arm in ARMS:
        denied = "[]" if arm.disallowed_tools == [] else "default four"
        print(f"... running {arm.name}  disallowed_tools={denied}  query={arm.query!r}", flush=True)
        try:
            rows[arm.name] = await asyncio.wait_for(run_arm(arm, key, model), timeout=ARM_TIMEOUT_S)
        except Exception as exc:  # noqa: BLE001 - a failed arm is a VOID row, not a crash
            rows[arm.name] = {"arm": arm.name, "error": f"{type(exc).__name__}: {exc}",
                              "init_seen": False, "init_tools": None, "bash_in_init_tools": None,
                              "bash_tool_use_seen": False, "bash_results": [],
                              "hook_saw_bash": False, "final_text": "", "result": None}

    print_table(rows)
    print("\nfull rows:")
    for r in rows.values():
        print(json.dumps(r, indent=2, ensure_ascii=False, default=str))
    print_costs(rows)
    name, code, detail = verdict(rows)
    print(f"\nVERDICT: {name} — {detail}")
    return code


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m dev.p1.probe_bash_deny",
        description="D1–2 probe: is disallowed_tools=['Bash', …] a pool removal or a "
                    "call-time refusal under the prototype option set? Three short "
                    "billed sessions; exit 1 on NOT DENIED, 2 on VOID/inconclusive.",
    )
    p.add_argument("--model", default=DEFAULT_MODEL)
    return p


def main(argv: list[str] | None = None) -> int:
    # House pattern: a Windows console defaults to cp1252.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    args = build_parser().parse_args(argv)
    return asyncio.run(run_all(args.model))


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""P3 — which Claude Code features survive when the provider is Bedrock direct?

Contract: `PLAN.md` at the repo root ("P3 feature-parity and P2 project-read
denial — implementation contract", `probe_bedrock_parity.py`), for "P3. Bedrock
feature parity" in `docs/plan/search-agent-prototype.md`.

Four arms, each its own session on the PROTOTYPE option set
(`dev.p1.options.build_prototype_options(..., store=None, max_turns=4)`), a temp
project seeded from `eval/fixtures/scenarios/empty-project-just-created`, a fresh
`CLAUDE_CONFIG_DIR`, the logging PreToolUse hook, `--debug-file <out>/<arm>.debug.log`
and `CLAUDE_CODE_DEBUG_LOG_LEVEL=verbose` so the wire (beta headers, `anthropic_beta`
body, `context_management`) can be read back off the CLI's `[API REQUEST DETAIL]`
lines. All four share the query "Use the ToolSearch tool to find the convert_calendar
tool, call it to convert 1751-03-24 from Julian to Gregorian, and reply with the
converted date only."

    first-party      no bedrock env, model="claude-sonnet-4-6"          (the control)
    bedrock-1m       CLAUDE_CODE_USE_BEDROCK=1 AWS_REGION=us-east-1
                     ANTHROPIC_MODEL=us.anthropic.claude-sonnet-4-6[1m]  model=None
    bedrock-default  CLAUDE_CODE_USE_BEDROCK=1 AWS_REGION=us-east-1
                     ANTHROPIC_MODEL=us.anthropic.claude-sonnet-4-6      model=None
    bedrock-1h       bedrock-default + ENABLE_PROMPT_CACHING_1H_BEDROCK=1

`bedrock-default` and `bedrock-1h` get a SECOND turn on the same client after a
7-minute sleep ("Now convert 1752-09-02 the same way; reply with the date only."):
a 5-minute cache entry has expired by then, a 1-hour one has not, so the second
turn's cache_read separates the two TTLs. Those two arms run concurrently
(`asyncio.gather`) so the wall clock is ~8 minutes; `--skip-wait` drops the second
turn for a smoke run. `first-party` and `bedrock-1m` run first, one at a time.

Per arm (`<out>/<arm>.json`, and one summary table): the init frame's `model`,
`apiKeySource`, `claude_code_version`, `betas`, whether `ToolSearch` is in `tools`
and whether any `mcp__genealogy__` name is (deferred = ToolSearch present, MCP names
absent); ToolSearch tool_use count; whether `convert_calendar` was called and its
result; interleaved thinking (a ThinkingBlock after a tool_result, or between two
ToolUseBlocks); `ResultMessage.model_usage[*].provider` / `contextWindow`, the
cache_creation `ephemeral_1h` / `ephemeral_5m` split, cache read/creation totals,
cost, duration; per-API-call usage off each AssistantMessage; and the debug log's
beta strings.

Verdict lines (exit 0 always — a measurement — except 2 when an arm raised):
    tool search on bedrock: requested | deferred | absent
    1h TTL: honoured | not honoured | undecidable
    interleaved thinking: seen | not seen
    1m context: accepted | rejected | undecidable
    context_management on wire: yes | no | unknown

    uv run python -m dev.p1.probe_bedrock_parity [--out DIR] [--skip-wait]
    uv run python -m dev.p1.probe_bedrock_parity --dry-run     (zero tokens, no spawn)

Needs a compiled engine (`make engine-build`), a key in $ANTHROPIC_API_KEY or
eval/.env (the first-party arm), and `~/.aws/credentials` (the bedrock arms).

How the CLI (bundled 2.1.220, `claude_agent_sdk/_bundled/claude`, read with
`grep -a`) does what this probe measures — quoted so the readings can be re-checked
against a newer binary:

  --debug-file is a real top-level flag, and the SDK passes extra_args as
  "--<flag> <value>":
    .option("--debug-file <path>","Write debug logs to a specific file path
      (implicitly enables debug mode)",()=>!0)
    subprocess_cli.py: `cmd.extend([f"--{flag}", str(value)])`

  The ONLY line that logs the betas is gated on the debug log LEVEL, which
  --debug-file turns on (at "debug") but does not raise — so every arm also sets
  CLAUDE_CODE_DEBUG_LOG_LEVEL=verbose. The line is one JSON blob: `betas` is the
  header list, `anthropic_beta` the body list (bedrock only), `model` the request's
  model string:
    g0i={verbose:0,debug:1,info:2,warn:3,error:4}
    JAt=Vr(()=>{let e=process.env.CLAUDE_CODE_DEBUG_LOG_LEVEL?.toLowerCase().trim();
      if(e&&Object.hasOwn(g0i,e))return e;return"debug"})
    function w(e,{level:t}={level:"debug"}){if(g0i[t]<g0i[JAt()])return;...
      let n=`${new Date().toISOString()} [${t.toUpperCase()}] ${mu(e.trim())}\\n`;...}
    function Qtp(e){if(JAt()!=="verbose")return;w(`[API REQUEST DETAIL] ${Ie({model:e.model,
      thinking:e.thinking,output_config:e.output_config,temperature:e.temperature,
      betas:e.betas??[],anthropic_beta:e.anthropic_beta})}`,{level:"verbose"})}
    (Ie = JSON.stringify; mu = secret redaction)

  The beta registry (name -> header):
    qXt=Wv("interleaved_thinking","interleaved-thinking-2025-05-14"),
    Cye=Wv("long_context","context-1m-2025-08-07"),
    Ukt=Wv("context_management","context-management-2025-06-27"),
    Z6r=Wv("tool_search","tool-search-tool-2025-10-19"),
    qkt=Wv("extended_cache_ttl","extended-cache-ttl-2025-04-11")

  The [1m] suffix: detected on the model string and turned into the long_context
  beta. The normalised name drops the suffix only on first-party at the default
  base URL (Ooe); on bedrock it is kept, so no `betas=` fallback is needed — what
  the request's `model` field actually carried is recorded in `wire.models`:
    function Nje(){return Z.CLAUDE_CODE_DISABLE_1M_CONTEXT}
    function Wb(e){if(Nje())return!1;return/\\[1m\\]/i.test(e)}
    function Ooe(){return xn()==="firstParty"&&Yd()}
    Ei(): if(n&&Ooe()&&Qig(o)&&OH(o))return bO(t.replace(/(\\[1m\\])+$/i,"").trim());
          if(n)return bO(t.replace(/(\\[1m\\])+$/i,"").trim()+"[1m]")
    bro=Vr((e)=>{... if(Wb(e))t.push(Cye);
      if(!Z.DISABLE_INTERLEAVED_THINKING&&bWr(e))t.push(qXt); ...
      let c=Z.ANTHROPIC_BETAS;if(c)t.push(...c.split(",")...map(v9i));return t})
    SZc(e,t){if(Wb(e))return 1e6;if(t?.includes(Cye.header)&&tG(e))return 1e6;...}

  On bedrock, three betas are STRIPPED from the header list and RE-SENT in the body:
    w9i=new Set([qXt,Cye,Z6r])
    Bde=Vr((e)=>{let t=bro(e);if(n_(e)==="bedrock")return t.filter((r)=>!w9i.has(r));return t})
    yYi=Vr((e)=>bro(e).filter((r)=>w9i.has(r)))
    let oc=mr==="bedrock"?[...yYi(xo.model),...A?[A]:[],...ks&&pB?[pB]:[]]:[],bs=lFt(oc)
    lFt(e): ... r.anthropic_beta=n   (n = the header strings of `e`)
  and the Bedrock client copies any header form into the body when the body has none:
    if(e.headers&&!e.body.anthropic_beta){let t=...get("anthropic-beta");
      if(t!=null)e.body.anthropic_beta=t.split(",")}

  The 1-hour TTL is gated on the env var, on bedrock only:
    function eFe(e){if(Yt(process.env.FORCE_PROMPT_CACHING_5M))return!1;
      if(Yt(process.env.ENABLE_PROMPT_CACHING_1H)||xn()==="bedrock"&&
         Yt(process.env.ENABLE_PROMPT_CACHING_1H_BEDROCK))return!0; ...}
    oe=eFe(i.querySource)?"1h":void 0 ... C1y(t,re,{...,cacheTtl:oe})

  The provider selector and the init frame's fields:
    function xn(){if(C_())return"gateway";return Z.CLAUDE_CODE_USE_BEDROCK?"bedrock":
      ...:"firstParty"}
    {type:"system",subtype:"init",...,tools:e.tools.map(...),model:e.model,
      permissionMode,slash_commands,apiKeySource:e.apiKeySource,betas:e.betas,
      claude_code_version:{...VERSION:"2.1.220"...}}
  context_management is pushed only for first-party-shaped providers (p9) and its
  env switch is hard-off (`&&!1`):
    let s=Z.USE_API_CONTEXT_MANAGEMENT&&!1,a=zRg(e);if(p9(n_(e))&&!Rye()&&(s||a))t.push(Ukt)

One measurement note. The two cache arms share tools but not the system prompt
(each arm's project note names its own temp dir), so their cache prefixes differ
and a 1h entry written by one arm cannot serve the other. The verdict still reads
the second turn's FIRST API call (`AssistantMessage.usage`), not the turn total:
the turn's later calls always read the cache the first call just wrote, so the
`ResultMessage` aggregate is > 0 for both arms regardless of TTL.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import shutil
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# /repo/apps/server/dev/p1/probe_bedrock_parity.py -> parents[2] = apps/server
SERVER_DIR = Path(__file__).resolve().parents[2]
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from dev.p1._probe_common import one_line, result_text, seed_project, usage_summary  # noqa: E402
from dev.p1.options import api_key  # noqa: E402

BEDROCK_MODEL = "us.anthropic.claude-sonnet-4-6"
BEDROCK_MODEL_1M = BEDROCK_MODEL + "[1m]"
FIRST_PARTY_MODEL = "claude-sonnet-4-6"
AWS_REGION = "us-east-1"
MAX_TURNS = 4                      # ToolSearch, convert_calendar, reply, one retry
SECOND_TURN_WAIT_S = 7 * 60        # past the 5-minute TTL, well inside the 1-hour one
ARM_TIMEOUT_S = 20 * 60            # the wait plus two turns, with room

QUERY = (
    "Use the ToolSearch tool to find the convert_calendar tool, call it to convert "
    "1751-03-24 from Julian to Gregorian, and reply with the converted date only."
)
SECOND_QUERY = "Now convert 1752-09-02 the same way; reply with the date only."

BEDROCK_ENV = {
    "CLAUDE_CODE_USE_BEDROCK": "1",
    "AWS_REGION": AWS_REGION,
    "ANTHROPIC_MODEL": BEDROCK_MODEL,
}
# Shell variables that would silently change an arm's provider, model or betas if
# inherited (the SDK merges os.environ under options.env). Names are recorded per
# arm; values never are.
INHERITED_ENV_PREFIXES = (
    "CLAUDE_CODE_USE_", "AWS_", "ANTHROPIC_MODEL", "ANTHROPIC_BETAS", "ANTHROPIC_BASE_URL",
    "ENABLE_PROMPT_CACHING", "FORCE_PROMPT_CACHING", "DISABLE_PROMPT_CACHING",
    "CLAUDE_CODE_DISABLE_1M_CONTEXT", "DISABLE_INTERLEAVED_THINKING",
    "CLAUDE_CODE_EXTRA_BODY", "USE_API_CONTEXT_MANAGEMENT", "ENABLE_TOOL_SEARCH",
    "CLAUDE_CODE_MCP_ALLOWLIST_ENV", "CLAUDE_CODE_DEBUG_LOG_LEVEL",
)
# Every arm. The `[API REQUEST DETAIL]` line — the only place the CLI logs the
# betas — is written only at this level; --debug-file alone leaves it at "debug".
DEBUG_LOG_ENV = {"CLAUDE_CODE_DEBUG_LOG_LEVEL": "verbose"}

BETA_1M = "context-1m-2025-08-07"
BETA_INTERLEAVED = "interleaved-thinking-2025-05-14"
BETA_TOOL_SEARCH = "tool-search-tool-2025-10-19"
BETA_CONTEXT_MGMT = "context-management-2025-06-27"
MCP_PREFIX = "mcp__genealogy__"
TARGET_TOOL = "convert_calendar"

# Any `<words>-YYYY-MM-DD` token: the shape of every Anthropic beta header.
_BETA_TOKEN_RE = re.compile(r"\b[a-z][a-z0-9]*(?:-[a-z0-9]+)*-20\d{2}-\d{2}-\d{2}\b")
_WIRE_KEYWORDS = ("anthropic-beta", "anthropic_beta", "interleaved-thinking", "context-1m",
                  "tool-search", "context_management")
_REJECTION_RE = re.compile(r"\bbeta\b|\bmodel\b", re.IGNORECASE)


@dataclass(frozen=True)
class Arm:
    name: str
    env: dict[str, str]     # goes into build_prototype_options(extra_env=…)
    model: str | None       # None = no --model flag; the env pin decides
    second_turn: bool


ARMS = (
    Arm("first-party", {}, FIRST_PARTY_MODEL, False),
    Arm("bedrock-1m", {**BEDROCK_ENV, "ANTHROPIC_MODEL": BEDROCK_MODEL_1M}, None, False),
    Arm("bedrock-default", dict(BEDROCK_ENV), None, True),
    Arm("bedrock-1h", {**BEDROCK_ENV, "ENABLE_PROMPT_CACHING_1H_BEDROCK": "1"}, None, True),
)
ARMS_BY_NAME = {a.name: a for a in ARMS}
CACHE_ARMS = ("bedrock-default", "bedrock-1h")
BEDROCK_ARMS = ("bedrock-1m", "bedrock-default", "bedrock-1h")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def default_out_dir() -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return Path.home() / ".cache" / "cowork-genealogy" / "p1" / f"bedrock-parity-{stamp}"


def build_arm_options(arm: Arm, *, key: str, project: Path, config_dir: Path,
                      debug_log: Path, hook_log: list[dict[str, Any]] | None = None):
    from dev.p1.options import build_prototype_options

    opts = build_prototype_options(
        project, api_key=key, store=None, config_dir=config_dir, model=arm.model,
        extra_env={**arm.env, **DEBUG_LOG_ENV}, hook_log=hook_log, max_turns=MAX_TURNS,
    )
    # options.py is not this probe's to edit; ClaudeAgentOptions is a plain
    # (mutable) dataclass and the transport reads extra_args at connect().
    opts.extra_args = {"debug-file": str(debug_log)}
    return opts


def inherited_env_names() -> list[str]:
    return sorted(k for k in os.environ if k.startswith(INHERITED_ENV_PREFIXES))


# ── one arm ─────────────────────────────────────────────────────────────


def _usage_split(usage: dict[str, Any] | None) -> dict[str, Any]:
    u = usage or {}
    cc = u.get("cache_creation") if isinstance(u.get("cache_creation"), dict) else {}
    return {
        "input_tokens": u.get("input_tokens"),
        "output_tokens": u.get("output_tokens"),
        "cache_read_input_tokens": u.get("cache_read_input_tokens"),
        "cache_creation_input_tokens": u.get("cache_creation_input_tokens"),
        "ephemeral_1h_input_tokens": cc.get("ephemeral_1h_input_tokens"),
        "ephemeral_5m_input_tokens": cc.get("ephemeral_5m_input_tokens"),
    }


def _model_usage_rows(model_usage: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}
    for model, mu in (model_usage or {}).items():
        if not isinstance(mu, dict):
            continue
        rows[str(model)] = {
            "provider": mu.get("provider"),
            "canonicalModel": mu.get("canonicalModel"),
            "contextWindow": mu.get("contextWindow"),
            "costUSD": mu.get("costUSD"),
            "inputTokens": mu.get("inputTokens"),
            "outputTokens": mu.get("outputTokens"),
            "cacheReadInputTokens": mu.get("cacheReadInputTokens"),
            "cacheCreationInputTokens": mu.get("cacheCreationInputTokens"),
        }
    return rows


def _new_turn(turn_no: int, query: str) -> dict[str, Any]:
    return {
        "turn": turn_no,
        "query": query,
        "started": _now_iso(),
        "init": None,               # only the first turn of a session carries one
        "tool_uses": [],            # {id, name, parent, input_preview}
        "tool_results": [],         # {tool_use_id, name, is_error, text}
        "tool_search_calls": 0,
        "tool_search_results": [],  # {is_error, text}
        "convert_calendar_called": False,
        "convert_calendar_result": None,
        "thinking_blocks": 0,
        "interleaved_thinking": False,
        "interleaved_detail": None,
        "api_calls": [],            # one per AssistantMessage: usage split + model + stop_reason
        "assistant_errors": [],
        "final_text": "",
        "result": None,
        "finished": None,
    }


def _read_init(msg: Any) -> dict[str, Any]:
    data = msg.data or {}
    tools = [str(t) for t in (data.get("tools") or [])]
    mcp = [t for t in tools if t.startswith(MCP_PREFIX)]
    tool_search = "ToolSearch" in tools
    return {
        "session_id": data.get("session_id"),
        "model": data.get("model"),
        "apiKeySource": data.get("apiKeySource"),
        "claude_code_version": data.get("claude_code_version"),
        "betas": data.get("betas"),
        "permissionMode": data.get("permissionMode"),
        "tool_count": len(tools),
        "tool_search_in_tools": tool_search,
        "mcp_genealogy_in_tools": bool(mcp),
        "mcp_genealogy_count": len(mcp),
        "deferred": tool_search and not mcp,
        "mcp_servers": data.get("mcp_servers"),
    }


async def collect_turn(client: Any, turn_no: int, query: str, label: str) -> dict[str, Any]:
    """Send `query` and consume the stream up to its ResultMessage."""
    from claude_agent_sdk import (
        AssistantMessage,
        ResultMessage,
        SystemMessage,
        TextBlock,
        ThinkingBlock,
        ToolResultBlock,
        ToolUseBlock,
        UserMessage,
    )

    turn = _new_turn(turn_no, query)
    names_by_id: dict[str, str] = {}
    saw_tool_result = False
    last_text = ""

    await client.query(query)
    async for msg in client.receive_response():
        if isinstance(msg, SystemMessage):
            if msg.subtype == "init" and turn["init"] is None:
                turn["init"] = _read_init(msg)
            continue
        if isinstance(msg, AssistantMessage):
            if msg.error:
                turn["assistant_errors"].append(str(msg.error))
            turn["api_calls"].append({
                "model": msg.model, "stop_reason": msg.stop_reason, **_usage_split(msg.usage),
            })
            parent = msg.parent_tool_use_id
            content = msg.content if isinstance(msg.content, list) else []
            tool_use_seen_in_msg = False
            for block in content:
                if isinstance(block, ThinkingBlock):
                    turn["thinking_blocks"] += 1
                    if (saw_tool_result or tool_use_seen_in_msg) and not turn["interleaved_thinking"]:
                        turn["interleaved_thinking"] = True
                        turn["interleaved_detail"] = (
                            "ThinkingBlock after a tool_result" if saw_tool_result
                            else "ThinkingBlock after a ToolUseBlock in the same message"
                        )
                elif isinstance(block, ToolUseBlock):
                    tool_use_seen_in_msg = True
                    names_by_id[block.id] = block.name
                    turn["tool_uses"].append({
                        "id": block.id, "name": block.name, "parent": parent,
                        "input_preview": json.dumps(block.input, default=str)[:200],
                    })
                    if block.name == "ToolSearch":
                        turn["tool_search_calls"] += 1
                    elif block.name.endswith(TARGET_TOOL):
                        turn["convert_calendar_called"] = True
                elif isinstance(block, TextBlock) and block.text.strip() and not parent:
                    last_text = block.text
        elif isinstance(msg, UserMessage):
            content = msg.content if isinstance(msg.content, list) else []
            for block in content:
                if not isinstance(block, ToolResultBlock):
                    continue
                saw_tool_result = True
                name = names_by_id.get(block.tool_use_id, "?")
                rec = {
                    "tool_use_id": block.tool_use_id, "name": name,
                    "is_error": bool(block.is_error),
                    "text": one_line(result_text(block.content)),
                }
                turn["tool_results"].append(rec)
                if name == "ToolSearch":
                    turn["tool_search_results"].append(
                        {"is_error": rec["is_error"], "text": rec["text"][:200]})
                elif name.endswith(TARGET_TOOL) and turn["convert_calendar_result"] is None:
                    turn["convert_calendar_result"] = {
                        "is_error": rec["is_error"], "text": rec["text"][:120]}
        elif isinstance(msg, ResultMessage):
            turn["result"] = {
                "session_id": msg.session_id, "subtype": msg.subtype,
                "is_error": bool(msg.is_error), "stop_reason": msg.stop_reason,
                "terminal_reason": msg.terminal_reason,
                "api_error_status": msg.api_error_status,
                "errors": msg.errors, "result_text": one_line(msg.result or "", 300),
                **usage_summary(msg), **_usage_split(msg.usage),
                "model_usage": _model_usage_rows(msg.model_usage),
                "providers": sorted({str(r.get("provider")) for r in
                                     _model_usage_rows(msg.model_usage).values()
                                     if r.get("provider")}),
            }
            if not last_text and msg.result:
                last_text = msg.result
            break
    turn["final_text"] = one_line(last_text)
    turn["finished"] = _now_iso()
    print(f"[{label}] turn {turn_no}: {_turn_line(turn)}", flush=True)
    return turn


def _turn_line(turn: dict[str, Any]) -> str:
    res = turn.get("result") or {}
    first = turn["api_calls"][0] if turn["api_calls"] else {}
    return (f"subtype={res.get('subtype')} is_error={res.get('is_error')} "
            f"providers={res.get('providers')} ToolSearch×{turn['tool_search_calls']} "
            f"{TARGET_TOOL}={turn['convert_calendar_called']} thinking={turn['thinking_blocks']} "
            f"interleaved={turn['interleaved_thinking']} "
            f"first-call cache_read={first.get('cache_read_input_tokens')} "
            f"turn cache_read={res.get('cache_read_input_tokens')} "
            f"1h={res.get('ephemeral_1h_input_tokens')} 5m={res.get('ephemeral_5m_input_tokens')} "
            f"${res.get('total_cost_usd') or 0:.4f} — {turn['final_text'][:60]!r}")


_API_DETAIL_MARKER = "[API REQUEST DETAIL] "


def _parse_api_detail(line: str) -> dict[str, Any] | None:
    """The JSON blob of one `<ts> [VERBOSE] [API REQUEST DETAIL] {…}` line, or None."""
    idx = line.find(_API_DETAIL_MARKER)
    if idx < 0:
        return None
    rest = line[idx + len(_API_DETAIL_MARKER):].strip()
    try:
        obj, _ = json.JSONDecoder().raw_decode(rest)
    except ValueError:
        return None
    return obj if isinstance(obj, dict) else None


def _beta_list(v: Any) -> list[str]:
    """`betas` is a list; `anthropic_beta` is a list, or a comma-joined header copy."""
    if isinstance(v, str):
        return [s.strip() for s in v.split(",") if s.strip()]
    if isinstance(v, list):
        return [str(s) for s in v]
    return []


def parse_debug_log(path: Path) -> dict[str, Any]:
    """What the debug log says went over the wire.

    The CLI logs each request's betas on one `[API REQUEST DETAIL] {json}` line
    (only at CLAUDE_CODE_DEBUG_LOG_LEVEL=verbose): `betas` is the header list,
    `anthropic_beta` the body list. `header_betas` / `body_betas` / `models` are
    read off those blobs; `all_betas` is a whole-file regex scan kept as the
    fallback, which cannot tell header from body.
    """
    wire: dict[str, Any] = {
        "debug_log": str(path), "exists": path.exists(), "bytes": 0, "lines": 0,
        "mentions": {k: 0 for k in _WIRE_KEYWORDS},
        "api_request_detail_lines": 0, "unparsed_detail_lines": 0, "models": [],
        "header_betas": [], "body_betas": [], "all_betas": [],
        "context_management_on_wire": None, "sample_lines": [],
    }
    if not path.exists():
        return wire
    text = path.read_text(encoding="utf-8", errors="replace")
    wire["bytes"] = len(text.encode("utf-8"))
    header: set[str] = set()
    body: set[str] = set()
    models: set[str] = set()
    n_lines = 0
    for line in text.splitlines():
        n_lines += 1
        low = line.lower()
        for k in _WIRE_KEYWORDS:
            if k in low:
                wire["mentions"][k] += 1
        if _API_DETAIL_MARKER not in line:
            continue
        wire["api_request_detail_lines"] += 1
        if len(wire["sample_lines"]) < 3:
            wire["sample_lines"].append(line[:400])
        detail = _parse_api_detail(line)
        if detail is None:
            wire["unparsed_detail_lines"] += 1
            continue
        header.update(_beta_list(detail.get("betas")))
        body.update(_beta_list(detail.get("anthropic_beta")))
        if detail.get("model"):
            models.add(str(detail["model"]))
    wire["lines"] = n_lines
    wire["models"] = sorted(models)
    wire["header_betas"] = sorted(header)
    wire["body_betas"] = sorted(body)
    wire["all_betas"] = sorted(set(_BETA_TOKEN_RE.findall(text.lower())))
    if wire["api_request_detail_lines"] > 0:
        wire["context_management_on_wire"] = (
            BETA_CONTEXT_MGMT in header or BETA_CONTEXT_MGMT in body
            or wire["mentions"]["context_management"] > 0
        )
    return wire


async def run_arm(arm: Arm, *, key: str, out_dir: Path, skip_wait: bool) -> dict[str, Any]:
    from claude_agent_sdk import ClaudeSDKClient

    debug_log = out_dir / f"{arm.name}.debug.log"
    obs: dict[str, Any] = {
        "arm": arm.name, "query": QUERY, "env": dict(arm.env), "model_option": arm.model,
        "max_turns": MAX_TURNS, "inherited_env_names": inherited_env_names(),
        "debug_log": str(debug_log), "started": _now_iso(),
        "first_turn": None, "second_turn": None, "second_turn_wait_s": None,
        "wire": None, "error": None, "finished": None,
    }
    hook_log: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory(prefix=f"p1-bedrock-{arm.name}-") as td:
        tmp = Path(td)
        project = seed_project(tmp / "project")
        config_dir = tmp / "config"
        config_dir.mkdir()
        options = build_arm_options(arm, key=key, project=project, config_dir=config_dir,
                                    debug_log=debug_log, hook_log=hook_log)
        client = ClaudeSDKClient(options=options)
        await client.connect()
        try:
            obs["first_turn"] = await collect_turn(client, 1, QUERY, arm.name)
            first_res = obs["first_turn"].get("result") or {}
            first_ok = bool(first_res.get("session_id")) and not first_res.get("is_error")
            if arm.second_turn and not skip_wait and not first_ok:
                print(f"[{arm.name}] first turn unreadable "
                      f"({_turn_unreadable(obs['first_turn'])}); no second turn", flush=True)
            if arm.second_turn and not skip_wait and first_ok:
                print(f"[{arm.name}] sleeping {SECOND_TURN_WAIT_S} s before the second turn",
                      flush=True)
                obs["second_turn_wait_s"] = SECOND_TURN_WAIT_S
                await asyncio.sleep(SECOND_TURN_WAIT_S)
                obs["second_turn"] = await collect_turn(client, 2, SECOND_QUERY, arm.name)
        finally:
            await client.disconnect()
    obs["hook_tools"] = [h.get("tool_name") for h in hook_log]
    obs["wire"] = parse_debug_log(debug_log)
    obs["finished"] = _now_iso()
    return obs


async def run_arm_guarded(arm: Arm, **kw: Any) -> dict[str, Any]:
    print(f"... {arm.name}: env={arm.env} model={arm.model!r} second_turn={arm.second_turn}",
          flush=True)
    try:
        return await asyncio.wait_for(run_arm(arm, **kw), timeout=ARM_TIMEOUT_S)
    except Exception as exc:  # noqa: BLE001 - a failed arm is an error row, not a crash
        print(f"[{arm.name}] ERROR {type(exc).__name__}: {exc}", flush=True)
        return {"arm": arm.name, "env": dict(arm.env), "model_option": arm.model,
                "error": f"{type(exc).__name__}: {exc}", "first_turn": None,
                "second_turn": None, "wire": parse_debug_log(kw["out_dir"] / f"{arm.name}.debug.log")}


# ── verdicts ────────────────────────────────────────────────────────────


def _first(row: dict[str, Any] | None) -> dict[str, Any]:
    return (row or {}).get("first_turn") or {}


def _second(row: dict[str, Any] | None) -> dict[str, Any]:
    return (row or {}).get("second_turn") or {}


def _first_call_cache_read(turn: dict[str, Any]) -> int | None:
    calls = turn.get("api_calls") or []
    if not calls:
        return None
    v = calls[0].get("cache_read_input_tokens")
    return int(v) if v is not None else None


def _errors_text(turn: dict[str, Any]) -> str:
    """Every error string a turn carries, joined.

    `AssistantMessage.error` is only the SDK's category (`invalid_request`,
    `rate_limit`, …) and `ResultMessage.errors` / `result` do not reliably carry
    a 4xx body — the API's own text usually lands in the final TextBlock
    ("API Error: 400 …"), so once anything says the turn errored that is read too.
    """
    res = turn.get("result") or {}
    parts = list(turn.get("assistant_errors") or [])
    parts.extend(str(e) for e in (res.get("errors") or []))
    if res.get("is_error") or turn.get("assistant_errors"):
        if res.get("api_error_status") is not None:
            parts.append(f"HTTP {res['api_error_status']}")
        parts.append(str(res.get("result_text") or ""))
        parts.append(str(turn.get("final_text") or ""))
    return " | ".join(dict.fromkeys(p for p in parts if p))


def _turn_unreadable(turn: dict[str, Any] | None) -> str | None:
    """Why a turn's cache numbers cannot be read: no turn, no ResultMessage, or an
    errored one. A 429/5xx before any AssistantMessage leaves `api_calls` empty,
    and the turn-total fallback would read that as cache_read 0."""
    if not turn:
        return "did not run"
    res = turn.get("result")
    if not res:
        return "no ResultMessage"
    if res.get("is_error"):
        return (f"errored (subtype={res.get('subtype')}, "
                f"api_error_status={res.get('api_error_status')}): "
                f"{_errors_text(turn)[:200] or 'no error text'}")
    return None


def verdict_tool_search(rows: dict[str, dict[str, Any]]) -> tuple[str, str]:
    inits = {n: (_first(rows.get(n)).get("init") or {}) for n in BEDROCK_ARMS}
    seen = {n: i for n, i in inits.items() if i}
    if not seen:
        return "absent", "no bedrock arm produced an init frame"
    per = {n: ("deferred" if i["deferred"] else "requested" if i["tool_search_in_tools"] else "absent")
           for n, i in seen.items()}
    ref = per.get("bedrock-default") or next(iter(per.values()))
    calls = {n: _first(rows.get(n)).get("tool_search_calls", 0) for n in seen}
    ok = {n: any(not r["is_error"] for r in _first(rows.get(n)).get("tool_search_results") or [])
          for n in seen}
    conv = {n: _first(rows.get(n)).get("convert_calendar_called") for n in seen}
    detail = (f"per arm {per}; ToolSearch calls {calls}; ToolSearch result ok {ok}; "
              f"{TARGET_TOOL} called {conv}; init tool counts "
              f"{ {n: i['tool_count'] for n, i in seen.items()} }; MCP names in init "
              f"{ {n: i['mcp_genealogy_count'] for n, i in seen.items()} }")
    if len(set(per.values())) > 1:
        detail = "ARMS DISAGREE — " + detail
    return ref, detail


def verdict_1h(rows: dict[str, dict[str, Any]]) -> tuple[str, str]:
    d, h = rows.get("bedrock-default"), rows.get("bedrock-1h")
    if not d or not h or d.get("error") or h.get("error"):
        return "undecidable", "a cache arm errored or did not run"
    for label, row in (("default", d), ("1h", h)):
        why = _turn_unreadable(_first(row))
        if why:
            return "undecidable", f"{label} arm's first turn {why}"
    d1, h1 = _first(d).get("result") or {}, _first(h).get("result") or {}
    split = {"default_1h": d1.get("ephemeral_1h_input_tokens"),
             "default_5m": d1.get("ephemeral_5m_input_tokens"),
             "1h_1h": h1.get("ephemeral_1h_input_tokens"),
             "1h_5m": h1.get("ephemeral_5m_input_tokens")}
    split_honoured = bool(split["1h_1h"]) and not split["default_1h"]
    split_denied = split["1h_1h"] == 0 and bool(split["1h_5m"])
    if not _second(d) or not _second(h):
        why = "no second turn (--skip-wait)"
        if split_honoured:
            return "honoured", f"{why}; usage split alone: {split}"
        if split_denied:
            return "not honoured", f"{why}; usage split alone (1h arm wrote 5m entries): {split}"
        return "undecidable", f"{why}; usage split {split}"
    for label, row in (("default", d), ("1h", h)):
        why = _turn_unreadable(_second(row))
        if why:
            return "undecidable", f"{label} arm's second turn {why}; first-turn split {split}"
    dr, hr = _first_call_cache_read(_second(d)), _first_call_cache_read(_second(h))
    d_tot = (_second(d).get("result") or {}).get("cache_read_input_tokens")
    h_tot = (_second(h).get("result") or {}).get("cache_read_input_tokens")
    reads = (f"second-turn first-call cache_read default={dr} 1h={hr} "
             f"(turn totals default={d_tot} 1h={h_tot}); first-turn split {split}")
    if dr is None or hr is None:
        # No per-call usage on the AssistantMessages; fall back to the turn totals.
        dr, hr = d_tot or 0, h_tot or 0
        reads += " [per-call usage missing — judged on turn totals]"
    if hr > 0 and dr <= max(0, int(0.1 * hr)):
        return "honoured", reads
    if hr > 0 and dr > 0 and split_honoured:
        return "honoured", reads + " — default arm also read cache at 7 min, but the 1h/5m split separates them"
    if hr == 0 and not split["1h_1h"]:
        return "not honoured", reads + " — the 1h arm neither wrote 1h entries nor read cache after 7 min"
    if hr == 0 and split["1h_1h"]:
        return "not honoured", reads + " — 1h entries were written but nothing was read back after 7 min"
    return "undecidable", reads + " — both arms read cache at 7 min and the split does not separate them"


def verdict_interleaved(rows: dict[str, dict[str, Any]]) -> tuple[str, str]:
    per = {}
    for n, r in rows.items():
        turns = [t for t in (_first(r), _second(r)) if t]
        per[n] = {"interleaved": any(t.get("interleaved_thinking") for t in turns),
                  "thinking_blocks": sum(t.get("thinking_blocks", 0) for t in turns),
                  "detail": next((t.get("interleaved_detail") for t in turns
                                  if t.get("interleaved_thinking")), None)}
    bedrock = {n: v for n, v in per.items() if n in BEDROCK_ARMS}
    seen = any(v["interleaved"] for v in bedrock.values())
    detail = f"bedrock arms {bedrock}; first-party control {per.get('first-party')}"
    if not seen and not any(v["thinking_blocks"] for v in per.values()):
        detail += " — no ThinkingBlock anywhere, thinking itself is off under this option set"
    return ("seen" if seen else "not seen"), detail


def verdict_1m(rows: dict[str, dict[str, Any]]) -> tuple[str, str]:
    r = rows.get("bedrock-1m")
    if not r:
        return "undecidable", "arm did not run"
    if r.get("error"):
        text = r["error"]
        return ("rejected" if _REJECTION_RE.search(text) else "undecidable"), f"arm raised: {text[:200]}"
    t = _first(r)
    init = t.get("init") or {}
    res = t.get("result") or {}
    ctx = {m: v.get("contextWindow") for m, v in (res.get("model_usage") or {}).items()}
    errs = _errors_text(t)
    wire = (r.get("wire") or {})
    detail = (f"init model={init.get('model')!r}; contextWindow={ctx}; "
              f"{BETA_1M} on wire: header={BETA_1M in wire.get('header_betas', [])} "
              f"body={BETA_1M in wire.get('body_betas', [])}; "
              f"{TARGET_TOOL} called={t.get('convert_calendar_called')}; "
              f"final={t.get('final_text', '')[:60]!r}")
    if errs and _REJECTION_RE.search(errs):
        return "rejected", f"API error: {errs[:200]} — {detail}"
    if res.get("is_error") and res.get("api_error_status") == 400:
        return "rejected", f"HTTP 400 not naming the beta/model: {errs[:200]} — {detail}"
    if res.get("is_error"):
        return "undecidable", f"session error not naming the beta/model: {errs[:200]} — {detail}"
    if res.get("session_id"):
        if t.get("assistant_errors"):
            detail += f"; recovered assistant errors {t['assistant_errors']}"
        return "accepted", detail
    return "undecidable", "no ResultMessage — " + detail


def verdict_context_management(rows: dict[str, dict[str, Any]]) -> tuple[str, str]:
    per = {n: (r.get("wire") or {}).get("context_management_on_wire") for n, r in rows.items()}
    detail = f"per arm {per}"
    if any(v is True for v in per.values()):
        return "yes", detail
    if all(v is None for v in per.values()):
        return "unknown", detail + (" — no debug log carried an [API REQUEST DETAIL] line "
                                    "(is CLAUDE_CODE_DEBUG_LOG_LEVEL=verbose reaching the CLI?)")
    return "no", detail


def verdicts(rows: dict[str, dict[str, Any]]) -> list[dict[str, str]]:
    out = []
    for name, fn in (("tool search on bedrock", verdict_tool_search), ("1h TTL", verdict_1h),
                     ("interleaved thinking", verdict_interleaved), ("1m context", verdict_1m),
                     ("context_management on wire", verdict_context_management)):
        v, detail = fn(rows)
        out.append({"name": name, "verdict": v, "detail": detail})
    return out


# ── output ──────────────────────────────────────────────────────────────


def _yn(v: Any) -> str:
    return "?" if v is None else ("yes" if v else "no")


def print_table(rows: dict[str, dict[str, Any]]) -> None:
    hdr = (f"{'arm':<16}{'provider':<12}{'init model':<40}{'ToolSearch':<12}{'deferred':<10}"
           f"{'conv_cal':<10}{'thinking':<10}{'interleav':<10}{'1h/5m write':<16}"
           f"{'2nd cache_read':<16}{'ctxWindow':<10}cost")
    print("\n" + "=" * 170)
    print(hdr)
    print("-" * 170)
    for name, r in rows.items():
        if r.get("error"):
            print(f"{name:<16}{'ERROR':<12}{one_line(str(r['error']), 120)}")
            continue
        t = _first(r)
        init = t.get("init") or {}
        res = t.get("result") or {}
        ctx = "/".join(str(v.get("contextWindow")) for v in (res.get("model_usage") or {}).values()) or "?"
        second = _first_call_cache_read(_second(r)) if _second(r) else None
        print(f"{name:<16}{','.join(res.get('providers') or ['?']):<12}"
              f"{str(init.get('model'))[:38]:<40}"
              f"{_yn(init.get('tool_search_in_tools')) + '×' + str(t.get('tool_search_calls', 0)):<12}"
              f"{_yn(init.get('deferred')):<10}{_yn(t.get('convert_calendar_called')):<10}"
              f"{t.get('thinking_blocks', 0):<10}{_yn(t.get('interleaved_thinking')):<10}"
              f"{str(res.get('ephemeral_1h_input_tokens')) + '/' + str(res.get('ephemeral_5m_input_tokens')):<16}"
              f"{str(second) if _second(r) else 'n/a':<16}{ctx:<10}${res.get('total_cost_usd') or 0:.4f}")
    print("=" * 170)


def print_costs(rows: dict[str, dict[str, Any]]) -> float:
    print("\ntokens/cost per arm (from ResultMessage; both turns where there were two):")
    total = 0.0
    for name, r in rows.items():
        arm_cost = 0.0
        for t in (_first(r), _second(r)):
            res = t.get("result") or {}
            if not res:
                continue
            cost = res.get("total_cost_usd") or 0.0
            arm_cost += cost
            print(f"  {name:<16} turn {t['turn']}  ${cost:.4f}  in={res.get('input_tokens')} "
                  f"(+cache read {res.get('cache_read_input_tokens')}, create "
                  f"{res.get('cache_creation_input_tokens')}; 1h {res.get('ephemeral_1h_input_tokens')} "
                  f"/ 5m {res.get('ephemeral_5m_input_tokens')})  out={res.get('output_tokens')}  "
                  f"turns={res.get('num_turns')}  {res.get('duration_ms')} ms")
        total += arm_cost
    print(f"  {'TOTAL':<16} ${total:.4f}")
    return total


# ── --dry-run ───────────────────────────────────────────────────────────


def describe_options(opts: Any) -> dict[str, Any]:
    env = dict(opts.env)
    return {
        "env_keys": sorted(env),
        "env_provider_pins": {k: env[k] for k in sorted(env)
                              if k.startswith(("CLAUDE_CODE_USE_", "AWS_", "ANTHROPIC_MODEL",
                                               "ENABLE_PROMPT_CACHING", "ENABLE_TOOL_SEARCH",
                                               "CLAUDE_CODE_DEBUG_LOG_LEVEL"))},
        "model": opts.model,
        "extra_args": dict(opts.extra_args),
        "max_turns": opts.max_turns,
        "betas": list(opts.betas),
        "disallowed_tools": list(opts.disallowed_tools),
        "session_store": getattr(opts, "session_store", None) is not None,
        "agents": len(opts.agents or {}),
    }


def _transport_argv(opts: Any) -> list[str] | str:
    """The argv the SDK's transport would spawn — resolved without spawning."""
    try:
        from claude_agent_sdk._internal.transport.subprocess_cli import SubprocessCLITransport
        t = SubprocessCLITransport(prompt="", options=opts)
        t._cli_path = t._find_cli()
        return t._build_command()
    except Exception as exc:  # noqa: BLE001 - private API; report rather than fail the dry run
        return f"(argv unavailable: {type(exc).__name__}: {exc})"


def dry_run() -> int:
    key = api_key() or "dry-run-placeholder"
    tmp = Path(tempfile.mkdtemp(prefix="p1-bedrock-dry-"))
    try:
        project = seed_project(tmp / "project")
        for arm in ARMS:
            config_dir = tmp / f"cfg-{arm.name}"
            config_dir.mkdir()
            opts = build_arm_options(arm, key=key, project=project, config_dir=config_dir,
                                     debug_log=tmp / f"{arm.name}.debug.log")
            print(f"\n== {arm.name} ==")
            print(json.dumps(describe_options(opts), indent=2))
            argv = _transport_argv(opts)
            if isinstance(argv, list):
                flags = [a for a in argv if a.startswith("--")]
                print("transport argv flags:", " ".join(flags))
                for i, a in enumerate(argv):
                    if a in ("--model", "--debug-file", "--max-turns", "--betas"):
                        print(f"  {a} {argv[i + 1]}")
                print("  --model present:", "--model" in argv)
            else:
                print(argv)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print(f"\ninherited env names that could steer an arm: {inherited_env_names() or '(none)'}")
    return 0


# ── main ────────────────────────────────────────────────────────────────


async def run_all(out_dir: Path, skip_wait: bool) -> int:
    key = api_key()
    if not key:
        print("no ANTHROPIC_API_KEY in env or eval/.env (the first-party arm needs it)",
              file=sys.stderr)
        return 2
    from app.agent import real_agent
    if not Path(real_agent._MCP_BUILD).exists():
        print(f"no compiled engine at {real_agent._MCP_BUILD} — run `make engine-build`",
              file=sys.stderr)
        return 2
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"out: {out_dir}")
    inherited = inherited_env_names()
    if inherited:
        print(f"WARNING: inherited shell variables that can steer an arm's provider/model: "
              f"{inherited} (values not shown; the SDK merges os.environ under options.env)")
    if skip_wait:
        print("--skip-wait: no second turn; the 1h TTL verdict falls back to the usage split")

    kw = {"key": key, "out_dir": out_dir, "skip_wait": skip_wait}
    rows: dict[str, dict[str, Any]] = {}
    for name in ("first-party", "bedrock-1m"):
        rows[name] = await run_arm_guarded(ARMS_BY_NAME[name], **kw)
        _write_json(out_dir / f"{name}.json", rows[name])
    pair = await asyncio.gather(*(run_arm_guarded(ARMS_BY_NAME[n], **kw) for n in CACHE_ARMS))
    for name, row in zip(CACHE_ARMS, pair):
        rows[name] = row
        _write_json(out_dir / f"{name}.json", row)

    print_table(rows)
    total = print_costs(rows)
    vs = verdicts(rows)
    print()
    for v in vs:
        print(f"VERDICT: {v['name']}: {v['verdict']} — {v['detail']}")
    summary = {"out": str(out_dir), "skip_wait": skip_wait, "finished": _now_iso(),
               "total_cost_usd": total, "verdicts": vs,
               "arms": {n: {k: r.get(k) for k in ("error", "first_turn", "second_turn", "wire")}
                        for n, r in rows.items()}}
    _write_json(out_dir / "summary.json", summary)
    print(f"\nsummary: {out_dir / 'summary.json'}")
    return 2 if any(r.get("error") for r in rows.values()) else 0


def _write_json(path: Path, doc: Any) -> None:
    path.write_text(json.dumps(doc, indent=2, ensure_ascii=False, default=str) + "\n",
                    encoding="utf-8")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m dev.p1.probe_bedrock_parity",
        description="P3 probe: tool search, the 1-hour cache TTL, interleaved thinking, the "
                    "1M-context beta and context_management on Bedrock direct vs first-party. "
                    "Four billed sessions (~8 min wall clock); exit 0 always, 2 if an arm raised.",
    )
    p.add_argument("--out", default=None,
                   help="output dir (default ~/.cache/cowork-genealogy/p1/bedrock-parity-<ts>)")
    p.add_argument("--skip-wait", action="store_true",
                   help="skip the 7-minute wait and the second turn on the two cache arms")
    p.add_argument("--dry-run", action="store_true",
                   help="build the four arms' options in-process and print env keys, model, "
                        "extra_args, max_turns and the transport argv; no spawn, no tokens")
    return p


def main(argv: list[str] | None = None) -> int:
    # House pattern: a Windows console defaults to cp1252.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    args = build_parser().parse_args(argv)
    if args.dry_run:
        return dry_run()
    out_dir = Path(args.out).expanduser().resolve() if args.out else default_out_dir()
    return asyncio.run(run_all(out_dir, args.skip_wait))


if __name__ == "__main__":
    sys.exit(main())

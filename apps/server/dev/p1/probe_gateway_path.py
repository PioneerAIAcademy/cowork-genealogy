#!/usr/bin/env python3
"""P3b — the CLI behind a Messages-compatible gateway: what changes when
ANTHROPIC_BASE_URL is not api.anthropic.com?

FamilySearch answered on 2026-09-11 that their Agent Gateway is Anthropic-Messages-
compatible (agentgateway v1.4.1, `POST /bedrock/v1/messages`, Messages→Converse), so
production runs the Agent SDK with ANTHROPIC_BASE_URL pointed at the gateway and
CLAUDE_CODE_USE_BEDROCK unset. To the CLI a gateway hostname is a "non-first-party
base URL", and it keys several behaviours on that. This probe stands a logging
pass-through (`passthrough_proxy.py`) in the gateway's position — same CLI, same key,
same upstream, only the base URL differs — and reads what changes off the init frame,
the stream, the debug log and the proxy's own log.

Arms, each its own session on the PROTOTYPE option set
(`dev.p1.options.build_prototype_options(..., store=None, max_turns=4)`, a temp
project seeded from `eval/fixtures/scenarios/empty-project-just-created`, a fresh
`CLAUDE_CONFIG_DIR`, `--debug-file` + `CLAUDE_CODE_DEBUG_LOG_LEVEL=verbose`), all on
`probe_bedrock_parity.QUERY` (ToolSearch → convert_calendar → reply):

    first-party      control: no base URL; the prototype set as is (ENABLE_TOOL_SEARCH=true)
    proxy            ANTHROPIC_BASE_URL=http://127.0.0.1:<port>; the prototype set as is
    proxy-ets-unset  proxy + ENABLE_TOOL_SEARCH removed from the CLI's env — the gate's
                     own precondition (below); what a deployment that never set it gets
    proxy-assume-fp  proxy-ets-unset + _CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL=1 — the
                     CLI's own escape hatch for a first-party-compatible proxy
    proxy-1h         proxy + ENABLE_PROMPT_CACHING_1H=1 — do the 1-hour ttl and its beta
                     reach the wire behind a non-first-party base URL?

Per arm (`<out>/<arm>.json`, `<out>/<arm>.debug.log`, `<out>/<arm>.proxy.jsonl`): the
init frame's tool list (ToolSearch present? any mcp__genealogy__ name? count);
ToolSearch tool_use count; convert_calendar called and its result; first-call usage
(input / cache_creation / cache_read off the first AssistantMessage); cost; the debug
log's `[ToolSearch:optimistic]` line, its per-call `Dynamic tool loading: N/M deferred
tools included` lines and its `[API REQUEST DETAIL]` betas; and the proxy's per-request
lines (tools count, tool types, mcp__ tool count, anthropic-beta, cache_control ttls).

Verdict lines (exit 0 always — a measurement — except 2 when an arm raised):
    tool search behind a non-anthropic base URL [<arm>]: on | off | mixed | unknown
        Keyed on two signals that agree on every arm measured: the wire (the proxy's
        first tool-carrying model call — mcp__ tools 0 means the MCP schemas were
        deferred; 48 means they were eager-loaded) and the CLI's own per-call debug
        line `Dynamic tool loading: N/M deferred tools included` (M > 0 = deferral in
        force; the line is absent when tool search is off). The init frame's tool
        list is corroboration only: `mcp_servers.status` was `pending` at init on
        every tool-search-ON arm and `connected` on the OFF arm, so "0 mcp__genealogy__
        names in init" is confounded with MCP connect timing. The control has no
        proxy, so its state rests on the debug line alone and its init count is
        timing-dependent.
    eager-load delta [<arm>]: whole first prompt (input + cache_creation + cache_read)
        proxy − control. The input+cache_creation figure alone is in the detail: a
        cross-arm prompt-cache hit flips its sign. Arms whose beta sets are identical
        share a cacheable prefix for 5 minutes (first-party and proxy-assume-fp both
        carry cache-diagnosis-2026-04-07; plain proxy does not), so run back-to-back
        they hit each other's cache — −15,579 with first-party first, +15,589 with
        proxy-assume-fp first, the whole-prompt figure +5 both times (2026-09-11). A
        WARNING names any arm whose first call read cache. Space such arms >= 5
        minutes apart for a fresh-write comparison.
    wire: cache_control ttl values seen through the proxy; extended-cache-ttl beta seen
    gate (read off the binary, not measured): the exact comparison the CLI makes

    uv run python -m dev.p1.probe_gateway_path [--out DIR] [--arms a,b]
    uv run python -m dev.p1.probe_gateway_path --dry-run     (zero tokens, no spawn)
    uv run python -m dev.p1.probe_gateway_path --replay DIR  (re-derive the verdicts from a
                                                              run's <arm>.json; no spawn;
                                                              keeps summary.json's scrubbed_env)

Needs a compiled engine (`make engine-build`) and a key in $ANTHROPIC_API_KEY or
eval/.env. Every arm bills the same first-party key; the proxy adds no auth of its own.

How the CLI (bundled 2.1.220, `claude_agent_sdk/_bundled/claude`; read by slicing a
byte window around each hit — the binary is 256 MB and ugrep's `-o .{0,N}` context
refuses it) decides, quoted so the reading can be re-checked against a newer binary:

  The gate. `s3` answers "use tool search?"; `WKr` maps ENABLE_TOOL_SEARCH to a mode:
    function WKr(){if(Rye())return"standard";let e=process.env.ENABLE_TOOL_SEARCH,
      t=e?uls(e):null;if(t===0)return"tst";if(t===100)return"standard";
      if(k7g(e))return"tst-auto";if(Yt(e))return"tst";
      if(su(process.env.ENABLE_TOOL_SEARCH))return"standard";return"tst"}
    function s3(){let e=WKr();
      if(e==="standard"){…w(`[ToolSearch:optimistic] mode=${e}, ENABLE_TOOL_SEARCH=…,
        result=false`);return!1}
      if(!process.env.ENABLE_TOOL_SEARCH&&xn()==="firstParty"&&!Yd()){…w(`[ToolSearch:optimistic]
        disabled: ANTHROPIC_BASE_URL=${Z.ANTHROPIC_BASE_URL} is not a first-party Anthropic
        host. Set ENABLE_TOOL_SEARCH=true (or auto / auto:N) if your proxy forwards
        tool_reference blocks.`);return!1}
      if(!process.env.ENABLE_TOOL_SEARCH&&xn()==="vertex"){…return!1}
      …w(`[ToolSearch:optimistic] mode=${e}, ENABLE_TOOL_SEARCH=…, result=true`);return!0}
    (Rye = CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS || the hipaa flag; Yt = truthy
     "1|true|yes|on"; su = falsy "0|false|no|off"; uls = "auto:N" → N. `w` is the debug
     logger, so the line lands in --debug-file and this probe reads it back.)

  The base-URL predicate the gate (and 35 other sites in the binary) call:
    function Yd(){if(Z._CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL)return!0;return d6r()}
    function d6r(){let e=process.env.ANTHROPIC_BASE_URL;if(!e)return!0;return T1e(e)}
    function T1e(e){try{let t=new URL(e).host;return["api.anthropic.com"].includes(t)}
      catch{return!1}}
  i.e. exact string equality of `new URL(ANTHROPIC_BASE_URL).host` with
  "api.anthropic.com": scheme and path are ignored (`http://api.anthropic.com/bedrock/v1`
  passes), a non-default port is part of `.host` and fails (`https://api.anthropic.com:8443`
  fails), any other hostname fails, an unparsable value fails.

  The provider selector — the base-URL branch of the gate applies to firstParty only:
    function xn(){if(C_())return"gateway";return Z.CLAUDE_CODE_USE_BEDROCK?"bedrock":
      Z.CLAUDE_CODE_USE_FOUNDRY?"foundry":Z.CLAUDE_CODE_USE_ANTHROPIC_AWS?"anthropicAws":
      Z.CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD?"anthropicGoogleCloud":
      Z.CLAUDE_CODE_USE_MANTLE?"mantle":Z.CLAUDE_CODE_USE_VERTEX?"vertex":"firstParty"}
  (C_ is the CLI's own gateway-auth state, not an env var. CLAUDE_CODE_USE_ANTHROPIC_AWS
  selects a different provider with its own credentials — ANTHROPIC_AWS_API_KEY /
  ANTHROPIC_AWS_BASE_URL — not a way to send a first-party key through a Messages
  gateway, so it is not armed here.)

  The 1-hour cache TTL and its beta are not keyed on the hostname at all:
    function eFe(e){if(Yt(process.env.FORCE_PROMPT_CACHING_5M))return!1;
      if(Yt(process.env.ENABLE_PROMPT_CACHING_1H)||xn()==="bedrock"&&
         Yt(process.env.ENABLE_PROMPT_CACHING_1H_BEDROCK))return!0;
      if(!ii()||Vie().isUsingOverage)return!1;
      let t=aEi();if(t===null)t=Ke("tengu_prompt_cache_1h_config",{allowlist:[
        "repl_main_thread*","sdk","auto_mode","memdir_relevance"]}).allowlist??[],lEi(t);
      return e!==void 0&&t.some(…)}
    function ii(){if(!zb())return!1;return yG(ms()?.scopes)}   (a Claude.ai OAuth token)
    let P=eFe(e.querySource)?"1h":void 0;if(P==="1h"&&DH()&&!I.includes(qkt))I.push(qkt)
    function DH(){return eYn()&&!Rye()}
    function eYn(){let e=xn();return e==="firstParty"||aq(e)||e==="foundry"}
  so on an API key (no OAuth token) the TTL is 1h only under ENABLE_PROMPT_CACHING_1H=1,
  and the extended-cache-ttl beta (qkt) follows the TTL on any first-party-shaped
  provider. The `proxy-1h` arm measures that path through the proxy.

So there are three ways past the gate, in the order the code checks them: any value
in ENABLE_TOOL_SEARCH (the prototype and the hosted option sets both set "true"), a
non-firstParty provider, or `_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL` truthy. The
`proxy` arm measures the first, `proxy-assume-fp` the third, and `proxy-ets-unset` is
the only arm in which the gate can fire at all.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import tempfile
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# /repo/apps/server/dev/p1/probe_gateway_path.py -> parents[2] = apps/server
SERVER_DIR = Path(__file__).resolve().parents[2]
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from dev.p1._probe_common import one_line, seed_project  # noqa: E402
from dev.p1.options import api_key  # noqa: E402
from dev.p1.passthrough_proxy import read_log, start_proxy, stop_proxy, summarize_body  # noqa: E402
from dev.p1.probe_bedrock_parity import (  # noqa: E402
    BETA_TOOL_SEARCH,
    DEBUG_LOG_ENV,
    FIRST_PARTY_MODEL,
    MAX_TURNS,
    QUERY,
    TARGET_TOOL,
    collect_turn,
    inherited_env_names,
    parse_debug_log,
)

BETA_EXTENDED_CACHE_TTL = "extended-cache-ttl-2025-04-11"
BETA_ADVANCED_TOOL_USE = "advanced-tool-use-2025-11-20"   # what tool-search mode puts on the wire
CACHE_1H_ENV = "ENABLE_PROMPT_CACHING_1H"
ETS_ENV = "ENABLE_TOOL_SEARCH"
BASE_URL_ENV = "ANTHROPIC_BASE_URL"
ASSUME_FP_ENV = "_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL"
GATE_MARKER = "[ToolSearch:optimistic]"
# Logged by the CLI once per tool-carrying model call while tool search is on:
#   Dynamic tool loading: 0/15 deferred tools included   (before the MCP server connects)
#   Dynamic tool loading: 1/63 deferred tools included   (48 MCP + 15 built-in deferred)
# Absent when tool search is off. Readable on the control arm, which has no proxy.
_DEFERRED_RE = re.compile(r"Dynamic tool loading: (\d+)/(\d+) deferred tools included")
ARM_TIMEOUT_S = 10 * 60
CONTROL = "first-party"
# Removed from this process's environment before any arm spawns: the SDK merges
# os.environ UNDER options.env, so an inherited value would reach an arm that means
# to leave the variable unset. Names are recorded; values never are.
SCRUBBED_ENV = (ETS_ENV, BASE_URL_ENV, ASSUME_FP_ENV, CACHE_1H_ENV, "FORCE_PROMPT_CACHING_5M")
# Would route the CLI's loopback fetch somewhere else; warned about, not removed.
HTTP_PROXY_ENV = ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
                  "http_proxy", "https_proxy", "all_proxy", "no_proxy")

GATE_READING = (
    "CLI 2.1.220 s3(): the base-URL branch fires only when ENABLE_TOOL_SEARCH is unset AND the "
    "provider is firstParty AND !Yd(); Yd() = _CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL truthy || "
    "ANTHROPIC_BASE_URL unset || new URL(ANTHROPIC_BASE_URL).host === \"api.anthropic.com\" "
    "(exact string equality on URL.host: scheme and path ignored, a non-default port is part of "
    ".host and fails, any other hostname fails). A gateway hostname therefore fails the "
    "predicate; what keeps tool search on is ENABLE_TOOL_SEARCH being set at all."
)


@dataclass(frozen=True)
class Arm:
    name: str
    proxy: bool                          # ANTHROPIC_BASE_URL -> the in-process proxy
    env: dict[str, str] = field(default_factory=dict)   # added to the prototype env
    drop: tuple[str, ...] = ()           # removed from the prototype env (and scrubbed from the shell)
    note: str = ""


ARMS = (
    Arm(CONTROL, False, note="control: no base URL; the prototype set as is (ENABLE_TOOL_SEARCH=true)"),
    Arm("proxy", True, note="ANTHROPIC_BASE_URL=http://127.0.0.1:<port>; the prototype set as is"),
    Arm("proxy-ets-unset", True, drop=(ETS_ENV,),
        note="proxy + ENABLE_TOOL_SEARCH unset — the only arm in which the gate can fire"),
    Arm("proxy-assume-fp", True, {ASSUME_FP_ENV: "1"}, (ETS_ENV,),
        note="proxy-ets-unset + _CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL=1 (the CLI's escape)"),
    Arm("proxy-1h", True, {CACHE_1H_ENV: "1"},
        note="proxy + ENABLE_PROMPT_CACHING_1H=1 — do the 1h ttl and its beta reach the wire?"),
)
ARMS_BY_NAME = {a.name: a for a in ARMS}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def default_out_dir() -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return Path.home() / ".cache" / "cowork-genealogy" / "p1" / f"gateway-path-{stamp}"


def build_arm_options(arm: Arm, *, key: str, project: Path, config_dir: Path,
                      debug_log: Path, base_url: str | None,
                      hook_log: list[dict[str, Any]] | None = None):
    from dev.p1.options import build_prototype_options

    extra = {**DEBUG_LOG_ENV, **arm.env}
    if base_url:
        extra[BASE_URL_ENV] = base_url
    opts = build_prototype_options(
        project, api_key=key, store=None, config_dir=config_dir, model=FIRST_PARTY_MODEL,
        extra_env=extra, hook_log=hook_log, max_turns=MAX_TURNS,
    )
    # ClaudeAgentOptions is a plain dataclass; the transport reads env/extra_args at connect().
    for name in arm.drop:
        opts.env.pop(name, None)
    opts.extra_args = {"debug-file": str(debug_log)}
    return opts


def cli_env_view(opts: Any) -> dict[str, str]:
    """The three variables the gate reads, as the CLI child will see them."""
    return {k: opts.env.get(k, "<unset>")
            for k in (ETS_ENV, BASE_URL_ENV, ASSUME_FP_ENV, CACHE_1H_ENV)}


def scrub_shell_env() -> list[str]:
    """Drop SCRUBBED_ENV from os.environ so no arm inherits a steering value."""
    return [k for k in SCRUBBED_ENV if os.environ.pop(k, None) is not None]


def gate_lines(debug_log: Path) -> list[str]:
    """The `[ToolSearch:optimistic] …` lines the CLI logged (one per session, normally)."""
    if not debug_log.exists():
        return []
    out = []
    for line in debug_log.read_text(encoding="utf-8", errors="replace").splitlines():
        idx = line.find(GATE_MARKER)
        if idx >= 0:
            out.append(one_line(line[idx:], 400))
    return out[:5]


def deferred_loading(debug_log: Path) -> list[list[int]]:
    """`[included, deferred]` per `Dynamic tool loading: N/M deferred tools included`
    line, in order — one per tool-carrying model call while tool search is on."""
    if not debug_log.exists():
        return []
    return [[int(m.group(1)), int(m.group(2))]
            for m in _DEFERRED_RE.finditer(debug_log.read_text(encoding="utf-8", errors="replace"))]


_REQUEST_KEYS = (
    "seq", "method", "path", "status", "body_bytes", "tools", "tool_types", "mcp_tools",
    "tool_search_tool", "tool_reference_blocks", "anthropic_beta", "cache_control_ttls",
    "cache_control", "x_api_key_present", "authorization_present", "model", "stream",
    "system_preview", "user_preview",
    "response_bytes", "response_tool_reference_mentions", "ttfb_ms", "duration_ms", "error",
)


def _request_row(rec: dict[str, Any]) -> dict[str, Any]:
    return {k: rec.get(k) for k in _REQUEST_KEYS}


def _request_line(r: dict[str, Any]) -> str:
    return (f"#{r.get('seq')} {r.get('method')} {r.get('path')} -> {r.get('status')} "
            f"tools={r.get('tools')} types={r.get('tool_types')} mcp={r.get('mcp_tools')} "
            f"tool_refs={r.get('tool_reference_blocks')} ttls={r.get('cache_control_ttls')} "
            f"body={r.get('body_bytes')}B resp={r.get('response_bytes')}B "
            f"({r.get('duration_ms')} ms) model={r.get('model')} "
            f"user={r.get('user_preview')!r} beta={r.get('anthropic_beta')!r}"
            + (f" ERROR {r['error']}" if r.get("error") else ""))


# ── one arm ─────────────────────────────────────────────────────────────


async def run_arm(arm: Arm, *, key: str, out_dir: Path) -> dict[str, Any]:
    from claude_agent_sdk import ClaudeSDKClient

    debug_log = out_dir / f"{arm.name}.debug.log"
    proxy_log = out_dir / f"{arm.name}.proxy.jsonl"
    obs: dict[str, Any] = {
        "arm": arm.name, "note": arm.note, "query": QUERY, "proxy": arm.proxy,
        "env_added": dict(arm.env), "env_dropped": list(arm.drop),
        "base_url": None, "proxy_port": None, "cli_env": None,
        "model_option": FIRST_PARTY_MODEL, "max_turns": MAX_TURNS,
        "debug_log": str(debug_log), "proxy_log": str(proxy_log) if arm.proxy else None,
        "started": _now_iso(), "turn": None, "hook_tools": None, "gate_lines": None,
        "deferred_loading": None, "wire": None, "proxy_requests": None, "error": None,
        "finished": None,
    }
    server = thread = None
    base_url = None
    if arm.proxy:
        server, thread = start_proxy(proxy_log)
        base_url = f"http://127.0.0.1:{server.port}"
        obs["base_url"], obs["proxy_port"] = base_url, server.port
    hook_log: list[dict[str, Any]] = []
    try:
        with tempfile.TemporaryDirectory(prefix=f"p1-gateway-{arm.name}-") as td:
            tmp = Path(td)
            project = seed_project(tmp / "project")
            config_dir = tmp / "config"
            config_dir.mkdir()
            options = build_arm_options(arm, key=key, project=project, config_dir=config_dir,
                                        debug_log=debug_log, base_url=base_url, hook_log=hook_log)
            obs["cli_env"] = cli_env_view(options)
            client = ClaudeSDKClient(options=options)
            await client.connect()
            try:
                obs["turn"] = await collect_turn(client, 1, QUERY, arm.name)
            finally:
                await client.disconnect()
    finally:
        if server is not None and thread is not None:
            stop_proxy(server, thread)
    obs["hook_tools"] = [h.get("tool_name") for h in hook_log]
    obs["gate_lines"] = gate_lines(debug_log)
    obs["deferred_loading"] = deferred_loading(debug_log)
    obs["wire"] = parse_debug_log(debug_log)
    obs["proxy_requests"] = [_request_row(r) for r in read_log(proxy_log)] if arm.proxy else []
    obs["finished"] = _now_iso()
    for line in obs["gate_lines"]:
        print(f"[{arm.name}] debug: {line}", flush=True)
    for r in obs["proxy_requests"]:
        print(f"[{arm.name}] proxy {_request_line(r)}", flush=True)
    return obs


async def run_arm_guarded(arm: Arm, **kw: Any) -> dict[str, Any]:
    print(f"... {arm.name}: proxy={arm.proxy} env+={arm.env} env-={list(arm.drop)} — {arm.note}",
          flush=True)
    try:
        return await asyncio.wait_for(run_arm(arm, **kw), timeout=ARM_TIMEOUT_S)
    except Exception as exc:  # noqa: BLE001 - a failed arm is an error row, not a crash
        print(f"[{arm.name}] ERROR {type(exc).__name__}: {exc}", flush=True)
        out_dir = kw["out_dir"]
        return {"arm": arm.name, "note": arm.note, "proxy": arm.proxy,
                "env_added": dict(arm.env), "env_dropped": list(arm.drop),
                "error": f"{type(exc).__name__}: {exc}", "turn": None,
                "gate_lines": gate_lines(out_dir / f"{arm.name}.debug.log"),
                "deferred_loading": deferred_loading(out_dir / f"{arm.name}.debug.log"),
                "wire": parse_debug_log(out_dir / f"{arm.name}.debug.log"),
                "proxy_requests": [_request_row(r) for r in
                                   read_log(out_dir / f"{arm.name}.proxy.jsonl")]}


# ── verdicts ────────────────────────────────────────────────────────────


def _turn(row: dict[str, Any] | None) -> dict[str, Any]:
    return (row or {}).get("turn") or {}


def _init(row: dict[str, Any] | None) -> dict[str, Any]:
    return _turn(row).get("init") or {}


def _first_call(row: dict[str, Any] | None) -> dict[str, Any]:
    calls = _turn(row).get("api_calls") or []
    return calls[0] if calls else {}


def _main_requests(row: dict[str, Any] | None) -> list[dict[str, Any]]:
    """The proxied POST /v1/messages calls that carried tools — the turn's own model
    calls, not the CLI's HEAD /api/hello check or its tool-less haiku side call."""
    return [r for r in ((row or {}).get("proxy_requests") or [])
            if r.get("method") == "POST" and (r.get("tools") or 0) > 0]


def _n(v: Any) -> int:
    return int(v) if v is not None else 0


def _mcp_status(init: dict[str, Any]) -> str | None:
    """`mcp_servers[].status` of the genealogy server at init, or None."""
    for s in init.get("mcp_servers") or []:
        if isinstance(s, dict) and s.get("name") == "genealogy":
            return str(s.get("status"))
    return None


def tool_search_state(row: dict[str, Any] | None) -> tuple[str, dict[str, Any]]:
    """`on` / `off` / `mixed` / `unknown`, with the evidence.

    Wire signal (proxy arms): the first tool-carrying model call's `mcp_tools` —
    0 means the MCP schemas were deferred, > 0 that they were eager-loaded. Debug
    signal (every arm, the control included): any `Dynamic tool loading: N/M
    deferred tools included` line with M > 0 means deferral is in force; no such
    line in a log that did capture model calls means it is off. `on`/`off` need
    every available signal to agree; `mixed` when they disagree."""
    reqs = _main_requests(row)
    first = reqs[0] if reqs else None
    deferred = (row or {}).get("deferred_loading") or []
    wire = (row or {}).get("wire") or {}
    votes: dict[str, str | None] = {"wire": None, "debug": None}
    if first is not None:
        votes["wire"] = "on" if _n(first.get("mcp_tools")) == 0 else "off"
    if deferred:
        votes["debug"] = "on" if any(m > 0 for _, m in deferred) else "off"
    elif wire.get("api_request_detail_lines"):
        votes["debug"] = "off"
    cast = {v for v in votes.values() if v}
    state = "unknown" if not cast else next(iter(cast)) if len(cast) == 1 else "mixed"
    evidence = {"wire_first_call_tools": first.get("tools") if first else None,
                "wire_first_call_mcp_tools": first.get("mcp_tools") if first else None,
                "deferred_loading": deferred, "votes": votes}
    return state, evidence


def verdict_tool_search(rows: dict[str, dict[str, Any]], arm_name: str) -> tuple[str, str]:
    row, ctrl = rows.get(arm_name), rows.get(CONTROL)
    if not row or row.get("error") or not _init(row):
        return "undecidable", f"{arm_name} errored, did not run, or produced no init frame"
    ri, ci = _init(row), _init(ctrl)
    reqs = _main_requests(row)
    beta_atu = [BETA_ADVANCED_TOOL_USE in (r.get("anthropic_beta") or "") for r in reqs]
    beta_ts = any(BETA_TOOL_SEARCH in (r.get("anthropic_beta") or "") for r in reqs)
    tool_refs = [r.get("tool_reference_blocks") for r in reqs]
    tools_per = [r.get("tools") for r in reqs]
    mcp_per = [r.get("mcp_tools") for r in reqs]
    state, ev = tool_search_state(row)
    c_state, c_ev = tool_search_state(ctrl)
    verdict = (f"{state} (wire: first call tools {ev['wire_first_call_tools']}, mcp "
               f"{ev['wire_first_call_mcp_tools']}; deferred-loading lines {ev['deferred_loading']}; "
               f"control {c_state} on its debug line alone {c_ev['deferred_loading']})")
    detail = (f"cli env {row.get('cli_env')}; signals {ev['votes']}; "
              f"wire (tool-carrying model calls): tools per call {tools_per}, mcp__ tools per call "
              f"{mcp_per}, tool_reference blocks per call {tool_refs}, {BETA_ADVANCED_TOOL_USE} in "
              f"anthropic-beta {beta_atu}, server-side {BETA_TOOL_SEARCH} in anthropic-beta {beta_ts}; "
              f"ToolSearch calls {_turn(row).get('tool_search_calls')}; {TARGET_TOOL} called "
              f"{_turn(row).get('convert_calendar_called')}; gate line {row.get('gate_lines')}; "
              f"init frame (corroboration only — its tool list depends on whether the MCP server had "
              f"connected): tools {ri.get('tool_count')} (control {ci.get('tool_count', '?')}), "
              f"ToolSearch listed {ri.get('tool_search_in_tools')} (control {ci.get('tool_search_in_tools')}), "
              f"mcp__genealogy__ names {ri.get('mcp_genealogy_count')} (control {ci.get('mcp_genealogy_count')}), "
              f"genealogy MCP status at init {_mcp_status(ri)!r} (control {_mcp_status(ci)!r})")
    return verdict, detail


def cross_arm_cache_hits(rows: dict[str, dict[str, Any]]) -> list[str]:
    """Arms whose FIRST model call read cache: not a fresh write, so their
    input+cache_creation figure is not comparable to a fresh arm's."""
    out = []
    for name, r in rows.items():
        first = _first_call(r)
        read = _n(first.get("cache_read_input_tokens")) if first else 0
        if read > 0:
            out.append(f"{name}: first call cache_read_input_tokens={read} — cross-arm prompt-cache "
                       f"hit, not a fresh write (an earlier arm with the same beta set wrote this "
                       f"prefix within 5 minutes); compare whole-first-prompt figures only")
    return out


def verdict_eager(rows: dict[str, dict[str, Any]], arm_name: str) -> tuple[str, str]:
    c, r = _first_call(rows.get(CONTROL)), _first_call(rows.get(arm_name))
    if not c or not r:
        return "undecidable", "no first AssistantMessage.usage on the control or the arm"
    cv = _n(c.get("input_tokens")) + _n(c.get("cache_creation_input_tokens"))
    rv = _n(r.get("input_tokens")) + _n(r.get("cache_creation_input_tokens"))
    c_read, r_read = _n(c.get("cache_read_input_tokens")), _n(r.get("cache_read_input_tokens"))
    c_full, r_full = cv + c_read, rv + r_read
    mains = _main_requests(rows.get(arm_name))
    first = mains[0] if mains else {}
    hit = " [cross-arm cache hit on the control and/or the arm: see WARNING]" if (c_read or r_read) else ""
    detail = (f"whole first prompt: {arm_name} {r_full} (input {r.get('input_tokens')} + cache_creation "
              f"{r.get('cache_creation_input_tokens')} + cache_read {r_read}) − control {c_full} (input "
              f"{c.get('input_tokens')} + cache_creation {c.get('cache_creation_input_tokens')} + cache_read "
              f"{c_read}); input+cache_creation only: {rv} vs {cv} ({rv - cv:+d}){hit}; "
              f"first model call through the proxy: {first.get('body_bytes')} bytes, tools "
              f"{first.get('tools')}, types {first.get('tool_types')}")
    return f"{r_full - c_full:+d} tokens", detail


def verdict_wire(rows: dict[str, dict[str, Any]]) -> tuple[str, str]:
    per_arm = {n: _main_requests(r) for n, r in rows.items() if r.get("proxy")}
    reqs = [(n, r) for n, rs in per_arm.items() for r in rs]
    if not reqs:
        return "unknown", "no proxy arm produced a model call"
    ttls = sorted({t for _, r in reqs for t in (r.get("cache_control_ttls") or [])})
    ttls_by_arm = {n: sorted({t for r in rs for t in (r.get("cache_control_ttls") or [])})
                   for n, rs in per_arm.items()}
    beta_sets = {n: {b for r in rs for b in (r.get("anthropic_beta") or "").split(",") if b}
                 for n, rs in per_arm.items()}
    common = set.intersection(*beta_sets.values())
    extra_by_arm = {n: sorted(b - common) for n, b in beta_sets.items()}
    # The CLI's tool-less side call (a haiku session-title request) is a model call
    # too, with its own beta set — a gateway has to pass those as well. Same
    # treatment: the set common to every such call, then each arm's extras.
    side_by_arm = {n: [q for q in (r.get("proxy_requests") or [])
                       if q.get("method") == "POST" and not (q.get("tools") or 0) and q.get("model")]
                   for n, r in rows.items() if r.get("proxy")}
    side = [q for qs in side_by_arm.values() for q in qs]
    side_models = sorted({str(q.get("model")) for q in side})
    side_sets = {n: {b for q in qs for b in (q.get("anthropic_beta") or "").split(",") if b}
                 for n, qs in side_by_arm.items() if qs}
    side_common = set.intersection(*side_sets.values()) if side_sets else set()
    side_extra = {n: sorted(b - side_common) for n, b in side_sets.items()}
    ext_by_arm = {n: BETA_EXTENDED_CACHE_TTL in b for n, b in beta_sets.items()}
    split_by_arm = {}
    for n in per_arm:
        res = _turn(rows[n]).get("result") or {}
        split_by_arm[n] = (f"1h={res.get('ephemeral_1h_input_tokens')} "
                           f"5m={res.get('ephemeral_5m_input_tokens')}")
    sections = Counter(str(c.get("at", "")).split(".")[1].split("[")[0]
                       for _, r in reqs for c in (r.get("cache_control") or [])
                       if "." in str(c.get("at", "")))
    statuses = Counter(r.get("status") for _, r in reqs)
    key_hdr = {"x-api-key": sum(bool(r.get("x_api_key_present")) for _, r in reqs),
               "authorization": sum(bool(r.get("authorization_present")) for _, r in reqs)}
    verdict = (f"cache_control ttls {ttls} (by arm {ttls_by_arm}); {BETA_EXTENDED_CACHE_TTL} "
               f"{'seen' if any(ext_by_arm.values()) else 'not seen'} (by arm {ext_by_arm})")
    detail = (f"{len(reqs)} tool-carrying model calls over {sorted(per_arm)}; statuses {dict(statuses)}; "
              f"cache_creation split by arm {split_by_arm}; cache_control blocks by section "
              f"{dict(sections)}; betas common to every tool-carrying model call {sorted(common)}; "
              f"extra by arm {extra_by_arm}; the tool-less side call ({len(side)} calls, model "
              f"{side_models}) carries, common to every one, {sorted(side_common)} — beyond the "
              f"tool-carrying common set: {sorted(side_common - common)}, lacking from it: "
              f"{sorted(common - side_common)}; its extra by arm {side_extra}; "
              f"auth header present on N calls {key_hdr}; tool_reference blocks "
              f"per call {[r.get('tool_reference_blocks') for _, r in reqs]}")
    return verdict, detail


def verdicts(rows: dict[str, dict[str, Any]]) -> list[dict[str, str]]:
    out = []
    proxy_arms = [n for n in rows if ARMS_BY_NAME[n].proxy]
    if CONTROL in rows:
        for name in proxy_arms:
            v, d = verdict_tool_search(rows, name)
            out.append({"name": f"tool search behind a non-anthropic base URL [{name}]",
                        "verdict": v, "detail": d})
        for name in proxy_arms:
            v, d = verdict_eager(rows, name)
            out.append({"name": f"eager-load delta [{name}]: whole first prompt "
                                f"(input+cache_creation+cache_read) proxy − control",
                        "verdict": v, "detail": d})
    else:
        out.append({"name": "tool search / eager-load delta", "verdict": "undecidable",
                    "detail": f"{CONTROL} is not among this run's arms"})
    v, d = verdict_wire(rows)
    out.append({"name": "wire", "verdict": v, "detail": d})
    out.append({"name": "gate (read off the binary, not measured)", "verdict": "exact host match",
                "detail": GATE_READING})
    return out


# ── output ──────────────────────────────────────────────────────────────


def _yn(v: Any) -> str:
    return "?" if v is None else ("yes" if v else "no")


def print_table(rows: dict[str, dict[str, Any]]) -> None:
    hdr = (f"{'arm':<17}{'base_url':<24}{'ETS env':<9}{'ToolSearch':<12}{'mcp@init':<10}"
           f"{'init tools':<12}{'conv_cal':<10}{'1st call in/cc/cr':<24}{'1h/5m write':<14}"
           f"{'proxy reqs':<12}"
           f"{'ttls':<18}cost")
    print("\n" + "=" * 176)
    print(hdr)
    print("-" * 176)
    for name, r in rows.items():
        if r.get("error"):
            print(f"{name:<17}{'ERROR':<24}{one_line(str(r['error']), 110)}")
            continue
        t, init, res = _turn(r), _init(r), (_turn(r).get("result") or {})
        first = _first_call(r)
        reqs = r.get("proxy_requests") or []
        ttls = sorted({x for q in reqs for x in (q.get("cache_control_ttls") or [])})
        env = r.get("cli_env") or {}
        print(f"{name:<17}{str(r.get('base_url') or '-'):<24}{str(env.get(ETS_ENV))[:8]:<9}"
              f"{_yn(init.get('tool_search_in_tools')) + '×' + str(t.get('tool_search_calls', 0)):<12}"
              f"{str(init.get('mcp_genealogy_count')):<10}{str(init.get('tool_count')):<12}"
              f"{_yn(t.get('convert_calendar_called')):<10}"
              f"{str(first.get('input_tokens')) + '/' + str(first.get('cache_creation_input_tokens')) + '/' + str(first.get('cache_read_input_tokens')):<24}"
              f"{str(res.get('ephemeral_1h_input_tokens')) + '/' + str(res.get('ephemeral_5m_input_tokens')):<14}"
              f"{str(len(reqs)) if r.get('proxy') else 'n/a':<12}{str(ttls) if reqs else '-':<18}"
              f"${res.get('total_cost_usd') or 0:.4f}")
    print("=" * 176)


def print_costs(rows: dict[str, dict[str, Any]]) -> float:
    print("\ntokens/cost per arm (from ResultMessage):")
    total = 0.0
    for name, r in rows.items():
        res = _turn(r).get("result") or {}
        if not res:
            continue
        cost = res.get("total_cost_usd") or 0.0
        total += cost
        print(f"  {name:<17} ${cost:.4f}  in={res.get('input_tokens')} "
              f"(+cache read {res.get('cache_read_input_tokens')}, create "
              f"{res.get('cache_creation_input_tokens')})  out={res.get('output_tokens')}  "
              f"turns={res.get('num_turns')}  {res.get('duration_ms')} ms")
    print(f"  {'TOTAL':<17} ${total:.4f}")
    return total


# ── --dry-run ───────────────────────────────────────────────────────────


_CANNED_BODY = {
    "model": "claude-sonnet-4-6", "stream": True, "max_tokens": 8,
    "system": [{"type": "text", "text": "x", "cache_control": {"type": "ephemeral"}}],
    "tools": [{"type": "tool_search_tool_regex_20251119", "name": "tool_search_tool_regex"},
              {"name": "mcp__genealogy__convert_calendar", "input_schema": {},
               "cache_control": {"type": "ephemeral", "ttl": "1h"}}],
    "messages": [{"role": "user", "content": [{"type": "text", "text": "hi"},
                                              {"type": "tool_reference", "tool_name": "x"}]}],
}


def dry_run() -> int:
    key = api_key() or "dry-run-placeholder"
    scrubbed = scrub_shell_env()
    tmp = Path(tempfile.mkdtemp(prefix="p1-gateway-dry-"))
    try:
        project = seed_project(tmp / "project")
        for arm in ARMS:
            config_dir = tmp / f"cfg-{arm.name}"
            config_dir.mkdir()
            opts = build_arm_options(arm, key=key, project=project, config_dir=config_dir,
                                     debug_log=tmp / f"{arm.name}.debug.log",
                                     base_url="http://127.0.0.1:0" if arm.proxy else None)
            print(f"\n== {arm.name} == {arm.note}")
            print(json.dumps({"cli_env": cli_env_view(opts), "env_keys": sorted(opts.env),
                              "model": opts.model, "extra_args": dict(opts.extra_args),
                              "max_turns": opts.max_turns}, indent=2))
    finally:
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)
    print("\nproxy log line for a canned Messages body (the summariser, no network):")
    print(json.dumps(summarize_body(json.dumps(_CANNED_BODY).encode("utf-8")), indent=2))
    print(f"\nscrubbed from this shell: {scrubbed or '(none)'}; other inherited names that "
          f"could steer an arm: {inherited_env_names() or '(none)'}")
    return 0


# ── main ────────────────────────────────────────────────────────────────


async def run_all(out_dir: Path, arm_names: list[str]) -> int:
    key = api_key()
    if not key:
        print("no ANTHROPIC_API_KEY in env or eval/.env", file=sys.stderr)
        return 2
    from app.agent import real_agent
    if not Path(real_agent._MCP_BUILD).exists():
        print(f"no compiled engine at {real_agent._MCP_BUILD} — run `make engine-build`",
              file=sys.stderr)
        return 2
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"out: {out_dir}")
    scrubbed = scrub_shell_env()
    if scrubbed:
        print(f"scrubbed from this process's env so no arm inherits them: {scrubbed}")
    inherited = inherited_env_names()
    if inherited:
        print(f"WARNING: inherited shell variables that can steer an arm's provider/model: "
              f"{inherited} (values not shown)")
    proxies = [k for k in HTTP_PROXY_ENV if k in os.environ]
    if proxies:
        print(f"WARNING: {proxies} set — the CLI's fetch to 127.0.0.1 may be routed elsewhere")
    if CONTROL not in arm_names:
        print(f"note: {CONTROL} not selected — the tool-search and eager-load verdicts need it")

    rows: dict[str, dict[str, Any]] = {}
    for name in arm_names:
        rows[name] = await run_arm_guarded(ARMS_BY_NAME[name], key=key, out_dir=out_dir)
        _write_json(out_dir / f"{name}.json", rows[name])

    return _report(rows, out_dir, scrubbed)


def _report(rows: dict[str, dict[str, Any]], out_dir: Path,
            scrubbed: list[str] | None) -> int:
    print_table(rows)
    total = print_costs(rows)
    warnings = cross_arm_cache_hits(rows)
    vs = verdicts(rows)
    print()
    for w in warnings:
        print(f"WARNING: {w}")
    for v in vs:
        print(f"VERDICT: {v['name']}: {v['verdict']} — {v['detail']}")
    summary = {"out": str(out_dir), "arms": list(rows), "finished": _now_iso(),
               "total_cost_usd": total, "scrubbed_env": scrubbed, "warnings": warnings,
               "verdicts": vs,
               "per_arm": {n: {k: r.get(k) for k in ("error", "cli_env", "base_url", "gate_lines",
                                                     "deferred_loading", "proxy_requests", "turn",
                                                     "wire")}
                           for n, r in rows.items()}}
    _write_json(out_dir / "summary.json", summary)
    print(f"\nsummary: {out_dir / 'summary.json'}")
    return 2 if any(r.get("error") for r in rows.values()) else 0


def replay(out_dir: Path) -> int:
    """Re-derive table, costs and verdicts from a run's <arm>.json files; no spawn.

    The billed run's `scrubbed_env` is carried forward from the existing
    summary.json — a replay re-derives verdicts, it did not scrub anything. An
    <arm>.json written before `deferred_loading` existed gets it re-read from
    the arm's debug log beside it."""
    rows: dict[str, dict[str, Any]] = {}
    for arm in ARMS:
        path = out_dir / f"{arm.name}.json"
        if path.exists():
            row = json.loads(path.read_text(encoding="utf-8"))
            if row.get("deferred_loading") is None:
                row["deferred_loading"] = deferred_loading(out_dir / f"{arm.name}.debug.log")
            rows[arm.name] = row
    if not rows:
        print(f"no <arm>.json under {out_dir}", file=sys.stderr)
        return 2
    scrubbed = None
    prev = out_dir / "summary.json"
    if prev.exists():
        try:
            scrubbed = json.loads(prev.read_text(encoding="utf-8")).get("scrubbed_env")
        except (ValueError, OSError):
            scrubbed = None
    print(f"replay: {out_dir} arms={list(rows)} scrubbed_env(carried)={scrubbed}")
    return _report(rows, out_dir, scrubbed)


def _write_json(path: Path, doc: Any) -> None:
    path.write_text(json.dumps(doc, indent=2, ensure_ascii=False, default=str) + "\n",
                    encoding="utf-8")


def _parse_arms(value: str) -> list[str]:
    names = [s.strip() for s in value.split(",") if s.strip()]
    unknown = [n for n in names if n not in ARMS_BY_NAME]
    if unknown or not names:
        raise argparse.ArgumentTypeError(
            f"unknown arm(s) {unknown or value!r}; choose from {list(ARMS_BY_NAME)}")
    return names


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m dev.p1.probe_gateway_path",
        description="P3b probe: the CLI behind a non-anthropic ANTHROPIC_BASE_URL (a logging "
                    "pass-through to api.anthropic.com) vs first-party — the tool-search gate, "
                    "eager tool load, and cache_control/betas on the wire. Five short billed "
                    "sessions (cents); exit 0 always, 2 if an arm raised.",
    )
    p.add_argument("--out", default=None,
                   help="output dir (default ~/.cache/cowork-genealogy/p1/gateway-path-<ts>)")
    p.add_argument("--arms", type=_parse_arms, default=list(ARMS_BY_NAME),
                   help=f"comma-separated subset of {list(ARMS_BY_NAME)} (default: all, in order)")
    p.add_argument("--replay", metavar="DIR", default=None,
                   help="re-derive the table, costs and verdicts from a previous run's "
                        "<arm>.json files in DIR (no spawn, no tokens); rewrites DIR/summary.json, "
                        "carrying its scrubbed_env forward")
    p.add_argument("--dry-run", action="store_true",
                   help="build every arm's options in-process and print the CLI env the gate "
                        "reads, plus one canned proxy log line; no spawn, no tokens")
    return p


def main(argv: list[str] | None = None) -> int:
    # House pattern: a Windows console defaults to cp1252.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    args = build_parser().parse_args(argv)
    if args.dry_run:
        return dry_run()
    if args.replay:
        return replay(Path(args.replay).expanduser().resolve())
    out_dir = Path(args.out).expanduser().resolve() if args.out else default_out_dir()
    return asyncio.run(run_all(out_dir, list(args.arms)))


if __name__ == "__main__":
    sys.exit(main())

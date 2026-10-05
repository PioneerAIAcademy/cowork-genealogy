"""The worker's ``ClaudeAgentOptions`` and its hooks: ``PreToolUse`` (deny and log),
``PostToolUse`` / ``PostToolUseFailure`` (stamp the call's duration) and, on the D18
autonomous arm only, ``Stop`` (veto the model's voluntary yield, ``make_stop_hook``).

This is the prototype option set (plan: "Container layout", "Removing the shell",
D9-10, D15), not the hosted one in ``app.agent.real_agent.build_options``:

- ``cwd`` is the empty anchor (``/project``); ``setting_sources=[]`` explicitly, so no
  ``CLAUDE.md`` or ``.claude/`` in any parent of cwd is loaded; no ``add_dirs``.
- the plugin loads from disk for its skills; its agents (``worker.EXPECTED_AGENTS``) travel
  as ``agents=`` (bare names, parsed once at worker start by ``plugin_agents.py``) -- never
  staged into cwd.
- the shell is removed with ``disallowed_tools`` -- the only lever that reaches the
  main thread; ``Write``/``Edit`` stay granted (denying them is whole-tool).
- the tool server is the shared Streamable HTTP ``tools`` service at ``TOOL_SERVER_URL``;
  the entry carries the patron's bearer as ``Authorization`` and the turn's project id as
  ``X-Genealogy-Project-Id`` -- per request, never process state. The bearer is the turn's
  project owner's grant, which the worker reads (and locks) at the start of every attempt
  (U3, ``worker.acquire_grant``); there is no other source, and an empty one is refused
  rather than shipped. The CLI inherits no worker variable (``CLI_ENV_KEEP``) and runs as
  its turn's slot user, who alone can read the per-turn config dir. The entry is written
  to a 0600 ``mcp.json`` under the per-turn config dir and passed as a PATH
  (``--mcp-config <path>``): a dict is serialised onto the CLI's argv, where the bearer
  is ``ps``-visible to every process in the container.
- the transcript mirrors to ``PgSessionStore`` with ``session_store_flush="eager"`` so a
  mid-turn kill loses at most one frame; ``CLAUDE_CONFIG_DIR`` is a fresh directory
  under ``TMPDIR`` per turn (on a resumed turn the SDK repoints it to its own).
- the SDK session id is the worker's choice: ``session_id=`` on a fresh session,
  ``resume=`` when the store holds entries -- exactly one, never both (the SDK's own
  rule without ``fork_session``).
- the model is pinned per ``MODEL_PROVIDER``, which has no default (``model_provider``):
  ``anthropic`` is ``claude-sonnet-4-6`` on ``ANTHROPIC_API_KEY``; ``gateway`` points the
  CLI at an Anthropic-Messages gateway (``GATEWAY_BASE_URL``, ``GATEWAY_API_KEY``) and sends Bedrock ids for the main thread, the small model and
  every agent (``gateway_agent_models``), since a gateway passes unmapped ids through.

The hook (``make_pretool_hook``) is the plan's deny-and-log: it denies a raw
``Write``/``Edit`` on the project files (the hosted ``direct_project_file_write``),
denies a ``Read``/``Grep``/``Glob`` under the anchor and any read or write under ``/proc``
or ``/dev``, the turn's own process (``deny.py``), and records EVERY
call as a ``tool_calls`` row with its decision -- so criterion 3 is a query, not a claim.
It never raises: any exception allows the call. The turn's identifiers reach it through
a closure, never a global.
"""

from __future__ import annotations

import dataclasses
import json
import os
import sys
from collections.abc import Callable, Mapping
from typing import Any

from app.agent.continue_policy import (
    CONTINUE_REASON,
    env_float,
    env_int,
    TERMINAL_BUDGET,
    TERMINAL_COMPLETED,
    TERMINAL_DECISION,
    TERMINAL_DELIVERED,
    TERMINAL_MCP_UNAVAILABLE,
    TERMINAL_NO_PROGRESS,
    TERMINAL_QUEUED,
    TERMINAL_STOPPED,
    project_completed,
    should_continue_run,
    terminal_reason,
)
from app.agent.spend import PRICE_PER_MTOK, SPEND_CAP_USD
from app.agent.spend import price_usd as shared_price_usd
from app.agent.real_agent import direct_project_file_write

from proto.worker.deny import host_path_denied, project_read_denied

# DesignSync/Monitor/PushNotification: the CLI adds them only for a non-Bedrock base URL
# (plan P3g), ~5k tokens per call with tool search off, and none is reachable here.
DISALLOWED_TOOLS = ["Bash", "WebFetch", "WebSearch", "NotebookEdit", "DesignSync", "Monitor", "PushNotification"]
ANTHROPIC_MODEL = "claude-sonnet-4-6"
# [1m]: the CLI strips it, sends context-1m-2025-08-07 and sizes its window (and so its
# compaction) at 1M; without it a gateway session gets 200k (plan P3j).
GATEWAY_MODEL = "us.anthropic.claude-sonnet-4-6[1m]"
GATEWAY_SMALL_MODEL = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
# Bare ids the plugin's agents declare -> the Bedrock ids a gateway must receive. The
# CLI sends an agent's model verbatim, and a gateway without a matching alias answers
# 400 "model identifier is invalid", after which the main thread silently delegates to
# a general-purpose stand-in (plan P3h).
GATEWAY_AGENT_MODELS = {
    "claude-sonnet-4-6": "us.anthropic.claude-sonnet-4-6",
    "claude-sonnet-5": "us.anthropic.claude-sonnet-5",
}
PLUGIN_COMMAND_PREFIX = "genealogy-research:"
# The SDK's unit is bytes (default 1 MiB, ``subprocess_cli._DEFAULT_MAX_BUFFER_SIZE``);
# raised so one oversized JSON line cannot end a turn.
MAX_BUFFER_BYTES = 8 * 1024 * 1024
PRETOOL_TIMEOUT_S = 10.0
MCP_CONFIG_NAME = "mcp.json"

# The e2e harness's tree-read block (eval/harness/e2e/orchestrator.py BLOCKED_TREE_TOOLS):
# every e2e fixture's answer still sits in the live FamilySearch tree, so a fixture run
# that may read the tree is a lookup, not the research workflow. The worker takes the
# list from BLOCKED_TOOLS (bare MCP tool names, comma-separated); empty means no block. A
# non-empty one refuses start unless DEV_PATHS=true (worker.require_start_config, U11).
BLOCKED_DENY_REASON = (
    "{tool} is denied on this run: the fixture's answer sits in the live FamilySearch tree "
    "and this run must find it in records (the e2e harness's tree-read block, BLOCKED_TOOLS)."
)


def is_blocked_call(tool_name: str, blocked: frozenset[str]) -> bool:
    """Whether the tree-read block denies this call: an MCP tool named in ``blocked``."""
    return tool_name.startswith("mcp__") and bare_tool_name(tool_name) in blocked


def bare_tool_name(tool_name: str) -> str:
    """``mcp__<server>__<name>`` -> ``<name>``, whatever the server spelling; a built-in
    tool's name is returned as is."""
    return tool_name.rsplit("__", 1)[-1] if tool_name.startswith("mcp__") else tool_name


def parse_blocked_tools(value: str | None) -> frozenset[str]:
    """``BLOCKED_TOOLS``: comma-separated bare MCP tool names; blanks ignored."""
    return frozenset(part.strip() for part in (value or "").split(",") if part.strip())


WRITE_DENY_REASON = (
    "{tool} on {name} is disabled — all writes to research.json/tree.gedcomx.json must "
    "go through the writer tools. To CREATE a new project use project_create, which "
    "writes both files together; to add to an existing one use research_append, "
    "research_log_append, tree_edit or tree_correct. These validate before persisting. "
    "Direct file writes never validate."
)


# U7 (proto/enqueue.py): the worker signs its held-message release with these when set.
SQS_STATIC_KEY_VARS = ("GENEALOGY_SQS_ACCESS_KEY", "GENEALOGY_SQS_SECRET_KEY")
# U3: the key the worker decrypts the patron's grant with (proto/grants.py).
GRANT_KEY_VAR = "FS_TOKEN_ENC_KEY"

# The only inherited variables the CLI keeps (U3). The SDK hands the CLI the worker's whole
# environment overlaid with options.env, and a turn's agent can read its own process's
# /proc/self/environ, so every other inherited key -- PG_DSN, QUEUE_URL, FS_TOKEN_ENC_KEY,
# the SQS pair, AWS_*, GENEALOGY_* -- is set to "" there. What the CLI needs is set in
# options.env, which this never blanks.
CLI_ENV_KEEP = frozenset({
    "PATH", "HOME", "TMPDIR", "LANG", "LANGUAGE", "TZ", "TERM",
    "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
    "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS",
})
CLI_ENV_KEEP_PREFIXES = ("LC_", "CLAUDE_CODE_")


def cli_env_blanks(worker_env: Mapping[str, str], set_by_options: Mapping[str, str] = {}) -> dict[str, str]:
    """``{name: ""}`` for every inherited variable the CLI must not see (``CLI_ENV_KEEP``)."""
    return {
        name: "" for name in worker_env
        if name not in set_by_options and name not in CLI_ENV_KEEP
        and not name.startswith(CLI_ENV_KEEP_PREFIXES)
    }


def hook_path(exe_dir: str, path: str | None) -> str:
    """The CLI child's ``PATH`` (U12 D27): the worker interpreter's directory first, so the
    plugin hook's ``python3`` is the venv's 3.12 and not the platform's 3.9 (under which
    ``guard_project_files.py`` fails open). An unset or empty ``PATH`` gets the prepend
    alone; an empty ``exe_dir`` (no ``sys.executable``) prepends nothing."""
    parts = [p for p in (exe_dir, path or "") if p]
    return os.pathsep.join(parts)


# U11: the compose-only paths -- the D3 stub arms, BLOCKED_TOOLS, no QUEUE_URL, the
# default grant key -- are honoured only when this is ``true``. No image or Beanstalk
# template sets it.
DEV_PATHS_VAR = "DEV_PATHS"


def dev_paths(env: Mapping[str, str]) -> bool:
    """``DEV_PATHS`` is ``true``, case-insensitive after strip; anything else is off."""
    return (env.get(DEV_PATHS_VAR) or "").strip().lower() == "true"


MODEL_PROVIDERS = ("anthropic", "gateway")


class ProviderError(ValueError):
    """``MODEL_PROVIDER`` refused; ``label`` (``unset``, ``unknown:<v>``,
    ``gateway_needs_base_url``) is what ``ev=prepare step=model_provider`` logs."""

    def __init__(self, label: str, message: str) -> None:
        super().__init__(message)
        self.label = label


def model_provider(worker_env: Mapping[str, str]) -> str:
    """``MODEL_PROVIDER`` after strip/lower: ``anthropic`` or ``gateway`` (which needs
    ``GATEWAY_BASE_URL``). There is no default; anything else raises ``ProviderError``."""
    provider = (worker_env.get("MODEL_PROVIDER") or "").strip().lower()
    if not provider:
        raise ProviderError("unset", "MODEL_PROVIDER is unset: it must be anthropic or gateway")
    if provider not in MODEL_PROVIDERS:
        raise ProviderError(f"unknown:{provider}", f"MODEL_PROVIDER must be anthropic or gateway, not {provider!r}")
    if provider == "gateway" and not (worker_env.get("GATEWAY_BASE_URL") or "").strip():
        raise ProviderError("gateway_needs_base_url", "MODEL_PROVIDER=gateway needs GATEWAY_BASE_URL")
    return provider


def provider_env(worker_env: Mapping[str, str]) -> tuple[str | None, dict[str, str]]:
    """``(model, env)`` for ``MODEL_PROVIDER``: the CLI ``--model`` and the variables
    that pin the provider. The gateway's model travels as ``ANTHROPIC_MODEL`` (the ``[1m]``
    suffix is read off that string), so ``model`` is None there."""
    if model_provider(worker_env) == "anthropic":
        return ANTHROPIC_MODEL, {"ANTHROPIC_API_KEY": worker_env.get("ANTHROPIC_API_KEY", "")}
    return None, {
        "ANTHROPIC_BASE_URL": worker_env["GATEWAY_BASE_URL"].strip(),
        "ANTHROPIC_AUTH_TOKEN": worker_env.get("GATEWAY_API_KEY", ""),
        # Blank, not absent: the CLI inherits the worker's environment, and an
        # inherited Anthropic key rides to the gateway as x-api-key beside the bearer.
        "ANTHROPIC_API_KEY": "",
        "ANTHROPIC_MODEL": GATEWAY_MODEL,
        "ANTHROPIC_DEFAULT_HAIKU_MODEL": GATEWAY_SMALL_MODEL,
        # agentgateway < 1.6 cannot parse tool_reference, so tool search fails on
        # its second turn (plan P3f); tap-agentgateway pins 1.5.0.
        "ENABLE_TOOL_SEARCH": (worker_env.get("GATEWAY_TOOL_SEARCH") or "false").strip().lower(),
    }


def gateway_agent_models(agents: Mapping[str, Any]) -> dict[str, Any]:
    """``agents`` with each ``AgentDefinition.model`` in ``GATEWAY_AGENT_MODELS`` replaced
    by its Bedrock id. Anything that is not a dataclass with a ``model`` passes as is."""
    out: dict[str, Any] = {}
    for name, agent in agents.items():
        model = getattr(agent, "model", None)
        if dataclasses.is_dataclass(agent) and model in GATEWAY_AGENT_MODELS:
            agent = dataclasses.replace(agent, model=GATEWAY_AGENT_MODELS[model])
        out[name] = agent
    return out


# D16 (PR #2659): the shared Streamable HTTP tool server, the compose `tools` service. Its
# contract is the two headers the entrypoint reads, both per request and never process
# state: `Authorization: Bearer <patron token>` becomes the request's principal, and
# `X-Genealogy-Project-Id` becomes the request's PgS3ProjectStore. Missing, the project
# tools answer an instruction naming the header; malformed, the request is a 400. No turn
# header. The CLI opens the MCP session once per process, once per turn. TOOL_SERVER_URL
# has no default (U11): a guessed host would be handed the patron's bearer.
PROJECT_ID_HEADER = "X-Genealogy-Project-Id"
# The http entry's per-server `timeout` (ms). Without it CLI 2.1.220 aborts every
# non-GET HTTP MCP request at 60 s, where the harness's stdio server is cut only by its
# 1,800,000 ms idle limit (the engine sends no progress notifications, so idle is the
# whole call). One value sets the http request, hard and idle limits alike, so this
# gives the prototype the harness's ceiling: 121 harness calls ran past 60 s, the
# longest 844 s (`image_transcribe`), six of them `research_append`.
MCP_HTTP_TIMEOUT_MS = 1_800_000


def tool_server_url(worker_env: Mapping[str, str]) -> str:
    """``TOOL_SERVER_URL``, stripped; unset or blank raises ValueError."""
    url = (worker_env.get("TOOL_SERVER_URL") or "").strip()
    if not url:
        raise ValueError("TOOL_SERVER_URL is unset: the worker has no tool server to send the bearer to")
    return url


def tool_server_headers(*, project_id: str, bearer: str) -> dict[str, str]:
    """``Authorization: Bearer <grant token>`` and ``X-Genealogy-Project-Id``. An empty
    bearer raises ValueError: the server reads it as an empty principal and answers every
    FamilySearch call with the reconnect instruction, a sign-in problem the patron cannot
    fix by signing in."""
    if not bearer:
        raise ValueError("refusing to build the tool server entry with an empty bearer")
    return {"Authorization": f"Bearer {bearer}", PROJECT_ID_HEADER: project_id}


def tool_server_entry(
    worker_env: Mapping[str, str],
    *,
    project_id: str,
    bearer: str,
) -> dict[str, Any]:
    """The ``genealogy`` MCP server entry: the shared Streamable HTTP tool server, one
    process for every turn, at ``TOOL_SERVER_URL`` with the bearer as ``Authorization``
    and the turn's project id as ``X-Genealogy-Project-Id``. Its per-user config is the
    ``tools`` service's own environment, not the request's."""
    return {
        "type": "http",
        "url": tool_server_url(worker_env),
        "headers": tool_server_headers(project_id=project_id, bearer=bearer),
        "timeout": MCP_HTTP_TIMEOUT_MS,
    }


def write_mcp_config(config_dir: str, servers: Mapping[str, Any]) -> str:
    """``{"mcpServers": servers}`` as ``<config_dir>/mcp.json``, mode 0600, created
    fresh; the path is what the CLI gets. Dies with the per-turn config dir."""
    path = os.path.join(config_dir, MCP_CONFIG_NAME)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump({"mcpServers": dict(servers)}, f)
    os.chmod(path, 0o600)  # O_CREAT's mode applies only when the file is new
    return path


def input_path(tool_name: str, tool_input: Mapping[str, Any] | None, *, cwd: str) -> str | None:
    """The path a call names, for the ``tool_calls`` row: ``file_path`` / ``path`` /
    ``notebook_path`` when present; the working directory for a Grep/Glob that omits its
    ``path`` (the tool's own default); None otherwise."""
    data = tool_input or {}
    for key in ("file_path", "path", "notebook_path"):
        value = data.get(key)
        if isinstance(value, str) and value:
            return value
    if tool_name in ("Grep", "Glob") and "pattern" in data:
        return cwd
    return None


def _deny(reason: str) -> dict[str, Any]:
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        },
    }


# 1c. What Stop returns, and it is NOT `_deny` alone. A `permissionDecision: "deny"` is a
# tool RESULT: the model reads it, argues with it, and picks another tool. The SDK's halt
# fields are separate, and this is the pair that ends the turn. But they end it AFTER the
# call runs (CLI 2.1.220, U3 live lost-lock run 2026-10-03: the halted record_search
# executed on a just-revoked token), so the halt also denies the call it fires on.
STOP_REASON = "Stopped by the researcher."

# 1b. The turn ends so the patron's message becomes the next one. Text the MODEL reads as
# the turn closes, so the transcript says why it stopped rather than ending mid-thought.
HANDOVER_REASON = (
    "The researcher has sent a new message. Stopping here so it can be read; "
    "everything found so far is saved and the next turn continues from this point."
)

# 1e. Beside STOP_REASON because both travel the same halt path, and both are text the
# MODEL reads as the turn ends -- so the transcript says what happened rather than
# stopping mid-thought.
SPEND_CAP_REASON = (
    "This session has reached its ${cap:.0f} spend limit and is stopping here. "
    "Everything found so far is saved. Start a new session on the same project to carry on."
)


# The carrier for "I delivered what you asked". Deliberately NOT AskUserQuestion -- an ask
# has `questions` and waits for an answer, a delivery waits for nothing, and one tool
# carrying both leaves this hook with no discriminator.
DELIVERED_TOOL = "mcp__genealogy__research_delivered"

# When to reach for it. This rides the per-turn system prompt, NOT the skill bodies: the
# hook that makes this tool end a turn exists only here, so a skill-body rule would teach
# every skill to call a tool that is inert in Cowork and in the harness that grades them.
#
# Both exclusions are load-bearing. Calling it when the OBJECTIVE is finished would report
# `delivered` where `completed` is true and the run ends on its own. Calling it instead of
# asking would swallow a question nobody answers -- an ask waits, a delivery does not.
DELIVERY_GUIDANCE = (
    "When this message asked for one bounded thing and you have produced it, WRITE YOUR "
    "REPLY FIRST -- this call ends the turn, so nothing you say after it reaches the "
    "researcher -- then call "
    "`research_delivered` with a one-sentence summary and stop: a plan the researcher "
    "asked you to stop after, a single record or lookup, or a status question such as "
    "\"where are we?\". Do not call it when the project's research objective itself is "
    "finished -- that run ends on its own -- and do not call it in place of asking the "
    "researcher a question, which waits for their answer. Its schema is deferred, so "
    "search for it by name if you do not already hold it."
)

DELIVERED_REASON = (
    "You have delivered what this message asked for. Stopping here rather than carrying "
    "on; your next message picks up from here."
)


def _halt(reason: str = STOP_REASON) -> dict[str, Any]:
    return {"continue_": False, "stopReason": reason, **_deny(reason)}

# Delegation tools whose `run_in_background` the worker overrides. The worker ends a turn at
# the main thread's ResultMessage and closes the CLI, so a background agent still running
# then dies with it -- measured 2026-09-23 (plan D17: both background extractors lost, the
# patron told their summaries would follow). Forcing the foreground keeps parallelism: several
# Agent calls in one message still run concurrently. Lead ruling 2026-09-23, reaffirmed as the
# design 2026-09-29. Every call that is not explicitly `False` is rewritten: CLI 2.1.220 runs an
# agent in the background when the flag is absent, and the two extractors lost on 2026-09-21
# (sess_25297de9b15b4ef5) carried no flag at all.
DELEGATION_TOOLS = frozenset({"Agent", "Task"})


def _foregrounded(tool_input: dict[str, Any]) -> dict[str, Any]:
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "updatedInput": {**tool_input, "run_in_background": False},
        },
    }


def make_pretool_hook(
    *,
    turn_id: str,
    session_id: str,
    cwd: str,
    config_root: str | Callable[[], str],
    record: Callable[[dict[str, Any]], None],
    log: Callable[..., None] | None = None,
    blocked: frozenset[str] = frozenset(),
    halt: Callable[[], str | None] | None = None,
    on_delivered: Callable[[], None] | None = None,
):
    """The worker's ``PreToolUse`` callback. ``config_root`` may be a callable because
    the directory the CLI actually runs in is known only after ``connect()`` on a
    resumed turn; ``record`` writes one ``tool_calls`` row and may raise.

    ``halt()`` is 1c's and 1e's carrier: it returns a reason to END THE TURN NOW, or
    None. It is checked HERE, before anything else, because this hook is bound with
    ``matcher=None`` and therefore fires on every tool call -- a median of 2.6 s apart --
    where the Stop hook fires at a voluntary yield, a median of ONCE per run. A Stop
    button wired to the Stop hook would take 53 minutes to answer.

    A halted call is recorded as a ``tool_calls`` row like any other, with decision
    ``halt``, so the audit trail shows where the turn was cut."""

    async def _pretool(input_data: Any, tool_use_id: str | None, _context: Any) -> dict[str, Any]:
        decision, reason = "allow", None
        data = input_data if isinstance(input_data, dict) else {}
        tool_name = str(data.get("tool_name") or "")
        tool_input = data.get("tool_input")
        tool_input = tool_input if isinstance(tool_input, dict) else {}
        stop_now: str | None = None
        try:
            if halt is not None:
                stop_now = halt()
        except Exception:  # noqa: BLE001 - a hook that raises fails a call the user was entitled to make
            stop_now = None
        if stop_now is not None:
            try:
                record({
                    "turn_id": turn_id, "session_id": session_id,
                    "agent_id": data.get("agent_id"), "agent_type": data.get("agent_type"),
                    "tool_name": tool_name or "unknown",
                    "input_path": input_path(tool_name, tool_input, cwd=cwd),
                    "decision": "halt", "tool_use_id": tool_use_id or data.get("tool_use_id"),
                })
            except Exception as exc:  # noqa: BLE001 - the log must not change the decision
                if log is not None:
                    log(ev="tool_call_log_failed", turn_id=turn_id, tool_name=tool_name,
                        error=f"{type(exc).__name__}: {exc}")
            if log is not None:
                log(ev="halt", turn_id=turn_id, tool_name=tool_name, tool_use_id=tool_use_id,
                    reason=stop_now)
            return _halt(stop_now)

        # A bounded request that is met must not run on to the proof, the nudge cap or the
        # spend bound. It sits AFTER the halt check, so the researcher's own stop still
        # outranks it.
        #
        # MAIN THREAD ONLY. The arm matches on tool NAME, and a subagent holds the
        # session's tool set, so without this a record-extractor saying "delivered" would
        # end the researcher's whole turn. `agent_id` is tested for MEMBERSHIP, not
        # truthiness: it is absent as a KEY on the main thread, and `agent_type` alone is
        # not sufficient because it is present on the main thread of a session started
        # with `--agent`. That is the discriminator the shipped plugin hook already uses
        # (`owner_denied`, hooks/guard_project_files.py), reused rather than re-derived.
        # A subagent's call falls through to ordinary handling, where the tool returns its
        # harmless acknowledgement and the run carries on.
        if tool_name == DELIVERED_TOOL and "agent_id" not in data:
            try:
                record({
                    "turn_id": turn_id, "session_id": session_id,
                    "agent_id": data.get("agent_id"), "agent_type": data.get("agent_type"),
                    "tool_name": tool_name,
                    "input_path": input_path(tool_name, tool_input, cwd=cwd),
                    "decision": "delivered",
                    "tool_use_id": tool_use_id or data.get("tool_use_id"),
                })
            except Exception as exc:  # noqa: BLE001 - the log must not change the decision
                if log is not None:
                    log(ev="tool_call_log_failed", turn_id=turn_id, tool_name=tool_name,
                        error=f"{type(exc).__name__}: {exc}")
            if on_delivered is not None:
                try:
                    on_delivered()
                except Exception as exc:  # noqa: BLE001 - reporting must not fail the call
                    if log is not None:
                        log(ev="delivered_report_failed", turn_id=turn_id,
                            error=f"{type(exc).__name__}: {exc}")
            # The summary is the one field the researcher-facing contract is built on,
            # and the hook halts BEFORE the tool body runs -- so if it is not captured
            # here it reaches nobody: `input_path` is None for this tool, the tool_calls
            # row has no column for it, and the browser renders a fixed string. Logged,
            # and appended to the stop reason so the text the model is handed names what
            # it said it delivered.
            summary = str((tool_input or {}).get("summary") or "").strip()
            if log is not None:
                log(ev="delivered", turn_id=turn_id, tool_name=tool_name,
                    tool_use_id=tool_use_id, summary=summary)
            # Summary FIRST: the browser replaces the chip with the result text cut at
            # 160 chars, and DELIVERED_REASON alone is 157 -- appended, the summary is
            # lost. What the researcher most needs to see leads.
            return _halt(f"Delivered: {summary} {DELIVERED_REASON}" if summary
                         else DELIVERED_REASON)
        try:
            protected = direct_project_file_write(tool_name, tool_input)
            if protected:
                decision, reason = "deny", WRITE_DENY_REASON.format(tool=tool_name, name=protected)
            elif is_blocked_call(tool_name, blocked):
                decision, reason = "deny", BLOCKED_DENY_REASON.format(tool=bare_tool_name(tool_name))
            else:
                root = config_root() if callable(config_root) else config_root
                reason = project_read_denied(
                    tool_name, tool_input, cwd=cwd, project_root=cwd, config_root=root
                ) or host_path_denied(tool_name, tool_input, cwd=cwd, project_root=cwd)
                if reason is not None:
                    decision = "deny"
        except Exception:  # noqa: BLE001 - a hook that raises fails a call the user was entitled to make
            decision, reason = "allow", None
        try:
            record({
                "turn_id": turn_id,
                "session_id": session_id,
                "agent_id": data.get("agent_id"),
                "agent_type": data.get("agent_type"),
                "tool_name": tool_name or "unknown",
                "input_path": input_path(tool_name, tool_input, cwd=cwd),
                "decision": decision,
                "tool_use_id": tool_use_id or data.get("tool_use_id"),
            })
        except Exception as exc:  # noqa: BLE001 - the log must not change the decision
            if log is not None:
                log(ev="tool_call_log_failed", turn_id=turn_id, tool_name=tool_name,
                    error=f"{type(exc).__name__}: {exc}")
        if decision == "deny":
            if log is not None:
                log(ev="deny", turn_id=turn_id, tool_name=tool_name, tool_use_id=tool_use_id, reason=reason)
            return _deny(reason or "denied")
        if tool_name in DELEGATION_TOOLS and tool_input.get("run_in_background") is not False:
            if log is not None:
                log(ev="foregrounded", turn_id=turn_id, tool_name=tool_name, tool_use_id=tool_use_id)
            return _foregrounded(tool_input)
        return {}

    return _pretool


def make_posttool_hook(
    *,
    turn_id: str,
    finish: Callable[[str], None],
    log: Callable[..., None] | None = None,
):
    """The worker's ``PostToolUse`` / ``PostToolUseFailure`` callback: ``finish(tool_use_id)``
    stamps the row the PreToolUse hook wrote with the call's duration (acceptance
    criterion 4). Never raises and never changes what the model sees; a failed stamp is
    one log line. A call in flight when its worker is killed keeps a NULL duration."""

    async def _posttool(input_data: Any, tool_use_id: str | None, _context: Any) -> dict[str, Any]:
        data = input_data if isinstance(input_data, dict) else {}
        use_id = tool_use_id or data.get("tool_use_id")
        try:
            if use_id:
                finish(str(use_id))
        except Exception as exc:  # noqa: BLE001 - the stamp must not fail the call
            if log is not None:
                log(ev="tool_call_finish_failed", turn_id=turn_id, tool_name=str(data.get("tool_name") or ""),
                    error=f"{type(exc).__name__}: {exc}")
        return {}

    return _posttool


# -- the Stop hook (D18) ----------------------------------------------------------
#
# One queue message is one model turn, and an autonomous /research run yields after
# each sub-skill step ("handing off to research-plan"). The e2e harness keeps its
# --autonomous runs going with a Stop hook that vetoes the voluntary yield
# (eval/harness/e2e/orchestrator.py stop_hook), bounded by
# eval/harness/e2e/stop_checker.py should_continue_run. Both are ported here like
# deny.py's predicate -- the worker image carries no eval/ -- with the harness's reason
# text verbatim, so the prototype's autonomous arm and the harness apply one rule.

# The one continue prompt a redelivered attempt sends when its first result carried no
# model turn (worker.run_turn's resume rule, D17). Not the Stop hook's veto: that one
# answers a model that yielded voluntarily mid-run, this one answers a CLI that returned
# a synthetic result without ever reading the worker's prompt. It names the interruption
# so the model does not re-plan from scratch, and forbids a question because nobody is
# watching an autonomous run.
RESUME_CONTINUE_TEXT = (
    "Your previous attempt at this message was interrupted while work was in "
    "progress (the worker restarted). Re-read research.json and continue the same "
    "task from where it stopped; do not start over, and do not ask the user anything."
)


# 1b/1c/1e: the predicate and its terminal vocabulary live in ONE place that both planes
# import -- ``apps/server/app/agent/continue_policy.py``. The worker already depends on
# this package (``direct_project_file_write`` above, ``map_message`` in worker.py), so the
# hosted alpha and the prototype share a copy rather than drifting. ``eval/harness`` keeps
# its own, deliberately: the worker image carries no ``eval/``, and a test asserts those
# two trees never import each other. Imported at the TOP of this module rather than
# redefined, so every existing caller and test keeps reading
# ``options.should_continue_run``.


def make_stop_hook(
    *,
    turn_id: str,
    max_nudges: int,
    research: Callable[[], Mapping[str, Any] | None],
    tool_count: Callable[[], int],
    on_nudge: Callable[[int], None],
    log: Callable[..., None] | None = None,
    stopped: Callable[[], bool] | None = None,
    pending_user_message: Callable[[], bool] | None = None,
    pending_decision: Callable[[], bool] | None = None,
    on_allow: Callable[[str], None] | None = None,
    nudges_used: int = 0,
):
    """The worker's ``Stop`` callback: ``research()`` is the project's research.json (or
    None) and ``tool_count()`` the turn's tool-call count so far, both read at each stop;
    ``on_nudge(n)`` is called on each veto. Never raises: any exception allows the stop.
    Bound with ``PRETOOL_TIMEOUT_S``; the harness's matcher has no timeout -- a timed-out
    hook allows the stop, like ``stop_hook_failed``.

    ``stopped`` / ``pending_user_message`` / ``pending_decision`` are the three injectable
    predicates of 1b and 1c, each read on the turn's own Postgres connection at every
    stop, and each one clause in ``should_continue_run``. Omitted means "never", which is
    what keeps this a faithful port of the harness's hook for anyone reading both.

    ``on_allow(reason)`` fires when the hook ALLOWS a stop, with ``terminal_reason``'s
    verdict, so the turn can record WHY it ended. Without it ``complete()`` writes 'ok'
    for every ending and a budget-capped run is indistinguishable from a finished one --
    which a genealogist reads as "nothing more was found".

    ``nudges_used`` seeds the counter on a redelivery. The hook's state is created inside
    ``run_turn``, one per ATTEMPT, while the tool counter spans attempts -- and since 0b
    makes resume the normal path (median two attempts, longest six in the corpus), an
    unseeded cap of 60 is 60 PER ATTEMPT. The caller passes ``turns.nudges``."""
    state = {"nudges_used": max(0, int(nudges_used)), "tool_count_at_last_nudge": -1}
    ask = lambda f: bool(f()) if f is not None else False  # noqa: E731 - one line, three callers

    async def _stop(_input_data: Any, _tool_use_id: str | None, _context: Any) -> dict[str, Any]:
        try:
            count = int(tool_count())
            verdict = dict(
                research=research(),
                nudges_used=state["nudges_used"],
                max_nudges=max_nudges,
                stopped=ask(stopped),
                pending_user_message=ask(pending_user_message),
                pending_decision=ask(pending_decision),
            )
            if not should_continue_run(
                tool_count=count,
                tool_count_at_last_nudge=state["tool_count_at_last_nudge"],
                **verdict,
            ):
                if on_allow is not None:
                    # `verdict` is built above from the state keys only; the two count
                    # arguments are passed separately to should_continue_run and are
                    # never in it. An earlier filter here stripped a key that cannot be
                    # present, which reads as though it sometimes is.
                    on_allow(terminal_reason(**verdict))
                return {}
            state["nudges_used"] += 1
            state["tool_count_at_last_nudge"] = count
            on_nudge(state["nudges_used"])
        except Exception as exc:  # noqa: BLE001 - a hook that raises ends the turn in error
            if log is not None:
                log(ev="stop_hook_failed", turn_id=turn_id, error=f"{type(exc).__name__}: {exc}")
            return {}
        return {"decision": "block", "reason": CONTINUE_REASON}

    return _stop


def check_registration(
    info: Mapping[str, Any] | None, *, expected_agents: set[str], expected_skills: int
) -> list[str]:
    """The D15 precondition on ``get_server_info()``: every plugin agent under its bare
    name, and every skill as a ``genealogy-research:<skill>`` command. Empty = OK."""
    info = info or {}
    registered = {
        a["name"] for a in (info.get("agents") or []) if isinstance(a, dict) and "name" in a
    }
    problems: list[str] = []
    missing = sorted(set(expected_agents) - registered)
    if missing:
        problems.append(f"agents not registered under their bare names: {missing}")
    names = [c.get("name") if isinstance(c, dict) else c for c in (info.get("commands") or [])]
    plugin_commands = [n for n in names if isinstance(n, str) and n.startswith(PLUGIN_COMMAND_PREFIX)]
    if len(plugin_commands) != expected_skills:
        problems.append(
            f"{len(plugin_commands)} {PLUGIN_COMMAND_PREFIX}* commands registered, "
            f"expected {expected_skills}"
        )
    return problems


def build_worker_options(
    *,
    project_id: str,
    cwd: str,
    plugin_dir: str,
    agents: Mapping[str, Any],
    store: Any,
    config_dir: str,
    pretool_hook: Callable[..., Any],
    posttool_hook: Callable[..., Any],
    resume: str | None = None,
    session_id: str | None = None,
    bearer: str,
    worker_env: Mapping[str, str] | None = None,
    stderr: Callable[[str], None] | None = None,
    stop_hook: Callable[..., Any] | None = None,
    turn_user: str | None = None,
    turn_home: str | None = None,
):
    """``stop_hook`` (D18, ``make_stop_hook``) binds a ``Stop`` matcher only when given.
    The web tier stamps a nudge cap on every browser message, so when that cap is above
    0 (the default is 60) every browser turn passes one and a yield to ask the user is
    vetoed like any other.

    ``turn_user`` (U3) is the slot user the CLI runs as; ``turn_home``, a directory that user
    owns, is the CLI's ``HOME``, ``TMPDIR`` and ``CLAUDE_CODE_TMPDIR`` (the CLI's own temp dir,
    else a ``/tmp/claude-<uid>`` every later patron on the slot would share)."""
    from claude_agent_sdk import ClaudeAgentOptions, HookMatcher

    if resume and session_id:
        raise ValueError("resume and session_id are mutually exclusive: pass exactly one")
    env_in = os.environ if worker_env is None else worker_env
    model, model_env = provider_env(env_in)
    if model_provider(env_in) == "gateway":
        agents = gateway_agent_models(agents)
    project_note = (
        "You are the hosted genealogy research agent. The active research project is "
        f"reached through the genealogy MCP tools with projectPath {cwd!r} — it is not "
        "readable as files: your working directory is an empty anchor. Read the project "
        "with project_context, research_query, record_read and sidecar_read, and change "
        "it only through the writer tools (project_create, research_append, "
        "research_log_append, tree_edit, tree_correct). Follow the genealogy skills, and "
        "apply researcher_profile.narration_guidance from research.json as your "
        "narration style."
    )
    # Unconditional, on the opening turn too: "start a project on X and just give me a
    # plan" is a legitimate turn-1 bounded request, so gating this on `resume` would
    # exempt the very case it exists for.
    project_note = f"{project_note}\n\n{DELIVERY_GUIDANCE}"
    env: dict[str, str] = {
        "ENABLE_TOOL_SEARCH": "true",
        "CLAUDE_CONFIG_DIR": config_dir,
        **model_env,
    }
    if turn_home:
        env["HOME"] = env["TMPDIR"] = env["CLAUDE_CODE_TMPDIR"] = turn_home
    elif env_in.get("TMPDIR"):
        env["TMPDIR"] = env_in["TMPDIR"]
    env["PATH"] = hook_path(os.path.dirname(sys.executable), env_in.get("PATH"))
    env.update(cli_env_blanks(env_in, env))
    hooks: dict[str, Any] = {
        "PreToolUse": [HookMatcher(matcher=None, hooks=[pretool_hook], timeout=PRETOOL_TIMEOUT_S)],
        # Both outcomes stamp the duration: a tool that errored still ran for that long.
        "PostToolUse": [HookMatcher(matcher=None, hooks=[posttool_hook], timeout=PRETOOL_TIMEOUT_S)],
        "PostToolUseFailure": [HookMatcher(matcher=None, hooks=[posttool_hook], timeout=PRETOOL_TIMEOUT_S)],
    }
    if stop_hook is not None:
        hooks["Stop"] = [HookMatcher(matcher=None, hooks=[stop_hook], timeout=PRETOOL_TIMEOUT_S)]
    kwargs: dict[str, Any] = dict(
        cwd=cwd,
        permission_mode="bypassPermissions",
        system_prompt={"type": "preset", "preset": "claude_code", "append": project_note},
        setting_sources=[],
        plugins=[{"type": "local", "path": plugin_dir}],
        agents=dict(agents),
        mcp_servers=write_mcp_config(
            config_dir,
            {
                "genealogy": tool_server_entry(env_in, project_id=project_id, bearer=bearer)
            },
        ),
        disallowed_tools=list(DISALLOWED_TOOLS),
        hooks=hooks,
        session_store=store,
        session_store_flush="eager",
        include_partial_messages=True,
        max_buffer_size=MAX_BUFFER_BYTES,
        env=env,
    )
    if model is not None:
        kwargs["model"] = model
    if resume:
        kwargs["resume"] = resume
    if session_id:
        kwargs["session_id"] = session_id
    if stderr is not None:
        kwargs["stderr"] = stderr
    if turn_user:
        kwargs["user"] = turn_user
    return ClaudeAgentOptions(**kwargs)

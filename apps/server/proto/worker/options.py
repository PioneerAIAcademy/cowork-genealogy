"""The worker's ``ClaudeAgentOptions`` and its hooks: ``PreToolUse`` (deny and log),
``PostToolUse`` / ``PostToolUseFailure`` (stamp the call's duration) and, on the D18
autonomous arm only, ``Stop`` (veto the model's voluntary yield, ``make_stop_hook``).

This is the prototype option set (plan: "Container layout", "Removing the shell",
D9-10, D15), not the hosted one in ``app.agent.real_agent.build_options``:

- ``cwd`` is the empty anchor (``/project``); ``setting_sources=[]`` explicitly, so no
  ``CLAUDE.md`` or ``.claude/`` in any parent of cwd is loaded; no ``add_dirs``.
- the plugin loads from disk for its skills; the six agents travel as ``agents=`` (bare
  names, parsed once at worker start by ``plugin_agents.py``) -- never staged into cwd.
- the shell is removed with ``disallowed_tools`` -- the only lever that reaches the
  main thread; ``Write``/``Edit`` stay granted (denying them is whole-tool).
- the tool server is ``build/hosted-stdio.js``, forked per turn, configured entirely
  through the server entry's ``env``: the store variables from the worker's own
  environment, ``GENEALOGY_PROJECT_ID`` from the turn, and the patron's
  ``FS_ACCESS_TOKEN`` from the message -- per request, never process state. The entry
  is written to a 0600 ``mcp.json`` under the per-turn config dir and passed as a
  PATH (``--mcp-config <path>``): a dict is serialised onto the CLI's argv, where the
  secret key and the bearer are ``ps``-visible to every process in the container. The
  fork is ``env -u ANTHROPIC_API_KEY node …`` so the model key the CLI holds is not
  inherited by a process that never reads it.
- the transcript mirrors to ``PgSessionStore`` with ``session_store_flush="eager"`` so a
  mid-turn kill loses at most one frame; ``CLAUDE_CONFIG_DIR`` is a fresh directory
  under ``TMPDIR`` per turn (on a resumed turn the SDK repoints it to its own).
- the SDK session id is the worker's choice: ``session_id=`` on a fresh session,
  ``resume=`` when the store holds entries -- exactly one, never both (the SDK's own
  rule without ``fork_session``).
- the model is pinned per ``MODEL_PROVIDER``: ``anthropic`` (default) is
  ``claude-sonnet-4-6`` on ``ANTHROPIC_API_KEY``; ``bedrock`` sets
  ``CLAUDE_CODE_USE_BEDROCK``, ``ANTHROPIC_MODEL`` and the 1 h cache flag explicitly,
  because an unpinned default is Opus and every cost figure is then wrong by several-fold.

The hook (``make_pretool_hook``) is the plan's deny-and-log: it denies a raw
``Write``/``Edit`` on the project files (the hosted ``direct_project_file_write``),
denies a ``Read``/``Grep``/``Glob`` under the anchor (``deny.py``), and records EVERY
call as a ``tool_calls`` row with its decision -- so criterion 3 is a query, not a claim.
It never raises: any exception allows the call. The turn's identifiers reach it through
a closure, never a global.
"""

from __future__ import annotations

import json
import os
from collections.abc import Callable, Mapping
from typing import Any

from app.agent.real_agent import direct_project_file_write

from proto.worker.deny import project_read_denied

DISALLOWED_TOOLS = ["Bash", "WebFetch", "WebSearch", "NotebookEdit"]
ANTHROPIC_MODEL = "claude-sonnet-4-6"
BEDROCK_MODEL = "us.anthropic.claude-sonnet-4-6[1m]"
PLUGIN_COMMAND_PREFIX = "genealogy-research:"
# The SDK's unit is bytes (default 1 MiB, ``subprocess_cli._DEFAULT_MAX_BUFFER_SIZE``);
# raised so one oversized JSON line cannot end a turn.
MAX_BUFFER_BYTES = 8 * 1024 * 1024
PRETOOL_TIMEOUT_S = 10.0
MCP_CONFIG_NAME = "mcp.json"
# Stripped from the tool server's inherited environment: the CLI holds the model key,
# hosted-stdio.js never reads it.
TOOL_SERVER_ENV_UNSET = ("ANTHROPIC_API_KEY",)

# The store's configuration, copied from the worker's environment into the tool
# server's; GENEALOGY_PROJECT_ID is per turn and deliberately absent here.
STORE_ENV_KEYS = (
    "GENEALOGY_PG_DSN",
    "GENEALOGY_S3_ENDPOINT",
    "GENEALOGY_S3_BUCKET",
    "GENEALOGY_S3_ACCESS_KEY",
    "GENEALOGY_S3_SECRET_KEY",
    "GENEALOGY_ANCHOR_PATH",
)
# The per-user config the desktop reads from config.json; passed through when set.
PER_USER_ENV_KEYS = ("WIKI_API_URL", "POP_STATS_URL", "OPENROUTER_API_KEY", "OPENROUTER_MODEL")

# The e2e harness's tree-read block (eval/harness/e2e/orchestrator.py BLOCKED_TREE_TOOLS):
# every e2e fixture's answer still sits in the live FamilySearch tree, so a fixture run
# that may read the tree is a lookup, not the research workflow. The worker takes the
# list from BLOCKED_TOOLS (bare MCP tool names, comma-separated); empty means no block.
BLOCKED_DENY_REASON = (
    "{tool} is denied on this run: the fixture's answer sits in the live FamilySearch tree "
    "and this run must find it in records (the e2e harness's tree-read block, BLOCKED_TOOLS)."
)


# The harness's LIVE_TREE_ARG_TOOLS, held equal to it by an AST read in
# tests/test_proto_worker.py: tools that read the live tree only when the named argument
# is truthy (`person_warnings` with `live: true` returns the subject's relatives' names
# and PIDs), so the bare name cannot decide them. Denied whenever BLOCKED_TOOLS is on.
LIVE_TREE_ARG_TOOLS = {"person_warnings": "live"}


def is_blocked_call(tool_name: str, tool_input: Mapping[str, Any], blocked: frozenset[str]) -> bool:
    """Whether the tree-read block denies this call: an MCP tool named in ``blocked``,
    or, while the block is on, a LIVE_TREE_ARG_TOOLS call with its argument truthy."""
    if not blocked or not tool_name.startswith("mcp__"):
        return False
    bare = bare_tool_name(tool_name)
    if bare in blocked:
        return True
    arg = LIVE_TREE_ARG_TOOLS.get(bare)
    return arg is not None and bool(tool_input.get(arg))


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


def provider_env(worker_env: Mapping[str, str]) -> tuple[str | None, dict[str, str]]:
    """``(model, env)`` for ``MODEL_PROVIDER``: the CLI ``--model`` and the variables
    that pin the provider. Bedrock's model travels as ``ANTHROPIC_MODEL`` (the ``[1m]``
    suffix is read off that string), so ``model`` is None there."""
    provider = (worker_env.get("MODEL_PROVIDER") or "anthropic").strip().lower()
    if provider == "anthropic":
        return ANTHROPIC_MODEL, {"ANTHROPIC_API_KEY": worker_env.get("ANTHROPIC_API_KEY", "")}
    if provider == "bedrock":
        return None, {
            "CLAUDE_CODE_USE_BEDROCK": "1",
            "ANTHROPIC_MODEL": BEDROCK_MODEL,
            "ENABLE_PROMPT_CACHING_1H_BEDROCK": "1",
        }
    raise ValueError(f"MODEL_PROVIDER must be anthropic or bedrock, not {provider!r}")


def tool_server_env(
    worker_env: Mapping[str, str], *, project_id: str, fs_access_token: str | None
) -> dict[str, str]:
    """The environment of the per-turn ``hosted-stdio.js`` fork."""
    env = {k: worker_env[k] for k in STORE_ENV_KEYS if worker_env.get(k)}
    env["GENEALOGY_PROJECT_ID"] = project_id
    env["FS_ACCESS_TOKEN"] = bearer_token(worker_env, fs_access_token)
    for key in PER_USER_ENV_KEYS:
        if worker_env.get(key):
            env[key] = worker_env[key]
    return env


def bearer_token(worker_env: Mapping[str, str], fs_access_token: str | None) -> str:
    """The patron's FamilySearch token for this turn: the message's; else the file
    ``FS_ACCESS_TOKEN_FILE`` names, read now -- per attempt -- so the operator can refresh
    it between turns (proto/env.sh writes it; never refresh while a turn is in flight,
    since a FamilySearch refresh revokes the previous access token); else the worker
    env's ``FS_ACCESS_TOKEN``; else empty."""
    if fs_access_token is not None:
        return fs_access_token or ""
    path = worker_env.get("FS_ACCESS_TOKEN_FILE")
    if path:
        try:
            with open(path, encoding="utf-8") as f:
                return f.read().strip()
        except OSError:
            pass
    return worker_env.get("FS_ACCESS_TOKEN", "") or ""


# D16 (PR #2659): the shared Streamable HTTP tool server, the compose `tools` service. Its
# contract is the two headers the entrypoint reads, both per request and never process
# state: `Authorization: Bearer <patron token>` becomes the request's principal, and
# `X-Genealogy-Project-Id` becomes the request's PgS3ProjectStore -- the same store the
# stdio fork gets from GENEALOGY_PROJECT_ID. Missing, the project tools answer an
# instruction naming the header; malformed, the request is a 400. No turn header. The CLI
# opens the MCP session once per process, once per turn.
TOOL_SERVER_DEFAULT = "http"
TOOL_SERVER_DEFAULT_URL = "http://tools:8787/mcp"
PROJECT_ID_HEADER = "X-Genealogy-Project-Id"
# The http entry's per-server `timeout` (ms). Without it CLI 2.1.220 aborts every
# non-GET HTTP MCP request at 60 s, where the harness's stdio server is cut only by its
# 1,800,000 ms idle limit (the engine sends no progress notifications, so idle is the
# whole call). One value sets the http request, hard and idle limits alike, so this
# gives the prototype the harness's ceiling: 121 harness calls ran past 60 s, the
# longest 844 s (`image_transcribe`), six of them `research_append`.
MCP_HTTP_TIMEOUT_MS = 1_800_000


def tool_server_headers(
    worker_env: Mapping[str, str], *, fs_access_token: str | None, project_id: str
) -> dict[str, str]:
    """``X-Genealogy-Project-Id`` always; ``Authorization: Bearer <token>`` only when there
    is a token (the server reads a missing header as an empty bearer, and a bare
    ``Bearer `` would be malformed)."""
    headers = {PROJECT_ID_HEADER: project_id}
    token = bearer_token(worker_env, fs_access_token)
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def tool_server_entry(
    engine_dir: str,
    worker_env: Mapping[str, str],
    *,
    project_id: str,
    fs_access_token: str | None,
) -> dict[str, Any]:
    """The ``genealogy`` MCP server entry. ``TOOL_SERVER=http`` (the default since
    2026-09-20, and what compose sets): the shared Streamable HTTP tool server, one
    process for every turn. ``TOOL_SERVER=stdio``:
    ``hosted-stdio.js`` under ``env -u`` for the model key, with the per-turn environment
    of ``tool_server_env``. The http entry is ``TOOL_SERVER_URL`` with the bearer as
    ``Authorization`` and the turn's project id as ``X-Genealogy-Project-Id``; its
    per-user config is the ``tools`` service's own environment, not the request's."""
    # One default, here and in compose, so a worker started without its environment does
    # not quietly do something production never does. TOOL_SERVER_DEFAULT is the single
    # source; test_proto_config reads compose against it.
    mode = worker_env.get("TOOL_SERVER") or TOOL_SERVER_DEFAULT
    if mode == "http":
        return {
            "type": "http",
            "url": worker_env.get("TOOL_SERVER_URL") or TOOL_SERVER_DEFAULT_URL,
            "headers": tool_server_headers(worker_env, fs_access_token=fs_access_token, project_id=project_id),
            "timeout": MCP_HTTP_TIMEOUT_MS,
        }
    if mode != "stdio":
        raise ValueError(f"TOOL_SERVER must be stdio or http, not {mode!r}")
    return {
        "type": "stdio",
        "command": "env",
        "args": [
            *(flag for name in TOOL_SERVER_ENV_UNSET for flag in ("-u", name)),
            "node",
            os.path.join(engine_dir, "build", "hosted-stdio.js"),
        ],
        "env": tool_server_env(worker_env, project_id=project_id, fs_access_token=fs_access_token),
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


# Delegation tools whose `run_in_background` the worker overrides. The worker ends a turn at
# the main thread's ResultMessage and closes the CLI, so a background agent still running
# then dies with it -- measured 2026-09-23 (plan D17: both background extractors lost, the
# patron told their summaries would follow). Forcing the foreground keeps parallelism: several
# Agent calls in one message still run concurrently. Lead ruling 2026-09-23.
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
):
    """The worker's ``PreToolUse`` callback. ``config_root`` may be a callable because
    the directory the CLI actually runs in is known only after ``connect()`` on a
    resumed turn; ``record`` writes one ``tool_calls`` row and may raise."""

    async def _pretool(input_data: Any, tool_use_id: str | None, _context: Any) -> dict[str, Any]:
        decision, reason = "allow", None
        data = input_data if isinstance(input_data, dict) else {}
        tool_name = str(data.get("tool_name") or "")
        tool_input = data.get("tool_input")
        tool_input = tool_input if isinstance(tool_input, dict) else {}
        try:
            protected = direct_project_file_write(tool_name, tool_input)
            if protected:
                decision, reason = "deny", WRITE_DENY_REASON.format(tool=tool_name, name=protected)
            elif is_blocked_call(tool_name, tool_input, blocked):
                decision, reason = "deny", BLOCKED_DENY_REASON.format(tool=bare_tool_name(tool_name))
            else:
                root = config_root() if callable(config_root) else config_root
                reason = project_read_denied(
                    tool_name, tool_input, cwd=cwd, project_root=cwd, config_root=root
                )
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
        if tool_name in DELEGATION_TOOLS and tool_input.get("run_in_background") is True:
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

# The harness's own veto text for a SILENT stop, verbatim (its `stop_hook`'s fallback
# block dict). Since 2026-09-20 the harness also answers a *well-formed* hand-back —
# one that names its next step and asks — with the researcher's "Yes." instead
# (`classify_hand_back` / `hand_back_outcome`, issues #2328 and #2292). The worker does
# not mirror that branch: it classifies nothing, because the classifier reads the
# harness's in-process narration list and the prose half of #2292 has not landed, so
# copying a moving wording would drift the moment it does. Every stop the worker sees
# therefore takes this text. `test_the_stop_hook_blocks_a_vetoable_stop_with_the_harness_reason_verbatim`
# reads it off the orchestrator and goes red when either side moves.
CONTINUE_REASON = (
    "You are mid-run in an autonomous /research session and the "
    "project is not yet complete (project.status is not "
    "'completed'). Re-read research.json and invoke the next GPS "
    "sub-skill now; keep going until project.status is "
    "'completed' or you hit a genuine, logged blocker."
)


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


def project_completed(research: Mapping[str, Any] | None) -> bool:
    """Whether research.json says the project is done."""
    if not research:
        return False
    return (research.get("project") or {}).get("status") == "completed"


def should_continue_run(
    *,
    research: Mapping[str, Any] | None,
    nudges_used: int,
    max_nudges: int,
    tool_count: int,
    tool_count_at_last_nudge: int,
    mcp_unavailable: bool = False,
) -> bool:
    """Whether to veto an agent's *voluntary* stop and nudge it onward.

    True  -> block the Stop: the run is unfinished and a nudge may help.
    False -> allow the Stop: the project is complete, the nudge budget is spent, the
             previous nudge produced no tool call (the agent isn't making progress, so
             another nudge won't either), or the genealogy MCP surface is gone -- which
             the worker cannot observe, so its callers leave the default.
    """
    if mcp_unavailable:
        return False
    if project_completed(research):
        return False
    if nudges_used >= max_nudges:
        return False
    if nudges_used > 0 and tool_count == tool_count_at_last_nudge:
        return False
    return True


def make_stop_hook(
    *,
    turn_id: str,
    max_nudges: int,
    research: Callable[[], Mapping[str, Any] | None],
    tool_count: Callable[[], int],
    on_nudge: Callable[[int], None],
    log: Callable[..., None] | None = None,
):
    """The worker's ``Stop`` callback: ``research()`` is the project's research.json (or
    None) and ``tool_count()`` the turn's tool-call count so far, both read at each stop;
    ``on_nudge(n)`` is called on each veto. Never raises: any exception allows the stop.
    Bound with ``PRETOOL_TIMEOUT_S``; the harness's matcher has no timeout -- a timed-out
    hook allows the stop, like ``stop_hook_failed``."""
    state = {"nudges_used": 0, "tool_count_at_last_nudge": -1}

    async def _stop(_input_data: Any, _tool_use_id: str | None, _context: Any) -> dict[str, Any]:
        try:
            count = int(tool_count())
            if not should_continue_run(
                research=research(),
                nudges_used=state["nudges_used"],
                max_nudges=max_nudges,
                tool_count=count,
                tool_count_at_last_nudge=state["tool_count_at_last_nudge"],
            ):
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
    engine_dir: str,
    plugin_dir: str,
    agents: Mapping[str, Any],
    store: Any,
    config_dir: str,
    pretool_hook: Callable[..., Any],
    posttool_hook: Callable[..., Any],
    resume: str | None = None,
    session_id: str | None = None,
    fs_access_token: str | None = None,
    worker_env: Mapping[str, str] | None = None,
    stderr: Callable[[str], None] | None = None,
    stop_hook: Callable[..., Any] | None = None,
):
    """``stop_hook`` (D18, ``make_stop_hook``) binds a ``Stop`` matcher only when given:
    the interactive stack passes none, so a browser turn that yields to ask the user
    still ends."""
    from claude_agent_sdk import ClaudeAgentOptions, HookMatcher

    if resume and session_id:
        raise ValueError("resume and session_id are mutually exclusive: pass exactly one")
    env_in = os.environ if worker_env is None else worker_env
    model, model_env = provider_env(env_in)
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
    env: dict[str, str] = {
        "ENABLE_TOOL_SEARCH": "true",
        "CLAUDE_CONFIG_DIR": config_dir,
        **model_env,
    }
    if env_in.get("TMPDIR"):
        env["TMPDIR"] = env_in["TMPDIR"]
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
                "genealogy": tool_server_entry(
                    engine_dir, env_in, project_id=project_id, fs_access_token=fs_access_token
                )
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
    return ClaudeAgentOptions(**kwargs)

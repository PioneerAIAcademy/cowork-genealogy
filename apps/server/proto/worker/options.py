"""The worker's ``ClaudeAgentOptions`` and its one ``PreToolUse`` hook.

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
    token = fs_access_token if fs_access_token is not None else worker_env.get("FS_ACCESS_TOKEN", "")
    env["FS_ACCESS_TOKEN"] = token or ""
    for key in PER_USER_ENV_KEYS:
        if worker_env.get(key):
            env[key] = worker_env[key]
    return env


def tool_server_entry(
    engine_dir: str, worker_env: Mapping[str, str], *, project_id: str, fs_access_token: str | None
) -> dict[str, Any]:
    """The ``genealogy`` MCP server entry: ``hosted-stdio.js`` under ``env -u`` for the
    model key, with the per-turn environment of ``tool_server_env``."""
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


def make_pretool_hook(
    *,
    turn_id: str,
    session_id: str,
    cwd: str,
    config_root: str | Callable[[], str],
    record: Callable[[dict[str, Any]], None],
    log: Callable[..., None] | None = None,
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
            })
        except Exception as exc:  # noqa: BLE001 - the log must not change the decision
            if log is not None:
                log(ev="tool_call_log_failed", turn_id=turn_id, tool_name=tool_name,
                    error=f"{type(exc).__name__}: {exc}")
        if decision == "deny":
            if log is not None:
                log(ev="deny", turn_id=turn_id, tool_name=tool_name, tool_use_id=tool_use_id, reason=reason)
            return _deny(reason or "denied")
        return {}

    return _pretool


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
    resume: str | None = None,
    session_id: str | None = None,
    fs_access_token: str | None = None,
    worker_env: Mapping[str, str] | None = None,
    stderr: Callable[[str], None] | None = None,
):
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
    kwargs: dict[str, Any] = dict(
        cwd=cwd,
        permission_mode="bypassPermissions",
        system_prompt={"type": "preset", "preset": "claude_code", "append": project_note},
        setting_sources=[],
        plugins=[{"type": "local", "path": plugin_dir}],
        agents=dict(agents),
        mcp_servers=write_mcp_config(
            config_dir,
            {"genealogy": tool_server_entry(engine_dir, env_in, project_id=project_id, fs_access_token=fs_access_token)},
        ),
        disallowed_tools=list(DISALLOWED_TOOLS),
        hooks={"PreToolUse": [HookMatcher(matcher=None, hooks=[pretool_hook], timeout=PRETOOL_TIMEOUT_S)]},
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

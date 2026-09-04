"""Real agent: drives the genealogy skills + stdio MCP server via the Claude
Agent SDK (claude-agent-sdk). Loaded only when AGENT_MODE=real.

Runs inside the agent_runner — a long-lived, clean `asyncio.run` stdio loop (one
per session). So it holds a PERSISTENT ClaudeSDKClient: connect once, query per
turn. That gives **cross-turn conversation memory** for free (the SDK keeps the
session across queries), which the conversational flows need — notably the
multi-turn init-project onboarding interview and follow-ups ("explain that").
The research work itself is state-driven (the skills re-read research.json), so
project state never depended on conversation memory; this adds the conversation.

Durability across a sandbox pause/resume (or any agent_runner restart): the
ResultMessage's session_id is persisted to /project/.agent_session, and a
relaunched RealAgent passes it as resume= so the SDK reloads the prior
conversation from the on-disk transcript (which survives the E2B pause). See
docs/realtime-architecture.md is unrelated; the resume contract is
sandbox-provider-spec.md decision #1.

Config (build_options) — four load-bearing choices: do NOT set skills="all" (the
SDK turns it into `--allowedTools Skill`, restricting to only the Skill tool);
append the project path via system_prompt so the agent reads research.json from
cwd, not HOME; stage the plugin's agents into the project rather than letting
plugin discovery name them (see stage_plugin_agents — plugin loading registers
them ONLY as `genealogy-research:<agent>`, which no SKILL.md asks for); and pass
the PreToolUse hook, which is the session's ONLY restraint given
permission_mode="bypassPermissions" with no allowlist (see _pretool_hook).

The Anthropic key comes from the per-connect secrets file, NOT from this
process's env (see current_api_key + app/agent_secrets.py). A sandbox's env is
fixed at create() and can never be updated, so an env-sourced key goes stale the
moment the operator rotates it — the persistent client above then holds the dead
key for the sandbox's whole life. Hence _ensure_client re-reads the file each
turn and rebuilds the client when it changes.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
from collections.abc import AsyncIterator
from pathlib import Path

from .errors import UNEXPECTED, classify, log_operator
from .mcp_health import (
    GENEALOGY_TOOL_PREFIX,
    classify_server_status,
    find_server_entry,
    should_warn_at_init,
    unavailable_message,
)

# real_agent.py -> agent -> app -> server -> apps -> <repo root>
_REPO_ROOT = Path(__file__).resolve().parents[4]
_MCP_BUILD = os.environ.get("ENGINE_MCP_BUILD", str(_REPO_ROOT / "packages" / "engine" / "mcp-server" / "build" / "index.js"))
_PLUGIN_DIR = os.environ.get("ENGINE_PLUGIN_DIR", str(_REPO_ROOT / "packages" / "engine" / "plugin"))
# Per-connect secrets, rewritten by the control plane on every connect (see
# app/agent_secrets.py). Must equal sandbox.base.SECRETS_PATH — asserted by
# tests/test_agent_secrets.py, since this module cannot import from the control
# plane package (it also runs as a loose script in the baked E2B image).
# AGENT_SECRETS_PATH overrides it for LocalProvider, whose sandbox-absolute
# paths are mapped under a per-sandbox dir on the dev host.
_SECRETS_PATH = os.environ.get("AGENT_SECRETS_PATH", "/run/secrets/session.json")


def _event(kind: str, **kw) -> dict:
    return {"kind": kind, **kw}


def _log(msg: str) -> None:
    """Diagnostics go to STDERR — stdout is the runner's JSON-lines protocol and
    a stray line there desynchronizes the pump. Lands in /tmp/agent.log."""
    print(msg, file=sys.stderr, flush=True)


def stage_plugin_agents(project_dir: Path) -> list[str]:
    """Copy the plugin's agent definitions into ``<project>/.claude/agents/``.

    Returns the bare agent names now registered (one per staged file).

    ``plugins=[{"type": "local", …}]`` below **does** discover
    ``packages/engine/plugin/agents/*.md`` — but it registers each one under the
    plugin-NAMESPACED name ``genealogy-research:<agent>``, and nothing under the
    bare name. Every SKILL.md delegates by the bare name
    (``@plugin:record-extractor``), so on the plugin path the Task call
    hard-errors — "Agent type 'record-extractor' not found" — and the model then
    improvises: guess the namespaced spelling, fall back to ``general-purpose``,
    or do the work inline. The fallback is the dangerous one, because a
    general-purpose stand-in holds the session's whole tool set instead of the
    agent's ``tools:`` allow-list and binds none of its ``disallowedTools:``
    denies — the deny being the only thing keeping ``record-extractor`` off the
    broad ``research_append`` under ``bypassPermissions`` (issue #695).

    Staging into ``.claude/agents/`` is exactly what both eval harnesses do
    (``eval/harness/harness/workspace.py``, ``eval/harness/e2e/orchestrator.py``)
    and ``setting_sources=["project"]`` is what loads them, so after this the
    bare name resolves in every environment we run. The plugin stays loaded for
    its skills; the namespaced agent names remain registered too and resolve to
    these same definitions, so either spelling is now correct.

    Verified live against CLI 2.1.220 and guarded by
    ``tests/test_plugin_agents.py``. Issue #939.
    """
    src = Path(_PLUGIN_DIR) / "agents"
    if not src.is_dir():
        _log(f"[agent] no plugin agents at {src} — subagent delegation will miss")
        return []
    dest = project_dir / ".claude" / "agents"
    staged: list[str] = []
    try:
        dest.mkdir(parents=True, exist_ok=True)
        for agent_file in sorted(src.glob("*.md")):
            shutil.copy(agent_file, dest / agent_file.name)
            staged.append(agent_file.stem)
    except OSError as exc:
        # Loud, not silent: an unstaged agent degrades to a general-purpose
        # stand-in, which is precisely the failure this function exists to stop.
        _log(f"[agent] FAILED to stage plugin agents into {dest}: {exc}")
    return staged


# ── Raw-write lockdown (guardrail-enforcement-spec §6, issue #940) ──

# The two project files no raw Write/Edit may touch. Every write to them goes
# through the MCP writer tools (research_append, research_log_append, tree_edit,
# tree_correct), which validate before persisting; a direct file write never
# validates. research/SKILL.md already forbids it in prose and no skill's
# allowed-tools lists bare Write/Edit — this makes it a denial instead of a
# convention.
#
# This matters MORE here than in e2e, not less. The e2e harness runs
# permission_mode="dontAsk", which by itself denies Write/Edit on CLI >=2.1
# (see eval/harness/harness/skill_runner.py's note); this path runs
# bypassPermissions with no allowlist, so nothing stops a raw write today.
#
# Duplicated from eval/harness/e2e/orchestrator.py rather than shared: this
# module also runs as a loose script in the baked E2B image and cannot import
# from eval/ or from the control-plane package (see the module docstring).
# starting-tree.gedcomx.json is the write-once baseline the tree-encoding gate
# diffs against (issue #1490); overwriting it would defeat that gate.
PROTECTED_PROJECT_FILES = ("research.json", "tree.gedcomx.json", "starting-tree.gedcomx.json")

# Tools that write a file directly, by `file_path`. Bash is deliberately NOT
# here: the skills run their stdlib-only scripts through it, and the only way to
# catch a shell write would be pattern-matching command text — which would deny
# a legitimate `python script.py research.json > out` while still missing
# `python -c` with the path built from a variable. A false deny is the worse
# failure mode, so the shell route is left open and recorded in
# docs/specs/guardrail-enforcement-spec.md §6 ("Deliberate gaps") instead —
# close it only if a bypass appears in a runlog or a feedback case.
_FILE_WRITE_TOOLS = ("Write", "Edit", "NotebookEdit")
# The device-bridge writer, matched on the BARE TAIL because Cowork namespaces it
# (`mcp__remote-devices__device_commit_files`) and the plugin cannot control the
# prefix. This is the route that actually mattered: measured live 2026-08-15,
# `init-project` created both protected files through it in a run where
# Write/Edit/NotebookEdit appear nowhere, while `Write` could not reach the
# user's disk at all. `device_bash` is deliberately absent — its input is a
# command string where `cat research.json` and `cat > research.json` are
# indistinguishable without parsing a shell, and 37 of 40 shell touches of a
# protected file in the committed corpus are reads.
#
# Mirrored in all three lockdown copies even though only the plugin one ever
# sees the bridge; the parity test holds them to one vector set.
DEVICE_WRITE_TOOLS = ("device_commit_files",)

# A path has no newline and is no longer than the platform allows. Both bounds
# keep the payload walk below off file CONTENT travelling alongside the paths,
# though only the newline bound does real work there. 4096 = Linux PATH_MAX; it
# was 400, which is under every real path limit and let a 401-char path to a
# protected file through. Pinned by vectors in test_write_lockdown_parity.py.
_MAX_PATH_LEN = 4096


def _basename(value: str) -> str:
    """The trailing segment, under either separator."""
    return value.replace("\\", "/").rsplit("/", 1)[-1]


def _path_like_strings(value, depth: int = 0):
    """Every string in `value` that could be a path, walked structurally.

    The bridge's payload shape is not ours and is recorded nowhere in this repo,
    so this guesses no key: it walks whatever arrives. A content string that
    merely mentions a protected file is still safe, because whole basenames are
    compared — "see research.json" has basename "see research.json".
    """
    if depth > 6:
        return
    if isinstance(value, str):
        if value and "\n" not in value and len(value) <= _MAX_PATH_LEN:
            yield value
    elif isinstance(value, dict):
        for v in value.values():
            yield from _path_like_strings(v, depth + 1)
    elif isinstance(value, (list, tuple)):
        for v in value:
            yield from _path_like_strings(v, depth + 1)


def _device_bridge_target(tool_name: str, tool_input) -> str | None:
    """The protected filename a device-bridge write targets, or None.

    **Fails open on an unrecognised payload, deliberately.** Denying whenever the
    shape cannot be parsed would block a user asking Cowork to write their OWN
    files into a connected folder, which is not this guard's business and is a
    worse failure than the hole.
    """
    if _basename(tool_name.replace("__", "/")) not in DEVICE_WRITE_TOOLS:
        return None
    for candidate in _path_like_strings(tool_input or {}):
        name = _basename(candidate)
        if name in PROTECTED_PROJECT_FILES:
            return name
    return None


def direct_project_file_write(tool_name: str, tool_input: dict | None) -> str | None:
    """The protected filename a write call targets, or None.

    Two arms. A file-write tool names its destination in `file_path`; anything
    else falls through to `_device_bridge_target`, which claims only the
    device-bridge writers and returns None for every other tool — the MCP writer
    tools included, since those are the sanctioned route.

    Matched on the basename, so an absolute or relative path is caught alike.
    Both separators are handled: the sandbox is Linux, but the model composes
    this path itself and a hook that silently stops matching is worse than a
    redundant split.
    """
    if tool_name not in _FILE_WRITE_TOOLS:
        return _device_bridge_target(tool_name, tool_input)
    file_path = str((tool_input or {}).get("file_path") or "")
    name = file_path.replace("\\", "/").rsplit("/", 1)[-1]
    return name if name in PROTECTED_PROJECT_FILES else None


_SECRETS_MARKERS = (
    "session.json",
    ".familysearch-mcp",
    "ANTHROPIC_API_KEY",
    "sk-ant-",
)
_NETWORK_TOOLS = ("curl", "wget", "nc ", "ncat ", "socat ", "python3 -c", "python -c")


def _bash_secrets_exfil(command: str) -> bool:
    """True when a Bash command references credentials AND a network egress tool."""
    lower = command.lower()
    has_secret = any(m.lower() in lower for m in _SECRETS_MARKERS)
    has_net = any(t in lower for t in _NETWORK_TOOLS)
    return has_secret and has_net


async def _pretool_hook(input_data, _tool_use_id, _ctx):
    """PreToolUse: deny raw writes to the two project files, and block Bash
    commands that combine credential access with network egress.

    A hook binds under `bypassPermissions` — the unit harness has run exactly
    this combination since the per-context policy landed
    (`eval/harness/harness/skill_runner.py`), and its deny decisions are what
    enforce that policy today. `disallowed_tools` is not usable here: it takes
    whole tool names, and Write/Edit are needed for every other file.

    No `stopReason` — a denied write is a recoverable mistake. The turn
    continues so the agent can reach for the writer tool instead, matching how
    the e2e tree-read block behaves.
    """
    tool_name = input_data.get("tool_name", "")
    tool_input = input_data.get("tool_input") or {}

    protected = direct_project_file_write(tool_name, tool_input)
    if protected:
        _log(f"[agent] denied raw {tool_name} on {protected}")
        return {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": (
                    f"{tool_name} on {protected} is disabled — all writes to "
                    "research.json/tree.gedcomx.json must go through the writer tools. "
                    "To CREATE a new project use project_create, which writes both files "
                    "together; to add to an existing one use research_append, "
                    "research_log_append, tree_edit or tree_correct. These validate "
                    "before persisting. Direct file writes never validate."
                ),
            },
        }

    if tool_name == "Bash" and _bash_secrets_exfil(str(tool_input.get("command", ""))):
        _log("[agent] denied Bash: credential access combined with network egress")
        return {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": (
                    "Bash commands that access session credentials and send data "
                    "over the network are not permitted."
                ),
            },
        }

    return {}


def current_api_key() -> str:
    """The operator's Anthropic key for the next turn.

    Prefers the per-connect secrets file so a rotated key reaches a long-lived
    sandbox whose create-time env is frozen (the whole point of the file
    channel). Falls back to the env var when the file is missing, unreadable, or
    carries no key — local dev, and any sandbox created before this existed.
    """
    env_key = os.environ.get("ANTHROPIC_API_KEY", "")
    try:
        doc = json.loads(Path(_SECRETS_PATH).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return env_key
    key = doc.get("anthropic_api_key") if isinstance(doc, dict) else None
    return key if isinstance(key, str) and key else env_key


def build_options(project_dir: Path, resume: str | None = None, api_key: str | None = None):
    from claude_agent_sdk import ClaudeAgentOptions, HookMatcher

    # Side effect, deliberately here: the plugin's agents are registered by
    # staging their .md files into the project, not by plugin discovery (see
    # stage_plugin_agents). Doing it on every client build keeps a resumed or
    # rebuilt session on the current definitions after an engine upgrade.
    staged = stage_plugin_agents(project_dir)
    if staged:
        _log(f"[agent] staged plugin agents: {', '.join(staged)}")

    project_note = (
        "You are the hosted genealogy research agent. The active research "
        f"project lives in your current working directory ({project_dir}). It "
        "contains research.json and tree.gedcomx.json — read and update those "
        "files there (do NOT look in the home directory). Follow the genealogy "
        "skills, and apply researcher_profile.narration_guidance from "
        "research.json as your narration style."
    )
    kwargs = dict(
        cwd=str(project_dir),
        add_dirs=[str(project_dir)],
        model=os.environ.get("MODEL") or None,
        permission_mode="bypassPermissions",  # operator-controlled, headless
        system_prompt={"type": "preset", "preset": "claude_code", "append": project_note},
        # "project" only — the same source both eval harnesses load
        # (workspace.py, e2e/orchestrator.py) and what registers the agents
        # stage_plugin_agents just wrote. "user" was also listed, which read a
        # source no harness run sees: nothing writes ~/.claude in the sandbox
        # (sandbox/e2b.Dockerfile creates only ~/.familysearch-mcp), so it
        # contributed nothing here while widening the gap between what CI
        # exercises and what production loads.
        setting_sources=["project"],
        plugins=[{"type": "local", "path": _PLUGIN_DIR}],
        mcp_servers={
            "genealogy": {"type": "stdio", "command": "node", "args": [_MCP_BUILD]},
        },
        # The only restraint on this session. permission_mode is
        # bypassPermissions with no allowlist, so the hook is what keeps raw
        # Write/Edit off research.json and tree.gedcomx.json AND blocks Bash
        # commands that combine credential access with network egress (see
        # _pretool_hook). matcher=None fires it for every tool.
        hooks={"PreToolUse": [HookMatcher(matcher=None, hooks=[_pretool_hook])]},
        # Stream partial assistant content. Without it a block reaches the UI only
        # when its whole message completes, so a long turn — a record-extraction
        # subagent reasoning before its next tool call — shows nothing at all for
        # minutes. The deltas are also what keeps the socket's data frames flowing
        # through the sandbox's edge proxy during that stretch.
        include_partial_messages=True,
        # ENABLE_TOOL_SEARCH turns tool search ON, not off — the polarity is the
        # opposite of what this comment claimed until issue #1110. Read off the
        # installed CLI (v2.1.220): a truthy value (`true|1|yes|on`) selects
        # deferred/tool-search mode, `auto`/`auto:N` is the adaptive variant, and
        # only a FALSY value (`false|0|no|off`) selects "standard" mode, where
        # every schema is loaded up front. Unset also lands on tool-search mode,
        # so deleting the variable eager-loads nothing. (Additionally forced off
        # on a non-first-party ANTHROPIC_BASE_URL, on Vertex, and under
        # CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS.)
        #
        # So "true" below means hosted sessions run WITH tool search: the
        # ~38-tool genealogy server's schemas are deferred and re-discovered via
        # ToolSearch mid-session. Speedup plan §3a wanted the opposite; flipping
        # to "false" is a separate, tracked decision that requires re-measuring
        # the tool mix, so the value is left as it has been running — and kept in
        # sync with the e2e orchestrator either way.
        env={
            "ANTHROPIC_API_KEY": current_api_key() if api_key is None else api_key,
            "ENABLE_TOOL_SEARCH": "true",
        },
    )
    if resume:
        kwargs["resume"] = resume  # reload the prior conversation transcript
    return ClaudeAgentOptions(**kwargs)


def map_message(message, tool_names: dict[str, str], tasks: dict[str, str] | None = None) -> list[dict]:
    """SDK message → the wire events the UI consumes.

    Two things here are easy to miss:

    **Subagent turns arrive on this same stream**, tagged with
    ``parent_tool_use_id`` rather than nested. Without reading it, a
    record-extractor's text/thinking/tool calls are indistinguishable from the
    main agent's — they land in the same chat bubble and read as if the
    orchestrator did the work itself. Every event carries an ``agent`` label when
    it came from a subagent, resolved through ``tasks`` (tool_use_id → the Task's
    description, learned from task_started).

    **Delta events are transient.** ``*_delta`` and ``task_progress`` are for live
    display only — the pump must not put them in the replay transcript, or a
    single streamed turn would evict the whole conversation from it. The
    canonical, recorded ``text``/``thinking`` block still follows every delta run;
    the client shows deltas as a preview and commits on the block.
    """
    from claude_agent_sdk import (
        AssistantMessage,
        StreamEvent,
        TaskNotificationMessage,
        TaskProgressMessage,
        TaskStartedMessage,
        TextBlock,
        ThinkingBlock,
        ToolResultBlock,
        ToolUseBlock,
        UserMessage,
    )

    tasks = tasks if tasks is not None else {}

    def _event_for(msg, kind: str, **kw) -> dict:
        """Attach the originating subagent's label, when there is one."""
        agent = tasks.get(getattr(msg, "parent_tool_use_id", None) or "")
        return _event(kind, **kw, **({"agent": agent} if agent else {}))

    out: list[dict] = []
    if isinstance(message, TaskStartedMessage):
        label = message.description or message.task_type or "subagent"
        if message.tool_use_id:
            tasks[message.tool_use_id] = label
        out.append(_event("task_started", agent=label, task_id=message.task_id))
    elif isinstance(message, TaskProgressMessage):
        usage = message.usage or {}
        out.append(_event(
            "task_progress",
            agent=message.description or tasks.get(message.tool_use_id or "", "subagent"),
            task_id=message.task_id,
            last_tool=message.last_tool_name or "",
            tool_uses=usage.get("tool_uses"),
            total_tokens=usage.get("total_tokens"),
            duration_ms=usage.get("duration_ms"),
        ))
    elif isinstance(message, TaskNotificationMessage):
        out.append(_event(
            "task_done",
            agent=tasks.pop(message.tool_use_id or "", "subagent"),
            task_id=message.task_id,
            status=message.status,
            summary=str(message.summary or "")[:160],
        ))
    elif isinstance(message, StreamEvent):
        # Raw Anthropic stream event. Only the incremental content deltas are
        # useful here; block start/stop is implied by the canonical block event.
        ev = message.event or {}
        delta = ev.get("delta") or {}
        if ev.get("type") == "content_block_delta":
            if delta.get("type") == "text_delta" and delta.get("text"):
                out.append(_event_for(message, "text_delta", text=delta["text"]))
            elif delta.get("type") == "thinking_delta" and delta.get("thinking"):
                out.append(_event_for(message, "thinking_delta", text=delta["thinking"]))
    elif isinstance(message, AssistantMessage):
        # #1126 — the path the alpha testers actually read. When the SDK marks
        # an assistant message as an error (`AssistantMessage.error`, the
        # 6-value literal at claude_agent_sdk/types.py:1005, populated by
        # message_parser.py), its text blocks ARE the failure's own words: an
        # operator-key 401 arrived as "Failed to authenticate. API Error: 401
        # API key is invalid." tagged `kind: "text"`, i.e. styled as the
        # assistant's own answer. Emit ONE classified error event and drop the
        # blocks; the raw text survives on the operator log.
        #
        # `kind: "error"` rather than `kind: "text"` is what tells the UI this
        # is not an answer: chatEvents.ts sets `last.error = true`, which
        # ChatPane renders with the `msgError` class.
        #
        # Dropping the blocks cannot swallow a real answer. Raised in review of
        # #1724 for the retried-`rate_limit` case and anchored in the bundled
        # CLI: every errored assistant message is built by one helper,
        # `Gl({content, error})` -> `{content: [{type: "text", text: content}],
        # isApiErrorMessage: true, error}`, where `content` IS the error text
        # (e.g. "Usage credits required for 1M context ..."). So an errored
        # AssistantMessage never carries a successful answer, and there is
        # nothing to lose by replacing its text with the classified string.
        err_kind = getattr(message, "error", None)
        if err_kind:
            classification = classify(error_kind=err_kind)
            raw = " ".join(
                b.text for b in message.content if isinstance(b, TextBlock)
            ).strip()
            log_operator("assistant_message", classification,
                         error_kind=err_kind, detail=raw[:500] or None)
            out.append(_event_for(message, "error", text=classification))
            return out
        for block in message.content:
            if isinstance(block, TextBlock):
                out.append(_event_for(message, "text", text=block.text))
            elif isinstance(block, ThinkingBlock):
                out.append(_event_for(message, "thinking", text=getattr(block, "thinking", "")))
            elif isinstance(block, ToolUseBlock):
                tool_names[getattr(block, "id", "")] = block.name  # for the matching tool_result
                out.append(_event_for(message, "tool_use", tool=block.name,
                                      summary=_tool_summary(getattr(block, "input", None))))
    elif isinstance(message, UserMessage):
        # Tool results come back as a UserMessage of ToolResultBlock(s); tag each
        # with the originating tool's name so the UI can mark that chip done.
        for block in (message.content if isinstance(message.content, list) else []):
            if isinstance(block, ToolResultBlock):
                name = tool_names.get(getattr(block, "tool_use_id", ""), "tool")
                out.append(_event_for(message, "tool_result", tool=name,
                                      summary=_result_summary(getattr(block, "content", None))))
    return out


# Live-only event kinds: shown as they stream, never written to the replay
# transcript (see map_message's docstring). Shared with sandbox_server's pump.
TRANSIENT_KINDS = frozenset({"text_delta", "thinking_delta", "task_progress"})


def _tool_summary(inp: object) -> str:
    """A short, human-readable view of a tool's input for the chip + timeline —
    the Bash command, the search query, etc. — instead of a bare 'running'."""
    if not isinstance(inp, dict) or not inp:
        return "running"
    if "command" in inp:  # Bash
        return str(inp["command"])[:160]
    return ", ".join(f"{k}={v}" for k, v in list(inp.items())[:4])[:160] or "running"


def _result_summary(content: object) -> str:
    if isinstance(content, list):  # list of content blocks
        content = " ".join(getattr(c, "text", "") for c in content if hasattr(c, "text"))
    s = str(content or "").strip().replace("\n", " ")
    return s[:160] if s else "done"


class RealAgent:
    def __init__(self, project_dir: Path):
        self.dir = project_dir
        self._client = None
        # The API key the live client was built with. The SDK reads
        # ANTHROPIC_API_KEY once, when its subprocess starts, so a client is
        # pinned to whatever key was current then — we compare against this to
        # notice a rotation and rebuild (see _ensure_client).
        self._client_key: str | None = None
        self._session_file = project_dir / ".agent_session"
        self._resume_id: str | None = None
        self._tool_names: dict[str, str] = {}  # tool_use_id → name, for tool_result tagging
        self._tasks: dict[str, str] = {}  # Task tool_use_id → subagent label, for attribution
        # Running cumulative cost/usage last seen from the SDK, so we can emit
        # per-turn deltas (see _usage_delta). The SDK's ResultMessage reports
        # session totals, not per-turn values.
        self._cum_cost = 0.0
        self._cum_in = 0
        self._cum_out = 0
        # #941/#1126 — genealogy MCP health, read off the CLI's `system`/`init`
        # message. Session-scoped, not turn-scoped: a re-spawned CLI emits a
        # FRESH init, so both counters have to outlive the turn or the warning
        # would repeat (and would fire on a session that has already
        # researched). See mcp_health.should_warn_at_init.
        self._mcp_calls = 0
        self._mcp_warned = False
        if self._session_file.exists():
            try:
                self._resume_id = self._session_file.read_text(encoding="utf-8").strip() or None
            except OSError:
                self._resume_id = None

    async def _close_client(self) -> None:
        """Drop the live client. State is cleared FIRST so a disconnect that
        throws can't leave a half-dead client cached for the next turn."""
        client, self._client, self._client_key = self._client, None, None
        if client is None:
            return
        try:
            await client.disconnect()
        except Exception as exc:  # best-effort teardown; we're replacing it anyway
            _log(f"[agent] client disconnect failed (ignored): {exc}")

    async def _ensure_client(self):
        key = current_api_key()
        if self._client is not None and key != self._client_key:
            # The operator rotated the key under a live client. Rebuild so the
            # new one takes effect without waiting for the sandbox to be
            # recreated. Conversation survives: the rebuild passes
            # resume=<session id>, the same path a runner restart takes.
            _log("[agent] Anthropic key rotated — rebuilding the SDK client")
            await self._close_client()
        if self._client is None:
            from claude_agent_sdk import ClaudeSDKClient

            client = ClaudeSDKClient(
                options=build_options(self.dir, resume=self._resume_id, api_key=key)
            )
            # Assign only after a successful connect, so a failed start is
            # retried next turn instead of caching a client that never opened.
            await client.connect()
            self._client = client
            self._client_key = key
        return self._client

    def _usage_delta(self, cost, in_tok, out_tok):
        """Convert the SDK's cumulative session totals into per-turn increments.

        ``ResultMessage.total_cost_usd`` and ``.usage`` are cumulative across
        the whole session — they grow every turn. The client sums the usage
        events it receives (and gets genuine per-turn values from the mock
        agent), so it must be handed the increment, not the running total;
        summing running totals over-counts the session cost by ~(turns+1)/2.
        A ``None`` field passes through as ``None`` without advancing its
        baseline, and each delta is floored at 0 so a lower snapshot (e.g. a
        cumulative counter that reset on resume) can't emit a negative."""

        def step(prev, cur):
            if cur is None:
                return prev, None
            return cur, max(cur - prev, 0)

        self._cum_cost, d_cost = step(self._cum_cost, cost)
        self._cum_in, d_in = step(self._cum_in, in_tok)
        self._cum_out, d_out = step(self._cum_out, out_tok)
        return d_cost, d_in, d_out

    def _remember_session(self, message) -> None:
        sid = getattr(message, "session_id", None)
        if sid and sid != self._resume_id:
            self._resume_id = sid
            try:
                self._session_file.write_text(sid, encoding="utf-8")
            except OSError:
                pass

    async def interrupt(self) -> bool:
        """Abort the in-flight turn via the SDK's control channel. The current
        receive_response() stream then ends on its own, so handle_turn completes
        and the runner emits turn_done — no task cancellation needed (returning
        True tells the runner not to cancel). The persistent client stays
        connected and is reused for the next turn. No live client → nothing to
        stop, and returning False lets the runner cancel as a fallback."""
        if self._client is None:
            return False
        await self._client.interrupt()
        return True

    def _mcp_health_events(self, message) -> list[dict]:
        """Zero or one warning that this session has no genealogy tools.

        Reads the CLI's `system`/`init` payload. Silent on every arm except a
        genealogy server that is listed unhealthy — or not listed at all — in a
        session that has made no genealogy call yet. `pending` is the NORMAL
        healthy reading at init (it settles ~14s later), so it must not warn;
        that is what `classify_server_status`'s three-way split is for.

        Defensive throughout: this reads another process's payload, and a
        detector that raises would break the sessions it exists to protect.
        """
        if self._mcp_warned:
            return []
        # Gate on the subtype the harness gates on (`orchestrator.py`'s
        # `if message.subtype == "init"`). `SystemMessage` also carries config
        # and hint subtypes; reading `mcp_servers` off any of them is safe only
        # because none of the others happens to use that key today, which also
        # made `test_a_non_init_system_message_is_ignored` pass for the wrong
        # reason. Matching the source this is copied from removes both.
        if getattr(message, "subtype", None) != "init":
            return []
        data = getattr(message, "data", None)
        if not isinstance(data, dict):
            return []
        entries = data.get("mcp_servers")
        health = classify_server_status(entries)
        if not should_warn_at_init(health, mcp_call_count=self._mcp_calls):
            return []
        self._mcp_warned = True
        entry = find_server_entry(entries)
        text = unavailable_message(entry)
        log_operator("mcp_init", text, detail=f"health={health} entry={entry!r}")
        return [_event("error", text=text)]

    async def handle_turn(self, text: str) -> AsyncIterator[dict]:
        try:
            from claude_agent_sdk import ResultMessage, SystemMessage
        except ImportError as exc:
            # Developer text ("use AGENT_MODE=mock") in front of a paying user
            # is the same defect as the raw 401 — it reads as something they
            # misconfigured. The detail stays on the operator log.
            log_operator("import_sdk", UNEXPECTED, exc=exc)
            yield _event("error", text=UNEXPECTED)
            return
        try:
            client = await self._ensure_client()
        except Exception as exc:
            classification = classify(exc)
            log_operator("ensure_client", classification, exc=exc)
            yield _event("error", text=classification)
            return
        try:
            await client.query(text)
            # Whether an errored AssistantMessage has already told the user about
            # this turn. Turn-scoped, not session-scoped: a later turn's failure
            # is a new fact the user needs.
            error_emitted = False
            async for message in client.receive_response():
                for ev in map_message(message, self._tool_names, self._tasks):
                    if ev.get("kind") == "tool_use" and str(
                        ev.get("tool") or ""
                    ).startswith(GENEALOGY_TOOL_PREFIX):
                        self._mcp_calls += 1
                    if ev.get("kind") == "error":
                        error_emitted = True
                    yield ev
                if isinstance(message, SystemMessage):
                    # #941 ported from the e2e harness (issue #1126). The CLI's
                    # init message lists every MCP server it tried to connect
                    # (`mcp_servers: [{name, status}]`, a required field of its
                    # own init schema). A hosted session whose genealogy server
                    # never connected still RUNS — the model just has no
                    # genealogy tools — so the user pays a full session for
                    # research that could not have happened, with nothing to
                    # distinguish it from a genuine dead end. The harness aborts
                    # such a run; there is no run to abort here, so we warn once
                    # and let the turn proceed.
                    for ev in self._mcp_health_events(message):
                        yield ev
                if isinstance(message, ResultMessage):
                    # #1126 — the silent path. `receive_response()` YIELDS the
                    # ResultMessage and terminates; it does not raise on
                    # `is_error`, and nothing in this package read that field,
                    # so an in-turn API 401 produced no error event at all: the
                    # turn ended with `usage` + `turn_done` and the user watched
                    # ~90s of nothing, then silence. That retry latency is the
                    # signature of this path, not of a fail-fast connect().
                    # Two ways this must NOT fire, both found in review of #1724.
                    #
                    # 1. The user pressed Stop. The CLI sets `is_error` with
                    #    `terminal_reason` in ("aborted_streaming",
                    #    "aborted_tools") and NO `api_error_status`, so the
                    #    default classification would tell the person who just
                    #    cancelled that something went wrong and to report it —
                    #    a new false alarm, since this field was read nowhere
                    #    before. The SDK's own docstring defines those two
                    #    values as "the turn was cancelled" (types.py:1249), and
                    #    the bundled CLI skips its own error render on the same
                    #    test.
                    # 2. The assistant-message path already reported this turn.
                    #    The SDK sets `AssistantMessage.error` and
                    #    `ResultMessage.is_error` independently, from two CLI
                    #    messages, so both can land in one turn — and an
                    #    `is_error` with no status would then read
                    #    "please report it" followed by "please try again" for
                    #    one failure. That contradiction is this PR's own defect
                    #    pointed at itself. The assistant path wins because it
                    #    carries the real `error_kind`.
                    #
                    # The MCP-health warning is deliberately NOT counted here:
                    # it reports a different fact (this session has no genealogy
                    # tools), not a second opinion about this failure.
                    aborted = getattr(message, "terminal_reason", None) in (
                        "aborted_streaming",
                        "aborted_tools",
                    )
                    if getattr(message, "is_error", False) and not aborted and not error_emitted:
                        status = getattr(message, "api_error_status", None)
                        classification = classify(status=status)
                        log_operator("result_message", classification, status=status)
                        yield _event("error", text=classification)
                    self._remember_session(message)  # persist for resume on relaunch
                    # Per-turn cost/usage for the operator cost meter (alpha
                    # mode, web only). The SDK's ResultMessage carries
                    # total_cost_usd + a usage dict that was otherwise discarded,
                    # both as CUMULATIVE session totals — so emit the per-turn
                    # delta the client sums (see _usage_delta). Defensive: fields
                    # may be absent on older SDKs or partial results.
                    usage = getattr(message, "usage", None)
                    if isinstance(usage, dict):
                        in_tok, out_tok = usage.get("input_tokens"), usage.get("output_tokens")
                    else:
                        in_tok = getattr(usage, "input_tokens", None)
                        out_tok = getattr(usage, "output_tokens", None)
                    d_cost, d_in, d_out = self._usage_delta(
                        getattr(message, "total_cost_usd", None), in_tok, out_tok
                    )
                    yield _event(
                        "usage",
                        cost_usd=d_cost,
                        input_tokens=d_in,
                        output_tokens=d_out,
                    )
                    break  # turn complete; the runner emits turn_done
        except Exception as exc:
            classification = classify(exc)
            log_operator("receive_loop", classification, exc=exc)
            yield _event("error", text=classification)

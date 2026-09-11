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

import asyncio
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

# The third arm's tool. `_pretool_hook` denies a Bash command that combines a
# credential marker with a network egress tool (the exfiltration speed bump from
# issue #1018 Task 3), so `Bash` has to reach the hook for that arm to run at
# all — which means it belongs in the matcher below.
#
# A CONSTANT RATHER THAN A LITERAL, and the arm reads it too, because the two
# diverging is the whole failure mode `_PRETOOL_MATCHER` is derived to avoid.
# This is not hypothetical: that arm landed while the matcher was still `None`,
# so it bound by accident, and narrowing the matcher without this line left a
# shipped security guard inert with the suite green.
_EXFIL_GUARD_TOOLS = ("Bash",)

# The PreToolUse matcher, DERIVED from the deny arms above rather than restated.
# `matcher=None` fired the hook for EVERY tool, which is how one unanswered hook
# callback took down `ToolSearch` — a purely local call with nothing to deny
# (issue #1915). Narrowing it means a starved callback can only ever fail the
# calls this hook could actually refuse — and THAT CLAIM NEEDED THE ANCHORS
# BELOW to be true. Raised in review: the bundled CLI (2.1.220) applies a matcher
# that does not fit its own charset as `new RegExp(t).test(e)`, an unanchored
# SEARCH. Read out of the binary:
#
#     function IF_(e,t,r,n){ if(!t||t==="*")return!0;
#       if((r?/^[a-zA-Z0-9_|, -]+$/:/^[a-zA-Z0-9_|]+$/).test(t))
#           return t.split(...).map(...).flatMap(...).includes(e);   // EXACT LIST
#       try{ let i=new RegExp(t); if(i.test(e))return!0; ... }catch{...} }
#
# So an unanchored `Write|Edit|...|Bash` also bound `TodoWrite`, `MultiEdit`,
# `BashOutput`, `KillBash` and `EditNotebook` — every one of which this hook
# denies nothing about. `TodoWrite` is precisely the "purely local call with
# nothing to deny" class that `ToolSearch` died in, so the over-match reopened
# the failure this narrowing exists to close. The bare names are anchored with
# `^(...)$` for that reason; the device-bridge arm stays a search because it must
# match a prefix it cannot predict.
#
# THE PATTERN MUST KEEP A CHARACTER OUTSIDE BOTH CHARSETS ABOVE (`.` and `*` do
# it). If a future edit ever makes it fit — someone dropping `.*` on the
# reasoning that a search matches anyway — the CLI silently switches to EXACT
# STRING LIST membership and every namespaced spelling stops binding. The CLI's
# own warning text a few bytes earlier says "it is compared as an exact string".
# `test_the_matcher_stays_in_the_clis_regex_branch` pins this.
#
# Derived, not written out, because a restated list is exactly what let the
# plugin's matcher and its predicate diverge with every test green
# (docs/specs/guardrail-enforcement-spec.md, "Closed 2026-08-17/18"; ADR-0005,
# "The matcher is part of the guardrail").
#
# The device-bridge name takes a `.*` prefix: Cowork namespaces it
# (`mcp__remote-devices__device_commit_files`) and `_device_bridge_target`
# matches on the BARE TAIL, so the prefix is what makes this bind under an
# anchored full match as well as a substring search. A bare
# `device_commit_files` is the form that shipped inert once. `research_append`
# is deliberately absent, unlike the plugin's matcher: this hook returns `{}`
# for it (see `direct_project_file_write`), so matching it would only widen the
# blast radius of a starved callback.
#
# IF YOU ADD A DENY ARM TO `_pretool_hook`, ADD ITS TOOLS HERE IN THE SAME
# COMMIT. `test_the_matcher_covers_every_tool_the_hook_can_deny` fails when the
# hook denies something this string does not match, because a matcher narrower
# than its predicate is a guard that is inert with the whole suite green.
_PRETOOL_MATCHER = "|".join(
    (
        # Anchored, so a search cannot bind a tool that merely CONTAINS one of
        # these names. Three constants, not two.
        "^(" + "|".join((*_FILE_WRITE_TOOLS, *_EXFIL_GUARD_TOOLS)) + ")$",
        # Trailing `$`: the tail is compared WHOLE. Without it the pattern also
        # bound `*device_commit_files_v2` spellings, which this hook can deny
        # nothing about - the last 8 over-matches of the 136 spellings measured
        # in review. The parity suite already declares `_v2` a name that must not
        # match. `.`, `*` and `$` all keep the pattern outside the CLI's
        # literal-list charsets, so the regex branch still applies.
        *(f".*{t}$" for t in DEVICE_WRITE_TOOLS),
    )
)

# How long the CLI waits for a PreToolUse callback before giving up on it.
#
# Unset, the effective value is the CLI's own default, and that default IS
# findable — an earlier version of this comment said it was not, named the wrong
# CLI (2.1.258; the SDK pinned in uv.lock bundles 2.1.220, as lines 102 and 492
# already say) and cited two literals that are not hook timeouts. Corrected in
# review by reading the PreToolUse executor itself out of the binary:
#
#     var Hm=600000, frd=30000;
#     async function*VOt(e,t,r,n,o,i,s=Hm,a){ ...
#       yield*lM({hookInput:u, toolUseID:t, matchQuery:e, signal:i, timeoutMs:s, ...})
#
# The executor's own timeout parameter defaults to `Hm` = 600000 ms and hands it
# to the dispatcher as `timeoutMs`. 600 s — which is exactly what the wedged
# session observed per call, so the measurement and the default agree rather
# than leaving three unexplained numbers. (`Timeout ?? 60000` in that binary is
# an HTTP server's `headersTimeout`; `timeout ?? 600000` as spaced does not
# occur at all.) The SDK's own `HookMatcher` docstring advertises 60 and
# documents the unit as SECONDS (`claude_agent_sdk/types.py`), so the value
# below is 10 s.
#
# Set explicitly anyway: 600 s is far too long for a callback this cheap, and a
# shorter timeout makes a starved callback fail faster rather than succeed.
#
# Ten seconds: the callback is in-process and does a bounded walk over the tool
# payload with no I/O, so this is orders of magnitude of headroom, while a
# starved call now fails in 10s instead of 600s.
#
# A MITIGATION, NOT THE FIX. A shorter timeout makes a starved callback fail
# faster; it does not make it succeed. `_drain_background` is the fix.
_PRETOOL_TIMEOUT_S = 10.0

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
_NETWORK_TOOLS = ("curl", "wget", "nc ", "ncat ", "socat ",
                  "urllib", "requests", "httpx", "http.client", "socket")


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

    if tool_name in _EXFIL_GUARD_TOOLS and _bash_secrets_exfil(
        str(tool_input.get("command", ""))
    ):
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
        # _pretool_hook). Scoped to the tools it can actually deny, and given an
        # explicit timeout — see _PRETOOL_MATCHER and _PRETOOL_TIMEOUT_S.
        hooks={
            "PreToolUse": [
                HookMatcher(
                    matcher=_PRETOOL_MATCHER,
                    hooks=[_pretool_hook],
                    timeout=_PRETOOL_TIMEOUT_S,
                )
            ]
        },
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


def map_message(
    message,
    tool_names: dict[str, str],
    tasks: dict[str, str] | None = None,
    live: set[str] | None = None,
) -> list[dict]:
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
        TERMINAL_TASK_STATUSES,
        TaskNotificationMessage,
        TaskProgressMessage,
        TaskStartedMessage,
        TaskUpdatedMessage,
        TextBlock,
        ThinkingBlock,
        ToolResultBlock,
        ToolUseBlock,
        UserMessage,
    )

    tasks = tasks if tasks is not None else {}
    live = live if live is not None else set()

    def _event_for(msg, kind: str, **kw) -> dict:
        """Attach the originating subagent's label, when there is one."""
        agent = tasks.get(getattr(msg, "parent_tool_use_id", None) or "")
        return _event(kind, **kw, **({"agent": agent} if agent else {}))

    out: list[dict] = []
    if isinstance(message, TaskStartedMessage):
        label = message.description or message.task_type or "subagent"
        # ATTRIBUTION is keyed on `tool_use_id`, which the SDK types as
        # `str | None` — a Task without one simply goes unlabelled.
        if message.tool_use_id:
            tasks[message.tool_use_id] = label
        # LIVENESS is keyed on `task_id`, which is a required `str`. These were
        # one dict until review: keying liveness on the optional field meant a
        # Task with no `tool_use_id` registered nothing, so the drainer never
        # started and the fix silently did not engage.
        live.add(message.task_id)
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
        live.discard(message.task_id)
        out.append(_event(
            "task_done",
            agent=tasks.pop(message.tool_use_id or "", "subagent"),
            task_id=message.task_id,
            status=message.status,
            summary=str(message.summary or "")[:160],
        ))
    elif isinstance(message, TaskUpdatedMessage):
        # A terminal state can arrive ONLY here, with no accompanying
        # TaskNotificationMessage: the SDK's own lifecycle note says a task
        # stopped via TaskStop reports `status="killed"` on this message and the
        # matching notification "is sometimes suppressed", so consumers tracking
        # active ids must clear on a terminal status from EITHER message. Without
        # this arm a killed subagent stayed in the liveness set forever and every
        # later turn spawned a drainer for a phantom. Harmless while the set was
        # only attribution labels; still useful as the operator log's count.
        #
        # `status` and `patch["status"]` are both read because the dataclass
        # carries the field while the CLI reports it inside the patch, and
        # TERMINAL_TASK_STATUSES spans both vocabularies (`killed` here,
        # `stopped` on a notification).
        status = message.status or (message.patch or {}).get("status")
        if status in TERMINAL_TASK_STATUSES:
            live.discard(message.task_id)
        # No wire event: delivering task_updated to the browser would extend this
        # change into runner.py/sandbox_server.py/apps/web, which Decision A
        # keeps out of scope.
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
        # True from the moment a turn is queried until that turn consumes its own
        # ResultMessage. A turn abandoned at a yield — which is what Stop does —
        # never clears it, and that is the signal the SDK stream still owes a
        # terminal frame. See _handle_abandoned_stream.
        self._stream_dirty = False
        # Liveness, keyed on the REQUIRED task_id rather than the optional
        # tool_use_id above. This is what gates the drainer; see map_message.
        self._live_tasks: set[str] = set()
        # The background stream drainer, when one is running. At most one, ever
        # — see _stop_drain for why that is not merely tidy.
        self._drain_task: asyncio.Task | None = None
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

    async def _handle_abandoned_stream(self) -> None:
        """Drop the client when the previous turn never finished reading its stream.

        THE DEFECT THIS CLOSES. `handle_turn` breaks out of its receive loop at
        the ResultMessage. When the generator is abandoned at a `yield` instead —
        which is exactly what Stop does, via `_run_turn`'s cancellation — that
        loop never runs again, so the turn's tail INCLUDING its ResultMessage
        stays queued. The next turn then calls `client.query(text)` and
        `receive_response()` reads that stale terminal frame first and returns
        immediately: the new turn delivers nothing, its own frames stay unread,
        and the stream is one turn behind from then on. Reproduced over a fake
        transport — turn 2 emits zero text events and two frames are left unread,
        so it persists rather than self-correcting.

        WHY DROP THE CLIENT RATHER THAN DRAIN. Draining until the stream goes
        idle looks cheaper and is wrong: the abandoned turn's ResultMessage may
        not have ARRIVED yet when the next turn starts, so a short drain finds
        nothing, declares the stream clean, and the late frame still terminates
        the next turn. Draining until a ResultMessage appears needs a deadline,
        and a turn that will never produce one then hangs the next. A fresh
        client has no such race: the stream is new by construction. The cost is a
        CLI respawn, paid only after a Stop, which a person does rarely — and
        `_remember_session` has already persisted the session id, so
        `_ensure_client` resumes rather than starting the conversation over.

        Not a substitute for the post-turn drain (issue #1915): that one keeps a
        COMPLETED turn's subagent tail from filling the SDK's 100-slot buffer and
        stalling the transport. This one handles a turn that never completed. The
        two compose.
        """
        if not self._stream_dirty:
            return
        self._stream_dirty = False
        log_operator(
            "abandoned_stream",
            "previous turn ended without consuming its ResultMessage (Stop); "
            "rebuilding the client so the next turn does not read its tail",
        )
        await self._close_client()
    async def _stop_drain(self) -> None:
        """Hand the SDK stream back before anything else reads it.

        NEVER TWO CONCURRENT READERS, and this is the mechanism.
        `Query.receive_messages` iterates ONE anyio memory object stream, which
        hands each item to exactly one receiver. A drainer still running when
        the next turn starts would steal that turn's messages — including its
        `ResultMessage`, and `handle_turn` waits for that forever. So every path
        about to read the stream calls this first, and it is an explicit
        handoff rather than a hope about scheduling.

        An in-flight item can be lost by cancelling mid-await, and that is
        acceptable here rather than untrue: anyio's `MemoryObjectSendStream`
        pops the waiting receiver, sets `receiver.item` and fires the event
        before returning, so a cancellation landing between that and the
        receiver resuming drops the item. What this task reads it discards
        anyway, so losing one costs nothing. The messages that must not be lost
        are the NEXT turn's, and those have not been sent yet — the handoff
        happens before `query()`.

        THE WAIT IS DELIBERATELY UNBOUNDED. A slow iterator teardown therefore
        delays the next turn before `client.query()`, inside the window where
        the UI is spinning with Send disabled. That was raised in review with a
        timeout as the remedy, and a timeout is the wrong trade: giving up on
        the wait means starting the turn with the drainer still attached to the
        stream, which is two readers on one stream — it would take this turn's
        `ResultMessage` and `handle_turn` waits for that forever. A bounded wait
        converts a visible delay into a hang, so the delay stays.
        """
        task, self._drain_task = self._drain_task, None
        if task is None or task.done():
            return
        task.cancel()
        # `gather(..., return_exceptions=True)` rather than `await task` inside a
        # bare `except CancelledError: pass`. That arm could not tell the task we
        # just cancelled ending from THIS COROUTINE being cancelled, so it
        # swallowed the caller's cancellation and let the turn run on: `serve`
        # cancels `turn_task` when `interrupt()` raises, and on stdin EOF, and a
        # dropped Stop there means `_run_turn` never emits `(stopped)` and the
        # turn proceeds into `client.query(text)`. Here the task's own
        # CancelledError comes back as a RESULT, so the only thing that can raise
        # out of this await is a cancellation aimed at us — which must propagate.
        (outcome,) = await asyncio.gather(task, return_exceptions=True)
        if isinstance(outcome, Exception):  # best-effort teardown
            _log(f"[agent] background drain ended with an error (ignored): {outcome}")

    async def _drain_background(self, client) -> None:
        """Keep the SDK stream read while background subagents are still writing.

        WHY THIS EXISTS (issue #1915). Background subagents keep streaming after
        the parent turn ends — the SDK holds stdin open for exactly that. Those
        messages land in a stream with `max_buffer_size=100`
        (`claude_agent_sdk/_internal/query.py`), and with
        `include_partial_messages=True` and several subagents emitting thinking
        and text deltas, 100 slots fill in seconds. Once full, the SDK's
        transport read loop blocks on `await self._message_send.send(message)`.
        That same loop is what dispatches the CLI's `control_request` frames, so
        every PreToolUse callback goes unanswered and the CLI times each one
        out. The session then cannot run ANY tool call — a live session died
        this way with a purely local `ToolSearch` timing out at 600s.

        WHAT IT DOES WITH WHAT IT READS: discards it, after an operator log
        line. Delivering these events to the browser was considered and
        deferred — it would extend this change into `runner.py`,
        `sandbox_server.py` and `apps/web`, and reopen the
        one-`turn_done`-per-turn contract that `_run_turn` owns. The contract is
        real — `_run_turn` emits it unconditionally at the end and its own
        docstring says "exactly one" — but `test_runner_interrupt.py` does not
        pin it: that file asserts `events[-1] == {"kind": "turn_done"}` three
        times, which is "ends with", and carries no count assertion. This
        citation said "pins" and was inherited from the issue; corrected in
        review rather than left to imply coverage that is not there. The user-visible half stays with issue
        #1971 (a wedged session and a finished turn look identical) and issue
        #1125. Recorded in docs/specs/hosted-web-workbench-spec.md §7.

        IT RUNS OUTSIDE THE TURN, deliberately. Draining inside `handle_turn`
        would hold that generator open, and `runner.serve` drops any `user_msg`
        while the turn task is alive — leaving the UI spinning and Send disabled
        until the last subagent finished, which is the symptom the reporter
        filed rather than a fix for it.
        """
        dropped = 0
        # Held in a name so the close below is explicit rather than implicit.
        #
        # NO TEST DETECTS REMOVING THAT CLOSE, and the comment here used to claim
        # one did — it cited test_the_next_turn_loses_none_of_its_own_messages as
        # having measured two readers live on one stream without it. Checked in
        # review: deleting the `aclose()` leaves the whole suite green. Probed
        # afterwards to find out why, rather than just dropping the claim:
        # cancelling this task throws CancelledError INTO the generator at its
        # await point, so the generator's own teardown runs from the cancellation
        # itself and `aclose()` completes as a no-op — it is ordered second in
        # the log. On the paths that exit without a cancellation, `stream` is a
        # local whose last reference drops at return, and CPython's refcounting
        # finalizes it there.
        #
        # So the close is redundant on every path, and it is kept as explicit
        # deterministic teardown rather than as a guard: it costs one await and
        # it stops the correctness of this function depending on refcount timing,
        # which is a CPython implementation detail rather than a language
        # guarantee. It is NOT load-bearing, and nothing should be built on the
        # belief that it is.
        stream = client.receive_messages()
        try:
            async for message in stream:
                # THIS LOOP HAS NO SELF-EXIT, AND THAT IS THE POINT.
                #
                # It used to `break` on `not self._tasks`. That reads a signal
                # which is legitimately zero *between* subagents: t1's terminal
                # message can arrive before t2's TaskStartedMessage, and the
                # drainer stopped on that zero and left the producer to stall at
                # the 100-slot bound — the pre-fix wedge exactly, while the
                # operator line read "0 subagent(s) still running" and looked
                # like success. Caught in review; the original fixture could not
                # see it because it emitted its only task_done last, which made
                # the zero terminal there.
                #
                # There is no reliable "nothing more is coming" signal to read:
                # the buffer's own emptiness is not observable from here. So the
                # lifetime belongs to `_stop_drain`, which every path that is
                # about to read the stream calls, and which is what the handoff
                # test pins.
                try:
                    map_message(message, self._tool_names, self._tasks, self._live_tasks)
                except Exception as exc:
                    # One unmappable message must not end draining. This arm used
                    # to sit outside the loop, so a single failure stopped the
                    # drainer until the next turn ended — which is precisely the
                    # window the wedge lived in.
                    log_operator("background_drain", f"skipped an unmappable message: {exc}")
                dropped += 1
        except asyncio.CancelledError:
            raise  # the handoff in _stop_drain; not an error
        except Exception as exc:
            # A dead STREAM (not a bad message) must not take the session with
            # it: the next turn rebuilds or reuses the client on its own terms.
            log_operator("background_drain", classify(exc), exc=exc)
        finally:
            try:
                await stream.aclose()
            except (asyncio.CancelledError, Exception):
                # Teardown of an iterator we are discarding. Both are swallowed
                # so a close failure cannot mask the reason we are unwinding,
                # and CancelledError is listed because it is a BaseException.
                pass
            if dropped:
                log_operator(
                    "background_drain",
                    f"discarded {dropped} post-turn message(s) from background "
                    f"subagents; {len(self._live_tasks)} subagent(s) still running",
                )

    async def _close_client(self) -> None:
        """Drop the live client. State is cleared FIRST so a disconnect that
        throws can't leave a half-dead client cached for the next turn."""
        # Before the client goes: the drainer is reading its stream.
        await self._stop_drain()
        # And the task state goes with it. The old client's subagents can never
        # emit on the new client's stream, so a surviving id is a phantom that
        # no terminal message will ever clear - the exact failure the
        # TaskUpdatedMessage arm was added to prevent, on a path that arm cannot
        # reach. Raised in review round 2 (item 5).
        self._tasks.clear()
        self._live_tasks.clear()
        # The respawn flag goes with the client. Left set, a close from any path
        # other than the abandoned-stream one costs the NEXT turn a redundant
        # rebuild, which makes the flag mean "maybe dirty" rather than "dirty".
        # Harmless but untrue; raised in review.
        self._stream_dirty = False
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
        # The handoff, and it is FIRST rather than after `_ensure_client`. A
        # drainer from the previous turn is reading this stream and would take
        # this turn's ResultMessage if left running. It used to sit below the
        # block that follows, whose `except` arm ends in a bare `return`, so the
        # `_ensure_client` failure path never reached the handoff at all —
        # against `_stop_drain`'s own contract that every path about to read the
        # stream calls it first. Latent, because that path issues no `query()`;
        # moved rather than argued, since the ordering costs nothing.
        # `_ensure_client` may itself replace the client, and `_close_client`
        # calls `_stop_drain` too — it is idempotent, so calling it here first is
        # strictly safe.
        await self._stop_drain()
        # BEFORE acquiring the client, not after: a turn abandoned mid-flight left
        # its tail in the stream, and this may drop the client so the next
        # `receive_response()` cannot read that instead of this turn's reply.
        await self._handle_abandoned_stream()
        try:
            client = await self._ensure_client()
        except Exception as exc:
            classification = classify(exc)
            log_operator("ensure_client", classification, exc=exc)
            yield _event("error", text=classification)
            return
        try:
            await client.query(text)
            self._stream_dirty = True
            # Whether an errored AssistantMessage has already told the user about
            # this turn. Turn-scoped, not session-scoped: a later turn's failure
            # is a new fact the user needs.
            error_emitted = False
            async for message in client.receive_response():
                for ev in map_message(
                    message, self._tool_names, self._tasks, self._live_tasks
                ):
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
                    # This turn read its own terminal frame, so the stream owes
                    # nothing and the next turn can reuse the client.
                    self._stream_dirty = False
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

        # Subagents outlive the turn. Hand the stream to a background drainer so
        # the SDK's 100-slot buffer cannot fill and stall the transport read loop
        # that answers hook callbacks — see _drain_background.
        #
        # AFTER the loop, never inside it: this generator has to finish so the
        # runner emits its single `turn_done` and the UI stops being busy.
        #
        # What happens on Stop, corrected in review — the previous comment here
        # was wrong in both halves. `serve` cancels `turn_task` only when
        # `agent.interrupt()` returns falsy or raises; on the ordinary Stop it
        # returns True, nothing is cancelled, this generator completes normally,
        # and a drainer DOES start. That is the right outcome rather than an
        # accident: Stop ends the parent turn, and background subagents keep
        # streaming regardless, which is the whole reason this drainer exists.
        # And on the path that genuinely does abandon the generator, nothing
        # closes the client — `_close_client` has exactly one production caller,
        # the key-rotation rebuild in `_ensure_client`.
        # NOT gated on `self._live_tasks`, and that is the round-2 fix.
        #
        # Sampling liveness ONCE to decide whether to start is the last remnant
        # of the pattern removed from the loop above, and it fails in both
        # orderings. A terminal `task_updated` arriving INSIDE the turn clears
        # the set before this line runs, so no drainer starts while that
        # subagent's notification and deltas are still queued; measured on the
        # bounded fake, `produced=103 of 154` against `154 of 154` once the
        # condition is dropped. A `TaskStartedMessage` arriving AFTER the
        # `ResultMessage` has the same shape from the other side: `101 of 152`.
        # Both are the #1915 wedge, and what they strand is the completion prose
        # the issue is about.
        #
        # So the lifetime belongs entirely to `_stop_drain`: start unconditionally
        # while a client exists, and let the handoff end it. A drainer with
        # nothing to read costs one idle task awaiting a stream, and every path
        # that reads the stream hands it off first. The property to assert is
        # that the drainer is always handed off, never that it is sometimes not
        # started.
        if self._client is not None:
            self._drain_task = asyncio.create_task(self._drain_background(self._client))

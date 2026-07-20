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
docs/plan/ably-realtime-migration.md is unrelated; the resume contract is
sandbox-provider-interface.md decision #1.

Config (build_options) — two load-bearing choices: do NOT set skills="all" (the
SDK turns it into `--allowedTools Skill`, restricting to only the Skill tool);
append the project path via system_prompt so the agent reads research.json from
cwd, not HOME.

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
import sys
from collections.abc import AsyncIterator
from pathlib import Path

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
    from claude_agent_sdk import ClaudeAgentOptions

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
        setting_sources=["user", "project"],
        plugins=[{"type": "local", "path": _PLUGIN_DIR}],
        mcp_servers={
            "genealogy": {"type": "stdio", "command": "node", "args": [_MCP_BUILD]},
        },
        # ENABLE_TOOL_SEARCH=true eager-loads the genealogy MCP tool schemas
        # instead of deferring them above the bundled CLI's token threshold
        # (the ~38-tool server trips it), which otherwise forces repeated
        # ToolSearch re-discovery mid-session. See speedup plan §3a — kept in
        # sync with the e2e orchestrator so hosted-web users get the same win.
        env={
            "ANTHROPIC_API_KEY": current_api_key() if api_key is None else api_key,
            "ENABLE_TOOL_SEARCH": "true",
        },
    )
    if resume:
        kwargs["resume"] = resume  # reload the prior conversation transcript
    return ClaudeAgentOptions(**kwargs)


def map_message(message, tool_names: dict[str, str]) -> list[dict]:
    from claude_agent_sdk import (
        AssistantMessage,
        TextBlock,
        ThinkingBlock,
        ToolResultBlock,
        ToolUseBlock,
        UserMessage,
    )

    out: list[dict] = []
    if isinstance(message, AssistantMessage):
        for block in message.content:
            if isinstance(block, TextBlock):
                out.append(_event("text", text=block.text))
            elif isinstance(block, ThinkingBlock):
                out.append(_event("thinking", text=getattr(block, "thinking", "")))
            elif isinstance(block, ToolUseBlock):
                tool_names[getattr(block, "id", "")] = block.name  # for the matching tool_result
                out.append(_event("tool_use", tool=block.name, summary=_tool_summary(getattr(block, "input", None))))
    elif isinstance(message, UserMessage):
        # Tool results come back as a UserMessage of ToolResultBlock(s); tag each
        # with the originating tool's name so the UI can mark that chip done.
        for block in (message.content if isinstance(message.content, list) else []):
            if isinstance(block, ToolResultBlock):
                name = tool_names.get(getattr(block, "tool_use_id", ""), "tool")
                out.append(_event("tool_result", tool=name, summary=_result_summary(getattr(block, "content", None))))
    return out


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
        # Running cumulative cost/usage last seen from the SDK, so we can emit
        # per-turn deltas (see _usage_delta). The SDK's ResultMessage reports
        # session totals, not per-turn values.
        self._cum_cost = 0.0
        self._cum_in = 0
        self._cum_out = 0
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
                self._session_file.write_text(sid)
            except OSError:
                pass

    async def handle_turn(self, text: str) -> AsyncIterator[dict]:
        try:
            from claude_agent_sdk import ResultMessage
        except ImportError:
            yield _event("error", text="claude-agent-sdk not installed; use AGENT_MODE=mock")
            return
        try:
            client = await self._ensure_client()
        except Exception as exc:
            yield _event("error", text=f"Failed to start the agent: {exc}")
            return
        try:
            await client.query(text)
            async for message in client.receive_response():
                for ev in map_message(message, self._tool_names):
                    yield ev
                if isinstance(message, ResultMessage):
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
            yield _event("error", text=f"Agent error: {exc}")

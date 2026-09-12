#!/usr/bin/env python3
"""P1 cross-process resume probe — one Agent SDK turn per process.

Contract: `PLAN.md` at the repo root ("apps/server/dev/p1/driver.py"), which
implements "P1. Cross-process resume" of `docs/plan/search-agent-prototype.md`.

Drives ONE turn (`--mode turn`) or ONE resumed turn (`--mode resume`) through
`ClaudeSDKClient` with a Postgres-backed `SessionStore` (`dev.p1.session_store`),
prints one JSONL line per SDK message to stdout (flushed, so a harness reading
the pipe sees every line before a SIGKILL lands), and writes an evidence JSON at
the end — rewritten as `<evidence>.partial` after EVERY message so a killed
driver still leaves usable evidence.

Run from `apps/server`:

    uv run python -m dev.p1.driver --mode turn --project <dir> --evidence <path>
    uv run python -m dev.p1.driver --mode resume --session-id <sid> --project <dir> \
        --evidence <path> --namespace <same as the turn>

`dev.p1.kill_resume` is the harness that launches this in its own process group,
kills it at a chosen marker, and resumes it in a second process.

JSONL vocabulary (one object per line, all carrying no newline):
    {"ev":"init", "session_id", "agents", "registered_commands", "config_dir",
                  "materialized_config_dir", "mode"}
    {"ev":"msg", "cls", "subtype", "parent", "blocks":[...], "ts"[, "session_id"]}
    {"ev":"delegation_started"}            once, first subagent-attributed message
                                           or first main-thread Task/Agent tool_use
    {"ev":"subagent_first_delta"}          once, first StreamEvent with a parent
    {"ev":"extraction_append_tool_use", "id", "input_sha256"}
    {"ev":"extraction_append_tool_result", "tool_use_id", "is_error"}
    {"ev":"pretool", "tool_name", "tool_use_id", "agent_id", "agent_type",
                     "input_sha256", "ts"}  (from the PreToolUse logging hook —
                                           the CLI has committed to dispatching)
    {"ev":"store", "store", "session_id", "subpath", "n", "ts"}   (from PgSessionStore)

``--config-dir`` is the CLI's ``CLAUDE_CONFIG_DIR`` for a ``turn``. On ``resume``
the SDK overrides it: ``materialize_resume_session`` loads the transcript from
the store into its own ``mkdtemp("claude-resume-")`` and ``apply_materialized_options``
points the CLI there, so the resumed transcript lives under
``materialized_config_dir`` (recorded in the evidence and the init line) and
``--config-dir`` serves only as the source the SDK copies auth files from.

Exit codes: 0 on a ResultMessage, 2 on any exception (traceback on stderr).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
import tempfile
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# /repo/apps/server/dev/p1/driver.py -> parents[2] = apps/server
SERVER_DIR = Path(__file__).resolve().parents[2]
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from dev.p1.options import HOLD_AFTER_ENV, HOLD_ENV, api_key  # noqa: E402 - needs SERVER_DIR on sys.path

DEFAULT_DSN = "postgresql://postgres:p1@127.0.0.1:5433/p1"
DEFAULT_NAMESPACE = "p1"
DEFAULT_MODEL = "claude-sonnet-4-6"

# The ut_record_extraction_001 user message, prefixed so the record-extraction
# skill delegates to @plugin:record-extractor, whose write is extraction_append.
FIXTURE_MESSAGE = (
    "Use the record-extraction skill. "
    "Extract assertions from this 1850 census record for the Thomas Flynn "
    "household in Schuylkill County: Thomas Flynn, age 32, male, born Ireland, "
    "miner; Mary Flynn, age 28, female, born Ireland; Patrick Flynn, age 5, "
    "male, born Ireland."
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def emit(obj: dict[str, Any]) -> None:
    """One JSONL line on stdout, flushed — the harness reads these live."""
    print(json.dumps(obj, ensure_ascii=False, default=str), flush=True)


class _WarningCapture(logging.Handler):
    """Capture WARNING+ records on the claude_agent_sdk logger tree.

    The mirror batcher reports a dropped frame with
    `logger.warning("[SessionStore] dropping mirror frame: …")` on
    `claude_agent_sdk._internal.transcript_mirror_batcher`; a dropped frame is
    exactly the evidence P1 must not miss.
    """

    def __init__(self, sink: list[dict[str, Any]]) -> None:
        super().__init__(level=logging.WARNING)
        self.sink = sink

    def emit(self, record: logging.LogRecord) -> None:  # noqa: D401 - Handler API
        try:
            self.sink.append(
                {"logger": record.name, "level": record.levelname, "msg": record.getMessage()}
            )
        except Exception:  # noqa: BLE001 - a logging handler must never raise
            pass


def read_research(project: Path) -> dict[str, Any]:
    """Counts and ids from <project>/research.json; tolerant of a missing file."""
    path = project / "research.json"
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return {"sources": 0, "assertions": 0, "assertion_ids": [], "source_ids": [],
                "error": f"{type(exc).__name__}: {exc}"}
    sources = doc.get("sources") or []
    assertions = doc.get("assertions") or []
    return {
        "sources": len(sources),
        "assertions": len(assertions),
        "assertion_ids": [a.get("id") for a in assertions if isinstance(a, dict)],
        "source_ids": [s.get("id") for s in sources if isinstance(s, dict)],
    }


def atomic_write_json(path: Path, doc: dict[str, Any]) -> None:
    """Write via a sibling temp file + os.replace so a SIGKILL mid-write leaves
    the previous complete document, never a truncated one."""
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(doc, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    os.replace(tmp, path)


class Driver:
    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.project = Path(args.project).resolve()
        self.evidence_path = Path(args.evidence).resolve()
        self.partial_path = self.evidence_path.with_name(self.evidence_path.name + ".partial")
        self.config_dir = Path(args.config_dir).resolve() if args.config_dir else Path(
            tempfile.mkdtemp(prefix="p1-cfg-")
        )
        # Resume only: the SDK's own CLAUDE_CONFIG_DIR for the CLI (see docstring).
        self.materialized_config_dir: str | None = None
        self.session_id: str | None = args.session_id
        self.started = now_iso()
        self.finished: str | None = None
        self.registered_agents: list[str] = []
        self.registered_commands: int = 0
        self.tool_uses: list[dict[str, Any]] = []
        self.tool_results: list[dict[str, Any]] = []
        self.hook_log: list[dict[str, Any]] = []
        self.warnings: list[dict[str, Any]] = []
        self.result: dict[str, Any] | None = None
        self.final_text: str | None = None
        self.store: Any = None
        # marker state
        self._delegation_started = False
        self._subagent_first_delta = False
        self._extraction_ids: set[str] = set()
        self._last_main_text: str | None = None
        self._last_any_text: str | None = None

    # ── evidence ────────────────────────────────────────────────────────

    def evidence(self) -> dict[str, Any]:
        store = self.store
        return {
            "mode": self.args.mode,
            "session_id": self.session_id,
            "message": self.args.message,
            "config_dir": str(self.config_dir),
            "materialized_config_dir": self.materialized_config_dir,
            "project": str(self.project),
            "model": self.args.model,
            "registered_agents": self.registered_agents,
            "registered_commands": self.registered_commands,
            "tool_uses": self.tool_uses,
            "tool_results": self.tool_results,
            "hook_log": self.hook_log,
            "store_calls": dict(getattr(store, "calls", {}) or {}),
            "store_events": list(getattr(store, "events", []) or []),
            "warnings": self.warnings,
            "result": self.result,
            "final_text": self.final_text,
            "research": read_research(self.project),
            "started": self.started,
            "finished": self.finished,
        }

    def write_partial(self) -> None:
        atomic_write_json(self.partial_path, self.evidence())

    def write_final(self) -> None:
        self.finished = now_iso()
        doc = self.evidence()
        atomic_write_json(self.partial_path, doc)
        atomic_write_json(self.evidence_path, doc)

    # ── message handling ────────────────────────────────────────────────

    def _blocks(self, msg: Any, parent: str | None, ts: str, sha: Any) -> list[dict[str, Any]]:
        from claude_agent_sdk import (
            AssistantMessage,
            TextBlock,
            ThinkingBlock,
            ToolResultBlock,
            ToolUseBlock,
            UserMessage,
        )

        out: list[dict[str, Any]] = []
        if not isinstance(msg, (AssistantMessage, UserMessage)):
            return out
        content = msg.content
        if isinstance(content, str):
            out.append({"type": "text", "len": len(content)})
            return out
        for block in content:
            if isinstance(block, ToolUseBlock):
                digest = sha(block.input)
                preview = json.dumps(block.input, ensure_ascii=False, default=str)[:200]
                out.append({"type": "tool_use", "id": block.id, "name": block.name,
                            "input_sha256": digest, "input_preview": preview})
                self.tool_uses.append({"id": block.id, "name": block.name, "parent": parent,
                                       "input_sha256": digest, "input_preview": preview,
                                       "ts": ts})
            elif isinstance(block, ToolResultBlock):
                out.append({"type": "tool_result", "tool_use_id": block.tool_use_id,
                            "is_error": bool(block.is_error)})
                self.tool_results.append({"tool_use_id": block.tool_use_id,
                                          "is_error": bool(block.is_error)})
            elif isinstance(block, TextBlock):
                out.append({"type": "text", "len": len(block.text)})
                if isinstance(msg, AssistantMessage) and block.text.strip():
                    self._last_any_text = block.text
                    if parent is None:
                        self._last_main_text = block.text
            elif isinstance(block, ThinkingBlock):
                out.append({"type": "thinking"})
            else:
                out.append({"type": type(block).__name__})
        return out

    def _markers(self, msg: Any, parent: str | None, blocks: list[dict[str, Any]]) -> None:
        from claude_agent_sdk import StreamEvent

        main_task = any(
            b["type"] == "tool_use" and b["name"] in ("Task", "Agent")
            for b in blocks
        ) and parent is None
        if not self._delegation_started and (parent is not None or main_task):
            self._delegation_started = True
            emit({"ev": "delegation_started"})
        if not self._subagent_first_delta and isinstance(msg, StreamEvent) and parent:
            self._subagent_first_delta = True
            emit({"ev": "subagent_first_delta"})
        for b in blocks:
            if b["type"] == "tool_use" and b["name"].endswith("extraction_append"):
                self._extraction_ids.add(b["id"])
                emit({"ev": "extraction_append_tool_use", "id": b["id"],
                      "input_sha256": b["input_sha256"]})
            elif b["type"] == "tool_result" and b["tool_use_id"] in self._extraction_ids:
                emit({"ev": "extraction_append_tool_result",
                      "tool_use_id": b["tool_use_id"], "is_error": b["is_error"]})

    def _on_result(self, msg: Any) -> None:
        self.result = {
            "session_id": msg.session_id,
            "subtype": msg.subtype,
            "is_error": bool(msg.is_error),
            "num_turns": msg.num_turns,
            "duration_ms": msg.duration_ms,
            "total_cost_usd": msg.total_cost_usd,
            "usage": msg.usage,
        }
        if msg.session_id:
            self.session_id = msg.session_id
        self.final_text = self._last_main_text or self._last_any_text or msg.result

    # ── the turn ────────────────────────────────────────────────────────

    async def run(self) -> int:
        from claude_agent_sdk import ClaudeSDKClient, ResultMessage, SystemMessage
        from dev.p1.options import build_prototype_options, canonical_input_sha256
        from dev.p1.session_store import PgSessionStore

        key = api_key()
        if not key:
            raise RuntimeError("no ANTHROPIC_API_KEY in env or eval/.env")

        extra_env: dict[str, str] = {}
        if self.args.hold_ms is not None:
            # Both: the CLI child inherits os.environ and merges options.env, and
            # the engine (its stdio MCP child) reads the variable off its own env.
            os.environ[HOLD_ENV] = str(self.args.hold_ms)
            extra_env[HOLD_ENV] = str(self.args.hold_ms)
        if self.args.hold_after_ms is not None:
            os.environ[HOLD_AFTER_ENV] = str(self.args.hold_after_ms)
            extra_env[HOLD_AFTER_ENV] = str(self.args.hold_after_ms)

        self.store = PgSessionStore(
            self.args.dsn, self.args.namespace,
            on_event=lambda e: emit({"ev": "store", **e}),
        )
        await self.store.ensure_schema()

        options = build_prototype_options(
            self.project,
            api_key=key,
            store=self.store,
            config_dir=self.config_dir,
            resume=self.session_id if self.args.mode == "resume" else None,
            model=self.args.model,
            extra_env=extra_env or None,
            hook_log=self.hook_log,
            hook_emit=emit,
        )

        client = ClaudeSDKClient(options=options)
        await client.connect()
        try:
            # Private SDK state, read defensively: set by connect() in resume
            # mode when the store had entries, cleared again by disconnect().
            materialized = getattr(client, "_materialized", None)
            mat_dir = getattr(materialized, "config_dir", None)
            self.materialized_config_dir = str(mat_dir) if mat_dir is not None else None
            info = await client.get_server_info() or {}
            self.registered_agents = sorted(
                a["name"] for a in info.get("agents", []) if isinstance(a, dict) and "name" in a
            )
            self.registered_commands = len(info.get("commands", []) or [])
            emit({"ev": "init", "session_id": self.session_id,
                  "agents": self.registered_agents,
                  "registered_commands": self.registered_commands,
                  "config_dir": str(self.config_dir),
                  "materialized_config_dir": self.materialized_config_dir,
                  "mode": self.args.mode})
            self.write_partial()

            await client.query(self.args.message)
            saw_result = False
            async for msg in client.receive_response():
                ts = now_iso()
                parent = getattr(msg, "parent_tool_use_id", None)
                sid = getattr(msg, "session_id", None)
                if sid is None and isinstance(msg, SystemMessage):
                    sid = msg.data.get("session_id")
                if sid and not self.session_id:
                    self.session_id = sid
                blocks = self._blocks(msg, parent, ts, canonical_input_sha256)
                line: dict[str, Any] = {
                    "ev": "msg",
                    "cls": type(msg).__name__,
                    "subtype": getattr(msg, "subtype", None),
                    "parent": parent,
                    "blocks": blocks,
                    "ts": ts,
                }
                if sid:
                    line["session_id"] = sid
                emit(line)
                self._markers(msg, parent, blocks)
                if isinstance(msg, ResultMessage):
                    self._on_result(msg)
                    saw_result = True
                self.write_partial()
            if not saw_result:
                raise RuntimeError("message stream ended without a ResultMessage")
        finally:
            await client.disconnect()
        self.write_final()
        return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m dev.p1.driver",
        description="P1 resume probe: drive ONE Agent SDK turn (or resumed turn) "
                    "against a Postgres SessionStore, streaming JSONL evidence.",
    )
    p.add_argument("--mode", choices=["turn", "resume"], required=True)
    p.add_argument("--session-id", default=None, help="resume only: the session to resume")
    p.add_argument("--project", required=True, help="a seeded project directory (research.json + tree)")
    p.add_argument("--message", default=FIXTURE_MESSAGE,
                   help="user message; in resume mode the default is the SAME message "
                        "(an SQS redelivery replays it)")
    p.add_argument("--dsn", default=os.environ.get("P1_PG_DSN") or DEFAULT_DSN)
    p.add_argument("--namespace", default=DEFAULT_NAMESPACE)
    p.add_argument("--config-dir", default=None,
                   help="CLAUDE_CONFIG_DIR for the CLI child (default: fresh mkdtemp('p1-cfg-'); printed)")
    p.add_argument("--evidence", required=True,
                   help="evidence JSON path; also rewritten as PATH.partial after every message")
    p.add_argument("--hold-ms", type=int, default=None,
                   help=f"sets {HOLD_ENV}=N so the engine holds extraction_append before its commit")
    p.add_argument("--hold-after-ms", type=int, default=None,
                   help=f"sets {HOLD_AFTER_ENV}=N so the engine holds extraction_append after its commit")
    p.add_argument("--model", default=DEFAULT_MODEL)
    return p


def main(argv: list[str] | None = None) -> int:
    # House pattern: a Windows console defaults to cp1252.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    args = build_parser().parse_args(argv)
    if args.mode == "resume" and not args.session_id:
        build_parser().error("--mode resume requires --session-id")
    if args.mode == "turn" and args.session_id:
        build_parser().error("--session-id is only meaningful with --mode resume")

    driver = Driver(args)
    sdk_logger = logging.getLogger("claude_agent_sdk")
    sdk_logger.addHandler(_WarningCapture(driver.warnings))
    if sdk_logger.level == logging.NOTSET or sdk_logger.level > logging.WARNING:
        sdk_logger.setLevel(logging.WARNING)

    try:
        return asyncio.run(driver.run())
    except BaseException:  # noqa: BLE001 - the exit code is the report
        traceback.print_exc(file=sys.stderr)
        try:
            driver.write_partial()
        except Exception:  # noqa: BLE001 - evidence is best-effort here
            pass
        return 2


if __name__ == "__main__":
    sys.exit(main())

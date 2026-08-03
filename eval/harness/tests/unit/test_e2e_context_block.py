"""Unit tests for the e2e main-thread `extraction_append` block (#942).

`extraction_append` is the record-extractor subagent's private writer — no
skill declares it. On the main thread it is the router substituting for a failed
spawn and doing the extraction itself (observed in production). The e2e
orchestrator denies it there, mirroring the tree-read block, while leaving the
subagent's own call (which carries `agent_id`) untouched.

This is the one member of `context_policy.SUBAGENT_ONLY_TOOLS` e2e can enforce:
`image_read` stays unit-only (a legitimate in-session `search-images` browse is
indistinguishable from a violation), but that caveat does not transfer here —
no skill declares `extraction_append`, so `agent_id` presence alone
discriminates. See `e2e-test-spec.md` §6.1.1.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from claude_agent_sdk import ResultMessage, SystemMessage

from e2e import orchestrator
from e2e.orchestrator import (
    _run_agent,
    is_main_thread_extraction_append,
    load_fixture,
)


def _main(tool_name: str) -> dict:
    """A PreToolUse firing on the main thread: no `agent_id` key at all."""
    return {"tool_name": tool_name, "tool_input": {}}


def _sub(tool_name: str) -> dict:
    """A firing from inside a Task-spawned subagent: `agent_id` present."""
    return {"tool_name": tool_name, "tool_input": {}, "agent_id": "agent-abc123"}


def test_main_thread_extraction_append_is_blocked():
    assert (
        is_main_thread_extraction_append(_main("mcp__genealogy__extraction_append"))
        is True
    )


def test_subagent_extraction_append_is_not_blocked():
    """The record-extractor's own call carries `agent_id` — the legitimate path."""
    assert (
        is_main_thread_extraction_append(_sub("mcp__genealogy__extraction_append"))
        is False
    )


def test_remote_devices_spelling_is_also_blocked_on_main():
    """Discriminate on the bare name, so the bridge spelling is caught too."""
    assert (
        is_main_thread_extraction_append(
            _main("mcp__remote-devices__Genealogy_Research__extraction_append")
        )
        is True
    )


def test_other_mcp_tools_on_main_are_not_blocked():
    """Only extraction_append is guarded here — image_read stays unit-only, and
    ordinary research tools must pass through untouched."""
    for name in (
        "mcp__genealogy__image_read",
        "mcp__genealogy__record_read",
        "mcp__genealogy__research_append",
        "mcp__genealogy__record_search",
    ):
        assert is_main_thread_extraction_append(_main(name)) is False


def test_non_mcp_tools_are_never_blocked():
    """Baseline tools (Read, Skill, Task, …) are not candidates. The bare,
    unqualified `extraction_append` is here on purpose: the `mcp__` prefix guard
    means a name without a server prefix is never matched — only the genuine
    `mcp__…__extraction_append` call the router would actually emit is blocked."""
    for name in ("Read", "Skill", "Task", "extraction_append"):
        assert is_main_thread_extraction_append(_main(name)) is False


def test_missing_tool_name_does_not_raise():
    """A malformed input must fail closed to 'not blocked', never crash the hook."""
    assert is_main_thread_extraction_append({}) is False


# --- integration: the recording path through the real hook closure ----------
#
# The predicate tests above prove the DECISION. This drives `_run_agent`'s
# actual `pretool_hook` closure via a mocked SDK `query` (the pattern
# test_e2e_stall_resume.py uses) and asserts the denial is DENIED and RECORDED
# into the `blocked_context_calls` list threaded out of `_run_agent`. Without
# this, dropping the recording (or threading the wrong variable out of the
# tuple) would silently leave the list empty and no test would catch it — the
# gap the review flagged. It does not reach the `E2eResult(...)` constructor
# (that is `run_e2e_test`, covered only by a live e2e suite run), so the final
# `blocked_context_calls=` kwarg remains covered-by-inspection, exactly as
# `blocked_tree_reads` is.


def _fixture(tmp_path: Path):
    """A minimal valid fixture on disk, loaded via the real `load_fixture`."""
    fixture_dir = tmp_path / "fx"
    fixture_dir.mkdir()
    (fixture_dir / "fixture.json").write_text(
        json.dumps(
            {
                "id": "fx",
                "name": "fx",
                "source_pid": "ABCD-123",
                "captured": "2026-05-26",
                "researcher_question": "Who were John's parents?",
                "tags": {"question_type": "parents", "era": "1850s", "geography": "US-VA"},
                "model": {"agent": "claude-sonnet-4-6", "judge": "claude-haiku-4-5-20251001"},
                "caps": {},
            }
        ),
        encoding="utf-8",
    )
    (fixture_dir / "starting-research.json").write_text(
        json.dumps({"project": {"objective": "x"}}), encoding="utf-8"
    )
    (fixture_dir / "starting-tree.gedcomx.json").write_text(
        json.dumps({"persons": []}), encoding="utf-8"
    )
    (fixture_dir / "expected-findings.json").write_text(
        json.dumps({"findings": []}), encoding="utf-8"
    )
    return load_fixture(fixture_dir)


class _HookDrivingAgen:
    """An async message stream that first drives the registered PreToolUse hook
    with scripted inputs (recording each return payload into `sink`), then
    yields its messages so `_run_agent` completes normally."""

    def __init__(self, hook, hook_inputs, messages, sink):
        self._hook = hook
        self._hook_inputs = hook_inputs
        self._messages = messages
        self._sink = sink
        self._started = False
        self._i = 0

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self._started:
            self._started = True
            for label, inp in self._hook_inputs:
                self._sink[label] = await self._hook(inp, "tool-use-id", None)
        if self._i >= len(self._messages):
            raise StopAsyncIteration
        msg = self._messages[self._i]
        self._i += 1
        return msg

    async def aclose(self):
        return None


def test_main_thread_extraction_append_is_denied_and_recorded(tmp_path, monkeypatch):
    sink: dict = {}

    def fake_query(**kw):
        hook = kw["options"].hooks["PreToolUse"][0].hooks[0]
        inputs = [
            (
                "main",
                {
                    "tool_name": "mcp__genealogy__extraction_append",
                    "tool_input": {"assertions": [], "sources": []},
                },
            ),
            (
                "sub",
                {
                    "tool_name": "mcp__genealogy__extraction_append",
                    "tool_input": {"assertions": []},
                    "agent_id": "agent-record-extractor",
                },
            ),
        ]
        return _HookDrivingAgen(
            hook,
            inputs,
            [SystemMessage(subtype="init", data={"session_id": "S1"}), _result()],
            sink,
        )

    monkeypatch.setattr(orchestrator, "query", fake_query)
    result = asyncio.run(
        _run_agent(fixture=_fixture(tmp_path), workspace=tmp_path, mcp_server_entry=Path("dummy"))
    )
    aborted_reason = result[3]
    blocked_context_calls = result[6]

    assert aborted_reason is None  # completed cleanly, not aborted

    # The main-thread call was DENIED...
    assert (
        sink["main"]["hookSpecificOutput"]["permissionDecision"] == "deny"
    )
    # ...and RECORDED, threaded out of _run_agent at the right tuple position.
    assert len(blocked_context_calls) == 1
    assert blocked_context_calls[0]["tool"] == "extraction_append"
    assert blocked_context_calls[0]["blocked_by"] == "context"
    assert blocked_context_calls[0]["args"] == {"assertions": [], "sources": []}

    # The subagent's own call (carries agent_id) was NOT denied and NOT recorded
    # — the legitimate record-extractor path stays open.
    assert sink["sub"] == {}


def _result(session="S1"):
    return ResultMessage(
        subtype="result",
        duration_ms=1,
        duration_api_ms=1,
        is_error=False,
        num_turns=1,
        session_id=session,
    )

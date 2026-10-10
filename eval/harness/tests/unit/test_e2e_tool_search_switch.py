"""The e2e `--no-tool-search` switch (T1.6): what reaches the CLI, what the run
log records, and the refusal that keeps an off run out of the default root.

Two halves. `_run_agent` is driven through a mocked SDK `query` (the
`test_e2e_context_block.py` idiom), so these read the real `ClaudeAgentOptions`
and the real `usage` dict — no API call, no key. `run_e2e.main` is driven with
`_run_one` stubbed (the `test_e2e_judge_key_preflight.py` idiom), so the
refusal is tested at the call site, before anything is spent.
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

import pytest

from claude_agent_sdk import SystemMessage

from e2e import orchestrator, run_e2e
from e2e.orchestrator import DEFAULT_RUNLOG_ROOT, _run_agent
from e2e.result import E2eResult
from harness.auth import AuthConfig
from tests.unit.test_e2e_context_block import _fixture, _result


# --- _run_agent: env, tool_search_offered, cli_version ----------------------


class _Stream:
    def __init__(self, messages):
        self._messages = list(messages)

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self._messages:
            raise StopAsyncIteration
        return self._messages.pop(0)

    async def aclose(self):
        return None


def _drive(tmp_path, monkeypatch, init_data, **kwargs):
    """Run `_run_agent` over one init message and a clean result. Returns
    (options handed to `query`, usage, narration)."""
    monkeypatch.setattr(
        orchestrator,
        "resolve_auth",
        lambda: AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
    )
    seen: dict = {}

    def fake_query(**kw):
        seen["options"] = kw["options"]
        return _Stream([SystemMessage(subtype="init", data=init_data), _result()])

    monkeypatch.setattr(orchestrator, "query", fake_query)
    result = asyncio.run(
        _run_agent(
            fixture=_fixture(tmp_path),
            workspace=tmp_path,
            mcp_server_entry=Path("dummy"),
            **kwargs,
        )
    )
    return seen["options"], result[2], result[1]


def test_no_tool_search_reaches_the_cli_as_false(tmp_path, monkeypatch):
    options, _usage, _ = _drive(tmp_path, monkeypatch, {"session_id": "S1"}, tool_search=False)
    assert options.env["ENABLE_TOOL_SEARCH"] == "false"


def test_the_default_still_runs_with_tool_search_on(tmp_path, monkeypatch):
    options, _usage, _ = _drive(tmp_path, monkeypatch, {"session_id": "S1"})
    assert options.env["ENABLE_TOOL_SEARCH"] == "true"


@pytest.mark.parametrize(
    "init_tools, offered",
    [
        (["Task", "Read", "Skill"], False),  # the 25-tool list, ToolSearch absent
        (["Task", "Read", "Skill", "ToolSearch"], True),
        (None, None),  # no `tools` key on the init message
    ],
)
def test_tool_search_offered_reads_the_first_init_list(tmp_path, monkeypatch, init_tools, offered):
    data = {"session_id": "S1"}
    if init_tools is not None:
        data["tools"] = init_tools
    _options, usage, _ = _drive(tmp_path, monkeypatch, data)
    assert usage["tool_search_offered"] is offered


def test_cli_version_is_read_from_claude_code_version(tmp_path, monkeypatch):
    """2.1.139's init spells it `claude_code_version`; the run log had `null` on
    every run that predates this read."""
    _options, usage, _ = _drive(
        tmp_path, monkeypatch, {"session_id": "S1", "claude_code_version": "2.1.139"}
    )
    assert usage["cli_version"] == "2.1.139"


@pytest.mark.parametrize("tool_search, inactive", [(True, False), (False, True)])
def test_the_inconclusive_init_note_says_when_the_backstop_is_inactive(
    tmp_path, monkeypatch, tool_search, inactive
):
    _options, _usage, narration = _drive(
        tmp_path,
        monkeypatch,
        {"session_id": "S1", "mcp_servers": [{"name": "genealogy", "status": "pending"}]},
        tool_search=tool_search,
    )
    notes = [n["text"] for n in narration if n.get("kind") == "harness"]
    assert len(notes) == 1, notes
    assert ("backstop is inactive" in notes[0]) is inactive
    assert ("backstop covers it" in notes[0]) is not inactive


# --- run_e2e.main: the flag and the default-root refusal --------------------


def _record_run(monkeypatch):
    calls: list[dict] = []

    async def _fake_run_one(fixture_dir, **kwargs):
        calls.append(kwargs)
        return E2eResult(
            test_id="fx", captured_at="2026-05-26_14-30-45",
            verdict="pass", stop_reason="completed",
        )

    monkeypatch.setattr(run_e2e, "_run_one", _fake_run_one)
    monkeypatch.setattr(run_e2e, "load_env_file", lambda *a, **k: None)
    monkeypatch.setattr(run_e2e, "stage_openrouter_key", lambda *a, **k: None)
    return calls


def _argv(tmp_path, *extra):
    root = tmp_path / "fixtures"
    (root / "fx").mkdir(parents=True, exist_ok=True)
    return ["--test", "fx", "--fixtures-root", str(root), "--skip-judge", *extra]


def _relative_spelling_of_default() -> str:
    """The default root written relative to the current directory, by a path
    that does not textually match it — only resolving both sides equates them."""
    return os.path.relpath(DEFAULT_RUNLOG_ROOT / "x" / "..", Path.cwd())


@pytest.mark.parametrize(
    "root",
    [
        None,  # the default itself
        "relative",  # a relative spelling of the default
        "sub",  # a folder inside the default
    ],
)
def test_no_tool_search_is_refused_under_the_default_root(tmp_path, monkeypatch, capsys, root):
    calls = _record_run(monkeypatch)
    extra = ["--no-tool-search"]
    if root == "relative":
        extra += ["--runlog-root", _relative_spelling_of_default()]
    elif root == "sub":
        extra += ["--runlog-root", str(DEFAULT_RUNLOG_ROOT / "t1.7-off")]
    assert run_e2e.main(_argv(tmp_path, *extra)) == 2
    assert calls == [], "refused runs must not reach the agent"
    assert "RUNLOG_ROOT=" in capsys.readouterr().err


def test_no_tool_search_proceeds_under_a_sibling_root(tmp_path, monkeypatch):
    """The other direction: a root outside the corpus is the sanctioned home,
    including one that merely shares the default's name as a prefix."""
    calls = _record_run(monkeypatch)
    sibling = DEFAULT_RUNLOG_ROOT.parent / (DEFAULT_RUNLOG_ROOT.name + "-scratch")
    for root in (tmp_path / "scratch", sibling):
        assert run_e2e.main(_argv(tmp_path, "--no-tool-search", "--runlog-root", str(root))) == 0
    assert [c["tool_search"] for c in calls] == [False, False]


@pytest.mark.parametrize("extra", [[], ["--tool-search"]])
def test_tool_search_on_proceeds_under_the_default_root(tmp_path, monkeypatch, extra):
    calls = _record_run(monkeypatch)
    assert run_e2e.main(_argv(tmp_path, *extra)) == 0
    assert len(calls) == 1 and calls[0]["tool_search"] is True

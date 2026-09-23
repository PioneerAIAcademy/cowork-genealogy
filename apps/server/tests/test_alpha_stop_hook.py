"""The alpha's Stop hook (research-as-a-job 1d).

Alpha testers are the feedback loop and should not go quiet for weeks while continuous
work lands on the prototype, so the hook is backported. The DECISION is not backported --
it is imported: `continue_policy.should_continue_run` is the same function the prototype
worker binds. What differs is only where the state comes from (research.json off the
sandbox's disk here, the `documents` row on the turn's Postgres connection there).
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from app.agent import real_agent


class FakeMatcher:
    def __init__(self, **kw):
        self.kw = kw


def _hooks(project_dir: Path, monkeypatch, *, max_nudges: int = 60) -> dict:
    monkeypatch.setattr(real_agent, "AUTONOMOUS_MAX_NUDGES", max_nudges)
    return real_agent._build_hooks(FakeMatcher, project_dir)


def _write(project_dir: Path, status: str | None) -> None:
    doc = {} if status is None else {"project": {"status": status}}
    (project_dir / "research.json").write_text(json.dumps(doc), encoding="utf-8")


def _call(hook, payload=None):
    return asyncio.run(hook(payload or {"tool_name": "Read", "tool_input": {}}, "tid", None))


def test_the_stop_hook_is_bound_alongside_the_existing_pretool_hook(tmp_path, monkeypatch):
    hooks = _hooks(tmp_path, monkeypatch)
    assert sorted(hooks) == ["PreToolUse", "Stop"]
    assert hooks["Stop"][0].kw["matcher"] is None, "a Stop has no tool to match on"
    # TWO PreToolUse matchers, and the split is load-bearing. The deny hook keeps the
    # narrow matcher issue #1915 gave it; the COUNTER has to be unscoped (below).
    matchers = [m.kw["matcher"] for m in hooks["PreToolUse"]]
    assert matchers == [None, real_agent._PRETOOL_MATCHER], matchers


def test_the_tool_counter_sees_the_tools_a_research_loop_actually_runs(tmp_path, monkeypatch):
    """The bug this split exists to fix. `_PRETOOL_MATCHER` covers five tool names --
    Write, Edit, NotebookEdit, Bash, device_commit_files -- and a research loop runs
    almost none of them. Counting behind it leaves the count at 0 all run, so at the
    SECOND yield `should_continue_run`'s no-progress arm sees `tool_count == 
    tool_count_at_last_nudge` and ends the job after ONE nudge, mid-research."""
    _write(tmp_path, "active")
    hooks = _hooks(tmp_path, monkeypatch)
    counter_hook = hooks["PreToolUse"][0].kw["hooks"][0]
    stop = hooks["Stop"][0].kw["hooks"][0]

    async def research_step():
        first = await stop({}, None, None)
        # Exactly the calls a GPS step makes, and NOT one the deny matcher covers.
        for tool in ("Skill", "mcp__genealogy__record_search", "Task",
                     "mcp__genealogy__research_append", "Read"):
            assert real_agent._PRETOOL_MATCHER and tool not in real_agent._PRETOOL_MATCHER, tool
            await counter_hook({"tool_name": tool, "tool_input": {}}, "t", None)
        return first, await stop({}, None, None)

    first, second = asyncio.run(research_step())
    assert first["decision"] == "block"
    assert second["decision"] == "block", \
        "the run did five tool calls between the two yields; a counter that missed them ends it here"


def test_a_zero_cap_leaves_the_session_exactly_as_it_was(tmp_path, monkeypatch):
    assert list(_hooks(tmp_path, monkeypatch, max_nudges=0)) == ["PreToolUse"]


def test_it_vetoes_the_yield_while_the_project_is_unfinished(tmp_path, monkeypatch):
    _write(tmp_path, "active")
    stop = _hooks(tmp_path, monkeypatch)["Stop"][0].kw["hooks"][0]
    out = _call(stop)
    assert out["decision"] == "block"
    assert out["reason"] == real_agent.CONTINUE_REASON


def test_it_allows_the_yield_once_the_project_is_complete(tmp_path, monkeypatch):
    _write(tmp_path, "completed")
    stop = _hooks(tmp_path, monkeypatch)["Stop"][0].kw["hooks"][0]
    assert _call(stop) == {}


def test_a_missing_or_unreadable_research_json_is_not_completion(tmp_path, monkeypatch):
    """`read_research_json` returns None for all three, and None is NOT 'completed' -- so
    the run keeps going rather than stopping on a file it could not read."""
    # A FRESH hook per case: a second stop on the same hook with no tool call between
    # them is allowed by the no-progress arm, which would make every case below pass for
    # the wrong reason.
    def first_verdict() -> dict:
        return _call(_hooks(tmp_path, monkeypatch)["Stop"][0].kw["hooks"][0])

    assert first_verdict()["decision"] == "block", "no file at all"
    (tmp_path / "research.json").write_text("{not json", encoding="utf-8")
    assert first_verdict()["decision"] == "block", "unparsable"
    (tmp_path / "research.json").write_text("[]", encoding="utf-8")
    assert first_verdict()["decision"] == "block", "a JSON array, which .get() would die on"
    (tmp_path / "research.json").write_bytes(b'{"project": {"status": "\xff\xfe"}}')
    assert first_verdict()["decision"] == "block", "invalid UTF-8 (a ValueError, not an OSError)"


def test_the_cap_bounds_the_vetoes(tmp_path, monkeypatch):
    _write(tmp_path, "active")
    hooks = _hooks(tmp_path, monkeypatch, max_nudges=2)
    stop = hooks["Stop"][0].kw["hooks"][0]
    pretool = hooks["PreToolUse"][0].kw["hooks"][0]

    async def work_then_stop():
        # A tool call between stops, or the no-progress arm ends the run after one nudge.
        for _ in range(3):
            await pretool({"tool_name": "Read", "tool_input": {}}, "t", None)
            await stop({}, None, None)
        await pretool({"tool_name": "Read", "tool_input": {}}, "t", None)
        return await stop({}, None, None)

    assert asyncio.run(work_then_stop()) == {}, "the third nudge is past a cap of 2"


def test_the_no_progress_arm_needs_the_tool_counter(tmp_path, monkeypatch):
    """Two stops with no tool call between them means the nudge achieved nothing, so
    another will not help. Without a counter this arm cannot fire at all -- which is why
    the PreToolUse hook is wrapped rather than the counter living on a module global."""
    _write(tmp_path, "active")
    stop = _hooks(tmp_path, monkeypatch)["Stop"][0].kw["hooks"][0]

    async def two_stops_no_work():
        first = await stop({}, None, None)
        return first, await stop({}, None, None)

    first, second = asyncio.run(two_stops_no_work())
    assert first["decision"] == "block"
    assert second == {}, "nothing happened between the two stops, so the run ends"


def test_the_counter_is_per_session_not_per_process(tmp_path, monkeypatch):
    """Two sandboxes in one process must not read each other's progress."""
    a, b = tmp_path / "a", tmp_path / "b"
    a.mkdir(); b.mkdir()
    _write(a, "active"); _write(b, "active")
    hooks_a, hooks_b = _hooks(a, monkeypatch), _hooks(b, monkeypatch)
    pretool_a = hooks_a["PreToolUse"][0].kw["hooks"][0]
    stop_b = hooks_b["Stop"][0].kw["hooks"][0]

    async def drive():
        for _ in range(5):
            await pretool_a({"tool_name": "Read", "tool_input": {}}, "t", None)
        await stop_b({}, None, None)
        return await stop_b({}, None, None)

    assert asyncio.run(drive()) == {}, "session B did no work; A's tool calls must not count for it"


def test_the_hook_never_raises(tmp_path, monkeypatch):
    """A Stop hook that raises ends the turn in ERROR, which is strictly worse than
    letting it end. Same house rule as the PreToolUse hooks on both planes."""
    _write(tmp_path, "active")
    monkeypatch.setattr(real_agent, "AUTONOMOUS_MAX_NUDGES", 60)
    stop = real_agent.make_stop_hook(
        tmp_path, max_nudges=60,
        tool_count=lambda: (_ for _ in ()).throw(RuntimeError("counter is gone")),
    )
    assert _call(stop) == {}, "an exception allows the stop"


def test_the_veto_text_is_the_prototypes_verbatim():
    """One rule, three readers. The worker's CONTINUE_REASON is itself the harness's, and
    a reworded copy here would mean the alpha nudges the model with different words than
    every measurement was taken under."""
    from proto.worker.options import CONTINUE_REASON as WORKER_REASON

    assert real_agent.CONTINUE_REASON == WORKER_REASON


def test_the_decision_is_imported_not_reimplemented():
    import inspect

    source = inspect.getsource(real_agent.make_stop_hook)
    assert "should_continue_run(" in source
    assert "project.status" not in source and "status\" ==" not in source, \
        "the alpha must not grow its own copy of the completion rule"


@pytest.mark.parametrize("raw, cap", [
    ("0", 0), ("30", 30), ("60", 60),
    # The ones that matter: the MODULE-LEVEL assignment must go through the guarded
    # parser, not a bare int(). Testing `_max_nudges` alone leaves a regression to
    # `AUTONOMOUS_MAX_NUDGES = int(os.environ.get(...))` completely uncaught -- and that
    # import happens inside the sandbox AND in the prototype worker, where it crash-loops
    # the container rather than degrading.
    ("forty", 60), ("  ", 60), ("-5", 0),
])
def test_the_cap_is_configurable_and_a_bad_value_never_breaks_the_import(raw, cap, monkeypatch):
    monkeypatch.setenv("AUTONOMOUS_MAX_NUDGES", raw)
    import importlib

    try:
        reloaded = importlib.reload(real_agent)  # must not raise
    finally:
        monkeypatch.delenv("AUTONOMOUS_MAX_NUDGES", raising=False)
    try:
        assert reloaded.AUTONOMOUS_MAX_NUDGES == cap
    finally:
        importlib.reload(real_agent)
    # p99 of Skill/Task/Agent steps per run over the 189 committed e2e runs is 51.
    assert real_agent.AUTONOMOUS_MAX_NUDGES >= 51


# ── 1d: the cap has to REACH the sandbox, and must not crash it ──────────────────


@pytest.mark.parametrize("raw, expected", [
    (None, 60), ("", 60), ("   ", 60), ("forty", 60), ("60", 60), ("0", 0), ("30", 30),
    ("-5", 0), (" 12 ", 12),
])
def test_the_cap_parse_never_raises(raw, expected):
    """A bare `int()` at module scope raises ValueError on "  " or "forty". This module is
    imported at agent start INSIDE the sandbox and by the prototype worker, where
    `runner._make_agent`'s `except ImportError` does not catch it -- so a typo'd
    environment variable crash-loops the container while the web tier logs a warning and
    carries on, leaving the stack looking half-up."""
    env = {} if raw is None else {"AUTONOMOUS_MAX_NUDGES": raw}
    assert real_agent._max_nudges(env) == expected


def test_both_providers_pass_the_cap_into_the_sandbox_and_honour_auto_continue():
    """`real_agent` reads AUTONOMOUS_MAX_NUDGES from the environment INSIDE the sandbox,
    and `commands.run` does not inherit the image ENV -- so a variable not named in the
    provider's env dict never arrives, and an operator setting it on the control plane
    changes nothing while the sandbox keeps its compiled-in default.

    `auto_continue` is honoured because that flag already meant "one turn per message":
    a new mechanism that ignored it would silently take away an existing kill switch."""
    import inspect

    from app.config import Settings
    from app.sandbox import e2b, local

    assert Settings().autonomous_max_nudges == 60

    for source in (inspect.getsource(e2b.E2BProvider._agent_env),
                   inspect.getsource(local.LocalProvider)):
        assert "AUTONOMOUS_MAX_NUDGES" in source, "the cap never reaches the sandbox"
        assert "auto_continue" in source

    # Behaviour, on the provider that builds its env as a pure function.
    provider = e2b.E2BProvider.__new__(e2b.E2BProvider)
    from app import config

    on = config.Settings(auto_continue=True, autonomous_max_nudges=42)
    off = config.Settings(auto_continue=False, autonomous_max_nudges=42)
    import app.sandbox.e2b as e2b_mod

    for settings, expected in ((on, "42"), (off, "0")):
        original = e2b_mod.get_settings
        e2b_mod.get_settings = lambda s=settings: s
        try:
            env = provider._agent_env("claude-sonnet-4-6")
        finally:
            e2b_mod.get_settings = original
        assert env["AUTONOMOUS_MAX_NUDGES"] == expected, (settings.auto_continue, env)

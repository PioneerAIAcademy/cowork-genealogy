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
from types import SimpleNamespace
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
        # NOT a bare `"auto_continue" in source`. That was already satisfied by the
        # NEIGHBOURING `"AUTO_CONTINUE": "1" if settings.auto_continue else "0"` line, so
        # deleting `if settings.auto_continue else 0` from the cap line left the test
        # green -- exactly the "field-name match that collides with an unrelated key"
        # failure CLAUDE.md names. Read the cap's OWN line instead.
        cap_line = next(
            ln for ln in source.splitlines() if '"AUTONOMOUS_MAX_NUDGES"' in ln and ":" in ln
        )
        assert "auto_continue" in cap_line, (
            f"the cap is not gated on auto_continue: {cap_line.strip()!r}. That flag "
            f"already meant 'one turn per message'; a cap that ignores it silently takes "
            f"away an existing kill switch."
        )

    # Behaviour, on BOTH providers -- the assertion above is still only a string match.
    # LocalProvider builds its env inside `start`, so its dict is lifted and evaluated
    # rather than called.
    for settings_kw, expected in (({"auto_continue": True}, "42"), ({"auto_continue": False}, "0")):
        from app import config as _config

        st = _config.Settings(autonomous_max_nudges=42, **settings_kw)
        line = next(
            ln.strip() for ln in inspect.getsource(local.LocalProvider).splitlines()
            if '"AUTONOMOUS_MAX_NUDGES"' in ln and ":" in ln
        )
        value = eval(line.split(":", 1)[1].rstrip(","), {"str": str}, {"settings": st})  # noqa: S307
        assert value == expected, (
            f"LocalProvider stamps {value!r} with auto_continue={st.auto_continue}; "
            f"the two providers must answer the same setting the same way"
        )

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


# ── 1b/1e reach the alpha: the two signals the shared predicate always accepted ──────


class _FakeAgent:
    """Just the surface `_build_hooks` reads off a RealAgent."""

    def __init__(self, *, spend: float = 0.0, pending: bool = False) -> None:
        self._spend, self._pending = spend, pending
        self.pending_user_message = lambda: self._pending

    def session_spend_usd(self) -> float:
        return self._spend


def _pretool(agent):
    """The unscoped PreToolUse callback -- the one that sees EVERY tool call."""
    from claude_agent_sdk import HookMatcher

    from app.agent import real_agent as ra

    hooks = ra._build_hooks(HookMatcher, Path("/project"), agent)
    return hooks["PreToolUse"][0].hooks[0]
def test_a_message_typed_mid_turn_is_taken_at_the_next_step_on_the_alpha():
    """`runner.serve` holds a pending message while `turn_task` is not done -- and under
    1d that task is the whole job, so the message waited a JOB boundary. The prototype
    answers at the next tool call, a median 2.6 s away."""
    quiet = asyncio.run(_pretool(_FakeAgent(pending=False))({}, None, None))
    assert quiet == {}

    waiting = asyncio.run(_pretool(_FakeAgent(pending=True))({}, None, None))
    assert waiting.get("continue") is False
    assert "message" in waiting["stopReason"].lower()


def test_the_halt_never_fails_a_tool_call_the_researcher_was_entitled_to_make():
    """This hook runs on EVERY tool call and it is not the restraint -- the deny hook is.
    A raising check here would fail calls for a reason that has nothing to do with them,
    so it allows and logs, exactly like the Stop hook's own except arm."""
    class Exploding:
        pending_user_message = staticmethod(lambda: False)

        def session_spend_usd(self):
            raise RuntimeError("the accumulator is broken")

    assert asyncio.run(_pretool(Exploding())({}, None, None)) == {}


def test_the_runner_is_what_tells_the_agent_a_message_is_waiting():
    """`pending` is a local of `serve()` -- the runner owns the backlog -- so the agent
    cannot see it any other way. Without this wire the hook above reads a lambda that is
    permanently False and the whole handover is dead code."""
    import ast
    import inspect
    import textwrap

    from app.agent import runner

    # Asserted on the STRUCTURE, not on the exact lambda text: an earlier draft matched
    # the source line verbatim and failed a legitimate refactor to a named closure, which
    # is how a guard gets `skip`ped within a month.
    tree = ast.parse(textwrap.dedent(inspect.getsource(runner.serve)))
    assigned = [
        node for node in ast.walk(tree)
        if isinstance(node, ast.Assign)
        and any(isinstance(t, ast.Attribute) and t.attr == "pending_user_message"
                for t in node.targets)
    ]
    assert assigned, (
        "the runner no longer publishes its backlog to the agent; the mid-turn handover "
        "silently reverts to a job boundary"
    )
    # ...and whatever it assigns has to actually read the backlog. A closure defined
    # elsewhere in serve() counts: resolve it by name rather than requiring a lambda.
    value = assigned[-1].value
    if isinstance(value, ast.Name):
        value = next(
            (n for n in ast.walk(tree)
             if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == value.id),
            value,
        )
    names = {n.id for n in ast.walk(value) if isinstance(n, ast.Name)}
    assert "pending" in names, (
        f"what the runner publishes does not read `pending`: {ast.dump(value)[:120]}"
    )


def test_both_halt_carriers_read_the_pending_message_signal():
    """The Stop hook and the PreToolUse halt must agree, or a run stops for a reason one
    of them cannot see. Asserted on the wiring rather than on behaviour, because the Stop
    hook's arm needs a project dir and a nudge budget to reach."""
    import inspect

    from app.agent import real_agent as ra

    wiring = inspect.getsource(ra._build_hooks)
    assert "pending_user_message" in wiring, "pending_user_message is not wired into the hooks"
    stop = inspect.getsource(ra.make_stop_hook)
    assert "pending_user_message=bool(" in stop, "the Stop hook must pass the signal on"


def test_the_alpha_carries_no_spend_meter():
    """Lead ruling 2026-09-25: no spend limit on the alpha. E2B is replaced by the
    search-agent prototype in about two months, so the alpha is not worth hardening -- and
    the meter this branch briefly added carried three defects of its own:

    1. It DOUBLE-COUNTED. `_record_usage` ran on every streamed message, and
       `ResultMessage.usage` is CUMULATIVE session totals -- said so in `_usage_delta`'s
       own docstring, in the same file -- so each turn added the whole running total again
       on top of the per-message sum.
    2. It NEVER RESET. `_usage_by_message` lived for the life of the RealAgent, so with the
       doubling a project locked up permanently at roughly $17.50 of real spend.
    3. `SESSION_SPEND_CAP_USD=0` halted every tool call, because the comparison was `>=`.

    None of the three was caught by the tests that shipped with it: those drove a fake
    agent returning a fixed number, so they exercised the HALT'S DECISION and never the
    METER. That is why this guard is spelled against the module rather than a verdict --
    what must not come back is the meter.

    The prototype's $35 cap is untouched and stays as built."""
    import inspect

    from app.agent import real_agent as ra

    src = inspect.getsource(ra)
    for gone in ("session_spend_usd", "_record_usage", "_usage_by_message",
                 "SPEND_CAP_USD", "usage_tokens"):
        assert gone not in src, (
            f"`{gone}` is back in real_agent.py. The alpha carries no spend meter "
            f"(lead ruling 2026-09-25); the prototype's cap is the one that ships."
        )
    proto = (Path(__file__).resolve().parents[1]
             / "proto" / "worker" / "worker.py").read_text(encoding="utf-8")
    assert "SPEND_CAP_USD" in proto, "the prototype's $35 session cap must stay"

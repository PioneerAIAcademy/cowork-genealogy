"""The alpha's turn hooks: the delivered halt, the pending-message halt, the system
prompt. The Stop hook (PR #2870 item 1d) was deleted in step mode's phase 2.

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


def _hooks(project_dir: Path, monkeypatch) -> dict:
    return real_agent._build_hooks(FakeMatcher, project_dir)


def _write(project_dir: Path, status: str | None) -> None:
    doc = {} if status is None else {"project": {"status": status}}
    (project_dir / "research.json").write_text(json.dumps(doc), encoding="utf-8")


def _call(hook, payload=None):
    return asyncio.run(hook(payload or {"tool_name": "Read", "tool_input": {}}, "tid", None))






























# ── 1d: the cap has to REACH the sandbox, and must not crash it ──────────────────






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
    answers at the next tool call, a median 2.6 s away.

    The FIRST call must do work: two messages typed in quick succession are held
    together (serve pops one, leaves the rest pending), so without the prototype's
    one-call rule the turn released for the first would halt at its own first tool
    call, do no work on it -- and that message is never re-queued."""
    quiet = asyncio.run(_pretool(_FakeAgent(pending=False))({}, None, None))
    assert quiet == {}

    hook = _pretool(_FakeAgent(pending=True))
    assert asyncio.run(hook({}, None, None)) == {}, \
        "the turn must engage with its own message before handing over"
    waiting = asyncio.run(hook({}, None, None))
    assert waiting.get("continue") is False
    assert "message" in waiting["stopReason"].lower()


def test_the_one_call_guard_holds_on_every_turn_not_only_the_first():
    """The hooks dict lives for the SESSION (the SDK client is cached), so a guard on the
    session-wide `tool_calls` lets every turn after the first halt at its own first call
    and the message that turn was released for gets no work. The guard counts per turn."""
    from app.agent import real_agent as ra

    agent = _FakeAgent(pending=True)
    hook = _pretool(agent)
    asyncio.run(hook({}, None, None))
    asyncio.run(hook({}, None, None))           # turn 1 hands over at its second call
    ra.RealAgent._begin_turn_hook_state(agent)  # turn 2, released for a held message
    assert asyncio.run(hook({}, None, None)) == {}, \
        "turn 2's first call must do work on its own message before handing over"
    assert asyncio.run(hook({}, None, None)).get("continue") is False


def test_a_subagent_call_does_not_take_a_waiting_message_on_the_alpha():
    """#3376: the pending-message halt is gated on the MAIN thread, like the delivered arm.
    A subagent call -- one carrying an `agent_id` KEY, membership not truthiness so None and
    "" count -- must run to the end of its task even with a message waiting; the message is
    taken at the orchestrator's next main-thread call. Without the gate a mid-task halt
    strands the orchestrator with the subagent's last in-progress note as its final report."""
    # ONE hook across the sequence, as in a real session: the counter is past the
    # one-call guard by the time the main-thread call arrives.
    hook = _pretool(_FakeAgent(pending=True))
    assert asyncio.run(hook({"agent_id": "record-extractor"}, None, None)) == {}
    assert asyncio.run(hook({"agent_id": None}, None, None)) == {}, (
        "agent_id present but falsy is STILL a subagent -- a truthiness test would halt it"
    )
    # The main thread (no agent_id key) still hands over at the next call.
    main = asyncio.run(hook({}, None, None))
    assert main.get("continue") is False and "message" in main["stopReason"].lower()


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




def test_the_alpha_carries_no_spend_limit():
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
    what must not come back is that meter.

    The control plane's credential proxy records what every call cost (`api_calls`) and
    must never refuse one on it. It takes its prices from `app.agent.spend`, beside the
    prototype's cap, so the cap is the name it must not read.

    The prototype's $35 cap is untouched and stays as built."""
    import inspect

    from app import anthropic_proxy
    from app.agent import real_agent as ra

    src = inspect.getsource(ra)
    for gone in ("session_spend_usd", "_record_usage", "_usage_by_message",
                 "SPEND_CAP_USD", "usage_tokens"):
        assert gone not in src, (
            f"`{gone}` is back in real_agent.py. The alpha's sandbox carries no spend meter "
            f"(lead ruling 2026-09-25); the prototype's cap is the one that ships."
        )
    assert "SPEND_CAP_USD" not in inspect.getsource(anthropic_proxy), (
        "the credential proxy reads the spend cap. It records what calls cost and refuses "
        "none on it: the alpha has no spend limit (lead ruling 2026-09-25)."
    )
    proto = (Path(__file__).resolve().parents[1]
             / "proto" / "worker" / "worker.py").read_text(encoding="utf-8")
    assert "SPEND_CAP_USD" in proto, "the prototype's $35 session cap must stay"


# --- The `delivered` arm (#2813 item 1) -------------------------------------
#
# The router's "Bounded request or job" section tells the model to stop once a
# bounded request is met. Before this arm THIS plane's (since deleted) Stop hook vetoed that stop and nudged
# it onward -- the exact thrash the section exists to end -- because
# `should_continue_run` had no way to hear about it. The prototype learned the
# signal in #3147; the hosted alpha did not, and the alpha is a live plane.

def _counting_hook(hooks: dict):
    """The `matcher=None` PreToolUse callback -- the one that sees EVERY call."""
    return hooks["PreToolUse"][0].kw["hooks"][0]


def _delivered_call(**extra):
    return {"tool_name": real_agent.DELIVERED_TOOL, "tool_input": {}, **extra}


def test_delivered_on_the_main_thread_halts_the_turn(tmp_path, monkeypatch):
    hooks = _hooks(tmp_path, monkeypatch)
    out = _call(_counting_hook(hooks), _delivered_call())
    assert out.get("continue") is False, "a delivery must end the turn"
    assert out.get("stopReason") == real_agent.DELIVERED_REASON


def test_a_subagent_delivering_does_not_halt_the_session(tmp_path, monkeypatch):
    """A subagent calling it means ITS leg is done. Halting here would strand the
    orchestrator mid-job, which is why the arm is gated on the main thread."""
    hooks = _hooks(tmp_path, monkeypatch)
    out = _call(_counting_hook(hooks), _delivered_call(agent_id="record-extractor"))
    assert out == {}, "a subagent's delivery is not the session's"


def test_an_ordinary_tool_call_does_not_halt(tmp_path, monkeypatch):
    hooks = _hooks(tmp_path, monkeypatch)
    assert _call(_counting_hook(hooks)) == {}




def test_the_alpha_system_prompt_carries_the_delivery_guidance(tmp_path):
    """The twin of `test_proto_worker.py`'s assertion, and the half this plane was
    missing: the halt arm above only fires when the model CALLS `research_delivered`,
    and nothing calls a tool it was never told about. Wiring the arm without the
    guidance ships a dead rule that looks identical to a working one."""
    opts = real_agent.build_options(tmp_path)
    assert real_agent.DELIVERY_GUIDANCE in opts.system_prompt["append"]
    assert "research_delivered" in opts.system_prompt["append"]


def test_the_alpha_system_prompt_is_true_before_a_project_exists(tmp_path):
    """Issue #3768. On a fresh session the folder holds no research.json; a note saying it
    did pointed the model at a project that was not there, and first messages were answered
    from one lookup. The delivery text also names the no-project exclusion, and the env
    carries the flag that keeps the Cowork-only `no_project_route.py` hook silent here."""
    opts = real_agent.build_options(tmp_path)
    append = opts.system_prompt["append"]
    assert append.startswith("You are the hosted genealogy research agent")
    assert "contains research.json" not in append
    assert "Once a project exists there it holds research.json" in append
    assert "while no project exists yet" in real_agent.DELIVERY_GUIDANCE
    assert "nothing has created one since" in real_agent.DELIVERY_GUIDANCE
    assert "no_project" in real_agent.DELIVERY_GUIDANCE
    assert opts.env[real_agent.HOSTED_PLANE_ENV] == "1"


def test_the_hosted_flag_is_the_one_the_plugin_hook_reads():
    """The server and the plugin hook each define `GENEALOGY_HOSTED_PLANE`. A rename on one
    side alone leaves every server test green while the hook speaks on both hosted planes,
    so this loads the hook from the repo and checks its behaviour under the server's name."""
    import importlib.util

    path = Path(__file__).resolve().parents[3] / "packages/engine/plugin/hooks/no_project_route.py"
    spec = importlib.util.spec_from_file_location("_no_project_route", path)
    hook = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(hook)
    payload = {"prompt": "Research PID L8PL-3W8."}
    assert hook.decision(payload, {real_agent.HOSTED_PLANE_ENV: "1"}) == {}
    assert hook.decision(payload, {}) != {}


class _Turns:
    """Stands in for the session, borrowing the REAL turn-boundary method.

    `pending_user_message` is part of the interface `_build_hooks` binds, so the
    stand-in has to carry it; returning False keeps that arm out of the way of
    what these tests are about.
    """
    _begin_turn_hook_state = real_agent.RealAgent._begin_turn_hook_state

    def pending_user_message(self) -> bool:
        return False


def _session(tmp_path, monkeypatch):
    """Hooks plus the object the turn boundary runs against."""
    _write(tmp_path, "active")
    agent = _Turns()
    hooks = real_agent._build_hooks(FakeMatcher, tmp_path, agent)
    return agent, _counting_hook(hooks)


def test_a_delivery_is_cleared_at_the_next_turn_and_only_there(tmp_path, monkeypatch):
    """`delivered` is per-TURN while the counter is per-SESSION (the SDK client is
    cached), so the turn boundary clears it -- and a subagent call inside the turn does
    not."""
    agent, counting = _session(tmp_path, monkeypatch)
    _call(counting, _delivered_call())
    _call(counting, {"tool_name": "Read", "tool_input": {}, "agent_id": "record-extractor"})
    assert agent._hook_counter["delivered"] is True, "a subagent's call must not clear it"
    agent._begin_turn_hook_state()
    assert agent._hook_counter["delivered"] is False


def test_the_providers_pass_auto_continue_and_not_the_deleted_cap():
    """The Stop veto is gone (step mode phase 2), so no provider hands the sandbox
    AUTONOMOUS_MAX_NUDGES; `auto_continue` still reaches it, for the runner's chain."""
    import inspect

    from app.sandbox import e2b, local

    for source in (inspect.getsource(e2b.E2BProvider._agent_env),
                   inspect.getsource(local.LocalProvider)):
        assert "AUTONOMOUS_MAX_NUDGES" not in source
        assert '"AUTO_CONTINUE"' in source


def test_build_hooks_publishes_the_counter_to_the_turn_boundary(tmp_path, monkeypatch):
    """Without this the boundary method is a no-op and every test below passes
    vacuously, because `getattr(self, "_hook_counter", None)` returns None."""
    agent, _ = _session(tmp_path, monkeypatch)
    assert getattr(agent, "_hook_counter", None) is not None
    assert agent._hook_counter["delivered"] is False








def test_the_delivery_summary_leads_the_stop_reason(tmp_path, monkeypatch):
    """The halt text carries the model's own sentence, as the prototype's does.

    NOT full parity, and the first version of this docstring overclaimed it: the
    prototype RENDERS the summary, the alpha does not yet. `map_message` has no
    `ResultMessage` branch and nothing under `apps/server/app` reads `stopReason`,
    so on the alpha the sentence reaches the CLI and the log but not the browser.
    Raised in review. What this test pins is that the text is BUILT correctly and
    shared with the prototype, which is what stops the two drifting; surfacing it
    is a separate change to the event stream.

    Summary FIRST because the prototype's chip cuts at 160 chars and
    DELIVERED_REASON alone is 124, so appending would leave almost no room.

    Added because the suite passed both before and after the behaviour existed:
    every other test here asserts only that the turn halts.
    """
    hooks = _hooks(tmp_path, monkeypatch)
    out = _call(_counting_hook(hooks), {
        "tool_name": real_agent.DELIVERED_TOOL,
        "tool_input": {"summary": "Transcribed the 1881 census page."},
    })
    reason = out["stopReason"]
    assert reason.startswith("Delivered: Transcribed the 1881 census page."), reason
    assert real_agent.DELIVERED_REASON in reason


def test_a_delivery_with_no_summary_still_halts_cleanly(tmp_path, monkeypatch):
    hooks = _hooks(tmp_path, monkeypatch)
    for payload in ({"summary": "   "}, {"summary": None}, {}):
        out = _call(_counting_hook(hooks), {
            "tool_name": real_agent.DELIVERED_TOOL, "tool_input": payload,
        })
        assert out["stopReason"] == real_agent.DELIVERED_REASON, payload
        assert out["continue"] is False


def test_a_present_but_null_agent_id_is_still_a_subagent(tmp_path, monkeypatch):
    """Pins membership, not truthiness.

    Mutating the arm to `not (_input_data or {}).get("agent_id")` passed the entire
    server suite, and under it a subagent whose `agent_id` is present-but-None would
    halt the researcher's whole session. The prototype pins this exact distinction;
    the alpha copy shipped unguarded because the only subagent test passed a
    non-empty string.
    """
    hooks = _hooks(tmp_path, monkeypatch)
    out = _call(_counting_hook(hooks), _delivered_call(agent_id=None))
    assert out == {}, "agent_id present-but-None is a subagent, not the main thread"


def test_handle_turn_clears_a_delivery_from_the_previous_turn(tmp_path):
    """Drives the REAL turn boundary, not the stand-in.

    Raised in review: every other test here calls `_begin_turn_hook_state` on a
    stand-in, never through `handle_turn`, so replacing the call site with `pass`
    left the whole server suite green. The fix for the session-scoped `delivered`
    leak could have been deleted with CI passing, which is the shape this branch
    has been removing all along.

    It fails with the call deleted, and fails if the reset also zeroes
    `tool_calls` -- that counter is deliberately session-scoped, because the
    no-progress arm compares it across two stops.
    """
    import asyncio

    from claude_agent_sdk import ResultMessage

    from _fakes import ReplayFakeClient, attach, turn_events

    agent = real_agent.RealAgent(tmp_path)
    agent._hook_counter = {"delivered": True}
    done = ResultMessage(subtype="success", duration_ms=1, duration_api_ms=1,
                         is_error=False, num_turns=1, session_id="s1")
    attach(agent, ReplayFakeClient([done]))
    asyncio.run(turn_events(agent, "next message"))

    assert agent._hook_counter["delivered"] is False, (
        "a new turn must clear the previous turn's delivery"
    )


@pytest.mark.parametrize("summary", [123, ["a", "b"], {"x": 1}])
def test_a_non_string_summary_still_halts(tmp_path, monkeypatch, summary):
    """A regression introduced by sharing the stop-reason helper, caught in review.

    The alpha used to cast with `str()` before stripping; the shared helper did not,
    so a non-string summary raised `AttributeError` inside the PreToolUse callback.
    That fails the tool call, loses the halt, and leaves `delivered` already set.
    Nothing validates the tool's `inputSchema`, so the input is reachable.
    """
    hooks = _hooks(tmp_path, monkeypatch)
    out = _call(_counting_hook(hooks), {
        "tool_name": real_agent.DELIVERED_TOOL, "tool_input": {"summary": summary},
    })
    assert out.get("continue") is False
    assert str(summary) in out["stopReason"]

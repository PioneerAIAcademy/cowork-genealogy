"""What a user is allowed to read when the agent boundary fails (#1126).

Two alpha testers read an operator-key 401 — *"Failed to authenticate. API
Error: 401 API key is invalid."* — as a FamilySearch problem and went off
debugging the wrong credential. The defect is the misdirection, so the
assertions here are about the words that reach the user, not about the internal
shape of the error.

A pure-function test of `classify` alone is passed by a five-line constant while
every call site still leaks, so the load-bearing tests below are **call-site**
tests: they drive `serve()` and `map_message` and assert on the emitted event.
"""

import asyncio

import pytest

from app.agent.errors import MISCONFIGURED, UNEXPECTED, classify, operator_log
from app.agent.mcp_health import (
    classify_server_status,
    should_warn_at_init,
    unavailable_message,
)
from app.agent.runner import serve

# The literal string the tester saw, as it reaches the runner: the SDK's one
# text-bearing channel is CLIJSONDecodeError, which formats
# f"Failed to decode JSON: {line[:100]}..." around a plain-text auth line.
TESTER_TEXT = (
    "Failed to decode JSON: Failed to authenticate. "
    "API Error: 401 API key is invalid."
)

# Nothing in a user-facing string may name a credential or a vendor — that
# naming is what sent both testers to the wrong system.
FORBIDDEN = ("api", "key", "token", "familysearch", "anthropic", "401", "403")


def _assert_credential_free(text: str) -> None:
    lowered = text.lower()
    for word in FORBIDDEN:
        assert word not in lowered, f"user-facing text leaks {word!r}: {text!r}"


async def _drive(agent) -> list[dict]:
    """Run one turn through the real `serve()` loop and collect its events."""
    incoming: asyncio.Queue = asyncio.Queue()
    events: list[dict] = []
    task = asyncio.create_task(serve(agent, incoming, events.append))
    await incoming.put({"type": "user_msg", "text": "who were his parents?"})
    await asyncio.sleep(0.05)  # let the turn run; EOF before it would race it
    await incoming.put(None)  # EOF → serve returns
    await asyncio.wait_for(task, 2)
    return events


class _FailingAgent:
    """An agent whose turn dies the way the tester's did."""

    def __init__(self, exc: BaseException):
        self._exc = exc

    async def handle_turn(self, text):
        raise self._exc
        yield  # pragma: no cover — makes this an async generator

    async def interrupt(self):
        return False


# --- the acceptance check ---------------------------------------------------


def test_a_401_from_the_agent_reaches_the_user_classified():
    """THE acceptance check: fails on main, passes after.

    On main this emitted `f"Agent error: {exc}"` — the raw SDK text, verbatim.
    Asserting equality with the classified string (not merely "401 is absent")
    is what makes it fail on main rather than pass by accident.
    """
    events = asyncio.run(_drive(_FailingAgent(Exception(TESTER_TEXT))))

    errors = [e for e in events if e.get("kind") == "error"]
    assert errors, "a failed turn must still tell the user something"
    assert errors[0]["text"] == MISCONFIGURED
    _assert_credential_free(errors[0]["text"])
    assert events[-1] == {"kind": "turn_done"}, "the turn must still be closed out"


def test_a_non_auth_failure_is_not_reported_as_a_misconfiguration():
    """The default must be UNEXPECTED, not MISCONFIGURED.

    Returning the misconfiguration line for every failure would report an
    unrelated bug as an operator problem — the same misdirection, pointed
    somewhere new. A ProcessError carries no 401 to match on: the SDK builds the
    only one as "Command failed with exit code 1" with hardcoded stderr.
    """
    events = asyncio.run(
        _drive(_FailingAgent(RuntimeError("Command failed with exit code 1")))
    )

    errors = [e for e in events if e.get("kind") == "error"]
    assert errors[0]["text"] == UNEXPECTED
    assert errors[0]["text"] != MISCONFIGURED


def test_an_interrupt_failure_is_classified_too():
    """runner.py:91 — not in the issue's list of five.

    Concrete path: the key rotates mid-turn, the control channel dies, the user
    presses Stop, and interrupt() raises CLIConnectionError("Not connected").
    """

    class _Unstoppable:
        async def handle_turn(self, text):
            while True:
                yield {"kind": "text", "text": "…"}
                await asyncio.sleep(0.005)

        async def interrupt(self):
            raise ConnectionError("Not connected")

    async def drive():
        incoming: asyncio.Queue = asyncio.Queue()
        events: list[dict] = []
        task = asyncio.create_task(serve(_Unstoppable(), incoming, events.append))
        await incoming.put({"type": "user_msg", "text": "go"})
        await asyncio.sleep(0.05)
        await incoming.put({"type": "interrupt"})
        await asyncio.sleep(0.05)
        await incoming.put(None)
        await asyncio.wait_for(task, 2)
        return events

    events = asyncio.run(drive())
    texts = [e.get("text") for e in events if e.get("kind") == "error"]
    assert not any("Not connected" in (t or "") for t in texts), (
        "the raw exception text reached the user"
    )
    assert UNEXPECTED in texts


# --- classify(), each arm ---------------------------------------------------


@pytest.mark.parametrize("status", [401, 403])
def test_auth_statuses_are_authoritative(status):
    assert classify(status=status) == MISCONFIGURED


@pytest.mark.parametrize("status", [400, 429, 500, 503])
def test_other_statuses_get_the_retryable_default(status):
    assert classify(status=status) == UNEXPECTED


@pytest.mark.parametrize("kind", ["authentication_failed", "billing_error"])
def test_operator_error_kinds_are_misconfiguration(kind):
    """The SDK's AssistantMessageError literals that mean "our credential"."""
    assert classify(error_kind=kind) == MISCONFIGURED


@pytest.mark.parametrize("kind", ["rate_limit", "server_error", "unknown",
                                  "invalid_request"])
def test_transient_error_kinds_are_not_misconfiguration(kind):
    """rate_limit and server_error are worth retrying, so they must not tell the
    user to go report a misconfiguration."""
    assert classify(error_kind=kind) == UNEXPECTED


def test_status_outranks_text():
    """A non-auth status must win over auth-looking words in the message —
    otherwise a 500 whose body mentions an api key reads as misconfiguration."""
    assert classify(Exception("api key"), status=500) == UNEXPECTED


def test_both_user_facing_strings_are_credential_free():
    for text in (MISCONFIGURED, UNEXPECTED):
        _assert_credential_free(text)


def test_neither_string_promises_anyone_was_notified():
    """Nothing alerts an operator today (#1623), so a promise would be a lie
    told to the one person who cannot check."""
    for text in (MISCONFIGURED, UNEXPECTED):
        assert "notified" not in text.lower()
        assert "administrator" not in text.lower()


def test_the_operator_log_keeps_what_the_user_no_longer_sees():
    """Classifying the user's copy only helps if the raw text survives."""
    line = operator_log("receive_loop", MISCONFIGURED,
                        exc=Exception(TESTER_TEXT), status=401)
    assert "401" in line
    assert "API key is invalid" in line
    assert "[operator]" in line


# --- map_message: the assistant-text path (the lead's addition) -------------


def test_an_errored_assistant_message_is_tagged_error_not_text():
    """The site the testers actually read.

    `map_message` tagged every TextBlock `kind: "text"`, so the 401 rendered as
    the assistant's own answer. `kind: "error"` is what tells the UI otherwise:
    chatEvents.ts sets `last.error = true`, which ChatPane styles with
    `msgError`.
    """
    sdk = pytest.importorskip(
        "claude_agent_sdk",
        reason="the assistant-message path needs the SDK's real dataclasses",
    )

    message = sdk.AssistantMessage(
        content=[sdk.TextBlock(text="Failed to authenticate. API Error: 401 …")],
        model="claude-opus-4-8",
        error="authentication_failed",
    )
    from app.agent.real_agent import map_message

    events = map_message(message, {}, {})

    assert [e["kind"] for e in events] == ["error"], (
        "the raw error text was emitted as assistant text"
    )
    assert events[0]["text"] == MISCONFIGURED
    _assert_credential_free(events[0]["text"])


def test_a_healthy_assistant_message_still_emits_text():
    """The guard must not swallow normal answers."""
    sdk = pytest.importorskip("claude_agent_sdk")
    from app.agent.real_agent import map_message

    message = sdk.AssistantMessage(
        content=[sdk.TextBlock(text="His parents were Robert and Mary.")],
        model="claude-opus-4-8",
    )
    events = map_message(message, {}, {})

    assert [e["kind"] for e in events] == ["text"]
    assert events[0]["text"] == "His parents were Robert and Mary."


# --- handle_turn: the silent in-turn failure -------------------------------


def _fake_client(messages):
    """A stand-in for ClaudeSDKClient that replays `messages` for one turn.

    Offline by construction. Driving the LIVE SDK to raise is explicitly out of
    bounds (no offline gate exercises it — #1207); replaying real SDK message
    objects through the real loop is the house pattern.
    """

    class _Client:
        async def query(self, text):
            return None

        async def receive_response(self):
            for message in messages:
                yield message

    return _Client()


def _turn_events(agent, messages) -> list[dict]:
    async def drive():
        return [ev async for ev in agent.handle_turn("go")]

    async def _ensure():
        return _fake_client(messages)

    agent._ensure_client = _ensure  # type: ignore[assignment]
    return asyncio.run(drive())


def test_an_in_turn_api_failure_is_no_longer_silent(tmp_path):
    """`receive_response()` YIELDS the ResultMessage — it does not raise on
    `is_error` — and nothing read that field, so an in-turn 401 produced no
    error event at all: `usage`, `turn_done`, and a user staring at silence.
    """
    sdk = pytest.importorskip("claude_agent_sdk")
    from app.agent.real_agent import RealAgent

    result = sdk.ResultMessage(
        subtype="success", duration_ms=90_000, duration_api_ms=89_000,
        is_error=True, num_turns=1, session_id="s1", api_error_status=401,
    )
    events = _turn_events(RealAgent(tmp_path), [result])

    errors = [e for e in events if e.get("kind") == "error"]
    assert errors, "an errored turn emitted no error event — the silent path"
    assert errors[0]["text"] == MISCONFIGURED
    # The usage event still fires: the turn is accounted for, not swallowed.
    assert any(e.get("kind") == "usage" for e in events)


def test_a_clean_turn_emits_no_error(tmp_path):
    """The guard must not manufacture an error on the happy path."""
    sdk = pytest.importorskip("claude_agent_sdk")
    from app.agent.real_agent import RealAgent

    result = sdk.ResultMessage(
        subtype="success", duration_ms=1200, duration_api_ms=1000,
        is_error=False, num_turns=1, session_id="s1",
    )
    events = _turn_events(RealAgent(tmp_path), [result])

    assert not [e for e in events if e.get("kind") == "error"]


# --- the ported MCP health check -------------------------------------------


def _init_message(entries):
    class _SystemMessage:
        subtype = "init"
        data = {"mcp_servers": entries}

    return _SystemMessage()


def test_a_session_with_no_genealogy_server_warns_once(tmp_path):
    """The call-site test for the port: a hosted session whose genealogy server
    never connected still RUNS, so the user pays for research that could not
    have happened. It must be told — once."""
    from app.agent.real_agent import RealAgent

    agent = RealAgent(tmp_path)
    message = _init_message([{"name": "claude.ai Slack", "status": "needs-auth"}])

    first = agent._mcp_health_events(message)
    assert [e["kind"] for e in first] == ["error"]
    assert "do not treat it as research" in first[0]["text"]

    # A re-spawned CLI emits a FRESH init; the same warning twice in one
    # conversation reads as a second, separate failure.
    assert agent._mcp_health_events(message) == []


def test_a_healthy_session_is_never_warned(tmp_path):
    from app.agent.real_agent import RealAgent

    agent = RealAgent(tmp_path)
    healthy = _init_message([{"name": "genealogy", "status": "connected"}])
    assert agent._mcp_health_events(healthy) == []

    pending = _init_message([{"name": "genealogy", "status": "pending"}])
    assert RealAgent(tmp_path)._mcp_health_events(pending) == []


def test_a_session_that_already_used_the_tools_is_not_warned(tmp_path):
    """Mid-session the server can die; saying "no research was possible" then
    would be false, because it demonstrably was."""
    from app.agent.real_agent import RealAgent

    agent = RealAgent(tmp_path)
    agent._mcp_calls = 12
    dead = _init_message([{"name": "genealogy", "status": "failed"}])
    assert agent._mcp_health_events(dead) == []


def test_a_non_init_system_message_is_ignored(tmp_path):
    """`SystemMessage` covers init/config/hint. Only init carries a server list,
    and a payload without one must not be read as absence."""
    from app.agent.real_agent import RealAgent

    class _Hint:
        subtype = "hint"
        data = {"text": "something"}

    assert RealAgent(tmp_path)._mcp_health_events(_Hint()) == []


def test_a_pending_server_at_init_does_not_warn():
    """The measurement that makes the init check safe to ship: at init a HEALTHY
    server still reads `pending` and settles ~14s later, while a dead one already
    reads `failed`. A `!= "connected"` test would warn on every healthy session.
    """
    entries = [{"name": "genealogy", "status": "pending"}]
    assert classify_server_status(entries) == "inconclusive"
    assert not should_warn_at_init(classify_server_status(entries), mcp_call_count=0)


def test_a_missing_server_is_the_observed_failure():
    """The observed mode is absence, not an error reply — the tools were simply
    not in the session, so no call was made and no error was ever returned."""
    entries = [{"name": "claude.ai Google Drive", "status": "needs-auth"}]
    assert classify_server_status(entries) == "unavailable"
    assert should_warn_at_init("unavailable", mcp_call_count=0)


def test_another_servers_bad_status_does_not_warn():
    """The list carries the operator's own claude.ai connectors, observed live as
    `needs-auth`. Judging health from "any unhealthy server" would warn on every
    session on such a machine — so the check is scoped by name."""
    entries = [
        {"name": "claude.ai Slack", "status": "needs-auth"},
        {"name": "genealogy", "status": "connected"},
    ]
    assert classify_server_status(entries) == "connected"


@pytest.mark.parametrize("entries", [None, [], "nonsense", [1, 2, 3], {}])
def test_an_unreadable_payload_never_warns(entries):
    """A shape we do not understand is not evidence of absence. This detector
    reads another process's payload, so it must not accuse the environment on
    input it cannot parse — nor raise."""
    assert classify_server_status(entries) == "inconclusive"


def test_a_session_that_already_researched_is_not_told_research_was_impossible():
    """A re-spawned CLI emits a FRESH init. Warning then would be false: the
    genealogy calls already happened."""
    assert not should_warn_at_init("unavailable", mcp_call_count=7)


def test_the_unavailable_message_does_not_quote_the_servers_own_error():
    """Upstream process text in front of a user is the very leak #1126 closes."""
    entry = {"name": "genealogy", "status": "failed",
             "error": "ENOENT: /opt/build/index.js"}
    text = unavailable_message(entry)
    assert "ENOENT" not in text
    assert "failed" in text


def test_the_unavailable_message_tells_the_user_not_to_trust_the_answer():
    """Its whole job: stop someone treating a session that could not research as
    a research result.

    `_assert_credential_free` deliberately does NOT apply here. That rule exists
    because naming a vendor in a *failure* sent both testers off to debug the
    wrong credential; this message names FamilySearch to say what the assistant
    has lost access to, and asks the user to fix nothing. What it must not do is
    send them to a login screen.
    """
    text = unavailable_message(None)
    assert "do not treat it as research" in text
    assert "nothing you did caused this" in text.lower()
    for word in ("sign in", "log in", "reconnect", "your api key", "your token"):
        assert word not in text.lower(), f"sends the user to fix something: {word!r}"

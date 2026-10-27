"""A step-mode run driven end to end through a fake `ClaudeSDKClient`.

Written because the structural tests in `test_e2e_step_mode_stop.py` cannot
fail on the mutations that matter (re-review item 5): they check the SHAPE of a
comparison, not its operator, so inverting `is not None` to `is None` passes
them — while bringing the Stop veto back for every step run AND dropping it
from every ordinary one. A substring check on the source has the same hole: the
string survives when the statement is disabled.

This drives the real `_run_agent`. The fake client calls the real PreToolUse
and Stop hooks off the options it was built with, so what is asserted is what
the run actually did: every Stop return, the messages the host sent, the step
stamped on each turn, and that the session was disconnected once.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from claude_agent_sdk import AssistantMessage, SystemMessage, TextBlock

from e2e import orchestrator
from e2e.orchestrator import _run_agent
from harness.auth import AuthConfig
from tests.unit.test_e2e_context_block import _fixture, _result


class FakeStepClient:
    """One persistent session. Each `query` is a turn; `receive_response` runs
    the real hooks and yields that turn's closing text plus a result."""

    def __init__(self, options):
        self.options = options
        self.sent: list[str] = []
        self.disconnects = 0
        self.stop_returns: list[dict] = []
        self.pretool_returns: list[dict] = []
        self._turns: list[tuple[str | None, str]] = []

    def script(self, turns):
        """[(spawned agent or None, closing text), ...] — one entry per turn."""
        self._turns = list(turns)
        return self

    async def connect(self, _prompt):
        return None

    async def disconnect(self):
        self.disconnects += 1

    async def query(self, text):
        self.sent.append(text)

    def _hook(self, event):
        for matcher in self.options.hooks.get(event, []) or []:
            for callback in getattr(matcher, "hooks", []) or []:
                yield callback

    #: Set to a workspace Path to mark the project completed after the first turn.
    completes_after_first: Path | None = None

    async def receive_response(self):
        index = len(self.sent) - 1
        spawn, text = self._turns[index] if index < len(self._turns) else (None, "done.")
        if index == 0 and self.completes_after_first is not None:
            (self.completes_after_first / "research.json").write_text(
                json.dumps({"project": {"status": "completed"},
                            "questions": [{"id": "q_1", "status": "resolved"}]}),
                encoding="utf-8",
            )
        if spawn:
            for callback in self._hook("PreToolUse"):
                self.pretool_returns.append(
                    await callback({"tool_name": "Task",
                                    "tool_input": {"subagent_type": spawn}}, None, None) or {}
                )
        yield AssistantMessage(content=[TextBlock(text=text)], model="m")
        for callback in self._hook("Stop"):
            self.stop_returns.append(await callback({}, None, None) or {})
        yield _result()


def _drive(tmp_path, monkeypatch, turns, completes=False, **kwargs):
    # `should_continue_run` allows every stop when there is no research.json
    # (issue #3274), so without one the Stop hook returns {} for a reason that
    # has nothing to do with step mode -- and the blocker's guard could be
    # inverted with every assertion still passing. An unfinished project is what
    # makes the veto reachable, which is what these tests are here to observe.
    (tmp_path / "research.json").write_text(
        json.dumps({"project": {"status": "active"},
                    "questions": [{"id": "q_1", "status": "in_progress"}]}),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        orchestrator, "resolve_auth",
        lambda: AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
    )
    made: dict = {}

    def _factory(options=None, **_kw):
        client = FakeStepClient(options).script(turns)
        client.completes_after_first = tmp_path if completes else None
        made["client"] = client
        return client

    monkeypatch.setattr(orchestrator, "ClaudeSDKClient", _factory)
    monkeypatch.setattr(
        orchestrator, "open_query",
        lambda **kw: (_ for _ in ()).throw(AssertionError("a step run must not open_query")),
    )
    result = asyncio.run(_run_agent(fixture=_fixture(tmp_path), workspace=tmp_path,
                                    mcp_server_entry=Path("dummy"), **kwargs))
    made["client"].usage = result[2]
    return made["client"]


OFFER = "The report.\n\nContinue with linking the records?"


def test_no_stop_call_vetoes_a_step_run(tmp_path, monkeypatch):
    """The blocker, asserted on the hook's RETURN rather than on the shape of
    the statement that produces it. With the guard inverted this records three
    `decision: block` returns instead of three empty ones."""
    client = _drive(
        tmp_path, monkeypatch,
        [("research-plan", OFFER), ("person-evidence", OFFER), (None, "Research complete.")],
        step_mode="job",
    )
    assert client.stop_returns, "the Stop hook never ran, so this proves nothing"
    assert all(r == {} for r in client.stop_returns), client.stop_returns


def test_the_host_replies_between_turns(tmp_path, monkeypatch):
    """One session, many turns: the first message is the fixture's, and each
    later one is the host's own reply."""
    client = _drive(
        tmp_path, monkeypatch,
        [("research-plan", OFFER), ("person-evidence", OFFER), (None, "Research complete.")],
        step_mode="job",
    )
    assert len(client.sent) >= 2, client.sent
    assert client.sent[1] == "Keep going.", client.sent


def test_each_turn_records_the_step_it_opened_with(tmp_path, monkeypatch):
    """Read from the gate, not re-derived (ask 2). Asserted on the STEPS the run
    recorded: with the stamp disabled every one is None, and `next_auto_reply`
    then sees no (step, offer) pairs at all — so its repeat guard, which is what
    ends a link-and-assess cycle, can never fire."""
    client = _drive(
        tmp_path, monkeypatch,
        [("research-plan", OFFER), ("person-evidence", OFFER), (None, "Research complete.")],
        step_mode="job",
    )
    assert client.pretool_returns, "no PreToolUse call — the gate never saw a spawn"
    steps = [row.get("step") for row in client.usage.get("per_turn") or []]
    assert steps[:2] == ["research-plan", "person-evidence"], steps


def test_the_session_is_disconnected_exactly_once(tmp_path, monkeypatch):
    """Ask 3. With `live["client"] = step_client` disabled the disconnect can
    never run, and the CLI and its MCP server sit idle through the judge phase."""
    client = _drive(tmp_path, monkeypatch, [(None, "Research complete.")], step_mode="job")
    assert client.disconnects == 1, client.disconnects


ASK = "I found three men called John.\n\nWhich of them is yours?"


def test_the_fixtures_question_is_answered_once_and_the_run_goes_on(tmp_path, monkeypatch):
    """Section F's other arm. A step that ends on a question for the researcher
    makes no offer, so the run used to end there with the fixture's own question
    sitting on file. It is answered, and -- re-review 1 -- the turn that answer
    opens runs as `job`, so the research CONTINUES rather than stopping dead one
    step later."""
    client = _drive(
        tmp_path, monkeypatch,
        [("research-plan", ASK), ("person-evidence", OFFER), (None, "Research complete.")],
        step_mode="job",
    )
    assert client.sent[1] == "Who were John's parents?", client.sent
    assert len(client.sent) >= 3, ("the answer bought one step and the run ended", client.sent)


def test_the_question_is_never_answered_twice(tmp_path, monkeypatch):
    """Re-review's fourth mutation: dropping the latch. A run that asks twice has
    not understood the answer -- that is a finding, not something to paper over
    by repeating ourselves until the cap."""
    client = _drive(
        tmp_path, monkeypatch,
        [("research-plan", ASK), ("person-evidence", ASK), (None, "Research complete.")],
        step_mode="job",
    )
    assert client.sent.count("Who were John's parents?") == 1, client.sent


def test_a_closing_courtesy_question_after_the_conclusion_is_not_answered(tmp_path, monkeypatch):
    """Re-review 2. proof-conclusion ends "Would you like me to look for his
    parents next?" -- no offer line, last line a question, outcome ok. Answering
    it ran a NEW step on a concluded project and changed the very files the judge
    grades."""
    client = _drive(
        tmp_path, monkeypatch,
        [("research-plan", OFFER),
         ("proof-conclusion", "The proof stands.\n\nWould you like me to look for his parents next?")],
        step_mode="job",
    )
    assert "Who were John's parents?" not in client.sent, client.sent


def test_a_question_on_a_completed_project_is_not_answered(tmp_path, monkeypatch):
    """Re-review 2, the other half. The project completed during the run; a
    closing question after that must not restart it."""
    client = _drive(
        tmp_path, monkeypatch,
        [("research-plan", OFFER), ("person-evidence", ASK)],
        step_mode="job", completes=True,
    )
    assert "Who were John's parents?" not in client.sent, client.sent


def test_an_ordinary_run_still_opens_a_query_and_is_vetoed(tmp_path, monkeypatch):
    """The other half of the inverted guard: a run WITHOUT step mode must keep
    the veto. Inverting it drops the veto here, which no step-mode test can see."""
    monkeypatch.setattr(
        orchestrator, "resolve_auth",
        lambda: AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
    )
    monkeypatch.setattr(
        orchestrator, "ClaudeSDKClient",
        lambda **kw: (_ for _ in ()).throw(AssertionError("no step mode: no persistent client")),
    )
    opened: dict = {}

    class _S:
        def __init__(self, msgs):
            self._m = list(msgs)

        def __aiter__(self):
            return self

        async def __anext__(self):
            if not self._m:
                raise StopAsyncIteration
            return self._m.pop(0)

        async def aclose(self):
            return None

    def fake_query(**kw):
        opened["options"] = kw["options"]
        return _S([SystemMessage(subtype="init", data={"session_id": "S1"}), _result()])

    monkeypatch.setattr(orchestrator, "open_query", fake_query)
    asyncio.run(_run_agent(fixture=_fixture(tmp_path), workspace=tmp_path,
                           mcp_server_entry=Path("dummy")))
    assert opened["options"].hooks.get("Stop"), "an ordinary run must still bind the Stop hook"

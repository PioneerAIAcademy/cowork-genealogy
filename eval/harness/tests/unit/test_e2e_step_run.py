"""A step-mode run driven end to end through a fake `ClaudeSDKClient`.

Written because structural tests check the SHAPE of a statement, not what it
does (re-review item 5). This drives the real `_run_agent`. The fake client calls
the real PreToolUse hook off the options it was built with, so what is asserted
is what the run actually did: the hooks it bound, the messages the host sent, the
step stamped on each turn, and that the session was disconnected once.
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
    #: The CLI's init message, yielded before the first turn's messages.
    init: SystemMessage | None = None

    async def receive_response(self):
        index = len(self.sent) - 1
        if index == 0 and self.init is not None:
            yield self.init
        spawn, text = self._turns[index] if index < len(self._turns) else (None, "done.")
        if index == 0 and self.completes_after_first is not None:
            (self.completes_after_first / "research.json").write_text(
                json.dumps({"project": {"status": "completed"},
                            "questions": [{"id": "q_1", "status": "resolved"}]}),
                encoding="utf-8",
            )
        # A list is several spawns in one turn, fired in order -- the shape of a
        # parallel dispatch, which reaches the gate before the model sees a deny.
        for name in (spawn if isinstance(spawn, list) else [spawn] if spawn else []):
            for callback in self._hook("PreToolUse"):
                self.pretool_returns.append(
                    await callback({"tool_name": "Task",
                                    "tool_input": {"subagent_type": name}}, None, None) or {}
                )
        yield AssistantMessage(content=[TextBlock(text=text)], model="m")
        yield _result()


def _drive(tmp_path, monkeypatch, turns, completes=False, init=None, **kwargs):
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
        client.init = init
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
    made["client"].result = result
    return made["client"]


OFFER = "The report.\n\nContinue with linking the records?"


def test_a_step_run_binds_no_stop_hook_and_records_no_nudge_counters(tmp_path, monkeypatch):
    """Step mode phase 2 deleted the e2e Stop veto. A step turn ends at its boundary
    on purpose and the host's reply continues the run, so no Stop hook is bound, and
    the run writes neither nudge counter: a run that could not be nudged must read
    as "not measured" to `nudge_report`, not as "never nudged"."""
    client = _drive(
        tmp_path, monkeypatch,
        [("research-plan", OFFER), ("person-evidence", OFFER), (None, "Research complete.")],
        step_mode="job",
    )
    assert "Stop" not in client.options.hooks, client.options.hooks
    assert "continue_nudges" not in client.usage
    assert "hand_back_classes" not in client.usage


def test_a_dead_genealogy_server_aborts_a_step_run_at_init(tmp_path, monkeypatch):
    """`make agent-smoke`'s dead-stub arm runs `run_e2e` with no `--step-mode`, which
    now means `job`, so the #941 init abort is reached through the persistent client."""
    dead = SystemMessage(
        subtype="init",
        data={"session_id": "S1", "mcp_servers": [{"name": "genealogy", "status": "failed"}]},
    )
    client = _drive(tmp_path, monkeypatch, [("research-plan", OFFER)], init=dead, step_mode="job")
    assert client.result[3] == "mcp_unavailable", client.result[3:5]


def _results(monkeypatch, **fields):
    """Every turn's ResultMessage carries `fields` (cost is a running total)."""
    import sys

    from claude_agent_sdk import ResultMessage

    def _r(session="S1"):
        return ResultMessage(subtype="result", duration_ms=1, duration_api_ms=1,
                             is_error=False, session_id=session,
                             **{"num_turns": 1, **fields})

    monkeypatch.setattr(sys.modules[__name__], "_result", _r)


def test_the_cost_cap_is_reported_and_does_not_stop_a_step_run(tmp_path, monkeypatch):
    """`max_cost_usd` is a reporting threshold (lead, #757; e2e-test-spec.md, the
    `cost_cap` note). A step run COULD stop at a boundary, but stopping would end
    the over-budget runs that pass today (hannah-earnest-children, 4 of 4) before
    proof-conclusion, so the run is labelled `cost_cap` and the host keeps replying."""
    _results(monkeypatch, total_cost_usd=999.0)
    client = _drive(
        tmp_path, monkeypatch,
        [("research-plan", OFFER), ("person-evidence", OFFER), (None, "Research complete.")],
        step_mode="job",
    )
    assert len(client.sent) == 3, client.sent
    assert client.result[3] == "cost_cap", client.result[3:5]


def test_the_turn_cap_still_stops_a_run_already_over_its_cost_cap(tmp_path, monkeypatch):
    """A `cost_cap` label set on an early turn must not switch the turn cap off."""
    _results(monkeypatch, total_cost_usd=999.0, num_turns=200)
    client = _drive(
        tmp_path, monkeypatch,
        [("research-plan", OFFER), ("person-evidence", OFFER), (None, "Research complete.")],
        step_mode="job",
    )
    assert len(client.sent) == 2, client.sent
    assert client.result[3] == "max_turns", client.result[3:5]


def test_the_turn_cap_bounds_the_whole_run_not_one_step(tmp_path, monkeypatch):
    """`num_turns` arrives per turn on a persistent session, so the SDK's own
    `max_turns` stops one step only. The host checks the run's sum."""
    _results(monkeypatch, num_turns=200)
    client = _drive(
        tmp_path, monkeypatch,
        [("research-plan", OFFER), ("person-evidence", OFFER), (None, "Research complete.")],
        step_mode="job",
    )
    assert len(client.sent) == 2, client.sent
    assert client.result[3] == "max_turns", client.result[3:5]


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


def test_the_host_answers_a_turn_the_step_gate_halted(tmp_path, monkeypatch):
    """clark-parents, 2026-11-02: two searches spawned in one message after a hints step.
    The second halts, so the turn ends on "Now dispatching..." with no offer line, and
    the run ended there with nothing searched. The halt named the offer; the host
    answers that, as the prototype worker does."""
    client = _drive(
        tmp_path, monkeypatch,
        [("research-plan", OFFER),
         (["search-hints", "search-records", "search-records"], "Now dispatching both searches."),
         (None, "done.")],
        step_mode="job",
    )
    assert [r.get("continue_") for r in client.pretool_returns][-1] is False, \
        "the second parallel spawn no longer halts, so this proves nothing"
    assert len(client.sent) == 3, client.sent


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


def test_a_run_without_step_mode_opens_a_query_and_binds_no_stop_hook(tmp_path, monkeypatch):
    """Only the single-ask runner calls `_run_agent` without a step mode now. It opens
    a one-shot query, and no veto comes back with it."""
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
    assert "PreToolUse" in opened["options"].hooks
    assert "Stop" not in opened["options"].hooks, opened["options"].hooks

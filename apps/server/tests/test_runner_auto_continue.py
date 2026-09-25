"""Lay mode's auto-continue in the runner's message loop (issue #2653).

A scripted agent whose turns end in whatever text the test hands it. `serve`
must start a `Yes.` turn itself after a hand-back literal and nothing else:
not after a question, not after `Research complete.`, not past the budget,
never ahead of a message the user typed meanwhile, never after an interrupt,
and never for a chain whose first frame opted out (`auto_continue: false`).
"""
import asyncio

import pytest

from app.agent.hand_back import AUTO_CONTINUE_TEXT, HAND_BACK_RE, ends_with_hand_back
from app.agent.runner import AutoContinue, serve

LITERAL = "I found the household in the 1850 census.\n\nNext: choose the first research question. Continue?"
QUESTION = "Two people match that name. Which one is yours?"
COMPLETE = "Every question is answered.\n\nResearch complete."


class ScriptedAgent:
    """Each turn replies with the next text in `replies` (the last one repeats),
    after emitting one subagent-labelled text that must never count as the
    hand-back."""

    def __init__(self, replies):
        self.replies = list(replies)
        self.turns: list[str] = []
        self.interrupted = False

    async def handle_turn(self, text):
        self.turns.append(text)
        reply = self.replies.pop(0) if len(self.replies) > 1 else self.replies[0]
        yield {"kind": "text", "text": LITERAL, "agent": "record-extractor"}
        await asyncio.sleep(0.005)
        yield {"kind": "text", "text": reply}

    async def interrupt(self):
        self.interrupted = True
        return False


class SlowScriptedAgent(ScriptedAgent):
    """Same, but each turn takes long enough for a message to arrive mid-turn."""

    async def handle_turn(self, text):
        self.turns.append(text)
        reply = self.replies.pop(0) if len(self.replies) > 1 else self.replies[0]
        await asyncio.sleep(0.05)
        yield {"kind": "text", "text": reply}


async def _drive(agent, messages, *, auto, settle=0.15):
    """Send `messages` (dicts, or floats meaning 'sleep this long'), let the
    loop settle, return every emitted event."""
    incoming: asyncio.Queue = asyncio.Queue()
    events: list[dict] = []
    task = asyncio.create_task(serve(agent, incoming, events.append, auto_continue=auto))
    for m in messages:
        if isinstance(m, (int, float)):
            await asyncio.sleep(m)
        else:
            await incoming.put(m)
    await asyncio.sleep(settle)
    await incoming.put(None)
    await asyncio.wait_for(task, 2)
    return events


def _kinds(events, kind):
    return [e for e in events if e.get("kind") == kind]


def test_the_literal_is_the_ruled_form():
    assert ends_with_hand_back(LITERAL)
    assert ends_with_hand_back("Next: run the first search. Continue?\n")
    assert not ends_with_hand_back(QUESTION)
    assert not ends_with_hand_back(COMPLETE)
    assert not ends_with_hand_back("Next: search. Continue? Also note x.")
    assert not ends_with_hand_back(None)
    assert HAND_BACK_RE.pattern == r"(?:^|\n)\s*Next: .+\. Continue\?\s*$"


@pytest.mark.asyncio
async def test_a_hand_back_is_answered_with_yes_until_the_chain_ends_on_a_question():
    agent = ScriptedAgent([LITERAL, LITERAL, QUESTION])
    events = await _drive(agent, [{"type": "user_msg", "text": "find the parents"}],
                          auto=AutoContinue(enabled=True, max_steps=30))
    assert agent.turns == ["find the parents", AUTO_CONTINUE_TEXT, AUTO_CONTINUE_TEXT]
    autos = _kinds(events, "auto_continue")
    assert [a["step"] for a in autos] == [1, 2]
    assert all(a["text"] == AUTO_CONTINUE_TEXT and a["max_steps"] == 30 for a in autos)
    # Each synthetic turn announces itself as a queued turn, so the Hub holds the
    # busy gate exactly as it does for a user's queued message.
    starts = _kinds(events, "turn_start")
    assert [s["queued"] for s in starts] == [False, True, True]
    assert len(_kinds(events, "turn_done")) == 3
    assert not _kinds(events, "auto_continue_paused")


@pytest.mark.asyncio
async def test_research_complete_ends_the_chain():
    agent = ScriptedAgent([LITERAL, COMPLETE])
    events = await _drive(agent, [{"type": "user_msg", "text": "go"}],
                          auto=AutoContinue(enabled=True, max_steps=30))
    assert agent.turns == ["go", AUTO_CONTINUE_TEXT]
    assert len(_kinds(events, "auto_continue")) == 1


@pytest.mark.asyncio
async def test_a_subagents_text_never_counts_as_the_hand_back():
    # ScriptedAgent emits a labelled LITERAL before every reply; only the
    # unlabelled final text decides.
    agent = ScriptedAgent([QUESTION])
    events = await _drive(agent, [{"type": "user_msg", "text": "go"}],
                          auto=AutoContinue(enabled=True, max_steps=30))
    assert agent.turns == ["go"]
    assert not _kinds(events, "auto_continue")


@pytest.mark.asyncio
async def test_the_budget_pauses_the_chain_and_says_so():
    agent = ScriptedAgent([LITERAL])  # every turn hands back
    events = await _drive(agent, [{"type": "user_msg", "text": "go"}],
                          auto=AutoContinue(enabled=True, max_steps=2))
    assert agent.turns == ["go", AUTO_CONTINUE_TEXT, AUTO_CONTINUE_TEXT]
    paused = _kinds(events, "auto_continue_paused")
    assert len(paused) == 1
    assert paused[0] == {"kind": "auto_continue_paused", "reason": "budget", "step": 2, "max_steps": 2}


@pytest.mark.asyncio
async def test_the_budget_resets_after_a_real_user_message():
    agent = ScriptedAgent([LITERAL])
    events = await _drive(
        agent,
        [{"type": "user_msg", "text": "go"}, 0.15, {"type": "user_msg", "text": "carry on"}],
        auto=AutoContinue(enabled=True, max_steps=1),
    )
    # First chain: go → Yes. → paused. Second chain: carry on → Yes. → paused.
    assert agent.turns == ["go", AUTO_CONTINUE_TEXT, "carry on", AUTO_CONTINUE_TEXT]
    assert [a["step"] for a in _kinds(events, "auto_continue")] == [1, 1]
    assert len(_kinds(events, "auto_continue_paused")) == 2


@pytest.mark.asyncio
async def test_a_message_typed_during_the_auto_turn_runs_next_and_no_yes_is_injected_ahead_of_it():
    agent = SlowScriptedAgent([LITERAL, LITERAL, QUESTION])
    events = await _drive(
        agent,
        [{"type": "user_msg", "text": "go"}, 0.08, {"type": "user_msg", "text": "actually, stop after the census"}],
        auto=AutoContinue(enabled=True, max_steps=30),
        settle=0.4,
    )
    # Turn 1 ("go") ends with the literal → Yes. starts; the user's message
    # arrives during that auto turn; when it ends (also a literal), the user's
    # message runs, not another Yes.
    assert agent.turns[:3] == ["go", AUTO_CONTINUE_TEXT, "actually, stop after the census"]
    autos = _kinds(events, "auto_continue")
    assert autos[0]["step"] == 1
    # The user's message reset the count, so the chain after it restarts at 1.
    assert all(a["step"] == 1 for a in autos[1:2])


@pytest.mark.asyncio
async def test_an_interrupt_mid_literal_does_not_continue():
    class Interruptible(ScriptedAgent):
        async def handle_turn(self, text):
            self.turns.append(text)
            yield {"kind": "text", "text": LITERAL}  # the literal is already recorded…
            await asyncio.sleep(10)  # …and the turn is still running when Stop arrives

    agent = Interruptible([LITERAL])
    events = await _drive(
        agent,
        [{"type": "user_msg", "text": "go"}, 0.05, {"type": "interrupt"}],
        auto=AutoContinue(enabled=True, max_steps=30),
    )
    assert agent.turns == ["go"]
    assert not _kinds(events, "auto_continue")
    assert any(e.get("text") == "(stopped)" for e in _kinds(events, "error"))


@pytest.mark.asyncio
async def test_an_error_after_the_literal_does_not_continue():
    # The real agent emits `error` after the text blocks when a later assistant
    # message or the result frame fails; the web refuses Continue on an error
    # bubble, so the runner must refuse too or a failing key burns the budget.
    class Errs(ScriptedAgent):
        async def handle_turn(self, text):
            self.turns.append(text)
            yield {"kind": "text", "text": LITERAL}
            yield {"kind": "error", "text": "The API key was rejected."}

    agent = Errs([LITERAL])
    events = await _drive(
        agent, [{"type": "user_msg", "text": "go"}], auto=AutoContinue(enabled=True, max_steps=30)
    )
    assert agent.turns == ["go"]
    assert not _kinds(events, "auto_continue")


@pytest.mark.asyncio
async def test_disabled_never_continues():
    agent = ScriptedAgent([LITERAL])
    events = await _drive(agent, [{"type": "user_msg", "text": "go"}],
                          auto=AutoContinue(enabled=False, max_steps=30))
    assert agent.turns == ["go"]
    assert not _kinds(events, "auto_continue")
    assert not _kinds(events, "auto_continue_paused")


@pytest.mark.asyncio
async def test_a_frame_that_opts_out_starts_a_chain_that_never_continues():
    """What a frame carrying `auto_continue: false` asks for: a caller that
    reads the first turn_done as the reply would otherwise be handed a Yes. turn
    behind it as the answer to its next message."""
    agent = ScriptedAgent([LITERAL])
    events = await _drive(agent, [{"type": "user_msg", "text": "go", "auto_continue": False}],
                          auto=AutoContinue(enabled=True, max_steps=30))
    assert agent.turns == ["go"]
    assert not _kinds(events, "auto_continue")


@pytest.mark.asyncio
async def test_serve_without_the_option_behaves_as_before():
    """Callers that predate the option (the existing tests pass no keyword)."""
    agent = ScriptedAgent([LITERAL])
    incoming: asyncio.Queue = asyncio.Queue()
    events: list[dict] = []
    task = asyncio.create_task(serve(agent, incoming, events.append))
    await incoming.put({"type": "user_msg", "text": "go"})
    await asyncio.sleep(0.1)
    await incoming.put(None)
    await asyncio.wait_for(task, 2)
    assert agent.turns == ["go"]
    assert not _kinds(events, "auto_continue")


def test_from_env_reads_the_two_settings():
    assert AutoContinue.from_env({}) == AutoContinue(enabled=True, max_steps=30)
    assert AutoContinue.from_env({"AUTO_CONTINUE": "0"}).enabled is False
    assert AutoContinue.from_env({"AUTO_CONTINUE_MAX_STEPS": "5"}).max_steps == 5
    assert AutoContinue.from_env({"AUTO_CONTINUE_MAX_STEPS": "x"}).max_steps == 30

"""A second user message sent while a turn is running must still be answered.

THE DEFECT (issue #2062). The hosted chat answered the PREVIOUS message and kept
doing so; one tester hit it four times in 38 minutes, and in one report the agent
concluded the user's screen was broken and repeated itself. An agent one turn
behind cannot detect that it is one turn behind, which is why this cannot be
fixed in a prompt.

The mechanism spans three files and each half looks reasonable alone:

1. `sandbox_server.Hub.handle` records the `user_msg` into the replay history and
   sets `_turn_active`, THEN forwards it. So the message is in the transcript the
   user is looking at.
2. `runner.serve` dropped it on the floor with a bare `continue` when a turn was
   already running.
3. `docs/specs/public-rest-api-spec.md` asserts the opposite - "the in-sandbox
   runner is sequential (it won't read the next `user_msg` until the current turn
   emits `turn_done`)" - which is the behaviour these tests pin, and which the
   code did not have.

The user therefore saw their message appear, never got an answer to it, and read
the previous turn's completion as the answer. It PERSISTS because every later
message sent while busy meets the same fate.

WHY NO EXISTING SUITE CAUGHT IT: nothing exercises a second user turn. Every unit
test feeds one prompt per run and the e2e fixtures are single-objective, so this
class of defect was structurally invisible - which is why it reached a tester
before it reached us.
"""
import asyncio

import pytest

from app.agent.runner import serve


class SlowAgent:
    """One turn that takes long enough for a second message to arrive during it."""

    def __init__(self, per_turn: float = 0.10):
        self.per_turn = per_turn
        self.turns: list[str] = []

    async def handle_turn(self, text):
        self.turns.append(text)
        yield {"kind": "text", "text": f"answering {text}"}
        await asyncio.sleep(self.per_turn)
        yield {"kind": "text", "text": f"done {text}"}

    async def interrupt(self):
        return True


async def _drive(agent, messages, gap: float = 0.01, settle: float = 1.5):
    """Push `messages` back to back, then let everything finish."""
    incoming: asyncio.Queue = asyncio.Queue()
    events: list[dict] = []
    task = asyncio.create_task(serve(agent, incoming, events.append))
    for m in messages:
        await incoming.put({"type": "user_msg", "text": m})
        await asyncio.sleep(gap)
    await asyncio.sleep(settle)
    await incoming.put(None)
    await asyncio.wait_for(task, 5)
    return events


def _answered(events: list[dict]) -> list[str]:
    return [str(e.get("text", "")).removeprefix("answering ")
            for e in events if str(e.get("text", "")).startswith("answering ")]


def test_a_message_sent_while_busy_is_answered_not_dropped():
    """THE REGRESSION. Pre-fix this leaves `second` unanswered forever, which is
    exactly what the tester saw: the message is in the transcript, and the reply
    that arrives belongs to the previous one."""
    agent = SlowAgent()
    events = asyncio.run(_drive(agent, ["first", "second"]))

    assert agent.turns == ["first", "second"], (
        f"the runner ran {agent.turns}; a message sent while busy was dropped, so the "
        f"user will read the previous turn's completion as its answer"
    )
    assert _answered(events) == ["first", "second"]


def test_every_turn_still_emits_exactly_one_turn_done():
    """The contract the client keys its busy state on, and the one a queue could
    quietly break: `_run_turn` is the sole source of `turn_done`, one per turn."""
    agent = SlowAgent()
    events = asyncio.run(_drive(agent, ["first", "second", "third"]))

    assert agent.turns == ["first", "second", "third"]
    assert sum(1 for e in events if e.get("kind") == "turn_done") == 3


def test_queued_turns_run_in_the_order_they_were_sent():
    """Answering out of order would be the same bug wearing different clothes."""
    agent = SlowAgent(per_turn=0.05)
    events = asyncio.run(_drive(agent, ["a", "b", "c", "d"]))
    assert agent.turns == ["a", "b", "c", "d"]
    assert _answered(events) == ["a", "b", "c", "d"]


def test_an_idle_runner_still_starts_a_turn_immediately():
    """The other direction: queueing must not delay the common case."""
    agent = SlowAgent(per_turn=0.0)
    events = asyncio.run(_drive(agent, ["only"], settle=0.3))
    assert agent.turns == ["only"]
    assert sum(1 for e in events if e.get("kind") == "turn_done") == 1


def test_the_backlog_is_bounded_and_says_so_rather_than_dropping_silently():
    """A bound is needed - the client's busy gate is what should prevent a
    backlog, and issue #2062 is a report of that gate leaking - but an overflow
    must be VISIBLE. Dropping silently past a limit would reintroduce the defect
    for message N+1, which is the failure this whole file is about.
    """
    from app.agent import runner

    agent = SlowAgent(per_turn=0.6)
    n = runner.MAX_QUEUED_TURNS + 3
    events = asyncio.run(_drive(agent, [f"m{i}" for i in range(n)], gap=0.002, settle=3.0))

    assert len(agent.turns) <= runner.MAX_QUEUED_TURNS + 1
    dropped = [e for e in events if "too many" in str(e.get("text", "")).lower()]
    assert dropped, (
        "the backlog overflowed and nothing told the user; that is the silent drop "
        "this fix exists to remove, moved to a higher message number"
    )

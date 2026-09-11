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


def test_a_stop_discards_the_backlog_it_was_pressed_on():
    """Stop means stop. A person who queued a message and then pressed Stop does
    not want it starting on its own a moment later.

    `serve` clears `pending` in the interrupt branch, and every other test in
    this file passes with that line deleted - the queue simply drains after the
    cancellation instead. So this is the only thing standing between a refactor
    and a message the user cancelled being answered anyway.
    """
    agent = SlowAgent(per_turn=0.10)

    async def drive():
        incoming: asyncio.Queue = asyncio.Queue()
        events: list[dict] = []
        task = asyncio.create_task(serve(agent, incoming, events.append))
        await incoming.put({"type": "user_msg", "text": "first"})
        await asyncio.sleep(0.01)
        await incoming.put({"type": "user_msg", "text": "second"})  # queues behind first
        await asyncio.sleep(0.01)
        await incoming.put({"type": "interrupt"})                   # the user presses Stop
        await asyncio.sleep(1.0)
        await incoming.put(None)
        await asyncio.wait_for(task, 5)
        return events

    asyncio.run(drive())

    assert "second" not in agent.turns, (
        "a message queued before Stop was answered after it; the interrupt must "
        f"discard the backlog, but the agent ran {agent.turns}"
    )


def test_every_turn_announces_itself_and_the_queued_flag_still_distinguishes():
    """EVERY turn emits `turn_start`; `queued` says which kind it is.

    WHY. Without an announcement a turn's only frames are the agent's own plus
    the terminal `turn_done`, so before its first frame there is a silence the
    length of a full SDK round trip, and two consumers read that silence as
    "idle":

      * `app/v1.py::_drain_replay` returns after `_DRAIN_IDLE` of quiet, so a
        caller could send inside the gap and then read the RUNNING turn's
        `turn_done` as its own reply.
      * `sandbox_server` clears `_turn_active` on every `turn_done`, so the UI
        went idle while messages were still queued.

    THIS FIRED ONLY FOR QUEUED TURNS AT FIRST, and this test asserted that. The
    reasoning was "the first turn's sender already knows it sent it" - which is
    about the SENDER, while the consumer that matters is the DRAIN. A sync
    `POST /messages` starts an UNqueued turn, so on its 504 retry there was no
    `turn_start` at all, `in_flight` stayed 0, and the drain returned inside the
    running turn. Review round 3 on issue #2062.

    The `queued` flag is asserted per turn rather than just counted, because
    emitting `turn_start` unconditionally with a hardcoded `queued: True` would
    satisfy a count and lose the distinction the client uses.
    """
    agent = SlowAgent()
    events = asyncio.run(_drive(agent, ["first", "second", "third"]))
    starts = [e for e in events if e.get("kind") == "turn_start"]

    assert _answered(events) == ["first", "second", "third"]
    assert len(starts) == 3, (
        f"expected one turn_start per turn (3 of 3), got {len(starts)}"
    )
    assert [e.get("queued") for e in starts] == [False, True, True], (
        "the first turn is not queued and the two behind it are; a hardcoded "
        "queued flag would pass the count above and lose what the client reads"
    )

    # Ordering is the property the consumers rely on: every turn's announcement
    # lands before its own frames, and each queued one after the previous
    # turn_done, so there is no window a drain can mistake for idle.
    kinds = [e.get("kind") for e in events if e.get("kind") in ("turn_start", "turn_done")]
    assert kinds == [
        "turn_start", "turn_done", "turn_start", "turn_done", "turn_start", "turn_done",
    ], kinds


def test_a_lone_turn_still_announces_itself():
    """The single-turn case: the one a sync POST /messages starts.

    This is the exact shape the drain missed. It used to assert NO `turn_start`
    here, which is what made the first-turn gap invisible.
    """
    agent = SlowAgent()
    events = asyncio.run(_drive(agent, ["only"]))
    assert _answered(events) == ["only"]
    starts = [e for e in events if e.get("kind") == "turn_start"]
    assert len(starts) == 1, f"a lone turn must announce itself, got {len(starts)}"
    assert starts[0].get("queued") is False

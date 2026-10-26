"""The e2e turn loop: one session, many turns (section F).

Driven by a fake client supplying the three `ClaudeSDKClient` methods the loop
uses, so none of this needs a live CLI. What is tested is the SEQUENCING and the
two caps -- the reply DECISION is injected and belongs to
`step_boundary.next_auto_reply`, which has its own tests.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / "eval" / "harness"))

from e2e.turn_loop import (  # noqa: E402
    STOP_ABORTED,
    STOP_NO_REPLY,
    STOP_REPLY_CAP,
    STOP_SILENCE,
    run_turns,
    stream_turns,
)


class FakeClient:
    """`query` records, `receive_response` yields that turn's canned messages.

    One list of message-lists, consumed in order: turn N gets `turns[N]`. A turn
    past the end yields nothing, which is how a fake run ends.
    """

    def __init__(self, turns: list[list[str]], *, stall_on: int | None = None,
                 raise_on: int | None = None) -> None:
        self._turns = turns
        self._stall_on = stall_on
        self._raise_on = raise_on
        self.sent: list[str] = []

    async def query(self, prompt: str, session_id: str = "default") -> None:
        self.sent.append(prompt)

    def receive_response(self):
        index = len(self.sent) - 1

        async def stream():
            if self._raise_on == index:
                raise RuntimeError("the CLI died")
            if self._stall_on == index:
                await asyncio.sleep(3600)  # never yields; the per-message timeout fires
            for message in (self._turns[index] if index < len(self._turns) else []):
                yield message

        return stream()


def drive(client, replies, **kw):
    """`run_turns` with a canned reply per turn index, then None."""
    def decide(turn):
        return replies[turn.index] if turn.index < len(replies) else None

    return asyncio.run(
        run_turns(
            client=client,
            first_message="find his parents",
            decide_reply=kw.pop("decide_reply", decide),
            max_replies=kw.pop("max_replies", 30),
            timeout_s=kw.pop("timeout_s", 30),
            **kw,
        )
    )


def test_one_turn_with_no_reply_due_is_the_whole_run():
    client = FakeClient([["report"]])
    out = drive(client, [])
    assert out.stop == STOP_NO_REPLY
    assert client.sent == ["find his parents"]
    assert len(out.turns) == 1 and out.replies_sent == 0


def test_each_reply_opens_another_turn_on_the_same_session():
    """The point of the rewrite: before step mode this was ONE query, so a turn
    that ended after one step ended the run."""
    client = FakeClient([["a"], ["b"], ["c"]])
    out = drive(client, ["Keep going.", "Keep going."])
    assert client.sent == ["find his parents", "Keep going.", "Keep going."]
    assert [t.sent for t in out.turns] == ["find his parents", "Keep going.", "Keep going."]
    assert [t.reply for t in out.turns] == ["Keep going.", "Keep going.", None]
    assert out.stop == STOP_NO_REPLY and out.replies_sent == 2


def test_every_message_of_a_turn_is_handed_to_the_caller_in_order():
    """The orchestrator folds these exactly as it folded the one-shot stream, so
    nothing downstream has to know a turn boundary exists."""
    client = FakeClient([["m1", "m2"], ["m3"]])
    seen: list[tuple[int, str]] = []
    drive(client, ["Continue."], on_message=lambda m, t: seen.append((t.index, m)))
    assert seen == [(0, "m1"), (0, "m2"), (1, "m3")]


def test_the_caller_can_stamp_the_step_before_the_reply_is_decided():
    """`decide_reply` reads `turn.step`, so `on_message` has to have run first --
    otherwise the host would decide every reply against a step of None."""
    client = FakeClient([["spawn:search-records"], ["spawn:person-evidence"]])

    def on_message(message, turn):
        if message.startswith("spawn:"):
            turn.step = message.split(":", 1)[1]

    steps_at_decision: list[str | None] = []

    def decide(turn):
        steps_at_decision.append(turn.step)
        return "Keep going." if turn.index == 0 else None

    drive(client, [], decide_reply=decide, on_message=on_message)
    assert steps_at_decision == ["search-records", "person-evidence"]


def test_an_async_decide_reply_is_awaited():
    """The orchestrator's reads research.json; forcing it sync would put a
    blocking read on the event loop."""
    client = FakeClient([["a"], ["b"]])

    async def decide(turn):
        await asyncio.sleep(0)
        return "Keep going." if turn.index == 0 else None

    out = drive(client, [], decide_reply=decide)
    assert out.replies_sent == 1 and out.stop == STOP_NO_REPLY


def test_the_reply_cap_stops_the_run_and_is_not_the_fixture_failing():
    """A runaway guard. `max_replies=2` means two replies SENT, so three turns."""
    client = FakeClient([["a"], ["b"], ["c"], ["d"], ["e"]])
    out = drive(client, ["Keep going."] * 9, max_replies=2)
    assert out.stop == STOP_REPLY_CAP
    assert out.replies_sent == 2, [t.sent for t in out.turns]
    assert len(client.sent) == 3


def test_the_cap_is_checked_before_sending_so_it_never_buys_an_extra_turn():
    client = FakeClient([["a"], ["b"], ["c"]])
    out = drive(client, ["Keep going."] * 5, max_replies=0)
    assert out.stop == STOP_REPLY_CAP
    assert client.sent == ["find his parents"], "a cap of 0 still runs the fixture's own turn"


def test_silence_inside_a_turn_ends_the_run_with_the_stall_reason():
    client = FakeClient([["a"], []], stall_on=1)
    out = drive(client, ["Keep going."], timeout_s=0.05)
    assert out.stop == STOP_SILENCE
    # The stalled turn is still recorded, with the time it burned.
    assert len(out.turns) == 2 and out.turns[-1].sent == "Keep going."


def test_a_raising_turn_is_recorded_rather_than_swallowed():
    client = FakeClient([["a"], []], raise_on=1)
    out = drive(client, ["Keep going."])
    assert out.stop == STOP_ABORTED
    assert isinstance(out.error, RuntimeError) and "CLI died" in str(out.error)
    assert len(out.turns) == 2


def test_wall_time_is_recorded_per_turn_not_per_run():
    """"How long does a researcher wait for ONE response" is the headline, and a
    whole-run figure cannot answer it."""
    client = FakeClient([["a"], ["b"]])
    out = drive(client, ["Keep going."])
    assert all(isinstance(t.wall_ms, int) and t.wall_ms >= 0 for t in out.turns)
    assert len(out.turns) == 2


@pytest.mark.parametrize("reply", ["", None])
def test_an_empty_reply_ends_the_run_rather_than_sending_a_blank_turn(reply):
    """A blank message would start a turn with no instruction and be billed for
    it. `None` and `""` both mean "nothing more is due"."""
    client = FakeClient([["a"], ["b"]])
    out = drive(client, [reply])
    assert out.stop == STOP_NO_REPLY
    assert client.sent == ["find his parents"]


# ── stream_turns: the shape the orchestrator consumes ───────────────────────────


def stream(client, replies, *, max_replies=30):
    """Collect `stream_turns`' flat message stream plus the turns it recorded."""
    turns: list = []
    seen: list = []

    async def go():
        def decide(turn):
            return replies[turn.index] if turn.index < len(replies) else None

        agen = stream_turns(
            client=client,
            first_message="find his parents",
            decide_reply=decide,
            turns=turns,
            max_replies=max_replies,
        )
        async for message in agen:
            seen.append(message)

    asyncio.run(go())
    return seen, turns


def test_the_stream_is_flat_across_turns_so_the_message_loop_is_untouched():
    """The orchestrator's loop ends on StopAsyncIteration. Flattening means that
    now arrives at the end of the RUN rather than the end of turn one -- which is
    the entire reason this shape exists."""
    client = FakeClient([["a1", "a2"], ["b1"], ["c1"]])
    seen, turns = stream(client, ["Keep going.", "Keep going."])
    assert seen == ["a1", "a2", "b1", "c1"]
    assert len(turns) == 3
    assert client.sent == ["find his parents", "Keep going.", "Keep going."]


def test_turns_is_appended_in_place_so_the_caller_can_read_the_current_turn():
    """`turns[-1]` is the turn each message belongs to while the stream runs --
    how the caller stamps `step` before `decide_reply` asks for it. A generator's
    return value is unreachable from `async for`, so in-place is not a style
    choice."""
    client = FakeClient([["a"], ["b"]])
    turns: list = []
    indices: list[int] = []

    async def go():
        agen = stream_turns(
            client=client,
            first_message="go",
            decide_reply=lambda t: "Keep going." if t.index == 0 else None,
            turns=turns,
            max_replies=30,
        )
        async for _ in agen:
            indices.append(turns[-1].index)

    asyncio.run(go())
    assert indices == [0, 1]


def test_stream_turns_records_the_same_per_turn_fields_run_turns_does():
    client = FakeClient([["a"], ["b"]])
    _, turns = stream(client, ["Keep going."])
    assert [t.sent for t in turns] == ["find his parents", "Keep going."]
    assert [t.reply for t in turns] == ["Keep going.", None]
    assert all(isinstance(t.wall_ms, int) for t in turns)
    assert [t.messages for t in turns] == [["a"], ["b"]]


def test_the_reply_cap_bounds_the_stream_too():
    client = FakeClient([["a"], ["b"], ["c"], ["d"]])
    seen, turns = stream(client, ["Keep going."] * 9, max_replies=1)
    assert len(turns) == 2 and seen == ["a", "b"]
    assert client.sent == ["find his parents", "Keep going."]


def test_a_blank_reply_ends_the_stream_rather_than_sending_an_empty_turn():
    client = FakeClient([["a"], ["b"]])
    seen, turns = stream(client, ["   "])
    assert seen == ["a"] and len(turns) == 1
    assert client.sent == ["find his parents"]


def test_stream_turns_waits_rather_than_timing_out_on_a_silent_turn():
    """Silence is the CALLER's to detect: the orchestrator relabels a Windows
    sleep before treating it as a stall, and a deadline inside this generator
    would fire first on a long step and bypass that.

    Behavioural, not a source grep: a stalled turn must still be waiting when a
    window far longer than any sane internal deadline has passed, and the
    TimeoutError must come from the wrapper here rather than from the generator.
    """
    client = FakeClient([["a"], []], stall_on=1)
    turns: list = []

    async def go():
        agen = stream_turns(
            client=client,
            first_message="go",
            decide_reply=lambda t: "Keep going." if t.index == 0 else None,
            turns=turns,
            max_replies=30,
        )
        async for _ in agen:
            pass

    with pytest.raises(asyncio.TimeoutError):
        asyncio.run(asyncio.wait_for(go(), timeout=0.2))
    # It reached the stalled second turn and was still waiting there.
    assert len(turns) == 2 and turns[-1].sent == "Keep going."

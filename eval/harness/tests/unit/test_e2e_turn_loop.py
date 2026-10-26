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
    Turn,
    accumulate_usage,
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


# ── accumulate_usage: the run total, plus decision 28's per-turn breakdown ───────


def _turn(index, *, step=None, wall_ms=0, sent="go", reply=None, **usage):
    t = Turn(index=index, sent=sent)
    t.step, t.wall_ms, t.reply = step, wall_ms, reply
    t.usage = usage or None
    return t


def test_the_top_level_figures_are_the_whole_run_not_the_last_turn():
    """The defect this exists for. The orchestrator ASSIGNS usage from each
    `ResultMessage`, and a persistent session delivers one per turn, so a 12 turn
    run would have recorded the 12th turn's cost as the run's. Four readers take
    these as the run's figures and the spend cap was sized from them."""
    turns = [
        _turn(0, duration_ms=1000, duration_api_ms=800, num_turns=3, total_cost_usd=1.5),
        _turn(1, duration_ms=2000, duration_api_ms=1500, num_turns=4, total_cost_usd=2.5),
        _turn(2, duration_ms=500, duration_api_ms=400, num_turns=1, total_cost_usd=0.25),
    ]
    out = accumulate_usage(turns)
    assert out["total_cost_usd"] == 4.25
    assert out["duration_ms"] == 3500
    assert out["duration_api_ms"] == 2700
    assert out["num_turns"] == 8


def test_the_ending_fields_come_from_the_last_turn_not_the_sum():
    """`is_error` and `stop_reason` describe how the run ENDED. Summing them is
    not defined, and an early turn's clean stop must not stand as the run's."""
    turns = [
        _turn(0, total_cost_usd=1.0, is_error=False, stop_reason="end_turn"),
        _turn(1, total_cost_usd=1.0, is_error=True, stop_reason="max_turns"),
    ]
    out = accumulate_usage(turns)
    assert out["is_error"] is True and out["stop_reason"] == "max_turns"


def test_token_counts_are_summed_field_by_field():
    turns = [
        _turn(0, usage={"input_tokens": 100, "output_tokens": 10, "cache_read_input_tokens": 5}),
        _turn(1, usage={"input_tokens": 200, "output_tokens": 20}),
    ]
    out = accumulate_usage(turns)
    assert out["usage"] == {"input_tokens": 300, "output_tokens": 30, "cache_read_input_tokens": 5}


def test_a_non_numeric_token_field_is_carried_rather_than_added_or_dropped():
    """The SDK has carried nested per-server dicts here. Adding one is undefined;
    dropping it loses a field readers have."""
    turns = [
        _turn(0, usage={"input_tokens": 100, "server_tool_use": {"web_search_requests": 1}}),
        _turn(1, usage={"input_tokens": 200, "server_tool_use": {"web_search_requests": 4}}),
    ]
    out = accumulate_usage(turns)
    assert out["usage"]["input_tokens"] == 300
    assert out["usage"]["server_tool_use"] == {"web_search_requests": 4}


def test_the_per_turn_breakdown_carries_step_and_wall_time():
    """Decision 28 wants cost per step and the wait per step. `step` and
    `wall_ms` come from the turn, not the ResultMessage."""
    turns = [
        _turn(0, step="search-records", wall_ms=1000, sent="go", reply="Keep going.",
              total_cost_usd=1.5, num_turns=3),
        _turn(1, step="person-evidence", wall_ms=2000, sent="Keep going.",
              total_cost_usd=2.5, num_turns=4),
    ]
    out = accumulate_usage(turns)
    assert [(p["step"], p["wall_ms"], p["total_cost_usd"]) for p in out["per_turn"]] == [
        ("search-records", 1000, 1.5),
        ("person-evidence", 2000, 2.5),
    ]
    assert out["per_turn"][0]["reply"] == "Keep going."


def test_a_turn_that_recorded_no_usage_still_appears_in_the_breakdown():
    """A turn killed before its ResultMessage still happened, and still cost the
    researcher the wait. Leaving it out would make the breakdown disagree with
    the turn count."""
    turns = [_turn(0, step="search-records", wall_ms=900, total_cost_usd=1.0),
             _turn(1, step="person-evidence", wall_ms=120000)]
    out = accumulate_usage(turns)
    assert len(out["per_turn"]) == 2
    assert out["per_turn"][1]["wall_ms"] == 120000
    assert "total_cost_usd" not in out["per_turn"][1]
    assert out["total_cost_usd"] == 1.0


def test_a_run_with_no_usage_at_all_returns_empty_rather_than_zeroes():
    """A skeleton of zeroes is indistinguishable from a real run that cost
    nothing, and `inventory` counts a run as costed on a non-null
    `total_cost_usd`."""
    assert accumulate_usage([_turn(0), _turn(1)]) == {}
    assert accumulate_usage([]) == {}


def test_a_single_turn_run_reads_exactly_as_it_did_before():
    """Every committed run has one turn's worth of usage. The totals must equal
    that turn's figures, or new runs stop being comparable with the corpus."""
    only = _turn(0, duration_ms=900, num_turns=7, total_cost_usd=8.25,
                 is_error=False, stop_reason="end_turn",
                 usage={"input_tokens": 1000, "output_tokens": 100})
    out = accumulate_usage([only])
    for key in ("duration_ms", "num_turns", "total_cost_usd", "is_error", "stop_reason"):
        assert out[key] == only.usage[key], key
    assert out["usage"] == only.usage["usage"]


def test_a_boolean_is_never_summed_as_a_number():
    """`True` is an `int` in Python, so an unguarded `isinstance(v, (int, float))`
    adds it. The guard has to be tested where it APPLIES -- on a SUMMED key and
    on a token field -- not on `is_error`, which is never summed whatever its
    type. An earlier version of this test used `is_error` and passed with the
    guard deleted.
    """
    malformed = Turn(index=0, sent="go")
    malformed.usage = {
        "num_turns": True,          # a summed key carrying a bool
        "total_cost_usd": 2.0,
        "usage": {"input_tokens": 100, "cache_hit": True},  # a token field carrying one
    }
    sane = Turn(index=1, sent="Keep going.")
    sane.usage = {"num_turns": 3, "total_cost_usd": 1.0, "usage": {"input_tokens": 50}}

    out = accumulate_usage([malformed, sane])
    # The bool is not counted as 1: the sum is the one real figure.
    assert out["num_turns"] == 3, out
    assert out["total_cost_usd"] == 3.0
    assert out["usage"]["input_tokens"] == 150
    # And it is carried rather than added or dropped.
    assert out["usage"]["cache_hit"] is True

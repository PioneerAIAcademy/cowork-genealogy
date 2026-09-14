"""Stop mid-turn must not leave the SDK stream owing a terminal frame.

THE DEFECT. `handle_turn` breaks out of its receive loop at the ResultMessage.
When the generator is abandoned at a `yield` instead - which is what Stop does,
via `_run_turn`'s cancellation - that loop never runs again, so the turn's tail
INCLUDING its ResultMessage stays queued. The next turn calls `client.query()`
and `receive_response()` reads the stale terminal frame first and returns
immediately: the new turn delivers nothing, its own frames stay unread, and the
stream is one turn behind from then on. Same user-visible symptom as the
drop-on-busy seam in `runner.serve`, by a different route, and it persists.

WHAT THE FAKE MODELS, because getting this wrong makes the test lie. A new client
means a NEW stream: `_close_client` sets `_client = None` and `_ensure_client`
builds a fresh one. A fake that hands back the same object on every call cannot
show the fix working at all - the first version of this test did exactly that and
reported the defect still reproducing after the guard had fired.
"""
import asyncio
from pathlib import Path

import pytest
from claude_agent_sdk import ResultMessage
from claude_agent_sdk.types import StreamEvent

from app.agent import real_agent


def _result() -> ResultMessage:
    return ResultMessage(
        subtype="success", duration_ms=1, duration_api_ms=1, is_error=False,
        num_turns=1, session_id="s1", total_cost_usd=0.0,
        usage={"input_tokens": 1, "output_tokens": 1},
    )


def _delta(text: str) -> StreamEvent:
    return StreamEvent(
        uuid="u", session_id="s1",
        event={"type": "content_block_delta", "delta": {"type": "text_delta", "text": text}},
    )


class FakeClient:
    """One SDK client and its one stream."""

    def __init__(self, tag: int):
        self.tag = tag
        self.q: asyncio.Queue = asyncio.Queue()
        self.queries: list[str] = []
        self.disconnected = False

    async def query(self, text: str) -> None:
        self.queries.append(text)

    async def receive_messages(self):
        while True:
            yield await self.q.get()

    async def receive_response(self):
        async for m in self.receive_messages():
            yield m
            if isinstance(m, ResultMessage):
                return

    async def disconnect(self) -> None:
        self.disconnected = True


def _agent(tmp_path: Path):
    """A RealAgent whose client factory behaves like the real one: a fresh client
    with a fresh stream whenever the cached one has been dropped."""
    agent = real_agent.RealAgent(tmp_path)
    made: list[FakeClient] = []

    async def _ensure():
        if agent._client is None:
            made.append(FakeClient(len(made) + 1))
            agent._client = made[-1]
        return agent._client

    agent._ensure_client = _ensure  # type: ignore[assignment]
    return agent, made


async def _feed_when_ready(agent, made, index: int, frames) -> None:
    """Feed `frames` into client #index once handle_turn has created it.

    Turn 2 runs against a FRESH client whose queue starts empty, so
    `receive_response()` blocks on it immediately. Feeding only after the first
    event arrives therefore deadlocks - the first version of this file did that
    and hung. The client also cannot be pre-created: the guard runs at the start
    of handle_turn and would close whatever is cached, so the new one does not
    exist until it has run.
    """
    for _ in range(2000):
        if len(made) > index:
            for f in frames:
                await made[index].q.put(f)
            return
        await asyncio.sleep(0.001)
    raise AssertionError(f"client #{index + 1} was never created")


def _texts(events: list[dict]) -> list[str]:
    # `text_delta`, not `text`: map_message emits the incremental kind for a
    # StreamEvent. Asserted the wrong one first and read a delivered answer as a
    # missing one, which is the failure mode this whole file is about.
    return [str(e.get("text", "")) for e in events if e.get("kind") in ("text", "text_delta")]


@pytest.mark.asyncio
async def test_a_turn_after_a_stop_answers_its_own_message(tmp_path):
    """THE REGRESSION. Pre-fix, turn 2 emits zero text: it reads turn 1's
    leftover ResultMessage and ends before its own frames are touched."""
    agent, made = _agent(tmp_path)

    # Turn 1, abandoned after one event. Stop lands here.
    await (await agent._ensure_client()).q.put(_delta("turn one partial"))
    gen = agent.handle_turn("one")
    await gen.__anext__()
    await gen.aclose()
    assert agent._stream_dirty, "the turn never read its ResultMessage; the stream owes one"

    # Turn 1's terminal frame arrives with nobody reading it.
    await made[0].q.put(_result())

    # Turn 2, fed concurrently once its fresh client exists.
    feeder = asyncio.create_task(
        _feed_when_ready(agent, made, 1, [_delta("turn two real answer"), _result()])
    )
    events = [ev async for ev in agent.handle_turn("two")]
    await feeder

    assert made[0].disconnected, "the stale client was reused; its tail is still queued"
    assert len(made) == 2, "a fresh client (and so a fresh stream) was not built"
    assert made[1].queries == ["two"]
    assert "turn two real answer" in _texts(events), (
        f"turn 2 delivered {_texts(events)} - it ended on the previous turn's terminal "
        f"frame instead of answering the message that was actually sent"
    )
    assert not agent._stream_dirty


@pytest.mark.asyncio
async def test_a_completed_turn_does_not_rebuild_the_client(tmp_path):
    """The other direction, and the one that decides whether this is affordable.
    A clean turn must cost nothing: no respawn, no dropped client."""
    agent, made = _agent(tmp_path)
    client = await agent._ensure_client()
    await client.q.put(_delta("hello"))
    await client.q.put(_result())

    events = [ev async for ev in agent.handle_turn("first")]
    assert "hello" in _texts(events)
    assert not agent._stream_dirty, "a turn that read its ResultMessage still owes nothing"

    await client.q.put(_delta("second answer"))
    await client.q.put(_result())
    events2 = [ev async for ev in agent.handle_turn("second")]

    assert "second answer" in _texts(events2)
    assert len(made) == 1, "the client was rebuilt on a clean turn; Stop is rare, turns are not"
    assert not made[0].disconnected
    assert made[0].queries == ["first", "second"]


@pytest.mark.asyncio
async def test_two_stops_in_a_row_each_get_a_clean_stream(tmp_path):
    """It has to be idempotent: the desync persisted precisely because nothing
    ever recovered, so one recovery that leaves the flag set would too."""
    agent, made = _agent(tmp_path)
    for i in range(2):
        # Each stopped turn runs against a client the guard is about to create,
        # so feed concurrently. Feeding the CACHED client instead deadlocks: the
        # guard closes it and its successor's queue starts empty.
        feeder = asyncio.create_task(_feed_when_ready(agent, made, i, [_delta(f"partial {i}")]))
        gen = agent.handle_turn(f"stopped {i}")
        await gen.__anext__()
        await gen.aclose()
        await feeder
        assert agent._stream_dirty
        await made[i].q.put(_result())  # late terminal frame, unread

    feeder = asyncio.create_task(
        _feed_when_ready(agent, made, 2, [_delta("the real answer"), _result()])
    )
    events = [ev async for ev in agent.handle_turn("finally")]
    await feeder

    assert "the real answer" in _texts(events)
    assert len(made) == 3, f"expected a fresh client per stop, got {len(made)}"

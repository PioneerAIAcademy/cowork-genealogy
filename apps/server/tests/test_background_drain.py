"""Background subagents outliving a turn must not wedge the session — issue #1915,
`docs/specs/hosted-web-workbench-spec.md` §7.

WHAT THESE TESTS PROVE, AND WHAT THEY DO NOT. They prove that more than
`max_buffer_size` post-`ResultMessage` messages are consumed, and that the next
turn loses none of its own — over a fake transport with the same bounded-buffer
shape as the SDK's. That is the honest unit-level assertion: a test asserting "a
drain task exists" would pass while the wedge survived.

They do NOT prove the real CLI's `control_request` path recovers. The buffer
filling is a proxy for the actual failure — the SDK's transport read loop blocks
on `await self._message_send.send(message)`, and that same loop dispatches the
hook callbacks, so a full buffer means every PreToolUse hook goes unanswered.
Nothing here exercises a real hook callback or a real CLI. The end-to-end proof
is the manual run in the issue's acceptance check (`make server-dev`, launch two
subagents, let the turn end, make one tool call).

No CI job reaches the hosted runner path at all, which is what `nothing-checks`
is on that card for.
"""
from __future__ import annotations

import asyncio

import pytest
from claude_agent_sdk import ResultMessage
from claude_agent_sdk.types import StreamEvent, TaskNotificationMessage, TaskStartedMessage

from app.agent import real_agent

# The SDK's own bound (`claude_agent_sdk/_internal/query.py`), hardcoded there
# and not an option we can pass — which is why raising it is not a fix.
SDK_BUFFER = 100
POST_TURN = 150  # > SDK_BUFFER, so an undrained stream MUST stall


def _task_started(tool_use_id: str) -> TaskStartedMessage:
    return TaskStartedMessage(
        subtype="task_started",
        data={},
        task_id="task-1",
        description="record-extractor",
        uuid="u1",
        session_id="s1",
        tool_use_id=tool_use_id,
    )


def _task_done(tool_use_id: str) -> TaskNotificationMessage:
    return TaskNotificationMessage(
        subtype="task_notification",
        data={},
        task_id="task-1",
        status="completed",
        output_file="",
        summary="done",
        uuid="u2",
        session_id="s1",
        tool_use_id=tool_use_id,
    )


def _delta(i: int) -> StreamEvent:
    return StreamEvent(
        uuid=f"d{i}",
        session_id="s1",
        event={"type": "content_block_delta", "delta": {"type": "text_delta", "text": "x"}},
    )


def _result() -> ResultMessage:
    return ResultMessage(
        subtype="success",
        duration_ms=1,
        duration_api_ms=1,
        is_error=False,
        num_turns=1,
        session_id="s1",
        total_cost_usd=0.0,
        usage={"input_tokens": 1, "output_tokens": 1},
    )


class BufferedFakeClient:
    """A fake SDK client with the real one's load-bearing property: ONE stream
    with a bounded buffer, handing each item to exactly one receiver.

    `put` awaits when the buffer is full, which is precisely what stalls the real
    transport read loop, and `produced` is how a test observes that it did.
    """

    def __init__(self, buffer_size: int = SDK_BUFFER) -> None:
        self._q: asyncio.Queue = asyncio.Queue(maxsize=buffer_size)
        self.produced = 0
        self.consumed = 0
        self.queries: list[str] = []
        # CONTENTION, not generator lifetime. Counting live generator objects
        # measured the wrong thing: a cancelled drainer's generator is finalized
        # a tick later, so the next turn's reader legitimately overlaps it in
        # EXISTENCE while never competing for an item. What matters is whether
        # two coroutines are ever suspended on `get()` at once, because that is
        # when the stream could hand an item to the wrong one.
        self._waiting = 0
        self.max_waiting = 0

    async def produce(self, messages) -> None:
        for m in messages:
            await self._q.put(m)
            self.produced += 1

    async def query(self, text: str) -> None:
        self.queries.append(text)

    async def receive_messages(self):
        while True:
            self._waiting += 1
            self.max_waiting = max(self.max_waiting, self._waiting)
            try:
                item = await self._q.get()
            finally:
                self._waiting -= 1
            self.consumed += 1
            yield item

    async def receive_response(self):
        async for m in self.receive_messages():
            yield m
            if isinstance(m, ResultMessage):
                return

    async def disconnect(self) -> None:
        pass


def _agent_on(tmp_path, client) -> real_agent.RealAgent:
    agent = real_agent.RealAgent(tmp_path)

    async def _ensure():
        agent._client = client
        return client

    agent._ensure_client = _ensure  # type: ignore[assignment]
    return agent


async def _drive(agent, text) -> list[dict]:
    return [ev async for ev in agent.handle_turn(text)]


@pytest.mark.asyncio
async def test_post_turn_messages_past_the_buffer_bound_are_consumed(tmp_path):
    """The wedge, at unit scale: POST_TURN > SDK_BUFFER messages arrive after the
    turn's ResultMessage. All of them must be consumed."""
    client = BufferedFakeClient()
    agent = _agent_on(tmp_path, client)

    producer = asyncio.create_task(
        client.produce(
            [_task_started("t1"), _result()]
            + [_delta(i) for i in range(POST_TURN)]
            + [_task_done("t1")]
        )
    )
    events = await _drive(agent, "launch the subagents")
    assert any(e["kind"] == "task_started" for e in events)

    # The drainer is what lets the producer past the bound.
    await asyncio.wait_for(producer, timeout=5)
    assert client.produced == POST_TURN + 3
    assert client.produced > SDK_BUFFER, "the test did not exceed the bound it is about"

    await asyncio.wait_for(agent._drain_task, timeout=5)
    # It stopped because the last subagent reported, not because it was cancelled.
    assert agent._tasks == {}


@pytest.mark.asyncio
async def test_the_next_turn_loses_none_of_its_own_messages(tmp_path):
    """The constraint that makes a naive drainer worse than the bug: one anyio
    stream hands each item to exactly ONE receiver, so a drainer left running
    steals the next turn's ResultMessage and `handle_turn` waits forever."""
    client = BufferedFakeClient()
    agent = _agent_on(tmp_path, client)

    producer = asyncio.create_task(
        client.produce(
            [_task_started("t1"), _result()]
            + [_delta(i) for i in range(POST_TURN)]
            + [_task_done("t1")]
        )
    )
    await _drive(agent, "turn one")
    await asyncio.wait_for(producer, timeout=5)

    # Turn two, with the drainer possibly still live.
    second = asyncio.create_task(client.produce([_delta(999), _result()]))
    events = await asyncio.wait_for(_drive(agent, "turn two"), timeout=5)
    await asyncio.wait_for(second, timeout=5)

    assert client.queries == ["turn one", "turn two"]
    assert any(e["kind"] == "usage" for e in events), (
        "turn two produced no usage event, so its ResultMessage never arrived — "
        "the drainer stole it"
    )
    assert client.max_waiting == 1, (
        "two coroutines were suspended on the stream at once, so an item could go "
        "to the wrong one; the handoff in _stop_drain did not happen"
    )
    # Nothing lost and nothing double-counted across the turn boundary.
    assert client.consumed == client.produced == POST_TURN + 5


@pytest.mark.asyncio
async def test_no_drainer_starts_when_no_subagent_is_running(tmp_path):
    """A plain turn must not leave a background task behind."""
    client = BufferedFakeClient()
    agent = _agent_on(tmp_path, client)
    producer = asyncio.create_task(client.produce([_result()]))
    await _drive(agent, "just answer")
    await asyncio.wait_for(producer, timeout=5)
    assert agent._drain_task is None


@pytest.mark.asyncio
async def test_closing_the_client_stops_the_drainer(tmp_path):
    """The drainer reads the client's stream, so it cannot outlive it."""
    client = BufferedFakeClient()
    agent = _agent_on(tmp_path, client)
    producer = asyncio.create_task(
        client.produce([_task_started("t1"), _result()] + [_delta(i) for i in range(5)])
    )
    await _drive(agent, "launch")
    await asyncio.wait_for(producer, timeout=5)
    assert agent._drain_task is not None
    drain = agent._drain_task
    await agent._close_client()
    assert agent._drain_task is None
    assert drain.cancelled() or drain.done(), "the drainer outlived the client"
    assert client._waiting == 0, "a coroutine is still suspended on a closed client's stream"


@pytest.mark.asyncio
async def test_without_the_drainer_the_producer_stalls_at_the_bound(tmp_path):
    """THE NEGATIVE CONTROL. With the drain stubbed out, the producer must NOT
    get past `max_buffer_size` — otherwise these tests would pass on the broken
    code and prove nothing.
    """
    client = BufferedFakeClient()
    agent = _agent_on(tmp_path, client)

    async def _no_drain(_client):  # the pre-fix behaviour
        return None

    agent._drain_background = _no_drain  # type: ignore[assignment]

    producer = asyncio.create_task(
        client.produce(
            [_task_started("t1"), _result()]
            + [_delta(i) for i in range(POST_TURN)]
            + [_task_done("t1")]
        )
    )
    await _drive(agent, "launch the subagents")
    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(asyncio.shield(producer), timeout=1)
    assert client.produced <= SDK_BUFFER + 2, (
        "the producer got past the buffer bound with no drainer, so the bound is "
        "not being modelled and the positive tests prove nothing"
    )
    producer.cancel()

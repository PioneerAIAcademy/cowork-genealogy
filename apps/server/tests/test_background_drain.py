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
from claude_agent_sdk.types import (
    StreamEvent,
    TaskNotificationMessage,
    TaskStartedMessage,
    TaskUpdatedMessage,
)

from _fakes import BufferedFakeClient, attach, turn_events

from app.agent import real_agent

# The SDK's own bound, modelled by BufferedFakeClient — hardcoded in
# `claude_agent_sdk/_internal/query.py` and not an option we can pass, which is
# why raising it is not a fix.
SDK_BUFFER = BufferedFakeClient.SDK_BUFFER
POST_TURN = 150  # > SDK_BUFFER, so an undrained stream MUST stall


def _task_started(tool_use_id: str | None, task_id: str = "task-1") -> TaskStartedMessage:
    return TaskStartedMessage(
        subtype="task_started",
        data={},
        task_id=task_id,
        description="record-extractor",
        uuid="u1",
        session_id="s1",
        tool_use_id=tool_use_id,
    )


def _task_done(tool_use_id: str, task_id: str = "task-1") -> TaskNotificationMessage:
    return TaskNotificationMessage(
        subtype="task_notification",
        data={},
        task_id=task_id,
        status="completed",
        output_file="",
        summary="done",
        uuid="u2",
        session_id="s1",
        tool_use_id=tool_use_id,
    )


def _task_updated(task_id: str, status: str) -> TaskUpdatedMessage:
    """A `task_updated` frame. For a task stopped via TaskStop this is the ONLY
    terminal notification the CLI is guaranteed to emit -- see the SDK's
    lifecycle note on TaskUpdatedMessage."""
    return TaskUpdatedMessage(
        subtype="task_updated",
        data={},
        task_id=task_id,
        patch={"status": status},
        status=status,
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


def _agent_on(tmp_path, client) -> real_agent.RealAgent:
    agent = real_agent.RealAgent(tmp_path)
    attach(agent, client)
    return agent


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
    events = await turn_events(agent, "launch the subagents")
    assert any(e["kind"] == "task_started" for e in events)

    # The drainer is what lets the producer past the bound.
    await asyncio.wait_for(producer, timeout=5)
    assert client.produced == POST_TURN + 3
    assert client.produced > SDK_BUFFER, "the test did not exceed the bound it is about"

    # The drainer is NOT awaited to completion. It has no self-exit any more --
    # it used to `break` on an empty task set, which is legitimately zero
    # between two subagents and stalled the producer at the bound. Its lifetime
    # belongs to `_stop_drain`, so the assertion is that everything was
    # consumed, then that stopping it works.
    assert client.consumed == client.produced, "the drainer left messages unread"
    assert agent._live_tasks == set(), "the last subagent's terminal message was not seen"
    await asyncio.wait_for(agent._stop_drain(), timeout=5)
    assert agent._drain_task is None


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
    await turn_events(agent, "turn one")
    await asyncio.wait_for(producer, timeout=5)

    # Turn two, with the drainer possibly still live.
    second = asyncio.create_task(client.produce([_delta(999), _result()]))
    events = await asyncio.wait_for(turn_events(agent, "turn two"), timeout=5)
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
async def test_a_plain_turn_starts_a_drainer_and_the_next_turn_hands_it_off(tmp_path):
    """A turn with no subagent still starts a drainer, and that is deliberate.

    REPLACES test_no_drainer_starts_when_no_subagent_is_running, which asserted
    the opposite. Gating the START on the liveness set failed in both orderings
    (see test_a_terminal_task_updated_inside_the_turn_still_starts_a_drainer),
    so the drainer now starts whenever a client exists.

    The property that matters is not "sometimes not started" but "always handed
    off": an idle drainer costs one task awaiting a stream, and every path about
    to read the stream calls `_stop_drain` first. So this asserts the handoff
    rather than the absence.
    """
    client = BufferedFakeClient()
    agent = _agent_on(tmp_path, client)
    producer = asyncio.create_task(client.produce([_result()]))
    await turn_events(agent, "just answer")
    await asyncio.wait_for(producer, timeout=5)
    assert agent._drain_task is not None, "the drainer is no longer started unconditionally"

    second = asyncio.create_task(client.produce([_delta(1), _result()]))
    events = await asyncio.wait_for(turn_events(agent, "again"), timeout=5)
    await asyncio.wait_for(second, timeout=5)
    assert any(e["kind"] == "usage" for e in events), (
        "turn two never saw its ResultMessage, so the idle drainer was not handed off"
    )
    assert client.max_waiting == 1
    await asyncio.wait_for(agent._stop_drain(), timeout=5)


@pytest.mark.asyncio
async def test_closing_the_client_stops_the_drainer(tmp_path):
    """The drainer reads the client's stream, so it cannot outlive it."""
    client = BufferedFakeClient()
    agent = _agent_on(tmp_path, client)
    producer = asyncio.create_task(
        client.produce([_task_started("t1"), _result()] + [_delta(i) for i in range(5)])
    )
    await turn_events(agent, "launch")
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
    await turn_events(agent, "launch the subagents")
    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(asyncio.shield(producer), timeout=1)
    assert client.produced <= SDK_BUFFER + 2, (
        "the producer got past the buffer bound with no drainer, so the bound is "
        "not being modelled and the positive tests prove nothing"
    )
    producer.cancel()


@pytest.mark.asyncio
async def test_a_second_subagent_starting_after_the_first_finishes_keeps_draining(tmp_path):
    """The drainer must not stop on a task set that is transiently empty.

    THE REGRESSION THIS PINS. The loop used to `break` on `not self._tasks`,
    checked after every message. Between one subagent's terminal message and the
    next one's TaskStartedMessage the set is legitimately zero, so the drainer
    stopped there and left the producer to stall at the bound -- the pre-fix
    wedge, while the operator line read "0 subagent(s) still running" and looked
    like success. The original fixture could not see it: it emitted its only
    task_done LAST, which made that zero terminal.

    Ordering is the whole test: t1 done, THEN t2 started, then enough deltas to
    exceed the bound.
    """
    client = BufferedFakeClient()
    agent = _agent_on(tmp_path, client)

    producer = asyncio.create_task(
        client.produce(
            [_task_started("t1", "task-1"), _result()]
            + [_task_done("t1", "task-1")]          # -> live set empty here
            + [_task_started("t2", "task-2")]       # -> and refilled one message later
            + [_delta(i) for i in range(POST_TURN)]
            + [_task_done("t2", "task-2")]
        )
    )
    await turn_events(agent, "launch two subagents")
    await asyncio.wait_for(producer, timeout=5)

    assert client.produced == POST_TURN + 5
    assert client.produced > SDK_BUFFER, "the test did not exceed the bound it is about"
    assert client.consumed == client.produced, (
        "the drainer stopped on the transient zero between the two subagents and "
        "the producer stalled at the buffer bound"
    )
    await asyncio.wait_for(agent._stop_drain(), timeout=5)


@pytest.mark.asyncio
async def test_a_killed_subagent_is_cleared_by_task_updated_alone(tmp_path):
    """A terminal state can arrive ONLY as a TaskUpdatedMessage.

    The SDK's lifecycle note: a task stopped via TaskStop reports
    `status="killed"` there and "the matching notification is sometimes
    suppressed". `map_message` handled TaskStarted/Progress/Notification only,
    so a killed subagent stayed in the tracking set forever and every later turn
    spawned a drainer for a phantom. Harmless while that set was attribution
    labels; now the operator log's count of what is still running.
    """
    client = BufferedFakeClient()
    agent = _agent_on(tmp_path, client)
    producer = asyncio.create_task(
        client.produce([_task_started("t1", "task-1"), _result()])
    )
    await turn_events(agent, "launch")
    await asyncio.wait_for(producer, timeout=5)
    assert agent._live_tasks == {"task-1"}

    # No TaskNotificationMessage will ever come for this one.
    real_agent.map_message(
        _task_updated("task-1", "killed"), agent._tool_names, agent._tasks, agent._live_tasks
    )
    assert agent._live_tasks == set(), (
        "a killed subagent stayed in the liveness set, so every later turn would "
        "spawn a drainer for a phantom"
    )
    await asyncio.wait_for(agent._stop_drain(), timeout=5)


@pytest.mark.asyncio
async def test_a_non_terminal_task_updated_does_not_clear_liveness(tmp_path):
    """The converse of the arm above, so it cannot be satisfied by clearing on
    every `task_updated`: `running` and `paused` are not terminal."""
    tasks: dict[str, str] = {}
    live: set[str] = set()
    real_agent.map_message(_task_started("t1", "task-1"), {}, tasks, live)
    for status in ("pending", "running", "paused"):
        real_agent.map_message(_task_updated("task-1", status), {}, tasks, live)
        assert live == {"task-1"}, f"{status} is not terminal and must not clear"
    real_agent.map_message(_task_updated("task-1", "completed"), {}, tasks, live)
    assert live == set()


@pytest.mark.asyncio
async def test_a_task_without_a_tool_use_id_still_starts_the_drainer(tmp_path):
    """`TaskStartedMessage.tool_use_id` is `str | None`.

    Liveness used to be keyed on it, so a Task arriving without one registered
    nothing, no drainer started, and the fix silently did not engage. Liveness
    is keyed on `task_id` -- a required `str` -- for exactly this reason. The
    attribution label is what is legitimately lost here, and that is all.
    """
    client = BufferedFakeClient()
    agent = _agent_on(tmp_path, client)
    producer = asyncio.create_task(
        client.produce(
            [_task_started(None, "task-1"), _result()]
            + [_delta(i) for i in range(POST_TURN)]
        )
    )
    await turn_events(agent, "launch a task with no tool_use_id")
    await asyncio.wait_for(producer, timeout=5)

    # `_drain_task is not None` was here and could not fail: the drainer now
    # starts on `self._client is not None`, so it is unconditionally true and
    # the tool_use_id mutation this test exists to forbid sailed past it.
    # Liveness is the thing keyed on task_id, so liveness is what to assert.
    assert agent._live_tasks == {"task-1"}, (
        "liveness is keyed on the optional tool_use_id, so a Task without "
        "one registers nothing"
    )
    assert agent._tasks == {}, "nothing to attribute to, which is the accepted cost"
    assert client.consumed == client.produced == POST_TURN + 2
    await asyncio.wait_for(agent._stop_drain(), timeout=5)


@pytest.mark.asyncio
async def test_the_handoff_happens_while_a_subagent_is_still_running(tmp_path):
    """The handoff, against a drainer that is genuinely still alive.

    WHY THIS EXISTS ALONGSIDE test_the_next_turn_loses_none_of_its_own_messages.
    That test's fixture ended with the subagent's task_done, so on the old code
    the drain task was already finished by turn two and `_stop_drain` returned
    at its `if task is None or task.done()` guard -- `max_waiting == 1` was
    satisfied by a drainer that was already dead. Deleting the `_stop_drain()`
    call from `handle_turn` left the whole suite green.

    Here the subagent never reports, so the drainer is unambiguously live when
    turn two starts and only a real handoff can let turn two read its own
    ResultMessage.
    """
    client = BufferedFakeClient()
    agent = _agent_on(tmp_path, client)

    producer = asyncio.create_task(
        client.produce(
            [_task_started("t1", "task-1"), _result()] + [_delta(i) for i in range(10)]
        )
    )
    await turn_events(agent, "turn one")
    await asyncio.wait_for(producer, timeout=5)
    assert agent._drain_task is not None and not agent._drain_task.done(), (
        "the drainer is not live, so this test cannot see the handoff at all"
    )
    assert agent._live_tasks == {"task-1"}, "the subagent must still be running"

    second = asyncio.create_task(client.produce([_delta(999), _result()]))
    events = await asyncio.wait_for(turn_events(agent, "turn two"), timeout=5)
    await asyncio.wait_for(second, timeout=5)

    assert any(e["kind"] == "usage" for e in events), (
        "turn two produced no usage event, so its ResultMessage never arrived -- "
        "the still-running drainer stole it"
    )
    assert client.max_waiting == 1, (
        "two coroutines were suspended on the stream at once; the handoff did not happen"
    )



@pytest.mark.asyncio
async def test_a_terminal_task_updated_inside_the_turn_still_starts_a_drainer(tmp_path):
    """The round-2 blocker, from both sides.

    Gating the drainer's START on the liveness set reads a signal that is
    legitimately empty at turn end in two orderings, and both strand the
    completion prose issue #1915 is about:

      * a terminal `task_updated` arriving INSIDE the turn clears the set before
        the start gate runs, while that subagent's notification and deltas are
        still queued. Measured before the fix: produced=103 of 154.
      * a `TaskStartedMessage` arriving AFTER the `ResultMessage` is the same
        failure from the other side: produced=101 of 152.

    The SDK documents a mechanism for the first: a task stopped via `TaskStop`
    reports `status="killed"` on `task_updated` with the notification "sometimes
    suppressed", so stopping a subagent mid-turn lands a terminal update inside
    the turn.
    """
    client = BufferedFakeClient()
    agent = _agent_on(tmp_path, client)
    messages = (
        [_task_started("t1", "task-1"), _task_updated("task-1", "killed"), _result()]
        + [_delta(i) for i in range(POST_TURN)]
        + [_task_done("t1", "task-1")]
    )
    producer = asyncio.create_task(client.produce(messages))
    await turn_events(agent, "launch then stop it")
    await asyncio.wait_for(producer, timeout=5)

    assert agent._drain_task is not None, (
        "no drainer started: the terminal task_updated emptied the liveness set "
        "before the start gate ran"
    )
    assert client.consumed == client.produced == len(messages), (
        "the producer stalled at the buffer bound with the drainer never started"
    )
    await asyncio.wait_for(agent._stop_drain(), timeout=5)


@pytest.mark.asyncio
async def test_a_task_started_after_the_result_message_still_starts_a_drainer(tmp_path):
    """The sibling ordering of the test above, and the one round 1 also had."""
    client = BufferedFakeClient()
    agent = _agent_on(tmp_path, client)
    messages = [_result(), _task_started("t1", "task-1")] + [_delta(i) for i in range(POST_TURN)]
    producer = asyncio.create_task(client.produce(messages))
    await turn_events(agent, "go")
    await asyncio.wait_for(producer, timeout=5)

    assert agent._drain_task is not None
    assert client.consumed == client.produced == len(messages)
    await asyncio.wait_for(agent._stop_drain(), timeout=5)


@pytest.mark.asyncio
async def test_stop_drain_does_not_swallow_a_cancellation_aimed_at_its_caller(tmp_path):
    """`_stop_drain` must let the CALLER's cancellation propagate.

    Round-1 review item 6, which shipped without a guard. The old arm was a bare
    `except asyncio.CancelledError: pass`, which cannot tell the task it just
    cancelled ending from this coroutine being cancelled. `serve` cancels
    `turn_task` when `interrupt()` raises and on stdin EOF, so a swallowed
    cancellation means `_run_turn` never emits `(stopped)` and the turn runs on
    into `client.query(text)`.

    The shape: hold the drainer's teardown open, enter `_stop_drain`, then cancel
    the coroutine awaiting it. Nothing after the await may run.
    """
    class SlowTeardownClient(BufferedFakeClient):
        async def receive_messages(self):
            try:
                async for item in super().receive_messages():
                    yield item
            finally:
                await asyncio.sleep(0.25)  # hold the gather open

    client = SlowTeardownClient()
    agent = _agent_on(tmp_path, client)
    producer = asyncio.create_task(
        client.produce([_task_started("t1", "task-1"), _result()] + [_delta(i) for i in range(3)])
    )
    await turn_events(agent, "launch")
    await asyncio.wait_for(producer, timeout=5)
    assert agent._drain_task is not None and not agent._drain_task.done()

    reached_after_await = []

    async def caller():
        await agent._stop_drain()
        reached_after_await.append("ran past the handoff")

    task = asyncio.create_task(caller())
    await asyncio.sleep(0.05)          # let it enter the gather
    task.cancel()
    outcome = await asyncio.gather(task, return_exceptions=True)

    assert isinstance(outcome[0], asyncio.CancelledError), (
        "_stop_drain swallowed a cancellation aimed at its caller, so the turn "
        "would run on past the handoff"
    )
    assert not reached_after_await, "code after the handoff ran despite the cancellation"


@pytest.mark.asyncio
async def test_one_unmappable_message_does_not_end_draining(tmp_path, monkeypatch):
    """Round-1 review item 9, which also shipped without a guard.

    The `except Exception` used to sit OUTSIDE the `async for`, so a single
    `map_message` failure exited the loop for good and the producer stalled at
    the buffer bound until the next turn ended - which is the window the wedge
    lived in. Measured before the fix: produced=103 of 154.
    """
    client = BufferedFakeClient()
    agent = _agent_on(tmp_path, client)
    real_map = real_agent.map_message
    state = {"n": 0}

    def flaky(message, tool_names, tasks=None, live=None):
        state["n"] += 1
        if state["n"] == 4:                      # one bad message, mid-drain
            raise ValueError("unmappable message")
        return real_map(message, tool_names, tasks, live)

    monkeypatch.setattr(real_agent, "map_message", flaky)

    messages = (
        [_task_started("t1", "task-1"), _result()]
        + [_delta(i) for i in range(POST_TURN)]
        + [_task_done("t1", "task-1")]
    )
    producer = asyncio.create_task(client.produce(messages))
    await turn_events(agent, "launch")
    await asyncio.wait_for(producer, timeout=5)

    assert state["n"] > 4, "the flaky message was never reached"
    assert client.consumed == client.produced == len(messages), (
        "draining stopped at the first unmappable message and the producer stalled"
    )
    await asyncio.wait_for(agent._stop_drain(), timeout=5)


@pytest.mark.asyncio
async def test_a_client_rebuild_clears_the_task_state(tmp_path):
    """Round-2 review item 5: a key rotation must not leave a phantom task id.

    `_close_client` cleared `_client` and `_client_key` and neither task dict.
    The old client's subagents can never emit on the new client's stream, so a
    surviving id is a phantom no terminal message will ever clear - the exact
    failure the TaskUpdatedMessage arm was added to prevent, on a path that arm
    cannot reach.
    """
    client = BufferedFakeClient()
    agent = _agent_on(tmp_path, client)
    producer = asyncio.create_task(
        client.produce([_task_started("t1", "task-1"), _result()] + [_delta(i) for i in range(3)])
    )
    await turn_events(agent, "launch")
    await asyncio.wait_for(producer, timeout=5)
    assert agent._live_tasks == {"task-1"} and agent._tasks

    await asyncio.wait_for(agent._close_client(), timeout=5)

    assert agent._live_tasks == set(), (
        "a task id survived the client rebuild, so a later turn tracks a phantom"
    )
    assert agent._tasks == {}, "the attribution map survived the client rebuild"

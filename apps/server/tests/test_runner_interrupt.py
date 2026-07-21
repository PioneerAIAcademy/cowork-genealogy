"""The runner's message loop, focused on interrupt.

Interrupt was a no-op because the old loop blocked inside handle_turn and never
read stdin until the turn it was meant to stop had already finished. serve() now
drains messages concurrently with the running turn, so these drive a long turn
and interrupt it mid-flight.

Two agent shapes, matching the two real ones:
- an SDK-style agent whose interrupt() ends its own stream (returns True → the
  runner must NOT cancel; the turn ends on its own),
- a mock-style agent that cannot self-stop (returns False → the runner cancels,
  and _run_turn converts that into (stopped) + turn_done).
"""
import asyncio

import pytest

from app.agent.runner import serve


class SdkStyleAgent:
    """interrupt() ends the stream itself, like RealAgent telling the SDK to abort."""

    def __init__(self):
        self._stop = asyncio.Event()
        self.interrupted = False

    async def handle_turn(self, text):
        i = 0
        while not self._stop.is_set():
            yield {"kind": "text", "text": f"{i}"}
            i += 1
            await asyncio.sleep(0.005)

    async def interrupt(self):
        self.interrupted = True
        self._stop.set()
        return True


class UnstoppableAgent:
    """Cannot self-stop (returns False), like the scripted MockAgent."""

    def __init__(self):
        self.interrupted = False

    async def handle_turn(self, text):
        i = 0
        while True:  # never ends on its own — only cancellation stops it
            yield {"kind": "text", "text": f"{i}"}
            i += 1
            await asyncio.sleep(0.005)

    async def interrupt(self):
        self.interrupted = True
        return False


async def _run(agent, script_delays):
    """Feed messages to serve() with small gaps, collecting emitted events. The
    turn runs concurrently; the final None ends the loop."""
    incoming: asyncio.Queue = asyncio.Queue()
    events: list[dict] = []
    serve_task = asyncio.create_task(serve(agent, incoming, events.append))

    await incoming.put({"type": "user_msg", "text": "go"})
    await asyncio.sleep(0.05)  # let the turn produce a few events
    await incoming.put({"type": "interrupt"})
    await asyncio.sleep(0.05)  # let the interrupt take effect
    await incoming.put(None)  # EOF → serve returns
    await asyncio.wait_for(serve_task, 2)
    return events


def test_sdk_style_interrupt_ends_the_turn_without_cancellation():
    agent = SdkStyleAgent()
    events = asyncio.run(_run(agent, None))

    assert agent.interrupted, "interrupt() was not called"
    assert events[-1] == {"kind": "turn_done"}, "turn must always end with turn_done"
    # It stopped: far fewer than an unbounded run, and no (stopped) marker since
    # the SDK-style stream ended on its own rather than being cancelled.
    assert not any(e.get("text") == "(stopped)" for e in events)


def test_unstoppable_turn_is_cancelled_and_reports_stopped():
    agent = UnstoppableAgent()
    events = asyncio.run(_run(agent, None))

    assert agent.interrupted
    assert {"kind": "error", "text": "(stopped)"} in events
    assert events[-1] == {"kind": "turn_done"}


def test_a_turn_runs_to_completion_when_never_interrupted():
    """A short, self-completing turn needs no interrupt and still ends cleanly —
    the interrupt machinery must not change the normal path."""

    class ShortAgent:
        async def handle_turn(self, text):
            yield {"kind": "text", "text": "hi"}

        async def interrupt(self):
            return False

    async def drive():
        incoming: asyncio.Queue = asyncio.Queue()
        events: list[dict] = []
        task = asyncio.create_task(serve(ShortAgent(), incoming, events.append))
        await incoming.put({"type": "user_msg", "text": "hi"})
        await asyncio.sleep(0.05)
        await incoming.put(None)
        await asyncio.wait_for(task, 2)
        return events

    events = asyncio.run(drive())
    assert {"kind": "text", "text": "hi"} in events
    assert events[-1] == {"kind": "turn_done"}


def test_interrupt_while_idle_is_ignored():
    """An interrupt with no turn running must not crash or emit anything."""

    class Idle:
        async def handle_turn(self, text):
            yield {"kind": "text", "text": "x"}

        async def interrupt(self):
            raise AssertionError("interrupt() must not be called when idle")

    async def drive():
        incoming: asyncio.Queue = asyncio.Queue()
        events: list[dict] = []
        task = asyncio.create_task(serve(Idle(), incoming, events.append))
        await incoming.put({"type": "interrupt"})  # nothing running
        await asyncio.sleep(0.02)
        await incoming.put(None)
        await asyncio.wait_for(task, 2)
        return events

    assert asyncio.run(drive()) == []


def test_real_agent_interrupt_forwards_to_the_sdk_client():
    """RealAgent.interrupt() forwards to the persistent SDK client and returns
    True so the runner does not also cancel; no client → False (runner cancels)."""
    from app.agent.real_agent import RealAgent

    class FakeClient:
        def __init__(self):
            self.called = False

        async def interrupt(self):
            self.called = True

    async def drive():
        agent = RealAgent.__new__(RealAgent)  # skip __init__ (no project on disk)
        agent._client = None
        assert await agent.interrupt() is False  # nothing to stop

        fake = FakeClient()
        agent._client = fake
        assert await agent.interrupt() is True
        assert fake.called

    asyncio.run(drive())


def test_mock_agent_cannot_self_stop():
    from app.agent.mock_agent import MockAgent

    agent = MockAgent.__new__(MockAgent)
    assert asyncio.run(agent.interrupt()) is False

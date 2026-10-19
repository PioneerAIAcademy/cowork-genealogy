"""Shared stand-ins for `ClaudeSDKClient`, and the helpers that drive a turn.

WHY THIS EXISTS. Four test files had grown their own `ClaudeSDKClient` stand-in
— `_FakeClient` (connect/disconnect), `_Client` (query/receive_response),
`FakeClient` (interrupt) and `BufferedFakeClient` (one bounded stream) — each
declaring only the surface its own file happened to touch. `CLAUDE.md` § "Code
reuse" puts the consolidation signal at two near-duplicates; four is past it,
and the concrete cost was that a test needing a second surface had to grow a
fifth fake rather than reach for an existing one.

WHAT IS SHARED AND WHAT IS NOT. `FakeSDKClient` carries every surface
`RealAgent` actually touches, so a test that cares about one of them does not
have to declare the rest. Two subclasses shape what the stream produces:
`ReplayFakeClient` replays a fixed list, and `BufferedFakeClient` models the
SDK's bounded buffer. The bounded one earns its own class — it is the only
place the 100-slot bound is modelled — but it is now a variant of the shared
base rather than a fifth parallel copy.

NOT FOLDED IN, deliberately:

* `test_feedback.py`'s three `_FakeClient` classes stand in for something else
  entirely and share no surface with these.
* `test_sandbox_server.py::_drive` is a WEBSOCKET driver. It collided by name
  only, which is its own small confusion, but it belongs to a different subject
  and consolidating it here would be a rename in a file this change has no
  other reason to touch.
* `test_agent_error_classification.py::_drive` runs a turn through the real
  `serve()` loop rather than `handle_turn`, so it is a different job from
  `turn_events` below and keeps its own name.
"""
from __future__ import annotations

import asyncio

from claude_agent_sdk import ResultMessage


class FakeSDKClient:
    """Records what the agent did to it. Override only what a test shapes.

    Every instance registers itself on `type(self).instances`, and each subclass
    gets its OWN registry (see `__init_subclass__`) so one file's fakes can
    never leak into another's count.
    """

    instances: list["FakeSDKClient"] = []

    def __init_subclass__(cls, **kwargs) -> None:
        # Without this a subclass appends to the BASE's list, and two test files
        # asserting on `len(instances)` would see each other's objects.
        super().__init_subclass__(**kwargs)
        cls.instances = []

    def __init__(self, options=None) -> None:
        self.options = options
        self.connected = False
        self.disconnected = False
        self.interrupted = False
        self.queries: list[str] = []
        type(self).instances.append(self)

    async def connect(self) -> None:
        self.connected = True

    async def disconnect(self) -> None:
        self.disconnected = True

    async def interrupt(self) -> None:
        """Returns None, matching the real SDK's `interrupt() -> None`.

        NOT True. `RealAgent.interrupt` returns True UNCONDITIONALLY for a
        live client, and `test_real_agent_interrupt_forwards_to_the_sdk_client`
        exists to pin exactly that. A fake that returns True answers the
        question the test asks, so the assertion passes even against
        `return bool(await self._client.interrupt())` - which would make every
        Stop also cancel the turn task, because `runner.serve` does
        `handled = bool(await agent.interrupt())`. Caught in review round 2:
        the first version of this file returned True and disarmed that test.
        """
        self.interrupted = True

    async def query(self, text: str) -> None:
        self.queries.append(text)

    async def receive_messages(self):
        """Nothing, by default. A test that needs a stream picks a subclass."""
        return
        yield  # pragma: no cover — makes this an async generator

    async def receive_response(self):
        async for message in self.receive_messages():
            yield message
            if isinstance(message, ResultMessage):
                return


class ReplayFakeClient(FakeSDKClient):
    """Replays a fixed list of real SDK message objects for one turn.

    Offline by construction. Driving the LIVE SDK to raise is explicitly out of
    bounds — no offline gate exercises it — so replaying real message objects
    through the real loop is the house pattern.
    """

    def __init__(self, messages, options=None) -> None:
        super().__init__(options)
        self._messages = list(messages)

    async def receive_messages(self):
        for message in self._messages:
            yield message

    async def receive_response(self):
        # Every message, without stopping at a ResultMessage: `handle_turn`'s
        # own loop is what breaks there, and a test replaying messages AFTER a
        # result is asserting on exactly that.
        for message in self._messages:
            yield message


class BufferedFakeClient(FakeSDKClient):
    """The real client's load-bearing property: ONE stream with a bounded
    buffer, handing each item to exactly one receiver.

    `produce` awaits when the buffer is full, which is precisely what stalls the
    real transport read loop, and `produced` is how a test observes that it did.
    """

    #: The SDK's own bound (`claude_agent_sdk/_internal/query.py`), hardcoded
    #: there and not an option we can pass — which is why raising it is not a fix.
    SDK_BUFFER = 100

    def __init__(self, buffer_size: int | None = None, options=None) -> None:
        super().__init__(options)
        self._q: asyncio.Queue = asyncio.Queue(
            maxsize=self.SDK_BUFFER if buffer_size is None else buffer_size
        )
        self.produced = 0
        self.consumed = 0
        # CONTENTION, not generator lifetime. Counting live generator objects
        # measured the wrong thing: a cancelled drainer's generator is finalized
        # a tick later, so the next turn's reader legitimately overlaps it in
        # EXISTENCE while never competing for an item. What matters is whether
        # two coroutines are ever suspended on `get()` at once, because that is
        # when the stream could hand an item to the wrong one.
        self._waiting = 0
        self.max_waiting = 0

    async def produce(self, messages) -> None:
        for message in messages:
            await self._q.put(message)
            self.produced += 1

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


def attach(agent, client):
    """Give `agent` a fake client, bypassing the real `_ensure_client`.

    Returns the client, so a caller can keep it in one line.
    """

    async def _ensure():
        agent._client = client
        return client

    agent._ensure_client = _ensure  # type: ignore[assignment]
    return client


async def turn_events(agent, text: str) -> list[dict]:
    """One turn through `handle_turn`, collected."""
    return [event async for event in agent.handle_turn(text)]

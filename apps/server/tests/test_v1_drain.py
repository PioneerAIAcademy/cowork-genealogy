"""`_drain_replay` must not return while a turn is in flight - issue #2062,
review round 1.

WHAT THIS IS ABOUT. The sync REST path opens a fresh WS, drains the replay
burst, then sends its message and reads until the first `turn_done`. Draining
"until quiet" was safe while the runner was strictly one-turn-at-a-time: a turn
in progress was always emitting frames, so quiet meant idle.

Queuing turns broke that. A queued turn emits `turn_start` and then goes silent
for a full SDK round trip before its first real frame, so a drain that returns
on quiet can return INSIDE a running turn, send its own message behind it, and
read that turn's `turn_done` as its own reply. `docs/specs/public-rest-api-spec.md`
used to rule this out by asserting the prior turn is "still emitting frames",
which a backlog makes false.
"""
from __future__ import annotations

import asyncio
import json

import pytest

from app.v1 import _DRAIN_IDLE, _drain_replay


def _frame(kind: str, **extra) -> str:
    return json.dumps({"type": "agent_event", "event": {"kind": kind, **extra}})


class ScriptedWS:
    """Yields frames on a schedule, then goes quiet forever.

    Each entry is `(delay_before, payload)`. After the script runs out, `recv`
    never returns, which is what a genuinely idle socket does.
    """

    def __init__(self, script):
        self._script = list(script)
        self.recv_count = 0

    async def recv(self):
        self.recv_count += 1
        if not self._script:
            await asyncio.Event().wait()  # quiet forever
        delay, payload = self._script.pop(0)
        await asyncio.sleep(delay)
        return payload


def test_the_drain_returns_on_quiet_when_nothing_is_running():
    """The original behaviour, still required: a replay burst then quiet."""
    ws = ScriptedWS([(0.0, _frame("text", text="history")), (0.0, _frame("text", text="more"))])
    asyncio.run(asyncio.wait_for(_drain_replay(ws), timeout=5))
    assert ws.recv_count >= 3  # two frames plus the recv that timed out


def test_the_drain_waits_out_a_turn_that_started_while_it_was_draining():
    """THE REGRESSION. A `turn_start` arrives, then the socket goes quiet for
    longer than _DRAIN_IDLE before the turn's frames and its `turn_done`.

    On the old drain this returned during the quiet stretch, and the caller then
    sent its message behind a running turn. It must instead wait for that turn's
    `turn_done`.
    """
    quiet = _DRAIN_IDLE * 3
    ws = ScriptedWS([
        (0.0, _frame("text", text="replay")),
        (0.0, _frame("turn_start", queued=True)),
        (quiet, _frame("text", text="the queued turn's first real frame")),
        (0.0, _frame("turn_done")),
    ])
    asyncio.run(asyncio.wait_for(_drain_replay(ws), timeout=15))
    assert not ws._script, (
        "the drain returned before the in-flight turn's turn_done, so the caller "
        "would send behind a running turn and mis-read its reply"
    )


def test_the_drain_is_bounded_even_if_the_turn_never_finishes():
    """A wedged agent must not hang the drain forever; _DRAIN_MAX is the bound.

    Patched down so the test is fast - the point is that the bound exists and is
    honoured, not its production value.
    """
    from app import v1

    ws = ScriptedWS([(0.0, _frame("turn_start", queued=True))])  # then quiet forever
    original = v1._DRAIN_MAX
    v1._DRAIN_MAX = _DRAIN_IDLE * 2
    try:
        asyncio.run(asyncio.wait_for(_drain_replay(ws), timeout=10))
    finally:
        v1._DRAIN_MAX = original


def test_an_unbalanced_turn_done_does_not_wedge_the_drain():
    """A `turn_done` with no matching `turn_start` - the replay of a turn that
    finished before this socket opened - must not push the counter negative and
    keep the drain waiting for a turn that is not running."""
    ws = ScriptedWS([
        (0.0, _frame("turn_done")),
        (0.0, _frame("turn_done")),
        (0.0, _frame("text", text="trailing")),
    ])
    asyncio.run(asyncio.wait_for(_drain_replay(ws), timeout=5))


def test_an_orphan_turn_done_does_not_cancel_a_live_turn_start():
    """The `in_flight > 0` clamp, which the unbalanced test above cannot reach.

    `Hub._record` trims history from the FRONT, so the orphan that survives
    trimming is a `turn_done` whose `turn_start` was evicted - not the reverse.
    Replay one, then let a turn genuinely start. Without the clamp the orphan
    drives the counter to -1 and the live `turn_start` only brings it back to 0,
    so the quiet timer ends the drain INSIDE a running turn and `_collect_sync`
    reads that turn's `turn_done` as its own reply - the mis-attribution this
    module exists to prevent.

    The test above cannot see it: its script reaches -2, which still satisfies
    `in_flight <= 0`, so the drain returns with or without the clamp.
    """
    quiet = _DRAIN_IDLE * 3
    ws = ScriptedWS([
        (0.0, _frame("turn_done")),                  # orphan from a trimmed history
        (0.0, _frame("turn_start", queued=True)),    # a turn that is genuinely running
        (quiet, _frame("text", text="the live turn's first real frame")),
        (0.0, _frame("turn_done")),
    ])
    asyncio.run(asyncio.wait_for(_drain_replay(ws), timeout=15))
    assert not ws._script, (
        "an orphaned turn_done cancelled a live turn_start, so the drain returned "
        "inside a running turn - the caller would read that turn's turn_done as "
        "its own reply"
    )

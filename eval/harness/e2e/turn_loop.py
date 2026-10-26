"""One session, many turns: the e2e harness answering its own step boundaries.

Section F. Until step mode the e2e harness ran a fixture as ONE `process_query`
call kept alive by the Stop hook's nudges. Under step mode a turn runs one step
and ends, so a one-shot query would stop after the first step and the run would
look finished. This drives turn after turn on one `ClaudeSDKClient` session,
sending the reply production's host would send.

**The reply decision is NOT made here.** `decide_reply` is injected, and the
orchestrator passes `step_boundary.next_auto_reply` — the same function the
prototype worker calls. That is the whole point of section F: e2e exercises
production's mechanism rather than a harness-shaped imitation of it. What lives
here is only the sequencing: send, consume one turn, ask, repeat.

**Two caps, both runaway guards and neither a result.** `max_replies` bounds one
run's replies; the per-message `timeout_s` bounds silence inside a turn. Hitting
either is a harness-side stop, recorded as such, and is not the fixture failing.

The client contract is three methods of `ClaudeSDKClient` (SDK 0.2.172):
`connect(None)` for streaming input, `query(text)` to send, and
`receive_response()` for one turn's messages. A fake supplying those three drives
the tests, so none of this needs a live CLI.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass, field
from typing import Any

#: Why the loop stopped. Only `no_reply` is the run ending on its own terms.
STOP_NO_REPLY = "no_reply"
STOP_REPLY_CAP = "reply_cap"
STOP_SILENCE = "sdk_stream_silence"
STOP_ABORTED = "aborted"


@dataclass
class Turn:
    """One turn: what it was asked, what came back, and how long it took."""

    index: int
    sent: str
    #: Everything `receive_response()` yielded, in order. The orchestrator folds
    #: these exactly as it folded the one-shot stream, so nothing downstream of
    #: the message handling has to know a turn boundary exists.
    messages: list[Any] = field(default_factory=list)
    #: Wall time from the moment the message was sent to the turn's last message.
    #: Recorded per turn because "how long does a researcher wait for ONE
    #: response" is the headline step mode is measured on, and a whole-run
    #: figure cannot answer it.
    wall_ms: int = 0
    #: The step this turn ran, as the caller's step gate saw it. None when the
    #: turn spawned nothing.
    step: str | None = None
    #: The reply that followed, or None when the loop stopped here.
    reply: str | None = None


@dataclass
class TurnLoopResult:
    turns: list[Turn]
    stop: str
    #: Set when `stop` is `aborted`: the exception that ended the run.
    error: BaseException | None = None

    @property
    def replies_sent(self) -> int:
        """Replies the HOST sent — the first message is the fixture's, not a reply."""
        return max(0, len(self.turns) - 1)


async def run_turns(
    *,
    client: Any,
    first_message: str,
    decide_reply: Callable[[Turn], Awaitable[str | None] | str | None],
    on_message: Callable[[Any, Turn], Any] | None = None,
    max_replies: int,
    timeout_s: float,
) -> TurnLoopResult:
    """Drive turns until nothing more is due, and return every turn.

    `decide_reply` is called once per turn with that turn, and returns the next
    message or None to stop. It may be sync or async — the orchestrator's reads
    `research.json`, and forcing that to be sync would push a blocking read onto
    the event loop.

    `on_message` sees every message as it arrives, so the caller can fold it and
    stamp `turn.step` from its own step gate before `decide_reply` runs.

    The caller owns `connect()` and `disconnect()`: a loop that connected its own
    client could not be handed one already carrying the run's hooks and options.
    """
    turns: list[Turn] = []
    pending: str | None = first_message
    stop = STOP_NO_REPLY

    while pending is not None:
        if len(turns) > max_replies:
            # Checked before sending, so the cap bounds replies SENT rather than
            # turns finished -- one more turn than the cap would be one more paid
            # turn, which is what the guard exists to prevent.
            stop = STOP_REPLY_CAP
            break
        turn = Turn(index=len(turns), sent=pending)
        turns.append(turn)
        started = time.monotonic()
        try:
            await client.query(pending)
            async for message in _with_timeout(client.receive_response(), timeout_s):
                turn.messages.append(message)
                if on_message is not None:
                    outcome = on_message(message, turn)
                    if asyncio.iscoroutine(outcome):
                        await outcome
        except asyncio.TimeoutError:
            turn.wall_ms = int((time.monotonic() - started) * 1000)
            return TurnLoopResult(turns=turns, stop=STOP_SILENCE)
        except BaseException as exc:  # noqa: BLE001 - recorded, never swallowed
            turn.wall_ms = int((time.monotonic() - started) * 1000)
            return TurnLoopResult(turns=turns, stop=STOP_ABORTED, error=exc)
        turn.wall_ms = int((time.monotonic() - started) * 1000)

        decided = decide_reply(turn)
        if asyncio.iscoroutine(decided):
            decided = await decided
        # Falsy, not just None. An empty or whitespace-only reply would otherwise
        # start a turn carrying no instruction -- and be billed for it -- which is
        # indistinguishable downstream from the host deciding to continue.
        decided = decided if (decided or "").strip() else None
        turn.reply = decided
        pending = decided

    return TurnLoopResult(turns=turns, stop=stop)


async def stream_turns(
    *,
    client: Any,
    first_message: str,
    decide_reply: Callable[[Turn], Awaitable[str | None] | str | None],
    turns: list[Turn],
    max_replies: int,
) -> Any:
    """The same sequencing as `run_turns`, as ONE flat stream of messages.

    This is the shape the e2e orchestrator needs. Its message loop is ~300 lines
    of folding -- narration, tool calls, usage, timeline, the guardrail shadow --
    plus a per-message inactivity timeout and a stall-resume path. Inverting that
    into `run_turns`' `on_message` callback would move all of it; consuming a
    generator instead leaves every line of it where it is, and the only thing
    that changes is where `StopAsyncIteration` comes from: the end of the RUN
    rather than the end of the first turn.

    **No timeout here, deliberately.** The orchestrator already applies
    `fixture.caps.inactivity_seconds` per message and relabels a Windows sleep
    before treating silence as a stall. A second deadline inside this generator
    would fire first on a long step and bypass that relabelling, so silence stays
    the caller's to detect.

    `turns` is appended in place rather than returned, because a generator's
    return value is not reachable from `async for`. The caller reads it after the
    stream ends -- and, for the current turn, during it: `turns[-1]` is the turn
    each message belongs to, which is how the caller stamps `step` before
    `decide_reply` asks for it.
    """
    pending: str | None = first_message
    while pending is not None:
        if len(turns) > max_replies:
            return
        turn = Turn(index=len(turns), sent=pending)
        turns.append(turn)
        started = time.monotonic()
        await client.query(pending)
        async for message in client.receive_response():
            turn.messages.append(message)
            yield message
        turn.wall_ms = int((time.monotonic() - started) * 1000)

        decided = decide_reply(turn)
        if asyncio.iscoroutine(decided):
            decided = await decided
        decided = decided if (decided or "").strip() else None
        turn.reply = decided
        pending = decided


async def _with_timeout(stream: Iterable[Any] | Any, timeout_s: float):
    """`stream`, with `timeout_s` applied to each message rather than to the turn.

    Per message, because a step legitimately runs for many minutes while
    streaming: a whole-turn deadline would kill a healthy long search, and the
    thing worth detecting is SILENCE, which is what the orchestrator's existing
    `inactivity_seconds` cap measures too.
    """
    iterator = stream.__aiter__()
    while True:
        try:
            message = await asyncio.wait_for(iterator.__anext__(), timeout=timeout_s)
        except StopAsyncIteration:
            return
        yield message

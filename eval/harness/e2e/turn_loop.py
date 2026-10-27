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

**`max_replies` is a runaway guard, not a result.** It bounds one run's replies.
Silence inside a turn is the orchestrator's to detect, with its existing
`inactivity_seconds` cap, so this module applies no timeout of its own.

The client contract is three methods of `ClaudeSDKClient` (SDK 0.2.172):
`connect(None)` for streaming input, `query(text)` to send, and
`receive_response()` for one turn's messages. A fake supplying those three drives
the tests, so none of this needs a live CLI.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

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
    #: The mode the turn RAN under (`step` / `job` / `wrapup`). A wrap-up turn
    #: runs several steps, so the per-step report must keep it out of the step it
    #: opened with -- as `proto/steps.py` does on the prototype side.
    mode: str | None = None
    #: The reply that followed, or None when the loop stopped here.
    reply: str | None = None
    #: This turn's own `ResultMessage` figures, stamped by the caller. One per
    #: turn under a persistent session, where a one-shot query had exactly one
    #: for the whole run.
    usage: dict[str, Any] | None = None


async def stream_turns(
    *,
    client: Any,
    first_message: str,
    decide_reply: Callable[[Turn], Awaitable[str | None] | str | None],
    turns: list[Turn],
    max_replies: int,
) -> Any:
    """Drive turns until nothing more is due, as ONE flat stream of messages.

    This is the shape the e2e orchestrator needs. Its message loop is ~300 lines
    of folding -- narration, tool calls, usage, timeline, the guardrail shadow --
    plus a per-message inactivity timeout and a stall-resume path. Inverting that
    into an `on_message` callback would move all of it; consuming a
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


#: Fields of a `ResultMessage` that are a QUANTITY of ONE turn, so a multi-turn
#: run's value is the sum.
_SUMMED = ("duration_ms", "num_turns")
#: Fields the CLI already reports as a RUNNING TOTAL on a persistent session, so
#: the run's value is the latest one and summing would count early turns again.
#: The pinned CLI (2.1.308, SDK 0.2.172) documents `total_cost_usd` as
#: "cumulative across turns in streaming-input sessions -- read the latest result
#: rather than summing", and builds `duration_api_ms` from the same session-wide
#: cost ledger (`costLedger.totalAPIDuration()`). `usage` is the opposite: its own
#: field doc says "per-turn in streaming-input sessions", so it is summed below.
_CUMULATIVE = ("total_cost_usd", "duration_api_ms")
#: Fields describing the ending, not a quantity.
_LAST = ("is_error", "stop_reason")


def _sum_tokens(per_turn: list[dict[str, Any]]) -> dict[str, Any]:
    """The token dicts summed field by field.

    Numeric fields are added; a non-numeric one (the SDK has carried nested
    per-server dicts here) is taken from the last turn that supplied it, because
    adding it is not defined and dropping it would lose a field readers have.
    """
    out: dict[str, Any] = {}
    for usage in per_turn:
        tokens = usage.get("usage")
        if not isinstance(tokens, dict):
            continue
        for key, value in tokens.items():
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                out[key] = value
            else:
                out[key] = (out.get(key) or 0) + value
    return out


def accumulate_usage(turns: list[Turn]) -> dict[str, Any]:
    """One run's usage from its turns: the run TOTAL, plus a per-turn breakdown.

    Decided by the lead, 2026-10-26, when step mode made a run many turns on one
    session. A `ResultMessage` arrives per turn now, where a one-shot query had
    one per run, so the orchestrator's `usage = {...}` assignment would have
    recorded only the LAST turn. Four readers take those fields as the run's --
    `make e2e-latency`, `make e2e-corpus`, `inventory` and `cache-window` -- and
    the corpus cost figures are what the session spend cap was sized from, so
    the failure would have understated spend quietly rather than loudly.

    **The top-level keys keep their meaning: the whole run.** Every existing
    reader therefore keeps working unchanged and keeps comparing new runs with
    committed ones. `per_turn` is additive, and a reader wanting cost per step
    (decision 28) reads that instead.

    Per-turn quantities are summed; running totals (`_CUMULATIVE`) take the latest
    value, and each turn's breakdown carries its step over the one before;
    `is_error` and `stop_reason` describe the ENDING and come from the last turn. A run with no usage at all returns `{}` rather than
    a skeleton of zeroes, which would be indistinguishable from a real run that
    cost nothing.
    """
    stamped = [t for t in turns if isinstance(t.usage, dict)]
    if not stamped:
        return {}
    per_turn_usage = [t.usage or {} for t in stamped]
    out: dict[str, Any] = {}
    for key in _SUMMED:
        values = [u[key] for u in per_turn_usage if _is_number(u.get(key))]
        if values:
            out[key] = sum(values)
    for key in _CUMULATIVE:
        values = [u[key] for u in per_turn_usage if _is_number(u.get(key))]
        if values:
            out[key] = values[-1]
    for key in _LAST:
        for usage in reversed(per_turn_usage):
            if key in usage:
                out[key] = usage[key]
                break
    tokens = _sum_tokens(per_turn_usage)
    if tokens:
        out["usage"] = tokens
    # The breakdown decision 28 asks for: what each step cost and how long the
    # researcher waited for it. `step` and `wall_ms` come from the turn, not the
    # ResultMessage, which is why this is built here rather than by summing.
    # A cumulative field's per-turn figure is its step over the previous turn that
    # reported one: that is what this turn cost.
    deltas: dict[int, dict[str, Any]] = {}
    previous: dict[str, float] = {}
    for t in stamped:
        row: dict[str, Any] = {}
        for key in _CUMULATIVE:
            value = (t.usage or {}).get(key)
            if _is_number(value):
                before = previous.get(key, 0)
                row[key] = value - before if value >= before else value
                previous[key] = value
        deltas[t.index] = row
    out["per_turn"] = [
        {
            "index": t.index,
            "step": t.step,
            "mode": t.mode,
            "wall_ms": t.wall_ms,
            "sent": t.sent,
            "reply": t.reply,
            **{k: (t.usage or {}).get(k) for k in _SUMMED if (t.usage or {}).get(k) is not None},
            **deltas.get(t.index, {}),
        }
        for t in turns
    ]
    return out


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)

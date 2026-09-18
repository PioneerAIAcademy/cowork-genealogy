"""agent_runner — runs INSIDE the sandbox (a local subprocess for the POC; a
process in the E2B microVM when hosted). It owns one user's agent for the life
of the session and speaks JSON lines over **stdio** (not a WebSocket server):

  stdin  : {"type":"user_msg","text":"..."} | {"type":"interrupt"}  (one per line)
  stdout : {"type":"agent_event","event":{...}}   (one per line)

stdin is drained concurrently with the running turn (a reader task feeds a
queue), so an interrupt sent mid-turn is acted on immediately rather than read
only after the turn it was meant to stop has already finished — which is what
made interrupt a no-op while the loop blocked inside handle_turn.

The in-sandbox WS server (app/sandbox_server.py) spawns this and pumps its stdio
to/from the browser. Running over stdio (rather than the Agent SDK directly
inside websockets.serve) keeps the SDK in a clean top-level asyncio loop — its
anyio subprocess transport hangs when hosted inside websockets.serve.

Project-file changes are NOT emitted here — the control plane watches /project
and streams viewer deltas separately. This runner is the chat channel only.

Run as:  python -m app.agent.runner   (env: AGENT_MODE, PROJECT_DIR, MODEL, HOME)
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path

try:  # package context (python -m app.agent.runner)
    from .errors import classify, log_operator
    from .hand_back import AUTO_CONTINUE_TEXT, ends_with_hand_back
    from .mock_agent import MockAgent
except ImportError:  # loose script alongside mock_agent.py (baked E2B image)
    from errors import classify, log_operator  # type: ignore
    from hand_back import AUTO_CONTINUE_TEXT, ends_with_hand_back  # type: ignore
    from mock_agent import MockAgent  # type: ignore


@dataclass(frozen=True)
class AutoContinue:
    """Lay mode's answer to the hand-back (issue #2653): when a turn's final
    main-thread text ends with the ruled literal `Next: <step>. Continue?`, the
    runner starts the next turn with `Yes.` itself, so a stated objective runs
    step by step with no click. Per-step hand-backs stay in the prompts; whether
    anyone has to click is this control-plane setting (lead, 2026-09-18).

    `max_steps` bounds ONE unattended chain — consecutive auto turns since the
    last real user message — not the session: the counter resets on every
    `user_msg`. A `user_msg` may also carry `"auto_continue": false`, which the
    public /v1 API sends on every turn: its callers read the first `turn_done`
    as their reply, so a `Yes.` turn started behind it would be handed to them
    as the answer to their next message.
    """
    enabled: bool = True
    max_steps: int = 30

    @classmethod
    def from_env(cls, env=os.environ) -> "AutoContinue":
        enabled = env.get("AUTO_CONTINUE", "1") not in ("0", "false", "False", "")
        try:
            max_steps = int(env.get("AUTO_CONTINUE_MAX_STEPS", "30"))
        except ValueError:
            max_steps = 30
        return cls(enabled=enabled, max_steps=max(0, max_steps))


def _make_agent(project_dir: Path):
    if os.environ.get("AGENT_MODE", "mock") == "real":
        try:
            from .real_agent import RealAgent  # type: ignore
        except ImportError:
            from real_agent import RealAgent  # type: ignore
        return RealAgent(project_dir)
    return MockAgent(project_dir)


def _emit(event: dict) -> None:
    sys.stdout.write(json.dumps({"type": "agent_event", "event": event}) + "\n")
    sys.stdout.flush()


async def _run_turn(agent, text: str, emit) -> None:
    """One turn. Always ends with exactly one turn_done — the client keys its
    busy state on it, so an error or an interrupt-cancellation must still emit it
    or the UI hangs on a spinner forever."""
    try:
        async for event in agent.handle_turn(text):
            emit(event)
    except asyncio.CancelledError:
        # Interrupt path for agents that cannot self-stop (the mock): the turn
        # task was cancelled. Report the stop, then let turn_done fall through.
        emit({"kind": "error", "text": "(stopped)"})
    except Exception as exc:  # never die on an agent error
        # Not the SDK path — handle_turn wraps its own import, _ensure_client
        # and the whole receive loop, so nothing SDK-shaped escapes to here.
        # This catches mock-agent and framing failures, which are just as
        # unreadable to a user as a 401 was (#1126).
        classification = classify(exc)
        log_operator("run_turn", classification, exc=exc)
        emit({"kind": "error", "text": classification})
    emit({"kind": "turn_done"})  # sole source of turn_done (mock + real)


# How many user_msgs may wait behind a running turn.
#
# A bound is needed, and so is the fact that overflow is REPORTED. The client's
# busy gate is what should stop a backlog forming, and issue #2062 is a report of
# that gate leaking — any `turn_done` clears it, including the synthetic one the
# sandbox emits when the runner exits, and a queued send re-fires from the
# reconnect outbox with no check that the turn it was composed against ever
# ended. So the backlog is real but small: a person types a handful of messages,
# not hundreds. Dropping silently past the bound would just move the defect this
# constant exists to fix to message N+1.
MAX_QUEUED_TURNS = 8

# Internal wake-up, put on the queue by a finished turn so the loop can start the
# next queued message. Not reachable from a client: `Hub.handle` forwards only
# `user_msg` and `interrupt` (`sandbox_server.py`), so nothing outside this
# module can inject it.
_TURN_FINISHED = "_turn_finished"


async def serve(
    agent, incoming: "asyncio.Queue", emit, *, auto_continue: AutoContinue | None = None
) -> None:
    """Dispatch messages from ``incoming`` (a queue fed concurrently with the
    running turn; ``None`` = stdin EOF). At most one turn runs at a time;
    additional user_msgs while busy are QUEUED and run in order.

    THEY USED TO BE DROPPED, and that was issue #2062: the hosted chat answered
    the previous message and kept doing so. Each half looked reasonable alone.
    `Hub.handle` records a `user_msg` into the replay history and sets
    `_turn_active` before forwarding it, so the message is in the transcript the
    user is reading; this loop then discarded it with a bare `continue`. The user
    saw their message appear, never got an answer to it, and read the previous
    turn's completion as the answer — persisting, because every later message
    sent while busy met the same fate. One tester hit it four times in 38 minutes
    and the agent concluded their screen was broken.

    Queueing is also what `docs/specs/public-rest-api-spec.md` already claimed
    was happening ("it won't read the next `user_msg` until the current turn
    emits `turn_done`"), so this makes the code match a contract other reasoning
    on that page already rests on.

    An interrupt CLEARS the backlog. Stop means stop: a person who queued two
    messages and then pressed Stop does not want the second one to start on its
    own a moment later.

    AUTO-CONTINUE (issue #2653). When the finished turn's last main-thread text
    ends with the hand-back literal and nothing is pending, the runner starts a
    `Yes.` turn itself (see `AutoContinue`). A pending user message always wins
    over the synthetic `Yes.`; a question, `Research complete.`, an error, or an
    interrupted turn never continues, because none of them ends with the literal
    (interrupt also clears the recorded text, so a turn cancelled mid-literal
    cannot). The chain announces itself with an `auto_continue` event before
    each synthetic turn, and `auto_continue_paused` when the budget is spent —
    both recorded into the replay history by the Hub like any other event, and
    turned into a bubble boundary by the web's fold.

    Extracted from main() so it is testable without stdio."""
    auto = auto_continue or AutoContinue(enabled=False, max_steps=0)
    turn_task: asyncio.Task | None = None
    pending: list[dict] = []
    # The finished/running turn's last main-thread `text` (no `agent` label —
    # a subagent's prose never carries the hand-back), reset per turn.
    last_text: str | None = None
    # Whether the running chain may auto-continue: the frame that started it
    # said so (or said nothing), and every `Yes.` turn inherits the answer.
    chain_may_continue = auto.enabled
    # Consecutive synthetic turns since the last real user message.
    auto_steps = 0

    def _observe(event: dict) -> None:
        nonlocal last_text
        if event.get("kind") == "text" and "agent" not in event:
            last_text = str(event.get("text", ""))
        emit(event)

    def _start(text: str, *, queued: bool = False) -> None:
        nonlocal turn_task, last_text
        last_text = None
        # EVERY turn announces itself, queued or not.
        #
        # Without this, the only frames a turn produces are the agent's own plus
        # the terminal `turn_done`, so before a turn's first frame there is a
        # silence the length of a full SDK round trip. Two things read that
        # silence as "idle":
        #   * `_drain_replay` (app/v1.py) returns after _DRAIN_IDLE of quiet, so
        #     a caller could send inside the gap and then read the RUNNING
        #     turn's `turn_done` as its own reply.
        #   * `sandbox_server` clears `_turn_active` on every `turn_done`, so
        #     the UI went idle while messages were still queued - and the
        #     client's busy gate is what is supposed to stop a backlog forming.
        #
        # This fired only for QUEUED turns at first, on the reasoning that a
        # first turn's sender already knows it started. That reasoning is about
        # the SENDER and the consumer that matters is the DRAIN: a sync
        # `POST /messages` starts an UNqueued turn, so on its 504 retry there was
        # no `turn_start`, `in_flight` stayed 0, and the drain returned inside
        # the running turn. A first turn is quiet for a full SDK round trip
        # before its first token, so the window is seconds wide, not a race.
        # `queued` stays on the frame for an EXTERNAL client of the public REST
        # API -- nothing in this repo reads it. The web client cannot: ChatPane
        # returns early on turn_start and acts on the `status: turn_active`
        # frame sandbox_server converts this into.
        emit({"kind": "turn_start", "queued": queued})
        turn_task = asyncio.create_task(_run_turn(agent, text, _observe))
        # Wakes this loop when the turn ends, which is what lets a queued message
        # start without `serve` having to poll or block on the turn (it must stay
        # responsive to `interrupt` while a turn runs — that is why interrupt
        # worked at all).
        turn_task.add_done_callback(lambda _t: incoming.put_nowait({"type": _TURN_FINISHED}))

    while True:
        msg = await incoming.get()
        if msg is None:  # stdin EOF — the control plane closed the connection
            break
        mtype = msg.get("type")
        if mtype == _TURN_FINISHED:
            if turn_task is not None and not turn_task.done():
                continue
            if pending:
                # The user wins: their message runs next and no `Yes.` is
                # injected ahead of it (stop condition 4 of issue #2653).
                nxt = pending.pop(0)
                chain_may_continue = auto.enabled and nxt.get("auto_continue", True) is not False
                auto_steps = 0
                _start(nxt.get("text", ""), queued=True)
            elif chain_may_continue and ends_with_hand_back(last_text):
                if auto_steps < auto.max_steps:
                    auto_steps += 1
                    emit({
                        "kind": "auto_continue",
                        "text": AUTO_CONTINUE_TEXT,
                        "step": auto_steps,
                        "max_steps": auto.max_steps,
                    })
                    _start(AUTO_CONTINUE_TEXT, queued=True)
                else:
                    # The literal is still on screen, so the web's Continue
                    # button takes over from here.
                    emit({
                        "kind": "auto_continue_paused",
                        "reason": "budget",
                        "step": auto_steps,
                        "max_steps": auto.max_steps,
                    })
        elif mtype == "user_msg":
            text = msg.get("text", "")
            if turn_task and not turn_task.done():
                if len(pending) >= MAX_QUEUED_TURNS:
                    emit({
                        "kind": "error",
                        "text": (
                            "Too many messages are already waiting for the agent; "
                            "this one was not queued. Wait for the current reply."
                        ),
                    })
                else:
                    pending.append(msg)
                continue
            chain_may_continue = auto.enabled and msg.get("auto_continue", True) is not False
            auto_steps = 0
            _start(text)
        elif mtype == "interrupt":
            pending.clear()
            last_text = None  # a turn cancelled mid-literal must not continue
            if turn_task and not turn_task.done():
                handled = False
                try:
                    handled = bool(await agent.interrupt())
                except Exception as exc:
                    # Concrete #1126 case: the key rotates mid-turn, the control
                    # channel dies, the user presses Stop, and RealAgent.interrupt
                    # raises CLIConnectionError("Not connected") — so the user
                    # read "Interrupt failed: Not connected" for an operator
                    # problem they had no part in.
                    classification = classify(exc)
                    log_operator("interrupt", classification, exc=exc)
                    emit({"kind": "error", "text": classification})
                # The real agent tells the SDK to abort and its stream ends on its
                # own (handled=True). An agent that can't self-stop is cancelled;
                # _run_turn turns that into (stopped) + turn_done.
                if not handled:
                    turn_task.cancel()
    if turn_task and not turn_task.done():
        turn_task.cancel()


async def main() -> None:
    project_dir = Path(os.environ.get("PROJECT_DIR", "/project"))
    agent = _make_agent(project_dir)

    incoming: asyncio.Queue = asyncio.Queue()

    async def reader() -> None:
        # Blocking readline off-thread so the event loop stays free for the
        # agent's async work and for interrupts arriving mid-turn.
        while True:
            line = await asyncio.to_thread(sys.stdin.readline)
            if not line:  # EOF
                await incoming.put(None)
                return
            line = line.strip()
            if not line:
                continue
            try:
                await incoming.put(json.loads(line))
            except json.JSONDecodeError:
                continue

    reader_task = asyncio.create_task(reader())
    try:
        await serve(agent, incoming, _emit, auto_continue=AutoContinue.from_env())
    finally:
        reader_task.cancel()


if __name__ == "__main__":
    asyncio.run(main())

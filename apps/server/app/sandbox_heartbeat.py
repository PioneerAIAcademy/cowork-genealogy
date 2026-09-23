"""Keep a live sandbox's clock running while its agent works (research-as-a-job 1d).

THE PROBLEM. ``_RUNNING_TIMEOUT_S = 3600`` in ``sandbox/e2b.py`` is E2B's Hobby-tier
maximum, and it clocks **continuous runtime, not idleness**. Until now ``set_timeout``
had exactly one caller -- ``resume()``, on ``/connect`` -- so a session's whole hour was
spent from the moment the browser attached. Against a corpus median run of 53.9 minutes
and a p90 of 107.9, one continuous turn per job pauses mid-turn at or before p90, and
around half of runs come within minutes of it. That is the failure 1d exists to remove:
once the agent works continuously, one user message IS the whole hour.

THE RULING (2026-09-21): the heartbeat. Not a Pro-tier upgrade, and not accepting the
pause -- nothing in the repo records what pausing does to an in-flight turn, and the CLI
subprocess, the SDK stream and the browser socket are all in-process.

WHY IT BEATS ON LIVENESS RATHER THAN ON "A TURN IS ACTIVE". The control plane is
deliberately out of the streaming path: ``/connect`` hands the browser a WSS straight to
the sandbox, so the control plane never sees a turn begin or end. Beating for every
*recently live* session is the superset of "a turn is active" that it CAN see, and the
cost of the extra beats is one cheap call per live sandbox per interval. Narrowing this
to real turn boundaries means new plumbing across the sandbox trust boundary, which is
more than the ruling asked for.

THE INTERVAL, and what a missed beat costs. ``BEAT_INTERVAL_S`` is 300 s against a
3600 s ceiling, so a beat restarts a clock that still has ~55 minutes on it: **one missed
beat costs nothing**, and eleven consecutive misses are needed before a sandbox can pause.
A beat is best-effort by construction: ``set_timeout`` past the ceiling returns 204 and
silently no-ops, a gone sandbox raises, and neither may take the loop down.

``LIVE_WINDOW_S`` AND THE LIMIT NOBODY SHOULD HAVE TO REDISCOVER. ``Project.last_active``
is written in exactly two places -- ``sessions.resume_session`` and
``sessions.connect_session`` -- and a running turn refreshes NEITHER, because the control
plane is out of the streaming path. So this window is time since the browser ATTACHED,
not time since the agent last did anything, and beats for a session stop once it lapses
however busy the agent is.

That is why the window is sized on RUN LENGTH rather than on the E2B ceiling. The corpus
puts the longest completed run at 168.8 minutes and p90 at 107.9, so 4 hours covers the
longest run ever recorded with margin, and a turn that outlives it pauses exactly as it
did before this module existed. An earlier draft used one ceiling (3600 s) and claimed a
project idle that long "cannot still be running" -- which is false in precisely the regime
this plan creates, where one user message runs for hours without touching the control
plane at all.

The cost, paid knowingly: a sandbox whose patron attached and then walked away is kept
awake for up to ``LIVE_WINDOW_S`` instead of pausing at the ceiling. Removing that cost
needs a real turn-active signal from inside the sandbox, which is new plumbing across the
trust boundary and more than the 2026-09-21 ruling asked for.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import timedelta

from sqlmodel import Session, select

from .db import get_engine
from .models import Project, utcnow

log = logging.getLogger(__name__)

# Well inside the 3600 s ceiling: see the module docstring for what a missed beat costs.
BEAT_INTERVAL_S = 300
# Sized on RUN LENGTH, not on the E2B ceiling: `last_active` is time since the browser
# attached, and a running turn never refreshes it. The longest completed run in the corpus
# is 168.8 minutes, so 4 h covers it with margin. See the module docstring for why this is
# a heuristic and what it costs.
LIVE_WINDOW_S = 4 * 60 * 60


def live_sandbox_ids(session: Session, *, window_s: int = LIVE_WINDOW_S) -> list[str]:
    """Sandbox ids worth beating: a project whose browser attached inside the window.

    ``Project.sandbox_id`` and ``last_active`` are both non-nullable, so the only filter
    is the window -- but the blank check stays: a row written before its sandbox existed
    carries an empty string, and beating "" is a call that can only fail.

    ``last_active`` is NOT "when the agent last did something" -- see the module docstring.
    """
    cutoff = utcnow() - timedelta(seconds=window_s)
    rows = session.exec(
        select(Project.sandbox_id).where(Project.last_active >= cutoff)  # type: ignore[operator]
    ).all()
    return [r for r in rows if r]


async def beat_once(provider, *, window_s: int = LIVE_WINDOW_S) -> int:
    """One pass: restart the clock on every live sandbox. Returns how many were beaten.

    Never raises. One sandbox that has gone away must not stop the others from being
    beaten, and nothing here is worth failing a request over."""
    try:
        with Session(get_engine()) as session:
            ids = live_sandbox_ids(session, window_s=window_s)
    except Exception as exc:  # noqa: BLE001 - a beat is best-effort
        log.warning("sandbox heartbeat: could not list live sandboxes: %s", exc)
        return 0
    beaten = 0
    for sandbox_id in ids:
        try:
            if await provider.heartbeat(sandbox_id):
                beaten += 1
        except Exception as exc:  # noqa: BLE001 - one dead sandbox must not stop the rest
            log.debug("sandbox heartbeat: %s did not answer: %s", sandbox_id, exc)
    if beaten:
        log.debug("sandbox heartbeat: restarted the clock on %d sandbox(es)", beaten)
    return beaten


async def run_heartbeat(provider, *, interval_s: int = BEAT_INTERVAL_S) -> None:
    """The loop the app lifespan runs. Cancellation is the only way out."""
    log.info("sandbox heartbeat: every %ds, live window %ds", interval_s, LIVE_WINDOW_S)
    while True:
        await beat_once(provider)
        await asyncio.sleep(interval_s)

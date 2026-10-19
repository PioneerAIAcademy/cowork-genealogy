#!/usr/bin/env python3
"""#3305 probe: can `set_timeout` push a running E2B sandbox's end time past one hour
from its start?

`E2BProvider.create` starts every sandbox with `timeout=_RUNNING_TIMEOUT_S` (3600, the
Hobby maximum) and `on_timeout=pause`, and the sandbox heartbeat (removed in #3305)
called `set_timeout(3600)` every 5 minutes so that a busy sandbox would never reach its
end time. That could only work if each call moved the end time to "now + 3600". This creates one
sandbox the same way, waits 5 minutes, calls `set_timeout(3600)` and reads
`get_info().end_at` back. Two more calls follow. `set_timeout(1800)` must pull the end
time in, so a call that changes nothing is not mistaken for a cap. Then
`set_timeout(3600)` again shows whether a call past the cap is clamped to it or ignored.
The sandbox is killed at the end, also on an error or Ctrl-C.

    cd apps/server && E2B_API_KEY=... uv run python dev/probe_e2b_heartbeat.py

The key comes from the environment and is never printed. The tier is the subject: the
SDK's own `set_timeout` docstring gives the limit per tier, 1 hour for Hobby users and
24 for Pro. So the probe first checks that the account is Hobby: a create with
`timeout=7200` must be refused, or come back with an end time an hour after its start.
It uses E2B's public `base` template, so any account can run it; `--template` picks
another. One small sandbox for about 5 minutes.

Exit 0 when the end time did not move and the control call did (the cap holds, so the
heartbeat cannot extend a sandbox), 1 when it moved (the cap does not explain the
pauses), 2 when the account is not Hobby, or the run is inconclusive or failed.

Measured 2026-10-15 (n=1, a personal Hobby account, the `base` template, e2b 2.35.0):
`create(timeout=7200)` was refused, `400: Timeout cannot be greater than 1 hours`. The
sandbox's end time was start + 3600. At t+300s `set_timeout(3600)` returned success and left
it at start + 3600; `set_timeout(1800)` at t+302s moved it to start + 2102; a second
`set_timeout(3600)` put it back at start + 3600. So on Hobby `set_timeout` cannot push a
running sandbox's end time past an hour after its start, and a call that would is clamped to
that hour (#3305).
"""

from __future__ import annotations

import argparse
import asyncio
import datetime
import importlib.metadata
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.sandbox.e2b import _RUNNING_TIMEOUT_S  # noqa: E402

# What E2BProvider.create passes.
LIFECYCLE = {"on_timeout": "pause", "auto_resume": True}
CONTROL_TIMEOUT_S = 1800
# How far an end time may sit from the expected one and still count as on target. It
# covers request round trips and sandbox boot, not the effect being measured.
SLACK_S = 60


def iso(dt: datetime.datetime) -> str:
    return dt.isoformat(timespec="seconds")


async def set_and_read(sb, timeout: int, t0: float, started: datetime.datetime) -> tuple[float, float]:
    """Call set_timeout, then return (seconds since create, end_at in seconds after start)."""
    # Wall clock, not monotonic: E2B's clock keeps running if this machine sleeps.
    elapsed = time.time() - t0
    try:
        await sb.set_timeout(timeout)
        outcome = "ok"
    except Exception as exc:  # the API's answer is part of the measurement
        outcome = f"{type(exc).__name__}: {exc}"
    info = await sb.get_info()
    offset = (info.end_at - started).total_seconds()
    state = getattr(info.state, "value", info.state)
    print(f"t+{elapsed:.0f}s set_timeout({timeout}) -> {outcome}; end_at={iso(info.end_at)}, "
          f"{offset:.0f}s after start, state={state}")
    return elapsed, offset


async def hobby_tier(sdk, template: str) -> tuple[bool, str]:
    """Is this a Hobby account? Asks for a 2-hour sandbox, which Hobby does not allow."""
    timeout = 2 * _RUNNING_TIMEOUT_S
    try:
        sb = await sdk.create(template=template, timeout=timeout, lifecycle=LIFECYCLE)
    except Exception as exc:
        if "timeout" not in str(exc).lower():
            raise
        return True, f"create(timeout={timeout}) refused: {exc}"
    try:
        info = await sb.get_info()
        span = (info.end_at - info.started_at).total_seconds()
    finally:
        await sb.kill()
    return span <= _RUNNING_TIMEOUT_S + SLACK_S, f"create(timeout={timeout}) ran with an end time {span:.0f}s after start"


async def probe(template: str, wait_s: int) -> int:
    from e2b import AsyncSandbox

    now = datetime.datetime.now(datetime.timezone.utc)
    print(f"{iso(now)} e2b={importlib.metadata.version('e2b')} template={template} "
          f"timeout={_RUNNING_TIMEOUT_S} lifecycle={LIFECYCLE}")
    hobby, why = await hobby_tier(AsyncSandbox, template)
    print(f"tier check: {why}")
    if not hobby:
        print("RESULT: this account is not on the Hobby tier, which is what this probe measures.")
        return 2
    sb = await AsyncSandbox.create(template=template, timeout=_RUNNING_TIMEOUT_S, lifecycle=LIFECYCLE)
    t0 = time.time()
    try:
        info = await sb.get_info()
        started = info.started_at
        created = (info.end_at - started).total_seconds()
        print(f"created {sb.sandbox_id}: started_at={iso(started)}, end_at={iso(info.end_at)}, "
              f"{created:.0f}s after start")
        print(f"waiting {wait_s}s")
        await asyncio.sleep(wait_s)
        e1, o1 = await set_and_read(sb, _RUNNING_TIMEOUT_S, t0, started)
        e2, o2 = await set_and_read(sb, CONTROL_TIMEOUT_S, t0, started)
        e3, o3 = await set_and_read(sb, _RUNNING_TIMEOUT_S, t0, started)
    finally:
        try:
            await sb.kill()
            print("sandbox killed")
        except Exception as exc:
            print(f"kill failed ({type(exc).__name__}: {exc}); delete {sb.sandbox_id} in the E2B dashboard")

    moved = o1 - created
    if moved >= wait_s / 2:
        print(f"RESULT: set_timeout({_RUNNING_TIMEOUT_S}) at t+{e1:.0f}s moved the end time {moved:+.0f}s. "
              "A running sandbox's end time can be extended, so the cap does not explain the pauses.")
        return 1
    if moved <= -wait_s / 2:
        print(f"RESULT: inconclusive. set_timeout({_RUNNING_TIMEOUT_S}) moved the end time earlier ({moved:+.0f}s).")
        return 2
    if abs(o2 - (e2 + CONTROL_TIMEOUT_S)) > SLACK_S:
        print(f"RESULT: inconclusive. set_timeout({CONTROL_TIMEOUT_S}) did not put the end time near "
              f"{e2 + CONTROL_TIMEOUT_S:.0f}s after start either, so a call that changes nothing cannot "
              "be told from a cap.")
        return 2
    if abs(o3 - created) <= SLACK_S:
        after = "clamped to the cap"
    elif abs(o3 - o2) <= SLACK_S:
        after = "ignored"
    elif abs(o3 - (e3 + _RUNNING_TIMEOUT_S)) <= SLACK_S:
        after = f"moved to now + {_RUNNING_TIMEOUT_S}"
    else:
        after = "none of clamped, ignored or now + timeout"
    print(f"RESULT: set_timeout({_RUNNING_TIMEOUT_S}) at t+{e1:.0f}s left the end time {moved:+.0f}s from where "
          f"create put it ({created:.0f}s after start), while set_timeout({CONTROL_TIMEOUT_S}) moved it to "
          f"{o2:.0f}s after start. A running sandbox's end time cannot pass {created:.0f}s after its start, "
          f"so set_timeout({_RUNNING_TIMEOUT_S}) cannot extend it. After the control, "
          f"set_timeout({_RUNNING_TIMEOUT_S}) was {after} ({o3:.0f}s after start).")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--template", default="base", help="E2B template name or id (default: base)")
    ap.add_argument("--wait", type=int, default=300, help="seconds between create and set_timeout (default: 300)")
    args = ap.parse_args()
    if args.wait < 60:
        ap.error("--wait must be at least 60 seconds")
    if not os.environ.get("E2B_API_KEY"):
        print("E2B_API_KEY is not set")
        return 2
    if os.environ.get("E2B_DEBUG", "false").lower() == "true":
        # The SDK skips set_timeout entirely in debug mode, which would read as a cap.
        print("E2B_DEBUG=true makes the SDK skip set_timeout; unset it")
        return 2
    return asyncio.run(probe(args.template, args.wait))


if __name__ == "__main__":
    sys.exit(main())

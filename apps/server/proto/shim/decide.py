"""The sqsd shim's outcome -> action rule, pure so it can be unit-tested.

``decide`` sees what one POST to the worker produced -- an HTTP status, or the
name of a connection-level failure -- plus how many times SQS has delivered the
message, and returns what the shim must do with the message. No I/O here; the
SQS and docker calls live in ``shim.py``. Tests: ``apps/server/tests/test_proto_decide.py``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

# Defaults match PLAN.md; the shim overrides them from BACKOFF_BASE_S / BACKOFF_MAX_S.
BACKOFF_BASE_S = 5
BACKOFF_MAX_S = 300

# The one connection-level failure that means "the worker is still busy": the POST
# outlived the step ceiling. Only this error earns a container kill.
READ_TIMEOUT = "read_timeout"

Action = Literal["delete", "requeue", "requeue_backoff"]


@dataclass(frozen=True)
class Decision:
    action: Action
    backoff_s: int
    kill_worker: bool


def backoff_for(receive_count: int, base_s: int = BACKOFF_BASE_S, max_s: int = BACKOFF_MAX_S) -> int:
    """Doubling backoff per delivery: ``base_s`` on the first receive, capped at ``max_s``."""
    n = max(1, receive_count)
    if n - 1 >= 62:  # 2**62 already dwarfs any cap; skip the pointless bigint
        return max_s
    return min(base_s * 2 ** (n - 1), max_s)


def decide(
    status: int | None,
    error: str | None,
    receive_count: int,
    *,
    backoff_base_s: int = BACKOFF_BASE_S,
    backoff_max_s: int = BACKOFF_MAX_S,
) -> Decision:
    """Map one POST outcome to the shim's action.

    Exactly one of ``status`` (an HTTP status the worker returned) and ``error``
    (a connection-level failure name: ``connection_refused``, ``connection_reset``,
    ``connect_timeout``, ``read_timeout``, ...) must be given.

    - 2xx                        -> delete the message (turn completion is durable)
    - any connection-level error -> make the message visible again now; kill the
                                    worker container first if the error was the
                                    read timeout (the POST outlived the ceiling)
    - any other status           -> make it visible again after a backoff that
                                    doubles per receive count, base..max
    """
    if (status is None) == (error is None):
        raise ValueError("decide() needs exactly one of status or error")
    if error is not None:
        return Decision("requeue", 0, error == READ_TIMEOUT)
    if 200 <= status < 300:
        return Decision("delete", 0, False)
    return Decision(
        "requeue_backoff",
        backoff_for(receive_count, backoff_base_s, backoff_max_s),
        False,
    )

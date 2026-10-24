"""The turn message both tiers enqueue.

One definition, in a module both images copy (as ``grants.py`` is), because the
worker image carries no ``proto/web/``. The web tier enqueues what the patron
typed; the worker enqueues the host's reply under "Keep going" (section A2), and
a body built two ways would drift in the field the other tier reads.

Stdlib only -- the worker imports it as ``proto.turn_message`` and the web tier,
whose image flattens ``proto/`` to its root, as ``turn_message``.
"""

from __future__ import annotations

from typing import Any

# What marks a message the host sent for the researcher rather than one they
# typed. The browser renders it as an automatic "Keep going." (section A), and
# `next_auto_reply` counts it as a turn of the run.
AUTO_KEY = "auto"


def queue_body(
    turn_id: str,
    session_id: str,
    project_id: str,
    text: str,
    enqueued_at: str,
    nudges: int,
    *,
    auto: bool = False,
) -> dict[str, Any]:
    """The turn message the worker receives. One definition, so a test driving a fake
    store still asserts the shape production enqueues.

    ``nudges`` is 1a's carrier: the worker prefers it over its own
    ``AUTONOMOUS_MAX_NUDGES`` because one worker serves the browser and
    ``make proto-demo`` and cannot tell them apart. It comes from the enqueuing
    tier's environment and never from the request.

    ``auto`` marks the host's own reply. The key is absent on a patron's message
    rather than present and false, so an older body and a typed one are the same
    bytes -- `is_auto` is how to ask.
    """
    body: dict[str, Any] = {
        "turn_id": turn_id,
        "session_id": session_id,
        "project_id": project_id,
        "text": text,
        "enqueued_at": enqueued_at,
        "max_nudges": nudges,
    }
    if auto:
        body[AUTO_KEY] = True
    return body


def is_auto(body: Any) -> bool:
    """Whether this message is the host's reply. Tolerates a body of any shape:
    a message read back from the row is whatever was written, possibly by an
    older build."""
    return bool(isinstance(body, dict) and body.get(AUTO_KEY) is True)

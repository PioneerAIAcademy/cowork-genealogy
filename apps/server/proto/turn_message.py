"""The turn message the web tier enqueues and the held-message claim both tiers run.

One definition, in a module both images copy (as ``grants.py`` is), because the
worker image carries no ``proto/web/``. The web tier enqueues what the patron
typed, and both tiers release a held one; a body or a claim written two ways
would drift in the field the other tier reads.

Stdlib only -- the worker imports it as ``proto.turn_message`` and the web tier,
whose image flattens ``proto/`` to its root, as ``turn_message``.
"""

from __future__ import annotations

from typing import Any


def queue_body(
    turn_id: str,
    session_id: str,
    project_id: str,
    text: str,
    enqueued_at: str,
) -> dict[str, Any]:
    """The turn message the worker receives. One definition, so a test driving a fake
    store still asserts the shape production enqueues."""
    return {
        "turn_id": turn_id,
        "session_id": session_id,
        "project_id": project_id,
        "text": text,
        "enqueued_at": enqueued_at,
    }


#: The claim of a session's oldest held message, shared by the worker's
#: `take_queued_turn` and the web tier's `_claim_held`, so the release after a close
#: and the rescue on a post cannot disagree about which row is next.
#: Params: (session_id, queued outcome).
CLAIM_HELD_SQL = (
    "UPDATE turns SET outcome = NULL, claimed_at = now() WHERE turn_id = ("
    "  SELECT turn_id FROM turns WHERE session_id = %s AND outcome = %s "
    "  AND completed_at IS NULL "
    "  ORDER BY enqueued_at LIMIT 1 FOR UPDATE SKIP LOCKED"
    ") RETURNING message, claimed_at"
)

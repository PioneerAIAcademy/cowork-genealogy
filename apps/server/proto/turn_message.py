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


# ── Stop and typing win over a held host reply (section A2) ──────────────────────
#
# The SQL both tiers run against `turns`, so the claim the worker makes after a close
# and the rescue the web tier makes on a post cannot disagree about which held row is
# the host's. Kept here beside `AUTO_KEY` because the predicate IS that key.

#: A row whose message the host sent, as a SQL predicate on `turns.message`. COALESCEd:
#: a typed message carries no key, and a bare comparison would be NULL there, which
#: `NOT` leaves NULL -- dropping the researcher's own rows from every filter below.
AUTO_ROW_SQL = f"COALESCE((message ->> '{AUTO_KEY}') = 'true', false)"

#: What a held host reply is closed as when the researcher's own message supersedes it.
SUPERSEDED_OUTCOME = "superseded"

#: Close every held host reply on a session. Run by `admit_message` before it decides
#: whether the researcher's message is held: their words are the next turn, so a reply
#: the host queued for a run they have just interrupted must not go out ahead of them.
#: Params: (superseded outcome, session_id, queued outcome).
DROP_HELD_AUTO_SQL = (
    "UPDATE turns SET outcome = %s, completed_at = now() WHERE session_id = %s "
    f"AND outcome = %s AND completed_at IS NULL AND {AUTO_ROW_SQL}"
)

#: The claim of a session's oldest held message, shared by the worker's
#: `take_queued_turn` and the web tier's `_claim_held`. A host reply is never released
#: while Stop is set: the researcher ended the run, and claiming would clear their Stop.
#: Params: (session_id, queued outcome, session_id).
CLAIM_HELD_SQL = (
    "UPDATE turns SET outcome = NULL, claimed_at = now() WHERE turn_id = ("
    "  SELECT turn_id FROM turns WHERE session_id = %s AND outcome = %s "
    "  AND completed_at IS NULL "
    f"  AND NOT ({AUTO_ROW_SQL} AND EXISTS (SELECT 1 FROM sessions s "
    "      WHERE s.session_id = %s AND s.stop_requested_at IS NOT NULL)) "
    "  ORDER BY enqueued_at LIMIT 1 FOR UPDATE SKIP LOCKED"
    ") RETURNING message, claimed_at"
)

#: The SSE stream's "a message is waiting" check. Leaves host replies out: a held
#: reply is the run moving, not the researcher's words waiting behind a turn.
#: Params: (session_id, queued outcome).
HAS_TYPED_QUEUED_SQL = (
    "SELECT EXISTS (SELECT 1 FROM turns WHERE session_id = %s AND completed_at IS NULL "
    f"AND outcome = %s AND NOT {AUTO_ROW_SQL}) AS queued"
)

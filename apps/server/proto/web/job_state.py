"""What a session looks like to someone coming back to it.

`session_out` reported a hardcoded "active" for every session, so the list could not
answer the only question a returning reader has: is this still working, does it want
me, did it finish, or did it stop? The parent plan names those four states, and this
is the single place that decides them.

Pure on purpose: no database, so the mapping is testable and has one definition.
"""

from __future__ import annotations

# Waiting on a person: the agent asked something and the turn ended on it.
#
# "queued" used to be in here as an OUTCOME and could never be reached:
# `latest_outcome` is read from turns with `completed_at IS NOT NULL`, and a held
# message is precisely a turn that has not completed. It is now a state of its own,
# driven by `has_queued` -- the parameter that CAN say it -- rather than an outcome.
_NEEDS_YOU = {"decision"}


def job_state(
    *,
    latest_outcome: str | None,
    turn_in_flight: bool,
    project_completed: bool,
    has_queued: bool = False,
) -> str:
    """One of: ``running``, ``queued``, ``needs you``, ``done``, ``stopped``, ``new``.

    Order matters. Work happening NOW outranks whatever the last turn concluded --
    a new turn on a finished project is running, not done.

    ``delivered`` maps to ``stopped`` while the project is open. The turn ended on
    purpose because a bounded request was met, but the RESEARCH is unfinished, and
    telling a returning reader "done" would claim their project is complete when it
    is not -- exactly the confusion the delivered outcome exists to prevent.
    """
    if turn_in_flight:
        return "running"
    if has_queued:
        # A message the reader sent mid-turn, held until the turn ends.
        #
        # NOT "needs you": the reader has already spoken and the SYSTEM owes the next
        # move, so asking them for something they have just given is backwards.
        #
        # NOT "running" either, which is the other obvious mapping and the wrong one:
        # `turn_in_flight` once counted held turns, so "running" latched on and the
        # session read as working forever (`test_a_held_message_does_not_latch_running
        # _through_the_real_query`). Reusing it here would blur the very distinction
        # that test exists to keep.
        #
        # Its own state, then. Ranked below `turn_in_flight` because a live turn is
        # the more useful thing to say when both are true.
        return "queued"
    if latest_outcome is None:
        # No turn has ever run. "stopped" would read as a failure on a new session.
        return "new"
    if latest_outcome in _NEEDS_YOU:
        return "needs you"
    if project_completed:
        return "done"
    # Everything else -- budget, no_progress, stopped, mcp_unavailable, delivered,
    # and any outcome added later that nothing here knows about. There is deliberately
    # no allow-list: a new outcome falling through to "stopped" is safe, while falling
    # through to "done" would tell a reader their research finished when it did not.
    return "stopped"

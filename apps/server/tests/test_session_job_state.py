"""The session list's job state (phase 2, "one view of job state").

`session_out` returned a hardcoded "active" for every session, so the list could not
show what the parent plan asks for -- running, needs you, done or stopped -- and a
returning reader had no way to tell a finished job from one waiting on them.

The mapping is a pure function so it can be tested without a database.
"""

from proto.web.job_state import job_state


def test_a_turn_still_in_flight_is_running():
    assert job_state(latest_outcome=None, turn_in_flight=True, project_completed=False) == "running"


def test_in_flight_beats_everything_else():
    """A new turn on a finished project is running, not done -- the reader is
    watching work happen right now."""
    assert job_state(latest_outcome="completed", turn_in_flight=True, project_completed=True) == "running"


def test_a_decision_is_waiting_on_the_researcher():
    assert job_state(latest_outcome="decision", turn_in_flight=False, project_completed=False) == "needs you"


def test_a_queued_message_is_also_waiting():
    assert job_state(latest_outcome="queued", turn_in_flight=False, project_completed=False) == "needs you"


def test_a_completed_project_is_done():
    assert job_state(latest_outcome="completed", turn_in_flight=False, project_completed=True) == "done"


def test_the_caps_and_stops_read_as_stopped():
    for outcome in ("budget", "no_progress", "stopped", "mcp_unavailable"):
        assert job_state(latest_outcome=outcome, turn_in_flight=False, project_completed=False) == "stopped"


def test_delivered_is_stopped_not_done_while_the_project_is_open():
    """A bounded request was met and the run stopped on purpose, but the RESEARCH is
    not finished. Calling that "done" would tell a returning reader their project is
    complete when it is not -- the same confusion `delivered` exists to prevent."""
    assert job_state(latest_outcome="delivered", turn_in_flight=False, project_completed=False) == "stopped"


def test_delivered_on_a_finished_project_is_done():
    assert job_state(latest_outcome="delivered", turn_in_flight=False, project_completed=True) == "done"


def test_a_session_that_never_ran_is_not_reported_as_stopped():
    """A brand-new session has no turns. Showing "stopped" would read as a failure."""
    assert job_state(latest_outcome=None, turn_in_flight=False, project_completed=False) == "new"


def test_an_unknown_outcome_does_not_crash_or_claim_done():
    assert job_state(latest_outcome="some_future_outcome", turn_in_flight=False,
                     project_completed=False) == "stopped"

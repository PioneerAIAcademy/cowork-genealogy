"""`job_state` against REAL Postgres: the SELECT must actually derive what it reads.

`test_session_job_state.py` already covers the pure mapping, and it passed throughout
while the feature was dead. `_SELECT` fetched seven columns and none of the three the
mapping needs, so `_row`'s `r.get(...)` returned None/False for every session and EVERY
session reported "new" -- the one answer that makes the list useless to a returning
reader, which is the whole reason the four states exist.

A pure-function test cannot catch that, and neither can a stubbed one: the defect is
entirely in the SQL. Found by inserting real turn rows against compose and watching the
API keep saying "new".

Without the DSN this module skips, except under ``CI``, where it fails -- the same
contract as the other `_pg` suites.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest
from psycopg.types.json import Jsonb

from tests._proto_pg import database, session, sql, turn

PROTO = Path(__file__).resolve().parents[1] / "proto"
if str(PROTO) not in sys.path:
    sys.path.insert(0, str(PROTO))

from web.app import PgStore, session_out  # noqa: E402


@pytest.fixture(scope="module")
def pg_dsn():
    with database(prefix="jobst_") as dsn:
        yield dsn


def _state(dsn: str, owner: str) -> str:
    """The job_state the LIST route would hand the browser, through the real query."""
    async def go() -> str:
        rows = await PgStore(dsn).list_sessions(owner)
        assert len(rows) == 1, f"expected exactly one session for {owner}, got {len(rows)}"
        return session_out(rows[0])["job_state"]

    return asyncio.run(go())


def _owner_of(dsn: str, pid: str) -> str:
    return sql(dsn, "SELECT owner_id FROM projects WHERE project_id = %s", (pid,))[0][0]


def _own(dsn: str, pid: str) -> str:
    """Give the session's project an owner.

    `_proto_pg.session` inserts only a `sessions` row, and `list_sessions` reaches a
    session through `projects.owner_id`, so without this the list is empty and every
    assertion below would be vacuous rather than wrong.
    """
    owner = "u_" + pid[-8:]
    sql(dsn, "INSERT INTO users (id, email) VALUES (%s, %s) ON CONFLICT (id) DO NOTHING",
        (owner, owner + "@example.test"))
    sql(dsn, "INSERT INTO projects (project_id, owner_id) VALUES (%s, %s) "
             "ON CONFLICT (project_id) DO UPDATE SET owner_id = EXCLUDED.owner_id", (pid, owner))
    return owner


def _research(dsn: str, pid: str, status: str) -> None:
    sql(dsn,
        "INSERT INTO documents (project_id, name, version, doc) VALUES (%s, 'research.json', 1, %s) "
        "ON CONFLICT (project_id, name) DO UPDATE SET doc = EXCLUDED.doc",
        (pid, Jsonb({"project": {"status": status}})))


def test_every_state_is_reachable_through_the_real_query(pg_dsn):
    """All five, driven by rows rather than by arguments.

    Asserting only one state would pass against a query that hardcoded it -- which is
    materially what the broken version did.
    """
    row = session(pg_dsn)  # ships with one completed turn
    owner = _own(pg_dsn, row.project_id)
    seen = {}

    # `new`: no turn has ever run.
    sql(pg_dsn, "DELETE FROM turns WHERE session_id = %s", (row.session_id,))
    seen["new"] = _state(pg_dsn, owner)

    # `stopped`: a completed turn that is not a question, project still open.
    turn(pg_dsn, row.session_id, row.project_id, "go", completed=True, outcome="delivered")
    seen["stopped"] = _state(pg_dsn, owner)

    # `running`: work in flight outranks whatever the last turn concluded.
    turn(pg_dsn, row.session_id, row.project_id, "go again")
    seen["running"] = _state(pg_dsn, owner)

    # `needs you`: the two ways a person is being waited on. They are NOT both
    # outcomes -- this loop used to set `outcome = 'queued'` on a COMPLETED turn, a row
    # production cannot produce, because a held message is by definition uncompleted.
    # That is why the held-message path stayed broken while this test passed.
    sql(pg_dsn, "DELETE FROM turns WHERE completed_at IS NULL AND session_id = %s", (row.session_id,))
    sql(pg_dsn, "UPDATE turns SET outcome = 'decision' WHERE session_id = %s", (row.session_id,))
    assert _state(pg_dsn, owner) == "needs you", "a decision outcome must mean needs you"
    held = turn(pg_dsn, row.session_id, row.project_id, "sent mid-turn")
    sql(pg_dsn, "UPDATE turns SET completed_at = NULL, outcome = 'queued' WHERE turn_id = %s", (held,))
    assert _state(pg_dsn, owner) == "queued", "a HELD message must mean queued"
    seen["queued"] = _state(pg_dsn, owner)
    sql(pg_dsn, "DELETE FROM turns WHERE turn_id = %s", (held,))
    seen["needs you"] = "needs you"

    # `done`: the project itself says completed.
    sql(pg_dsn, "UPDATE turns SET outcome = 'stopped' WHERE session_id = %s", (row.session_id,))
    _research(pg_dsn, row.project_id, "completed")
    seen["done"] = _state(pg_dsn, owner)

    assert seen == {"new": "new", "stopped": "stopped", "running": "running",
                    "queued": "queued", "needs you": "needs you", "done": "done"}, seen


def test_latest_outcome_is_the_newest_COMPLETED_turn(pg_dsn):
    """Ordered by COMPLETION, not by enqueue.

    The two orders have to disagree or this proves nothing: an earlier draft enqueued
    "first" before "second" and completed them in the same order, so ordering by
    `enqueued_at` gave the identical answer and the test passed against the defect it
    was written to catch.

    So: the turn enqueued FIRST finishes LAST. Ordering by completion reads `delivered`
    (stopped); ordering by enqueue reads `decision` (needs you). Turns can genuinely
    finish out of order -- a redelivery resumes an older turn while a newer one has
    already closed.
    """
    row = session(pg_dsn)
    owner = _own(pg_dsn, row.project_id)
    sql(pg_dsn, "DELETE FROM turns WHERE session_id = %s", (row.session_id,))

    early = turn(pg_dsn, row.session_id, row.project_id, "enqueued first",
                 completed=True, outcome="delivered")
    late = turn(pg_dsn, row.session_id, row.project_id, "enqueued second",
                completed=True, outcome="decision")
    # Enqueue order early < late; completion order reversed.
    sql(pg_dsn, "UPDATE turns SET enqueued_at = now() - interval '2 hours', "
                "completed_at = now() WHERE turn_id = %s", (early,))
    sql(pg_dsn, "UPDATE turns SET enqueued_at = now() - interval '1 hour', "
                "completed_at = now() - interval '30 minutes' WHERE turn_id = %s", (late,))

    assert _state(pg_dsn, owner) == "stopped", (
        "the newest COMPLETED turn is the one enqueued first (delivered -> stopped); "
        "reading 'needs you' means the query ordered by enqueue time instead"
    )


def test_a_held_message_does_not_latch_running_through_the_real_query(pg_dsn):
    """should-fix 10 of the #3262 self-review, against the real SQL.

    The list's `turn_in_flight` subquery was `completed_at IS NULL` with no outcome
    clause. A HELD message is exactly that — a turns row with no completion and
    `outcome = 'queued'` — so the first one a reader sent mid-turn latched "running" on
    and the session read as working forever, with nothing working on it.
    `TURN_ACTIVE_SQL` already excluded held turns for this reason; the list's own query
    did not.

    Only visible against real Postgres: the pure `job_state` unit tests take
    `turn_in_flight` as a given, so they cannot see which rows the query counts.
    """
    row = session(pg_dsn)
    _own(pg_dsn, row.project_id)
    # One completed turn, then a held message behind it.
    t1 = turn(pg_dsn, row.session_id, row.project_id, "first")
    sql(pg_dsn, "UPDATE turns SET completed_at = now(), outcome = 'completed' WHERE turn_id = %s", (t1,))
    held = turn(pg_dsn, row.session_id, row.project_id, "sent mid-turn")
    sql(pg_dsn, "UPDATE turns SET completed_at = NULL, outcome = 'queued' WHERE turn_id = %s", (held,))

    state = _state(pg_dsn, _owner_of(pg_dsn, row.project_id))
    # `queued` since the held message became its own state; what this test guards is
    # unchanged and is the NEGATIVE: it must not read `running`, which would mean the
    # subquery is counting held turns as in-flight again. Keeping `queued` distinct
    # from `running` is exactly what lets this assertion stay sharp.
    assert state == "queued", (
        f"a held message read as {state!r}; 'running' means the subquery is counting "
        "held turns as in-flight again"
    )

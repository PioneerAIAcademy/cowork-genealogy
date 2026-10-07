"""U23 D7/D8/D10: holding and releasing a session's messages against REAL Postgres
(docs/plan/familysearch-handoff.md, U23).

Two tiers start turns on one session: the worker releasing a held message when a turn
ends (``worker.release_next_held``), and the web tier admitting a new one
(``PgStore.admit_message``). Each asks "is a turn running?" and then acts on the answer,
and both used to do it in separate autocommit statements, so a message admitted between
the worker's check and its claim went straight out beside the one the worker released:
two turns on one session, two CLIs on one SDK transcript. Both now hold the session's
queue lock (``grants.QUEUE_LOCK_NS``) across the check and the act. No fake proves
anything about an advisory lock, so the interleavings run here: a test-only proxy over a
real connection pauses one tier between its check and its claim, the other tier runs into
the window, and the pause ends when the other tier has finished or is seen waiting on the
queue lock in ``pg_locks`` -- never inferred from a sleep.

Without the DSN the module skips -- except under ``CI``, where it fails, so the job cannot
pass by skipping. ``make proto-grants-test`` runs it against the compose Postgres.
"""

from __future__ import annotations

import asyncio
import json
import sys
import threading
import time
import uuid
from datetime import datetime, timezone

import psycopg
import pytest
from psycopg.types.json import Jsonb

from proto import enqueue, grants
from proto.worker import worker
from tests._proto_pg import PROTO, database, sql

sys.path.insert(0, str(PROTO))

import web.app as web_app  # noqa: E402
from web.app import PgStore, SessionRow  # noqa: E402

CLAIM = "RETURNING message"  # the held-message claim, the same statement in both tiers
WAIT_S = 10.0


@pytest.fixture(scope="module")
def pg_dsn():
    with database(prefix="u23_") as dsn:
        yield dsn


@pytest.fixture
def sent(monkeypatch, pg_dsn) -> list[dict]:
    """The worker's SQS sends, recorded; the queue configured and signable."""
    bodies: list[dict] = []
    lock = threading.Lock()

    def send(endpoint, action, params, *, timeout):
        import json

        with lock:
            bodies.append(json.loads(params["MessageBody"]))
            return f"<R><MessageId>m-{len(bodies)}</MessageId></R>"

    monkeypatch.setattr(worker, "PG_DSN", pg_dsn)
    monkeypatch.setattr(worker, "QUEUE_URL", "http://q/000000000000/turns")
    monkeypatch.setattr(worker, "log", lambda **f: None)
    monkeypatch.setattr(enqueue, "credentials_ready", lambda timeout=None: True)
    monkeypatch.setattr(enqueue, "sqs_call", send)
    return bodies


def session(dsn: str, *, running: bool = False, held: tuple[str, ...] = ()) -> SessionRow:
    """A fresh session with one completed turn, optionally a running one, and ``held``
    messages queued oldest-first."""
    sid, pid = "sess_" + uuid.uuid4().hex[:10], "proj_" + uuid.uuid4().hex[:10]
    sql(dsn, "INSERT INTO sessions (session_id, project_id) VALUES (%s, %s)", (sid, pid))
    turn(dsn, sid, pid, "done", completed=True, outcome="ok")
    if running:
        turn(dsn, sid, pid, "running")
    for text in held:
        turn(dsn, sid, pid, text, outcome="queued")
    now = datetime.now(tz=timezone.utc)
    return SessionRow(sid, pid, "t", "m", now, now)


def turn(dsn: str, sid: str, pid: str, text: str, *, completed: bool = False, outcome: str | None = None) -> str:
    """``enqueued_at`` from this host's clock, as the web tier stamps it: the oldest-first
    claim compares it with the web tier's own stamps, and the database's clock can differ."""
    turn_id = "turn_" + uuid.uuid4().hex[:10]
    sql(dsn, "INSERT INTO turns (turn_id, session_id, project_id, message, enqueued_at, completed_at, outcome) "
             "VALUES (%s, %s, %s, %s, %s, CASE WHEN %s THEN now() END, %s)",
        (turn_id, sid, pid, Jsonb({"turn_id": turn_id, "session_id": sid, "project_id": pid, "text": text}),
         datetime.now(tz=timezone.utc), completed, outcome))
    return turn_id


def running(dsn: str, sid: str) -> list[str]:
    """The texts of the session's open turns that are not held: started, or about to be."""
    rows = sql(dsn, "SELECT message->>'text' FROM turns WHERE session_id = %s AND completed_at IS NULL "
                    "AND outcome IS NULL ORDER BY enqueued_at", (sid,))
    return [r[0] for r in rows]


def held(dsn: str, sid: str) -> list[str]:
    rows = sql(dsn, "SELECT message->>'text' FROM turns WHERE session_id = %s AND completed_at IS NULL "
                    "AND outcome = 'queued' ORDER BY enqueued_at", (sid,))
    return [r[0] for r in rows]


def web_sends(admitted: tuple) -> list[str]:
    """What post_message enqueues for an ``admit_message`` result."""
    new, was_held, rescued = admitted
    return [str(rescued["text"])] if was_held and rescued else [] if was_held else [str(new.body["text"])]


async def queue_lock_waiter(dsn: str) -> bool:
    rows = await asyncio.to_thread(
        sql, dsn, "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted "
                  "AND classid::int8 = %s AND database = (SELECT oid FROM pg_database "
                  "WHERE datname = current_database())", (grants.QUEUE_LOCK_NS,))
    return bool(rows[0][0])


async def settle(dsn: str, other: asyncio.Future) -> None:
    """Until ``other`` has finished or waits on a queue lock; fail at the deadline."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + WAIT_S
    while loop.time() < deadline:
        if other.done() or await queue_lock_waiter(dsn):
            return
        await asyncio.sleep(0.05)
    raise AssertionError("the other tier neither finished nor waited on the queue lock")


# ── pausing proxies over real connections ──────────────────────────────────────────


class PausingConn:
    """A sync psycopg connection whose cursors call ``pause()`` before the first statement
    containing ``marker``; everything else is the real connection."""

    def __init__(self, conn: psycopg.Connection, marker: str, pause) -> None:
        self._conn, self._marker, self._pause = conn, marker, pause

    def cursor(self):
        return _PausingCursor(self, self._conn.cursor())

    def __getattr__(self, name):
        return getattr(self._conn, name)


class _PausingCursor:
    def __init__(self, owner: PausingConn, cur) -> None:
        self._owner, self._cur = owner, cur

    def __enter__(self):
        self._cur.__enter__()
        return self

    def __exit__(self, *exc):
        return self._cur.__exit__(*exc)

    def execute(self, statement, params=None):
        if self._owner._pause is not None and self._owner._marker in statement:
            pause, self._owner._pause = self._owner._pause, None
            pause()
        return self._cur.execute(statement, params)

    def __getattr__(self, name):
        return getattr(self._cur, name)


class AsyncPausingConn:
    """The same for the web tier's AsyncConnection; ``pause`` is awaited."""

    def __init__(self, conn, marker: str, pause) -> None:
        self._conn, self._marker, self._pause = conn, marker, pause

    async def __aenter__(self):
        await self._conn.__aenter__()
        return self

    async def __aexit__(self, *exc):
        return await self._conn.__aexit__(*exc)

    async def execute(self, statement, params=None):
        if self._pause is not None and self._marker in statement:
            pause, self._pause = self._pause, None
            await pause()
        return await self._conn.execute(statement, params)

    def __getattr__(self, name):
        return getattr(self._conn, name)


def pausing_store(dsn: str, marker: str, pause) -> PgStore:
    store = PgStore(dsn)
    real = store._connect

    async def connect():
        return AsyncPausingConn(await real(), marker, pause)

    store._connect = connect  # type: ignore[method-assign]
    return store


def release(dsn: str, sid: str, *, marker: str | None = None, pause=None, autocommit: bool = True, **kw):
    """``worker.release_next_held`` as a turn's end runs it, on a connection of its own."""
    with psycopg.connect(dsn, autocommit=autocommit) as raw:
        conn = PausingConn(raw, marker, pause) if marker else raw
        return worker.release_next_held(conn, sid, **kw)


# ── D8: the interleavings ──────────────────────────────────────────────────────────


async def test_a_message_admitted_while_the_worker_releases_waits_its_turn(pg_dsn, sent):
    """The worker has found no turn running and is about to claim B; the patron posts C.
    Unserialized, C saw no turn running, the web tier rescued B, and the worker then
    claimed C: two turns on one session. Serialized, C waits for the worker's claim and
    is held behind B."""
    row = session(pg_dsn, held=("B",))
    checked, go = threading.Event(), threading.Event()

    def pause():
        checked.set()
        assert go.wait(WAIT_S), "never let go"

    worker_side = asyncio.ensure_future(asyncio.to_thread(release, pg_dsn, row.session_id, marker=CLAIM, pause=pause))
    try:
        assert await asyncio.to_thread(checked.wait, WAIT_S), "the worker never reached its claim"
        web_side = asyncio.ensure_future(PgStore(pg_dsn).admit_message(row, "C"))
        await settle(pg_dsn, web_side)
    finally:
        go.set()
    released, admitted = await worker_side, await web_side
    started = [b["text"] for b in sent] + web_sends(admitted)
    assert started == ["B"] and released == "m-1", f"one turn starts on the session, not {started}"
    assert running(pg_dsn, row.session_id) == ["B"] and held(pg_dsn, row.session_id) == ["C"]


async def test_the_worker_releasing_while_a_message_is_admitted_waits_its_turn(pg_dsn, sent):
    """The mirror: the web tier has written C as held, found no turn running, and is about
    to rescue B; the worker's turn-end release runs. Unserialized, both claimed -- the web
    tier B, the worker C."""
    row = session(pg_dsn, held=("B",))
    checked, go = asyncio.Event(), asyncio.Event()

    async def pause():
        checked.set()
        await asyncio.wait_for(go.wait(), WAIT_S)

    web_side = asyncio.ensure_future(pausing_store(pg_dsn, CLAIM, pause).admit_message(row, "C"))
    try:
        await asyncio.wait_for(checked.wait(), WAIT_S)
        worker_side = asyncio.ensure_future(asyncio.to_thread(release, pg_dsn, row.session_id))
        await settle(pg_dsn, worker_side)
    finally:
        go.set()
    admitted, released = await web_side, await worker_side
    started = [b["text"] for b in sent] + web_sends(admitted)
    assert started == ["B"] and released is None, f"one turn starts on the session, not {started}"
    assert running(pg_dsn, row.session_id) == ["B"] and held(pg_dsn, row.session_id) == ["C"]


async def test_two_messages_on_an_idle_session_start_one_turn(pg_dsn, sent):
    """Two tabs, or a double-click: each saw no turn running and both went out."""
    row = session(pg_dsn)
    checked, go = asyncio.Event(), asyncio.Event()

    async def pause():
        checked.set()
        await asyncio.wait_for(go.wait(), WAIT_S)

    first = asyncio.ensure_future(pausing_store(pg_dsn, "INSERT INTO turns", pause).admit_message(row, "one"))
    try:
        await asyncio.wait_for(checked.wait(), WAIT_S)
        second = asyncio.ensure_future(PgStore(pg_dsn).admit_message(row, "two"))
        await settle(pg_dsn, second)
    finally:
        go.set()
    started = web_sends(await first) + web_sends(await second)
    assert started == ["one"], f"one turn starts on the session, not {started}"
    assert running(pg_dsn, row.session_id) == ["one"] and held(pg_dsn, row.session_id) == ["two"]


async def test_the_lock_is_the_sessions_own(pg_dsn, sent):
    """The other direction: a release on another session does not wait on this one."""
    row, other = session(pg_dsn, held=("B",)), session(pg_dsn, held=("X",))
    checked, go = asyncio.Event(), asyncio.Event()

    async def pause():
        checked.set()
        await asyncio.wait_for(go.wait(), WAIT_S)

    web_side = asyncio.ensure_future(pausing_store(pg_dsn, CLAIM, pause).admit_message(row, "C"))
    try:
        await asyncio.wait_for(checked.wait(), WAIT_S)
        assert await asyncio.wait_for(asyncio.to_thread(release, pg_dsn, other.session_id), WAIT_S) == "m-1"
        assert not await queue_lock_waiter(pg_dsn)
    finally:
        go.set()
    await web_side
    assert [b["text"] for b in sent] == ["X"] and running(pg_dsn, other.session_id) == ["X"]


@pytest.mark.parametrize("autocommit", [True, False])
async def test_the_claim_is_committed_and_the_lock_dropped_before_the_send(pg_dsn, monkeypatch, autocommit):
    """The send runs outside the transaction: the claim is visible before the message it
    names can reach a worker, and no SQS round trip holds the session's lock. On a
    non-autocommit connection with a transaction already open (the claim path's
    ``pg_connect``), the block would otherwise be a savepoint that commits nothing."""
    row = session(pg_dsn, held=("B",))
    seen: list[tuple] = []

    def send(endpoint, action, params, *, timeout):
        seen.append((running(pg_dsn, row.session_id), sql(
            pg_dsn, "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND classid::int8 = %s",
            (grants.QUEUE_LOCK_NS,))[0][0]))
        return "<R><MessageId>m-1</MessageId></R>"

    monkeypatch.setattr(worker, "QUEUE_URL", "http://q/000000000000/turns")
    monkeypatch.setattr(worker, "log", lambda **f: None)
    monkeypatch.setattr(enqueue, "credentials_ready", lambda timeout=None: True)
    monkeypatch.setattr(enqueue, "sqs_call", send)

    with psycopg.connect(pg_dsn, autocommit=autocommit) as conn:
        conn.execute("SELECT 1")  # the caller's own statement, as serve_real_turn's claim leaves one
        assert worker.release_next_held(conn, row.session_id) == "m-1"
        assert seen == [(["B"], 0)], "at the send: B claimed and committed, the queue lock free"


# ── D7 ─────────────────────────────────────────────────────────────────────────────


async def test_a_message_posted_while_an_older_one_waits_is_held_and_the_older_one_runs(pg_dsn):
    """B is held with no turn running (its release never came). C used to go straight
    out and overtake it; now C is held and B is rescued."""
    row = session(pg_dsn, held=("B",))
    new, was_held, rescued = await PgStore(pg_dsn).admit_message(row, "C")
    assert was_held and rescued is not None and rescued["text"] == "B"
    assert running(pg_dsn, row.session_id) == ["B"] and held(pg_dsn, row.session_id) == ["C"]


async def test_a_message_posted_behind_a_running_turn_and_a_held_one_waits(pg_dsn):
    row = session(pg_dsn, running=True, held=("B",))
    _, was_held, rescued = await PgStore(pg_dsn).admit_message(row, "C")
    assert was_held and rescued is None
    assert running(pg_dsn, row.session_id) == ["running"] and held(pg_dsn, row.session_id) == ["B", "C"]


async def test_a_message_on_an_idle_session_goes_out_and_clears_stop(pg_dsn):
    row = session(pg_dsn)
    sql(pg_dsn, "UPDATE sessions SET stop_requested_at = now() WHERE session_id = %s", (row.session_id,))
    new, was_held, rescued = await PgStore(pg_dsn).admit_message(row, "go")
    assert not was_held and rescued is None and running(pg_dsn, row.session_id) == ["go"]
    assert sql(pg_dsn, "SELECT stop_requested_at FROM sessions WHERE session_id = %s", (row.session_id,)) == [(None,)]


# ── D10 ────────────────────────────────────────────────────────────────────────────


def test_a_claimed_held_row_is_running_and_holds_the_next_message(pg_dsn):
    """A put-back whose send had in fact landed: the message reaches a worker while its row
    still says held. The claim must make it a running turn, or TURN_ACTIVE_SQL misses it
    and the next message goes out beside it."""
    row = session(pg_dsn, held=("B",))
    [(turn_id, body)] = sql(pg_dsn, "SELECT turn_id, message FROM turns WHERE session_id = %s AND outcome = 'queued'",
                            (row.session_id,))
    with psycopg.connect(pg_dsn) as conn:
        worker.claim(conn, {"turn_id": turn_id, "session_id": row.session_id, "project_id": row.project_id,
                            "message": body}, 1)
    assert running(pg_dsn, row.session_id) == ["B"] and held(pg_dsn, row.session_id) == []
    _, was_held, rescued = asyncio.run(PgStore(pg_dsn).admit_message(row, "C"))
    assert was_held and rescued is None


def failing_release(pg_dsn: str, row: SessionRow, monkeypatch, *, delivered: bool) -> list[str]:
    """``release_next_held`` whose send times out -- after it landed and the message was
    claimed by a worker (``delivered``), or without either. Returns the events logged."""
    logged: list[str] = []

    def send(endpoint, action, params, *, timeout):
        if delivered:
            body = json.loads(params["MessageBody"])
            with psycopg.connect(pg_dsn) as other:
                worker.claim(other, {"turn_id": body["turn_id"], "session_id": row.session_id,
                                     "project_id": row.project_id, "message": body}, 1)
        raise TimeoutError("The read operation timed out")

    monkeypatch.setattr(worker, "QUEUE_URL", "http://q/000000000000/turns")
    monkeypatch.setattr(worker, "log", lambda **f: logged.append(f["ev"]))
    monkeypatch.setattr(enqueue, "credentials_ready", lambda timeout=None: True)
    monkeypatch.setattr(enqueue, "sqs_call", send)
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        assert worker.release_next_held(conn, row.session_id) is None
    return logged


def test_a_put_back_after_the_message_was_claimed_leaves_it_running(pg_dsn, monkeypatch):
    """The order the claim's CASE cannot see: delivery takes under a second and the send's
    timeout is 3-30 s, so the claim usually comes FIRST, and the row is already unmarked.
    A put-back then marked the running turn held: hidden from TURN_ACTIVE_SQL, halted as
    handed over, and rescued onto the queue a second time beside itself."""
    row = session(pg_dsn, held=("B",))
    assert failing_release(pg_dsn, row, monkeypatch, delivered=True) == \
        ["queued_release_failed", "queued_release_raced"]
    assert running(pg_dsn, row.session_id) == ["B"] and held(pg_dsn, row.session_id) == []
    _, was_held, rescued = asyncio.run(PgStore(pg_dsn).admit_message(row, "C"))
    assert was_held and rescued is None, "C waits behind the running B; B is not rescued again"


def test_a_send_that_failed_outright_puts_the_message_back(pg_dsn, monkeypatch):
    """The other direction: nobody claimed it, so it is held again for the next release."""
    row = session(pg_dsn, held=("B",))
    assert failing_release(pg_dsn, row, monkeypatch, delivered=False) == ["queued_release_failed"]
    assert running(pg_dsn, row.session_id) == [] and held(pg_dsn, row.session_id) == ["B"]


def test_a_redelivered_claim_keeps_a_closed_turns_outcome(pg_dsn):
    row = session(pg_dsn)
    [(turn_id, body)] = sql(pg_dsn, "SELECT turn_id, message FROM turns WHERE session_id = %s", (row.session_id,))
    with psycopg.connect(pg_dsn) as conn:
        worker.claim(conn, {"turn_id": turn_id, "session_id": row.session_id, "project_id": row.project_id,
                            "message": body}, 2)
    assert sql(pg_dsn, "SELECT outcome, completed_at IS NOT NULL FROM turns WHERE turn_id = %s",
               (turn_id,)) == [("ok", True)]


# ── U4: the claim takes the web tier's row, never the queue body's ids ──────────────


def claim_as(dsn: str, turn_id: str, session_id: str, project_id: str, text: str = "forged") -> dict | None:
    with psycopg.connect(dsn) as conn:
        return worker.claim(conn, {"turn_id": turn_id, "session_id": session_id, "project_id": project_id,
                                   "message": {"text": text}}, 1)


def stamps(dsn: str, turn_id: str) -> list[tuple]:
    return sql(dsn, "SELECT claimed_at IS NOT NULL, receive_count FROM turns WHERE turn_id = %s", (turn_id,))


def test_a_claim_naming_its_row_runs_the_row_s_message(pg_dsn):
    row = session(pg_dsn)
    turn_id = turn(pg_dsn, row.session_id, row.project_id, "patron")
    assert claim_as(pg_dsn, turn_id, row.session_id, row.project_id)["text"] == "patron"
    assert stamps(pg_dsn, turn_id) == [(True, 1)]


def test_a_claim_naming_another_patron_s_project_is_refused_and_writes_nothing(pg_dsn):
    """The finding (U4): a body carrying a real turn's ids and someone else's project_id
    picked whose grant the turn ran on."""
    mine, theirs = session(pg_dsn), session(pg_dsn)
    turn_id = turn(pg_dsn, mine.session_id, mine.project_id, "patron")
    assert claim_as(pg_dsn, turn_id, mine.session_id, theirs.project_id) is None
    assert claim_as(pg_dsn, turn_id, theirs.session_id, theirs.project_id) is None
    assert stamps(pg_dsn, turn_id) == [(False, 0)]


def test_a_claim_naming_no_row_creates_none(pg_dsn):
    row = session(pg_dsn)
    invented = "turn_" + uuid.uuid4().hex[:10]
    new_session = "sess_" + uuid.uuid4().hex[:10]
    assert claim_as(pg_dsn, invented, row.session_id, row.project_id) is None
    assert claim_as(pg_dsn, invented, new_session, row.project_id) is None
    assert sql(pg_dsn, "SELECT count(*) FROM turns WHERE turn_id = %s", (invented,)) == [(0,)]
    assert sql(pg_dsn, "SELECT count(*) FROM sessions WHERE session_id = %s", (new_session,)) == [(0,)]


def test_a_turn_row_whose_project_is_not_its_session_s_is_refused(pg_dsn):
    """The session's project is the one the web tier checked ownership of; a turns row
    disagreeing with it is not one the web tier wrote."""
    mine, theirs = session(pg_dsn), session(pg_dsn)
    turn_id = turn(pg_dsn, mine.session_id, theirs.project_id, "patron")
    assert claim_as(pg_dsn, turn_id, mine.session_id, theirs.project_id) is None


# ── the queue lock's wait is bounded ───────────────────────────────────────────────


def holding_queue_lock(dsn: str, session_id: str) -> psycopg.Connection:
    """A connection in an open transaction holding the session's queue lock, as a tier
    whose host vanished mid-admit leaves it until keepalive ends its backend."""
    conn = psycopg.connect(dsn)
    conn.execute(grants.QUEUE_LOCK_SQL, (grants.QUEUE_LOCK_NS, session_id))
    return conn


async def test_a_release_behind_a_stuck_queue_lock_gives_up(pg_dsn, sent):
    row = session(pg_dsn, held=("B",))
    holder = holding_queue_lock(pg_dsn, row.session_id)
    try:
        started = time.monotonic()
        with pytest.raises(psycopg.errors.LockNotAvailable):
            await asyncio.wait_for(asyncio.to_thread(release, pg_dsn, row.session_id, lock_timeout=0.2), WAIT_S)
        assert time.monotonic() - started < 2
    finally:
        holder.close()
    assert sent == [] and held(pg_dsn, row.session_id) == ["B"], "nothing claimed, the message stays held"


async def test_an_admit_behind_a_stuck_queue_lock_gives_up(pg_dsn, monkeypatch):
    monkeypatch.setattr(web_app.grants, "QUEUE_LOCK_TIMEOUT_S", 0.2)
    row = session(pg_dsn, held=("B",))
    holder = holding_queue_lock(pg_dsn, row.session_id)
    try:
        started = time.monotonic()
        with pytest.raises(psycopg.errors.LockNotAvailable):
            await asyncio.wait_for(PgStore(pg_dsn).admit_message(row, "C"), WAIT_S)
        assert time.monotonic() - started < 2
    finally:
        holder.close()
    assert held(pg_dsn, row.session_id) == ["B"], "the admit rolled back whole"


async def test_the_bound_is_the_transactions_own(pg_dsn, sent):
    """The other direction: set_config(..., true) ends with the transaction, so the
    connection's later statements are not cut short by it."""
    row = session(pg_dsn, held=("B",))
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        before = conn.execute("SHOW lock_timeout").fetchone()[0]
        assert worker.release_next_held(conn, row.session_id, lock_timeout=0.2) == "m-1"
        assert conn.execute("SHOW lock_timeout").fetchone()[0] == before


async def test_a_rescued_message_whose_send_failed_is_held_again_unless_it_was_received(pg_dsn):
    """The web tier's failed rescue send (U23): B goes back to held while no worker has
    received it; once one has (a send that landed after its timeout), it stays running."""
    row = session(pg_dsn, held=("B",))
    store = PgStore(pg_dsn)
    _, _, rescued = await store.admit_message(row, "C")
    assert await store.put_back_held(rescued["turn_id"]) is True
    assert held(pg_dsn, row.session_id) == ["B", "C"] and running(pg_dsn, row.session_id) == []
    _, _, again = await store.admit_message(row, "D")
    assert again["turn_id"] == rescued["turn_id"], "the retry rescues the older message first"
    sql(pg_dsn, "UPDATE turns SET receive_count = 1 WHERE turn_id = %s", (again["turn_id"],))
    assert await store.put_back_held(again["turn_id"]) is False
    assert running(pg_dsn, row.session_id) == ["B"]

"""#3985: sign-in admission by user cap (``GENEALOGY_MAX_USERS``) against REAL Postgres.

``PgStore.upsert_user(..., max_users=N)`` admits an existing user whatever the count and
inserts a new one only while ``users`` holds fewer than N rows, blocked users included. The
count and the insert run under the tier-wide admission lock (``grants.ADMISSION_LOCK_NS``),
so two sign-ins at cap-1 cannot both pass the count. No fake proves anything about an
advisory lock, so the race runs here: a proxy over a real connection pauses one sign-in
after its count and before its insert, the other runs into the window, and the pause ends
when the other has finished or is seen waiting on the admission lock in ``pg_locks`` --
never inferred from a sleep.

Without the DSN the module skips -- except under ``CI``, where it fails, so the job cannot
pass by skipping. ``make proto-grants-test`` runs it against the compose Postgres.
"""

from __future__ import annotations

import asyncio
import sys

import psycopg
import pytest

from proto import grants
from tests._proto_pg import PROTO, AsyncPausingConn, database, sql

sys.path.insert(0, str(PROTO))

import web.app as web_app  # noqa: E402
from web.app import AdmissionBusy, AdmissionRefused, EmailTaken, IdentityMismatch, PgStore  # noqa: E402

WAIT_S = 10.0
FS_ID = "MMMM-AAA"


@pytest.fixture
def pg_dsn():
    with database(prefix="w1_") as dsn:
        yield dsn


def users(dsn: str) -> list[str]:
    return [r[0] for r in sql(dsn, "SELECT email FROM users ORDER BY email")]


def add_user(dsn: str, email: str, *, blocked: bool = False) -> None:
    sql(dsn, "INSERT INTO users (id, email, blocked_at) VALUES (%s, %s, CASE WHEN %s THEN now() END)",
        ("usr_" + email.split("@")[0], email, blocked))


def pausing_store(dsn: str, marker: str, pause) -> PgStore:
    store = PgStore(dsn)
    real = store._connect

    async def connect():
        return AsyncPausingConn(await real(), marker, pause)

    store._connect = connect  # type: ignore[method-assign]
    return store


async def admission_waiter(dsn: str) -> bool:
    rows = await asyncio.to_thread(
        sql, dsn,
        "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND classid::int8 = %s "
        "AND database = (SELECT oid FROM pg_database WHERE datname = current_database())",
        (grants.ADMISSION_LOCK_NS,),
    )
    return bool(rows[0][0])


async def settle(dsn: str, other: asyncio.Future) -> None:
    """Until ``other`` has finished or waits on the admission lock; fail at the deadline."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + WAIT_S
    while loop.time() < deadline:
        if other.done() or await admission_waiter(dsn):
            return
        await asyncio.sleep(0.05)
    raise AssertionError("the other sign-in neither finished nor waited on the admission lock")


async def test_a_new_user_is_admitted_below_the_cap_and_refused_at_it(pg_dsn):
    store = PgStore(pg_dsn)
    await store.upsert_user("a@example.org", None, max_users=2)
    await store.upsert_user("b@example.org", None, max_users=2)
    with pytest.raises(AdmissionRefused):
        await store.upsert_user("c@example.org", None, max_users=2)
    assert users(pg_dsn) == ["a@example.org", "b@example.org"]


async def test_an_existing_user_is_admitted_above_the_cap(pg_dsn):
    """A lowered cap keeps everyone already in; it only stops new rows."""
    for email in ("a@example.org", "b@example.org", "c@example.org"):
        add_user(pg_dsn, email)
    user = await PgStore(pg_dsn).upsert_user("B@example.org", FS_ID, max_users=1)
    assert (user.email, user.familysearch_id) == ("b@example.org", FS_ID)
    assert len(users(pg_dsn)) == 3


async def test_blocked_users_count_toward_the_cap(pg_dsn):
    add_user(pg_dsn, "a@example.org", blocked=True)
    with pytest.raises(AdmissionRefused):
        await PgStore(pg_dsn).upsert_user("b@example.org", None, max_users=1)


async def test_no_cap_inserts_as_before(pg_dsn):
    store = PgStore(pg_dsn)
    for email in ("a@example.org", "b@example.org", "c@example.org"):
        await store.upsert_user(email, None)
    assert len(users(pg_dsn)) == 3


@pytest.mark.parametrize("max_users", [None, 5])
async def test_a_blocked_user_comes_back_blocked_and_unpinned(pg_dsn, max_users):
    """The caller refuses a blocked user; the upsert must not have pinned an id first, so
    the refusal writes nothing."""
    add_user(pg_dsn, "a@example.org", blocked=True)
    user = await PgStore(pg_dsn).upsert_user("a@example.org", FS_ID, max_users=max_users)
    assert user.blocked_at is not None and user.familysearch_id is None
    assert sql(pg_dsn, "SELECT familysearch_id FROM users") == [(None,)]


async def test_the_pin_holds_under_the_cap(pg_dsn):
    store = PgStore(pg_dsn)
    await store.upsert_user("a@example.org", FS_ID, max_users=5)
    with pytest.raises(IdentityMismatch):
        await store.upsert_user("a@example.org", "ZZZZ-999", max_users=5)


async def test_two_sign_ins_at_cap_minus_one_admit_exactly_one(pg_dsn):
    """A has counted one user under a cap of two and is about to insert; B signs in. Without
    the lock B also counts one and inserts, then A inserts: three users under a cap of two.
    With it, B waits for A's commit, counts two and is refused."""
    add_user(pg_dsn, "first@example.org")
    counted, go = asyncio.Event(), asyncio.Event()

    async def pause():
        counted.set()
        await asyncio.wait_for(go.wait(), WAIT_S)

    a_side = asyncio.ensure_future(
        pausing_store(pg_dsn, "INSERT INTO users", pause).upsert_user("a@example.org", None, max_users=2))
    try:
        await asyncio.wait_for(counted.wait(), WAIT_S)
        b_side = asyncio.ensure_future(PgStore(pg_dsn).upsert_user("b@example.org", None, max_users=2))
        await settle(pg_dsn, b_side)
    finally:
        go.set()
    a, b = await asyncio.gather(a_side, b_side, return_exceptions=True)
    assert len(users(pg_dsn)) == 2, f"the cap of two held: {users(pg_dsn)}"
    assert not isinstance(a, BaseException), a
    assert isinstance(b, AdmissionRefused), b


async def test_two_sign_ins_for_one_new_email_at_cap_minus_one_both_land(pg_dsn):
    """The same new patron signs in twice at once (two tabs). A inserts the last seat's row;
    B waited on the lock and must find that row, not count it as somebody else's seat."""
    add_user(pg_dsn, "first@example.org")
    counted, go = asyncio.Event(), asyncio.Event()

    async def pause():
        counted.set()
        await asyncio.wait_for(go.wait(), WAIT_S)

    a_side = asyncio.ensure_future(
        pausing_store(pg_dsn, "INSERT INTO users", pause).upsert_user("a@example.org", None, max_users=2))
    try:
        await asyncio.wait_for(counted.wait(), WAIT_S)
        b_side = asyncio.ensure_future(PgStore(pg_dsn).upsert_user("a@example.org", None, max_users=2))
        await settle(pg_dsn, b_side)
    finally:
        go.set()
    a, b = await asyncio.gather(a_side, b_side, return_exceptions=True)
    assert not isinstance(b, BaseException), f"the second sign-in of the same patron was refused: {b!r}"
    assert not isinstance(a, BaseException) and a.id == b.id
    assert users(pg_dsn) == ["a@example.org", "first@example.org"]


async def test_a_returning_user_does_not_wait_on_the_admission_lock(pg_dsn, monkeypatch):
    """Only a new email takes the lock: a burst of returning patrons never queues on it."""
    monkeypatch.setattr(web_app.grants, "QUEUE_LOCK_TIMEOUT_S", 0.2)
    add_user(pg_dsn, "a@example.org")
    with psycopg.connect(pg_dsn) as holder:
        holder.execute(grants.ADMISSION_LOCK_SQL, (grants.ADMISSION_LOCK_NS,))
        user = await PgStore(pg_dsn).upsert_user("a@example.org", FS_ID, max_users=1)
    assert user.familysearch_id == FS_ID


async def test_a_held_user_row_answers_busy_not_a_hang(pg_dsn, monkeypatch):
    """A returning patron whose row another transaction holds (an operator's delete or block)
    gets the bounded wait too, not an unbounded one."""
    monkeypatch.setattr(web_app.grants, "QUEUE_LOCK_TIMEOUT_S", 0.2)
    add_user(pg_dsn, "a@example.org")
    with psycopg.connect(pg_dsn) as holder:
        holder.execute("SELECT 1 FROM users WHERE email = %s FOR UPDATE", ("a@example.org",))
        with pytest.raises(AdmissionBusy):
            await asyncio.wait_for(PgStore(pg_dsn).upsert_user("a@example.org", None, max_users=5), WAIT_S)


async def test_a_held_admission_lock_answers_busy_not_a_hang(pg_dsn, monkeypatch):
    monkeypatch.setattr(web_app.grants, "QUEUE_LOCK_TIMEOUT_S", 0.2)
    with psycopg.connect(pg_dsn) as holder:
        holder.execute(grants.ADMISSION_LOCK_SQL, (grants.ADMISSION_LOCK_NS,))
        with pytest.raises(AdmissionBusy):
            await PgStore(pg_dsn).upsert_user("a@example.org", None, max_users=5)
    assert users(pg_dsn) == []


# ── #3992: users keyed by FamilySearch id, and the single-use sign-in state ─────


def rows(dsn: str) -> list[tuple]:
    return sql(dsn, "SELECT id, email, familysearch_id FROM users ORDER BY id")


@pytest.mark.parametrize("max_users", [None, 5])
async def test_a_known_id_with_a_new_email_is_the_same_user_with_the_email_updated(pg_dsn, max_users):
    store = PgStore(pg_dsn)
    first = await store.upsert_user("old@example.org", FS_ID, max_users=max_users)
    again = await store.upsert_user("New@example.org", FS_ID, max_users=max_users)
    assert again.id == first.id and again.email == "new@example.org"
    assert rows(pg_dsn) == [(first.id, "new@example.org", FS_ID)]


@pytest.mark.parametrize("max_users", [None, 5])
async def test_a_new_email_another_user_holds_is_refused_with_no_write(pg_dsn, max_users):
    store = PgStore(pg_dsn)
    await store.upsert_user("old@example.org", FS_ID)
    add_user(pg_dsn, "b@example.org")
    before = rows(pg_dsn)
    with pytest.raises(EmailTaken):
        await store.upsert_user("b@example.org", FS_ID, max_users=max_users)
    assert rows(pg_dsn) == before


async def test_a_new_user_is_inserted_with_its_familysearch_id(pg_dsn):
    user = await PgStore(pg_dsn).upsert_user("c@example.org", FS_ID, max_users=5)
    assert rows(pg_dsn) == [(user.id, "c@example.org", FS_ID)]


async def test_two_first_sign_ins_of_one_id_write_one_row(pg_dsn):
    """One FamilySearch account signs in twice at once and FamilySearch reports its email
    differently each time: A has read nothing and is about to insert when B inserts. A's
    insert must not 500 on the id's unique index; it finds B's row and updates its email."""
    reached, go = asyncio.Event(), asyncio.Event()

    async def pause():
        reached.set()
        await asyncio.wait_for(go.wait(), WAIT_S)

    a_side = asyncio.ensure_future(
        pausing_store(pg_dsn, "INSERT INTO users", pause).upsert_user("a@example.org", FS_ID))
    try:
        await asyncio.wait_for(reached.wait(), WAIT_S)
        b = await PgStore(pg_dsn).upsert_user("b@example.org", FS_ID)
    finally:
        go.set()
    a = await a_side
    assert a.id == b.id
    assert rows(pg_dsn) == [(a.id, "a@example.org", FS_ID)]


async def test_a_pin_that_loses_a_race_for_the_id_answers_busy_not_a_500(pg_dsn):
    """A holds a@'s row and is about to pin FS_ID; B, a new email with the same id, inserts
    it first. A's pin hits the unique index: AdmissionBusy, nothing written. A retry finds
    FS_ID is b@'s and that a@ belongs to another row: IdentityMismatch."""
    add_user(pg_dsn, "a@example.org")
    reached, go = asyncio.Event(), asyncio.Event()

    async def pause():
        reached.set()
        await asyncio.wait_for(go.wait(), WAIT_S)

    a_side = asyncio.ensure_future(
        pausing_store(pg_dsn, "UPDATE users SET familysearch_id", pause).upsert_user("a@example.org", FS_ID))
    try:
        await asyncio.wait_for(reached.wait(), WAIT_S)
        await PgStore(pg_dsn).upsert_user("b@example.org", FS_ID)
    finally:
        go.set()
    with pytest.raises(AdmissionBusy):
        await a_side
    assert sql(pg_dsn, "SELECT familysearch_id FROM users WHERE email = 'a@example.org'") == [(None,)]
    with pytest.raises(IdentityMismatch):
        await PgStore(pg_dsn).upsert_user("a@example.org", FS_ID)


async def test_dev_login_stays_keyed_by_email(pg_dsn):
    store = PgStore(pg_dsn)
    first = await store.upsert_user("dev@localhost", None)
    assert (await store.upsert_user("DEV@localhost", None)).id == first.id
    assert rows(pg_dsn) == [(first.id, "dev@localhost", None)]


async def test_a_state_is_unused_until_consumed_and_consumed_once(pg_dsn):
    store = PgStore(pg_dsn)
    digest = web_app.auth.state_sha256("st-1")
    assert not await store.signin_state_unused(digest)
    assert not await store.consume_signin_state(digest), "no record, nothing to consume"
    await store.create_signin_state(digest)
    assert await store.signin_state_unused(digest)
    assert await store.consume_signin_state(digest)
    assert not await store.signin_state_unused(digest)
    assert not await store.consume_signin_state(digest)


async def test_creating_a_state_deletes_the_expired_ones(pg_dsn):
    sql(pg_dsn, "INSERT INTO signin_states (state_sha256, created_at) VALUES "
                "('old', now() - make_interval(secs => %s)), ('fresh', now())",
        (web_app.auth.FS_OAUTH_MAX_AGE + 1,))
    await PgStore(pg_dsn).create_signin_state("new")
    assert sorted(r[0] for r in sql(pg_dsn, "SELECT state_sha256 FROM signin_states")) == ["fresh", "new"]


async def lock_waiters(dsn: str) -> int:
    got = await asyncio.to_thread(
        sql, dsn,
        "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()",
    )
    return int(got[0][0])


async def test_two_concurrent_consumes_of_one_state_admit_exactly_one(pg_dsn):
    """A holder locks the record, both callbacks' UPDATEs queue behind it, then it lets go:
    the first re-reads used_at and wins, the second finds it set and gets no row. A SELECT
    then UPDATE would let both through."""
    store = PgStore(pg_dsn)
    digest = web_app.auth.state_sha256("st-race")
    await store.create_signin_state(digest)
    loop = asyncio.get_running_loop()
    with psycopg.connect(pg_dsn) as holder:
        holder.execute("SELECT 1 FROM signin_states WHERE state_sha256 = %s FOR UPDATE", (digest,))
        sides = [asyncio.ensure_future(store.consume_signin_state(digest)) for _ in range(2)]
        deadline = loop.time() + WAIT_S
        while await lock_waiters(pg_dsn) < 2:
            assert loop.time() < deadline, "the two consumes never queued on the row lock"
            await asyncio.sleep(0.05)
        holder.commit()
    assert sorted(await asyncio.gather(*sides)) == [False, True]

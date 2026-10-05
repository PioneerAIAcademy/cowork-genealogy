"""U3: the grant locks against REAL Postgres (docs/plan/familysearch-handoff.md, U3; list 3
step 19).

The lock semantics are the whole point -- a shared attempt lock that a refresher can only
win exclusively by a try, a write lock the sign-in callback waits on -- and no fake proves
anything about ``pg_try_advisory_lock`` (issue #2887's lesson, with SQLite). So these run
the real ``PgStore.refresh_grant`` / ``store_grant`` / ``due_grant_users`` and the real
``worker.acquire_grant`` on a database of their own (``_proto_pg.database``), created per
module from ``PROTO_TEST_PG_DSN``, migrated, and dropped ``WITH (FORCE)`` at teardown. The FamilySearch call is a
fake that records its calls and can be held mid-flight on an ``asyncio.Event``; a worker
attempt runs on a thread of its own (its psycopg calls are synchronous). A wait is seen as
an ungranted advisory row in ``pg_locks``, never inferred from a sleep.

Without the DSN the module skips -- except under ``CI``, where it fails, so the job cannot
pass by skipping. ``make proto-grants-test`` runs it against the compose Postgres.
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from datetime import datetime, timedelta, timezone

import psycopg
import pytest

from proto import grants, migrate
from proto.worker import worker
from tests._proto_pg import PROTO, database, sql, ungranted_advisory

sys.path.insert(0, str(PROTO))

from web import auth  # noqa: E402
from web.app import PgStore  # noqa: E402

KEY = "u3-test-grant-key"


@pytest.fixture(scope="module")
def pg_dsn():
    with database(prefix="u3_") as dsn:
        yield dsn


@pytest.fixture(autouse=True)
def _env(monkeypatch, pg_dsn):
    monkeypatch.setenv("FS_TOKEN_ENC_KEY", KEY)
    monkeypatch.setattr(worker, "PG_DSN", pg_dsn)
    monkeypatch.setattr(worker, "log", lambda **f: None)


@pytest.fixture
def helds():
    """Every HeldGrant a test takes, closed at teardown so a failing test leaks no lock."""
    taken: list[worker.HeldGrant] = []
    yield taken
    for held in taken:
        held.close()


def patron(dsn: str, *, age_s: float = 4000, refresh: str | None = "refresh-0", access: str = "access-0",
           open_turn: bool = True, pending: bool = False, refused: str | None = None,
           projects: int = 1) -> tuple[str, list[str]]:
    """A patron with a grant whose session is ``age_s`` old, owning ``projects`` projects
    (the first with an open turn when ``open_turn``). ``(user_id, project_ids)``."""
    user_id = "usr_" + uuid.uuid4().hex[:10]
    sql(dsn, "INSERT INTO users (id, email) VALUES (%s, %s)", (user_id, f"{user_id}@example.org"))
    sql(dsn, "INSERT INTO familysearch_tokens (user_id, access_token_enc, refresh_token_enc, expires_at, "
             "granted_at, session_started_at, refresh_started_at, refresh_refused_at, refresh_refused_reason) "
             "VALUES (%s, %s, %s, now(), now() - make_interval(secs => %s), now() - make_interval(secs => %s), "
             "CASE WHEN %s THEN now() END, CASE WHEN %s::text IS NOT NULL THEN now() END, %s)",
        (user_id, grants.encrypt(access, KEY), grants.encrypt(refresh, KEY) if refresh else None,
         age_s, age_s, pending, refused, refused))
    project_ids = []
    for i in range(projects):
        project_id = f"proj_{user_id}_{i}"
        sql(dsn, "INSERT INTO projects (project_id, owner_id) VALUES (%s, %s)", (project_id, user_id))
        project_ids.append(project_id)
    if open_turn:
        sql(dsn, "INSERT INTO turns (turn_id, session_id, project_id, message) VALUES (%s, %s, %s, '{}'::jsonb)",
            ("turn_" + uuid.uuid4().hex[:10], "sess_" + uuid.uuid4().hex[:10], project_ids[0]))
    return user_id, project_ids


def grant_row(dsn: str, user_id: str) -> dict:
    [row] = sql(dsn, "SELECT access_token_enc, session_started_at, refresh_started_at, refresh_refused_at, "
                     "refresh_refused_reason FROM familysearch_tokens WHERE user_id = %s", (user_id,))
    return {"access": grants.decrypt(row[0], KEY), "session_started_at": row[1], "marker": row[2],
            "refused_at": row[3], "reason": row[4]}


class FakeRefresh:
    """The FamilySearch refresh: records each call, optionally held on ``gate``."""

    def __init__(self, result: grants.RefreshResult | None = None, gate: asyncio.Event | None = None) -> None:
        self.result, self.gate = result, gate
        self.calls: list[str] = []
        self.started = asyncio.Event()

    async def __call__(self, refresh_token: str) -> grants.RefreshResult:
        self.calls.append(refresh_token)
        self.started.set()
        if self.gate is not None:
            await self.gate.wait()
        n = len(self.calls)
        return self.result or grants.RefreshResult("ok", f"access-{n}", f"refresh-{n}")


async def refresh(dsn: str, user_id: str, fake: FakeRefresh, *, refresh_age_s: float = 3600) -> str:
    return await PgStore(dsn).refresh_grant(user_id, refresh=fake, refresh_age_s=refresh_age_s)


async def attempt(project_id: str, **kw):
    """worker.acquire_grant on a thread of its own, as a worker attempt runs it."""
    kw.setdefault("max_start_age_s", grants.DEFAULT_MAX_START_AGE_S)
    kw.setdefault("wait_s", 0)
    return await asyncio.to_thread(asyncio.run, worker.acquire_grant(project_id, **kw))


# ── the schema ───────────────────────────────────────────────────────────────────


def test_a_baseline_run_backfills_session_start_from_granted_at():
    """A U2-era row (008, no session column, no ledger: what every pre-U9 start left) gets
    its session start from granted_at -- exact, since before 009 only a sign-in wrote a row.
    An unledgered database re-runs every file once, so the run applies all nine, and a
    second run changes nothing."""
    with database(apply=False, prefix="u3_") as dsn:
        files = migrate.load()
        names = [m.name for m in files]
        assert names[-1] == "009_grant_session.sql"
        with psycopg.connect(dsn, autocommit=True) as conn:
            for m in files[:-1]:
                conn.execute(m.text)
            granted = datetime(2026, 9, 29, 12, 0, tzinfo=timezone.utc)
            conn.execute("INSERT INTO users (id, email) VALUES ('usr_u2', 'u2@example.org')")
            conn.execute("INSERT INTO familysearch_tokens (user_id, access_token_enc, refresh_token_enc, expires_at, "
                         "granted_at) VALUES ('usr_u2', 'gAAAAA-a', 'gAAAAA-r', %s, %s)",
                         (granted + timedelta(hours=8), granted))
        assert migrate.migrate(dsn) == names
        assert migrate.migrate(dsn) == []
        [(started, marker, refused)] = sql(dsn, "SELECT session_started_at, refresh_started_at, refresh_refused_at "
                                                "FROM familysearch_tokens WHERE user_id = 'usr_u2'")
        assert started == granted and marker is None and refused is None


# ── the interleavings ────────────────────────────────────────────────────────────


async def test_two_live_sessions_of_one_patron_block_every_refresh_until_both_end(pg_dsn, helds):
    """I1/I4, U3's first Done-when: two live attempts of one patron (two sessions, two
    projects) both hold the shared lock, and the refresher cannot take it until BOTH end --
    then it refreshes exactly once."""
    user_id, (p1, p2) = patron(pg_dsn, projects=2)
    fake = FakeRefresh()
    first, second = await attempt(p1), await attempt(p2)
    helds += [first, second]
    assert first.token == second.token == "access-0"
    assert await refresh(pg_dsn, user_id, fake) == "skipped_live"
    first.close()
    assert await refresh(pg_dsn, user_id, fake) == "skipped_live", "one live attempt is enough to block"
    assert fake.calls == [] and grant_row(pg_dsn, user_id)["access"] == "access-0"
    second.close()
    assert await refresh(pg_dsn, user_id, fake) == "refreshed"
    assert await refresh(pg_dsn, user_id, fake) == "not_due"
    assert fake.calls == ["refresh-0"], "exactly one refresh, once no attempt was live"
    assert grant_row(pg_dsn, user_id)["access"] == "access-1"


async def test_an_attempt_starting_mid_refresh_waits_and_reads_the_new_token(pg_dsn, helds):
    """I2 (and I3 by construction): the attempt blocks on the shared lock while the refresher
    holds it, then reads the NEW token -- it locked before it read."""
    user_id, (project,) = patron(pg_dsn)
    gate = asyncio.Event()
    fake = FakeRefresh(gate=gate)
    refreshing = asyncio.create_task(refresh(pg_dsn, user_id, fake))
    await fake.started.wait()
    starting = asyncio.create_task(attempt(project))
    await ungranted_advisory(pg_dsn)
    gate.set()
    assert await refreshing == "refreshed"
    held = await starting
    helds.append(held)
    assert held.token == "access-1", "the token the refresh just wrote, never the revoked one"


async def test_two_refreshers_refresh_once(pg_dsn):
    """I5: two web instances. The second fails the write try while the first runs, and once
    it is done the re-check on the locked row says not_due. One FamilySearch call."""
    user_id, _ = patron(pg_dsn)
    gate = asyncio.Event()
    fake = FakeRefresh(gate=gate)
    first = asyncio.create_task(refresh(pg_dsn, user_id, fake))
    await fake.started.wait()
    assert await refresh(pg_dsn, user_id, fake) == "skipped_busy"
    gate.set()
    assert await first == "refreshed"
    assert await refresh(pg_dsn, user_id, fake) == "not_due"
    assert len(fake.calls) == 1


async def test_sign_in_mid_refresh_waits_and_its_grant_wins(pg_dsn):
    """I6a: the callback's grant rewrite takes the same write lock, so it waits for the
    refresher and lands after it -- the patron's fresh sign-in is the grant that stays."""
    user_id, _ = patron(pg_dsn)
    gate = asyncio.Event()
    fake = FakeRefresh(gate=gate)
    refreshing = asyncio.create_task(refresh(pg_dsn, user_id, fake))
    await fake.started.wait()
    signing_in = asyncio.create_task(PgStore(pg_dsn).store_grant(
        user_id, auth.encrypt("signin-access"), auth.encrypt("signin-refresh"),
        datetime.now(timezone.utc) + timedelta(hours=8)))
    await ungranted_advisory(pg_dsn)
    assert not signing_in.done()
    gate.set()
    assert await refreshing == "refreshed"
    await signing_in
    row = grant_row(pg_dsn, user_id)
    assert row["access"] == "signin-access" and row["marker"] is None and row["refused_at"] is None


async def test_sign_in_during_a_live_attempt_does_not_wait(pg_dsn, helds):
    """I6b: a second sign-in does not revoke the first token (U2), so the callback takes no
    attempt lock: it lands at once, the live attempt keeps its token, the next reads the new."""
    user_id, (project,) = patron(pg_dsn)
    live = await attempt(project)
    helds.append(live)
    await asyncio.wait_for(PgStore(pg_dsn).store_grant(
        user_id, auth.encrypt("signin-access"), None, datetime.now(timezone.utc)), timeout=5)
    with psycopg.connect(pg_dsn, autocommit=True) as main:
        assert live.held_on(main), "the live attempt still holds its lock"
    nxt = await attempt(project)
    helds.append(nxt)
    assert (live.token, nxt.token) == ("access-0", "signin-access")


async def test_a_crashed_attempt_releases_the_lock(pg_dsn, helds):
    """I7: a worker that dies takes its lock connection with it, so the refresh proceeds and
    the redelivery reads the current grant."""
    user_id, (project,) = patron(pg_dsn)
    held = await attempt(project)
    helds.append(held)
    assert await refresh(pg_dsn, user_id, FakeRefresh()) == "skipped_live"
    sql(pg_dsn, "SELECT pg_terminate_backend(%s)", (held.pid,))
    for _ in range(100):
        if await refresh(pg_dsn, user_id, FakeRefresh()) == "refreshed":
            break
        await asyncio.sleep(0.05)
    else:
        raise AssertionError("the crashed attempt's lock was never released")
    held.close()  # its backend is gone: no raise
    redelivered = await attempt(project)
    helds.append(redelivered)
    assert redelivered.token == "access-1"


async def test_an_ambiguous_refresh_blocks_attempts_until_resolved(pg_dsn, helds):
    """I9: a refresh that may have reached FamilySearch (a deadline, or the web process dying
    between the call and the write) may have revoked the stored token, so the marker stays
    and no attempt starts on it; the loop still sees it as due and resolves it."""
    user_id, (project,) = patron(pg_dsn)
    assert await refresh(pg_dsn, user_id, FakeRefresh(grants.RefreshResult("ambiguous", reason="deadline"))) \
        == "ambiguous"
    assert grant_row(pg_dsn, user_id)["marker"] is not None
    with pytest.raises(worker.GrantWaitTimeout, match="refresh_pending"):
        await attempt(project)
    assert user_id in [u for u, _ in await PgStore(pg_dsn).due_grant_users(10**9)], "a marked grant is due at any age"
    assert await refresh(pg_dsn, user_id, FakeRefresh(), refresh_age_s=10**9) == "refreshed"
    row = grant_row(pg_dsn, user_id)
    assert row["marker"] is None and row["access"] == "access-1"
    held = await attempt(project)
    helds.append(held)
    assert held.token == "access-1"
    held.close()
    # The web process dying between the call and transaction 2 leaves the same marker. A
    # later refresh FamilySearch never received (not_sent: a 429, a refused connection)
    # proves nothing about the EARLIER one, which may have revoked access-1: the marker
    # stays and no attempt starts until a refresh settles it.
    sql(pg_dsn, grants.MARK_REFRESH_SQL, (user_id,))
    with pytest.raises(worker.GrantWaitTimeout):
        await attempt(project)
    for reason in ("http_429", "ConnectError", "client_config"):
        assert await refresh(pg_dsn, user_id, FakeRefresh(grants.RefreshResult("not_sent", reason=reason)),
                             refresh_age_s=10**9) == "not_sent"
        assert grant_row(pg_dsn, user_id)["marker"] is not None, f"a not_sent ({reason}) cleared an inherited marker"
        with pytest.raises(worker.GrantWaitTimeout, match="refresh_pending"):
            await attempt(project)
    settled = FakeRefresh(grants.RefreshResult("ok", "access-2", "refresh-2"))
    assert await refresh(pg_dsn, user_id, settled, refresh_age_s=10**9) == "refreshed"
    again = await attempt(project)
    helds.append(again)
    assert again.token == "access-2", "the attempt bears the settled token, not the possibly revoked one"
    again.close()
    # A not_sent of a refresh that set the marker itself clears it: the stored token was
    # never put at risk.
    assert grant_row(pg_dsn, user_id)["marker"] is None
    assert await refresh(pg_dsn, user_id, FakeRefresh(grants.RefreshResult("not_sent")), refresh_age_s=0) \
        == "not_sent"
    assert grant_row(pg_dsn, user_id)["marker"] is None
    last = await attempt(project)
    helds.append(last)
    assert last.token == again.token


async def test_one_patrons_live_attempt_does_not_block_anothers_refresh(pg_dsn, helds):
    """I10: the keys are per patron."""
    a, (project_a,) = patron(pg_dsn)
    b, _ = patron(pg_dsn)
    helds.append(await attempt(project_a))
    assert await refresh(pg_dsn, b, FakeRefresh()) == "refreshed"
    assert await refresh(pg_dsn, a, FakeRefresh()) == "skipped_live"


async def test_each_attempt_bears_its_own_projects_owners_token(pg_dsn, helds):
    """I11 (R7): the bearer follows the turn's project to its owner, never the operator."""
    a, (project_a,) = patron(pg_dsn, access="access-of-a")
    b, (project_b,) = patron(pg_dsn, access="access-of-b")
    held_a, held_b = await attempt(project_a), await attempt(project_b)
    helds += [held_a, held_b]
    assert (held_a.user_id, held_a.token) == (a, "access-of-a")
    assert (held_b.user_id, held_b.token) == (b, "access-of-b")
    sql(pg_dsn, "INSERT INTO projects (project_id) VALUES ('proj_unowned_u3') ON CONFLICT DO NOTHING")
    assert await attempt("proj_unowned_u3") == worker.NoGrant("no_owner")
    assert await attempt("proj_absent_u3") == worker.NoGrant("no_owner")
    c = "usr_" + uuid.uuid4().hex[:10]
    sql(pg_dsn, "INSERT INTO users (id, email) VALUES (%s, %s)", (c, f"{c}@example.org"))
    sql(pg_dsn, "INSERT INTO projects (project_id, owner_id) VALUES (%s, %s)", (f"proj_{c}", c))
    assert await attempt(f"proj_{c}") == worker.NoGrant("no_grant")


async def test_a_lost_grant_lock_halts_the_attempt(pg_dsn, helds):
    """I12: only the lock connection dies (an idle cut, an admin terminate, a proxy) while
    the attempt runs. Asked on the attempt's MAIN connection, held_on turns False -- which is
    what halt() reads -- and close() does not raise."""
    user_id, (project,) = patron(pg_dsn)
    held = await attempt(project)
    helds.append(held)
    with psycopg.connect(pg_dsn, autocommit=True) as main:
        assert held.held_on(main)
        sql(pg_dsn, "SELECT pg_terminate_backend(%s)", (held.pid,))
        for _ in range(100):
            if not held.held_on(main):
                break
            await asyncio.sleep(0.05)
        else:
            raise AssertionError("held_on still reports the lock after its backend was terminated")
    held.close()
    assert await refresh(pg_dsn, user_id, FakeRefresh()) == "refreshed", "which is why the attempt must halt"


async def test_attempt_lock_wait_is_bounded_by_lock_timeout(pg_dsn, monkeypatch):
    """A refresher that held the lock past lock_timeout would fail the attempt (a 500 and a
    redelivery), never hang it. The real value is 60 s (test_proto_grants pins it over the
    refresh budget); 1 s here so the bound is seen."""
    user_id, (project,) = patron(pg_dsn)
    kwargs = {**worker.GRANT_CONN_KWARGS,
              "options": worker.GRANT_CONN_KWARGS["options"].replace(
                  f"lock_timeout={grants.ATTEMPT_LOCK_TIMEOUT_S}s", "lock_timeout=1s")}
    assert kwargs["options"] != worker.GRANT_CONN_KWARGS["options"]
    monkeypatch.setattr(worker, "GRANT_CONN_KWARGS", kwargs)
    with psycopg.connect(pg_dsn, autocommit=True) as refresher:
        refresher.execute("SELECT pg_advisory_lock(%s::int4, hashtext(%s))", (grants.ATTEMPT_LOCK_NS, user_id))
        loop = asyncio.get_running_loop()
        t0 = loop.time()
        with pytest.raises(psycopg.errors.LockNotAvailable):
            await attempt(project)
        assert loop.time() - t0 < 5


async def test_a_refused_refresh_closes_the_next_attempt(pg_dsn):
    user_id, (project,) = patron(pg_dsn)
    assert await refresh(pg_dsn, user_id, FakeRefresh(grants.RefreshResult("refused", reason="invalid_grant"))) \
        == "refused"
    row = grant_row(pg_dsn, user_id)
    assert row["refused_at"] is not None and row["reason"] == "invalid_grant" and row["marker"] is None
    assert await attempt(project) == worker.NoGrant("refused", "invalid_grant")
    assert user_id not in [u for u, _ in await PgStore(pg_dsn).due_grant_users(0)], "never retried"
    # A refresh token written under another key is undecryptable: refused, never sent.
    other, (other_project,) = patron(pg_dsn)
    sql(pg_dsn, "UPDATE familysearch_tokens SET refresh_token_enc = %s WHERE user_id = %s",
        (grants.encrypt("r", "another key"), other))
    fake = FakeRefresh()
    assert await refresh(pg_dsn, other, fake) == "refused" and fake.calls == []
    assert await attempt(other_project) == worker.NoGrant("undecryptable", "undecryptable")
    # A sign-in clears the refusal.
    await PgStore(pg_dsn).store_grant(user_id, auth.encrypt("signin"), auth.encrypt("r2"), datetime.now(timezone.utc))
    assert grant_row(pg_dsn, user_id)["refused_at"] is None


async def test_due_query_selects_only_patrons_with_open_turns(pg_dsn):
    """The loop's candidates: renewable, not refused, old enough or marked, and owning an open
    turn (held rows included). Oldest first."""
    store = PgStore(pg_dsn)
    due_old, _ = patron(pg_dsn, age_s=90000)
    due, _ = patron(pg_dsn, age_s=5000)
    marked_young, _ = patron(pg_dsn, age_s=10, pending=True)
    idle, (idle_project,) = patron(pg_dsn, age_s=5000, open_turn=False)
    sql(pg_dsn, "INSERT INTO turns (turn_id, session_id, project_id, message, completed_at) "
                "VALUES (%s, 's', %s, '{}'::jsonb, now())", ("turn_done_" + idle, idle_project))
    young, _ = patron(pg_dsn, age_s=10)
    no_refresh, _ = patron(pg_dsn, age_s=5000, refresh=None)
    refused, _ = patron(pg_dsn, age_s=5000, refused="invalid_grant")
    mine = {due_old, due, marked_young, idle, young, no_refresh, refused}
    got = [u for u, _ in await store.due_grant_users(3600) if u in mine]
    assert got == [due_old, due, marked_young]
    ages = dict(await store.due_grant_users(3600))
    assert 89990 < ages[due_old] < 90100

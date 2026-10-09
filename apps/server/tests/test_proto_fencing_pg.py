"""U6 (R8): claim fencing against REAL Postgres and the REAL tool server
(docs/plan/familysearch-handoff.md, U6).

A redelivery is never refused -- it is the resume path -- so two attempts of one turn can
run at once: the newer claim's and the one it superseded. Every claim of an open turn mints
the next ``turns.claim_epoch``; every write the older attempt could still make is
conditioned on its epoch, and is a no-op once a newer claim holds the turn. The writes are
in two processes: the worker's own (the close, the zero-progress counter, the transcript
mirror) and the tool server's commit, which the worker reaches through the fence headers
``options.tool_server_headers`` builds. No fake proves anything about a row lock, so the
race runs here: a proxy over a real connection holds the newer claim at its commit
(``CommitGate``), the stale attempt's write runs into it, and the release comes only once
``pg_stat_activity`` shows that write waiting on the claim -- never inferred from a sleep.

The tool server is ``node packages/engine/mcp-server/build/http.js``, two processes, the way
two instances would run it (``_proto_tools``). Without the DSN, ``node`` or the build the
module skips -- except under ``CI``, where it fails, so the job cannot pass by skipping.
``make proto-grants-test`` builds the engine and runs it against the compose Postgres.
"""

from __future__ import annotations

import asyncio
import sys
import threading
import uuid

import psycopg
import pytest

from proto.worker import options, worker
from proto.worker.session_store import PgSessionStore
from tests._proto_pg import PROTO, database, session, sql, turn
from tests._proto_tools import call_tool, result_text, spawn_tool_server

WAIT_S = 10.0
ANCHOR = "/project"


@pytest.fixture(scope="module")
def pg_dsn():
    with database(prefix="u6_") as dsn:
        yield dsn


@pytest.fixture(scope="module")
def servers(pg_dsn, tmp_path_factory):
    """Tool servers S1 and S2 over the module database: two instances."""
    with spawn_tool_server(pg_dsn, tmp_path_factory.mktemp("s1")) as s1, \
            spawn_tool_server(pg_dsn, tmp_path_factory.mktemp("s2")) as s2:
        yield s1, s2


@pytest.fixture(autouse=True)
def quiet(monkeypatch):
    """The worker's log lines, and a real claim (no stub upsert)."""
    monkeypatch.delenv("DEV_PATHS", raising=False)
    monkeypatch.setattr(worker, "log", lambda **f: None)


class CommitGate:
    """A real psycopg connection whose ``commit()`` stops until ``release`` is set: the
    claim's UPDATE has executed and holds its row lock, and has not committed."""

    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn
        self.at_commit = threading.Event()
        self.release = threading.Event()

    def __getattr__(self, name):
        return getattr(self._conn, name)

    def commit(self) -> None:
        self.at_commit.set()
        if not self.release.wait(WAIT_S * 3):
            raise AssertionError("the gated claim was never released")
        self._conn.commit()


class GatedClaim:
    """``worker.claim`` on a thread, held at its commit by a CommitGate."""

    def __init__(self, dsn: str, row: dict, receive_count: int) -> None:
        self.conn = psycopg.connect(dsn)
        self.gate = CommitGate(self.conn)
        self.result: list = []
        self.thread = threading.Thread(target=self._run, args=(row, receive_count), daemon=True)
        self.thread.start()
        if not self.gate.at_commit.wait(WAIT_S):
            self.finish()
            raise AssertionError("the claim never reached its commit")

    def _run(self, row: dict, receive_count: int) -> None:
        try:
            self.result.append(worker.claim(self.gate, row, receive_count))
        except BaseException as exc:  # noqa: BLE001 - re-raised by finish()
            self.result.append(exc)

    def finish(self) -> worker.Claim:
        self.gate.release.set()
        self.thread.join(WAIT_S)
        self.conn.close()
        assert self.result, "the gated claim never returned"
        if isinstance(self.result[0], BaseException):
            raise self.result[0]
        return self.result[0]


def seeded(dsn: str) -> dict:
    """A session with an open turn whose message is ``go``: the turn dict ``claim`` takes."""
    row = session(dsn)
    turn_id = turn(dsn, row.session_id, row.project_id, "go")
    return {"turn_id": turn_id, "session_id": row.session_id, "project_id": row.project_id,
            "message": {"text": "go"}}


def claim(dsn: str, row: dict, receive_count: int) -> worker.Claim:
    with psycopg.connect(dsn) as conn:
        claimed = worker.claim(conn, row, receive_count)
    assert claimed is not None
    return claimed


def headers(row: dict, epoch: int) -> dict[str, str]:
    """The worker's own header builder: a renamed or reformatted header fails here."""
    return options.tool_server_headers(project_id=row["project_id"], bearer="t", turn_id=row["turn_id"],
                                       claim_epoch=epoch)


def create(title: str) -> dict:
    return {"projectPath": ANCHOR, "objective": f"Who were {title}'s parents?", "title": title}


def log_entry(name: str) -> dict:
    """A write with no existence pre-check: it reaches the store's commit every time."""
    return {"projectPath": ANCHOR, "tool": "record_search", "query": {"givenName": name},
            "outcome": "negative", "resultsExamined": 0, "resultsAvailable": 0}


async def lock_waiter(dsn: str, pattern: str, what: str) -> None:
    """Return once a backend of this database waits on a lock running a statement that
    matches ``pattern`` (ILIKE); fail by name at the deadline."""
    statement = ("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() "
                 "AND pid <> pg_backend_pid() AND wait_event_type = 'Lock' AND query ILIKE %s")
    loop = asyncio.get_running_loop()
    deadline = loop.time() + WAIT_S
    while loop.time() < deadline:
        found = await asyncio.to_thread(sql, dsn, statement, (pattern,))
        if found[0][0]:
            return
        await asyncio.sleep(0.05)
    raise AssertionError(what)


def epoch_of(dsn: str, turn_id: str) -> int:
    return sql(dsn, "SELECT claim_epoch FROM turns WHERE turn_id = %s", (turn_id,))[0][0]


def documents(dsn: str, project_id: str) -> list[tuple]:
    return sql(dsn, "SELECT name, version, doc::text FROM documents WHERE project_id = %s ORDER BY name",
               (project_id,))


def assert_refused(result, epoch: int) -> None:
    """A stale write's answer names why: the guard emitted, it did not merely fail."""
    text = result_text(result)
    assert result.isError, f"a write the fence must refuse was not refused: {text}"
    assert "newer attempt" in text and f"epoch {epoch}" in text, text


# ── 3.1 the Done-when: a stale write through a second tool server is a no-op ─────────


def test_a_stale_write_through_a_second_tool_server_is_a_no_op(pg_dsn, servers):
    s1, s2 = servers
    row = seeded(pg_dsn)
    pid = row["project_id"]

    async def scenario() -> None:
        # Worker A claims the turn; worker B's redelivery claims it while A still runs, and
        # is held at its commit.
        a = claim(pg_dsn, row, 1)
        assert a.epoch == 1 and a.message["text"] == "go"
        b_claim = GatedClaim(pg_dsn, row, 2)
        try:
            # A's write starts against the committed epoch 1, so its BEGIN pre-check passes,
            # and its commit-time fence must wait on B's uncommitted claim.
            stale = asyncio.create_task(call_tool(s1, headers(row, a.epoch), "project_create", create("alpha")))
            await lock_waiter(pg_dsn, "%claim_epoch%FOR SHARE%",
                              "A's commit-time fence never waited on B's uncommitted claim")
        finally:
            b = b_claim.finish()
        assert b.epoch == 2 and b.message["text"] == "go"
        assert_refused(await stale, 1)

        # A's retry after B's claim committed: refused at its BEGIN pre-check.
        assert_refused(await call_tool(s1, headers(row, 1), "project_create", create("alpha")), 1)
        live = await call_tool(s2, headers(row, b.epoch), "project_create", create("bravo"))
        assert not live.isError, result_text(live)

        # A real parallel write through both servers: the live one lands, the stale one does not.
        stale_log, live_log = await asyncio.gather(
            call_tool(s1, headers(row, 1), "research_log_append", log_entry("Alpha")),
            call_tool(s2, headers(row, b.epoch), "research_log_append", log_entry("Bravo")),
        )
        assert_refused(stale_log, 1)
        assert not live_log.isError, result_text(live_log)

    asyncio.run(scenario())
    docs = documents(pg_dsn, pid)
    names = [name for name, _, _ in docs]
    assert "research.json" in names, docs
    research = next(doc for name, _, doc in docs if name == "research.json")
    assert '"title": "bravo"' in research and '"givenName": "Bravo"' in research, research
    assert not any("alpha" in doc.lower() for _, _, doc in docs), "a superseded attempt's write landed"
    assert epoch_of(pg_dsn, row["turn_id"]) == 2


def test_a_fence_naming_another_project_s_turn_is_refused(pg_dsn, servers):
    """The fence is (turn, project, epoch): a live turn's fence sent with another project's
    header must not authorise a write to that project. The legitimate direction: the same
    project with no fence headers at all writes as it always did."""
    s1, _ = servers
    theirs = seeded(pg_dsn)
    live = claim(pg_dsn, theirs, 1)
    mine = session(pg_dsn).project_id

    async def scenario():
        forged = options.tool_server_headers(project_id=mine, bearer="t", turn_id=theirs["turn_id"],
                                             claim_epoch=live.epoch)
        refused = await call_tool(s1, forged, "project_create", create("forged"))
        unfenced = await call_tool(s1, {"Authorization": "Bearer t", options.PROJECT_ID_HEADER: mine},
                                   "project_create", create("plain"))
        return refused, unfenced

    refused, unfenced = asyncio.run(scenario())
    assert_refused(refused, live.epoch)
    assert not unfenced.isError, result_text(unfenced)
    assert [doc for name, _, doc in documents(pg_dsn, mine) if name == "research.json"][0].count('"plain"') == 1


# ── 3.2 the worker's own writes are fenced on real rows ───────────────────────────────


def key(row: dict) -> dict:
    return {"project_key": row["project_id"], "session_id": "sdk_" + row["session_id"]}


def entries(tag: str, n: int = 2) -> list[dict]:
    return [{"type": "user", "uuid": str(uuid.uuid4()), "tag": tag} for _ in range(n)]


def entry_count(dsn: str, row: dict, tag: str) -> int:
    return sql(dsn, "SELECT count(*) FROM session_entries WHERE session_id = %s AND entry->>'tag' = %s",
               ("sdk_" + row["session_id"], tag))[0][0]


def test_a_superseded_attempt_s_worker_writes_are_no_ops(pg_dsn):
    row = seeded(pg_dsn)
    tid = row["turn_id"]
    assert claim(pg_dsn, row, 1).epoch == 1
    assert claim(pg_dsn, row, 2).epoch == 2
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        with pytest.raises(worker.Superseded, match="epoch 1 superseded by 2"):
            worker.complete(conn, {**row, "claim_epoch": 1}, 1, only_if_open=True, claim_epoch=1)
        assert sql(pg_dsn, "SELECT completed_at FROM turns WHERE turn_id = %s", (tid,)) == [(None,)]
        assert sql(pg_dsn, "SELECT count(*) FROM session_events WHERE kind = 'turn_done' "
                           "AND payload->>'turn_id' = %s", (tid,)) == [(0,)]

        with pytest.raises(worker.Superseded):
            worker.bump_zero_progress(conn, tid, 1)
        assert sql(pg_dsn, "SELECT zero_progress_attempts FROM turns WHERE turn_id = %s", (tid,)) == [(0,)]
        assert worker.bump_zero_progress(conn, tid, 2) == 1
        worker.reset_zero_progress(conn, tid, 1)
        assert sql(pg_dsn, "SELECT zero_progress_attempts FROM turns WHERE turn_id = %s", (tid,)) == [(1,)]

        assert worker.claim_current(conn, tid, 1) is False
        assert worker.claim_current(conn, tid, 2) is True

    stale = PgSessionStore(pg_dsn, row["project_id"], turn_id=tid, claim_epoch=1)
    with pytest.raises(RuntimeError, match="superseded"):
        asyncio.run(stale.append(key(row), entries("stale")))
    assert stale.superseded and entry_count(pg_dsn, row, "stale") == 0

    # The legitimate direction: the newer attempt's append and close land.
    live = PgSessionStore(pg_dsn, row["project_id"], turn_id=tid, claim_epoch=2)
    asyncio.run(live.append(key(row), entries("live")))
    assert not live.superseded and entry_count(pg_dsn, row, "live") == 2
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        assert worker.complete(conn, {**row, "claim_epoch": 2}, 2, only_if_open=True, claim_epoch=2) is not None
    assert sql(pg_dsn, "SELECT completed_at IS NOT NULL, claim_epoch FROM turns WHERE turn_id = %s",
               (tid,)) == [(True, 2)]


# ── 3.3 a transcript batch racing an uncommitted claim waits, then is refused ────────


def test_a_transcript_batch_racing_an_uncommitted_claim_waits_and_is_refused(pg_dsn):
    row = seeded(pg_dsn)
    assert claim(pg_dsn, row, 1).epoch == 1
    store = PgSessionStore(pg_dsn, row["project_id"], turn_id=row["turn_id"], claim_epoch=1)

    async def scenario():
        b_claim = GatedClaim(pg_dsn, row, 2)
        try:
            batch = asyncio.create_task(store.append(key(row), entries("racing", 3)))
            await lock_waiter(pg_dsn, "%session_entries%FOR SHARE%",
                              "A's transcript batch never waited on B's uncommitted claim")
        finally:
            b = b_claim.finish()
        assert b.epoch == 2
        with pytest.raises(RuntimeError, match="superseded"):
            await batch

    asyncio.run(scenario())
    assert store.superseded and entry_count(pg_dsn, row, "racing") == 0


def test_a_fenced_batch_never_holds_the_turn_lock_across_an_await(pg_dsn):
    """The in-process wedge (§10.1, §10.9): the worker's sync hooks write the ``turns`` row
    ON the event loop the transcript mirror runs on. A batch that held its share lock
    across an await -- a fence statement then an insert, or one statement on a connection
    that commits in a second round trip -- would block a sync same-row write the loop runs
    meanwhile, and the batch could never commit: the loop is the thing it waits for. The
    fenced batch is one autocommit statement, so every sync write gets through at once."""
    row = seeded(pg_dsn)
    assert claim(pg_dsn, row, 1).epoch == 1
    store = PgSessionStore(pg_dsn, row["project_id"], turn_id=row["turn_id"], claim_epoch=1)
    wedged: list[str] = []
    writes = [0]

    async def scenario() -> None:
        with psycopg.connect(pg_dsn, autocommit=True) as hook_conn:
            hook_conn.execute("SET lock_timeout = '3s'")
            batch = asyncio.create_task(store.append(key(row), entries("wedge", 3)))
            loop = asyncio.get_running_loop()

            def sync_hook() -> None:
                # What record_nudge does from a Stop hook: a blocking same-row write.
                try:
                    worker.record_nudge(hook_conn, row["turn_id"], writes[0])
                    writes[0] += 1
                except psycopg.errors.LockNotAvailable as exc:
                    wedged.append(str(exc))
                    return
                if not batch.done():
                    loop.call_soon(sync_hook)

            loop.call_soon(sync_hook)
            await asyncio.wait_for(batch, WAIT_S * 2)

    asyncio.run(scenario())
    assert not wedged, ("the transcript batch held the turns row's share lock across an await: a sync "
                        f"same-row write on the event loop timed out waiting for it -- the wedge ({wedged[0]})")
    assert writes[0] >= 1, "no sync write ran while the batch was in flight"
    assert entry_count(pg_dsn, row, "wedge") == 3


# ── 3.4 the sweep's close is the expiry ───────────────────────────────────────────────


def test_a_sweep_close_fences_the_attempt_it_gave_up_on(pg_dsn, servers, monkeypatch):
    s1, _ = servers
    row = seeded(pg_dsn)
    assert claim(pg_dsn, row, 1).epoch == 1
    sql(pg_dsn, "UPDATE turns SET claimed_at = now() - interval '1 hour' WHERE turn_id = %s", (row["turn_id"],))
    monkeypatch.setattr(worker, "PG_DSN", pg_dsn)
    monkeypatch.setattr(worker, "QUEUE_URL", "")
    closed = worker.sweep_once(connect=psycopg.connect, max_retries=1, visibility_s=0, retention_s=0)
    assert row["turn_id"] in closed
    assert sql(pg_dsn, "SELECT completed_at IS NOT NULL, claim_epoch FROM turns WHERE turn_id = %s",
               (row["turn_id"],)) == [(True, 2)]
    result = asyncio.run(call_tool(s1, headers(row, 1), "project_create", create("survivor")))
    assert_refused(result, 1)
    assert documents(pg_dsn, row["project_id"]) == []


def web_store():
    """The web tier's own store, so its close runs the statement it ships."""
    if str(PROTO) not in sys.path:
        sys.path.insert(0, str(PROTO))
    from web.app import PgStore

    return PgStore


def test_a_web_tier_fail_turn_fences_a_claimed_attempt(pg_dsn, servers):
    """A send that timed out after it landed is claimed before the web tier fails the turn:
    the close must fence that attempt, or it keeps writing beside the patron's resend. The
    legitimate direction: failing a row already closed keeps its closer's outcome and epoch."""
    s1, _ = servers
    row = seeded(pg_dsn)
    tid = row["turn_id"]
    assert claim(pg_dsn, row, 1).epoch == 1
    asyncio.run(web_store()(pg_dsn).fail_turn(tid, "enqueue_failed"))
    assert sql(pg_dsn, "SELECT completed_at IS NOT NULL, outcome, claim_epoch FROM turns WHERE turn_id = %s",
               (tid,)) == [(True, "enqueue_failed", 2)], "the web tier's fail_turn did not fence the claim"

    assert_refused(asyncio.run(call_tool(s1, headers(row, 1), "project_create", create("ghost"))), 1)
    assert documents(pg_dsn, row["project_id"]) == []
    stale = PgSessionStore(pg_dsn, row["project_id"], turn_id=tid, claim_epoch=1)
    with pytest.raises(RuntimeError, match="superseded"):
        asyncio.run(stale.append(key(row), entries("after_fail")))
    assert stale.superseded and entry_count(pg_dsn, row, "after_fail") == 0

    asyncio.run(web_store()(pg_dsn).fail_turn(tid, "again"))
    assert sql(pg_dsn, "SELECT outcome, claim_epoch FROM turns WHERE turn_id = %s",
               (tid,)) == [("enqueue_failed", 2)], "fail_turn rewrote a row that was already closed"


# ── 3.5 a completed row keeps its epoch ───────────────────────────────────────────────


def test_a_claim_of_a_completed_turn_keeps_its_epoch(pg_dsn):
    """A late duplicate of a closed turn must not fence out the closer's trailing flush."""
    row = seeded(pg_dsn)
    assert claim(pg_dsn, row, 1).epoch == 1
    closer = claim(pg_dsn, row, 2).epoch
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        assert worker.complete(conn, {**row, "claim_epoch": closer}, 2, only_if_open=True,
                               claim_epoch=closer) is not None
    assert claim(pg_dsn, row, 3).epoch == closer
    flush = PgSessionStore(pg_dsn, row["project_id"], turn_id=row["turn_id"], claim_epoch=closer)
    asyncio.run(flush.append(key(row), entries("flush")))
    assert not flush.superseded and entry_count(pg_dsn, row, "flush") == 2


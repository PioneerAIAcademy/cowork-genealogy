"""PgSessionStore.append's uuid dedupe against REAL Postgres (U6; 011_session_entries_uuid_index.sql).

The SDK retries a failed append up to three times, one after another, and asks the adapter
to treat ``entry["uuid"]`` as an idempotency key: a batch can commit while its client sees
an error, and the retry then carries entries already stored. Each path of ``append`` is
one statement that skips those, so a retry adds nothing, a partial overlap adds only the
new entries in batch order, and an entry with no uuid is always appended. The fenced path
must still tell a refusal from a batch the fence let through that had nothing new to
insert: only the first is ``superseded``. Every test runs both the fenced store (the
worker's) and the unfenced one, except where the fence itself is the subject.

Without the DSN the module skips, except under ``CI``, where it fails.
"""

from __future__ import annotations

import asyncio
import uuid

import pytest

from proto.worker.session_store import PgSessionStore
from tests._proto_pg import database, session, sql, turn


@pytest.fixture(scope="module")
def pg_dsn():
    with database(prefix="u6s_") as dsn:
        yield dsn


def claimed_turn(dsn: str, epoch: int = 1) -> dict:
    """An open turn whose current claim is ``epoch`` -- what the fence reads."""
    row = session(dsn)
    turn_id = turn(dsn, row.session_id, row.project_id, "go")
    sql(dsn, "UPDATE turns SET claim_epoch = %s WHERE turn_id = %s", (epoch, turn_id))
    return {"turn_id": turn_id, "project_id": row.project_id, "sdk_session_id": "sdk_" + uuid.uuid4().hex[:10]}


def store_for(dsn: str, row: dict, fenced: bool, epoch: int = 1) -> PgSessionStore:
    if fenced:
        return PgSessionStore(dsn, row["project_id"], turn_id=row["turn_id"], claim_epoch=epoch)
    return PgSessionStore(dsn, row["project_id"])


def key(row: dict) -> dict:
    return {"project_key": "-project", "session_id": row["sdk_session_id"]}


def entry(name: str, *, with_uuid: bool = True) -> dict:
    e = {"type": "user", "name": name}
    if with_uuid:
        e["uuid"] = f"{name}-{uuid.uuid4().hex[:8]}"
    return e


def stored(dsn: str, row: dict) -> list[dict]:
    loaded = asyncio.run(PgSessionStore(dsn, row["project_id"]).load(key(row)))
    return loaded or []


both = pytest.mark.parametrize("fenced", [True, False], ids=["fenced", "unfenced"])


@both
def test_a_retried_batch_that_already_committed_inserts_nothing_and_is_not_superseded(pg_dsn, fenced):
    row = claimed_turn(pg_dsn)
    store = store_for(pg_dsn, row, fenced)
    batch = [entry("a"), entry("b"), entry("c")]
    asyncio.run(store.append(key(row), batch))
    # The SDK's retry of a batch whose first attempt committed but raised at the client.
    asyncio.run(store.append(key(row), batch))
    assert stored(pg_dsn, row) == batch, "a retried batch that had already committed was stored twice"
    assert not store.superseded, "a fully-deduped retry of the current epoch was reported superseded"
    # Both batches count as appended: the transcript-lost guard must not read a deduped
    # retry as a lost transcript.
    assert store.calls["entries_appended"] == 6 and store.calls["entries_deduped"] == 3, store.calls


@both
def test_a_partially_overlapping_batch_inserts_only_the_new_entries_in_order(pg_dsn, fenced):
    row = claimed_turn(pg_dsn)
    store = store_for(pg_dsn, row, fenced)
    a, b, c, d = entry("a"), entry("b"), entry("c"), entry("d")
    asyncio.run(store.append(key(row), [a, b]))
    asyncio.run(store.append(key(row), [b, c, a, d]))
    assert stored(pg_dsn, row) == [a, b, c, d], "an overlapping retry stored a duplicate or lost batch order"
    assert store.calls["entries_deduped"] == 2, store.calls


@both
def test_entries_without_a_uuid_are_always_inserted(pg_dsn, fenced):
    row = claimed_turn(pg_dsn)
    store = store_for(pg_dsn, row, fenced)
    title = entry("title", with_uuid=False)
    asyncio.run(store.append(key(row), [title, title]))
    asyncio.run(store.append(key(row), [title]))
    assert stored(pg_dsn, row) == [title, title, title], "an entry with no uuid was deduped"
    assert store.calls["entries_deduped"] == 0 and not store.superseded, store.calls


@both
def test_a_uuid_repeated_within_one_batch_is_stored_once(pg_dsn, fenced):
    row = claimed_turn(pg_dsn)
    store = store_for(pg_dsn, row, fenced)
    a, b = entry("a"), entry("b")
    asyncio.run(store.append(key(row), [a, b, a]))
    assert stored(pg_dsn, row) == [a, b], "a uuid repeated within one batch was stored twice"


def test_the_dedupe_is_scoped_to_the_key(pg_dsn):
    """The same uuid under another subpath (a subagent's transcript) is another entry."""
    row = claimed_turn(pg_dsn)
    store = store_for(pg_dsn, row, True)
    a = entry("a")
    sub = {**key(row), "subpath": "subagents/agent-1"}
    asyncio.run(store.append(key(row), [a]))
    asyncio.run(store.append(sub, [a]))
    assert asyncio.run(store.load(sub)) == [a]


@pytest.mark.parametrize("duplicate", [False, True], ids=["new-entries", "already-stored"])
def test_a_stale_epoch_batch_is_still_refused_and_reported_superseded(pg_dsn, duplicate):
    row = claimed_turn(pg_dsn, epoch=2)
    live = store_for(pg_dsn, row, True, epoch=2)
    first = [entry("live")]
    asyncio.run(live.append(key(row), first))
    stale = store_for(pg_dsn, row, True, epoch=1)
    batch = first if duplicate else [entry("stale")]
    with pytest.raises(RuntimeError, match="superseded"):
        asyncio.run(stale.append(key(row), batch))
    assert stale.superseded, "a stale epoch's refused batch was not reported superseded"
    assert stale.calls["entries_appended"] == 0, stale.calls
    assert stored(pg_dsn, row) == first


def test_the_uuid_index_exists_after_migrate(pg_dsn):
    [(indexdef,)] = sql(pg_dsn, "SELECT indexdef FROM pg_indexes WHERE indexname = 'session_entries_uuid_idx'")
    assert "UNIQUE" not in indexdef, indexdef
    assert "(project_key, session_id, subpath, ((entry ->> 'uuid'::text)))" in indexdef, indexdef

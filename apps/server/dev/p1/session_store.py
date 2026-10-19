#!/usr/bin/env python3
"""Postgres-backed ``SessionStore`` for the P1 cross-process resume probe.

Contract: `PLAN.md` at the repo root ("apps/server/dev/p1/session_store.py"),
which implements "P1. Cross-process resume" of
`docs/plan/search-agent-prototype.md`.

One table, ``p1_session_entries``; one row per transcript entry, ordered by a
``bigserial`` so ``load`` returns entries in append order. ``namespace`` scopes a
driver run (or one conformance contract) so runs never see each other's rows.

Only ``append`` / ``load`` / ``list_subkeys`` are defined. ``list_sessions``,
``list_session_summaries`` and ``delete`` inherit the Protocol defaults, which
is what makes ``_store_implements`` report them absent and the SDK (and the
conformance suite) skip them.

Every method bumps ``self.calls`` and records an event in ``self.events`` /
``on_event`` — the counters P1's criteria are measured from, not inferred.

Conformance (zero tokens; needs the docker postgres from PLAN.md):

    uv run python -m dev.p1.session_store --conformance [--dsn DSN]
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
import traceback
import uuid
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from claude_agent_sdk.types import (
    SessionKey,
    SessionListSubkeysKey,
    SessionStore,
    SessionStoreEntry,
)

DEFAULT_DSN = "postgresql://postgres:p1@127.0.0.1:5433/p1"
TABLE = "p1_session_entries"

# ``project_key`` is stored and scoped on — a deviation from PLAN.md's key-blind
# store: the SDK conformance suite's REQUIRED contract 6 asserts project_key
# isolation, which a key-blind store can never satisfy, and PASS is the
# deliverable. Both P1 processes run from the same ``--project`` directory, so
# the key matches across the kill and the resume. Dropping the ``project_key``
# predicate from the three statements below restores the key-blind shape.
_CREATE_TABLE = f"""
CREATE TABLE IF NOT EXISTS {TABLE} (
    namespace   text      NOT NULL,
    project_key text      NOT NULL DEFAULT '',
    session_id  text      NOT NULL,
    subpath     text      NOT NULL DEFAULT '',
    seq         bigserial PRIMARY KEY,
    entry       jsonb     NOT NULL
)
"""
_CREATE_INDEX = f"""
CREATE INDEX IF NOT EXISTS {TABLE}_key_idx
    ON {TABLE} (namespace, project_key, session_id, subpath, seq)
"""
_INSERT = (
    f"INSERT INTO {TABLE} (namespace, project_key, session_id, subpath, entry) "
    "VALUES (%s, %s, %s, %s, %s)"
)
_SELECT = (
    f"SELECT entry FROM {TABLE} "
    "WHERE namespace = %s AND project_key = %s AND session_id = %s AND subpath = %s "
    "ORDER BY seq"
)
_SELECT_SUBKEYS = (
    f"SELECT DISTINCT subpath FROM {TABLE} "
    "WHERE namespace = %s AND project_key = %s AND session_id = %s AND subpath <> '' "
    "ORDER BY subpath"
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


class PgSessionStore(SessionStore):
    """``SessionStore`` adapter over one Postgres table, connect-per-call."""

    def __init__(
        self,
        dsn: str,
        namespace: str,
        *,
        on_event: Callable[[dict[str, Any]], None] | None = None,
    ) -> None:
        self.dsn = dsn
        self.namespace = namespace
        self.on_event = on_event
        self.calls: dict[str, int] = {
            "append": 0,
            "entries_appended": 0,
            "load": 0,
            "entries_loaded": 0,
            "load_none": 0,
            "list_subkeys": 0,
            "subkeys_returned": 0,
        }
        self.events: list[dict[str, Any]] = []

    # ── schema ──────────────────────────────────────────────────────────

    async def ensure_schema(self) -> None:
        async with await psycopg.AsyncConnection.connect(self.dsn) as conn:
            await conn.execute(_CREATE_TABLE)
            await conn.execute(_CREATE_INDEX)

    # ── SessionStore ────────────────────────────────────────────────────

    async def append(self, key: SessionKey, entries: list[SessionStoreEntry]) -> None:
        self.calls["append"] += 1
        if entries:
            rows = [
                (
                    self.namespace,
                    key["project_key"],
                    key["session_id"],
                    key.get("subpath") or "",
                    Jsonb(entry),
                )
                for entry in entries
            ]
            # One transaction: the ``async with`` commits on a clean exit and
            # rolls back on an exception, so a batch lands whole or not at all.
            async with await psycopg.AsyncConnection.connect(self.dsn) as conn:
                async with conn.cursor() as cur:
                    await cur.executemany(_INSERT, rows)
        self.calls["entries_appended"] += len(entries)
        self._emit("append", key, len(entries))

    async def load(self, key: SessionKey) -> list[SessionStoreEntry] | None:
        self.calls["load"] += 1
        params = (
            self.namespace,
            key["project_key"],
            key["session_id"],
            key.get("subpath") or "",
        )
        async with await psycopg.AsyncConnection.connect(self.dsn) as conn:
            async with conn.cursor() as cur:
                await cur.execute(_SELECT, params)
                rows = await cur.fetchall()
        if not rows:
            self.calls["load_none"] += 1
            self._emit("load", key, 0)
            return None
        entries = [row[0] for row in rows]
        self.calls["entries_loaded"] += len(entries)
        self._emit("load", key, len(entries))
        return entries

    async def list_subkeys(self, key: SessionListSubkeysKey) -> list[str]:
        self.calls["list_subkeys"] += 1
        params = (self.namespace, key["project_key"], key["session_id"])
        async with await psycopg.AsyncConnection.connect(self.dsn) as conn:
            async with conn.cursor() as cur:
                await cur.execute(_SELECT_SUBKEYS, params)
                rows = await cur.fetchall()
        subkeys = [row[0] for row in rows]
        self.calls["subkeys_returned"] += len(subkeys)
        self._emit("list_subkeys", key, len(subkeys))
        return subkeys

    # ── observation ─────────────────────────────────────────────────────

    def _emit(self, method: str, key: SessionKey | SessionListSubkeysKey, n: int) -> None:
        event = {
            "store": method,
            "session_id": key["session_id"],
            "subpath": key.get("subpath") or None,
            "n": n,
            "ts": _now_iso(),
        }
        self.events.append(event)
        if self.on_event is not None:
            try:
                self.on_event(event)
            except Exception:  # noqa: BLE001 - an observer must never fail the store
                pass


# ── conformance ─────────────────────────────────────────────────────────


async def _run_conformance(dsn: str) -> int:
    from claude_agent_sdk.testing import run_session_store_conformance

    await PgSessionStore(dsn, "conformance-schema").ensure_schema()

    namespaces: list[str] = []

    def make_store() -> PgSessionStore:
        # Fresh namespace per contract: each call must yield an EMPTY store.
        ns = f"conformance-{uuid.uuid4().hex[:12]}"
        namespaces.append(ns)
        return PgSessionStore(dsn, ns)

    try:
        await run_session_store_conformance(
            make_store,
            skip_optional=frozenset({"list_sessions", "list_session_summaries", "delete"}),
        )
    except AssertionError:
        print(traceback.format_exc(), file=sys.stderr)
        print("FAIL")
        return 1
    finally:
        async with await psycopg.AsyncConnection.connect(dsn) as conn:
            await conn.execute(
                f"DELETE FROM {TABLE} WHERE namespace = ANY(%s)", (namespaces,)
            )
    print("PASS")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m dev.p1.session_store",
        description="Postgres SessionStore for the P1 resume probe.",
    )
    p.add_argument(
        "--conformance",
        action="store_true",
        help="run the SDK's run_session_store_conformance against a live Postgres",
    )
    p.add_argument("--dsn", default=os.environ.get("P1_PG_DSN") or DEFAULT_DSN)
    return p


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    parser = build_parser()
    args = parser.parse_args(argv)
    if not args.conformance:
        parser.error("nothing to do — pass --conformance")
    return asyncio.run(_run_conformance(args.dsn))


if __name__ == "__main__":
    sys.exit(main())

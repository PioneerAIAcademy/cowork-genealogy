"""The worker's Postgres ``SessionStore`` -- the SDK transcript mirror behind resume.

One row per transcript entry in ``session_entries`` (``proto/sql/001_schema.sql``),
ordered by its ``bigserial`` so ``load`` replays in append order. The store is scoped by
its constructor: ``project_id`` is written into ``project_key`` and the SDK's own
``project_key`` -- ``realpath(cwd)``, ``/project`` for every worker -- is ignored, so the
key that matters is ``(session_id, subpath)`` and a resume finds its entries from any
worker (plan: "Session store keying, and why ``cwd`` is pinned").

Only ``append`` / ``load`` / ``list_subkeys`` are defined; ``list_sessions``,
``list_session_summaries`` and ``delete`` inherit the Protocol defaults so the SDK skips
them. Every method bumps ``calls``, and the worker's per-turn log line reads
``entries_appended``, ``list_subkeys`` and ``subkeys_returned`` off it -- the "frames
appended > 0" assertion the plan names for the two silent-loss modes (a read-only config
dir, a mismatched ``CLAUDE_CONFIG_DIR``), and D17's fourth criterion. Connect-per-call,
one transaction per ``append`` batch.
"""

from __future__ import annotations


import psycopg
from psycopg.types.json import Jsonb

from claude_agent_sdk.types import (
    SessionKey,
    SessionListSubkeysKey,
    SessionStore,
    SessionStoreEntry,
)

_INSERT = (
    "INSERT INTO session_entries (project_key, session_id, subpath, entry) "
    "VALUES (%s, %s, %s, %s)"
)
_SELECT = (
    "SELECT entry FROM session_entries "
    "WHERE project_key = %s AND session_id = %s AND subpath = %s ORDER BY seq"
)
_SELECT_SUBKEYS = (
    "SELECT DISTINCT subpath FROM session_entries "
    "WHERE project_key = %s AND session_id = %s AND subpath <> '' ORDER BY subpath"
)
_EXISTS = (
    "SELECT 1 FROM session_entries WHERE project_key = %s AND session_id = %s LIMIT 1"
)


def entry_rows(project_id: str, key: SessionKey, entries: list[SessionStoreEntry]) -> list[tuple]:
    """The ``session_entries`` rows for one ``append``: the store's project, never the key's."""
    subpath = key.get("subpath") or ""
    return [(project_id, key["session_id"], subpath, Jsonb(entry)) for entry in entries]


class PgSessionStore(SessionStore):
    def __init__(self, dsn: str, project_id: str) -> None:
        self.dsn = dsn
        self.project_id = project_id
        self.calls: dict[str, int] = {
            "append": 0,
            "entries_appended": 0,
            "load": 0,
            "entries_loaded": 0,
            "load_none": 0,
            "list_subkeys": 0,
            "subkeys_returned": 0,
        }

    async def append(self, key: SessionKey, entries: list[SessionStoreEntry]) -> None:
        self.calls["append"] += 1
        rows = entry_rows(self.project_id, key, entries)
        if rows:
            # ``async with`` commits on a clean exit and rolls back on an exception, so a
            # batch lands whole or not at all.
            async with await psycopg.AsyncConnection.connect(self.dsn) as conn:
                async with conn.cursor() as cur:
                    await cur.executemany(_INSERT, rows)
        self.calls["entries_appended"] += len(rows)

    async def load(self, key: SessionKey) -> list[SessionStoreEntry] | None:
        self.calls["load"] += 1
        params = (self.project_id, key["session_id"], key.get("subpath") or "")
        async with await psycopg.AsyncConnection.connect(self.dsn) as conn:
            async with conn.cursor() as cur:
                await cur.execute(_SELECT, params)
                rows = await cur.fetchall()
        if not rows:
            self.calls["load_none"] += 1
            return None
        entries = [row[0] for row in rows]
        self.calls["entries_loaded"] += len(entries)
        return entries

    async def list_subkeys(self, key: SessionListSubkeysKey) -> list[str]:
        self.calls["list_subkeys"] += 1
        async with await psycopg.AsyncConnection.connect(self.dsn) as conn:
            async with conn.cursor() as cur:
                await cur.execute(_SELECT_SUBKEYS, (self.project_id, key["session_id"]))
                rows = await cur.fetchall()
        subkeys = [row[0] for row in rows]
        self.calls["subkeys_returned"] += len(subkeys)
        return subkeys

    async def has_entries(self, session_id: str) -> bool:
        """Whether a resume of ``session_id`` would find a transcript here. The SDK passes
        an explicit ``resume`` to the CLI unchanged when the store is empty, and a fresh
        container has no local transcript to fall back on -- so the worker asks first."""
        async with await psycopg.AsyncConnection.connect(self.dsn) as conn:
            async with conn.cursor() as cur:
                await cur.execute(_EXISTS, (self.project_id, session_id))
                return (await cur.fetchone()) is not None

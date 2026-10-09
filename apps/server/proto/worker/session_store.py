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

U6: a store built with ``turn_id`` and ``claim_epoch`` is one attempt's, and its ``append``
lands only while that epoch is the turn's current claim -- the batch and its fence are ONE
autocommit statement (``_FENCED_INSERT``). The fence is ``FOR SHARE`` on the ``turns`` row,
so a newer claim waits for an in-flight batch, and once it commits no stale row can land:
the redelivery's ``has_entries``/``load`` see a stable prefix. One statement, because a
two-statement transaction would hold that share lock across an await while a sync hook on
the same event loop (``record_nudge``, ``reset_zero_progress``, ``complete()``'s FOR UPDATE)
blocks on the row -- a self-deadlock. No ``completed_at`` term: the closer's own trailing
flush must land. ``load``, ``list_subkeys`` and ``has_entries`` stay unfenced; they are
reads by the current claimer.
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
# U6: the batch lands only while (turn_id, claim_epoch) is the turn's current claim.
_FENCED_INSERT = (
    "INSERT INTO session_entries (project_key, session_id, subpath, entry) "
    "SELECT %s, %s, %s, e FROM unnest(%s::jsonb[]) WITH ORDINALITY AS t(e, n) "
    "WHERE EXISTS (SELECT 1 FROM turns WHERE turn_id = %s AND claim_epoch = %s FOR SHARE) "
    "ORDER BY n"
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
    def __init__(
        self,
        dsn: str,
        project_id: str,
        *,
        turn_id: str | None = None,
        claim_epoch: int | None = None,
    ) -> None:
        if (turn_id is None) != (claim_epoch is None):
            raise ValueError("a fenced store needs both turn_id and claim_epoch")
        self.dsn = dsn
        self.project_id = project_id
        self.turn_id = turn_id
        self.claim_epoch = claim_epoch
        # Set when an append was refused because a newer claim holds the turn; the worker
        # reads it to tell a superseded attempt's MirrorErrorMessage from a lost batch.
        self.superseded = False
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
        if rows and self.turn_id is not None:
            # Autocommit: the one statement is its own transaction, so the share lock is
            # released at the statement's end, never held across an await.
            async with await psycopg.AsyncConnection.connect(self.dsn, autocommit=True) as conn:
                async with conn.cursor() as cur:
                    await cur.execute(_FENCED_INSERT, (
                        self.project_id, key["session_id"], key.get("subpath") or "",
                        [row[3] for row in rows], self.turn_id, self.claim_epoch,
                    ))
                    landed = cur.rowcount
            if landed == 0:
                self.superseded = True
                raise RuntimeError(f"claim epoch {self.claim_epoch} of turn {self.turn_id} is superseded; "
                                   "transcript append refused")
        elif rows:
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

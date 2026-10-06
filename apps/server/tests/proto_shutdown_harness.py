"""Runs the real ``worker.main()`` for test_proto_shutdown.py, with only what CI lacks
replaced: ``prepare`` (plugin agents), ``_verify_schema_once`` (the schema thread's
check, which would otherwise make its own ``connect_timeout`` connect at start and
print ``ev=harness_release`` before any shutdown), ``psycopg.connect`` (a fake that
answers ``claim`` -- the web tier's row exists, U4 -- ``turn_completed``,
``choose_sdk_session_id`` and a last-receive close;
the shutdown release's connect -- the one passing ``RELEASE_CONNECT_TIMEOUT_S`` -- prints
``ev=harness_release``) and the attempt's body, which prints ``ev=harness_attempt`` and
blocks until cancelled. ``ev=shutdown`` is written a second late: it runs on the daemon
shutdown thread after ``serve_forever`` returns, so an exit that does not join that
thread loses it. The signal handler,
the cancel scope, the shutdown thread and the exit are the worker's own."""

from __future__ import annotations

import asyncio
import contextlib
import json
import sys
import time
from pathlib import Path

SERVER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER))

from proto.worker import worker  # noqa: E402


class _Cursor:
    def __init__(self) -> None:
        self.sql = ""
        self.params: tuple = ()

    def __enter__(self) -> "_Cursor":
        return self

    def __exit__(self, *exc: object) -> None:
        pass

    def execute(self, sql: str, params: tuple = ()) -> None:
        self.sql, self.params = sql, params

    def fetchone(self) -> tuple | None:
        if "RETURNING turns.message" in self.sql:
            _, _, turn_id, session_id, project_id = self.params
            return ({"turn_id": turn_id, "session_id": session_id, "project_id": project_id, "text": "hello"},)
        if "RETURNING sdk_session_id" in self.sql:
            return ("11111111-1111-1111-1111-111111111111",)
        if "SELECT completed_at FROM turns" in self.sql:
            return (None,)
        if "next_session_seq" in self.sql:
            return (1,)
        return None


class _Conn:
    def cursor(self) -> _Cursor:
        return _Cursor()

    def commit(self) -> None:
        pass

    def close(self) -> None:
        pass

    def transaction(self) -> contextlib.AbstractContextManager:
        return contextlib.nullcontext()

    def __enter__(self) -> "_Conn":
        return self

    def __exit__(self, *exc: object) -> None:
        pass


async def _blocking_attempt(turn, receive_count, sdk_session_id, *, agents=None):
    print(json.dumps({"ev": "harness_attempt", "turn_id": turn["turn_id"]}), flush=True)
    try:
        await asyncio.sleep(3600)
    finally:
        print(json.dumps({"ev": "harness_attempt_finally"}), flush=True)


worker.prepare = lambda: None
worker._verify_schema_once = lambda dsn, **kw: []
def _connect(*args: object, **kwargs: object) -> _Conn:
    # The release's own timeout, not any: pg_connect gives every connect one (U23).
    if kwargs.get("connect_timeout") == worker.RELEASE_CONNECT_TIMEOUT_S:
        print(json.dumps({"ev": "harness_release"}), flush=True)
    return _Conn()


_log = worker.log


def _late_shutdown_log(**fields: object) -> None:
    if fields.get("ev") == "shutdown":
        time.sleep(1)
    _log(**fields)


worker.psycopg.connect = _connect
worker._run_turn = _blocking_attempt
worker.log = _late_shutdown_log

if __name__ == "__main__":
    worker.main()

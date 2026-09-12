"""D3 stub worker: the HTTP handler the sqsd shim POSTs turns to. No SDK, no model.

``POST /turn`` claims the turn in Postgres (upserts ``sessions``/``turns``; a
redelivered ``turn_id`` is granted immediately -- that is the resume path) and then
follows the message's ``behaviour`` so the compose stack can be driven through
every shim arm without a model:

  {"behaviour": "ok"}                   -> session_events row (kind turn_done),
                                           turns.completed_at/outcome, 200
  {"behaviour": "sleep", "seconds": N}  -> sleep N (first delivery only), then as ok
  {"behaviour": "fail"}                 -> 500, every delivery
  {"behaviour": "crash"}                -> os._exit(1) before replying (first
                                           delivery only; compose restarts us)

``sleep`` and ``crash`` act only when ``X-Aws-Sqsd-Receive-Count`` is 1 so the
redelivered turn completes on a fresh worker. ``GET /healthz`` -> 200.
ThreadingHTTPServer, so a second POST is served while a turn is running.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import psycopg
from psycopg.types.json import Jsonb

PG_DSN = os.environ.get("PG_DSN", "postgresql://postgres:proto@postgres:5432/proto")
PORT = int(os.environ.get("PORT", "8080"))

_stdout_lock = threading.Lock()


def log(**fields: object) -> None:
    line = json.dumps(fields, separators=(",", ":"), default=str)
    with _stdout_lock:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


def claim(conn: psycopg.Connection, turn: dict, receive_count: int) -> None:
    """Record the claim: sessions/turns upsert; a redelivery just bumps receive_count."""
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO sessions (session_id, project_id, created_at) VALUES (%s, %s, now()) "
            "ON CONFLICT (session_id) DO NOTHING",
            (turn["session_id"], turn["project_id"]),
        )
        cur.execute(
            "INSERT INTO turns (turn_id, session_id, project_id, message, enqueued_at, "
            "claimed_at, receive_count) "
            "VALUES (%s, %s, %s, %s, COALESCE(%s::timestamptz, now()), now(), %s) "
            "ON CONFLICT (turn_id) DO UPDATE "
            "SET claimed_at = now(), receive_count = EXCLUDED.receive_count",
            (
                turn["turn_id"],
                turn["session_id"],
                turn["project_id"],
                Jsonb(turn["message"]),
                turn["message"].get("enqueued_at"),
                receive_count,
            ),
        )
    conn.commit()


def complete(conn: psycopg.Connection, turn: dict, receive_count: int) -> int:
    """Append the turn_done event (per-session seq via next_session_seq) and close the turn."""
    with conn.cursor() as cur:
        cur.execute("SELECT next_session_seq(%s)", (turn["session_id"],))
        seq = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO session_events (session_id, seq, kind, payload, ts) "
            "VALUES (%s, %s, 'turn_done', %s, now())",
            (
                turn["session_id"],
                seq,
                Jsonb({"turn_id": turn["turn_id"], "receive_count": receive_count}),
            ),
        )
        cur.execute(
            "UPDATE turns SET completed_at = now(), outcome = 'ok' WHERE turn_id = %s",
            (turn["turn_id"],),
        )
    conn.commit()
    return seq


class Handler(BaseHTTPRequestHandler):
    server_version = "proto-worker/0.1"

    def log_message(self, format, *args):  # noqa: A002 - BaseHTTPRequestHandler's signature
        pass  # JSON lines below replace the default access log

    def _reply(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/healthz":
            self._reply(200, {"ok": True})
        else:
            self._reply(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:
        if self.path != "/turn":
            self._reply(404, {"ok": False, "error": "not found"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length)
        try:
            message = json.loads(raw.decode("utf-8"))
            if not isinstance(message, dict):
                raise ValueError("body is not a JSON object")
        except (ValueError, UnicodeDecodeError) as exc:
            log(ev="turn", status=400, error=f"bad body: {exc}")
            self._reply(400, {"ok": False, "error": f"bad body: {exc}"})
            return

        msgid = self.headers.get("X-Aws-Sqsd-Msgid")
        try:
            receive_count = int(self.headers.get("X-Aws-Sqsd-Receive-Count") or 1)
        except ValueError as exc:
            log(ev="turn", status=400, error=f"bad receive count: {exc}")
            self._reply(400, {"ok": False, "error": f"bad X-Aws-Sqsd-Receive-Count: {exc}"})
            return
        turn = {
            "turn_id": message.get("turn_id") or msgid or "turn-unknown",
            "session_id": message.get("session_id") or "sess-unknown",
            "project_id": message.get("project_id") or "proj-unknown",
            "message": message,
        }
        behaviour = message.get("behaviour", "ok")
        seconds = float(message.get("seconds") or 0)
        if behaviour not in ("ok", "sleep", "fail", "crash"):
            log(ev="turn", turn_id=turn["turn_id"], behaviour=behaviour, receive_count=receive_count, status=400)
            self._reply(400, {"ok": False, "error": f"unknown behaviour {behaviour!r}"})
            return

        try:
            with psycopg.connect(PG_DSN) as conn:
                claim(conn, turn, receive_count)

            if behaviour == "fail":
                log(ev="turn", turn_id=turn["turn_id"], behaviour=behaviour, receive_count=receive_count, status=500)
                self._reply(500, {"ok": False, "turn_id": turn["turn_id"], "error": "behaviour=fail"})
                return
            if behaviour == "crash" and receive_count == 1:
                log(ev="turn", turn_id=turn["turn_id"], behaviour=behaviour, receive_count=receive_count, status="crash")
                os._exit(1)
            if behaviour == "sleep" and receive_count == 1:
                time.sleep(seconds)

            with psycopg.connect(PG_DSN) as conn:
                seq = complete(conn, turn, receive_count)
        except psycopg.Error as exc:
            log(ev="turn", turn_id=turn["turn_id"], behaviour=behaviour, receive_count=receive_count, status=500, error=f"{type(exc).__name__}: {exc}")
            self._reply(500, {"ok": False, "turn_id": turn["turn_id"], "error": f"{type(exc).__name__}: {exc}"})
            return

        log(ev="turn", turn_id=turn["turn_id"], behaviour=behaviour, receive_count=receive_count, status=200, seq=seq)
        self._reply(200, {"ok": True, "turn_id": turn["turn_id"], "receive_count": receive_count, "seq": seq})


def main() -> None:
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    log(ev="start", port=PORT, pg_dsn=PG_DSN.split("@")[-1])
    server.serve_forever()


if __name__ == "__main__":
    main()

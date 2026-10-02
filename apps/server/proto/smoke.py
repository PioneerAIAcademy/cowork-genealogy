#!/usr/bin/env python3
"""D3 acceptance: drive stub turns through queue -> shim -> worker -> Postgres. Zero model cost.

Run from the repo root; ``make proto-smoke`` brings the stack up and runs this from the
apps/server venv with the dummy ``GENEALOGY_SQS_*`` pair (elasticmq ignores the signature):

    make proto-smoke                              # every case in CASES
    make proto-smoke ARGS="--case ok"             # a subset
    make proto-smoke ARGS="--case past_ceiling"   # opt-in, ~31 min

``PROTO_COMPOSE`` names the compose command, as the Makefile's variable does (for
``docker-compose`` on a machine without the plugin); its ``-f`` files are ignored, since
each case names its own. Default ``docker compose``.

Cases (each sends one message and reads the shim's JSON decisions from
``docker compose logs shim``, matched by MessageId):

  ok       shim logs delete; turns.completed_at/outcome set; session_events has turn_done
  fail     shim logs requeue_backoff MAX_SMOKE_REDELIVERIES times with growing backoff_s;
           the worker's turns row shows receive_count >= 2; then the queue is purged
  crash    shim logs requeue with a connection error; the worker container's
           RestartCount rises; the redelivered turn completes on the fresh worker
  ceiling  shim recreated under docker-compose.ceiling.yml (READ_TIMEOUT_S=15); a
           sleep-60 turn -> requeue with error read_timeout and killed_worker true;
           the worker's StartedAt changes; the redelivered turn completes

U5's cases recreate shim and worker under docker-compose.sqsd.yml and restore the base
profile in a ``finally``. Postgres keeps old smoke leftovers on its volume, so each first
prints how many open, non-held turns lie outside its own session (the sweep's candidates):

  sigterm             ERROR_VISIBILITY_S=SIGTERM_ERROR_VISIBILITY_S; a sleep-120 turn, then
                      ``docker restart -t 30`` at 10 s -> the shim logs a 500
                      requeue_backoff (not a connection error), the worker logs
                      ev=shutdown, and the next receive completes ok
  dead_letter         SQSD_MAX_RETRIES=1, sweep off; a held row seeded on session S, then a
                      fail turn on S -> closed retries_exhausted (cause error) with a
                      turn_done, the message deleted rather than dead-lettered, and the
                      held row released and completed by its own ok body
  crash_last_receive  SQSD_MAX_RETRIES=1, SQSD_VISIBILITY_TIMEOUT_S=30, SWEEP_INTERVAL_S=10,
                      ERROR_VISIBILITY_S=CRASH_ERROR_VISIBILITY_S (the crash's connection
                      error waits it out under the overlay), the worker's QUEUE_URL empty
                      (a swept leftover can release nothing);
                      a crash turn -> the shim dead-letters receive 2 and the sweep closes
                      the turn retries_exhausted (cause sweep). The sweep acts on the whole
                      database: the stale ids it will close are printed first
  past_ceiling        opt-in, not in CASES: the overlay's production values; a sleep-1850
                      turn completes on receive 1 with no read_timeout

Each shim recreate (into and out of the ceiling override) blocks until the old shim
has drained: on SIGTERM it lets its in-flight long poll return (up to 20 s) before
exiting, so no poll is left open server-side to swallow the next message. The
ceiling case sends only after that ``compose up`` returns, and its ``finally``
purges the queue before swapping the base shim back so an interrupted run leaves
no invisible sleep turn behind to redeliver into a later run.

Prints a PASS/FAIL table; exit 1 on any FAIL, 2 when the stack is not up.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import shlex
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from enqueue import DEFAULT_ENDPOINT, DEFAULT_QUEUE, SqsError, purge_queue, queue_url, send_turn  # noqa: E402

COMPOSE = HERE / "docker-compose.yml"
CEILING = HERE / "docker-compose.ceiling.yml"
SQSD = HERE / "docker-compose.sqsd.yml"
DLQ = "turns-dlq"
MAX_SMOKE_REDELIVERIES = 3
CASES = ("ok", "fail", "crash", "ceiling", "sigterm", "dead_letter", "crash_last_receive")
OPT_IN_CASES = ("past_ceiling",)
# Above the worker's SHUTDOWN_GRACE_S (20) plus a restart, so the redelivery never meets
# the old process; test_proto_config.py pins it.
SIGTERM_ERROR_VISIBILITY_S = 45
# The overlay makes a refused or reset connection wait ERROR_VISIBILITY_S (300 by default);
# crash_last_receive lowers it so receive 2 comes inside the case's dead-letter wait.
CRASH_ERROR_VISIBILITY_S = 5
PAST_CEILING_SLEEP_S = 1850
# The overlay's shell-read variables. Dropped from the inherited environment for an
# overlay case, so its defaults (the production interim values) apply unless the case
# sets one.
SQSD_VARS = (
    "SQSD_MAX_RETRIES",
    "SQSD_VISIBILITY_TIMEOUT_S",
    "SQSD_RETENTION_PERIOD_S",
    "ERROR_VISIBILITY_S",
    "SWEEP_INTERVAL_S",
    "READ_TIMEOUT_S",
    "WORKER_QUEUE_URL",
)
RETRIES_EXHAUSTED = "retries_exhausted"

Check = tuple[str, bool, str]  # (name, passed, detail)


class Config:
    pg_dsn: str
    endpoint: str
    queue: str
    worker_container: str


def run(*args: str, check: bool = True, env: dict[str, str] | None = None) -> str:
    proc = subprocess.run(list(args), check=check, capture_output=True, text=True, encoding="utf-8", env=env)
    return proc.stdout


def compose_command(raw: str | None = None) -> list[str]:
    """``PROTO_COMPOSE`` without its ``-f``/``--file`` arguments, else ``docker compose``."""
    words = shlex.split(os.environ.get("PROTO_COMPOSE", "") if raw is None else raw)
    out: list[str] = []
    skip = False
    for w in words:
        if skip:
            skip = False
        elif w in ("-f", "--file"):
            skip = True
        elif not w.startswith("--file="):
            out.append(w)
    return out or ["docker", "compose"]


def compose(*args: str, files: tuple[Path, ...] = (COMPOSE,), env: dict[str, str] | None = None) -> str:
    cmd = compose_command()
    for f in files:
        cmd += ["-f", str(f)]
    return run(*cmd, *args, env=env)


def service_lines(service: str, ev: str) -> list[dict]:
    """One service's JSON log lines with this ``ev``, oldest first."""
    out: list[dict] = []
    for line in compose("logs", "--no-color", "--no-log-prefix", service).splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        if isinstance(rec, dict) and rec.get("ev") == ev:
            out.append(rec)
    return out


def shim_decisions(msgid: str) -> list[dict]:
    """The shim's ``post`` lines for one message, oldest first."""
    return [r for r in service_lines("shim", "post") if r.get("msgid") == msgid]


def shim_dead_letters(msgid: str) -> list[dict]:
    return [r for r in service_lines("shim", "dead_letter") if r.get("msgid") == msgid]


def worker_lines(ev: str, turn_id: str) -> list[dict]:
    """The worker's ``ev`` lines naming ``turn_id``: as ``turn_id``, or inside the
    ``answered`` (shutdown) / ``closed`` (sweep) lists."""
    return [
        r
        for r in service_lines("worker", ev)
        if r.get("turn_id") == turn_id or turn_id in (r.get("answered") or []) or turn_id in (r.get("closed") or [])
    ]


def wait_for(pred, timeout_s: float, every_s: float = 1.0):
    """Poll ``pred`` until it returns something truthy or ``timeout_s`` elapses."""
    deadline = time.monotonic() + timeout_s
    while True:
        value = pred()
        if value:
            return value
        if time.monotonic() >= deadline:
            return None
        time.sleep(every_s)


def inspect_worker(cfg: Config) -> tuple[int, str]:
    out = run("docker", "inspect", "-f", "{{.RestartCount}} {{.State.StartedAt}}", cfg.worker_container)
    restarts, started = out.split()
    return int(restarts), started


def db_one(cfg: Config, sql: str, params: tuple) -> tuple | None:
    with psycopg.connect(cfg.pg_dsn) as conn:
        return conn.execute(sql, params).fetchone()


def turn_row(cfg: Config, turn_id: str) -> tuple | None:
    return db_one(
        cfg,
        "SELECT claimed_at, completed_at, outcome, receive_count FROM turns WHERE turn_id = %s",
        (turn_id,),
    )


def turn_done_payload(cfg: Config, session_id: str, turn_id: str) -> dict | None:
    row = db_one(
        cfg,
        "SELECT payload FROM session_events WHERE session_id = %s AND kind = 'turn_done' "
        "AND payload->>'turn_id' = %s ORDER BY seq DESC LIMIT 1",
        (session_id, turn_id),
    )
    return row[0] if row else None


# The sweep's candidates on any configuration: open and not held (worker.py's sweep adds
# the fast / backstop age test on top).
OPEN_TURNS_SQL = (
    "SELECT turn_id FROM turns WHERE completed_at IS NULL AND outcome IS DISTINCT FROM 'queued' "
    "AND session_id <> %s ORDER BY enqueued_at"
)


def open_turns_elsewhere(cfg: Config, session_id: str) -> list[str]:
    with psycopg.connect(cfg.pg_dsn) as conn:
        return [r[0] for r in conn.execute(OPEN_TURNS_SQL, (session_id,)).fetchall()]


def announce_leftovers(cfg: Config, session_id: str) -> list[str]:
    ids = open_turns_elsewhere(cfg, session_id)
    print(f"   {len(ids)} open, non-held turns outside this case's session (sweep candidates)", flush=True)
    return ids


def sqsd_env(**overrides: str) -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if k not in SQSD_VARS}
    env.update(overrides)
    return env


@contextlib.contextmanager
def sqsd_profile(cfg: Config, **overrides: str):
    """Shim and worker recreated under the sqsd overlay; the base profile restored after,
    with the queues purged first so an interrupted case leaves nothing to redeliver."""
    if not SQSD.exists():
        raise FileNotFoundError(f"missing {SQSD}")
    try:
        # Inside the try: an `up` that recreates the containers and then fails its --wait
        # must still be restored.
        compose("up", "-d", "--wait", "worker", "shim", files=(COMPOSE, SQSD), env=sqsd_env(**overrides))
        yield
    finally:
        try:
            with contextlib.suppress(SqsError):
                purge_queue(endpoint=cfg.endpoint, queue=cfg.queue)
            with contextlib.suppress(SqsError):
                purge_queue(endpoint=cfg.endpoint, queue=DLQ)
        finally:
            compose("up", "-d", "--wait", "worker", "shim")


def new_session() -> str:
    return f"sess-{uuid.uuid4().hex[:8]}"


def fmt(decs: list[dict]) -> str:
    return "\n".join("    " + json.dumps(d, separators=(",", ":")) for d in decs)


def _if_enough(ds: list[dict], n: int) -> list[dict] | None:
    return ds if len(ds) >= n else None


def _if_deleted(ds: list[dict]) -> list[dict] | None:
    return ds if any(d["action"] == "delete" for d in ds) else None


# ---------------------------------------------------------------- cases


def case_ok(cfg: Config) -> tuple[list[Check], str]:
    t = send_turn(endpoint=cfg.endpoint, queue=cfg.queue, behaviour="ok")
    decs = wait_for(lambda: [d for d in shim_decisions(t["message_id"]) if d["action"] == "delete"], 60) or []
    row = turn_row(cfg, t["turn_id"])
    ev = db_one(
        cfg,
        "SELECT count(*) FROM session_events WHERE session_id = %s AND kind = 'turn_done'",
        (t["session_id"],),
    )
    checks: list[Check] = [
        ("shim logged delete", bool(decs), f"decisions={len(decs)}"),
        ("turns.completed_at set, outcome ok", bool(row and row[1] is not None and row[2] == "ok"), f"row={row}"),
        ("session_events has turn_done", bool(ev and ev[0] >= 1), f"count={ev[0] if ev else None}"),
    ]
    return checks, fmt(shim_decisions(t["message_id"]))


def case_fail(cfg: Config) -> tuple[list[Check], str]:
    t = send_turn(endpoint=cfg.endpoint, queue=cfg.queue, behaviour="fail")
    # Backoffs 5, 10, 20 s: the third decision lands ~15 s after the first.
    decs = wait_for(
        lambda: _if_enough(shim_decisions(t["message_id"]), MAX_SMOKE_REDELIVERIES), 120
    ) or shim_decisions(t["message_id"])
    purge_queue(endpoint=cfg.endpoint, queue=cfg.queue)
    row = turn_row(cfg, t["turn_id"])
    backoffs = [d.get("backoff_s") for d in decs]
    checks: list[Check] = [
        (
            f"redelivered >= {MAX_SMOKE_REDELIVERIES} times, all requeue_backoff",
            len(decs) >= MAX_SMOKE_REDELIVERIES and all(d["action"] == "requeue_backoff" for d in decs),
            f"actions={[d['action'] for d in decs]}",
        ),
        ("backoff_s grows per receive", len(backoffs) >= 2 and all(a < b for a, b in zip(backoffs, backoffs[1:])), f"backoffs={backoffs}"),
        ("worker turns.receive_count >= 2, not completed", bool(row and row[3] >= 2 and row[1] is None), f"row={row}"),
    ]
    return checks, fmt(decs)


def case_crash(cfg: Config) -> tuple[list[Check], str]:
    restarts0, _ = inspect_worker(cfg)
    t = send_turn(endpoint=cfg.endpoint, queue=cfg.queue, behaviour="crash")
    decs = wait_for(lambda: _if_deleted(shim_decisions(t["message_id"])), 120) or shim_decisions(t["message_id"])
    restarts1, _ = inspect_worker(cfg)
    row = turn_row(cfg, t["turn_id"])
    first = decs[0] if decs else {}
    checks: list[Check] = [
        (
            "first delivery: requeue on a connection error, no kill",
            first.get("action") == "requeue" and "error" in first and first.get("killed_worker") is False,
            f"first={json.dumps(first)}",
        ),
        ("worker container RestartCount rose", restarts1 > restarts0, f"{restarts0} -> {restarts1}"),
        ("redelivered turn completed on the fresh worker", bool(row and row[1] is not None and row[3] >= 2), f"row={row}"),
        ("shim logged delete", any(d["action"] == "delete" for d in decs), f"actions={[d['action'] for d in decs]}"),
    ]
    return checks, fmt(decs)


def case_ceiling(cfg: Config) -> tuple[list[Check], str]:
    if not CEILING.exists():
        return [("docker-compose.ceiling.yml present", False, f"missing {CEILING}")], ""
    compose("up", "-d", "--wait", "shim", files=(COMPOSE, CEILING))  # READ_TIMEOUT_S=15; blocks on the drain
    try:
        _, started0 = inspect_worker(cfg)
        t = send_turn(endpoint=cfg.endpoint, queue=cfg.queue, behaviour="sleep", seconds=60)
        decs = wait_for(lambda: _if_deleted(shim_decisions(t["message_id"])), 150) or shim_decisions(
            t["message_id"]
        )
        _, started1 = inspect_worker(cfg)
        row = turn_row(cfg, t["turn_id"])
        kills = [d for d in decs if d.get("error") == "read_timeout"]
        checks: list[Check] = [
            (
                "read timeout -> requeue with killed_worker true",
                bool(kills) and kills[0]["action"] == "requeue" and kills[0]["killed_worker"] is True,
                f"kill={json.dumps(kills[0]) if kills else None}",
            ),
            ("worker container StartedAt changed", started1 != started0, f"{started0} -> {started1}"),
            ("redelivered turn completed", bool(row and row[1] is not None and row[3] >= 2), f"row={row}"),
            ("shim logged delete", any(d["action"] == "delete" for d in decs), f"actions={[d['action'] for d in decs]}"),
        ]
        return checks, fmt(decs)
    finally:
        purge_queue(endpoint=cfg.endpoint, queue=cfg.queue)  # an interrupted case must not leave a sleep turn behind
        compose("up", "-d", "--wait", "shim")  # back to READ_TIMEOUT_S=1800


def case_sigterm(cfg: Config) -> tuple[list[Check], str]:
    session_id = new_session()
    announce_leftovers(cfg, session_id)
    with sqsd_profile(cfg, ERROR_VISIBILITY_S=str(SIGTERM_ERROR_VISIBILITY_S)):
        t0 = time.monotonic()
        t = send_turn(endpoint=cfg.endpoint, queue=cfg.queue, session_id=session_id, behaviour="sleep", seconds=120)
        claimed = wait_for(lambda: (turn_row(cfg, t["turn_id"]) or (None,))[0], 30)
        time.sleep(max(0.0, 10 - (time.monotonic() - t0)))
        run("docker", "restart", "-t", "30", cfg.worker_container)
        decs = wait_for(
            lambda: _if_deleted(shim_decisions(t["message_id"])), SIGTERM_ERROR_VISIBILITY_S + 120
        ) or shim_decisions(t["message_id"])
        shutdowns = worker_lines("shutdown", t["turn_id"])
        row = turn_row(cfg, t["turn_id"])
    first = decs[0] if decs else {}
    after = decs[1] if len(decs) > 1 else {}
    checks: list[Check] = [
        ("the sleep turn was claimed before the restart", bool(claimed), f"claimed_at={claimed}"),
        (
            "first delivery: a 500 requeue_backoff, not a connection error",
            first.get("status") == 500 and first.get("action") == "requeue_backoff" and "error" not in first,
            f"first={json.dumps(first)}",
        ),
        (
            f"backoff_s is ERROR_VISIBILITY_S ({SIGTERM_ERROR_VISIBILITY_S})",
            first.get("backoff_s") == SIGTERM_ERROR_VISIBILITY_S,
            f"backoff_s={first.get('backoff_s')}",
        ),
        ("worker logged ev=shutdown answering the turn", bool(shutdowns), f"shutdown={shutdowns}"),
        (
            "the next receive completed ok",
            after.get("action") == "delete" and bool(row and row[1] is not None and row[2] == "ok" and row[3] == 2),
            f"next={json.dumps(after)} row={row}",
        ),
    ]
    return checks, fmt(decs)


def seed_held_turn(cfg: Config, session_id: str) -> str:
    """A patron message held on ``session_id`` (outcome 'queued', never enqueued) whose
    body is an ``ok`` stub, so its release is visible as its own completion."""
    turn_id = f"turn-held-{uuid.uuid4().hex[:8]}"
    body = {
        "turn_id": turn_id,
        "session_id": session_id,
        "project_id": "proj-smoke",
        "behaviour": "ok",
        "seconds": 0,
        "enqueued_at": datetime.now(tz=timezone.utc).isoformat(),
    }
    with psycopg.connect(cfg.pg_dsn) as conn:
        conn.execute(
            "INSERT INTO turns (turn_id, session_id, project_id, message, outcome) VALUES (%s, %s, %s, %s, 'queued')",
            (turn_id, session_id, "proj-smoke", Jsonb(body)),
        )
    return turn_id


def case_dead_letter(cfg: Config) -> tuple[list[Check], str]:
    session_id = new_session()
    announce_leftovers(cfg, session_id)
    with sqsd_profile(cfg, SQSD_MAX_RETRIES="1", SWEEP_INTERVAL_S="0"):
        held_id = seed_held_turn(cfg, session_id)
        t = send_turn(endpoint=cfg.endpoint, queue=cfg.queue, session_id=session_id, behaviour="fail")
        decs = wait_for(lambda: _if_deleted(shim_decisions(t["message_id"])), 60) or shim_decisions(t["message_id"])
        held = wait_for(
            lambda: (r := turn_row(cfg, held_id)) and r[1] is not None and r, 90
        ) or turn_row(cfg, held_id)
        row = turn_row(cfg, t["turn_id"])
        closes = worker_lines("close", t["turn_id"])
        done = turn_done_payload(cfg, session_id, t["turn_id"])
        dead = shim_dead_letters(t["message_id"])
    close = closes[0] if closes else {}
    checks: list[Check] = [
        (
            "closed retries_exhausted on its last receive",
            bool(row and row[1] is not None and row[2] == RETRIES_EXHAUSTED and row[3] == 1),
            f"row={row}",
        ),
        (
            "worker logged ev=close, cause error",
            close.get("outcome") == RETRIES_EXHAUSTED and close.get("cause") == "error",
            f"close={closes}",
        ),
        (
            "turn_done carries retries_exhausted, cause error",
            bool(done and done.get("outcome") == RETRIES_EXHAUSTED and done.get("cause") == "error"),
            f"payload={done}",
        ),
        (
            "the message was deleted, not dead-lettered",
            [d["action"] for d in decs] == ["delete"] and not dead,
            f"actions={[d['action'] for d in decs]} dead_letter={dead}",
        ),
        (
            "the held row was released and completed by its own ok body",
            bool(held and held[1] is not None and held[2] == "ok" and held[3] >= 1),
            f"held={held}",
        ),
    ]
    return checks, fmt(decs)


def case_crash_last_receive(cfg: Config) -> tuple[list[Check], str]:
    session_id = new_session()
    stale = announce_leftovers(cfg, session_id)
    if stale:
        print(f"   the sweep will also close these stale turns: {' '.join(stale)}", flush=True)
    with sqsd_profile(
        cfg,
        SQSD_MAX_RETRIES="1",
        SQSD_VISIBILITY_TIMEOUT_S="30",
        ERROR_VISIBILITY_S=str(CRASH_ERROR_VISIBILITY_S),
        SWEEP_INTERVAL_S="10",
        WORKER_QUEUE_URL="",
    ):
        restarts0, _ = inspect_worker(cfg)  # after the recreate, which resets RestartCount
        t = send_turn(endpoint=cfg.endpoint, queue=cfg.queue, session_id=session_id, behaviour="crash")
        dead = wait_for(lambda: shim_dead_letters(t["message_id"]), 60) or []
        row = wait_for(lambda: (r := turn_row(cfg, t["turn_id"])) and r[1] is not None and r, 180) or turn_row(
            cfg, t["turn_id"]
        )
        sweeps = worker_lines("sweep", t["turn_id"])
        closes = worker_lines("close", t["turn_id"])
        done = turn_done_payload(cfg, session_id, t["turn_id"])
        decs = shim_decisions(t["message_id"])
        restarts1, _ = inspect_worker(cfg)
    close = closes[0] if closes else {}
    checks: list[Check] = [
        ("receive 1 crashed the worker", restarts1 > restarts0, f"RestartCount {restarts0} -> {restarts1}"),
        (
            "shim logged ev=dead_letter on receive 2",
            bool(dead) and dead[0].get("receive_count") == 2,
            f"dead_letter={dead}",
        ),
        (
            "the sweep closed the turn retries_exhausted",
            bool(row and row[1] is not None and row[2] == RETRIES_EXHAUSTED),
            f"row={row}",
        ),
        ("worker logged ev=sweep naming the turn", bool(sweeps), f"sweep={sweeps}"),
        (
            "ev=close and turn_done carry cause sweep",
            close.get("cause") == "sweep" and bool(done and done.get("cause") == "sweep"),
            f"close={closes} payload={done}",
        ),
    ]
    return checks, fmt(decs + dead)


def case_past_ceiling(cfg: Config) -> tuple[list[Check], str]:
    session_id = new_session()
    announce_leftovers(cfg, session_id)
    with sqsd_profile(cfg):
        t = send_turn(
            endpoint=cfg.endpoint, queue=cfg.queue, session_id=session_id, behaviour="sleep", seconds=PAST_CEILING_SLEEP_S
        )
        decs = wait_for(
            lambda: _if_deleted(shim_decisions(t["message_id"])), PAST_CEILING_SLEEP_S + 300, every_s=15
        ) or shim_decisions(t["message_id"])
        row = turn_row(cfg, t["turn_id"])
    checks: list[Check] = [
        (
            f"a {PAST_CEILING_SLEEP_S} s turn completed on receive 1",
            [d["action"] for d in decs] == ["delete"] and bool(row and row[1] is not None and row[3] == 1),
            f"actions={[d['action'] for d in decs]} row={row}",
        ),
        ("no read_timeout", not any(d.get("error") == "read_timeout" for d in decs), f"decisions={decs}"),
    ]
    return checks, fmt(decs)


RUNNERS = {
    "ok": case_ok,
    "fail": case_fail,
    "crash": case_crash,
    "ceiling": case_ceiling,
    "sigterm": case_sigterm,
    "dead_letter": case_dead_letter,
    "crash_last_receive": case_crash_last_receive,
    "past_ceiling": case_past_ceiling,
}


# ---------------------------------------------------------------- main


def preflight(cfg: Config) -> str | None:
    try:
        inspect_worker(cfg)
    except (subprocess.CalledProcessError, ValueError) as exc:
        return f"worker container {cfg.worker_container!r} not found: {exc}"
    try:
        queue_url(cfg.endpoint, cfg.queue)
    except SqsError as exc:
        return str(exc)
    try:
        queue_url(cfg.endpoint, DLQ)
    except SqsError as exc:
        recreate = shlex.join([*compose_command(), "-f", str(COMPOSE), "up", "-d", "--force-recreate", "elasticmq"])
        return f"{exc}; elasticmq predates {DLQ} (it reads its conf only at start) -- run `{recreate}`"
    try:
        db_one(cfg, "SELECT 1", ())
    except psycopg.Error as exc:
        return f"postgres {cfg.pg_dsn.split('@')[-1]}: {exc}"
    return None


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument(
        "--case",
        action="append",
        choices=CASES + OPT_IN_CASES,
        help="run only this case (repeatable); past_ceiling runs only when named",
    )
    p.add_argument("--pg-dsn", default="postgresql://postgres:proto@localhost:5434/proto")
    p.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
    p.add_argument("--queue", default=DEFAULT_QUEUE)
    p.add_argument("--worker-container", default="proto-worker")
    args = p.parse_args(argv)

    cfg = Config()
    cfg.pg_dsn, cfg.endpoint, cfg.queue, cfg.worker_container = (
        args.pg_dsn,
        args.endpoint,
        args.queue,
        args.worker_container,
    )
    problem = preflight(cfg)
    if problem:
        print(f"stack not up ({problem}); run `make proto-up` first", file=sys.stderr)
        return 2

    results: list[tuple[str, Check]] = []
    for name in args.case or CASES:
        print(f"== {name}", flush=True)
        t0 = time.monotonic()
        try:
            checks, decisions = RUNNERS[name](cfg)
        except Exception as exc:  # a crashed case is a FAIL, not an aborted run
            checks, decisions = [("case ran", False, f"{type(exc).__name__}: {exc}")], ""
        print(f"   {time.monotonic() - t0:.0f}s")
        if decisions:
            print(decisions)
        results.extend((name, c) for c in checks)

    width = max(len(c[0]) for _, c in results)
    cw = max(8, *(len(n) for n, _ in results))
    print()
    print(f"{'CASE':{cw}} {'CHECK':{width}} RESULT")
    failed = 0
    for name, (check, ok, detail) in results:
        failed += not ok
        print(f"{name:{cw}} {check:{width}} {'PASS' if ok else 'FAIL'}  {'' if ok else detail}")
    print()
    print(f"{len(results) - failed}/{len(results)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

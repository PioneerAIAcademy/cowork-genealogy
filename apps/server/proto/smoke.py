#!/usr/bin/env python3
"""D3 acceptance: drive four turns through queue -> shim -> worker -> Postgres. Zero model cost.

Run from the apps/server venv against a running stack (``make proto-up``):

    uv run python proto/smoke.py            # all four cases
    uv run python proto/smoke.py --case ok  # a subset

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
import json
import subprocess
import sys
import time
from pathlib import Path

import psycopg

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from enqueue import DEFAULT_ENDPOINT, DEFAULT_QUEUE, SqsError, purge_queue, queue_url, send_turn  # noqa: E402

COMPOSE = HERE / "docker-compose.yml"
CEILING = HERE / "docker-compose.ceiling.yml"
MAX_SMOKE_REDELIVERIES = 3
CASES = ("ok", "fail", "crash", "ceiling")

Check = tuple[str, bool, str]  # (name, passed, detail)


class Config:
    pg_dsn: str
    endpoint: str
    queue: str
    worker_container: str


def run(*args: str, check: bool = True) -> str:
    proc = subprocess.run(list(args), check=check, capture_output=True, text=True, encoding="utf-8")
    return proc.stdout


def compose(*args: str, files: tuple[Path, ...] = (COMPOSE,)) -> str:
    cmd = ["docker", "compose"]
    for f in files:
        cmd += ["-f", str(f)]
    return run(*cmd, *args)


def shim_decisions(msgid: str) -> list[dict]:
    """The shim's ``post`` lines for one message, oldest first."""
    out: list[dict] = []
    for line in compose("logs", "--no-color", "--no-log-prefix", "shim").splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        if rec.get("ev") == "post" and rec.get("msgid") == msgid:
            out.append(rec)
    return out


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


RUNNERS = {"ok": case_ok, "fail": case_fail, "crash": case_crash, "ceiling": case_ceiling}


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
        db_one(cfg, "SELECT 1", ())
    except psycopg.Error as exc:
        return f"postgres {cfg.pg_dsn.split('@')[-1]}: {exc}"
    return None


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--case", action="append", choices=CASES, help="run only this case (repeatable)")
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
    print()
    print(f"{'CASE':8} {'CHECK':{width}} RESULT")
    failed = 0
    for name, (check, ok, detail) in results:
        failed += not ok
        print(f"{name:8} {check:{width}} {'PASS' if ok else 'FAIL'}  {'' if ok else detail}")
    print()
    print(f"{len(results) - failed}/{len(results)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

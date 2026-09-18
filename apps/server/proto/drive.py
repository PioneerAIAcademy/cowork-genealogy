#!/usr/bin/env python3
"""D13 headless driver: post a turn, stream it, drop the connection mid-turn, reconnect
with Last-Event-ID, miss nothing. Zero model cost.

    uv run --group proto python proto/drive.py --embedded-pg        # self-contained
    uv run python proto/drive.py --base http://localhost:8085 \\
        --pg-dsn postgresql://postgres:proto@localhost:5434/proto     # a running stack
    uv run python proto/drive.py --base ... --pg-dsn ... --worker      # D17: a real worker

Two things stand in for the worker until D9-10 lands. In the default ``--seed`` mode a
thread inserts the rows the worker will write -- ~40 ``session_events`` through
``next_session_seq``, a few ``session_activity`` updates, one ``documents`` upsert, a
``turn_done`` -- pausing past the ping interval once so a ``: ping`` is observable.
``--embedded-pg`` starts a pip-installed PostgreSQL (pgserver), applies ``sql/*.sql`` and
runs the web tier in-process with no queue, so the acceptance runs on a machine with
neither Docker nor Postgres. ``--worker`` runs no seeder and stops on the worker's
``turn_done`` for our ``turn_id``.

``--seed`` is refused when the tier reports a live queue (``/api/health`` ``queue`` is not
``NullQueue``) unless ``--allow-live-queue``: on a compose stack the D3 stub worker
completes the enqueued turn within milliseconds, which races the seeder for the
``turn_active`` frame and shows the SPA idle while rows are still being inserted. A stack
with a worker is what ``--worker`` is for -- the stub is a worker.

Every stream read has a wall-clock deadline (a ``: ping`` every 15 s would otherwise
reset httpx's read timeout forever), so a missing stop condition is a FAIL, not a hang.

Checks (PASS/FAIL table, exit 1 on any FAIL, 2 when the tier is unreachable):

  - every event frame carries ``id:`` equal to its data ``seq``, strictly increasing
  - stream A carried ``status turn_active`` after its catch-up rows (a turn is in flight;
    a replayed ``turn_done`` must never land after it, or the UI shows idle mid-turn)
  - stream A was cut after CUT_AFTER frames; stream B, opened with ``Last-Event-ID`` (and a
    contradicting ``?after=0``), started at exactly A's last seq + 1
  - A and B are disjoint, and A ∪ B equals ``GET /events?after=0`` -- dense from 1, same data
  - at least one ``: ping`` comment, one activity frame and one ``research_updated``
    frame arrived, none with an id
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import socket
import sys
import tempfile
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
import psycopg
from psycopg.types.json import Jsonb

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

CUT_AFTER = 8  # id-frames stream A reads before the connection is dropped
SEED_EVENTS = 40
SEED_GAP_S = 0.1
DRAIN_S = 15.0
STREAM_DEADLINE_S = 120.0  # the seeder takes ~25 s (ping pause included); a real worker turn, minutes
DEFAULT_TEXT = "Let's start a new genealogy research project."


def _load_worker_complete():
    """``complete()`` from proto/worker/worker.py -- the turn_done event and the turns
    row close in ONE commit, exactly as the worker does it. Loaded by path so the
    ``worker`` name cannot resolve to the proto/worker/ directory as a namespace package."""
    import importlib.util

    spec = importlib.util.spec_from_file_location("proto_worker", HERE / "worker" / "worker.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.complete

Check = tuple[str, bool, str]


# ── SSE client (hand-rolled: no library exposes comment lines) ───────────────────


@dataclass
class Frame:
    id: int | None = None
    data: dict[str, Any] | None = None
    comment: str | None = None
    retry: int | None = None


def parse_frame(raw: str) -> Frame:
    frame = Frame()
    for line in raw.split("\n"):
        if line.startswith(":"):
            frame.comment = line[1:].strip()
        elif line.startswith("id:"):
            frame.id = int(line[3:].strip())
        elif line.startswith("data:"):
            frame.data = json.loads(line[5:].strip())
        elif line.startswith("retry:"):
            frame.retry = int(line[6:].strip())
    return frame


@dataclass
class StreamLog:
    name: str
    ids: list[int] = field(default_factory=list)
    data_by_seq: dict[int, dict[str, Any]] = field(default_factory=dict)
    unkeyed: list[dict[str, Any]] = field(default_factory=list)  # frames with no id
    pings: int = 0
    order: list[int | str] = field(default_factory=list)  # seq for id-frames, the wire type otherwise


def stream(client: httpx.Client, url: str, headers: dict[str, str], log: StreamLog, stop,
           deadline_s: float = STREAM_DEADLINE_S) -> None:
    """Read frames into ``log`` until ``stop(log)`` is true, then leave the ``with`` block
    without draining the body -- httpx closes the connection, which is the drop. Raises
    TimeoutError at ``deadline_s``: the tier's ping resets the read timeout, so without a
    wall clock a stop condition that never comes would hang the driver."""
    deadline = time.monotonic() + deadline_s
    with client.stream("GET", url, headers={"Accept": "text/event-stream", **headers},
                       timeout=httpx.Timeout(10.0, read=DRAIN_S + 5)) as resp:
        resp.raise_for_status()
        buf = ""
        for chunk in resp.iter_text():
            if time.monotonic() > deadline:
                raise TimeoutError(f"stream {log.name}: stop condition not met within {deadline_s:.0f}s ({len(log.ids)} id-frames)")
            buf += chunk
            while "\n\n" in buf:
                raw, buf = buf.split("\n\n", 1)
                if not raw.strip():
                    continue
                frame = parse_frame(raw)
                if frame.comment is not None:
                    log.pings += frame.comment == "ping"
                elif frame.data is not None:
                    if frame.id is not None:
                        log.ids.append(frame.id)
                        log.data_by_seq[frame.id] = frame.data
                        log.order.append(frame.id)
                    else:
                        log.unkeyed.append(frame.data)
                        state = frame.data.get("state")
                        log.order.append(f"{frame.data.get('type')}:{state}" if state else str(frame.data.get("type")))
                if stop(log):
                    return


# ── the stand-in worker ──────────────────────────────────────────────────────────


class Seeder(threading.Thread):
    """Inserts the rows the worker will write. ``ping_s`` sizes the one pause."""

    def __init__(self, dsn: str, session_id: str, project_id: str, turn_id: str, ping_s: float) -> None:
        super().__init__(daemon=True)
        self.dsn, self.session_id, self.project_id, self.turn_id, self.ping_s = dsn, session_id, project_id, turn_id, ping_s
        self.last_seq = 0
        self.error: str | None = None

    def run(self) -> None:
        try:
            with psycopg.connect(self.dsn) as conn:
                self._run(conn)
        except Exception as exc:  # surfaced as a FAIL, never a hang
            self.error = f"{type(exc).__name__}: {exc}"

    def _run(self, conn: psycopg.Connection) -> None:
        def event(kind: str, payload: dict[str, Any]) -> None:
            seq = conn.execute("SELECT next_session_seq(%s)", (self.session_id,)).fetchone()[0]
            conn.execute(
                "INSERT INTO session_events (session_id, seq, kind, payload) VALUES (%s, %s, %s, %s)",
                (self.session_id, seq, kind, Jsonb(payload)),
            )
            conn.commit()
            self.last_seq = seq

        def activity(payload: dict[str, Any]) -> None:
            conn.execute(
                "INSERT INTO session_activity (session_id, payload, updated_at) VALUES (%s, %s, now()) "
                "ON CONFLICT (session_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()",
                (self.session_id, Jsonb(payload)),
            )
            conn.commit()

        def document(name: str, version: int, doc: dict[str, Any]) -> None:
            conn.execute(
                "INSERT INTO documents (project_id, name, version, doc) VALUES (%s, %s, %s, %s) "
                "ON CONFLICT (project_id, name) DO UPDATE SET version = EXCLUDED.version, doc = EXCLUDED.doc, updated_at = now()",
                (self.project_id, name, version, Jsonb(doc)),
            )
            conn.commit()

        script = [("text", {"text": "Starting the search."}), ("task_started", {"agent": "record-extractor", "task_id": "t1"})]
        for i in range(SEED_EVENTS - 3):
            kind = ("tool_use", "tool_result", "thinking", "text")[i % 4]
            script.append((kind, {"tool": "record_search", "summary": f"seed {i}", "agent": "record-extractor", "text": f"seed {i}"}))
        script.append(("task_done", {"agent": "record-extractor", "task_id": "t1", "status": "completed", "summary": "done"}))
        for i, (kind, payload) in enumerate(script):
            event(kind, payload)
            if i % 10 == 9:
                activity({"agent": "record-extractor", "last_tool": "record_read", "tool_uses": i, "task_id": "t1"})
            if i == 9:
                document("research.json", 1, {"project": {"title": "Seeded project", "objective": "prove the stream"}})
                time.sleep(self.ping_s + 2.0)  # past the ping interval: a `: ping` must appear
            time.sleep(SEED_GAP_S)
        # The worker's own close: turn_done event + turns.completed_at in one commit. Two
        # commits would open a window where a stream replays turn_done and then announces
        # turn_active, leaving ChatPane busy with nothing left to clear it.
        self.last_seq = _load_worker_complete()(conn, {"turn_id": self.turn_id, "session_id": self.session_id}, 0)


# ── embedded mode ───────────────────────────────────────────────────────────────


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Embedded:
    """pgserver + the web tier in-process on a free port, NullQueue."""

    def __init__(self) -> None:
        try:
            import pgserver
        except ImportError:
            sys.exit("pgserver is not installed: run with `uv run --group proto` (see pyproject [dependency-groups] proto)")
        self.pgdata = tempfile.mkdtemp(prefix="proto-drive-pg-")
        self.pg = pgserver.get_server(self.pgdata)
        self.dsn = self.pg.get_uri()
        os.environ["PG_DSN"] = self.dsn
        os.environ.pop("QUEUE_URL", None)
        import uvicorn

        from web.app import create_app

        port = free_port()
        self.base = f"http://127.0.0.1:{port}"
        self.server = uvicorn.Server(uvicorn.Config(create_app(), host="127.0.0.1", port=port, log_level="warning", loop="none"))

        def _serve() -> None:
            # uvicorn picks ProactorEventLoop on Windows and psycopg3 async refuses it;
            # loop="none" hands the loop choice back to us.
            asyncio.run(self.server.serve(), loop_factory=asyncio.SelectorEventLoop if sys.platform == "win32" else None)

        threading.Thread(target=_serve, daemon=True).start()
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            try:
                if httpx.get(self.base + "/api/health", timeout=1).status_code == 200:
                    return
            except httpx.HTTPError:
                time.sleep(0.2)
        sys.exit("embedded web tier did not come up")

    def close(self) -> None:
        self.server.should_exit = True
        self.pg.cleanup()


# ── the acceptance ───────────────────────────────────────────────────────────────


def _turn_done_for(turn_id: str, frames) -> bool:
    return any(d.get("type") == "agent_event" and d["event"].get("kind") == "turn_done"
               and d["event"].get("turn_id") == turn_id for d in frames)


def run(base: str, dsn: str | None, mode: str, text: str, deadline_s: float = STREAM_DEADLINE_S) -> list[Check]:
    checks: list[Check] = []
    client = httpx.Client(base_url=base, timeout=10.0)
    health = client.get("/api/health").json()
    ping_s = float(health.get("ping_s", 15.0))

    session = client.post("/api/sessions", json={"title": "drive.py"}).json()
    sid, pid = session["id"], None
    # project_id is not on the SPA shape; read it from the store for the seeder.
    if dsn:
        with psycopg.connect(dsn) as conn:
            pid = conn.execute("SELECT project_id FROM sessions WHERE session_id = %s", (sid,)).fetchone()[0]
    posted = client.post(f"/api/sessions/{sid}/messages", json={"text": text})
    checks.append(("POST /messages -> 202 with a turn_id and seq", posted.status_code == 202, f"{posted.status_code} {posted.text[:200]}"))
    if posted.status_code != 202:
        return checks
    turn_id, user_seq = posted.json()["turn_id"], posted.json()["seq"]
    print(f"   session {sid} turn {turn_id} user_msg seq {user_seq}", flush=True)

    seeder: Seeder | None = None
    if mode == "seed":
        assert dsn and pid
        seeder = Seeder(dsn, sid, pid, turn_id, ping_s)
        seeder.start()

    def seeder_failed() -> bool:
        return seeder is not None and not seeder.is_alive() and seeder.error is not None

    a, b = StreamLog("A"), StreamLog("B")

    def all_frames():
        return {**a.data_by_seq, **b.data_by_seq}

    def turn_complete() -> bool:
        if mode == "worker":
            return _turn_done_for(turn_id, all_frames().values())
        return seeder is not None and not seeder.is_alive()

    # Stream A: read CUT_AFTER id-frames, then drop the connection. A short turn (a real
    # worker's, or the stub's single turn_done) ends A early instead of hanging it.
    t0 = time.monotonic()
    try:
        stream(client, f"/api/sessions/{sid}/events/stream?after=0", {}, a,
               lambda log: len(log.ids) >= CUT_AFTER or _turn_done_for(turn_id, log.data_by_seq.values()) or seeder_failed(),
               deadline_s=deadline_s)
    except (TimeoutError, httpx.HTTPError) as exc:
        checks.append(("stream A read to its stop condition", False, f"{type(exc).__name__}: {exc}"))
        return checks
    print(f"   A: {len(a.ids)} frames in {time.monotonic() - t0:.1f}s, cut after seq {a.ids[-1] if a.ids else None}", flush=True)
    a_last = a.ids[-1] if a.ids else 0

    # Stream B: resume on Last-Event-ID (the query says 0 on purpose -- the header must win).
    # Stops once the turn is complete and A∪B holds everything GET can see -- which may be
    # nothing new at all, if A already read a short turn to its end.
    def caught_up(log: StreamLog) -> bool:
        if seeder_failed():
            return True
        if not turn_complete():
            return False
        latest = client.get(f"/api/sessions/{sid}/events?after=0").json()["next_after"]
        return max(set(a.ids) | set(log.ids), default=0) >= latest

    t0 = time.monotonic()
    try:
        stream(client, f"/api/sessions/{sid}/events/stream?after=0", {"Last-Event-ID": str(a_last)}, b, caught_up,
               deadline_s=deadline_s)
    except (TimeoutError, httpx.HTTPError) as exc:
        checks.append(("stream B read to its stop condition", False, f"{type(exc).__name__}: {exc}"))
        return checks
    print(f"   B: {len(b.ids)} frames in {time.monotonic() - t0:.1f}s, first seq {b.ids[0] if b.ids else None}, "
          f"pings A/B {a.pings}/{b.pings}", flush=True)
    if seeder is not None:
        seeder.join(timeout=5)
        checks.append(("seeder inserted its rows", seeder.error is None and seeder.last_seq > 0, seeder.error or f"last_seq={seeder.last_seq}"))

    truth = client.get(f"/api/sessions/{sid}/events?after=0").json()
    truth_by_seq = {e["seq"]: e for e in truth["events"]}
    n = truth["next_after"]
    union = set(a.ids) | set(b.ids)

    def increasing(ids: list[int]) -> bool:
        return all(x < y for x, y in zip(ids, ids[1:]))

    status_at = a.order.index("status:turn_active") if "status:turn_active" in a.order else None
    catch_up = [i for i, x in enumerate(a.order) if isinstance(x, int) and x <= user_seq]
    short_turn = len(a.ids) < CUT_AFTER and _turn_done_for(turn_id, a.data_by_seq.values())
    checks += [
        # Decided from `mode`, never from a pre-read of turn_active: the stub's turn can
        # finish between such a read and the stream opening, and the check would then
        # assert the wrong branch. In seed mode the turn runs ~25 s, so the strong
        # assertion binds there.
        ("A: status turn_active arrived, after the catch-up rows" if mode == "seed"
         else "A: any turn_active status came after the catch-up rows (a stub turn can finish first)",
         all(i < status_at for i in catch_up) if status_at is not None else mode != "seed",
         f"order={a.order[:6]}"),
        (f"A: cut after {CUT_AFTER} id-frames, ids strictly increasing" if not short_turn
         else f"A: the turn ended after {len(a.ids)} id-frames, ids strictly increasing",
         (len(a.ids) == CUT_AFTER or short_turn) and increasing(a.ids), f"ids={a.ids}"),
        ("every id equals its data seq", all(a.data_by_seq[i]["seq"] == i for i in a.ids) and all(b.data_by_seq[i]["seq"] == i for i in b.ids), ""),
        # Against the D3 stub the whole turn is two events and ends inside A, so B has
        # nothing to resume: that mode proves the tier, not the resume. Say so rather
        # than relax the check; a real worker's long turn brings the strong form back.
        ("B: resumed at A's last seq + 1 (header beat ?after=0)" if not short_turn
         else "B: resume not exercised — the turn ended inside A (--embedded-pg is the resume check)",
         (bool(b.ids) and b.ids[0] == a_last + 1) if not short_turn else True,
         f"first={b.ids[:1]} expected {a_last + 1}"),
        ("B: ids strictly increasing", increasing(b.ids), f"ids={b.ids[:5]}..."),
        ("A ∩ B is empty", not (set(a.ids) & set(b.ids)), f"overlap={sorted(set(a.ids) & set(b.ids))}"),
        (f"A ∪ B == GET /events, dense 1..{n}", union == set(truth_by_seq) == set(range(1, n + 1)) and n >= 2,
         f"missing={sorted(set(truth_by_seq) - union)} extra={sorted(union - set(truth_by_seq))} n={n}"),
        ("streamed data equals GET data for every seq",
         all(({**a.data_by_seq, **b.data_by_seq}.get(s)) == e for s, e in truth_by_seq.items()), ""),
        ("user_msg at seq 1 carries our turn_id", truth_by_seq.get(1, {}).get("type") == "user_msg" and truth_by_seq[1].get("turn_id") == turn_id, f"{truth_by_seq.get(1)}"),
        ("turn_done for our turn_id arrived", any(e.get("type") == "agent_event" and e["event"].get("kind") == "turn_done"
                                                  and e["event"].get("turn_id") == turn_id for e in truth_by_seq.values()), ""),
        ("GET /events?after=N is empty and next_after == N", client.get(f"/api/sessions/{sid}/events?after={n}").json() | {"activity": None}
         == {"events": [], "activity": None, "turn_active": truth["turn_active"], "next_after": n}, ""),
        ("turn closed: turn_active is false once turn_done landed", truth["turn_active"] is False, f"turn_active={truth['turn_active']}"),
    ]
    unkeyed = a.unkeyed + b.unkeyed
    if mode == "seed":
        checks += [
            ("≥ 1 `: ping` comment", a.pings + b.pings >= 1, f"A={a.pings} B={b.pings}"),
            ("≥ 1 activity frame without an id", any(d.get("type") == "agent_event" and d["event"].get("kind") == "task_progress" for d in unkeyed), ""),
            ("≥ 1 research_updated frame without an id", any(d.get("type") == "research_updated" for d in unkeyed), ""),
        ]
    return checks


def main(argv: list[str] | None = None) -> int:
    # The house pattern: a Windows console defaults to cp1252 and dies on the set glyphs
    # in the check names; the team this runs for is on Windows (test_encoding_lint.py).
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--base", default=os.environ.get("PROTO_WEB_BASE", "http://localhost:8085"))
    p.add_argument("--pg-dsn", default=os.environ.get("PG_DSN"), help="needed for --seed (the default mode)")
    p.add_argument("--embedded-pg", action="store_true", help="pgserver + the tier in-process; ignores --base/--pg-dsn")
    p.add_argument("--worker", action="store_true", help="a worker answers the turn (the D3 stub counts); no seeder")
    p.add_argument("--allow-live-queue", action="store_true", help="run --seed even though the tier has a live queue")
    p.add_argument("--text", default=DEFAULT_TEXT)
    p.add_argument("--deadline-s", type=float, default=STREAM_DEADLINE_S, help="per-stream wall clock before a FAIL")
    args = p.parse_args(argv)
    mode = "worker" if args.worker else "seed"

    embedded = Embedded() if args.embedded_pg else None
    base, dsn = (embedded.base, embedded.dsn) if embedded else (args.base, args.pg_dsn)
    if mode == "seed" and not dsn:
        print("--seed needs --pg-dsn (or --embedded-pg)", file=sys.stderr)
        return 2
    try:
        try:
            httpx.get(base + "/api/health", timeout=3).raise_for_status()
        except httpx.HTTPError as exc:
            print(f"web tier not reachable at {base} ({exc}); run `make proto-up` or `make proto-web`", file=sys.stderr)
            return 2
        queue = httpx.get(base + "/api/health", timeout=3).json().get("queue")
        if mode == "seed" and queue != "NullQueue" and not args.allow_live_queue:
            print(f"the tier at {base} has a live queue ({queue}); a worker will race the seeder. "
                  "Use --worker on a stack with a worker, or --allow-live-queue to seed anyway.", file=sys.stderr)
            return 2
        print(f"== drive {mode} against {base} (queue: {queue})", flush=True)
        checks = run(base, dsn, mode, args.text, deadline_s=args.deadline_s)
    finally:
        if embedded:
            embedded.close()

    width = max(len(c[0]) for c in checks)
    print()
    for name, ok, detail in checks:
        print(f"{name:{width}} {'PASS' if ok else 'FAIL'}  {'' if ok else detail}")
    failed = sum(not ok for _, ok, _ in checks)
    print(f"\n{len(checks) - failed}/{len(checks)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

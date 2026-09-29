#!/usr/bin/env python3
"""D18: copy a session's project out of the prototype's Postgres/S3 store into files a
person -- or the e2e judge -- can read. The mirror image of ``seed.py``.

    uv run python proto/export.py --session <id> [--out apps/server/proto/exports]
                                  [--pg-dsn ...] [--s3-endpoint ...]

The session's ``project_id`` is resolved in Postgres, then ``dev/export-project.ts`` opens
``PgS3ProjectStore`` on it and writes ``research.json``, ``tree.gedcomx.json`` and every
file under ``results/`` and ``images/`` to ``<out>/<project_id>/`` with the refs as paths,
one line per file and the total. Exit 0; 1 when the export fails; 2 when the session is
unknown or Postgres is unreachable.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[3]
ENGINE_DIR = ROOT / "packages" / "engine" / "mcp-server"
DEFAULT_OUT = ROOT / "apps" / "server" / "proto" / "exports"
ANCHOR = "/project"


def manifest(project_id: str, out_dir: Path, *, anchor: str = ANCHOR) -> dict:
    """What ``dev/export-project.ts`` reads on stdin."""
    return {"projectId": project_id, "anchorPath": anchor, "outDir": str(out_dir)}


def export_dir(out_dir: Path, project_id: str) -> Path:
    """Where the TS side lands the files: ``<out>/<project_id>/<ref>``."""
    return out_dir / project_id


def resolve_project(dsn: str, session_id: str) -> str | None:
    """The session's project id, or None for a session no row names."""
    with psycopg.connect(dsn) as conn:
        row = conn.execute("SELECT project_id FROM sessions WHERE session_id = %s", (session_id,)).fetchone()
    return str(row[0]) if row and row[0] else None


def feed_path(out_dir: Path, project_id: str) -> Path:
    """Where the feed lands: beside the exported project, not inside its ref tree."""
    return out_dir / project_id / "feed.json"


def feed_payload(
    session_id: str, project_id: str, *, events: list[dict], turns: list[dict]
) -> dict:
    """What the hosted reader actually saw, as a plain document.

    `export()` copies the project's DOCUMENTS; the feed lives in two tables it never
    reads -- `session_events` (the per-session feed) and `turns` (which carries
    `outcome`, i.e. how each turn ended). Without this, no committed run can show what
    reached a reader, which is what "capture a real feed" is blocked on.

    Sorted by `seq`, because a feed read back out of order is not the feed anyone saw.
    Sorted into a NEW list: the caller passes a cursor's rows, and sorting in place
    would reorder a sequence something else may still be reading.

    An empty feed is reported as empty rather than omitted -- a session that produced
    nothing has to stay distinguishable from one that was never read.
    """
    return {
        "session_id": session_id,
        "project_id": project_id,
        "events": sorted(events, key=lambda e: e.get("seq", 0)),
        "turns": list(turns),
        "counts": {"events": len(events), "turns": len(turns)},
    }


def read_feed(dsn: str, session_id: str, project_id: str) -> dict:
    """The feed rows for one session. Kept apart from `feed_payload` so the shaping
    is testable without a database."""
    with psycopg.connect(dsn) as conn:
        events = [
            {"seq": r[0], "kind": r[1], "payload": r[2], "ts": r[3].isoformat() if r[3] else None}
            for r in conn.execute(
                "SELECT seq, kind, payload, ts FROM session_events WHERE session_id = %s ORDER BY seq",
                (session_id,),
            ).fetchall()
        ]
        turns = [
            {"turn_id": r[0], "message": r[1], "outcome": r[2], "receive_count": r[3],
             "completed_at": r[4].isoformat() if r[4] else None}
            for r in conn.execute(
                "SELECT turn_id, message, outcome, receive_count, completed_at "
                "FROM turns WHERE session_id = %s ORDER BY enqueued_at",
                (session_id,),
            ).fetchall()
        ]
    return feed_payload(session_id, project_id, events=events, turns=turns)


def export(project_id: str, *, out_dir: Path, pg_dsn: str, s3_endpoint: str) -> int:
    env = {**os.environ, "PROTO_PG_DSN": pg_dsn, "PROTO_S3_ENDPOINT": s3_endpoint}
    proc = subprocess.run(
        ["npx", "tsx", "dev/export-project.ts"], cwd=ENGINE_DIR, input=json.dumps(manifest(project_id, out_dir)),
        text=True, encoding="utf-8", env=env, capture_output=True,
    )
    sys.stdout.write(proc.stdout)
    sys.stderr.write(proc.stderr)
    return proc.returncode


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--session", required=True, help="the web-tier session id (proto/seed.py, proto/demo.py)")
    p.add_argument("--out", default=str(DEFAULT_OUT), help=f"parent of <project_id>/ (default {DEFAULT_OUT})")
    p.add_argument("--pg-dsn", default="postgresql://postgres:proto@localhost:5434/proto")
    p.add_argument("--s3-endpoint", default="http://localhost:9000")
    args = p.parse_args(argv)

    try:
        project_id = resolve_project(args.pg_dsn, args.session)
    except psycopg.Error as exc:
        print(f"export: postgres unreachable ({type(exc).__name__}: {exc}); run `make proto-up` first", file=sys.stderr)
        return 2
    if project_id is None:
        print(f"export: no session {args.session!r} in sessions", file=sys.stderr)
        return 2

    out_dir = Path(args.out).resolve()
    print(f"session_id  {args.session}")
    print(f"project_id  {project_id}")
    print(f"out         {export_dir(out_dir, project_id)}")
    rc = export(project_id, out_dir=out_dir, pg_dsn=args.pg_dsn, s3_endpoint=args.s3_endpoint)

    # The feed is written even when the document export fails: the two are separate
    # stores, and a run whose feed survived is worth more than nothing. A feed that
    # cannot be read must not turn a successful document export into a failure, so it
    # reports and carries on -- but it never claims to have written a file it did not.
    try:
        feed = read_feed(args.pg_dsn, args.session, project_id)
        dest = feed_path(out_dir, project_id)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps(feed, indent=2, default=str), encoding="utf-8")
        print(f"feed        {dest}  ({feed['counts']['events']} events, "
              f"{feed['counts']['turns']} turns)")
    except (psycopg.Error, OSError) as exc:
        print(f"export: feed not written ({type(exc).__name__}: {exc})", file=sys.stderr)
    return 1 if rc else 0


if __name__ == "__main__":
    sys.exit(main())

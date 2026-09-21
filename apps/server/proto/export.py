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
    return 1 if rc else 0


if __name__ == "__main__":
    sys.exit(main())

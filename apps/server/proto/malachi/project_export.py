"""One project, or every project of one user, as a folder of files: `make malachi-export`.

Run inside the web image (``malachi.sh export`` binds this file and ``/out``). The files are
what the web tier's download serves, from the same two helpers, with its ``MISSING.txt``.
It stays out of ``web/`` so it does not ship in the web bundle.

    python project_export.py --email a@example.com --out /out
    python project_export.py --project proj_0123456789abcdef --out /out
"""

from __future__ import annotations

import argparse
import asyncio
import os
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Any

import psycopg

from web import app as web_app
from web import blobstore

PROJECTS_BY_EMAIL_SQL = (
    "SELECT p.project_id FROM projects p JOIN users u ON u.id = p.owner_id "
    "WHERE lower(u.email) = lower(%s) ORDER BY p.project_id"
)


async def export_project(store: Any, blobs: Any, project_id: str, out: Path) -> Path:
    """Write ``project_id`` to ``<out>/<project_id>/``, replacing any earlier export."""
    docs, index = await store.documents(project_id), await store.blob_index(project_id)
    if not docs and not index:
        raise LookupError(f"project {project_id} has no documents and no files")
    files, left_out = await asyncio.to_thread(web_app._download_files, docs, index)
    dest = out / project_id
    if dest.resolve().parent != out.resolve():
        raise ValueError(f"project id {project_id!r} is not a folder name")

    def write() -> None:
        with tempfile.TemporaryFile() as tmp:
            web_app._build_project_zip(tmp, files, blobs.get, left_out)
            shutil.rmtree(dest, ignore_errors=True)
            with zipfile.ZipFile(tmp) as archive:
                archive.extractall(dest)

    await asyncio.to_thread(write)
    return dest


def projects_of(dsn: str, email: str) -> list[str]:
    with psycopg.connect(dsn) as conn:
        return [row[0] for row in conn.execute(PROJECTS_BY_EMAIL_SQL, (email,)).fetchall()]


async def run(args: argparse.Namespace) -> int:
    dsn = os.environ["PG_DSN"]
    projects = [args.project] if args.project else projects_of(dsn, args.email)
    if not projects:
        print(f"no projects for {args.email}", file=sys.stderr)
        return 1
    blobs = blobstore.from_env(os.environ)
    if blobs is None:
        print("no blob store configured", file=sys.stderr)
        return 1
    store = web_app.PgStore(dsn)
    out = Path(args.out)
    for project_id in projects:
        print(await export_project(store, blobs, project_id, out))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    who = parser.add_mutually_exclusive_group(required=True)
    who.add_argument("--email")
    who.add_argument("--project")
    parser.add_argument("--out", required=True)
    try:
        return asyncio.run(run(parser.parse_args(argv)))
    except LookupError as exc:
        print(exc, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

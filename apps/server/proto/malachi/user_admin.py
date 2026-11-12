"""Block or delete one beta user: `make beta-block-user` and `make beta-delete-user`.

Run inside the web image (``malachi.sh block-user`` / ``delete-user`` bind this file). It stays
out of ``web/`` so it does not ship in the web bundle.

    python user_admin.py block --account usr_0123
    python user_admin.py delete --account usr_0123 [--confirm] [--report /report/projects.txt]

``delete`` reads the account's deletion code on stdin, never argv, and prints it nowhere. A
wrong code exits 1 having touched nothing. Without ``--confirm`` it prints what it would delete
and deletes nothing. With it: block, then the objects under each owned project's prefix and the
user's feedback prefix, then every row in one transaction, then the prefixes once more. The host's exports are
malachi.sh's to remove; ``--report`` names the projects to remove them for.
"""

from __future__ import annotations

import argparse
import hmac
import os
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import psycopg

from web import app as web_app
from web import auth, blobstore, feedback

USER_SQL = "SELECT id, email FROM users WHERE id = %s"
BLOCK_SQL = (
    "UPDATE users SET blocked_at = COALESCE(blocked_at, now()), sessions_revoked_at = now() WHERE id = %s"
)
PROJECTS_SQL = "SELECT project_id FROM projects WHERE owner_id = %s ORDER BY project_id"
SESSIONS_SQL = "SELECT session_id, sdk_session_id FROM sessions WHERE project_id = ANY(%s) ORDER BY session_id"
USER_DELETE_SQL = "DELETE FROM users WHERE id = %s"
# The engine's per-project write lock (PgS3ProjectStore.runTransaction): taking it waits out a
# tool call that was admitted before the block and is still writing to the project.
PROJECT_WRITE_LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtext(%s))"
# Deleting the users row cascades these (sql/008_auth_owner.sql, sql/017_connector_auth.sql).
CASCADED_TABLES = ("familysearch_tokens", "connector_tokens", "authorization_codes")
DELETE_BATCH = 1000  # S3's DeleteObjects limit
# The rows are gone but objects may remain: malachi.sh still removes the exports, then fails.
ROWS_GONE_OBJECTS_LEFT = 3


def code_matches(account: str, submitted: str) -> bool:
    """Whether ``submitted`` is ``account``'s deletion code. Bytes, so a non-ASCII paste is a
    mismatch rather than compare_digest's TypeError."""
    expected = auth.deletion_code(account).encode()
    return hmac.compare_digest(expected, submitted.strip().lower().encode("utf-8"))


def find_user(conn: psycopg.Connection, account: str) -> tuple[str, str] | None:
    row = conn.execute(USER_SQL, (account,)).fetchone()
    return (row[0], row[1]) if row else None


def block(conn: psycopg.Connection, account: str) -> None:
    """Block the user and revoke their cookies, committed on its own. ``conn`` is autocommit."""
    conn.execute(BLOCK_SQL, (account,))


def owned_projects(conn: psycopg.Connection, account: str) -> list[str]:
    projects = [row[0] for row in conn.execute(PROJECTS_SQL, (account,)).fetchall()]
    for project_id in projects:
        if not project_id or "/" in project_id or f"{project_id}/" == feedback.FEEDBACK_PREFIX:
            raise ValueError(f"project id {project_id!r} is not a key prefix: refusing to delete under it")
    return projects


def prefixes(account: str, projects: Sequence[str]) -> list[str]:
    """Where the user's objects live: ``<project_id>/`` for each owned project (the engine's and
    the web tier's keys, superseded objects included) and ``feedback/<user_id>/``
    (``feedback.bundle_key``)."""
    return [f"{project_id}/" for project_id in projects] + [f"{feedback.FEEDBACK_PREFIX}{account}/"]


def object_keys(s3: Any, bucket: str, prefix: str) -> list[str]:
    """Every key under ``prefix``, by listing, not from the ``blobs`` index: a superseded or
    deleted blob leaves its object with no row."""
    keys: list[str] = []
    kwargs: dict[str, Any] = {"Bucket": bucket, "Prefix": prefix}
    while True:
        page = s3.list_objects_v2(**kwargs)
        keys.extend(item["Key"] for item in page.get("Contents", []))
        if not page.get("IsTruncated"):
            return keys
        kwargs["ContinuationToken"] = page["NextContinuationToken"]


def delete_keys(s3: Any, bucket: str, keys: Sequence[str]) -> None:
    for start in range(0, len(keys), DELETE_BATCH):
        batch = keys[start:start + DELETE_BATCH]
        resp = s3.delete_objects(Bucket=bucket, Delete={"Objects": [{"Key": k} for k in batch], "Quiet": True})
        errors = resp.get("Errors") or []
        if errors:
            first = errors[0]
            raise RuntimeError(f"{len(errors)} objects were not deleted; the first, {first.get('Key')}: "
                               f"{first.get('Code')}")


def delete_objects(s3: Any, bucket: str, prefix_list: Sequence[str]) -> dict[str, int]:
    """Delete every object under each prefix, then list again: anything still there fails."""
    deleted: dict[str, int] = {}
    for prefix in prefix_list:
        keys = object_keys(s3, bucket, prefix)
        delete_keys(s3, bucket, keys)
        left = object_keys(s3, bucket, prefix)
        if left:
            raise RuntimeError(f"{len(left)} objects are still under {prefix} after the delete")
        deleted[prefix] = len(keys)
    return deleted


def row_counts(conn: psycopg.Connection, account: str, projects: list[str]) -> dict[str, int]:
    """The rows a delete removes, by table."""
    grants = web_app.grants
    sessions = conn.execute(SESSIONS_SQL, (projects,)).fetchall()
    session_ids = [row[0] for row in sessions]
    transcript = [i for sid, sdk in sessions for i in grants.transcript_ids(sid, sdk)]
    counts: dict[str, int] = {}
    for table in (*grants.SESSION_TABLES, "sessions"):
        counts[table] = conn.execute(f"SELECT count(*) FROM {table} WHERE session_id = ANY(%s)",  # noqa: S608
                                     (session_ids,)).fetchone()[0]
    counts["session_entries"] = conn.execute("SELECT count(*) FROM session_entries WHERE session_id = ANY(%s)",
                                             (transcript,)).fetchone()[0]
    for table in web_app.PROJECT_TABLES:
        counts[table] = conn.execute(f"SELECT count(*) FROM {table} WHERE project_id = ANY(%s)",  # noqa: S608
                                     (projects,)).fetchone()[0]
    for table in CASCADED_TABLES:
        counts[table] = conn.execute(f"SELECT count(*) FROM {table} WHERE user_id = %s",  # noqa: S608
                                     (account,)).fetchone()[0]
    counts["users"] = 1
    return counts


def delete_rows(conn: psycopg.Connection, account: str, projects: list[str]) -> None:
    """Every row of the user, in one transaction: ``PgStore.delete_session``'s statements for
    each session of each owned project, then each project's own rows, then the users row, which
    cascades ``CASCADED_TABLES``. ``projects.owner_id`` does not cascade, so a project this
    missed fails the users delete and rolls the whole transaction back. ``conn`` is autocommit."""
    grants = web_app.grants
    with conn.transaction():
        for project_id in projects:
            conn.execute(PROJECT_WRITE_LOCK_SQL, (project_id,))
        for session_id, sdk_session_id in conn.execute(SESSIONS_SQL, (projects,)).fetchall():
            for table in grants.SESSION_TABLES:
                conn.execute(web_app.SESSION_ROW_DELETE_SQL.format(table=table), (session_id,))
            conn.execute(grants.TRANSCRIPT_DELETE_SQL, (grants.transcript_ids(session_id, sdk_session_id),))
            conn.execute(web_app.SESSION_ROW_DELETE_SQL.format(table="sessions"), (session_id,))
        for project_id in projects:
            for table in web_app.PROJECT_TABLES:
                conn.execute(web_app.PROJECT_ROW_DELETE_SQL.format(table=table), (project_id, project_id))
        conn.execute(USER_DELETE_SQL, (account,))


def _counts_line(counts: dict[str, int]) -> str:
    return " ".join(f"{name}={n}" for name, n in counts.items())


def run_block(dsn: str, account: str) -> int:
    with psycopg.connect(dsn, autocommit=True) as conn:
        user = find_user(conn, account)
        if user is None:
            print(f"no user {account}", file=sys.stderr)
            return 1
        block(conn, account)
    print(f"blocked {account} ({user[1]}): their cookie and their connector token are refused from the next "
          "request")
    return 0


def run_delete(dsn: str, s3: Any, bucket: str, account: str, submitted: str, *, confirm: bool,
               report: Path | None = None) -> int:
    if not code_matches(account, submitted):
        print(f"that is not the deletion code of {account}: nothing changed", file=sys.stderr)
        return 1
    with psycopg.connect(dsn, autocommit=True) as conn:
        user = find_user(conn, account)
        if user is None:
            print(f"no user {account}", file=sys.stderr)
            return 1
        if not confirm:
            projects = owned_projects(conn, account)
            print(f"account {account} ({user[1]})")
            print(f"projects: {', '.join(projects) or 'none'}")
            print(f"rows: {_counts_line(row_counts(conn, account, projects))}")
            objects = {p: len(object_keys(s3, bucket, p)) for p in prefixes(account, projects)}
            print(f"objects: {_counts_line(objects)}")
            print("Nothing was deleted. Run it again with CONFIRM=yes to delete all of this.")
            return 0
        # Blocked and committed first: the tool server reads blocked_at on every call, so no
        # new call starts while the objects go.
        block(conn, account)
        projects = owned_projects(conn, account)
        if report is not None:
            report.write_text("".join(f"{p}\n" for p in projects), encoding="utf-8")
        counts = row_counts(conn, account, projects)
        objects = delete_objects(s3, bucket, prefixes(account, projects))
        delete_rows(conn, account, projects)
        # Again after the rows: a call admitted before the block can have put an object after
        # the first listing. delete_rows waited for its transaction to end. A rerun cannot
        # finish this once the users row is gone, so a failure here is reported, not raised.
        try:
            for prefix, n in delete_objects(s3, bucket, prefixes(account, projects)).items():
                objects[prefix] += n
        except Exception as exc:  # noqa: BLE001 - any store error; the rows are already gone
            print(f"deleted every row of {account}, but objects may remain under "
                  f"{', '.join(prefixes(account, projects))}: {exc}. Delete them by hand.", file=sys.stderr)
            return ROWS_GONE_OBJECTS_LEFT
    print(f"deleted {account} ({user[1]}) and {len(projects)} projects: {', '.join(projects) or 'none'}")
    print(f"rows: {_counts_line(counts)}")
    print(f"objects: {_counts_line(objects)}")
    print("Backups taken before now still hold this user's data, until they are pruned.")
    print(f"{user[1]} stays on the allowlist if it is there: a new sign-in would create a new, empty account.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    block_cmd = commands.add_parser("block")
    block_cmd.add_argument("--account", required=True)
    delete_cmd = commands.add_parser("delete")
    delete_cmd.add_argument("--account", required=True)
    delete_cmd.add_argument("--confirm", action="store_true")
    delete_cmd.add_argument("--report")
    args = parser.parse_args(argv)
    account = args.account.strip()
    if not account:
        print("--account is blank", file=sys.stderr)
        return 2
    dsn = os.environ["PG_DSN"]
    if args.command == "block":
        return run_block(dsn, account)
    submitted = sys.stdin.read()
    blobs = blobstore.from_env(os.environ)
    if blobs is None:
        print("no blob store configured", file=sys.stderr)
        return 1
    return run_delete(dsn, blobs.s3, blobs.bucket, account, submitted, confirm=args.confirm,
                      report=Path(args.report) if args.report else None)


if __name__ == "__main__":
    sys.exit(main())

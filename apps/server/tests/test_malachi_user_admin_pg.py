"""``make beta-delete-user`` and ``make beta-block-user`` (malachi's ``user_admin.py``) on a real
Postgres, run as the role the malachi stack runs it as: ``dml_role.py``'s DML-only role.

Two users each get a project with a session and its transcript, a project with no session (the
shape a connector creates), a superseded object beside the one a blob row points at, a staged
result, a feedback bundle, a connector token, a FamilySearch token and an authorization code. One
is deleted. The check walks ``information_schema`` for every column named ``user_id``,
``owner_id``, ``project_id``, ``session_id`` or ``project_key`` rather than a list of tables, so a table a later
migration adds fails here instead of quietly keeping a deleted user's data.

The object store is a double of the botocore client, paging two keys at a time. To run it on
``make proto-up``'s Postgres and MinIO instead, as ``proto-store-test`` names them::

    PROTO_TEST_PG_DSN=postgresql://postgres:proto@localhost:5434/postgres \
    PROTO_S3_ENDPOINT=http://localhost:9000 PROTO_S3_BUCKET=projects \
    PROTO_S3_ACCESS_KEY=proto PROTO_S3_SECRET_KEY=protoproto \
    uv run pytest tests/test_malachi_user_admin_pg.py

Without ``PROTO_TEST_PG_DSN`` the module skips, except under ``CI``, where it fails.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import re
import sys
import time
import uuid
from pathlib import Path
from typing import Any

import httpx
import psycopg
import pytest
from psycopg import sql as pgsql
from psycopg.conninfo import make_conninfo

from tests._proto_pg import PROTO, database, populated, sql, ungranted_advisory

MALACHI = PROTO / "malachi"
sys.path.insert(0, str(PROTO))
sys.path.insert(0, str(MALACHI))

import dml_role  # noqa: E402
import user_admin  # noqa: E402
from web import auth, blobstore  # noqa: E402
from web.app import PgStore, create_app  # noqa: E402

DOOR_SOURCE = PROTO.parents[2] / "packages/engine/mcp-server/src/store/pg-s3-project-store.ts"
ID_COLUMNS = ("user_id", "owner_id", "project_id", "session_id", "project_key")
AUTH_ENV = ("PUBLIC_URL", "WEB_ORIGIN", "FS_TOKEN_ENC_KEY", "ALLOWED_EMAILS", "FAMILYSEARCH_WEB_ENABLED",
            "FAMILYSEARCH_CONFIG", "GENEALOGY_MAX_USERS", "UPLOADS_ENABLED", "OPENROUTER_LINKING_ENABLED",
            "FS_REDIRECT_URI", "GENEALOGY_SIGNIN_CALLS_PER_MINUTE", "OAUTH_ISSUER")


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    for name in AUTH_ENV:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("SESSION_SECRET", "user-admin-test-secret-" + "s" * 16)
    monkeypatch.setenv("DEV_LOGIN", "true")
    monkeypatch.setenv("GENEALOGY_CHAT", "false")


@pytest.fixture(scope="module")
def pg_dsn():
    with database(prefix="malachi_ua_") as dsn:
        yield dsn


@pytest.fixture(scope="module")
def role_dsn(pg_dsn):
    password = "user-admin-test-" + uuid.uuid4().hex
    with psycopg.connect(pg_dsn) as conn:
        dml_role.apply(conn, password)
    try:
        yield make_conninfo(pg_dsn, user=dml_role.ROLE, password=password)
    finally:
        with psycopg.connect(pg_dsn, autocommit=True) as conn:
            conn.execute(f"DROP OWNED BY {dml_role.ROLE}")
            conn.execute(f"DROP ROLE {dml_role.ROLE}")


class FakeS3:
    """The botocore calls ``user_admin`` makes, on one dict, listing two keys a page so the
    continuation path runs."""

    PAGE = 2

    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}

    def put_object(self, Bucket: str, Key: str, Body: bytes, **_: Any) -> dict:  # noqa: N803
        self.objects[(Bucket, Key)] = Body
        return {}

    def list_objects_v2(self, Bucket: str, Prefix: str = "", ContinuationToken: str | None = None,  # noqa: N803
                        **_: Any) -> dict:
        keys = sorted(k for b, k in self.objects if b == Bucket and k.startswith(Prefix))
        start = int(ContinuationToken or 0)
        page = keys[start:start + self.PAGE]
        out: dict[str, Any] = {"IsTruncated": start + self.PAGE < len(keys)}
        if page:
            out["Contents"] = [{"Key": k} for k in page]
        if out["IsTruncated"]:
            out["NextContinuationToken"] = str(start + self.PAGE)
        return out

    def delete_objects(self, Bucket: str, Delete: dict) -> dict:  # noqa: N803
        assert len(Delete["Objects"]) <= 1000, "S3 refuses a DeleteObjects of more than 1000 keys"
        for item in Delete["Objects"]:
            self.objects.pop((Bucket, item["Key"]), None)
        return {}


@pytest.fixture(scope="module")
def s3() -> tuple[Any, str]:
    endpoint = os.environ.get("PROTO_S3_ENDPOINT")
    if not endpoint:
        return FakeS3(), "projects"
    env = {blobstore.ENDPOINT_VAR: endpoint, blobstore.BUCKET_VAR: os.environ["PROTO_S3_BUCKET"],
           blobstore.ACCESS_KEY_VAR: os.environ["PROTO_S3_ACCESS_KEY"],
           blobstore.SECRET_KEY_VAR: os.environ["PROTO_S3_SECRET_KEY"]}
    return blobstore.client(env), env[blobstore.BUCKET_VAR]


def keys_under(s3: tuple[Any, str], prefix: str) -> list[str]:
    client, bucket = s3
    return sorted(user_admin.object_keys(client, bucket, prefix))


async def seed_user(dsn: str, s3: tuple[Any, str]) -> dict[str, Any]:
    """One user with every kind of row and object the delete must reach."""
    client, bucket = s3
    uid = "usr_" + uuid.uuid4().hex[:12]
    email = f"{uid}@example.test"
    sql(dsn, "INSERT INTO users (id, email) VALUES (%s, %s)", (uid, email))
    row, sdk = await populated(dsn)
    bare = "proj_" + uuid.uuid4().hex[:10]
    sql(dsn, "UPDATE projects SET owner_id = %s WHERE project_id = %s", (uid, row.project_id))
    sql(dsn, "INSERT INTO projects (project_id, owner_id) VALUES (%s, %s)", (bare, uid))
    sql(dsn, "INSERT INTO documents (project_id, name, doc) VALUES (%s, 'research.json', '{}')", (bare,))
    keys = []
    for project_id in (row.project_id, bare):
        current, superseded = (f"{project_id}/images/a/{uuid.uuid4()}" for _ in range(2))
        staged = f"{project_id}/results/r1/{uuid.uuid4()}"
        sql(dsn, "INSERT INTO blobs (project_id, key, s3_key, bytes, sha256) VALUES (%s, 'images/a', %s, 1, 'h') "
                 "ON CONFLICT (project_id, key) DO UPDATE SET s3_key = EXCLUDED.s3_key", (project_id, current))
        keys += [current, superseded, staged]
    keys.append(f"feedback/{uid}/{row.project_id}/feedback-2026-11-09T00-00-00Z-0a1b2c3d.zip")
    for key in keys:
        client.put_object(Bucket=bucket, Key=key, Body=b"x")
    token = "conn-" + uuid.uuid4().hex
    token_sha = hashlib.sha256(token.encode()).hexdigest()
    sql(dsn, "INSERT INTO familysearch_tokens (user_id, access_token_enc, expires_at, granted_at) "
             "VALUES (%s, 'enc', now() + interval '1 hour', now())", (uid,))
    sql(dsn, "INSERT INTO connector_tokens (token_sha256, user_id, client_id, scopes, expires_at) "
             "VALUES (%s, %s, 'c', ARRAY['mcp'], now() + interval '1 hour')", (token_sha, uid))
    sql(dsn, "INSERT INTO authorization_codes (code_sha256, user_id, client_id, redirect_uri, "
             "redirect_uri_provided_explicitly, code_challenge, scopes, expires_at) "
             "VALUES (%s, %s, 'c', 'https://example.test/cb', true, 'ch', ARRAY['mcp'], now() + interval '5 minutes')",
        (uuid.uuid4().hex, uid))
    return {"uid": uid, "email": email, "projects": sorted([row.project_id, bare]),
            "ids": [uid, row.project_id, bare, row.session_id, sdk], "keys": sorted(keys), "token_sha": token_sha}


def holding(dsn: str, ids: list[str]) -> dict[str, int]:
    """Rows holding any of ``ids`` in any ID_COLUMNS column of any table, plus ``users.id``,
    by ``table.column``. Found by walking the schema, not by a list."""
    columns = sql(dsn, "SELECT table_name, column_name FROM information_schema.columns "
                       "WHERE table_schema = 'public' AND column_name = ANY(%s) ORDER BY 1, 2", (list(ID_COLUMNS),))
    assert len(columns) >= 16, columns  # the walk reaches the schema at all
    found: dict[str, int] = {}
    for table, column in [*columns, ("users", "id")]:
        statement = pgsql.SQL("SELECT count(*) FROM {} WHERE {} = ANY(%s)").format(
            pgsql.Identifier(table), pgsql.Identifier(column))
        count = sql(dsn, statement, (ids,))[0][0]
        if count:
            found[f"{table}.{column}"] = count
    return found


def objects(s3: tuple[Any, str], user: dict[str, Any]) -> list[str]:
    return sorted(k for p in user_admin.prefixes(user["uid"], user["projects"]) for k in keys_under(s3, p))


def code_of(user: dict[str, Any]) -> str:
    return auth.deletion_code(user["uid"])


async def test_delete_leaves_no_row_and_no_object_of_the_user_and_all_of_the_other(pg_dsn, role_dsn, s3, tmp_path,
                                                                                   capsys):
    gone, kept = await seed_user(pg_dsn, s3), await seed_user(pg_dsn, s3)
    kept_rows, kept_objects = holding(pg_dsn, kept["ids"]), objects(s3, kept)
    assert objects(s3, gone) == gone["keys"] and len(holding(pg_dsn, gone["ids"])) >= 15
    report = tmp_path / "projects"

    status = user_admin.run_delete(role_dsn, *s3, gone["uid"], f"  {code_of(gone).upper()}\n", confirm=True,
                                   report=report)

    assert status == 0, capsys.readouterr().err
    assert holding(pg_dsn, gone["ids"]) == {}
    assert objects(s3, gone) == []
    assert holding(pg_dsn, kept["ids"]) == kept_rows
    assert objects(s3, kept) == kept_objects == kept["keys"]
    assert report.read_text(encoding="utf-8").split() == gone["projects"]
    out = capsys.readouterr().out
    assert "Backups taken before now" in out and "allowlist" in out and code_of(gone) not in out


async def test_the_walk_finds_a_table_the_delete_does_not_know(pg_dsn, role_dsn, s3):
    """A later migration's table holding a user id fails the delete's check: the walk is not a list."""
    user = await seed_user(pg_dsn, s3)
    sql(pg_dsn, "CREATE TABLE IF NOT EXISTS later_table (user_id text)")
    try:
        sql(pg_dsn, "INSERT INTO later_table (user_id) VALUES (%s)", (user["uid"],))
        assert user_admin.run_delete(role_dsn, *s3, user["uid"], code_of(user), confirm=True) == 0
        assert holding(pg_dsn, user["ids"]) == {"later_table.user_id": 1}
    finally:
        sql(pg_dsn, "DROP TABLE later_table")


def snapshot(dsn: str, s3: tuple[Any, str], user: dict[str, Any]) -> tuple:
    blocked = sql(dsn, "SELECT blocked_at, sessions_revoked_at FROM users WHERE id = %s", (user["uid"],))
    return holding(dsn, user["ids"]), objects(s3, user), blocked


@pytest.mark.parametrize("confirm", [True, False])
async def test_a_wrong_code_changes_nothing_and_never_prints_a_code(pg_dsn, role_dsn, s3, capsys, confirm):
    user, other = await seed_user(pg_dsn, s3), await seed_user(pg_dsn, s3)
    before = snapshot(pg_dsn, s3, user)
    wrong = code_of(other)
    assert user_admin.run_delete(role_dsn, *s3, user["uid"], wrong, confirm=confirm) == 1
    assert snapshot(pg_dsn, s3, user) == before
    assert before[2] == [(None, None)]
    printed = capsys.readouterr()
    assert "not the deletion code" in printed.err
    assert wrong not in printed.out + printed.err and code_of(user) not in printed.out + printed.err


async def test_without_confirm_it_reports_and_deletes_nothing(pg_dsn, role_dsn, s3, capsys):
    user = await seed_user(pg_dsn, s3)
    before = snapshot(pg_dsn, s3, user)
    assert user_admin.run_delete(role_dsn, *s3, user["uid"], code_of(user), confirm=False) == 0
    assert snapshot(pg_dsn, s3, user) == before
    out = capsys.readouterr().out
    assert f"account {user['uid']} ({user['email']})" in out
    assert f"projects: {', '.join(user['projects'])}" in out
    assert "sessions=1" in out and "connector_tokens=1" in out and "documents=2" in out
    for project_id in user["projects"]:
        assert f"{project_id}/=3" in out
    assert f"feedback/{user['uid']}/=1" in out
    assert "Nothing was deleted" in out and code_of(user) not in out


async def test_an_unknown_account_is_refused(pg_dsn, role_dsn, s3, capsys):
    ghost = "usr_" + uuid.uuid4().hex[:12]
    assert user_admin.run_delete(role_dsn, *s3, ghost, auth.deletion_code(ghost), confirm=True) == 1
    assert user_admin.run_block(role_dsn, ghost) == 1
    assert capsys.readouterr().err.count(f"no user {ghost}") == 2


def door_row(dsn: str, token_sha: str) -> list[tuple]:
    """``lookupConnectorToken``'s query, read from the engine's source so it cannot drift: the
    function returns null for no row and for a row whose ``blocked_at`` is set."""
    source = DOOR_SOURCE.read_text(encoding="utf-8")
    query = re.search(r"const CONNECTOR_DOOR_SQL = `([^`]*)`", source).group(1).replace("$1", "%s")
    assert "blocked_at" in query and "if (row.blocked_at !== null) return null;" in source
    return sql(dsn, query, (token_sha,))


async def get_account(cookie: str, dsn: str) -> httpx.Response:
    application = create_app(PgStore(dsn), None)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application), base_url="http://t",
                                 cookies={auth.COOKIE_NAME: cookie}) as client:
        return await client.get("/api/account")


async def test_block_refuses_the_cookie_and_the_connector_token(pg_dsn, role_dsn, s3, capsys):
    user = await seed_user(pg_dsn, s3)
    signed_in = auth.session_cookie_value(user["uid"], iat=time.time() - 5)
    assert (await get_account(signed_in, role_dsn)).status_code == 200
    door = door_row(pg_dsn, user["token_sha"])
    assert len(door) == 1 and door[0][1] is None

    assert user_admin.run_block(role_dsn, user["uid"]) == 0

    revoked = await get_account(signed_in, role_dsn)
    assert revoked.status_code == 401 and revoked.json() == {"detail": "Session revoked"}
    later = await get_account(auth.session_cookie_value(user["uid"], iat=time.time() + 60), role_dsn)
    assert later.status_code == 403 and later.json() == {"detail": "Account blocked"}, later.text
    door = door_row(pg_dsn, user["token_sha"])
    assert len(door) == 1 and door[0][1] is not None, "the connector door would admit the token"
    assert f"blocked {user['uid']}" in capsys.readouterr().out


async def test_a_confirmed_delete_blocks_before_the_objects_go(pg_dsn, role_dsn, s3, monkeypatch):
    """A failed object delete leaves the user blocked and every row in place, so a rerun finishes."""
    user = await seed_user(pg_dsn, s3)

    def refuse(*_args, **_kwargs):
        raise RuntimeError("the store refused")

    real = user_admin.delete_keys
    monkeypatch.setattr(user_admin, "delete_keys", refuse)
    with pytest.raises(RuntimeError, match="the store refused"):
        user_admin.run_delete(role_dsn, *s3, user["uid"], code_of(user), confirm=True)
    assert sql(pg_dsn, "SELECT blocked_at IS NOT NULL, sessions_revoked_at IS NOT NULL FROM users WHERE id = %s",
               (user["uid"],)) == [(True, True)]
    assert len(holding(pg_dsn, user["ids"])) >= 15
    monkeypatch.setattr(user_admin, "delete_keys", real)
    assert user_admin.run_delete(role_dsn, *s3, user["uid"], code_of(user), confirm=True) == 0
    assert holding(pg_dsn, user["ids"]) == {} and objects(s3, user) == []


async def test_the_delete_waits_out_a_write_already_in_progress_and_sweeps_after_it(pg_dsn, role_dsn, s3):
    """A tool call admitted before the block holds the engine's project lock and writes on. The
    row delete waits for it, and the second sweep takes the object it put after the first."""
    user = await seed_user(pg_dsn, s3)
    client, bucket = s3
    project_id = user["projects"][0]
    holder = psycopg.connect(pg_dsn)
    try:
        holder.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (project_id,))
        delete = asyncio.create_task(asyncio.to_thread(
            user_admin.run_delete, role_dsn, client, bucket, user["uid"], code_of(user), confirm=True))
        await ungranted_advisory(pg_dsn)
        holder.execute("INSERT INTO documents (project_id, name, doc) VALUES (%s, 'late.json', '{}')", (project_id,))
        client.put_object(Bucket=bucket, Key=f"{project_id}/late/{uuid.uuid4()}", Body=b"x")
        holder.commit()
        assert await delete == 0
    finally:
        holder.close()
    assert holding(pg_dsn, user["ids"]) == {}
    assert objects(s3, user) == []


async def test_a_project_named_like_the_feedback_prefix_is_refused(pg_dsn, role_dsn, s3):
    """Its prefix would be every user's feedback bundles."""
    user, other = await seed_user(pg_dsn, s3), await seed_user(pg_dsn, s3)
    sql(pg_dsn, "INSERT INTO projects (project_id, owner_id) VALUES ('feedback', %s)", (user["uid"],))
    try:
        with pytest.raises(ValueError, match="not a key prefix"):
            user_admin.run_delete(role_dsn, *s3, user["uid"], code_of(user), confirm=True)
        assert objects(s3, other) == other["keys"]
    finally:
        sql(pg_dsn, "DELETE FROM projects WHERE project_id = 'feedback'")


async def test_a_failed_second_sweep_reports_the_rows_gone(pg_dsn, role_dsn, s3, monkeypatch, capsys):
    """The users row is gone by then, so a rerun cannot finish: exit 3 tells malachi.sh to
    remove the exports anyway and fail."""
    user = await seed_user(pg_dsn, s3)
    real, calls = user_admin.delete_objects, []

    def second_fails(*args, **kwargs):
        calls.append(1)
        if len(calls) == 2:
            raise RuntimeError("the store refused")
        return real(*args, **kwargs)

    monkeypatch.setattr(user_admin, "delete_objects", second_fails)
    status = user_admin.run_delete(role_dsn, *s3, user["uid"], code_of(user), confirm=True)
    assert status == user_admin.ROWS_GONE_OBJECTS_LEFT == 3
    assert holding(pg_dsn, user["ids"]) == {}
    assert "objects may remain" in capsys.readouterr().err

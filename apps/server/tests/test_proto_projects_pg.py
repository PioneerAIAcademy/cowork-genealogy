"""Project viewer queries against REAL Postgres: ownership, labels and document times.

Without the DSN this module skips, except under ``CI``, where it fails.
"""

from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from psycopg.types.json import Jsonb

from tests._proto_pg import database, sql

PROTO = Path(__file__).resolve().parents[1] / "proto"
if str(PROTO) not in sys.path:
    sys.path.insert(0, str(PROTO))

from web.app import PgStore  # noqa: E402


@pytest.fixture(scope="module")
def pg_dsn():
    with database(prefix="projects_") as dsn:
        yield dsn


def test_list_projects_filters_owners_and_derives_labels_times_and_order(pg_dsn):
    for owner in ("usr_a", "usr_b"):
        sql(pg_dsn, "INSERT INTO users (id, email) VALUES (%s, %s)", (owner, owner + "@example.test"))
    # Seed backwards so insertion order cannot satisfy the ordering contract.
    for pid, owner in (
        ("proj_j", "usr_a"), ("proj_i", "usr_a"),
        ("proj_h", "usr_a"), ("proj_g", "usr_a"), ("proj_f", "usr_a"), ("proj_e", "usr_a"),
        ("proj_d", "usr_a"), ("proj_c", "usr_a"), ("proj_b", "usr_a"), ("proj_a", "usr_a"),
        ("proj_foreign", "usr_b"), ("proj_null", None),
    ):
        sql(pg_dsn, "INSERT INTO projects (project_id, owner_id) VALUES (%s, %s)", (pid, owner))
    t0 = datetime(2026, 10, 30, 12, 0, tzinfo=timezone.utc)
    t1, t2, t3 = (t0 + timedelta(hours=n) for n in (1, 2, 3))
    for pid, name, doc, updated in (
        ("proj_a", "research.json", {"project": {"title": "Title", "objective": "Objective"}}, t0),
        ("proj_a", "tree.gedcomx.json", {"persons": []}, t2),
        ("proj_a", "notes.json", {}, t3),
        ("proj_b", "research.json", {"project": {"objective": "Objective"}}, t3),
        ("proj_c", "research.json", {"project": {"title": "", "objective": "Fallback"}}, t1),
        ("proj_d", "tree.gedcomx.json", {"persons": []}, t0),
        ("proj_e", "research.json", {"project": {}}, t0),
        ("proj_f", "research.json", {"project": {"title": "", "objective": ""}}, t0),
        ("proj_i", "research.json", {"project": {"title": 42, "objective": "Fallback"}}, t0),
        ("proj_j", "research.json", {"project": "x"}, t0),
        ("proj_foreign", "research.json", {"project": {"title": "Foreign"}}, t3),
        ("proj_null", "research.json", {"project": {"title": "Unclaimed"}}, t3),
    ):
        sql(pg_dsn, "INSERT INTO documents (project_id, name, doc, updated_at) VALUES (%s, %s, %s, %s)",
            (pid, name, Jsonb(doc), updated))

    store = PgStore(pg_dsn)
    assert asyncio.run(store.list_projects("usr_a")) == [
        {"id": "proj_a", "label": "Title", "updated_at": t3},
        {"id": "proj_b", "label": "Objective", "updated_at": t3},
        {"id": "proj_c", "label": "Fallback", "updated_at": t1},
        {"id": "proj_d", "label": None, "updated_at": t0},
        {"id": "proj_e", "label": None, "updated_at": t0},
        {"id": "proj_f", "label": None, "updated_at": t0},
        {"id": "proj_i", "label": "Fallback", "updated_at": t0},
        {"id": "proj_j", "label": None, "updated_at": t0},
        {"id": "proj_g", "label": None, "updated_at": None},
        {"id": "proj_h", "label": None, "updated_at": None},
    ]
    assert asyncio.run(store.list_projects("usr_b")) == [
        {"id": "proj_foreign", "label": "Foreign", "updated_at": t3},
    ]
    assert asyncio.run(store.list_projects("usr_missing")) == []


def test_project_owner_returns_none_for_missing_and_null_owner_projects(pg_dsn):
    sql(pg_dsn, "INSERT INTO users (id, email) VALUES ('usr_owner', 'owner@example.test')")
    sql(pg_dsn, "INSERT INTO projects (project_id, owner_id) VALUES ('proj_owned', 'usr_owner'), ('proj_unowned', NULL)")
    store = PgStore(pg_dsn)
    assert asyncio.run(store.project_owner("proj_owned")) == "usr_owner"
    assert asyncio.run(store.project_owner("proj_unowned")) is None
    assert asyncio.run(store.project_owner("proj_missing")) is None


def test_project_versions_returns_owner_and_only_viewer_document_versions(pg_dsn):
    sql(pg_dsn, "INSERT INTO users (id, email) VALUES ('usr_versions', 'versions@example.test')")
    for pid, owner in (("proj_versions", "usr_versions"), ("proj_versions_null", None),
                       ("proj_versions_empty", "usr_versions")):
        sql(pg_dsn, "INSERT INTO projects (project_id, owner_id) VALUES (%s, %s)", (pid, owner))
    for pid in ("proj_versions", "proj_versions_null"):
        for name, version in (("research.json", 3), ("tree.gedcomx.json", 1), ("starting-tree.gedcomx.json", 9)):
            sql(pg_dsn, "INSERT INTO documents (project_id, name, version, doc) VALUES (%s, %s, %s, %s)",
                (pid, name, version, Jsonb({})))
    store = PgStore(pg_dsn)
    versions = {"research.json": 3, "tree.gedcomx.json": 1}
    assert asyncio.run(store.project_versions("proj_versions")) == ("usr_versions", versions)
    assert asyncio.run(store.project_versions("proj_versions_null")) == (None, versions)
    assert asyncio.run(store.project_versions("proj_versions_empty")) == ("usr_versions", {})
    assert asyncio.run(store.project_versions("proj_missing")) == (None, {})


def test_documents_and_document_versions_follow_real_row_updates(pg_dsn):
    sql(pg_dsn, "INSERT INTO projects (project_id) VALUES ('proj_documents')")
    docs = {
        "research.json": (3, {"project": {"title": "Original"}}),
        "tree.gedcomx.json": (1, {"persons": []}),
        "starting-tree.gedcomx.json": (9, {"persons": [{"id": "starting"}]}),
    }
    for name, (version, doc) in docs.items():
        sql(pg_dsn, "INSERT INTO documents (project_id, name, version, doc) VALUES (%s, %s, %s, %s)",
            ("proj_documents", name, version, Jsonb(doc)))
    store = PgStore(pg_dsn)
    assert asyncio.run(store.documents("proj_documents")) == docs
    names = ("research.json", "tree.gedcomx.json")
    assert asyncio.run(store.documents("proj_documents", names)) == {name: docs[name] for name in names}
    assert asyncio.run(store.documents("proj_documents", ())) == {}
    assert asyncio.run(store.document_versions("proj_documents")) == {name: v for name, (v, _) in docs.items()}

    updated = {"project": {"title": "Updated"}}
    sql(pg_dsn, "UPDATE documents SET version = version + 1, doc = %s WHERE project_id = %s AND name = %s",
        (Jsonb(updated), "proj_documents", "research.json"))
    docs["research.json"] = (4, updated)
    assert asyncio.run(store.documents("proj_documents")) == docs
    assert asyncio.run(store.document_versions("proj_documents")) == {name: v for name, (v, _) in docs.items()}

"""SQLite tables (SQLModel). Mirrors spec §6.3 / plan contract D.4, trimmed to
the POC: users, allowlist, FamilySearch tokens, projects (the user→sandbox map
+ session list). PII work is deferred; tokens are stored as-is for the POC
(noted as a follow-up to encrypt at rest).
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# Postgres' default TIMESTAMP strips tzinfo and returns naive datetimes; since the
# models build tz-aware values (utcnow), declare datetime columns as TIMESTAMP WITH
# TIME ZONE so read-back stays aware. SQLite round-trips either way. Shared alias.
_TZ = DateTime(timezone=True)


class User(SQLModel, table=True):
    __tablename__ = "users"
    id: str = Field(primary_key=True)
    email: str = Field(index=True, unique=True)
    # FamilySearch account id (users[0].id, e.g. "cis.user.MMMM-3KXX"). Stored at
    # login for traceability; the allowlist still gates on email (plan Spike 0).
    familysearch_id: str | None = Field(default=None, index=True)
    created: datetime = Field(default_factory=utcnow, sa_type=_TZ)


class AllowedEmail(SQLModel, table=True):
    __tablename__ = "allowed_emails"
    email: str = Field(primary_key=True)


class FamilySearchToken(SQLModel, table=True):
    __tablename__ = "familysearch_tokens"
    user_id: str = Field(primary_key=True, foreign_key="users.id")
    # POC: plaintext. TODO encrypt at rest before any real PII (spec §13).
    access_token: str
    refresh_token: str | None = None
    expires_at: datetime = Field(sa_type=_TZ)
    updated: datetime = Field(default_factory=utcnow, sa_type=_TZ)


class Project(SQLModel, table=True):
    """session == project == sandbox, 1:1. The landing-screen session list."""
    __tablename__ = "projects"
    id: str = Field(primary_key=True)
    user_id: str = Field(index=True, foreign_key="users.id")
    sandbox_id: str
    agent_session_id: str | None = None  # Agent SDK resume id (set after 1st turn)
    title: str = "New research session"
    model: str = "claude-sonnet-4-6"
    status: str = "active"  # active | archived
    created: datetime = Field(default_factory=utcnow, sa_type=_TZ)
    updated: datetime = Field(default_factory=utcnow, sa_type=_TZ)
    last_active: datetime = Field(default_factory=utcnow, sa_type=_TZ)
    # Per-session turn lock for the public /v1 API (one turn at a time). Holds the
    # timestamp of the in-flight turn, NULL when idle. A guarded UPDATE on this
    # column is the atomic, cross-instance lock (correct on SQLite + Postgres) —
    # see app/v1.py.
    turn_locked_at: datetime | None = Field(default=None, sa_type=_TZ, nullable=True)

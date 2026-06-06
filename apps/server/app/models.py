"""SQLite tables (SQLModel). Mirrors spec §6.3 / plan contract D.4, trimmed to
the POC: users, allowlist, FamilySearch tokens, projects (the user→sandbox map
+ session list). PII work is deferred; tokens are stored as-is for the POC
(noted as a follow-up to encrypt at rest).
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(SQLModel, table=True):
    __tablename__ = "users"
    id: str = Field(primary_key=True)
    email: str = Field(index=True, unique=True)
    google_sub: str | None = Field(default=None, index=True)
    created: datetime = Field(default_factory=utcnow)


class AllowedEmail(SQLModel, table=True):
    __tablename__ = "allowed_emails"
    email: str = Field(primary_key=True)


class FamilySearchToken(SQLModel, table=True):
    __tablename__ = "familysearch_tokens"
    user_id: str = Field(primary_key=True, foreign_key="users.id")
    # POC: plaintext. TODO encrypt at rest before any real PII (spec §13).
    access_token: str
    refresh_token: str | None = None
    expires_at: datetime
    updated: datetime = Field(default_factory=utcnow)


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
    created: datetime = Field(default_factory=utcnow)
    updated: datetime = Field(default_factory=utcnow)
    last_active: datetime = Field(default_factory=utcnow)

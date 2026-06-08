"""DB engine + schema bootstrap + the allowlist seed.

Backend is env-driven (see config.sqlalchemy_url): unset DATABASE_URL → SQLite
under DATA_DIR (local dev); set → Postgres (Neon on Fly). init_db()/get_session()
and every SQLModel query are identical across both — the schema is pure SQLModel.
"""
from __future__ import annotations

from collections.abc import Iterator

from sqlmodel import Session, SQLModel, create_engine, select

from .config import get_settings
from .models import AllowedEmail

_settings = get_settings()
if _settings.is_sqlite:
    _engine = create_engine(
        _settings.sqlalchemy_url,
        connect_args={"check_same_thread": False},
    )
else:
    # Neon auto-suspends idle connections (scale-to-zero); pre_ping discards dead
    # pooled connections and recycle caps connection age. These keep the pool
    # correct after a resume; they don't mask the first-query cold-start latency.
    _engine = create_engine(
        _settings.sqlalchemy_url,
        pool_pre_ping=True,
        pool_recycle=300,
    )


def init_db() -> None:
    SQLModel.metadata.create_all(_engine)
    # Seed the allowlist from config (idempotent).
    with Session(_engine) as session:
        existing = {e.email for e in session.exec(select(AllowedEmail)).all()}
        for email in _settings.allowlist:
            if email not in existing:
                session.add(AllowedEmail(email=email))
        session.commit()


def get_engine():
    return _engine


def get_session() -> Iterator[Session]:
    with Session(_engine) as session:
        yield session

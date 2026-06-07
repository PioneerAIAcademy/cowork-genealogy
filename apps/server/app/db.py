"""SQLite engine + schema bootstrap + the allowlist seed."""
from __future__ import annotations

from collections.abc import Iterator

from sqlmodel import Session, SQLModel, create_engine, select

from .config import get_settings
from .models import AllowedEmail

_settings = get_settings()
_engine = create_engine(
    f"sqlite:///{_settings.db_path}",
    connect_args={"check_same_thread": False},
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

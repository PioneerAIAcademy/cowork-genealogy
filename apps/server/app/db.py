"""DB engine + schema bootstrap + the allowlist seed.

Backend is env-driven (see config.sqlalchemy_url): unset DATABASE_URL → SQLite
under DATA_DIR (local dev); set → Postgres (Neon on Fly). init_db()/get_session()
and every SQLModel query are identical across both — the schema is pure SQLModel.
"""
from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import inspect, text
from sqlmodel import Session, SQLModel, create_engine, select

from .config import get_settings
from .models import AllowedEmail, TurnCost

_settings = get_settings()
if _settings.is_sqlite:
    _backend_options: dict = {"connect_args": {"check_same_thread": False}}
else:
    # Neon auto-suspends idle connections (scale-to-zero); pre_ping discards dead
    # pooled connections and recycle caps connection age. These keep the pool
    # correct after a resume; they don't mask the first-query cold-start latency.
    _backend_options = {"pool_pre_ping": True, "pool_recycle": 300}
# hide_parameters stops SQLAlchemy echoing bound values into its error messages: some
# queries bind users' emails (the revocation sweep in main.py), and a failure logged
# with its traceback would print them (#3305). A driver's own message can still carry
# a value, such as Postgres's DETAIL on a unique violation. One call for both
# backends, so the SQLite test suite pins it for Postgres too.
_engine = create_engine(_settings.sqlalchemy_url, hide_parameters=True, **_backend_options)


def add_missing_columns(engine, model) -> list[str]:
    """Add ``model``'s columns that its live table lacks, and return their names.

    ``create_all`` creates a missing table but never alters one that exists, so a column
    added to a deployed table's model would otherwise be absent and every insert naming it
    would fail. Nullable columns only: adding a NOT NULL column to a table with rows fails.
    """
    table = model.__table__
    have = {c["name"] for c in inspect(engine).get_columns(table.name)}
    missing = [c for c in table.columns if c.name not in have]
    with engine.begin() as conn:
        for col in missing:
            conn.execute(text(
                f"ALTER TABLE {table.name} ADD COLUMN {col.name} {col.type.compile(engine.dialect)}"
            ))
    return [c.name for c in missing]


def init_db() -> None:
    """Bootstrap schema + sync allowlist."""
    SQLModel.metadata.create_all(_engine)
    add_missing_columns(_engine, TurnCost)
    if not _settings.allowlist:
        return
    with Session(_engine) as session:
        existing = {e.email: e for e in session.exec(select(AllowedEmail)).all()}
        for email in _settings.allowlist:
            if email not in existing:
                session.add(AllowedEmail(email=email))
        for email in set(existing) - _settings.allowlist:
            session.delete(existing[email])
        session.commit()


def get_engine():
    return _engine


def get_session() -> Iterator[Session]:
    with Session(_engine) as session:
        yield session

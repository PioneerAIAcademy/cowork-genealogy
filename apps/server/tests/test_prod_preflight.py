"""The production preflight: a deploy on dev-default secrets must not boot.

`assert_production_config` is called first in `main.py`'s lifespan. Everything it
checks is silent when wrong — forgeable cookies, forgeable WS tokens, a database on
ephemeral rootfs — so a refusal is the only signal there is.

Every case constructs `Settings(...)` explicitly and passes **every field the check
reads**, including the ones meant to be at their defaults (as
`Settings.model_fields[...].default`). Omitting a field does NOT give you its default:
`Settings` reads `os.environ`, and conftest.py already sets `SESSION_SECRET` and
`DATABASE_URL` there — so an omitted field would quietly carry a non-default value and
the "all defaults" case would pass without exercising a single default.

The unit cases call the function directly rather than through `get_settings()`, which
is `@lru_cache`d and would need `cache_clear()` after any monkeypatch. They do not,
however, prove the lifespan calls it at all — `test_lifespan_refuses_to_boot` is what
covers that, and it is the acceptance check for issue #1123.
"""
import pytest
from fastapi.testclient import TestClient

from app.config import Settings, assert_production_config, get_settings
from app.main import app

_DEFAULT_SESSION_SECRET = Settings.model_fields["session_secret"].default
_DEFAULT_WS_SIGNING_KEY = Settings.model_fields["ws_signing_key"].default

# A fully-configured production deploy: https host, both secrets set, real Postgres.
_PROD = {
    "public_url": "https://genealogy-workbench.fly.dev",
    "session_secret": "0f9c3a1e7b524d68a0c5e2f8d31b47a9",
    "ws_signing_key": "6d2b8f04c7e19a35bd80f6127ce4a9db",
    "database_url": "postgresql://u:p@ep-x.aws.neon.tech/db?sslmode=require",
}


def _settings(**overrides) -> Settings:
    return Settings(**{**_PROD, **overrides})


def test_prod_with_everything_set_returns_cleanly():
    assert_production_config(_settings()) is None


@pytest.mark.parametrize(
    ("field", "value", "expected_in_message"),
    [
        ("session_secret", _DEFAULT_SESSION_SECRET, "SESSION_SECRET"),
        ("ws_signing_key", _DEFAULT_WS_SIGNING_KEY, "WS_SIGNING_KEY"),
        ("database_url", None, "DATABASE_URL"),
    ],
)
def test_prod_with_a_default_refuses_and_names_it(field, value, expected_in_message):
    with pytest.raises(RuntimeError) as exc:
        assert_production_config(_settings(**{field: value}))
    assert expected_in_message in str(exc.value)


def test_refusal_names_every_offender_at_once():
    """One deploy fixes all three — not one restart per discovery."""
    with pytest.raises(RuntimeError) as exc:
        assert_production_config(
            _settings(
                session_secret=_DEFAULT_SESSION_SECRET,
                ws_signing_key=_DEFAULT_WS_SIGNING_KEY,
                database_url=None,
            )
        )
    message = str(exc.value)
    assert "SESSION_SECRET" in message
    assert "WS_SIGNING_KEY" in message
    assert "DATABASE_URL" in message


def test_local_http_with_all_defaults_boots():
    """Local dev must still start with zero setup — the whole POC posture."""
    local = _settings(
        public_url="http://127.0.0.1:1837",
        session_secret=_DEFAULT_SESSION_SECRET,
        ws_signing_key=_DEFAULT_WS_SIGNING_KEY,
        database_url=None,
    )
    assert assert_production_config(local) is None


def test_lifespan_refuses_to_boot(monkeypatch):
    """ACCEPTANCE CHECK (issue #1123).

    The deliverable is a *boot* refusal. Every case above passes even if the one-line
    `main.py` wiring is never written; this one does not. It is also the only test in
    the suite that enters a lifespan with an https `public_url`.
    """
    settings = get_settings()
    monkeypatch.setattr(settings, "public_url", "https://example.com")
    monkeypatch.setattr(settings, "ws_signing_key", _DEFAULT_WS_SIGNING_KEY)

    with pytest.raises(RuntimeError, match="WS_SIGNING_KEY"):
        with TestClient(app):
            pass

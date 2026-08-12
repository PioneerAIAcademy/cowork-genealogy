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


def test_secret_defaults_are_literals_so_the_comparison_can_work():
    """Guard the assumption the entire gate rests on.

    `assert_production_config` detects a dev-default secret with
    `getattr(s, field) == Settings.model_fields[field].default`. That only works
    while both fields declare **plain literal** defaults. Redeclare either with
    `Field(default_factory=...)` and `.default` becomes `PydanticUndefined`, the
    real dev secret compares `False`, and the gate silently passes a production
    deploy running on `dev-insecure-secret-change-me`.

    Nothing else catches it: every other test in this file injects
    `Settings.model_fields[...].default` as the *value*, so under a
    `default_factory` they would compare `PydanticUndefined` against itself and
    stay green. This is the one assertion that fails, and it fails immediately.
    """
    for field in ("session_secret", "ws_signing_key"):
        assert isinstance(Settings.model_fields[field].default, str), (
            f"{field} no longer declares a literal default. "
            f"assert_production_config compares against "
            f"Settings.model_fields['{field}'].default, which is now "
            f"PydanticUndefined — the production gate for this secret is dead. "
            f"Either restore the literal default or rewrite the check to read "
            f"the default_factory's value."
        )


def test_prod_with_everything_set_returns_cleanly():
    assert assert_production_config(_settings()) is None


@pytest.mark.parametrize(
    ("field", "value", "named", "not_named"),
    [
        ("session_secret", _DEFAULT_SESSION_SECRET, "SESSION_SECRET", ("WS_SIGNING_KEY", "DATABASE_URL")),
        ("ws_signing_key", _DEFAULT_WS_SIGNING_KEY, "WS_SIGNING_KEY", ("SESSION_SECRET", "DATABASE_URL")),
        ("database_url", None, "DATABASE_URL", ("SESSION_SECRET", "WS_SIGNING_KEY")),
    ],
)
def test_prod_with_a_default_refuses_and_names_only_it(field, value, named, not_named):
    """Names the offender — and *only* the offender.

    The negative half is the load-bearing one: without it, an implementation that
    reports every setting whenever any one of them is wrong passes green, and an
    operator who correctly rotated two of three is sent to rotate all three. That is
    the deploy cycle the collect-then-raise design exists to save.
    """
    with pytest.raises(RuntimeError) as exc:
        assert_production_config(_settings(**{field: value}))
    message = str(exc.value)
    assert named in message
    for other in not_named:
        assert other not in message, f"{other} is correctly configured but the refusal names it"


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

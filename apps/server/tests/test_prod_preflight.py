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

Nor does any of the above prove the refusal survives to a log a human reads:
`TestClient` re-raises it into pytest, while a deploy sees only what uvicorn writes
to its streams. `test_refusal_reaches_stderr_under_the_deploy_entrypoint` is the one
case that starts the app as a subprocess under the deploy's own `CMD` and asserts the
message lands on **stderr** — issue #1365's legibility half, carried on issue #2488.
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import (
    _DEFAULTED_SECRET_FIELDS,
    Settings,
    assert_production_config,
    get_settings,
)
from app.main import app

_DEFAULT_SESSION_SECRET = Settings.model_fields["session_secret"].default
_DEFAULT_WS_SIGNING_KEY = Settings.model_fields["ws_signing_key"].default
_DEFAULT_FS_TOKEN_ENC_KEY = Settings.model_fields["fs_token_enc_key"].default
_DEFAULT_PROXY_SIGNING_KEY = Settings.model_fields["anthropic_proxy_signing_key"].default

# A fully-configured production deploy: https host, all secrets set, real Postgres.
_PROD = {
    "public_url": "https://genealogy-workbench.fly.dev",
    "session_secret": "0f9c3a1e7b524d68a0c5e2f8d31b47a9",
    "ws_signing_key": "6d2b8f04c7e19a35bd80f6127ce4a9db",
    "fs_token_enc_key": "b1e7c93a4f0d5286a7c1e0f9d2463a8f",
    "anthropic_proxy_signing_key": "a3f8d27e1c0b94563d8e71f20a4c9b8d",
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
    for field in _DEFAULTED_SECRET_FIELDS:
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
        ("session_secret", _DEFAULT_SESSION_SECRET, "SESSION_SECRET", ("WS_SIGNING_KEY", "FS_TOKEN_ENC_KEY", "ANTHROPIC_PROXY_SIGNING_KEY", "DATABASE_URL")),
        ("ws_signing_key", _DEFAULT_WS_SIGNING_KEY, "WS_SIGNING_KEY", ("SESSION_SECRET", "FS_TOKEN_ENC_KEY", "ANTHROPIC_PROXY_SIGNING_KEY", "DATABASE_URL")),
        ("fs_token_enc_key", _DEFAULT_FS_TOKEN_ENC_KEY, "FS_TOKEN_ENC_KEY", ("SESSION_SECRET", "WS_SIGNING_KEY", "ANTHROPIC_PROXY_SIGNING_KEY", "DATABASE_URL")),
        ("anthropic_proxy_signing_key", _DEFAULT_PROXY_SIGNING_KEY, "ANTHROPIC_PROXY_SIGNING_KEY", ("SESSION_SECRET", "WS_SIGNING_KEY", "FS_TOKEN_ENC_KEY", "DATABASE_URL")),
        ("database_url", None, "DATABASE_URL", ("SESSION_SECRET", "WS_SIGNING_KEY", "FS_TOKEN_ENC_KEY", "ANTHROPIC_PROXY_SIGNING_KEY")),
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
                fs_token_enc_key=_DEFAULT_FS_TOKEN_ENC_KEY,
                anthropic_proxy_signing_key=_DEFAULT_PROXY_SIGNING_KEY,
                database_url=None,
            )
        )
    message = str(exc.value)
    assert "SESSION_SECRET" in message
    assert "WS_SIGNING_KEY" in message
    assert "FS_TOKEN_ENC_KEY" in message
    assert "ANTHROPIC_PROXY_SIGNING_KEY" in message
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


# ── The refusal must be legible where the deploy actually prints it ──────────
#
# Everything above runs in process. None of it can tell whether the refusal
# survives to a log a human reads: `TestClient` re-raises the RuntimeError
# straight into pytest, while a Fly deploy sees only what uvicorn writes to its
# streams. A refusal that fires but lands on stdout, or is swallowed into a
# clean exit, is indistinguishable from a healthy deploy in `fly logs` — the
# exact failure mode the gate exists to prevent.

_APPS_SERVER_DIR = Path(__file__).resolve().parents[1]
_REPO_ROOT = Path(__file__).resolve().parents[3]
_DOCKERFILE = _REPO_ROOT / "deploy" / "Dockerfile"
_CMD_RE = re.compile(r"^CMD\s+(\[.*\])\s*$", re.MULTILINE)


def _deploy_argv() -> list[str]:
    """The deploy's own `CMD`, parsed out of `deploy/Dockerfile` — never a copy.

    A restated argv would keep this test green through exactly the changes it
    exists to catch: a `CMD` switched to a shell form, to another server, or
    given a `--log-config` that points the default handler at stdout. The repo
    already derives rather than restates in the same situation — see
    `scripts/check-deploy-stage1.mjs`, which replays this Dockerfile's `web`
    stage, and `test_proto_config.py`, which parses `docker-compose.yml`.

    Asserting the match count is not ceremony: a shell-form `CMD` does not match
    the JSON-array pattern at all, so without it the failure is an opaque
    `AttributeError` on `None` rather than a statement about the Dockerfile. The
    file carries three build stages and exactly one `CMD`; `re.findall` over all
    of them is what stops a `CMD` added to an earlier stage winning silently.
    """
    matches = _CMD_RE.findall(_DOCKERFILE.read_text(encoding="utf-8"))
    assert len(matches) == 1, (
        f"expected exactly one JSON-array CMD in {_DOCKERFILE}, found "
        f"{len(matches)}. If CMD moved to a shell form or a second stage gained "
        f"one, this test no longer starts the app the way the deploy does — fix "
        f"the derivation rather than deleting the assertion."
    )
    argv = json.loads(matches[0])
    assert argv[0] == "uvicorn", (
        f"{_DOCKERFILE} no longer starts uvicorn directly (CMD[0]={argv[0]!r}). "
        f"This test asserts the refusal is legible under the real entrypoint, so "
        f"it has to follow."
    )
    assert "app.main:app" in argv, (
        f"{_DOCKERFILE}'s CMD no longer names app.main:app, so the lifespan this "
        f"test exercises is not the one the deploy runs."
    )
    return argv


def test_refusal_reaches_stderr_under_the_deploy_entrypoint(tmp_path):
    """The refusal must reach **stderr**, naming every offender, under `CMD`.

    Issue #1365's legibility half (carried on umbrella issue #2488). The
    in-process cases above prove the function refuses and that the lifespan calls
    it; this is the only one that proves the message survives to a stream Fly
    collects. Reachability under a real deploy stays parked — it needs a staging
    target, and `deploy/` holds one fly.toml, the live app.

    Hermetic by construction: `Settings` reads a `.env`, so a developer's
    `apps/server/.env` could otherwise supply a real secret and leave a field
    unchecked. Every field the gate reads is set explicitly here, and env vars
    outrank `.env` in pydantic-settings. `DATABASE_URL` is set **blank** rather
    than unset — `is_sqlite` is `not database_url`, so blank trips it, and an
    explicitly-set empty var beats a `.env` entry where an absent one does not.

    The env is a **merge** over `os.environ`, not a replacement: a child started
    without `SystemRoot`/`PATH` dies before Python's socket and ssl init on
    Windows, where the genealogist team runs. The merge stays hermetic because
    the overrides cover every field `assert_production_config` reads.
    """
    argv = _deploy_argv()
    # Two deliberate divergences from the deploy's argv, both about not fighting
    # the machine this runs on: `sys.executable -m` so no console script needs to
    # be on PATH, and a loopback host on an OS-assigned port so nothing collides
    # in CI or trips a macOS firewall prompt by binding every interface.
    cmd = [sys.executable, "-m", *argv]
    for flag, value in (("--host", "127.0.0.1"), ("--port", "0")):
        # Assert rather than substitute-if-present. A CMD that drops `--port`
        # would otherwise leave the child on uvicorn's own default — 0.0.0.0:8000
        # — so the no-collision and no-firewall-prompt guarantees would lapse in
        # silence, which is the same silent no-op the match-count assertion above
        # exists to prevent.
        assert flag in cmd, (
            f"{_DOCKERFILE}'s CMD no longer passes {flag}, so this test cannot "
            f"redirect it. Without {flag} the child would bind uvicorn's default "
            f"0.0.0.0:8000 and could collide in CI."
        )
        cmd[cmd.index(flag) + 1] = value

    env = {
        **os.environ,
        "PUBLIC_URL": "https://example.fly.dev",  # the https production discriminant
        "DATABASE_URL": "",
        "DATA_DIR": str(tmp_path),  # get_settings() mkdirs under this
        **{f.upper(): Settings.model_fields[f].default for f in _DEFAULTED_SECRET_FIELDS},
    }

    proc = subprocess.run(
        cmd,
        cwd=_APPS_SERVER_DIR,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=60,
    )

    # 1. It must not come up. Non-zero rather than == 3: uvicorn's exact
    #    startup-failure code is its contract, not ours.
    assert proc.returncode != 0, (
        f"the app started with a production URL and dev-default secrets.\n"
        f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    )

    # 2. The refusal reaches stderr — the whole point of this test.
    assert "Refusing to boot" in proc.stderr, (
        f"the refusal did not reach stderr, so a Fly deploy would show a crash "
        f"with no cause.\nstdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    )

    # 3. Legible, not merely present: every offender named, each with its remedy.
    expected = [f.upper() for f in _DEFAULTED_SECRET_FIELDS] + ["DATABASE_URL"]
    for name in expected:
        assert name in proc.stderr, (
            f"{name} is not named in the refusal on stderr, so one deploy cannot "
            f"fix every offender at once.\nstderr:\n{proc.stderr}"
        )
    assert proc.stderr.count("Fix:") == len(expected), (
        f"expected one 'Fix:' line per offender ({len(expected)}), found "
        f"{proc.stderr.count('Fix:')}. A named setting with no remedy is half a "
        f"message.\nstderr:\n{proc.stderr}"
    )

    # 4. And not on stdout, where it would be the wrong stream for a failure.
    assert "Refusing to boot" not in proc.stdout, (
        f"the refusal reached stdout.\nstdout:\n{proc.stdout}"
    )

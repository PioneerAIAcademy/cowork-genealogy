"""Shared fixtures for the harness unit suite.

**Auth stub.** Tests that drive the real ``_run_agent``
(``e2e/orchestrator.py``) evaluate ``env_for_sdk(resolve_auth())`` while
*assembling* the mocked ``query()`` call — so the auth check fires before the
mock ever runs. On keyless CI (``eval-harness-tests.yml`` runs bare
``uv run --frozen pytest`` — ``testpaths=["tests"]``, no marker filter — with no
``ANTHROPIC_API_KEY`` in the job env, no ``eval/.env``, and no ``~/.claude``)
``resolve_auth()`` raises ``AuthError`` there. Auth is not what those tests
exercise, so stub ``orchestrator.resolve_auth`` to a canned ``AuthConfig`` — the
idiom ``test_cli.py`` uses — for the whole unit suite. This makes the tests
order-independent instead of passing only because an earlier test leaked a key
into ``os.environ`` (issue #1201).

Surgical by design: only the ``orchestrator`` module's binding is patched, so
``test_auth.py`` (which exercises the real ``harness.auth.resolve_auth``) is
unaffected, and every unit test mocks ``query`` regardless, so the canned key is
never used to make a real call.
"""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _stub_orchestrator_auth(monkeypatch):
    from e2e import orchestrator
    from harness.auth import AuthConfig

    monkeypatch.setattr(
        orchestrator,
        "resolve_auth",
        lambda: AuthConfig(skill_runner_mode="api_key", api_key="x", detail="stub"),
    )

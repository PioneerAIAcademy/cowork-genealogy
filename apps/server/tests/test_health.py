"""`/api/health` — the route Fly polls, and the only production-visible answer to
"which build of the agent image is this session on?" (#1489).

This endpoint had no test at all before this file. It is worth one for a reason
beyond coverage: `deploy/fly.toml` points its health check here (every 15s, 5s
timeout, 20s grace) against the single always-on machine, so anything that makes
this route slow, throwing, or dependent on a remote service takes production out
of rotation ~5,760 times a day.
"""
from fastapi.testclient import TestClient

from app.main import app
from app.sandbox.base import SandboxProvider


class _ProviderWithCommit:
    """Stand-in for a provider that has read its image's provenance. Every other
    attribute access raises, which is the point: health must touch nothing else."""

    sandbox_image_commit = "abc123+dirty"

    def __getattr__(self, name):  # pragma: no cover - only reached on a regression
        raise AssertionError(f"/api/health must not touch provider.{name}")


class _ProviderWithoutTheAttribute:
    """An older or third-party provider that never heard of image provenance."""


def _health_with_provider(provider):
    """GET /api/health with `provider` on app.state, then put the real one back.

    The swap is undone inside the client's lifespan because the shutdown half
    calls `provider.aclose()` — leaving a stub in place would fail the teardown
    rather than the assertion, and on `_ProviderWithCommit` it would trip that
    class's own "health touched something else" guard from the wrong caller.
    """
    with TestClient(app) as client:
        real = app.state.provider
        app.state.provider = provider
        try:
            return client.get("/api/health")
        finally:
            app.state.provider = real


def test_health_reports_the_documented_shape():
    with TestClient(app) as client:
        r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert set(body) == {"ok", "agentMode", "provider", "db", "sandboxImageCommit"}


def test_sandbox_image_commit_is_null_before_any_session():
    """Null is the honest answer before this process has created a sandbox — the
    value is read off a real sandbox, never guessed from the deploy."""
    with TestClient(app) as client:              # conftest pins SANDBOX_PROVIDER=local
        body = client.get("/api/health").json()
    assert body["sandboxImageCommit"] is None


def test_health_reports_the_providers_baked_commit():
    r = _health_with_provider(_ProviderWithCommit())
    assert r.status_code == 200
    assert r.json()["sandboxImageCommit"] == "abc123+dirty"


def test_health_survives_a_provider_that_has_no_commit_attribute():
    """Degrade to null rather than 500 — a 500 here fails Fly's health check and
    pulls the machine out of rotation over a field that is only observability."""
    r = _health_with_provider(_ProviderWithoutTheAttribute())
    assert r.status_code == 200
    assert r.json()["sandboxImageCommit"] is None


def test_health_survives_no_provider_at_all():
    r = _health_with_provider(None)
    assert r.status_code == 200
    assert r.json()["sandboxImageCommit"] is None


def test_provider_contract_defaults_to_none_and_is_not_a_coroutine():
    """The base declares the field so a provider that bakes no image answers
    without the caller guessing, and so nobody implements it as an awaitable —
    an async read on this route would be exactly the E2B call hazard 1 forbids."""
    assert SandboxProvider.sandbox_image_commit.fget(object()) is None
    assert isinstance(SandboxProvider.sandbox_image_commit, property)


def test_e2b_provider_serves_health_without_touching_the_sdk():
    """A real E2BProvider with a bogus key and no network reachability: the route
    must still answer, because it reads a cached attribute and never calls E2B."""
    from app.sandbox.e2b import E2BProvider

    r = _health_with_provider(E2BProvider(api_key="not-a-real-key", template="genealogy-agent"))
    assert r.status_code == 200
    assert r.json()["sandboxImageCommit"] is None


class _ProviderWhoseCommitRaises:
    """A third-party provider that computes the value in a property instead of
    caching it. Out of contract (the base declares a plain read), but a 500 here
    fails Fly's health check and pulls the machine out of rotation."""

    @property
    def sandbox_image_commit(self):
        raise RuntimeError("E2B unreachable")


def test_health_survives_a_provider_whose_property_raises():
    r = _health_with_provider(_ProviderWhoseCommitRaises())
    assert r.status_code == 200
    assert r.json()["sandboxImageCommit"] is None

"""Test isolation: point the control plane at a throwaway data dir + a fixed
allowlist BEFORE the app (and its cached settings / DB engine) import.
"""
import os
import tempfile

_tmp = tempfile.mkdtemp(prefix="wb-test-")
os.environ.setdefault("DATA_DIR", _tmp)
os.environ.setdefault("ALLOWED_EMAILS", "tester@example.com")
os.environ.setdefault("SESSION_SECRET", "test-secret")
os.environ.setdefault("AGENT_MODE", "mock")
os.environ.setdefault("SANDBOX_PROVIDER", "local")

# Force test-deterministic values even when a developer's apps/server/.env sets
# real OAuth / Ably values. pydantic reads .env for anything os.environ doesn't
# already define, so these must be set explicitly (not setdefault) to win over
# the .env file.
os.environ["GOOGLE_CLIENT_ID"] = ""          # keep dev-login enabled in tests
os.environ["GOOGLE_CLIENT_SECRET"] = ""
os.environ["FAMILYSEARCH_WEB_ENABLED"] = "false"
os.environ["ANTHROPIC_API_KEY"] = ""         # keep the real key out of test assertions
os.environ["DATABASE_URL"] = ""              # tests always run on SQLite, never a dev .env Postgres
# An https PUBLIC_URL means "production" to config.assert_production_config, which the
# lifespan runs on every `with TestClient(app)`. The suite's DATABASE_URL is blank and
# its WS_SIGNING_KEY is the dev default, so the moment anyone puts an https PUBLIC_URL
# in apps/server/.env, every TestClient test would die on that refusal locally while CI
# (which has no .env) stayed green.
os.environ["PUBLIC_URL"] = "http://127.0.0.1:1837"


import sys  # noqa: E402

import pytest  # noqa: E402

_SQS_ENV_PREFIXES = ("AWS_", "GENEALOGY_SQS_")


def _reset_sqs_clients() -> None:
    # proto/enqueue.py is imported twice: as `enqueue` (the web image's layout) and as
    # `proto.enqueue` (the worker's), each with its own installed configuration.
    for name in ("enqueue", "proto.enqueue"):
        module = sys.modules.get(name)
        if module is not None and hasattr(module, "reset"):
            module.reset()


@pytest.fixture(autouse=True)
def _isolated_sqs_credentials(monkeypatch):
    """U7: proto/enqueue.py resolves AWS credentials for every SQS call, and a test that
    reaches botocore's default chain would read the developer's ~/.aws, or probe IMDS for
    a second or two and find nothing on CI -- results that depend on the machine. Every
    test starts with no AWS environment, no shared files, IMDS off, and nothing installed;
    a test that wants IMDS deletes AWS_EC2_METADATA_DISABLED itself."""
    for name in list(os.environ):
        if name.startswith(_SQS_ENV_PREFIXES):
            monkeypatch.delenv(name)
    monkeypatch.setenv("AWS_EC2_METADATA_DISABLED", "true")
    monkeypatch.setenv("AWS_SHARED_CREDENTIALS_FILE", "/nonexistent")
    monkeypatch.setenv("AWS_CONFIG_FILE", "/nonexistent")
    _reset_sqs_clients()
    yield
    _reset_sqs_clients()


if sys.platform == "win32":
    import asyncio  # noqa: E402

    def pytest_asyncio_loop_factories(config, item):
        """psycopg's async connection refuses Windows' default ProactorEventLoop with an
        InterfaceError before it connects, so every PgStore probe would report that
        instead of what the test set up. Production runs on Linux, where this is moot."""
        return {"selector": asyncio.SelectorEventLoop}

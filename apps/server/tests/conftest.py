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

# Public /v1 bearer keys. `api-bot@…` is deliberately NOT on the allowlist (above)
# — it proves an operator-granted key mints a User the allowlist would reject.
# `other-bot@…` is a second client used to test cross-client session isolation.
os.environ.setdefault("API_KEYS", "sk_test:api-bot@example.com,sk_other:other-bot@example.com")

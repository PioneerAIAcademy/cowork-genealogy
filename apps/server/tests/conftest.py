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
os.environ["REALTIME"] = "local_ws"          # the WS-relay tests assume this backend
os.environ["FAMILYSEARCH_WEB_ENABLED"] = "false"
os.environ["ANTHROPIC_API_KEY"] = ""         # keep the real key out of test assertions

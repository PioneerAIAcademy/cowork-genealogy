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

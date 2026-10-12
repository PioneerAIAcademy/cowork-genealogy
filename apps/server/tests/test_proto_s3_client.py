"""`_s3_client` builds a client when a blob store is configured.

This exists because the function's BODY was lost in the 2026-10-12 main merge, leaving
`if not S3_ENDPOINT: return None` and nothing else — so it returned None unconditionally.
Every sidecar on a deployed tier then answered "no blob store configured", the viewer read
that as "this log has no sidecar", and the status log went on saying SIDECAR BODIES DONE.

Nothing went red, and nothing could: every route test stubs the lookup
(`test_proto_web.py` asserts only the 404 path, `test_sidecar_read.py` tests the pure
helpers). A route test that stubs the client can never catch a broken client. This is the
check at the level where the break lives.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest

SERVER = next(q for q in Path(__file__).resolve().parents if (q / "proto/web/app.py").is_file())
sys.path.insert(0, str(SERVER))
sys.path.insert(0, str(SERVER / "proto"))


def _app_module(monkeypatch, endpoint: str):
    monkeypatch.setenv("GENEALOGY_S3_ENDPOINT", endpoint)
    monkeypatch.setenv("GENEALOGY_S3_ACCESS_KEY", "k")
    monkeypatch.setenv("GENEALOGY_S3_SECRET_KEY", "s")
    sys.modules.pop("web.app", None)
    module = importlib.import_module("web.app")
    module._s3_client.cache_clear()
    return module


def test_a_configured_endpoint_yields_a_client(monkeypatch):
    """THE regression. With an endpoint set, this must not be None — and must be able to
    fetch, which is the only thing the sidecar path asks of it."""
    app = _app_module(monkeypatch, "http://localhost:9000")
    client = app._s3_client()
    assert client is not None, (
        "returned None with a blob store configured — every sidecar will 404 and the "
        "viewer will render that as 'this log has no sidecar'"
    )
    assert hasattr(client, "get_object"), "the sidecar reader calls get_object on this"


def test_no_endpoint_means_no_client(monkeypatch):
    """The other direction: a deployment with no blob store serves every other route and
    its sidecars are legitimately absent. This must stay None, not raise."""
    app = _app_module(monkeypatch, "")
    assert app._s3_client() is None


def test_the_result_is_cached(monkeypatch):
    """`lru_cache` went missing with the body. Without it every sidecar request builds a
    fresh client."""
    app = _app_module(monkeypatch, "http://localhost:9000")
    assert app._s3_client() is app._s3_client()

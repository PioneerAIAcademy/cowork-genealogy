"""Researcher file uploads: POST /api/sessions/{id}/files.

This is the only path that puts caller-supplied bytes *and* a caller-supplied
name into a sandbox, so the filename validation is a security boundary, not a
nicety — most of these tests are about names that must never reach write_file.
"""
from fastapi.testclient import TestClient

from app.main import app
from app.sandbox.base import PROJECT_DIR


def _login_and_create(client: TestClient) -> str:
    r = client.post("/auth/dev-login", json={"email": "tester@example.com"})
    assert r.status_code == 200, r.text
    r = client.post("/api/sessions", json={"sample": True})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_upload_lands_in_uploads_dir_and_is_readable():
    with TestClient(app) as client:
        sid = _login_and_create(client)

        r = client.post(
            f"/api/sessions/{sid}/files",
            files={"file": ("bible-page.txt", b"Ada Schuster, b. 1841", "text/plain")},
        )
        assert r.status_code == 200, r.text
        assert r.json() == {"path": "uploads/bible-page.txt", "sizeBytes": 21}

        # The bytes must actually be in the sandbox where the agent reads them.
        from app.main import app as _app

        provider = _app.state.provider
        detail = client.get(f"/api/sessions/{sid}").json()
        sandbox = _run(provider.get(detail["sandbox_id"]))
        raw = _run(sandbox.read_file(f"{PROJECT_DIR}/uploads/bible-page.txt"))
        assert raw == b"Ada Schuster, b. 1841"


def test_traversal_is_neutralized_not_honoured():
    # A path in the filename is reduced to its basename rather than rejected —
    # browsers legitimately send one for directory uploads. What matters is that
    # the result can never escape uploads/, so assert the landing path directly.
    with TestClient(app) as client:
        sid = _login_and_create(client)
        for supplied, expected in (
            ("../escape.txt", "uploads/escape.txt"),
            ("../../etc/passwd", "uploads/passwd"),
            ("sub/dir.txt", "uploads/dir.txt"),
            ("C:\\Users\\ana\\deed.txt", "uploads/deed.txt"),
        ):
            r = client.post(
                f"/api/sessions/{sid}/files",
                files={"file": (supplied, b"x", "text/plain")},
            )
            assert r.status_code == 200, f"{supplied!r}: {r.text}"
            assert r.json()["path"] == expected, supplied


def test_upload_rejects_names_with_no_safe_basename():
    # Nothing survives the basename reduction, or the name is a dotfile: reject
    # outright rather than inventing one.
    with TestClient(app) as client:
        sid = _login_and_create(client)
        # ("" is omitted: httpx sends no file part at all for it, so FastAPI
        # rejects it as a missing upload before this endpoint is reached.)
        for bad in ("..", ".", ".hidden", "   ", "../"):
            r = client.post(
                f"/api/sessions/{sid}/files",
                files={"file": (bad, b"x", "text/plain")},
            )
            assert r.status_code == 400, f"{bad!r} was accepted: {r.text}"


def test_upload_rejects_empty_and_oversize():
    with TestClient(app) as client:
        sid = _login_and_create(client)

        r = client.post(
            f"/api/sessions/{sid}/files", files={"file": ("empty.txt", b"", "text/plain")}
        )
        assert r.status_code == 400

        too_big = b"x" * (25 * 1024 * 1024 + 1)
        r = client.post(
            f"/api/sessions/{sid}/files", files={"file": ("big.bin", too_big, "application/octet-stream")}
        )
        assert r.status_code == 413


def test_upload_requires_auth_and_ownership():
    with TestClient(app) as client:
        sid = _login_and_create(client)
        client.post("/auth/logout")
        r = client.post(
            f"/api/sessions/{sid}/files", files={"file": ("x.txt", b"x", "text/plain")}
        )
        assert r.status_code == 401

        # A different signed-in user must not be able to write into someone
        # else's sandbox.
        client.post("/auth/dev-login", json={"email": "someone-else@example.com"})
        r = client.post(
            f"/api/sessions/{sid}/files", files={"file": ("x.txt", b"x", "text/plain")}
        )
        assert r.status_code == 404


def _run(coro):
    """Drive a coroutine from a sync test (TestClient owns no loop we can reuse)."""
    import asyncio

    return asyncio.run(coro)

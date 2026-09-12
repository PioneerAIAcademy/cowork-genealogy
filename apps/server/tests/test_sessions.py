"""Session lifecycle over the real REST surface + LocalProvider:
dev-login (local, no allowlist) → create sample session → list → resume →
delete. Also asserts the sample seed lands real project files on the sandbox FS.
"""
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.config import get_settings
from app.db import get_engine
from app.main import app
from app.models import User


def test_unauthenticated_is_rejected():
    with TestClient(app) as client:
        assert client.get("/api/sessions").status_code == 401


def test_dev_login_accepts_any_email_locally():
    # No allowlist on the local dev-login path — any email signs in (the prod gate
    # is the Google callback's allowlist, exercised separately).
    with TestClient(app) as client:
        r = client.post("/auth/dev-login", json={"email": "stranger@example.com"})
        assert r.status_code == 200, r.text
        assert r.json()["email"] == "stranger@example.com"


def test_dev_login_blank_email_defaults():
    with TestClient(app) as client:
        r = client.post("/auth/dev-login", json={})  # email omitted
        assert r.status_code == 200, r.text
        assert r.json()["email"] == "dev@localhost"


def test_dev_login_refused_when_deployed(monkeypatch):
    # Backstop: on an https (deployed) host, dev-login is off even if Google was
    # never configured — so a misconfigured deploy can't become open signup.
    #
    # The flip happens INSIDE the started client: `with TestClient(app)` runs the
    # lifespan, whose first statement is config.assert_production_config — and an
    # https public_url with the suite's dev-default WS_SIGNING_KEY and blank
    # DATABASE_URL is exactly what that refuses to boot. Both endpoints below read
    # get_settings() per request, so flipping it after startup tests the same thing.
    with TestClient(app) as client:
        monkeypatch.setattr(get_settings(), "public_url", "https://example.com")
        assert client.get("/auth/config").json()["devLogin"] is False
        r = client.post("/auth/dev-login", json={"email": "anyone@example.com"})
        assert r.status_code == 403


def test_session_lifecycle_and_sample_seed():
    with TestClient(app) as client:
        # Login (any email; no allowlist locally).
        r = client.post("/auth/dev-login", json={"email": "tester@example.com"})
        assert r.status_code == 200, r.text
        assert r.json()["email"] == "tester@example.com"

        # /auth/me works with the cookie.
        assert client.get("/auth/me").status_code == 200

        # Create a sample-seeded session.
        r = client.post("/api/sessions", json={"sample": True})
        assert r.status_code == 200, r.text
        proj = r.json()
        sid = proj["id"]
        assert proj["title"] == "Sample research project"

        # It shows up in the list (the DB is shared across tests, so other
        # sessions may exist — just assert ours is present).
        r = client.get("/api/sessions")
        assert r.status_code == 200
        assert sid in [p["id"] for p in r.json()]

        # The sample seed actually wrote research.json into the sandbox FS.
        sandbox_id = proj["sandbox_id"]
        provider = app.state.provider
        sb = provider._root(sandbox_id) / "project" / "research.json"  # LocalProvider
        assert sb.is_file()

        # Resume + delete.
        assert client.post(f"/api/sessions/{sid}/resume").status_code == 200
        assert client.delete(f"/api/sessions/{sid}").status_code == 200
        assert sid not in [p["id"] for p in client.get("/api/sessions").json()]


def test_session_image_serves_saved_scan():
    with TestClient(app) as client:
        client.post("/auth/dev-login", json={"email": "img@example.com"})
        proj = client.post("/api/sessions", json={"sample": True}).json()
        sid = proj["id"]
        provider = app.state.provider
        images_dir = provider._root(proj["sandbox_id"]) / "project" / "images"  # LocalProvider
        images_dir.mkdir(parents=True, exist_ok=True)
        jpeg = bytes([0xFF, 0xD8, 0xFF, 0xD9])
        (images_dir / "004884748_02613.jpg").write_bytes(jpeg)

        # Serves the raw bytes as image/jpeg.
        r = client.get(
            f"/api/sessions/{sid}/image", params={"filename": "images/004884748_02613.jpg"}
        )
        assert r.status_code == 200, r.text
        assert r.headers["content-type"].startswith("image/jpeg")
        assert r.content == jpeg

        # Missing file → 404.
        assert (
            client.get(
                f"/api/sessions/{sid}/image", params={"filename": "images/missing.jpg"}
            ).status_code
            == 404
        )

        # Invalid filename (traversal / subdir / wrong shape) → 400.
        for bad in ("images/../secret.jpg", "images/sub/x.jpg", "x.jpg", "images/x.png"):
            assert (
                client.get(f"/api/sessions/{sid}/image", params={"filename": bad}).status_code
                == 400
            ), bad

        client.delete(f"/api/sessions/{sid}")


def test_logout_revokes_all_sessions():
    """After logout, a copied session cookie from the same user is rejected."""
    with TestClient(app) as client:
        client.post("/auth/dev-login", json={"email": "revoke-logout@example.com"})
        assert client.get("/auth/me").status_code == 200

        stolen = client.cookies.get("wb_session")

        client.post("/auth/logout")
        assert client.get("/auth/me").status_code == 401

        # A second client presenting the pre-logout cookie is also rejected.
        with TestClient(app, cookies={"wb_session": stolen}) as thief:
            r = thief.get("/auth/me")
            assert r.status_code == 401, "stolen cookie must be rejected after logout"

    with Session(get_engine()) as s:
        u = s.exec(
            select(User).where(
                User.email == "revoke-logout@example.com"
            )
        ).first()
        if u:
            s.delete(u)
            s.commit()


def test_login_after_revocation_works():
    """A fresh login after logout works immediately: the new cookie's iat is
    strictly greater than the revocation stamp, which is never cleared."""
    with TestClient(app) as client:
        client.post("/auth/dev-login", json={"email": "relogin@example.com"})
        client.post("/auth/logout")
        assert client.get("/auth/me").status_code == 401

        client.post("/auth/dev-login", json={"email": "relogin@example.com"})
        assert client.get("/auth/me").status_code == 200, \
            "fresh login after revocation must succeed"

    with Session(get_engine()) as s:
        u = s.exec(
            select(User).where(
                User.email == "relogin@example.com"
            )
        ).first()
        if u:
            s.delete(u)
            s.commit()


def test_pre_feature_cookie_rejected_after_revocation():
    """A cookie minted before the iat feature (no iat field) is rejected once
    sessions_revoked_at is set — it defaults to iat=0, which is always older."""
    from app.auth import _serializer, COOKIE_NAME, COOKIE_MAX_AGE

    with TestClient(app) as client:
        client.post("/auth/dev-login", json={"email": "legacy-cookie@example.com"})

        with Session(get_engine()) as s:
            user = s.exec(
                select(User).where(
                    User.email == "legacy-cookie@example.com"
                )
            ).first()
            uid = user.id

        legacy_token = _serializer().dumps({"uid": uid})

        client.post("/auth/logout")

        with TestClient(app, cookies={"wb_session": legacy_token}) as legacy:
            r = legacy.get("/auth/me")
            assert r.status_code == 401, \
                "pre-feature cookie (no iat) must be rejected after revocation"

    with Session(get_engine()) as s:
        u = s.get(User, uid)
        if u:
            s.delete(u)
            s.commit()


def test_api_key_request_does_not_undo_revocation(monkeypatch):
    """A /v1 bearer request must not clear sessions_revoked_at — otherwise a
    user holding both a cookie and an API key can undo their own logout."""
    from app.config import get_settings

    email = "dual-auth@example.com"
    monkeypatch.setattr(
        get_settings(), "api_keys", f"sk_dual:{email}",
    )

    with TestClient(app) as client:
        client.post("/auth/dev-login", json={"email": email})
        stolen = client.cookies.get("wb_session")
        client.post("/auth/logout")

        with TestClient(app) as api_client:
            r = api_client.delete(
                "/v1/sessions/prj_nonexistent",
                headers={"Authorization": "Bearer sk_dual"},
            )
            assert r.status_code == 404, \
                f"bearer dependency did not run: {r.status_code} {r.text}"

        with TestClient(app, cookies={"wb_session": stolen}) as thief:
            r = thief.get("/auth/me")
            assert r.status_code == 401, \
                "API-key request must not un-revoke cookie sessions"

    with Session(get_engine()) as s:
        u = s.exec(
            select(User).where(User.email == email)
        ).first()
        if u:
            s.delete(u)
            s.commit()


def test_revoked_cookie_is_not_resurrected_by_a_later_login():
    """A stolen cookie must stay dead even after the victim logs back in."""
    with TestClient(app) as client:
        client.post("/auth/dev-login", json={"email": "v@example.com"})
        stolen = client.cookies.get("wb_session")

        def stolen_works():
            with TestClient(app) as thief:
                thief.cookies.set("wb_session", stolen)
                return thief.get("/api/sessions").status_code

        assert stolen_works() == 200
        client.post("/auth/logout")
        assert stolen_works() == 401
        client.post("/auth/dev-login", json={"email": "v@example.com"})
        assert client.get("/api/sessions").status_code == 200
        assert stolen_works() == 401, "revoked cookie must stay revoked"

    with Session(get_engine()) as s:
        u = s.exec(select(User).where(User.email == "v@example.com")).first()
        if u:
            s.delete(u)
            s.commit()

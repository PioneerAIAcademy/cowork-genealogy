"""Control-plane configuration. Everything is env-driven so the same code runs
locally (mocks, no external accounts) and, later, hosted (E2B + real OAuth).

POC posture: sensible defaults that let `make server` boot with zero setup.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Repo root = .../cowork-genealogy (apps/server/app/config.py -> parents[3])
REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ── Agent runtime ────────────────────────────────────────────
    # "mock" → deterministic scripted agent (no Anthropic key needed).
    # "real" → the Claude Agent SDK driving the genealogy skills + MCP server.
    agent_mode: str = "mock"
    anthropic_api_key: str | None = None
    default_model: str = "claude-sonnet-4-6"
    # OpenRouter key for the engine's image_transcribe OCR tool. The in-sandbox
    # MCP server reads it config-only (never from env), so — unlike
    # ANTHROPIC_API_KEY, which the Agent SDK reads from the sandbox env — this
    # is written into the sandbox's ~/.familysearch-mcp/config.json on connect
    # (fs_oauth.write_config, sessions.create_project). See
    # docs/specs/image-transcribe-tool-spec.md §6.5.
    openrouter_api_key: str | None = None

    # ── Build identity ───────────────────────────────────────────
    # Stamped into every feedback bundle so triage can tell which build a case
    # came from. Set at image build time by deploy/Dockerfile ARGs, which
    # `make deploy` fills from git. Both stay "dev" locally, where the running
    # code is just the working tree. build_date is the human-readable half —
    # a date tells a triager "this is from before Tuesday's fix" at a glance;
    # git_sha is the exact-checkout half.
    git_sha: str = "dev"
    build_date: str = "dev"

    # ── Sandbox provider ─────────────────────────────────────────
    # "local" → LocalProvider (subprocess + local dir; the POC default).
    # "e2b"   → E2BProvider (per-user microVM; needs E2B_API_KEY).
    sandbox_provider: str = "local"
    e2b_api_key: str | None = None
    e2b_template: str = "genealogy-agent"

    # ── Auth ─────────────────────────────────────────────────────
    session_secret: str = "dev-insecure-secret-change-me"
    # Session cookie `secure` flag. None → derive from public_url scheme (http →
    # not secure, so local http works). Set true/false to force (e.g. hosted
    # behind a TLS-terminating proxy where public_url is https but the app sees
    # http). See auth.cookie_secure().
    session_cookie_secure: bool | None = None
    # Master key for per-sandbox WS tokens (realtime re-arch). The CP derives a
    # per-sandbox secret = HMAC(ws_signing_key, sandbox_id), injects it into the
    # sandbox as WS_TOKEN_SECRET, and mints short-lived handshake tokens with it.
    # A compromised sandbox can forge a token only for ITSELF. Must be stable
    # across CP restarts/instances. NOT the session_secret (that signs cookies).
    ws_signing_key: str = "dev-ws-signing-key-change-me"
    # Feedback uploads go to the same Google Apps Script -> Drive endpoint the
    # Electron viewer uses (no local-disk write, so the control plane scales to
    # >1 instance). Override with FEEDBACK_URL for a local/dev endpoint.
    feedback_url: str = (
        "https://script.google.com/macros/s/"
        "AKfycbxcMvfhpCqLzSa5sZBrssr48QfqrpFhW9DMRkxG8RYQfGGJIXoCEzbyPHrpT1XWZzcs/exec"
    )
    # Comma-separated email allowlist (app access gate). Matched against the
    # **FamilySearch-account** email returned by /users/current at login — which
    # may differ from a person's Google/contact email. Dallan only for now;
    # override per-deployment with ALLOWED_EMAILS.
    allowed_emails: str = "dallan@quass.org"
    # Real FamilySearch web OAuth (optional; when off the UI offers dev-login and
    # the agent runs in mock mode — no FS token is needed or injected).
    familysearch_web_enabled: bool = False
    # Public base URL (Tailscale Funnel in prod) for OAuth redirects.
    public_url: str = "http://localhost:8000"

    # ── Public /v1 REST API (bearer keys for an external chatbot team) ───
    # Comma-separated `key:email` pairs. Operator-granted: presence here IS the
    # grant (NOT subject to the Gmail allowlist — see auth.get_api_client). Each
    # key maps to the same User row its email would create on the browser path,
    # so ownership (_owned) isolates one client's sessions from another's. Give
    # each distinct client a distinct email; two keys sharing an email share a
    # User (and therefore its sessions).
    api_keys: str = ""
    # Sync turn cap. A turn that runs longer ends in 504 turn_timeout; streaming
    # (stream:true) relies on heartbeats instead of a hard cap.
    v1_turn_timeout_seconds: int = 120
    # Staleness TTL for the per-session turn lock (Project.turn_locked_at). A lock
    # older than this is reclaimed by the next caller, so a crashed/killed instance
    # can't wedge a session forever. Must exceed the longest expected turn.
    v1_turn_lock_stale_seconds: int = 600

    # ── Storage ──────────────────────────────────────────────────
    # LocalProvider per-session sandbox dirs + the SQLite DB live here.
    # (Feedback goes to Google Drive; no other local-disk writes.)
    data_dir: Path = REPO_ROOT / ".workbench-data"

    # ── Database ─────────────────────────────────────────────────
    # Unset → SQLite under DATA_DIR (local dev, zero-setup). Set → Postgres
    # (Neon on Fly), provided as a Fly secret. Neon hands out postgresql://… ;
    # sqlalchemy_url pins the psycopg(3) driver. Backend swap = env only.
    database_url: str | None = None

    # ── Dev / serving ────────────────────────────────────────────
    # Web client origin for CORS during local dev (Vite).
    web_origin: str = "http://localhost:5173"
    # In production (one-container deploy) the control plane serves the built
    # web client from this dir (same origin). Unset in local dev (Vite serves it).
    web_dist_dir: Path | None = None

    @property
    def allowlist(self) -> set[str]:
        return {e.strip().lower() for e in self.allowed_emails.split(",") if e.strip()}

    @property
    def api_key_map(self) -> dict[str, str]:
        """Parse `api_keys` into {key: email}. Malformed pairs are skipped."""
        out: dict[str, str] = {}
        for pair in self.api_keys.split(","):
            pair = pair.strip()
            if not pair or ":" not in pair:
                continue
            key, email = pair.split(":", 1)
            key, email = key.strip(), email.strip().lower()
            if key and email:
                out[key] = email
        return out

    @property
    def familysearch_client_id(self) -> str | None:
        """The FS OAuth client id, read from the bundled
        packages/engine/mcp-server/config/familysearch.json — the SOLE source (CLAUDE.md auth
        convention). The web flow reuses the desktop registration, so it must
        present this exact id (and the in-sandbox MCP refreshes with the same)."""
        p = REPO_ROOT / "packages" / "engine" / "mcp-server" / "config" / "familysearch.json"
        try:
            return json.loads(p.read_text(encoding="utf-8"))["clientId"]
        except (OSError, KeyError, json.JSONDecodeError):
            return None

    @property
    def familysearch_configured(self) -> bool:
        # Both the flag AND a resolvable client id (so flipping the flag without
        # the bundled config doesn't strand /auth/familysearch/login at 501 while
        # dev-login is disabled). When True, FS login is the only app login.
        return self.familysearch_web_enabled and bool(self.familysearch_client_id)

    @property
    def db_path(self) -> Path:
        return self.data_dir / "workbench.db"

    @property
    def is_sqlite(self) -> bool:
        return not self.database_url

    @property
    def sqlalchemy_url(self) -> str:
        """Resolve the SQLAlchemy URL. Unset DATABASE_URL → local SQLite. Set →
        Postgres, normalizing Neon's postgres://|postgresql:// to the explicit
        psycopg(3) driver SQLAlchemy needs."""
        url = self.database_url
        if not url:
            return f"sqlite:///{self.db_path}"
        if url.startswith("postgres://"):
            url = "postgresql+psycopg://" + url[len("postgres://"):]
        elif url.startswith("postgresql://"):
            url = "postgresql+psycopg://" + url[len("postgresql://"):]
        return url

    @property
    def sandboxes_dir(self) -> Path:
        return self.data_dir / "sandboxes"


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.data_dir.mkdir(parents=True, exist_ok=True)
    s.sandboxes_dir.mkdir(parents=True, exist_ok=True)
    return s

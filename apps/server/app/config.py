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

    # ── Sandbox provider ─────────────────────────────────────────
    # "local" → LocalProvider (subprocess + local dir; the POC default).
    # "e2b"   → E2BProvider (per-user microVM; needs E2B_API_KEY).
    sandbox_provider: str = "local"
    e2b_api_key: str | None = None
    e2b_template: str = "genealogy-agent"

    # ── Realtime relay ───────────────────────────────────────────
    # "local_ws" → server relays over its own WebSocket (POC default).
    # "ably" → publish fanout to per-session Ably channels (browser subscribes
    #          directly + chat input via REST; needs ABLY_API_KEY).
    # "ably_mock" → in-process pub/sub mimicking Ably (dev/tests, no account).
    realtime: str = "local_ws"
    ably_api_key: str | None = None  # required only when realtime == "ably"

    # ── Auth ─────────────────────────────────────────────────────
    session_secret: str = "dev-insecure-secret-change-me"
    # Session cookie `secure` flag. None → derive from public_url scheme (http →
    # not secure, so local http works). Set true/false to force (e.g. hosted
    # behind a TLS-terminating proxy where public_url is https but the app sees
    # http). See auth.cookie_secure().
    session_cookie_secure: bool | None = None
    # Feedback uploads go to the same Google Apps Script -> Drive endpoint the
    # Electron viewer uses (no local-disk write, so the control plane scales to
    # >1 instance). Override with FEEDBACK_URL for a local/dev endpoint.
    feedback_url: str = (
        "https://script.google.com/macros/s/"
        "AKfycbxcMvfhpCqLzSa5sZBrssr48QfqrpFhW9DMRkxG8RYQfGGJIXoCEzbyPHrpT1XWZzcs/exec"
    )
    # Comma-separated Gmail allowlist (app access gate). Dallan only for now;
    # override per-deployment with ALLOWED_EMAILS.
    allowed_emails: str = "dallan@gmail.com"
    # Real Google OIDC (optional; when unset the UI offers dev-login).
    google_client_id: str | None = None
    google_client_secret: str | None = None
    # Real FamilySearch web OAuth (optional; when off the UI offers dev-connect).
    familysearch_web_enabled: bool = False
    # Public base URL (Tailscale Funnel in prod) for OAuth redirects.
    public_url: str = "http://localhost:8000"

    # ── Storage ──────────────────────────────────────────────────
    # LocalProvider per-session sandbox dirs + the SQLite DB live here.
    # (Feedback goes to Google Drive; no other local-disk writes.)
    data_dir: Path = REPO_ROOT / ".workbench-data"

    # Idle sessions with no live WebSocket are suspended after this long
    # (cost control; pauses the E2B microVM. Mostly a no-op for LocalProvider).
    idle_suspend_seconds: int = 1800

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
    def familysearch_client_id(self) -> str | None:
        """The FS OAuth client id, read from the bundled
        mcp-server/config/familysearch.json — the SOLE source (CLAUDE.md auth
        convention). The web flow reuses the desktop registration, so it must
        present this exact id (and the in-sandbox MCP refreshes with the same)."""
        p = REPO_ROOT / "mcp-server" / "config" / "familysearch.json"
        try:
            return json.loads(p.read_text())["clientId"]
        except (OSError, KeyError, json.JSONDecodeError):
            return None

    @property
    def familysearch_configured(self) -> bool:
        # Both the flag AND a resolvable client id (so flipping the flag without
        # the bundled config doesn't strand /login at 501 with dev-connect off).
        return self.familysearch_web_enabled and bool(self.familysearch_client_id)

    @property
    def db_path(self) -> Path:
        return self.data_dir / "workbench.db"

    @property
    def sandboxes_dir(self) -> Path:
        return self.data_dir / "sandboxes"


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.data_dir.mkdir(parents=True, exist_ok=True)
    s.sandboxes_dir.mkdir(parents=True, exist_ok=True)
    return s

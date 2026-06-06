"""Control-plane configuration. Everything is env-driven so the same code runs
locally (mocks, no external accounts) and, later, hosted (E2B + real OAuth).

POC posture: sensible defaults that let `make server` boot with zero setup.
"""
from __future__ import annotations

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
    # "ably"/"pusher" → publish deltas to a pub/sub channel (production;
    # leaves the REST API stateless/serverless). Adapter stubbed for now.
    realtime: str = "local_ws"

    # ── Auth ─────────────────────────────────────────────────────
    session_secret: str = "dev-insecure-secret-change-me"
    # Comma-separated Gmail allowlist (app access gate).
    allowed_emails: str = "dallan@gmail.com,tester@example.com"
    # Real Google OIDC (optional; when unset the UI offers dev-login).
    google_client_id: str | None = None
    google_client_secret: str | None = None
    # Real FamilySearch web OAuth (optional; when off the UI offers dev-connect).
    familysearch_web_enabled: bool = False
    # Public base URL (Tailscale Funnel in prod) for OAuth redirects.
    public_url: str = "http://localhost:8000"

    # ── Storage ──────────────────────────────────────────────────
    # Per-session sandbox dirs + the local viewer backup mirror live here.
    data_dir: Path = REPO_ROOT / ".workbench-data"

    # ── Dev ──────────────────────────────────────────────────────
    # Web client origin for CORS during local dev (Vite).
    web_origin: str = "http://localhost:5173"

    @property
    def allowlist(self) -> set[str]:
        return {e.strip().lower() for e in self.allowed_emails.split(",") if e.strip()}

    @property
    def familysearch_configured(self) -> bool:
        return self.familysearch_web_enabled

    @property
    def db_path(self) -> Path:
        return self.data_dir / "workbench.db"

    @property
    def sandboxes_dir(self) -> Path:
        return self.data_dir / "sandboxes"

    @property
    def backup_dir(self) -> Path:
        return self.data_dir / "backup"


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.data_dir.mkdir(parents=True, exist_ok=True)
    s.sandboxes_dir.mkdir(parents=True, exist_ok=True)
    s.backup_dir.mkdir(parents=True, exist_ok=True)
    return s

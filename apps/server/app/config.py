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
    # Lay mode's auto-continue (issue #2653): the in-sandbox runner answers the
    # hand-back literal `Next: <step>. Continue?` with `Yes.` itself, so a stated
    # objective runs step by step with no click. Both reach the runner as
    # AUTO_CONTINUE / AUTO_CONTINUE_MAX_STEPS in the sandbox env. The budget
    # bounds one unattended chain (consecutive auto turns since the last real
    # user message), not the session. A frame may opt out with
    # `auto_continue: false` regardless of this setting. Per-session on/off lands
    # with the experience-level user setting (PR #2649).
    auto_continue: bool = True
    auto_continue_max_steps: int = 30
    # research-as-a-job 1d: the SDK Stop hook's veto cap per turn in the sandbox, which is
    # what makes one user message run a whole research job. Sized on STEP count, not on
    # the nudge histogram: over the 189 committed e2e runs, Skill/Task/Agent steps per run
    # are median 15, p90 25, p99 51, max 76. 0 turns the hook off, and `auto_continue:
    # false` turns it off too -- that flag already meant "one turn per message", and a new
    # mechanism that ignored it would take an operator's kill switch away without saying so.
    autonomous_max_nudges: int = 60
    # OpenRouter key for the engine's image_transcribe OCR tool. The in-sandbox
    # MCP server reads it config-only (never from env), so — unlike
    # ANTHROPIC_API_KEY, which is written into the sandbox by
    # agent_secrets.write_secrets on every connect — this
    # is written into the sandbox's ~/.familysearch-mcp/config.json on connect
    # (fs_oauth.write_config, sessions.create_project). See
    # docs/specs/image-transcribe-tool-spec.md §6.5.
    openrouter_api_key: str | None = None
    # Base URLs for the two hosted sidecar services the engine calls (the wiki
    # query API behind wiki_search/wiki_read/wiki_place_page, and the Pop Stats
    # API behind place_population). Written into the sandbox's
    # ~/.familysearch-mcp/config.json alongside the OpenRouter key. Left unset
    # the engine falls back to its compiled-in defaults, which today name one
    # developer's tailnet host — so these are how an operator points hosted
    # sessions at a real deployment without rebuilding and re-releasing the
    # engine (issue #290).
    wiki_api_url: str | None = None
    pop_stats_url: str | None = None

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
    # Master key for per-sandbox Anthropic proxy tokens. The CP derives a
    # per-sandbox token = HMAC(anthropic_proxy_signing_key, sandbox_id) and
    # passes it to the sandbox as the ANTHROPIC_API_KEY value. The proxy
    # endpoint validates it by recomputing the HMAC, then injects the real
    # Anthropic key — the sandbox never holds it. Same derivation pattern as
    # ws_signing_key; same rotation caveat (orphans existing sandboxes).
    anthropic_proxy_signing_key: str = "dev-proxy-signing-key-change-me"
    # Master key for encrypting FamilySearch OAuth tokens at rest in the DB
    # (familysearch_tokens.access_token / refresh_token, via crypto.EncryptedStr).
    # An arbitrary string like session_secret — a Fernet key is DERIVED from it
    # (crypto._fernet), so any strong random value works. Must be stable across
    # restarts/instances, or stored tokens become undecryptable and are treated as
    # "expired" (the user reconnects and the row re-encrypts; see crypto.py). A
    # default value in production is refused at boot (assert_production_config).
    fs_token_enc_key: str = "dev-insecure-fs-token-key-change-me"
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


def assert_production_config(s: Settings) -> None:
    """Refuse to boot a production deploy that is still on development defaults.

    Called first in `main.py`'s lifespan, so a misconfigured deploy exits at startup
    instead of coming up and quietly minting forgeable credentials. Everything
    checked here is silent when wrong — that is the entry criterion:

    - `session_secret` signs the login cookie (`auth._serializer`, salt `wb-session`)
      AND the FamilySearch OAuth `state` (`fs_oauth.fs_serializer`, salt `fs-oauth`),
      so a default value forges both a session and the login CSRF token.
    - `ws_signing_key` is the HMAC master key behind every per-sandbox WS handshake
      token (`ws_token.sandbox_secret`), so a default value forges all of them.
    - `fs_token_enc_key` encrypts the FamilySearch tokens at rest
      (`crypto.EncryptedStr`), so a default value encrypts every user's token under
      a public string — no better than plaintext to anyone who reads the DB.
    - `anthropic_proxy_signing_key` is the HMAC master key behind every per-sandbox
      proxy token (`anthropic_proxy.proxy_token`), so a default value lets anyone
      who guesses a sandbox_id forge a token and use the Anthropic key through the
      proxy.
    - An unset `DATABASE_URL` is SQLite under DATA_DIR, and `deploy/fly.toml` mounts
      no volume (the DB lives on Neon), so in production that is an ephemeral rootfs:
      every user, session and allowlist row is lost on the next machine restart.

    `ANTHROPIC_API_KEY` / `E2B_API_KEY` are deliberately NOT checked — their absence
    fails loudly on the first session create.

    Not a pydantic validator: `main.py` calls `get_settings()` at module scope, so a
    validator would fire at *import* and surface as a traceback rather than a refusal.

    The production discriminant is an https `public_url` — the same signal
    `auth.cookie_secure()` already uses. `deploy/fly.toml` sets it in `[env]` (not a
    secret, so it always ships) and both local targets pin http. NOT
    `sandbox_provider == "e2b"`, which would break `make server-e2b` locally.

    Raises:
        RuntimeError: naming every offending setting and its remedy, so one deploy
            fixes all of them rather than discovering them one restart at a time.
    """
    if not s.public_url.startswith("https"):
        return

    problems: list[str] = []

    # Compare against the DECLARED default, never a copied literal — a literal here
    # silently stops matching the day someone rewords the default above. This does
    # require both fields to keep plain literal defaults: redeclared with
    # `Field(default_factory=…)`, `.default` becomes PydanticUndefined, every
    # comparison goes False, and a defaulted secret ships with the gate green.
    # Guarded by test_prod_preflight.py::
    # test_secret_defaults_are_literals_so_the_comparison_can_work — no other
    # test catches it, because they all inject `.default` as the value.
    for field in ("session_secret", "ws_signing_key", "fs_token_enc_key",
                  "anthropic_proxy_signing_key"):
        if getattr(s, field) == Settings.model_fields[field].default:
            env = field.upper()
            problems.append(
                f"  {env} is still the development default.\n"
                f'    Fix: fly secrets set {env}="$(openssl rand -hex 32)"'
            )

    # `is_sqlite` is `not database_url`, so this covers unset AND set-but-blank.
    if s.is_sqlite:
        problems.append(
            "  DATABASE_URL is unset or blank, so this would run on SQLite under\n"
            "    DATA_DIR — ephemeral rootfs (deploy/fly.toml mounts no volume), losing\n"
            "    every user, session and allowlist row on the next machine restart.\n"
            "    Fix: fly secrets set "
            'DATABASE_URL="postgresql://USER:PASS@HOST.neon.tech/DB?sslmode=require"'
        )

    if problems:
        raise RuntimeError(
            f"Refusing to boot: PUBLIC_URL is {s.public_url} (a production deploy), "
            "but the configuration is incomplete.\n"
            + "\n".join(problems)
            + "\n  See DEVELOPMENT.md § Deploy to Fly.io."
        )


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.data_dir.mkdir(parents=True, exist_ok=True)
    s.sandboxes_dir.mkdir(parents=True, exist_ok=True)
    return s

"""Authentication for the harness.

Resolution order:
  1. Skill runner — prefer the API key. If ANTHROPIC_API_KEY is set
     (in the shell or in eval/.env via Setup.bat), the skill runner
     uses it. Subscription auth (~/.claude/) is only a fallback for
     the case where no key is configured.

     Policy: eval runs should bill the project's API key, not an
     operator's personal Claude subscription. Setup.bat collects the
     key and writes it to eval/.env; resolve_auth picks it up before
     checking for any subscription session.

  2. Judge — always uses an ANTHROPIC_API_KEY. The Anthropic SDK (the
     judge talks to it directly, bypassing the Agent SDK) has no
     subscription path. The judge errors if no API key is available.

Both layers are resolved from a single `AuthConfig`: `skill_runner_mode`
picks the skill runner's auth path; `api_key` is set whenever a key is
available, regardless of skill_runner_mode, and is the judge's
authoritative source.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import dotenv_values


HARNESS_DIR = Path(__file__).resolve().parents[1]
EVAL_DIR = HARNESS_DIR.parent
ENV_FILE = EVAL_DIR / ".env"
SUBSCRIPTION_DIRS = [Path.home() / ".claude"]


@dataclass
class AuthConfig:
    skill_runner_mode: str  # "subscription" | "api_key"
    api_key: str | None  # API key for the judge; also used by the skill runner when skill_runner_mode == "api_key"
    detail: str  # human-readable description for logs


class AuthError(Exception):
    pass


def resolve_auth() -> AuthConfig:
    """Resolve auth for both the skill runner and the judge.

    Skill runner: prefer the API key (from env or eval/.env). Fall back
    to subscription (~/.claude/) only when no key is configured.
    Judge: always uses the API key; errors at grade time if absent.

    Raises AuthError only when neither a key nor a subscription is
    available — in that case nothing can run.
    """
    api_key = _load_api_key()
    has_sub = _has_subscription()

    if api_key:
        return AuthConfig(
            skill_runner_mode="api_key",
            api_key=api_key,
            detail=(
                f"skill runner: ANTHROPIC_API_KEY (length={len(api_key)}); "
                f"judge: same key"
            ),
        )

    if has_sub:
        return AuthConfig(
            skill_runner_mode="subscription",
            api_key=None,
            detail=(
                f"skill runner: subscription auth from {SUBSCRIPTION_DIRS[0]} "
                "(fallback — no ANTHROPIC_API_KEY configured); "
                "judge: MISSING — judge will fail when reached"
            ),
        )

    raise AuthError(
        "No auth available. Set ANTHROPIC_API_KEY in your environment or "
        f"in {ENV_FILE} (Setup.bat does this for you), or run `claude` "
        "once to log into a subscription as a fallback."
    )


def _has_subscription() -> bool:
    for candidate in SUBSCRIPTION_DIRS:
        if candidate.is_dir():
            return True
    return False


def _load_api_key() -> str | None:
    if (key := os.environ.get("ANTHROPIC_API_KEY")):
        return key
    if ENV_FILE.exists():
        return dotenv_values(ENV_FILE).get("ANTHROPIC_API_KEY")
    return None


def env_for_sdk(auth: AuthConfig) -> dict[str, str]:
    """Env vars the Agent SDK subprocess should see.

    For api_key mode: explicitly inject the key (covers the case where it
    lives in eval/.env but isn't in the shell environment).

    For subscription mode: inject nothing. The SDK subprocess will use the
    CLI's session. See module docstring for the os.environ-inheritance
    caveat — if the operator has ANTHROPIC_API_KEY in their shell, the
    subprocess may still see and prefer it over the subscription session.

    `ENABLE_TOOL_SEARCH=true` eager-loads the genealogy MCP tool schemas
    at agent start (matches the e2e orchestrator + hosted-web agent). Without
    this flag the unit-test harness occasionally hits the deferred-tool
    registry path, where the agent doesn't find `research_append` / `tree_edit`
    via ToolSearch and falls back to "write JSON directly" — failing the test
    on Completeness/Tool-Arguments rather than the skill's actual logic.
    """
    env = {"ENABLE_TOOL_SEARCH": "true"}
    if auth.skill_runner_mode == "api_key" and auth.api_key:
        env["ANTHROPIC_API_KEY"] = auth.api_key
    return env

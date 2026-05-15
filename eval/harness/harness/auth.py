"""Authentication for the harness.

Resolution order:
  1. Skill runner — prefer subscription. If ~/.claude/ exists, the skill
     runner uses Claude Code subscription auth. Falls back to API key only
     when no subscription is available.
  2. Judge — always uses an ANTHROPIC_API_KEY. The Anthropic SDK (the
     judge talks to it directly, bypassing the Agent SDK) has no
     subscription path. The judge errors if no API key is available.

Both layers are resolved from a single `AuthConfig`: `skill_runner_mode`
picks the skill runner's auth path; `api_key` is set whenever a key is
available, regardless of skill_runner_mode, and is the judge's
authoritative source.

**Caveat:** in subscription mode we do not inject ANTHROPIC_API_KEY into
`options.env` for the Agent SDK subprocess, but the subprocess still
inherits `os.environ`. If the operator has ANTHROPIC_API_KEY in their
shell, the SDK may silently prefer it over the subscription session.
True strict isolation requires patching the SDK transport and is out of
scope — put the key in `eval/.env` rather than your shell if you want
subscription mode honored.
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

    Skill runner: prefer subscription (~/.claude/), fall back to API key.
    Judge: always uses the API key (read from env or eval/.env). The
    judge will error at grade time if no API key is available.

    Raises AuthError only when neither a subscription nor an API key is
    available — in that case nothing can run.
    """
    api_key = _load_api_key()
    has_sub = _has_subscription()

    if has_sub:
        judge_status = (
            f"ANTHROPIC_API_KEY (length={len(api_key)})"
            if api_key
            else "MISSING — judge will fail when reached"
        )
        return AuthConfig(
            skill_runner_mode="subscription",
            api_key=api_key,
            detail=(
                f"skill runner: subscription auth from {SUBSCRIPTION_DIRS[0]}; "
                f"judge: {judge_status}"
            ),
        )

    if api_key:
        return AuthConfig(
            skill_runner_mode="api_key",
            api_key=api_key,
            detail=(
                f"skill runner: ANTHROPIC_API_KEY (length={len(api_key)}); "
                f"judge: same key (no subscription available)"
            ),
        )

    raise AuthError(
        "No auth available. Either run `claude` once to log into your "
        "subscription, or set ANTHROPIC_API_KEY in your environment or in "
        f"{ENV_FILE}."
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
    """
    if auth.skill_runner_mode == "api_key" and auth.api_key:
        return {"ANTHROPIC_API_KEY": auth.api_key}
    return {}

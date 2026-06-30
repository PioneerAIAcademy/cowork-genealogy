"""Authentication for the harness.

Resolution order:
  1. Skill runner — prefer the subscription. If a Claude Code
     subscription session is available (~/.claude/ exists), the skill
     runner uses it for both unit-test and e2e skill execution. The
     API key (from the shell or eval/.env via Setup.bat) is only a
     fallback for the case where no subscription is configured.

     Policy: the skill runner — the expensive layer that drives the
     full agent loop — should bill the operator's flat-rate Claude
     subscription, not the project's metered API key. The judge stays
     on the key (see below). resolve_auth still resolves the API key
     even in subscription mode and carries it on AuthConfig so the
     judge has it.

     Note: an inherited ANTHROPIC_API_KEY in the SDK subprocess would
     otherwise take precedence over the subscription session, so
     env_for_sdk actively suppresses it in subscription mode (see
     that function).

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

    Skill runner: prefer the subscription (~/.claude/). Fall back to the
    API key (from env or eval/.env) only when no subscription session is
    configured. Either way the API key, if present, is carried on the
    returned config for the judge.
    Judge: always uses the API key; errors at grade time if absent.

    Raises AuthError only when neither a subscription nor a key is
    available — in that case nothing can run.
    """
    api_key = _load_api_key()
    has_sub = _has_subscription()

    if has_sub:
        return AuthConfig(
            skill_runner_mode="subscription",
            # Kept for the judge even in subscription mode. None is allowed
            # (run_tests warns up front that the judge will fail when reached).
            api_key=api_key,
            detail=(
                f"skill runner: subscription auth from {SUBSCRIPTION_DIRS[0]}; "
                + (
                    f"judge: ANTHROPIC_API_KEY (length={len(api_key)})"
                    if api_key
                    else "judge: MISSING — judge will fail when reached"
                )
            ),
        )

    if api_key:
        return AuthConfig(
            skill_runner_mode="api_key",
            api_key=api_key,
            detail=(
                f"skill runner: ANTHROPIC_API_KEY (length={len(api_key)}) "
                "(fallback — no subscription session found); judge: same key"
            ),
        )

    raise AuthError(
        "No auth available. Run `claude` once to log into a subscription, "
        "or set ANTHROPIC_API_KEY in your environment or in "
        f"{ENV_FILE} (Setup.bat does this for you)."
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

    For subscription mode: force the subprocess onto the CLI's
    subscription session by suppressing any inherited ANTHROPIC_API_KEY.
    The SDK merges os.environ then options.env (see
    claude_agent_sdk subprocess_cli), so we cannot *delete* an inherited
    key — but the Claude Code CLI resolves the key with a truthiness
    check, so an empty string reads as "unset" and the CLI falls back to
    its OAuth session. Without this, a key in the operator's shell (or one
    the e2e runner loaded into os.environ for the judge) would silently
    win over the subscription.
    """
    if auth.skill_runner_mode == "api_key" and auth.api_key:
        return {"ANTHROPIC_API_KEY": auth.api_key}
    return {"ANTHROPIC_API_KEY": ""}

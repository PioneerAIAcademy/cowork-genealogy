"""Per-connect agent secrets — the file channel carrying the operator's
Anthropic key into a sandbox that already exists.

**Why a file and not create-time env.** Neither sandbox SDK can mutate the
environment of a sandbox that has already been created, so a key injected via
`envs=` at `create()` is frozen for that sandbox's entire life. Rotating
`ANTHROPIC_API_KEY` on the control plane therefore fixed only *new* sessions
while every existing one kept failing with `401 authentication_error` — the
2026-07-20 alpha outage. Rewriting the current value on every connect makes a
rotation take effect for every session at its next reconnect.

This restores decision #2 of `docs/plan/sandbox-provider-interface.md` ("per-user
secrets go in a file, written on every (re)connect — not create-time env"), which
the implementation had drifted from; `SECRETS_PATH` was already reserved for it
in `sandbox/base.py` and had no callers.

Scope is deliberately just the Anthropic key: the FamilySearch token and the
OpenRouter key already have their own file channels (`fs_oauth.write_tokens` /
`write_config`) and so already survive rotation. This module is their sibling —
the control plane owns provisioning these files, the agent only reads them.

The reader is `app/agent/real_agent.py`, which prefers this file and falls back
to the env var when it is absent (local dev, and sandboxes created before the
file channel existed).
"""
from __future__ import annotations

import json

from .config import get_settings
from .sandbox.base import SECRETS_PATH


def secrets_bytes(anthropic_api_key: str | None) -> bytes:
    """Serialize the secrets document the in-sandbox agent reads.

    A missing key writes `{}` rather than a null: the reader treats absent and
    empty alike (it falls back to env), and this keeps the file's shape stable.
    """
    payload: dict[str, str] = {}
    if anthropic_api_key:
        payload["anthropic_api_key"] = anthropic_api_key
    return json.dumps(payload, indent=2).encode()


async def write_secrets(sandbox) -> None:
    """Write the current operator secrets into `sandbox` at SECRETS_PATH.

    Call on every path that is about to run a turn — session create and each
    reconnect. Cheap (one small file write) and idempotent, so callers do not
    need to track whether the value actually changed.
    """
    await sandbox.write_file(
        SECRETS_PATH, secrets_bytes(get_settings().anthropic_api_key)
    )

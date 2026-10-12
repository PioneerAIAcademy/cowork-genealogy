"""The sandbox image's build stamp, ``BUILD_INFO.json``, written by
``sandbox/build-image.sh``: ``{"commit": "<sha|dev>", "dirty": <bool>, "built_at": ...}``.

Read on the control plane by ``E2BProvider`` (for /api/health) and inside the sandbox by
``real_agent`` (for each turn's cost report), so both name a build the same way.
"""
from __future__ import annotations

import json

# e2b.Dockerfile's AGENT_HOME, where the image keeps the agent; the stamp is its last COPY.
AGENT_HOME = "/opt/genealogy-agent"
BUILD_INFO_PATH = f"{AGENT_HOME}/BUILD_INFO.json"


def build_label(raw: bytes | None) -> str:
    """``<commit>``, or ``<commit>+dirty`` for an image built from an uncommitted tree.

    The dirty marker rides on the value itself so no caller can report the sha while
    dropping the caveat (issue #2126: "a clean sha that lies is worse than no sha").
    Raises ``ValueError`` when the stamp carries no usable commit.
    """
    info = json.loads(raw.decode("utf-8")) if raw else None
    commit = info.get("commit") if isinstance(info, dict) else None
    if not isinstance(commit, str) or not commit:
        raise ValueError("no usable 'commit' field")
    return f"{commit}+dirty" if info.get("dirty") is True else commit

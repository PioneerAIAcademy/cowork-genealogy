"""The harness runs the claude-agent-sdk the hosted alpha runs.

The wheel bundles the Claude Code CLI, so the SDK version IS the CLI version:
a unit or e2e run on a different one measures a runtime no user is on. The
alpha's version is the `sandbox` dependency group in apps/server/pyproject.toml
(what the E2B image installs); the harness's is whatever eval/harness/uv.lock
resolves. When Richard's prototype worker becomes the production path, point
this at its `proto-worker` group instead.
"""

from __future__ import annotations

import re
import tomllib
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
SERVER_PYPROJECT = REPO_ROOT / "apps" / "server" / "pyproject.toml"
HARNESS_LOCK = REPO_ROOT / "eval" / "harness" / "uv.lock"

_PIN = re.compile(r"^claude-agent-sdk\s*==\s*([^\s;,]+)\s*(;.*)?$")


def _sandbox_pin() -> str:
    groups = tomllib.loads(SERVER_PYPROJECT.read_text(encoding="utf-8"))["dependency-groups"]
    pins = [m.group(1) for dep in groups["sandbox"] if (m := _PIN.match(dep.strip()))]
    assert len(pins) == 1, (
        f"apps/server's `sandbox` group must pin claude-agent-sdk with exactly one `==`; found {pins}"
    )
    return pins[0]


def _harness_locked() -> str:
    lock = tomllib.loads(HARNESS_LOCK.read_text(encoding="utf-8"))
    versions = [p["version"] for p in lock["package"] if p["name"] == "claude-agent-sdk"]
    assert len(versions) == 1, f"eval/harness/uv.lock resolves claude-agent-sdk {len(versions)} times: {versions}"
    return versions[0]


def test_harness_sdk_matches_the_hosted_sandbox_pin():
    hosted, harness = _sandbox_pin(), _harness_locked()
    assert harness == hosted, (
        f"eval/harness locks claude-agent-sdk=={harness} but the hosted sandbox pins =={hosted}. "
        "Set the same `==` in eval/harness/pyproject.toml, run `uv lock` in eval/harness, then "
        "`make harness-test`, `make agent-smoke`, `make probe-agent-binding` and `make hook-smoke`."
    )

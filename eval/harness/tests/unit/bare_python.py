"""Run code on a bare interpreter, for checks that a module stays stdlib-only."""

from __future__ import annotations

import subprocess
import sys


def bare(code: str) -> subprocess.CompletedProcess:
    """Run `code` on an interpreter with no site-packages and no environment.

    `sys.executable` is the uv venv, so `-S -E` is what strips it back to roughly
    the dependency-free runner CI gives us. Verified: `-S -E -c "import jsonschema"`
    raises ModuleNotFoundError.
    """
    return subprocess.run(
        [sys.executable, "-S", "-E", "-c", code],
        capture_output=True, text=True, encoding="utf-8",
    )

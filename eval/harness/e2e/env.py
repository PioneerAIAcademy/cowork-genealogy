"""Judge auth from eval/.env — shared by every e2e entry point.

eval/.env holds ANTHROPIC_API_KEY (written by Setup.bat). The judge talks to
the Anthropic API directly via the SDK, which reads ANTHROPIC_API_KEY from the
process env — so without this the judge fails to authenticate. In run_e2e that
surfaces as "agent ran, judge skipped"; in calibrate_judge it surfaced as every
case erroring and the sweep reporting BELOW target (an auth problem wearing a
judge-quality problem's clothes). A key already set in the shell wins.

This lives in its own module rather than in run_e2e because calibrate_judge
needs it too, and importing run_e2e would pull in e2e.orchestrator ->
claude_agent_sdk at import time. Calibration must stay importable and runnable
offline (see calibrate_judge's module docstring), so the shared piece has to be
dependency-light: stdlib + dotenv, nothing else.
"""

from __future__ import annotations

import os
from pathlib import Path


# eval/.env — two levels up from eval/harness/e2e/.
ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


def load_env_file(env_file: Path = ENV_FILE) -> None:
    """Load keys from eval/.env into os.environ without overriding the shell."""
    if not env_file.exists():
        return
    try:
        from dotenv import dotenv_values
    except ImportError:
        return
    for key, value in dotenv_values(env_file).items():
        if value is not None and not os.environ.get(key):
            os.environ[key] = value

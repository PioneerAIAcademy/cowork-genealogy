"""`harness.outcomes` is the single definition of the runs[] -> test rule.

Two things are pinned here, and the first is the reason the module exists.

1. **It imports on a bare interpreter.** `scripts/check_runlogs.py` is run by
   `.github/workflows/check-runlogs.yml` after `actions/setup-python` with no
   dependency step, and `runlog.py` imports jsonschema/referencing at module
   level. This suite runs under `uv` with those present, so an in-process import
   here proves nothing — the subprocess below is the only check that covers the
   path CI actually uses.

2. **`runlog.py`'s re-export is the same object**, not a copy that can drift.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

from harness import runlog
from harness.outcomes import (
    RunlogAssemblyError,
    _modal_with_tiebreak_down,
    _OUTCOME_RANK,
    aggregate_per_run_outcome,
)

HARNESS_DIR = Path(__file__).resolve().parents[2]


def test_runlog_reexports_the_same_objects_not_copies():
    assert runlog.aggregate_per_run_outcome is aggregate_per_run_outcome
    assert runlog.RunlogAssemblyError is RunlogAssemblyError
    assert runlog._modal_with_tiebreak_down is _modal_with_tiebreak_down
    assert runlog._OUTCOME_RANK is _OUTCOME_RANK


def test_outcomes_imports_on_a_bare_interpreter():
    """The failure this module exists to prevent. `sys.executable` is the uv venv,
    so it is NOT the right interpreter — `-S -E` strips site-packages and the
    environment, approximating the dependency-free runner CI gives us."""
    proc = subprocess.run(
        [sys.executable, "-S", "-E", "-c",
         "import sys; sys.path.insert(0, %r);"
         "from harness.outcomes import aggregate_per_run_outcome as a;"
         "print(a(['pass', 'pass', 'fail']))" % str(HARNESS_DIR)],
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    assert proc.returncode == 0, f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    assert proc.stdout.strip() == "pass"


@pytest.mark.parametrize(
    "per_run,expected",
    [
        (["pass"], "pass"),
        (["fail"], "fail"),
        (["partial"], "partial"),
        (["aborted"], "aborted"),
        # abort precedence beats the modal count, however lopsided
        (["pass", "pass", "pass", "aborted"], "aborted"),
        # modal wins outright
        (["pass", "pass", "fail"], "pass"),
        (["fail", "fail", "pass"], "fail"),
        # ties break DOWN to the worse outcome, never up
        (["pass", "fail"], "fail"),
        (["pass", "partial"], "partial"),
        (["partial", "fail"], "fail"),
        (["pass", "partial", "fail"], "fail"),
    ],
)
def test_aggregation_table(per_run, expected):
    assert aggregate_per_run_outcome(per_run) == expected


def test_empty_raises_rather_than_returning_a_green_default():
    """A silent "pass" on no runs would make an empty test look green to rule 6."""
    with pytest.raises(RunlogAssemblyError):
        aggregate_per_run_outcome([])

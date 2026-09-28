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


def _bare(code: str) -> subprocess.CompletedProcess:
    """Run `code` on an interpreter with no site-packages and no environment.

    `sys.executable` is the uv venv, so `-S -E` is what strips it back to roughly
    the dependency-free runner CI gives us. Verified: `-S -E -c "import jsonschema"`
    raises ModuleNotFoundError.
    """
    return subprocess.run(
        [sys.executable, "-S", "-E", "-c", code],
        capture_output=True, text=True, encoding="utf-8",
    )


def test_outcomes_imports_on_a_bare_interpreter():
    proc = _bare(
        "import sys; sys.path.insert(0, %r);"
        "from harness.outcomes import aggregate_per_run_outcome as a;"
        "print(a(['pass', 'pass', 'fail']))" % str(HARNESS_DIR)
    )
    assert proc.returncode == 0, f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    assert proc.stdout.strip() == "pass"


def test_check_runlogs_itself_imports_on_a_bare_interpreter():
    """The guard that matters, and the one the leaf test above does NOT give.

    `outcomes.py` exists so `scripts/check_runlogs.py` can aggregate without
    pulling jsonschema/referencing onto CI's dependency-free interpreter. Testing
    only `outcomes.py` leaves the CONSUMER unprotected: swapping its import back to
    `harness.runlog` breaks CI for every PR in the repo and every test still passes.
    Measured — that swap left 91/91 green while this same invocation raised
    ModuleNotFoundError. So this loads the script the workflow actually runs, which
    also covers its other three stdlib-only imports (snapshot, review_sample,
    versioning) regressing the same way.
    """
    script = HARNESS_DIR / "scripts" / "check_runlogs.py"
    proc = _bare(
        "import importlib.util, sys;"
        "sys.path.insert(0, %r);"
        "spec = importlib.util.spec_from_file_location('cr', %r);"
        "m = importlib.util.module_from_spec(spec);"
        "spec.loader.exec_module(m);"
        "print('loaded')" % (str(HARNESS_DIR), str(script))
    )
    assert proc.returncode == 0, (
        "check_runlogs.py must import with no third-party packages — the workflow "
        f"runs it after actions/setup-python with no dependency step.\n"
        f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
    )
    assert proc.stdout.strip() == "loaded"


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

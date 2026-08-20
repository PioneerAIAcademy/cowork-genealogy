"""Tests for the `test_no_raw_writes_to_protected_files` universal validator.

Proves the validator can actually fail (repo rule: a new lint must be shown to
fire). Mirrors `test_universal_context_calls.py`: a clean run passes, a recorded
raw write raises, and the AssertionError names the offending file and the writer
tools so the genealogist reading a failed run knows the way out. Issue #1493.
"""

import sys
from pathlib import Path

import pytest

# validators/ is not a package on the import path by default.
_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_universal import (  # noqa: E402
    test_no_raw_writes_to_protected_files as check,
)


def _write(file_path: str, tool: str = "Write") -> dict:
    return {"tool": tool, "args": {"file_path": file_path}}


def test_clean_run_passes():
    assert check([]) is None


def test_raw_write_to_research_json_raises():
    with pytest.raises(AssertionError) as e:
        check([_write("/ws/research.json")])
    msg = str(e.value)
    assert "research.json" in msg
    assert "research_append" in msg


def test_raw_edit_to_tree_raises():
    with pytest.raises(AssertionError) as e:
        check([_write("/ws/tree.gedcomx.json", tool="Edit")])
    msg = str(e.value)
    assert "tree.gedcomx.json" in msg
    assert "tree_edit" in msg


def test_multiple_offenders_are_counted():
    with pytest.raises(AssertionError) as e:
        check([_write("/ws/research.json"), _write("/ws/tree.gedcomx.json")])
    assert "2 call(s)" in str(e.value)


def test_missing_args_does_not_crash():
    """A malformed record must still surface as a usable failure, not a
    KeyError that hides the violation."""
    with pytest.raises(AssertionError) as e:
        check([{"tool": "Write"}])
    assert "Write" in str(e.value)

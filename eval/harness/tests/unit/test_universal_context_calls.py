"""Tests for the `test_no_main_thread_subagent_only_calls` universal validator.

The validator's AssertionError text is the only thing a genealogist reading a
failed run sees, and the fix differs per tool: an `image_read` offender must
delegate the read, while an `extraction_append` offender's delegation already
FAILED and the correct move is to report that, not to route the write somewhere
else. A single message naming one owner sends the reader after the wrong bug.

Same parity idea as `test_context_policy.py::test_every_guarded_tool_has_a_
bespoke_denial_reason`, applied one layer out: the hook's denial reason talks to
the model, this message talks to the human.
"""

import sys
from pathlib import Path

import pytest

from harness.context_policy import SUBAGENT_ONLY_TOOLS

# validators/ is not a package on the import path by default.
_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_universal import (  # noqa: E402
    test_no_main_thread_subagent_only_calls as check,
)


def _call(tool: str) -> dict:
    return {"tool": tool, "args": {}, "blocked_by": "context"}


def test_clean_run_passes():
    assert check([]) is None


def test_image_read_message_names_the_image_reader_and_the_reason():
    with pytest.raises(AssertionError) as e:
        check([_call("image_read")])
    msg = str(e.value)
    assert "image_read" in msg
    assert "@plugin:image-reader" in msg
    assert "base64" in msg


def test_extraction_append_message_names_the_extractor_and_says_report():
    """Not "delegate differently" — the delegation is what failed (#942)."""
    with pytest.raises(AssertionError) as e:
        check([_call("extraction_append")])
    msg = str(e.value)
    assert "extraction_append" in msg
    assert "@plugin:record-extractor" in msg
    assert "report the failure" in msg
    # The image_read fix must not leak into an extraction_append failure.
    assert "@plugin:image-reader" not in msg
    assert "base64" not in msg


def test_both_offenders_each_get_their_own_fix():
    with pytest.raises(AssertionError) as e:
        check([_call("extraction_append"), _call("image_read")])
    msg = str(e.value)
    assert "@plugin:record-extractor" in msg
    assert "@plugin:image-reader" in msg
    assert "2 call(s)" in msg


def test_unknown_guarded_tool_still_refuses_generically():
    """A tool added to SUBAGENT_ONLY_TOOLS without a per-tool line here must
    still produce a usable failure, not a KeyError that hides the violation."""
    with pytest.raises(AssertionError) as e:
        check([_call("some_future_tool")])
    assert "some_future_tool" in str(e.value)


def test_every_guarded_tool_has_a_bespoke_fix_line():
    """Parity guard, so the generic fallback above stays unreachable."""
    for tool in SUBAGENT_ONLY_TOOLS:
        with pytest.raises(AssertionError) as e:
            check([_call(tool)])
        assert "@plugin:" in str(e.value), (
            f"{tool} falls back to the generic fix line — add its owning "
            f"subagent to the `owners` map in test_universal.py"
        )

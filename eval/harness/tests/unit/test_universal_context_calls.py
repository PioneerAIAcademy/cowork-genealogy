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


def test_extraction_append_has_no_bespoke_fix_line_any_more():
    """Issue #2937 removed it from SUBAGENT_ONLY_TOOLS.

    The hook can no longer record one, so a bespoke fix line here would be dead
    prose telling a reader to re-delegate a call nothing denies. If one is ever
    recorded anyway — a stale runlog replayed, say — it must fall through to the
    generic line rather than resurrect the retired #942 advice.
    """
    with pytest.raises(AssertionError) as e:
        check([_call("extraction_append")])
    msg = str(e.value)
    assert "extraction_append" in msg
    assert "@plugin:record-extractor" not in msg
    assert "report the failure" not in msg


def test_repeat_offences_are_counted():
    """One guarded tool remains, so the count is what two calls exercise."""
    with pytest.raises(AssertionError) as e:
        check([_call("image_read"), _call("image_read")])
    msg = str(e.value)
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

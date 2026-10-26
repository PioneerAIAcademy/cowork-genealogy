"""A stall is not a blip, and must not be retried like one.

`sdk_stream_silence` is raised only after the watchdog has waited
`DEFAULT_SDK_MESSAGE_SILENCE_SECONDS` for ANY message, so by the time it fires the
upstream has been quiet for three minutes. With the ordinary 1 s base the three
attempts all land within about seven seconds, straight back into the same bad state.

The silence THRESHOLD is deliberately not raised: across the committed unit run logs
the non-API gap in SUCCESSFUL runs peaks at 58.7 s, nowhere near 180 s, so a 180 s
silence is a genuine stall and a longer window would only mask it.

This is the transient retry inside one run (`_execute_skill_with_retry`), NOT the
fail-retry that re-runs a failed test before rule 6 grades it (#3733). The two are
separate mechanisms and this changes only the first.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / "eval" / "harness"))

from harness.orchestrator import (  # noqa: E402
    DEFAULT_SDK_MESSAGE_SILENCE_SECONDS,
    _STALL_ABORTS,
    retry_delay_for,
)


def test_a_stall_waits_long_enough_to_be_worth_retrying():
    assert retry_delay_for("sdk_stream_silence", 1.0) == DEFAULT_SDK_MESSAGE_SILENCE_SECONDS / 6


def test_the_stall_wait_is_far_longer_than_the_ordinary_one():
    """The whole point: 1 s puts all three attempts inside the stall window."""
    assert retry_delay_for("sdk_stream_silence", 1.0) > 10 * retry_delay_for("error", 1.0)


@pytest.mark.parametrize("reason", ["error", "max_turns", "not_runnable", "quota_exhausted", None])
def test_every_other_reason_keeps_the_fast_retry(reason):
    """An unknown reason must not silently inherit minutes of delay."""
    assert retry_delay_for(reason, 1.0) == 1.0


def test_a_base_delay_already_longer_than_the_stall_wait_is_kept():
    """`max`, not a replacement: the caller doubles the delay between attempts, so a
    later attempt must never go BACKWARDS to the first stall wait."""
    big = DEFAULT_SDK_MESSAGE_SILENCE_SECONDS
    assert retry_delay_for("sdk_stream_silence", big) == big


def test_only_the_measured_reason_is_in_the_stall_set():
    """Widening this set is a measurement, not a guess -- `error` is the SDK failing
    fast, which the ordinary backoff already handles."""
    assert _STALL_ABORTS == {"sdk_stream_silence"}

"""Skip-proof assertion helpers for validator unit tests.

A validator that skipped is not a validator that passed, but pytest scores a
skip as success. So a bare ``pytest.raises(AssertionError)`` around a validator
call goes green the moment one of that validator's skip gates over-matches: the
test becomes SKIPPED and the suite still exits 0. Measured on this file's own
subject — flipping the ``type != "positive"`` gate on
``validators/test_search_external_sites.py``'s V3 turns four tests in
``test_search_external_sites_validator.py`` into skips at ``23 passed`` to
``19 passed, 4 skipped``, exit 0 both times.

The same hole exists in the *pass* direction: calling a validator bare and
asserting nothing cannot tell "ran and found nothing wrong" from "skipped
before it looked".

Both helpers take a **zero-argument callable**, because validator signatures
differ — the birthplace-conflict checks take four arguments, V2/V3/V6/V7/V7b/V8
take three, and V4 takes four with a reply string in the middle. The caller
closes over whatever its validator needs.

``expect_fires`` matches with ``re.search``, the same semantics
``pytest.raises(match=...)`` uses, so a call site converted from ``pytest.raises``
keeps its pattern verbatim. A caller wanting a literal substring passes
``re.escape(...)``.
"""

from __future__ import annotations

import re

import pytest


def expect_fires(run, match):
    """Require ``run()`` to raise ``AssertionError`` matching ``match``.

    A skip fails the test rather than passing it silently.
    """
    try:
        run()
    except pytest.skip.Exception:
        pytest.fail(
            f"expected AssertionError (match={match!r}), but the validator "
            "skipped instead — one of its skip gates over-matched"
        )
    except AssertionError as e:
        assert re.search(match, str(e)), (
            f"AssertionError message does not match {match!r}: {e}"
        )
        return
    pytest.fail(
        f"expected AssertionError (match={match!r}), but the validator raised nothing"
    )


def expect_passes(run):
    """Require ``run()`` to run to completion and find nothing wrong.

    A skip fails the test: the validator never reached its assertions, so the
    case it was meant to clear was never actually judged. An unexpected
    ``AssertionError`` propagates naturally and fails the test on its own.
    """
    try:
        run()
    except pytest.skip.Exception:
        pytest.fail(
            "expected the validator to run and pass, but it skipped instead "
            "— one of its skip gates over-matched"
        )

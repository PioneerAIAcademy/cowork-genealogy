"""The two invented-locator checks must actually see the user message.

Both read it to whitelist a numeral the user supplied — "page 47" in the request
is not an invented locator. Until 2026-09-15 they read
`test["input"]["user_message"]`, but `test` is the inner test block merged with
the top-level fields the orchestrator threads in (`orchestrator.py`'s `test={...}`
literal), and it has no `input` key. So the read returned "" on every run and the
whitelist was silently empty — a false positive waiting on any test whose user
message carries a numeral.

Nothing caught it because an over-strict whitelist only bites when a run echoes a
user-supplied number back into a citation. One of the two — `test_no_invented_
locators_persisted` — is tier 1 and GATES, so the dead read could fail a test for
citing a page the user named. These pin the read: the numeral must reach `on_file`.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[4]


def _citation():
    path = REPO_ROOT / "eval" / "harness" / "validators" / "test_citation.py"
    spec = importlib.util.spec_from_file_location("_tc_user_msg", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# The gate only inspects sources present in BOTH states, so the source must
# pre-exist and gain the locator.
_BEFORE = {"sources": [{"id": "src_001", "citation": "Some Register.", "title": "t"}]}
# `p.` is one of the forms _LOCATOR_RE actually matches — the word "page"
# is NOT, and a fixture using it makes both halves of this test vacuous.
_AFTER = {"sources": [{"id": "src_001", "citation": "Some Register, p. 4711.", "title": "t"}]}


@pytest.mark.parametrize("supplied", [True, False], ids=["user_supplied", "invented"])
def test_a_numeral_from_the_user_message_is_whitelisted(supplied):
    """The accept direction and the reject direction of the same read.

    Supplied in the user message -> not reported. Absent from it -> reported.
    If the read is dead both cases report, and the parametrisation goes red on
    the `user_supplied` half.
    """
    tc = _citation()
    test = {"type": "positive", "tags": []}
    if supplied:
        test["user_message"] = "Please cite the entry on p. 4711."

    try:
        tc.test_no_invented_locators_persisted(
            before_state={"research_json": _BEFORE, "tree_gedcomx_json": None},
            after_state={"research_json": _AFTER},
            test=test,
        )
        flagged = False
    except AssertionError:
        flagged = True

    assert flagged is (not supplied), (
        "a numeral the user supplied must not be flagged as invented; one they "
        "did not supply must be. This gate FAILS the test, so a dead read here "
        "is a false red, not just a noisy report."
    )


def test_the_read_targets_the_key_the_orchestrator_threads():
    """`user_message` is a TOP-LEVEL key of the threaded test dict, not nested.

    Pinned against the orchestrator's own literal so a future reader does not
    reintroduce the `test["input"]` shape.
    """
    src = (REPO_ROOT / "eval" / "harness" / "harness" / "orchestrator.py").read_text(
        encoding="utf-8"
    )
    assert '"user_message": spec.user_message' in src
    citation = (
        REPO_ROOT / "eval" / "harness" / "validators" / "test_citation.py"
    ).read_text(encoding="utf-8")
    assert 'test.get("input"' not in citation, (
        "the validator is reading a nested `input` block the test dict does not have"
    )

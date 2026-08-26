"""Direct tests for the search-images no-browse invariant.

Same reason as `test_convert_dates_validators.py` and its siblings:
`pyproject.toml` sets `testpaths = ["tests"]`, so nothing under `validators/`
is collected by `make harness-test`, and a validator's real pass/fail set
would otherwise appear only inside a paid per-skill run.

These exist to satisfy CLAUDE.md's "a new lint must be proven to fail" rule
for issue #1788.

What #1788 actually fixed, since the obvious reading is wrong. The
`no-browse-no-write` tag was already present, and
`harness/runnability.py` already aborts a `grade_on_invariant` test whose
tags gate no invariant — so the validator was never skipping. The defect was
one layer down: `ut_search_images_009` declared no `mcp_fixtures`, and
`mock_mcp.create_mock_server` registers a browse tool only when a fixture for
it is named. `volume_search`/`image_search` are not in `LIVE_TOOLS`, so they
were absent from the model's tool list entirely, and assertion 1 asserted the
absence of a call that could not physically be made. That is the same failure
mode as convert-dates (#1654): a `grade_on_invariant` test riding on an
assertion that was green forever.

It bit in practice rather than in theory. Run `v1_2026-07-28_22-33-47`
activated search-images for 9 turns and recorded `tool_calls: []` — the run
where a forbidden browse would have shown up, and could not.

The two tests below are the halves that matter, and they fail for different
reasons:

  - `test_browse_assertion_fires_...` pins the assertion. SYNTHETIC state: no
    committed run log carries a browse on this test, because until #1788 none
    could.
  - `test_browse_tools_are_registered_...` pins the *fixture reference*, which
    is what actually regressed. Deleting the two-item `mcp_fixtures` array
    restores the vacuous state and is otherwise silently green — the
    runnability gate accepts an empty `mcp_fixtures`, so nothing else in the
    repo notices.
"""

import json
import sys
from pathlib import Path

import pytest

# validators/ is not a package on the import path by default.
_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

# Aliased away from the `test_` prefix on purpose: pytest would otherwise
# collect the imported validator as a test of this module and error on its
# harness-supplied fixtures. Same pattern as the sibling validator tests.
from test_search_images import (  # noqa: E402
    test_no_browse_or_writes_on_planning_request as check_no_browse,
)

from harness.mock_mcp import create_mock_server  # noqa: E402

_EVAL_DIR = Path(__file__).resolve().parents[3]
_FIXTURES_DIR = _EVAL_DIR / "fixtures" / "mcp"
_NINE = _EVAL_DIR / "tests" / "unit" / "search-images" / "negative-research-plan.json"


def _nine_fixtures():
    """Read ut_search_images_009's OWN `mcp_fixtures` declaration.

    Deliberately read from the test file rather than hardcoded here: the
    regression #1788 fixes is that array going missing, so a copy in this file
    would keep passing while the corpus went back to asserting an impossible
    call. Mutation-checked — emptying the array fails the test below.
    """
    return json.loads(_NINE.read_text(encoding="utf-8")).get("mcp_fixtures", [])

_TAGS = {"type": "negative", "tags": ["no-browse-no-write"]}

# The recorded shape of the passing run: routed to research-plan, nothing done.
_EMPTY_STATE = {"research": {"log": []}, "files": []}


def _call(tool, **args):
    return {"tool": tool, "args": args, "matched": {"kind": "live", "index": None}}


def test_passes_on_the_recorded_no_browse_shape():
    """The green case, so the RED cases below mean something."""
    check_no_browse(_EMPTY_STATE, _EMPTY_STATE, [], _TAGS)


@pytest.mark.parametrize(
    "tool",
    [
        "mcp__genealogy__image_search",
        "mcp__genealogy__volume_search",
        # Cowork's two other server spellings — the validator normalizes on
        # `.split("__")[-1]`, and CLAUDE.md requires all three to resolve.
        "mcp__remote-devices__Genealogy_Research__image_search",
        "mcp__Genealogy_Research__volume_search",
    ],
)
def test_browse_assertion_fires_on_a_browse_that_is_now_possible(tool):
    """Before #1788 this assertion could not fail: it asserts a browse tool was
    not called, for tools registered nowhere, so it was green forever while
    `grade_on_invariant` rode on it. Here is the proof it can now fire."""
    with pytest.raises(AssertionError, match="must not execute a browse"):
        check_no_browse(
            _EMPTY_STATE, _EMPTY_STATE, [_call(tool, imageGroupNumber="004512345")], _TAGS
        )


def test_browse_tools_are_registered_by_the_declared_fixtures():
    """The half that pins #1788's actual fix in place.

    `mcp_fixtures` is what makes the browse tools callable, so removing it
    silently disarms the assertion above. This fails if that reference is
    dropped, and the paired empty-list case documents the pre-fix state so the
    two are read together.
    """
    declared = _nine_fixtures()
    _, _, armed = create_mock_server(declared, _FIXTURES_DIR)
    assert {"volume_search", "image_search"} <= set(armed), (
        "ut_search_images_009's mcp_fixtures must register both browse tools, "
        "or its no-browse invariant asserts the absence of an impossible call "
        f"(#1788); declared {declared} -> registered {sorted(armed)}"
    )

    _, _, unarmed = create_mock_server([], _FIXTURES_DIR)
    assert not ({"volume_search", "image_search"} & set(unarmed)), (
        "pre-#1788 state: with no mcp_fixtures the browse tools must be absent "
        f"— if they are now live-registered this test is obsolete; got: {sorted(unarmed)}"
    )

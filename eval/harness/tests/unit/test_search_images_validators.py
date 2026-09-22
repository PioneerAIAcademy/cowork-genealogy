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


# --- ut_search_images_005: no browse on an INDEXED search -------------
#
# The sibling invariant, proven in BOTH directions. Breaking the repo tests
# only that a guard can fire; CLAUDE.md also requires showing it does not fire
# on legitimate work, which here is the whole reason this is not a copy of
# check_no_browse — search-records logs every search it runs.

from test_search_images import (  # noqa: E402
    test_no_browse_executed_on_indexed_search as check_no_browse_indexed,
)

_FIVE = _EVAL_DIR / "tests" / "unit" / "search-images" / "negative-indexed-search.json"
_INDEXED_TAGS = {"type": "negative", "tags": ["no-browse-on-indexed"]}


def _five_fixtures():
    """Read ut_search_images_005's OWN `mcp_fixtures`, for the same reason
    _nine_fixtures does: a copy here would stay green if the array went away."""
    return json.loads(_FIVE.read_text(encoding="utf-8")).get("mcp_fixtures", [])


# new_log_entries takes the WRAPPED per-run state ({"research_json": {...}}),
# not the unwrapped research.json dict — see validators_lib.new_log_entries.
# _EMPTY_STATE above uses "research", so its log diff is empty on both sides
# and the sibling's log assertion never fires there; these cases need the real
# key or they assert nothing.
_NO_LOG_STATE = {"research_json": {"log": []}, "files": {}}


def _state_with_log(entries):
    return {"research_json": {"log": entries}, "files": {}}


def test_indexed_passes_when_the_skill_redirected():
    """The green case, so the RED cases below mean something."""
    check_no_browse_indexed(_EMPTY_STATE, _EMPTY_STATE, [], _INDEXED_TAGS)


@pytest.mark.parametrize(
    "tool",
    [
        "mcp__genealogy__image_search",
        "mcp__genealogy__volume_search",
        "mcp__remote-devices__Genealogy_Research__image_search",
        "mcp__Genealogy_Research__volume_search",
    ],
)
def test_indexed_browse_assertion_fires_on_each_server_spelling(tool):
    with pytest.raises(AssertionError, match="must not execute a browse"):
        check_no_browse_indexed(
            _EMPTY_STATE, _EMPTY_STATE, [_call(tool, imageGroupNumber="007936749")], _INDEXED_TAGS
        )


def test_indexed_log_assertion_fires_on_a_claimed_browse():
    """The shape actually recorded on run v1_2026-09-22_01-41-09: no browse
    tool was available, so none was called — the agent appended a log entry
    claiming an image_search browse anyway. The tool-call assertion above
    cannot see that; this one can."""
    after = _state_with_log([{"id": "log_009", "tool": "image_search", "outcome": "error"}])
    with pytest.raises(AssertionError, match="must not append a browse log entry"):
        check_no_browse_indexed(_NO_LOG_STATE, after, [], _INDEXED_TAGS)


def test_indexed_log_assertion_fires_on_a_volume_search_log_too():
    after = _state_with_log([{"id": "log_009", "tool": "volume_search", "outcome": "negative"}])
    with pytest.raises(AssertionError, match="must not append a browse log entry"):
        check_no_browse_indexed(_NO_LOG_STATE, after, [], _INDEXED_TAGS)


def test_indexed_allows_the_correct_route_to_log_its_own_search():
    """THE OTHER DIRECTION, and the reason this validator is not a copy of
    check_no_browse: search-records is the correct route here and it logs every
    search. check_no_browse forbids ANY new log entry — reusing it verbatim
    would fail the run precisely when the skill did the right thing."""
    after = _state_with_log(
        [{"id": "log_009", "tool": "record_search", "outcome": "positive"}]
    )
    check_no_browse_indexed(_NO_LOG_STATE, after, [], _INDEXED_TAGS)

    # And the sibling would indeed have failed it — the divergence is real,
    # not a hypothetical worth a comment.
    with pytest.raises(AssertionError, match="must not append a browse log entry"):
        check_no_browse(_NO_LOG_STATE, after, [], _TAGS)


def test_indexed_skips_when_the_tag_is_absent():
    """Gated like its sibling: an untagged test must not be silently graded."""
    with pytest.raises(BaseException, match="no-browse-on-indexed"):
        check_no_browse_indexed(
            _EMPTY_STATE, _EMPTY_STATE, [], {"type": "negative", "tags": []}
        )


def test_indexed_browse_tools_are_registered_by_the_declared_fixtures():
    """#1788's lesson applied to 005: without the catch-alls the browse
    assertion asserts the absence of an impossible call and is green forever."""
    declared = _five_fixtures()
    _, _, armed = create_mock_server(declared, _FIXTURES_DIR)
    assert {"volume_search", "image_search"} <= set(armed), (
        "ut_search_images_005's mcp_fixtures must register both browse tools, "
        "or its no-browse invariant cannot fail (#1788); declared "
        f"{declared} -> registered {sorted(armed)}"
    )

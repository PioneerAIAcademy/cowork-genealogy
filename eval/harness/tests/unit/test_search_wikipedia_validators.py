"""Direct tests for the search-wikipedia validators.

Same reason as `test_search_familysearch_wiki_validators.py`: `pyproject.toml`
sets `testpaths = ["tests"]`, so nothing under `validators/` is collected by
`make harness-test`, and a validator's real pass/fail set would otherwise
appear only inside a paid per-skill run.

`test_search_wikipedia.py` had no unit test at all until issue #2795. The card
that converted the skill to an agent made `test_no_wiki_no_write` the WHOLE
deterministic verdict for `ut_search_wikipedia_008` -- the direct decline test
-- so CLAUDE.md's "a new lint must be proven to fail" now binds on it: it is no
longer one half of a routed negative's grading, it is the grading.

Proven in both directions, which is the part a single break would miss:

  - it FAILS on a run that called `wikipedia_search` (the lookup was executed);
  - it FAILS on a run that wrote a new `.md` (the summary was saved);
  - it PASSES on a clean decline;
  - and the gate itself is exercised on BOTH tags (`no-wiki-no-write` and
    `scope-decline`) and on neither, because the widened `or` is the change
    #2795 made and a gate that fired on only one of the two would leave
    `ut_search_wikipedia_008` graded by nothing while this file stayed green.

The four `scope-decline` SKIPS added in the same change are pinned too, in the
same both-directions shape: each must skip on the decline test and must still
run -- and still be able to fail -- on an ordinary saved-file run. A skip that
leaked onto the saved-file arm would silently retire the suite's file checks.
"""

import sys
from pathlib import Path

import pytest

# validators/ is not a package on the import path by default.
_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

# Aliased away from the `test_` prefix on purpose: pytest would otherwise
# collect the imported validators as tests of this module and error on their
# harness-supplied fixtures. Same pattern as
# test_search_familysearch_wiki_validators.py.
from test_search_wikipedia import (  # noqa: E402
    test_no_wiki_no_write as check_no_wiki_no_write,
    test_reply_does_not_narrate_pending_step as check_narration,
    test_saved_file_matches_template as check_template,
    test_slug_matches_returned_title as check_slug,
    test_wikipedia_search_called_exactly_once as check_one_call,
    test_wrote_one_markdown_file as check_one_md,
)


EMPTY = {"files": {}}

_TITLE = "Schuylkill County, Pennsylvania"
_EXTRACT = "Schuylkill County is a county in Pennsylvania."
_URL = "https://en.wikipedia.org/wiki/Schuylkill_County,_Pennsylvania"
_SAVED = "# " + _TITLE + "\n\n" + _EXTRACT + "\n\n---\n[Source](" + _URL + ")\n"

WIKI_CALL = {
    "tool": "mcp__genealogy__wikipedia_search",
    "args": {"query": _TITLE},
    "response": {"title": _TITLE, "extract": _EXTRACT, "url": _URL},
}

GOOD_AFTER = {"files": {"schuylkill-county-pennsylvania.md": _SAVED}}


def decline_test(tags):
    return {"id": "ut_search_wikipedia_008", "type": "positive", "tags": list(tags)}


def saved_file_test():
    return {
        "id": "ut_search_wikipedia_001",
        "type": "positive",
        "tags": ["slug-schuylkill-county-pennsylvania", "direct-arm"],
    }


def _run(fn, **kwargs):
    """Call a validator, converting a ``pytest.skip`` into a sentinel.

    ``Skipped`` derives from ``BaseException``, so a bare ``pytest.raises``
    would let it propagate and a mutation that turned every assertion into a
    skip would read as a pass. `test_search_familysearch_wiki_validators.py`
    learned that the expensive way; the sentinel is why the skip arms below are
    assertions rather than the absence of a failure.
    """
    try:
        fn(**kwargs)
    except pytest.skip.Exception:
        return "skipped"
    return "passed"


def _expect_failure(fn, match, **kwargs):
    """Assert `fn` FAILS, and treat a skip as a failure of this test.

    Not ``pytest.raises(AssertionError)`` alone. ``Skipped`` derives from
    ``BaseException`` and propagates straight through ``pytest.raises``, so a
    mutation that narrows the validator's tag gate turns every one of these
    arms into a *skipped* test -- which reads green in the summary line.
    Measured: narrowing the `or` in `test_no_wiki_no_write`'s gate back to a
    single tag left these arms reporting "2 skipped" rather than failing.
    """
    try:
        fn(**kwargs)
    except pytest.skip.Exception:
        raise AssertionError(
            f"{fn.__name__} SKIPPED where it was required to fail. Its tag gate "
            f"no longer reaches this state, so the test it grades is graded by "
            f"nothing."
        ) from None
    except AssertionError as exc:
        assert match in str(exc), f"failed for the wrong reason: {exc}"
        return
    raise AssertionError(f"{fn.__name__} passed a state it was required to fail")


# --- test_no_wiki_no_write: the decline test's entire deterministic verdict ---


@pytest.mark.parametrize(
    "tags",
    [["no-wiki-no-write"], ["scope-decline"], ["no-wiki-no-write", "scope-decline"]],
)
def test_no_wiki_no_write_passes_on_a_clean_decline(tags):
    assert (
        _run(
            check_no_wiki_no_write,
            tool_calls=[],
            before_state=EMPTY,
            after_state=EMPTY,
            test=decline_test(tags),
        )
        == "passed"
    )


@pytest.mark.parametrize("tags", [["no-wiki-no-write"], ["scope-decline"]])
def test_no_wiki_no_write_fails_when_the_lookup_ran(tags):
    """The first half of the invariant: the agent executed the lookup it was
    supposed to decline. Fires under EITHER tag -- the `or` #2795 widened."""
    _expect_failure(
        check_no_wiki_no_write,
        "must not execute a Wikipedia lookup",
        tool_calls=[WIKI_CALL],
        before_state=EMPTY,
        after_state=EMPTY,
        test=decline_test(tags),
    )


@pytest.mark.parametrize("tags", [["no-wiki-no-write"], ["scope-decline"]])
def test_no_wiki_no_write_fails_when_a_summary_was_saved(tags):
    """The second half, and a separate break rather than the same one twice: a
    run can save a file from a response it obtained some other way, so the file
    arm has to fire with no `wikipedia_search` call present at all."""
    _expect_failure(
        check_no_wiki_no_write,
        "must not save a Wikipedia summary",
        tool_calls=[],
        before_state=EMPTY,
        after_state=GOOD_AFTER,
        test=decline_test(tags),
    )


def test_no_wiki_no_write_is_inert_without_either_tag():
    """The other direction: an ordinary saved-file run is legitimate work and
    this validator must not fail it. Without this the widened gate could be
    made unconditional and every positive test in the suite would red."""
    assert (
        _run(
            check_no_wiki_no_write,
            tool_calls=[WIKI_CALL],
            before_state=EMPTY,
            after_state=GOOD_AFTER,
            test=saved_file_test(),
        )
        == "skipped"
    )


# --- the four scope-decline skips, both directions --------------------------


def test_the_file_validators_skip_the_decline_test():
    """A decline saves nothing, so the four workflow validators must stand
    down. Without the skips `ut_search_wikipedia_008` fails four checks for
    behaving exactly as its body requires."""
    t = decline_test(["no-wiki-no-write", "scope-decline", "direct-arm"])
    assert _run(check_one_call, tool_calls=[], test=t) == "skipped"
    assert _run(check_one_md, before_state=EMPTY, after_state=EMPTY, test=t) == "skipped"
    assert (
        _run(check_template, before_state=EMPTY, after_state=EMPTY, tool_calls=[], test=t)
        == "skipped"
    )
    assert (
        _run(check_slug, before_state=EMPTY, after_state=EMPTY, tool_calls=[], test=t)
        == "skipped"
    )


def test_the_file_validators_still_run_on_a_saved_file_test():
    """The direction a single break would miss. If a `scope-decline` skip were
    written without its tag guard -- or the guard read the wrong key -- these
    four would skip on every test in the suite and the file checks would be
    gone with nothing red."""
    t = saved_file_test()
    assert _run(check_one_call, tool_calls=[WIKI_CALL], test=t) == "passed"
    assert (
        _run(check_one_md, before_state=EMPTY, after_state=GOOD_AFTER, test=t) == "passed"
    )
    assert (
        _run(
            check_template,
            before_state=EMPTY,
            after_state=GOOD_AFTER,
            tool_calls=[WIKI_CALL],
            test=t,
        )
        == "passed"
    )
    assert (
        _run(
            check_slug,
            before_state=EMPTY,
            after_state=GOOD_AFTER,
            tool_calls=[WIKI_CALL],
            test=t,
        )
        == "passed"
    )


def test_the_file_validators_still_fail_a_bad_saved_file():
    """And they must still be able to FAIL there -- four `passed` results above
    would also be produced by four validators that assert nothing."""
    t = saved_file_test()
    _expect_failure(
        check_one_md, "expected exactly one new .md file",
        before_state=EMPTY, after_state=EMPTY, test=t,
    )
    _expect_failure(
        check_one_call, "expected exactly 1 wikipedia_search call",
        tool_calls=[WIKI_CALL, WIKI_CALL], test=t,
    )
    _expect_failure(
        check_template, "verbatim",
        before_state=EMPTY,
        after_state={"files": {"schuylkill-county-pennsylvania.md": "# Wrong"}},
        tool_calls=[WIKI_CALL], test=t,
    )
    _expect_failure(
        check_slug, "slug of the returned title",
        before_state=EMPTY,
        after_state={"files": {"schuylkill-county.md": _SAVED}},
        tool_calls=[WIKI_CALL], test=t,
    )


# --- the narration check reads the agent's return, not the dispatcher's -------

_AGENT_LINE = "Saved the Wikipedia summary to `schuylkill-county-pennsylvania.md`."
_NARRATING = "Now I'll write the filled template to a file."


def _returns(text, subagent_type="search-wikipedia"):
    return [{"subagent_type": subagent_type, "text": text}]


def test_narration_check_passes_a_clean_agent_return_under_a_narrating_relay():
    """The dispatcher's relay is not the subject: a clean agent return passes
    even when `text_response` narrates."""
    assert _run(
        check_narration,
        agent_returns=_returns(_AGENT_LINE),
        text_response=_NARRATING,
        test=saved_file_test(),
    ) == "passed"


def test_narration_check_fails_a_narrating_agent_return_under_a_clean_relay():
    _expect_failure(
        check_narration, "narrates a pending step",
        agent_returns=_returns(_NARRATING),
        text_response=_AGENT_LINE,
        test=saved_file_test(),
    )


@pytest.mark.parametrize(
    "agent_returns",
    [[], _returns(_AGENT_LINE, subagent_type="image-reader"), _returns("")],
    ids=["no-returns", "other-agent-only", "empty-return"],
)
def test_narration_check_falls_back_to_text_response(agent_returns):
    _expect_failure(
        check_narration, "narrates a pending step",
        agent_returns=agent_returns,
        text_response=_NARRATING,
        test=saved_file_test(),
    )

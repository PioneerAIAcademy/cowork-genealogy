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
  - it FAILS on a run that called `research_log_append` or left a new log
    entry (the summary was logged);
  - it FAILS on a run that wrote any new file;
  - it PASSES on a clean decline;
  - and the gate itself is exercised on BOTH tags (`no-wiki-no-write` and
    `scope-decline`) and on neither, because the widened `or` is the change
    #2795 made and a gate that fired on only one of the two would leave
    `ut_search_wikipedia_008` graded by nothing while this file stayed green.

The `scope-decline` SKIPS are pinned too, in the same both-directions shape:
each must skip on a positive decline test and must still run -- and still be
able to fail -- on an ordinary logged run. A skip that leaked onto the logged
arm would silently retire the suite's log-entry checks.

Since #3244 option L (U20) the deliverable is one log entry, not a `.md` file,
so every planted case builds `after_state["research_json"]["log"]`; these
fires/passes pairs are the durable home of that change's break proofs.
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
    test_log_notes_match_template as check_template,
    test_no_project_returns_template as check_no_project,
    test_no_wiki_no_write as check_no_wiki_no_write,
    test_notes_title_is_returned_title as check_title,
    test_one_log_entry_appended as check_one_entry,
    test_only_lookup_and_log_called as check_allowlist,
    test_reply_does_not_narrate_pending_step as check_narration,
    test_wikipedia_search_called_exactly_once as check_one_call,
)


_TITLE = "Schuylkill County, Pennsylvania"
_EXTRACT = "Schuylkill County is a county in Pennsylvania."
_URL = "https://en.wikipedia.org/wiki/Schuylkill_County,_Pennsylvania"
_NOTES = "# " + _TITLE + "\n\n" + _EXTRACT + "\n\n---\n[Source](" + _URL + ")\n"

WIKI_CALL = {
    "tool": "mcp__genealogy__wikipedia_search",
    "args": {"query": _TITLE},
    "response": {"title": _TITLE, "extract": _EXTRACT, "url": _URL},
}
LOG_CALL = {
    "tool": "mcp__genealogy__research_log_append",
    "args": {"tool": "wikipedia_search"},
}


def _entry(n=1, notes=_NOTES, tool="wikipedia_search", plan_item_id=None):
    return {
        "id": f"log_{n:03d}",
        "plan_item_id": plan_item_id,
        "performed": "2026-10-13T00:00:00.000Z",
        "tool": tool,
        "query": {"query": _TITLE, "title": _TITLE},
        "outcome": "positive",
        "results_examined": 1,
        "external_site": None,
        "results_ref": None,
        "notes": notes,
    }


def _state(log=(), files=None):
    return {"research_json": {"log": list(log)}, "files": dict(files or {})}


EMPTY = _state()
GOOD_AFTER = _state([_entry()])


def decline_test(tags):
    """A POSITIVE decline test. Synthetic: the corpus's decline,
    `ut_search_wikipedia_008`, is a negative, so these pin the `scope-decline`
    skips for the shape the lead's 2026-09-24 ruling asked for."""
    return {"id": "ut_search_wikipedia_decline", "type": "positive", "tags": list(tags)}


def logged_test(tags=("title-schuylkill-county-pennsylvania", "direct-arm")):
    return {"id": "ut_search_wikipedia_001", "type": "positive", "tags": list(tags)}


def no_project_test():
    return {"id": "ut_search_wikipedia_002", "type": "positive", "tags": ["no-project", "direct-arm"]}


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
def test_no_wiki_no_write_fails_when_a_summary_was_logged(tags):
    """A separate break rather than the lookup one twice: a run can log a
    summary from a response it obtained some other way, so the log arm has to
    fire with no `wikipedia_search` call present at all -- on the entry alone
    and on the call alone."""
    _expect_failure(
        check_no_wiki_no_write,
        "must not log a Wikipedia summary",
        tool_calls=[],
        before_state=EMPTY,
        after_state=GOOD_AFTER,
        test=decline_test(tags),
    )
    _expect_failure(
        check_no_wiki_no_write,
        "must not log a Wikipedia summary",
        tool_calls=[LOG_CALL],
        before_state=EMPTY,
        after_state=EMPTY,
        test=decline_test(tags),
    )


@pytest.mark.parametrize(
    "filename",
    ["parse_csv.py", "notes.txt", "summary.MD", "schuylkill-county-pennsylvania.md"],
    ids=["py", "txt", "uppercase-md", "md"],
)
def test_no_wiki_no_write_fails_on_any_saved_file(filename):
    """The gate is "no file saved", not "no .md saved": this is the whole
    verdict for `ut_search_wikipedia_008`, whose prompt asks for a Python
    function, so an extension filter would pass a run that saved
    `parse_csv.py`."""
    _expect_failure(
        check_no_wiki_no_write,
        "must not save a Wikipedia summary",
        tool_calls=[],
        before_state=EMPTY,
        after_state=_state(files={filename: "x"}),
        test=decline_test(["scope-decline"]),
    )


def test_no_wiki_no_write_is_inert_without_either_tag():
    """The other direction: an ordinary logged run is legitimate work and
    this validator must not fail it. Without this the widened gate could be
    made unconditional and every positive test in the suite would red."""
    assert (
        _run(
            check_no_wiki_no_write,
            tool_calls=[WIKI_CALL, LOG_CALL],
            before_state=EMPTY,
            after_state=GOOD_AFTER,
            test=logged_test(),
        )
        == "skipped"
    )


# --- test_only_lookup_and_log_called -----------------------------------------


def test_allowlist_passes_lookup_plus_one_log_call():
    """The direction the pre-#3244 `test_only_wikipedia_search_called` would
    have failed: every positive run now calls `research_log_append` once."""
    assert _run(check_allowlist, tool_calls=[WIKI_CALL, LOG_CALL], test=logged_test()) == "passed"
    assert _run(check_allowlist, tool_calls=[WIKI_CALL, LOG_CALL], test=no_project_test()) == "passed"


def test_allowlist_fails_a_disallowed_tool():
    _expect_failure(
        check_allowlist, "also called",
        tool_calls=[WIKI_CALL, {"tool": "mcp__genealogy__research_append", "args": {}}, LOG_CALL],
        test=logged_test(),
    )


def test_allowlist_fails_two_log_calls():
    _expect_failure(
        check_allowlist, "at most 1 research_log_append",
        tool_calls=[WIKI_CALL, LOG_CALL, LOG_CALL],
        test=logged_test(),
    )


def test_allowlist_fails_a_log_call_on_a_decline():
    _expect_failure(
        check_allowlist, "at most 0 research_log_append",
        tool_calls=[LOG_CALL],
        test=decline_test(["scope-decline"]),
    )


@pytest.mark.parametrize(
    "spelling",
    ["mcp__remote-devices__Genealogy_Research__research_log_append", "mcp__Genealogy_Research__research_log_append"],
)
def test_allowlist_counts_every_spelling(spelling):
    """The count is by bare name, so a second log call under another server
    spelling still trips it, and a single one under it still passes."""
    other = {"tool": spelling, "args": {}}
    assert _run(check_allowlist, tool_calls=[WIKI_CALL, other], test=logged_test()) == "passed"
    _expect_failure(
        check_allowlist, "at most 1 research_log_append",
        tool_calls=[WIKI_CALL, LOG_CALL, other],
        test=logged_test(),
    )


# --- the scope-decline and no-project skips, both directions ----------------


def test_the_log_validators_skip_the_decline_test():
    """A decline logs nothing, so the workflow validators must stand down.
    Without the skips a positive decline test would fail them for behaving
    exactly as the agent body requires."""
    t = decline_test(["no-wiki-no-write", "scope-decline", "direct-arm"])
    assert _run(check_one_call, tool_calls=[], test=t) == "skipped"
    assert _run(check_one_entry, before_state=EMPTY, after_state=EMPTY, test=t) == "skipped"
    assert (
        _run(check_template, before_state=EMPTY, after_state=EMPTY, tool_calls=[], test=t)
        == "skipped"
    )
    assert (
        _run(check_title, before_state=EMPTY, after_state=EMPTY, tool_calls=[], test=t)
        == "skipped"
    )


def test_the_log_validators_skip_the_no_project_test():
    t = no_project_test()
    assert _run(check_one_entry, before_state=EMPTY, after_state=EMPTY, test=t) == "skipped"
    assert (
        _run(check_template, before_state=EMPTY, after_state=EMPTY, tool_calls=[WIKI_CALL], test=t)
        == "skipped"
    )
    assert (
        _run(check_title, before_state=EMPTY, after_state=EMPTY, tool_calls=[WIKI_CALL], test=t)
        == "skipped"
    )


def test_the_log_validators_still_run_on_a_logged_test():
    """The direction a single break would miss. If a skip were written without
    its tag guard -- or the guard read the wrong key -- these would skip on
    every test in the suite and the log checks would be gone with nothing red."""
    t = logged_test()
    assert _run(check_one_call, tool_calls=[WIKI_CALL], test=t) == "passed"
    assert (
        _run(check_one_entry, before_state=EMPTY, after_state=GOOD_AFTER, test=t) == "passed"
    )
    assert (
        _run(check_template, before_state=EMPTY, after_state=GOOD_AFTER, tool_calls=[WIKI_CALL], test=t)
        == "passed"
    )
    assert (
        _run(check_title, before_state=EMPTY, after_state=GOOD_AFTER, tool_calls=[WIKI_CALL], test=t)
        == "passed"
    )


def test_one_entry_ignores_entries_already_in_the_log():
    """Only NEW entries count: a project that already holds log entries is not
    a second append."""
    before = _state([_entry(1, tool="record_search", notes=None)])
    after = _state([_entry(1, tool="record_search", notes=None), _entry(2)])
    assert _run(check_one_entry, before_state=before, after_state=after, test=logged_test()) == "passed"


def test_the_log_validators_still_fail_a_bad_logged_run():
    """And they must still be able to FAIL there -- `passed` results above
    would also be produced by validators that assert nothing."""
    t = logged_test()
    _expect_failure(
        check_one_entry, "expected exactly one new log entry",
        before_state=EMPTY, after_state=EMPTY, test=t,
    )
    _expect_failure(
        check_one_entry, "expected exactly one new log entry",
        before_state=EMPTY, after_state=_state([_entry(1), _entry(2)]), test=t,
    )
    _expect_failure(
        check_one_entry, "not 'wikipedia_search'",
        before_state=EMPTY, after_state=_state([_entry(tool="wiki_search")]), test=t,
    )
    _expect_failure(
        check_one_entry, "plan_item_id",
        before_state=EMPTY, after_state=_state([_entry(plan_item_id="plan_001_01")]), test=t,
    )
    _expect_failure(
        check_one_entry, "not a file",
        before_state=EMPTY,
        after_state=_state([_entry()], files={"schuylkill-county-pennsylvania.md": _NOTES}),
        test=t,
    )
    _expect_failure(
        check_one_call, "expected exactly 1 wikipedia_search call",
        tool_calls=[WIKI_CALL, WIKI_CALL], test=t,
    )


@pytest.mark.parametrize(
    "notes, match",
    [
        ("# Wrong", "verbatim"),
        (_NOTES.replace("is a county", "is a large county"), "verbatim"),
        (_NOTES + "\nIt is known for coal mining.\n", "exactly"),
        (_NOTES.replace("[Source](" + _URL + ")", ""), "verbatim"),
        (None, "must carry the filled template"),
    ],
    ids=["wrong", "paraphrased-extract", "appended-content", "dropped-source", "null-notes"],
)
def test_template_check_fails_bad_notes(notes, match):
    _expect_failure(
        check_template, match,
        before_state=EMPTY, after_state=_state([_entry(notes=notes)]),
        tool_calls=[WIKI_CALL], test=logged_test(),
    )


def test_template_check_tolerates_trailing_whitespace():
    """The legitimate variant: trailing newlines are not a defect."""
    assert _run(
        check_template,
        before_state=EMPTY,
        after_state=_state([_entry(notes=_NOTES.rstrip() + "\n\n  ")]),
        tool_calls=[WIKI_CALL],
        test=logged_test(),
    ) == "passed"


# --- test_notes_title_is_returned_title: redirect and verbatim accents -------

_FAMINE_CALL = {
    "tool": "mcp__genealogy__wikipedia_search",
    "args": {"query": "the potato famine"},
    "response": {
        "title": "Great Famine (Ireland)",
        "extract": "The Great Famine was a period of starvation in Ireland.",
        "url": "https://en.wikipedia.org/wiki/Great_Famine_(Ireland)",
    },
}
_WURTT_CALL = {
    "tool": "mcp__genealogy__wikipedia_search",
    "args": {"query": "Württemberg"},
    "response": {
        "title": "Württemberg",
        "extract": "Württemberg is a historical German territory.",
        "url": "https://en.wikipedia.org/wiki/W%C3%BCrttemberg",
    },
}


def _notes_for(call, title=None):
    r = call["response"]
    return f"# {title or r['title']}\n\n{r['extract']}\n\n---\n[Source]({r['url']})"


def test_title_check_passes_the_redirect_target():
    assert _run(
        check_title,
        before_state=EMPTY,
        after_state=_state([_entry(notes=_notes_for(_FAMINE_CALL))]),
        tool_calls=[_FAMINE_CALL],
        test=logged_test(["title-great-famine-ireland"]),
    ) == "passed"


def test_title_check_fails_the_query_as_title():
    _expect_failure(
        check_title, "came from the query",
        before_state=EMPTY,
        after_state=_state([_entry(notes=_notes_for(_FAMINE_CALL, "the potato famine"))]),
        tool_calls=[_FAMINE_CALL],
        test=logged_test(["title-great-famine-ireland"]),
    )


@pytest.mark.parametrize("folded", ["Wurttemberg", "W-rttemberg", "wurttemberg"])
def test_title_check_fails_a_folded_accent(folded):
    _expect_failure(
        check_title, "the returned title, verbatim",
        before_state=EMPTY,
        after_state=_state([_entry(notes=_notes_for(_WURTT_CALL, folded))]),
        tool_calls=[_WURTT_CALL],
        test=logged_test(["title-wurttemberg"]),
    )


def test_title_tag_pins_the_literal_title():
    """The belt-and-braces half: a tag naming a different title fails even
    when the H1 matches the response, so a broken response reader cannot pass
    itself."""
    _expect_failure(
        check_title, "pins the H1",
        before_state=EMPTY,
        after_state=_state([_entry(notes=_notes_for(_WURTT_CALL))]),
        tool_calls=[_WURTT_CALL],
        test=logged_test(["title-obrien-surname"]),
    )


# --- test_no_project_returns_template ---------------------------------------


def test_no_project_passes_a_template_reply():
    assert _run(
        check_no_project,
        before_state=EMPTY, after_state=EMPTY,
        tool_calls=[WIKI_CALL, LOG_CALL],
        agent_returns=[{"subagent_type": "search-wikipedia", "text": _NOTES}],
        text_response="relay",
        test=no_project_test(),
    ) == "passed"


def test_no_project_is_inert_without_the_tag():
    assert _run(
        check_no_project,
        before_state=EMPTY, after_state=GOOD_AFTER,
        tool_calls=[WIKI_CALL, LOG_CALL],
        agent_returns=[], text_response="Saved the Wikipedia summary to the research log.",
        test=logged_test(),
    ) == "skipped"


@pytest.mark.parametrize(
    "after, reply, match",
    [
        (GOOD_AFTER, _NOTES, "nothing may be logged"),
        (_state(files={"schuylkill-county-pennsylvania.md": _NOTES}), _NOTES, "not a file"),
        (EMPTY, "Saved the Wikipedia summary to the research log.", "filled template, verbatim"),
        (EMPTY, _NOTES.replace("is a county", "is a large county"), "filled template, verbatim"),
    ],
    ids=["logged-anyway", "wrote-a-file", "claims-a-save", "paraphrased-template"],
)
def test_no_project_fails(after, reply, match):
    _expect_failure(
        check_no_project, match,
        before_state=EMPTY, after_state=after,
        tool_calls=[WIKI_CALL, LOG_CALL],
        agent_returns=[{"subagent_type": "search-wikipedia", "text": reply}],
        text_response="relay",
        test=no_project_test(),
    )


# --- the narration check reads the agent's return, not the dispatcher's -------

_AGENT_LINE = "Saved the Wikipedia summary to the research log."
_NARRATING = "Now I'll log the filled template to the research log."


def _returns(text, subagent_type="search-wikipedia"):
    return [{"subagent_type": subagent_type, "text": text}]


def test_narration_check_passes_a_clean_agent_return_under_a_narrating_relay():
    """The dispatcher's relay is not the subject: a clean agent return passes
    even when `text_response` narrates."""
    assert _run(
        check_narration,
        agent_returns=_returns(_AGENT_LINE),
        text_response=_NARRATING,
        test=logged_test(),
    ) == "passed"


def test_narration_check_fails_a_narrating_agent_return_under_a_clean_relay():
    _expect_failure(
        check_narration, "narrates a pending step",
        agent_returns=_returns(_NARRATING),
        text_response=_AGENT_LINE,
        test=logged_test(),
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
        test=logged_test(),
    )

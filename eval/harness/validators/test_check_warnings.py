"""Validators for the check-warnings agent (a skill until issue #2118).

check-warnings calls the `person_warnings` MCP tool and surfaces the results
as narrative output. Inside a project it logs that report as one
`check_warnings` research-log entry (issue #3524) and writes nothing else; it
never modifies tree.gedcomx.json.

The rubric (rubric.md) keeps the narrative-judgment dimensions
(detection accuracy, severity classification, actionability). The
mechanical "didn't modify anything" rules live here.

See test_universal.py module docstring for the full validator
function-signature contract.
"""

from __future__ import annotations

import re

import pytest

from validators_lib import assert_only_logs_report, assert_report_logged


# --- Write enforcement ---

def test_research_json_only_logs_report(before_state, after_state, test):
    """check-warnings' one research.json write is its report, logged as a
    single `check_warnings` entry (issue #3524); warnings are never written
    anywhere else in the file.

    Skipped on negative tests: the LLM is expected to route away to
    another skill (e.g. conflict-resolution), which may legitimately
    modify project files as part of its own contract. Attributing those
    writes to check-warnings would be a false positive. Mirrors the
    same guard in test_universal.py's test_ownership_table.
    """
    if test.get("type") != "positive":
        pytest.skip("negative tests don't run the skill body")
    assert_only_logs_report(before_state, after_state, "check_warnings", "check-warnings")


def test_report_logged(before_state, after_state, test):
    """Tag `logs-report`: exactly one new `check_warnings` entry carrying the
    report."""
    if "logs-report" not in test.get("tags", []):
        pytest.skip("not a logs-report test")
    assert_report_logged(before_state, after_state, "check_warnings")


def test_tree_gedcomx_unmodified(before_state, after_state, test):
    """check-warnings must not modify tree.gedcomx.json either.

    Skipped on negative tests (see test_research_json_only_logs_report).
    """
    if test.get("type") != "positive":
        pytest.skip("negative tests don't run the skill body")
    before = (
        before_state.get("tree_gedcomx_json")
        or before_state.get("tree_gedcomx")
    )
    after = (
        after_state.get("tree_gedcomx_json")
        or after_state.get("tree_gedcomx")
    )
    if before is None or after is None:
        pytest.skip("Missing tree.gedcomx.json for diff")
    assert before == after, (
        "check-warnings modified tree.gedcomx.json — this skill is read-only."
    )


# --- V2: No unsourced 4-digit year in the response ---

def report_unsourced_year_in_response(tool_calls, text_response, test):
    """V2: every 4-digit year in the response must come from a tool response
    the run actually received, or from the user's own message. No arithmetic or
    tree knowledge the tool never returned.

    Tier 2 — reports, never gates.

    Reads `tool_calls[].response` — the response the mock actually returned and
    recorded (`mock_mcp.py`, all five `call_log.append` sites). Do NOT resolve
    `response_fixture` to a file under `eval/fixtures/mcp/` instead: the mock
    ENRICHES a fixture response after selecting it and before logging it, and
    `live`/`none` calls have no fixture file at all, so the fixture path cannot
    reproduce what the skill saw. `orchestrator._tool_call_entry` documents this
    and is why the run log keeps those responses.

    Skipped on negative tests: the skill body does not run so produces no
    figures of its own.

    Known looseness (acceptable at tier 2): the year pattern also matches
    4-digit non-years (record counts, ids), and membership is a substring test,
    so `1850` is considered sourced if the source text contains `18501`. Both
    err toward silence rather than a false observation.

    Shape copied from test_universal.report_unbacked_validation_claim.
    """
    import json as _json
    import re as _re

    if test.get("type") == "negative":
        pytest.skip("negative test — skill body does not run")
    response = text_response or ""
    if not response.strip():
        pytest.skip("no response text to check")

    years = set(_re.findall(r"\b\d{4}\b", response))
    if not years:
        return  # no 4-digit years in response

    # Everything the skill was legitimately given: the user's message plus
    # every tool response the run received.
    source_texts: list[str] = []

    # user_message is threaded into test by the orchestrator (issue #1965)
    user_message = test.get("user_message", "")
    if user_message:
        source_texts.append(user_message)

    for call in (tool_calls or []):
        if "response" not in call:
            continue
        source_texts.append(_json.dumps(call.get("response"), default=str))

    all_source = " ".join(source_texts)
    unsourced = sorted(y for y in years if y not in all_source)
    if unsourced:
        raise AssertionError(
            f"the response contains {unsourced} — 4-digit year(s) absent from "
            "every tool response this run received and from the user's "
            "message; SKILL.md forbids citing figures the tool never returned"
        )


# --- Census missing children (issue #3260) ---

def _bare(call) -> str:
    return (call.get("tool") or "").rsplit("__", 1)[-1]


def test_census_counts_go_through_the_tool(tool_calls, test):
    """Tag-gated on `census-gap`. Given a mother's census counts, the agent
    calls `census_children_gap` in tree mode -- `motherId`, and no
    `knownChildren` -- so the tool reads the children and their dates from the
    tree. Hand-copied dates are the failure the tool exists to remove: prose got
    the birth window wrong 3 of 9 times (issue #2122)."""
    if "census-gap" not in test.get("tags", []):
        pytest.skip("not a census-gap test")
    calls = [c for c in (tool_calls or []) if _bare(c) == "census_children_gap"]
    assert calls, "the census counts were never passed to census_children_gap"
    for call in calls:
        args = call.get("args") or {}
        assert args.get("motherId"), (
            f"census_children_gap was called without motherId: {sorted(args)}"
        )
        assert "knownChildren" not in args, (
            "census_children_gap was handed knownChildren -- dates copied by hand "
            "instead of read from the tree"
        )


_AFTER_1900_WINDOW = re.compile(
    r"between\s+(?:about\s+|around\s+)?19(?:0[1-9]|10)\b"
    r"|between\s+(?:about\s+|around\s+)?18\d\d\s+and\s+(?:early\s+|about\s+)?19(?:0[1-9]|10)\b"
    r"|born\s+(?:sometime\s+)?after\s+(?:the\s+)?(?:june\s+)?(?:1,?\s+)?1900\b",
    re.I,
)
_BY_1900_WINDOW = re.compile(
    r"before\s+(?:june\s+)?(?:1,?\s+)?1900\b"
    r"|\bby\s+(?:june\s+)?(?:1,?\s+)?1900\b"
    r"|on\s+or\s+before\s+(?:june\s+1,?\s+)?1900"
    r"|between\s+(?:about\s+|around\s+)?18\d\d\s+and\s+(?:before\s+)?(?:june\s+|~)?(?:1900|18\d\d)\b",
    re.I,
)


def test_census_missing_living_child_born_by_1900(test, agent_returns=None, text_response=None):
    """Tag-gated on `census-living-cumulative` (the Brannon test, ported from
    the deleted init-project validator for ut_init_project_wm7). The tree holds
    two children born before 1900 and one born in 1904; the census counts 3 born
    by 1900 and 4 by 1910. The one missing child is therefore born by 1900. The
    reply must place it by 1900, and never in a window that starts after 1900.

    A validator because the judge misgraded this both ways on one scratch run of
    the original test: a 1901-1910 answer passed and a 1896-1900 answer failed."""
    if "census-living-cumulative" not in test.get("tags", []):
        pytest.skip("not the census living-child window test")
    from harness.skill_runner import subject_reply_text

    reply = subject_reply_text(agent_returns, text_response, "check-warnings", test)
    late = _missing_child_placed_after_1900(reply)
    assert not late, f"the missing child is placed after 1900: {late!r}"
    assert _BY_1900_WINDOW.search(reply), "the reply never places the missing child by 1900"


_SENTENCE = re.compile(r"(?<=[.;!?])\s+|\n")
_NEGATED = re.compile(r"\bnot\s+(?:\w+\s+){0,2}$", re.I)


def _missing_child_placed_after_1900(reply: str) -> str | None:
    """An after-1900 window in a sentence about the missing child. A sentence
    about a child already in the tree ("Thomas, born after 1900, is already in
    the tree") or a negated window ("not born after 1900") is the right answer's
    reasoning, not a misplacement."""
    for sentence in _SENTENCE.split(reply):
        if re.search(r"\balready\b", sentence, re.I):
            continue
        m = _AFTER_1900_WINDOW.search(sentence)
        if m and not _NEGATED.search(sentence[: m.start()]):
            return m.group(0)
    return None


_HANDBACK_INIT_PROJECT = re.compile(r"Hand-back:\s*`?init-project\b", re.I)


def test_no_project_hands_back_to_init_project(tool_calls, test, agent_returns=None, text_response=None):
    """Tag-gated on `no-project`. In a folder with no project the agent learns
    so from `person_warnings`' own `no_project` answer (check-warnings holds no
    file read), makes no other call, and hands back to init-project. It must
    never create the project itself."""
    if "no-project" not in test.get("tags", []):
        pytest.skip("not a no-project test")
    from harness.skill_runner import subject_reply_text

    names = [_bare(c) for c in (tool_calls or [])]
    assert names, "no tool was called, so nothing established that the folder holds no project"
    assert set(names) == {"person_warnings"}, (
        f"only person_warnings may be called in a folder with no project; got {names}"
    )
    answers = [c.get("response") or {} for c in tool_calls]
    assert all(a.get("reason") == "no_project" for a in answers), (
        f"person_warnings did not answer no_project: {answers}"
    )
    reply = subject_reply_text(agent_returns, text_response, "check-warnings", test)
    assert _HANDBACK_INIT_PROJECT.search(reply), (
        "the reply never hands back to init-project"
    )


# --- V3: An out-of-lane request is handed back to its owner ---

# Lives in test_universal.py since tree-edit became its second user (issue #2805).

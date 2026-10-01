"""Validators for the check-warnings agent (a skill until issue #2118).

check-warnings is read-only — it calls the `person_warnings` MCP tool and
surfaces the results as narrative output. It does not modify research.json or
tree.gedcomx.json.

The rubric (rubric.md) keeps the narrative-judgment dimensions
(detection accuracy, severity classification, actionability). The
mechanical "didn't modify anything" rules live here.

See test_universal.py module docstring for the full validator
function-signature contract.
"""

from __future__ import annotations

import pytest


# --- Read-only enforcement ---

def test_research_json_unmodified(before_state, after_state, test):
    """check-warnings must not modify research.json. The skill reports
    warnings as narrative output — the project file is read-only input.

    Skipped on negative tests: the LLM is expected to route away to
    another skill (e.g. conflict-resolution), which may legitimately
    modify project files as part of its own contract. Attributing those
    writes to check-warnings would be a false positive. Mirrors the
    same guard in test_project_status.py and test_universal.py's
    test_ownership_table.
    """
    if test.get("type") != "positive":
        pytest.skip("negative tests don't run the skill body")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    assert before == after, (
        "check-warnings modified research.json — this skill is read-only. "
        "Warnings should be reported as narrative, not written into the file."
    )


def test_tree_gedcomx_unmodified(before_state, after_state, test):
    """check-warnings must not modify tree.gedcomx.json either.

    Skipped on negative tests (see test_research_json_unmodified).
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


# --- V3: An out-of-lane request is handed back to its owner ---

# Lives in test_universal.py since tree-edit became its second user (issue #2805).

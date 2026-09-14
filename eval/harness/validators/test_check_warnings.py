"""Skill-specific validators for the check-warnings skill.

check-warnings is a read-only analysis skill — it invokes the
`person_warnings` MCP tool (declared in allowed-tools) and surfaces
the results as narrative output. It does not modify research.json or
tree.gedcomx.json.

The rubric (rubric.md) keeps the narrative-judgment dimensions
(detection accuracy, severity classification, actionability). The
mechanical "didn't modify anything" rules live here.

Tool-usage enforcement is handled by the universal `test_tool_allowlist`,
which validates calls against the skill's `allowed-tools` frontmatter —
there is no separate `test_no_mcp_tools_called` here because check-warnings
legitimately calls `person_warnings` as its checking engine.

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


# --- V1: No FamilySearch quality mention without a person_quality call ---

def report_no_fs_quality_mention_without_call(tool_calls, text_response, test):
    """V1: a run with no person_quality call must not mention FamilySearch quality.

    Tier 2 — reports, never gates. SKILL.md states the rule twice: "skip this
    call silently ... do not mention FamilySearch quality at all for that
    person" and "Say **nothing** about FamilySearch quality -- do not add a
    'not available' note." A mention can appear as a standalone note, a
    routing remark, or even a single clause of an opening sentence — all are
    violations.

    Skipped on negative tests: the skill body does not run so no quality call
    is expected by design.

    Matched per sentence, on co-occurrence of "familysearch" and "quality",
    rather than on the adjacent phrase "familysearch quality". Once the
    person_quality check above has returned, ANY pairing of the two in one
    sentence is a violation, so the loose match has nothing to false-positive
    on — while the adjacent-phrase form missed every real paraphrase the
    committed logs contain ("no FamilySearch quality score as ... has a local
    project ID" matches either way, but "quality score from FamilySearch" and
    "FamilySearch's quality" do not match the phrase form).

    Two silent-wrong traps to avoid:
    - tool_calls is pre-resolved as the run's output; reading test["tool_calls"]
      always returns [] and makes every run look applicable.
    - Tool names are fully qualified (mcp__genealogy__person_quality), so
      equality-matching on "person_quality" never hits — use endswith() instead.
    """
    import re as _re

    if test.get("type") == "negative":
        pytest.skip("negative test — skill body does not run")
    response = text_response or ""
    if not response.strip():
        pytest.skip("no response text to check")

    has_quality_call = any(
        (c.get("tool") or "").endswith("person_quality")
        for c in (tool_calls or [])
    )
    if has_quality_call:
        return  # quality call happened — any mention is legitimate

    for sentence in _re.split(r"(?<=[.!?;:])\s+|\n+", response):
        low = sentence.lower()
        if "familysearch" in low and "quality" in low:
            raise AssertionError(
                "the response mentions FamilySearch quality but person_quality "
                "was never called — SKILL.md forbids any mention (standalone "
                "note, 'not available' remark, or routing narration) when the "
                f"id is synthetic and the tool was skipped: {sentence.strip()!r}"
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


# --- V3: Conflict-resolution handoff is completely silent ---

def test_conflict_resolution_handoff_is_silent(
    tool_calls, text_response, skills_invoked, test
):
    """V3: on a conflict-resolution silent-handoff test the run must make zero
    tool calls, return an empty response, and have 'conflict-resolution' in
    skills_invoked. All three must hold, or it is a violation.

    Tier 1 — gates (test_* prefix). Tag-gated: skips unless the test carries
    the 'silent-handoff' tag. Paired with negative.grade_on_invariant: true on
    negative-source-conflict.json, this hands the verdict to the validator and
    drops the judge to diagnostic — stopping the 1/1 grading on a byte-identical
    compliant run that occurred in 3 of 5 committed logs.

    SKILL.md absolutes:
      "Invoke the conflict-resolution skill right away ... as your first and
      only action"
      "Write no reply of your own — no preamble, no explanation, no summary."
    """
    if "silent-handoff" not in test.get("tags", []):
        pytest.skip("not a silent-handoff test")

    assert (tool_calls or []) == [], (
        "silent handoff must make zero tool calls; got "
        f"{len(tool_calls or [])} call(s): "
        + ", ".join(c.get("tool", "?") for c in (tool_calls or []))
    )
    assert not (text_response or "").strip(), (
        "silent handoff must produce an empty response; "
        f"got {len((text_response or '').strip())} non-whitespace characters"
    )
    assert "conflict-resolution" in (skills_invoked or []), (
        "silent handoff must invoke conflict-resolution via the Skill tool; "
        f"skills_invoked = {skills_invoked!r}"
    )

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

    if _re.search(r"familysearch\s+quality", response, _re.IGNORECASE):
        raise AssertionError(
            "the response mentions FamilySearch quality but person_quality was "
            "never called — SKILL.md forbids any mention (standalone note, "
            "'not available' remark, or routing narration) when the id is "
            "synthetic and the tool was skipped"
        )


# --- V2: No unsourced 4-digit year in the response ---

def report_unsourced_year_in_response(tool_calls, text_response, test):
    """V2: every 4-digit year in the response must come from a resolved tool
    fixture response or from the user's own message. No arithmetic or tree
    knowledge the tool never returned.

    Tier 2 — reports, never gates. Resolution path for each tool call:
      tool_calls[].response_fixture -> eval/fixtures/mcp/<name>.json -> .response
    Live tool calls (response_fixture beginning 'live:') are skipped — they
    have no fixture file and must not be treated as contributing nothing.

    Skipped on negative tests: the skill body does not run so produces no
    figures of its own.

    Shape copied from test_universal.report_unbacked_validation_claim.
    """
    import json as _json
    import re as _re
    from pathlib import Path as _Path

    if test.get("type") == "negative":
        pytest.skip("negative test — skill body does not run")
    response = text_response or ""
    if not response.strip():
        pytest.skip("no response text to check")

    years = set(_re.findall(r"\b\d{4}\b", response))
    if not years:
        return  # no 4-digit years in response

    # Collect all text the skill was legitimately given
    source_texts: list[str] = []

    # user_message is threaded into test by the orchestrator (issue #1965)
    user_message = test.get("user_message", "")
    if user_message:
        source_texts.append(user_message)

    fixtures_dir = _Path(__file__).parent.parent.parent / "fixtures" / "mcp"
    for call in (tool_calls or []):
        rf = call.get("response_fixture") or ""
        if not rf or rf.startswith("live:"):
            continue
        fixture_path = fixtures_dir / f"{rf}.json"
        if not fixture_path.exists():
            continue
        try:
            data = _json.loads(fixture_path.read_text(encoding="utf-8"))
            response_val = data.get("response")
            if response_val is not None:
                source_texts.append(_json.dumps(response_val))
        except Exception:
            continue

    all_source = " ".join(source_texts)
    unsourced = sorted(y for y in years if y not in all_source)
    if unsourced:
        raise AssertionError(
            f"the response contains {unsourced} — 4-digit year(s) absent from "
            "every resolved fixture response and the user's message; SKILL.md "
            "forbids citing figures the tool never returned"
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

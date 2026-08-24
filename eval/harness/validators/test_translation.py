"""Skill-specific validators for the translation skill.

translation is a pure model task — it translates foreign-language record
text and explains genealogically significant terms. Narrative quality
(accuracy, notation of uncertainty, cultural context, date formatting)
lives in the rubric — graded by the LLM judge.

Two mechanical checks: the skill doesn't call MCP tools (it has none in
its allowed-tools frontmatter and shouldn't need any), and every full
translation ends with both workflow hand-off offers.

The split between the two instruments is deliberate and has been got
wrong in both directions. A check belongs here only when the rubric has
no dimension for it: `test_iso_date_formatting` was removed in 0300f881
because rubric.md's "Date formatting" dimension grades the same thing,
and a failing validator suppresses the judge wholesale
(harness/orchestrator.py:495 gates the judge call on `validators_passed`),
so the blunter copy pre-empted the finer one on exactly the runs it
existed to grade. `test_next_step_offers` was removed in the same commit
for that reason, but the reason did not hold: rubric.md's "Next-step
offers" dimension had already been deleted in 56b9f3e *because this
validator covered it*, so the removal left the offers graded by nothing.
Before deleting either check, confirm the rubric dimension it duplicates
actually exists.

See test_universal.py module docstring for the validator function-
signature contract. The `test` argument is the parsed test JSON dict
(the inner "test" block) — used to gate test-specific checks on
`test["tags"]`.
"""

from __future__ import annotations

import re

import pytest


# --- Tool-call enforcement -------------------------------------------

def test_no_mcp_tools_called(tool_calls, test):
    """translation is a pure model task — it shouldn't call any *research*
    MCP tool. The universal `validate_research_schema` is exempted: post
    commit 861d3c9 it's the built-in schema verifier any skill may
    call, not a research tool."""
    if test.get("type") != "positive":
        pytest.skip("negative tests are graded by routing, not tool use")
    mcp_calls = [
        tc for tc in tool_calls
        if tc.get("tool", "").startswith("mcp__")
        and tc.get("tool", "").rsplit("__", 1)[-1] != "validate_research_schema"
    ]
    assert not mcp_calls, (
        "translation should not call MCP tools (other than "
        f"validate_research_schema), but called: "
        f"{[tc['tool'] for tc in mcp_calls]}"
    )


# --- Text-response checks --------------------------------------------------
#
# `text_response` is injected by validator_runner.py (parameter at its
# run_validators() signature, threaded into the kwargs dict it builds for
# inspect.signature injection). The check below runs for real.


def test_next_step_offers(text_response: str, test: dict) -> None:
    """SKILL.md Step 5 requires both workflow handoff offers after every
    positive translation.  The canonical phrases are:
      - "Extract assertions from this record?"  (record-extraction)
      - "Link [person] to the tree?"            (person-evidence)
    9 of 10 positive tests in v1_2026-07-27 omit the person-evidence offer,
    substituting open-ended genealogical research suggestions instead.

    Single-term lookups are exempt. SKILL.md Step 5 carves out a response
    that is a bare word-definition or date conversion with no extracted
    record, and ut_translation_008's own judge_context agrees ("offering
    record-extraction as an optional next step is fine"). Without the
    exemption this validator fails that test for obeying SKILL.md, which
    is a defect in the check rather than in the skill. Gated on the
    `single-term` tag, which only that test carries; the other nine
    positive tests are full record translations and still enforce both
    offers.
    """
    if test.get("type") != "positive":
        pytest.skip("negative tests are graded by routing, not response content")
    if "single-term" in (test.get("tags") or []):
        pytest.skip(
            "single-term lookups are exempt per SKILL.md Step 5 — a bare "
            "definition or date conversion needs no workflow hand-off offer"
        )
    has_extract = bool(re.search(r"Extract assertions from this record", text_response, re.IGNORECASE))
    has_link = bool(re.search(r"Link .{1,40} to the tree", text_response, re.IGNORECASE))
    assert has_extract, (
        "translation response missing required next-step offer: "
        "'Extract assertions from this record?' (record-extraction)"
    )
    assert has_link, (
        "translation response missing required next-step offer: "
        "'Link [person] to the tree?' (person-evidence) -- "
        "found only open-ended research suggestions instead"
    )

"""Skill-specific validators for the translation skill.

translation is a pure model task — it translates foreign-language record
text and explains genealogically significant terms. Narrative quality
(accuracy, notation of uncertainty, cultural context, date formatting)
lives in the rubric — graded by the LLM judge.

Three mechanical checks: the skill doesn't call MCP tools (it has none
in its allowed-tools frontmatter and shouldn't need any), every full
translation ends with both workflow hand-off offers, and a response
carrying prose dates carries at least one ISO 8601 date.

The split between the two instruments has been got wrong in both
directions, so state the cost plainly. A failing validator suppresses
the judge wholesale — orchestrator.py gates the judge call on
`validators_passed` and `_compute_outcome` returns "fail" without it —
so a check here costs the whole dimension breakdown on every run it
fails. `test_next_step_offers` was removed in 0300f881 on that reasoning
and the reasoning did not hold: rubric.md's "Next-step offers" dimension
had already been deleted in 56b9f3e *because this validator covered it*,
so the removal left the offers graded by nothing.

`test_iso_date_formatting` is the case where the cost is real and
accepted. rubric.md's "Date formatting" dimension does grade the same
rule, so the two overlap; the validator is deliberately the weaker of
the pair, firing only on a total absence of ISO dates, and the dimension
grades the partial case it cannot see. When it fires, the run loses its
dimension scores and reads as a bare fail — read the validator error,
not the missing grades. Before deleting either check, confirm the rubric
dimension it duplicates actually exists.

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


def test_iso_date_formatting(text_response: str, test: dict) -> None:
    """SKILL.md requires ISO 8601 dates (YYYY-MM-DD) alongside prose dates in
    assertions sections.  5 of 10 positive tests in v1_2026-07-27 write dates
    like '14 March 1843' with no ISO parenthetical; correct form is
    '14 March 1843 (1843-03-14)'.

    This is a floor, not the full rule: it fires only when the response
    carries prose dates and *no* ISO date at all. rubric.md's "Date
    formatting" dimension grades the rest — whether every date carries its
    ISO form, the partial case this check cannot see.
    """
    if test.get("type") != "positive":
        pytest.skip("negative tests are graded by routing, not response content")
    MONTH = (
        r"January|February|March|April|May|June|"
        r"July|August|September|October|November|December"
    )
    prose_dates = re.findall(rf"\d{{1,2}}\s+(?:{MONTH})\s+\d{{4}}", text_response)
    if not prose_dates:
        pytest.skip("no English prose dates in response; ISO check not applicable")
    iso_dates = re.findall(r"\b\d{4}-\d{2}-\d{2}\b", text_response)
    assert iso_dates, (
        f"response contains {len(prose_dates)} prose date(s) "
        f"({prose_dates[:2]}) but no ISO 8601 dates (YYYY-MM-DD). "
        "SKILL.md requires the ISO form alongside every prose date."
    )

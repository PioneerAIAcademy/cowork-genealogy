"""Skill-specific validators for the translation skill.

translation is a pure model task — it translates foreign-language record
text and explains genealogically significant terms. Narrative quality
(accuracy, notation of uncertainty, cultural context) lives in the
rubric — graded by the LLM judge. The only mechanical check is that
the skill doesn't call MCP tools (it has none in its allowed-tools
frontmatter and shouldn't need any).

See test_universal.py module docstring for the validator function-
signature contract. The `test` argument is the parsed test JSON dict
(the inner "test" block) — used to gate test-specific checks on
`test["tags"]`.
"""

from __future__ import annotations

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


# --- Text-response checks (requires harness text_response injection) --------
#
# Both functions below use 	ext_response: str which is NOT yet injected by
# eval/harness/harness/validator_runner.py.  To enable them a developer must:
#   1. Add 	ext_response: str = "" to the run_validators() call-site in
#      validator_runner.py, passing the run's output.text_response value.
#   2. Add "text_response" to the kwargs dict that the runner builds before
#      calling each validator function via inspect.signature injection.
# Until then the harness will raise TypeError on these and they should be
# treated as pending / skipped in CI.

import re


def test_next_step_offers(text_response: str, test: dict) -> None:
    """SKILL.md Step 5 requires both workflow handoff offers after every
    positive translation.  The canonical phrases are:
      - "Extract assertions from this record?"  (record-extraction)
      - "Link [person] to the tree?"            (person-evidence)
    9 of 10 positive tests in v1_2026-07-27 omit the person-evidence offer,
    substituting open-ended genealogical research suggestions instead.
    """
    if test.get("type") != "positive":
        pytest.skip("negative tests are graded by routing, not response content")
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

"""Skill-specific validators for the historical-context skill.

historical-context is a read-only narrative skill — it produces
narrative analysis tying historical background to research-relevant
record classes and shouldn't modify research.json or tree.gedcomx.json.
Narrative-quality dimensions (Relevance to research, Source quality,
Genealogical implications) live in the rubric — graded by the LLM judge.

The universal ownership table already enforces read-only behavior on
research.json (historical-context owns no section, so any write fails
test_universal.test_ownership_table). The check below makes the
no-research-mutation expectation explicit at the per-skill level too.

See test_universal.py module docstring for the validator function-
signature contract. The `test` argument is the parsed test JSON dict
(the inner "test" block) — used to gate test-specific checks on
`test["tags"]`.
"""

from __future__ import annotations

import pytest


# --- No-write enforcement --------------------------------------------

def test_does_not_modify_research_json(before_state, after_state, test):
    """historical-context is read-only — it must not modify research.json.
    The universal ownership table catches this too, but the explicit
    per-skill check surfaces the design intent here."""
    if test.get("type") != "positive":
        pytest.skip("only positive tests can exercise writes")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("no research.json in scenario")
    assert before == after, (
        "historical-context modified research.json; it is a read-only skill"
    )

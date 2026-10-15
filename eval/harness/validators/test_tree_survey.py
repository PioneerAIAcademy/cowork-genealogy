"""Skill-specific validators for the tree-survey agent.

tree-survey calls `tree_gaps` once, checks what FamilySearch holds for the
strongest holes, and returns 3-5 suggestions, each a person and one research
question. It writes nothing. Whether a question is a single fact, and whether
the prose is plain, is judged by the rubric; the checks here are the ones a
reader can verify from the tool calls and the reply alone.

Tag gates: `survey` marks a positive test, `no-holes` a tree with nothing to
suggest, `many-holes` and `misfit-hint` the ranking tests.

See test_universal.py module docstring for the validator function-signature
contract.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from validators_lib import bare_tool_name

_FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "mcp"
# A FamilySearch id always carries a letter, so a year range ("1850-1919") is not one.
_ID = re.compile(r"\b(?=[A-Z0-9-]*[A-Z])[A-Z0-9]{4}-[A-Z0-9]{3,4}\b")
# A suggestion line starts with its person's id, after any list marker or bold.
_LEAD = re.compile(r"^\s*(?:[-*•]|\d+[.)])?\s*\**\s*(" + _ID.pattern + ")")
_SEARCH_TOOLS = {
    "person_record_matches",
    "person_quality",
    "record_search",
    "collections_search",
    "place_search",
}


def _calls(tool_calls, name):
    return [c for c in (tool_calls or []) if bare_tool_name(c.get("tool", "")) == name]


def _reply(agent_returns, text_response, test):
    from harness.skill_runner import subject_reply_text

    return subject_reply_text(agent_returns, text_response, test.get("skill") or "", test)


def _split(reply: str) -> tuple[str, str]:
    """(caller lines, prose after the final `---` line)."""
    parts = re.split(r"(?m)^\s*---\s*$", reply)
    if len(parts) < 2:
        return reply, ""
    return "\n".join(parts[:-1]), parts[-1]


def _hole_ids(tool_calls) -> set[str]:
    """Every person and spouse the `tree_gaps` fixture this run was served names."""
    ids: set[str] = set()
    for c in _calls(tool_calls, "tree_gaps"):
        name = c.get("response_fixture")
        if not name:
            continue
        body = json.loads((_FIXTURES / f"{name}.json").read_text(encoding="utf-8"))
        for g in body["response"].get("gaps", []):
            ids.add(g["personId"])
            if g.get("spouseId"):
                ids.add(g["spouseId"])
    return ids


def _suggested_ids(reply: str) -> list[str]:
    """The id each suggestion line leads with, in order. Other lines that mention
    an id (the hint to run init-project with it) are not suggestions."""
    seen: list[str] = []
    for line in _split(reply)[0].splitlines():
        m = _LEAD.match(line)
        if m:
            seen.append(m.group(1))
    return seen


def test_tree_gaps_called_once_with_the_delegations_person(tool_calls, test):
    if "survey" not in test.get("tags", []):
        pytest.skip("not a survey test")
    calls = _calls(tool_calls, "tree_gaps")
    assert len(calls) == 1, f"tree_gaps must be called exactly once; got {len(calls)}"
    m = re.search(r"personId:\s*(\S+)", test.get("user_message") or test.get("delegation") or "")
    if m:
        assert calls[0].get("args", {}).get("personId") == m.group(1), (
            f"tree_gaps was not called with the delegation's personId {m.group(1)}: "
            f"{calls[0].get('args')}"
        )


def test_no_search_on_a_tree_with_no_holes(tool_calls, test):
    if "no-holes" not in test.get("tags", []):
        pytest.skip("not a no-holes test")
    made = [bare_tool_name(c.get("tool", "")) for c in (tool_calls or [])]
    bad = [t for t in made if t in _SEARCH_TOOLS]
    assert not bad, f"no hole was returned, so nothing may be checked; got {bad}"


def test_no_call_is_made_twice(tool_calls, test):
    if "survey" not in test.get("tags", []):
        pytest.skip("not a survey test")
    seen = set()
    for c in tool_calls or []:
        key = (bare_tool_name(c.get("tool", "")), json.dumps(c.get("args", {}), sort_keys=True))
        assert key not in seen, f"identical call made twice: {key[0]} {key[1]}"
        seen.add(key)


def test_no_identifier_after_the_summary_separator(agent_returns, text_response, test):
    if "survey" not in test.get("tags", []):
        pytest.skip("not a survey test")
    reply = _reply(agent_returns, text_response, test)
    assert re.search(r"(?m)^\s*---\s*$", reply), "the return has no `---` line before the user-facing prose"
    prose = _split(reply)[1]
    found = _ID.findall(prose)
    assert not found, f"identifiers in the user-facing prose: {found}"


def test_suggestions_are_holes_at_most_five_and_distinct(tool_calls, agent_returns, text_response, test):
    if "survey" not in test.get("tags", []) or "no-holes" in test.get("tags", []):
        pytest.skip("not a test with holes")
    ids = _suggested_ids(_reply(agent_returns, text_response, test))
    holes = _hole_ids(tool_calls)
    assert holes, "no tree_gaps fixture was served, so no suggestion can be checked"
    assert ids, "no suggestion line leads with a person's identifier"
    stray = [i for i in ids if i not in holes]
    assert not stray, f"suggested a person no hole names: {stray}"
    assert len(set(ids)) <= 5, f"more than 5 people suggested: {sorted(set(ids))}"
    assert len(ids) == len(set(ids)), f"a person is suggested twice: {ids}"


# Ranking tests: the tag says which hole's person must lead the suggestions.
_FIRST_BY_TAG = {"many-holes": "TGAP-H3A", "misfit-hint": "TGAP-M2A"}


def test_the_hole_with_a_fitting_hint_ranks_first(agent_returns, text_response, test):
    tag = next((t for t in test.get("tags", []) if t in _FIRST_BY_TAG), None)
    if tag is None:
        pytest.skip("not a ranking test")
    ids = _suggested_ids(_reply(agent_returns, text_response, test))
    assert ids, "no suggestion carried an identifier"
    assert ids[0] == _FIRST_BY_TAG[tag], (
        "the hole whose `pendingHints.fitting` is nonzero must come first, ahead of nearer holes "
        f"without a fitting hint; got {ids}"
    )

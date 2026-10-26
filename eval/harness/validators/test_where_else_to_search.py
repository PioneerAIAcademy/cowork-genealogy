"""Skill-specific validators for the where-else-to-search agent.

where-else-to-search runs after a FamilySearch records search, with no project.
It resolves the place, makes one `external_links_search` call, and builds at
most 8 curated rows with `build_external_search_url`. Whether each reason is
grounded, and whether selection is sensible, is judged by the rubric; the checks
here are the ones a reader can verify from the tool calls and the reply alone.

Tag gates: `where-else` marks a positive test, `zero-results` a place with no
curated rows, `no-search-no-write` a hand-back (which test_universal already
holds to zero tool calls).

See test_universal.py module docstring for the validator function-signature
contract.
"""

from __future__ import annotations

import re

import pytest

from validators_lib import bare_tool_name

_TOOLS = {"place_search", "external_links_search", "build_external_search_url"}
_URL = re.compile(r"https?://[^\s<>()\[\]\"'`]+")
_MAX_ENTRIES = 8


def _reply(agent_returns, text_response, test):
    from harness.skill_runner import subject_reply_text

    return subject_reply_text(agent_returns, text_response, test.get("skill") or "", test)


def _split(reply: str) -> tuple[str, str]:
    """(caller lines, prose after the final `---` line)."""
    parts = re.split(r"(?m)^\s*---\s*$", reply)
    if len(parts) < 2:
        return reply, ""
    return "\n".join(parts[:-1]), parts[-1]


def _urls(text: str) -> list[str]:
    # A sentence or markdown wrapper may end on punctuation the URL does not carry.
    return [u.rstrip(".,;:!?*_") for u in _URL.findall(text or "")]


def _strings(value) -> set[str]:
    if isinstance(value, str):
        return {value}
    if isinstance(value, dict):
        return set().union(*(_strings(v) for v in value.values())) if value else set()
    if isinstance(value, list):
        return set().union(*(_strings(v) for v in value)) if value else set()
    return set()


def _built(tool_calls) -> list[str]:
    """Every url an `ok` build_external_search_url call returned."""
    out = []
    for c in tool_calls or []:
        if bare_tool_name(c.get("tool", "")) != "build_external_search_url":
            continue
        r = c.get("response")
        if isinstance(r, dict) and r.get("ok") is True and isinstance(r.get("url"), str):
            out.append(r["url"])
    return out


def _positive(test):
    if "where-else" not in test.get("tags", []):
        pytest.skip("not a where-else-to-search positive test")


def test_every_link_is_one_a_tool_returned(tool_calls, agent_returns, text_response, test):
    _positive(test)
    returned = set().union(*(_strings(c.get("response")) for c in (tool_calls or []))) if tool_calls else set()
    reply = _reply(agent_returns, text_response, test)
    stray = sorted({u for u in _urls(reply) if u not in returned})
    assert not stray, f"links no tool returned in this run (hand-written or edited): {stray}"


def test_every_suggested_link_reaches_the_user(tool_calls, agent_returns, text_response, test):
    _positive(test)
    built = set(_built(tool_calls))
    if not built:
        pytest.skip("no prefilled link was built")
    caller, prose = _split(_reply(agent_returns, text_response, test))
    in_prose = set(_urls(prose))
    assert built & in_prose, (
        "links were built but none reaches the user: production prints only what "
        "follows the final `---`"
    )
    above_only = sorted(u for u in set(_urls(caller)) & built if u not in in_prose)
    assert not above_only, f"built links above the `---` but missing from the user-facing block: {above_only}"


def test_no_tool_outside_the_three_and_no_project_path(tool_calls, test):
    tags = test.get("tags", [])
    if "where-else" not in tags and "no-search-no-write" not in tags:
        pytest.skip("not a where-else-to-search test")
    for c in tool_calls or []:
        name = bare_tool_name(c.get("tool", ""))
        assert name in _TOOLS, f"called {name}, which this agent does not hold"
        assert "projectPath" not in (c.get("args") or {}), (
            f"{name} was passed a projectPath; this agent has no project and must write nothing"
        )


def test_at_most_eight_prefilled_links(tool_calls, agent_returns, text_response, test):
    _positive(test)
    calls = [c for c in (tool_calls or []) if bare_tool_name(c.get("tool", "")) == "build_external_search_url"]
    assert len(calls) <= _MAX_ENTRIES, f"{len(calls)} links built; select at most {_MAX_ENTRIES} rows first"
    _, prose = _split(_reply(agent_returns, text_response, test))
    shown = set(_urls(prose)) & set(_built(tool_calls))
    assert len(shown) <= _MAX_ENTRIES, f"{len(shown)} prefilled links shown; at most {_MAX_ENTRIES}"


def test_zero_results_builds_and_links_nothing(tool_calls, agent_returns, text_response, test):
    if "zero-results" not in test.get("tags", []):
        pytest.skip("not a zero-results test")
    built = [c for c in (tool_calls or []) if bare_tool_name(c.get("tool", "")) == "build_external_search_url"]
    assert not built, f"no curated row was returned, yet {len(built)} link(s) were built"
    links = _urls(_reply(agent_returns, text_response, test))
    assert not links, f"no curated row was returned, yet the reply carries links: {links}"

"""Direct tests for the where-else-to-search validators.

`pyproject.toml` sets `testpaths = ["tests"]`, so nothing under `validators/` is
collected by `make harness-test`; without these, a validator's real pass/fail
set would only appear inside a paid per-skill run. Each check is shown failing
on a planted defect and passing on a legitimate variant (CLAUDE.md, "a new lint
must be proven to fail").
"""

import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

# Aliased away from the `test_` prefix so pytest does not collect the imported
# validators as tests of this module.
import test_where_else_to_search as v  # noqa: E402

check_provenance = v.test_every_link_is_one_a_tool_returned
check_reaches = v.test_every_suggested_link_reaches_the_user
check_tools = v.test_no_tool_outside_the_three_and_no_project_path
check_cap = v.test_at_most_eight_prefilled_links
check_zero = v.test_zero_results_builds_and_links_nothing

CURATED = "https://www.ancestry.com/search/collections/9040"
BUILT = "https://www.ancestry.com/search/collections/9040?name=John_Brennan&residence=1863"
OTHER = "https://www.pa-archives.example/civil-war"


def call(tool, response=None, prefix="mcp__genealogy__", **args):
    return {"tool": f"{prefix}{tool}", "args": args, "response": response}


def links_call(*urls):
    return call(
        "external_links_search",
        {"results": [{"url": u, "linkText": "x", "startYear": 1860, "endYear": 1869} for u in urls]},
        standardPlace="Schuylkill, Pennsylvania, United States",
    )


def build_call(url=BUILT, ok=True, **args):
    resp = {"ok": True, "url": url, "access": "subscription"} if ok else {"ok": False, "reason": "invalid_base_url"}
    return call("build_external_search_url", resp, site="ancestry", baseUrl=CURATED, **args)


def where_test(*tags):
    return {"skill": "where-else-to-search", "tags": ["where-else", "direct-arm", *tags]}


def reply(text):
    return [{"subagent_type": "where-else-to-search", "text": text}]


GOOD = (
    "Searched Schuylkill, Pennsylvania, United States, 1861-1865.\n"
    "1 entry, 1 also on file.\n"
    "---\n"
    f"Ancestry's Pennsylvania Civil War Muster Rolls cover 1860-1869: {BUILT}\n\n"
    f"Also on file, without a prefilled search: ({OTHER}).\n\n"
    "Open a link and bring back anything you find."
)
CALLS = [call("place_search", {"results": []}, placeName="Schuylkill"), links_call(CURATED, OTHER), build_call()]


def test_provenance_passes_on_tool_urls_and_fails_on_a_hand_written_or_edited_one():
    t = where_test()
    check_provenance(CALLS, reply(GOOD), None, t)
    # Markdown wrapping and trailing punctuation are not part of the link.
    check_provenance(CALLS, reply(GOOD.replace(f": {BUILT}", f": [Muster Rolls]({BUILT}).")), None, t)
    with pytest.raises(AssertionError):  # an edited parameter
        check_provenance(CALLS, reply(GOOD.replace("residence=1863", "residence=1864")), None, t)
    with pytest.raises(AssertionError):  # a site from memory
        check_provenance(CALLS, reply(GOOD + "\nTry https://www.irishgenealogy.ie/ too."), None, t)
    with pytest.raises(AssertionError):  # the curated url presented after a failed build
        check_provenance(CALLS[:2], reply(GOOD.replace(BUILT, "https://www.ancestry.com/search/collections/9040?x=1")), None, t)


def test_provenance_reads_responses_under_every_server_spelling():
    calls = [build_call() | {"tool": "mcp__remote-devices__Genealogy_Research__build_external_search_url"}]
    check_provenance(calls, reply(f"x\n---\n{BUILT}"), None, where_test())


def test_reaches_passes_when_links_are_below_the_separator_and_fails_otherwise():
    t = where_test()
    check_reaches(CALLS, reply(GOOD), None, t)
    with pytest.raises(AssertionError):  # only above the separator
        check_reaches(CALLS, reply(f"Built: {BUILT}\n---\nOpen the link above."), None, t)
    with pytest.raises(AssertionError):  # no separator at all
        check_reaches(CALLS, reply(f"Ancestry: {BUILT}"), None, t)
    with pytest.raises(AssertionError):  # one above, missing below
        two = build_call(url=BUILT + "&b=2")
        check_reaches(CALLS + [two], reply(f"{BUILT + '&b=2'}\n---\n{BUILT}"), None, t)
    # Repeating a link above the separator is fine when it is also below.
    check_reaches(CALLS, reply(f"{BUILT}\n---\n{BUILT}"), None, t)
    with pytest.raises(pytest.skip.Exception):  # nothing built
        check_reaches(CALLS[:2], reply("x\n---\ny"), None, t)


def test_tools_fires_on_a_writer_or_a_project_path_and_accepts_the_three():
    t = where_test()
    check_tools(CALLS, t)
    with pytest.raises(AssertionError):
        check_tools(CALLS + [call("research_log_append", {"ok": True})], t)
    with pytest.raises(AssertionError):
        check_tools([build_call(projectPath="/tmp/p")], t)
    with pytest.raises(AssertionError):
        check_tools([call("Read", {})], t)
    # A hand-back test is gated too, and holds with no call.
    check_tools([], {"skill": "where-else-to-search", "tags": ["hand-back", "no-search-no-write"]})
    with pytest.raises(pytest.skip.Exception):
        check_tools(CALLS, {"skill": "x", "tags": ["direct-arm"]})


def test_cap_fires_on_a_ninth_build_and_accepts_eight():
    t = where_test()
    eight = [build_call(url=f"{BUILT}&n={i}") for i in range(8)]
    prose = "x\n---\n" + "\n".join(f"{BUILT}&n={i}" for i in range(8))
    check_cap(eight, reply(prose), None, t)
    nine = eight + [build_call(url=f"{BUILT}&n=8")]
    with pytest.raises(AssertionError):
        check_cap(nine, reply(prose), None, t)
    # A failed build still counts as a call: selection, not repair, keeps it to eight.
    with pytest.raises(AssertionError):
        check_cap(eight + [build_call(ok=False)], reply(prose), None, t)


def test_zero_results_fires_on_any_build_or_link_and_accepts_a_plain_answer():
    t = where_test("zero-results")
    plain = "Searched Ireland.\n---\nFamilySearch lists no external collection for Ireland in those years."
    check_zero([links_call()], reply(plain), None, t)
    with pytest.raises(AssertionError):
        check_zero([links_call(), build_call()], reply(plain), None, t)
    with pytest.raises(AssertionError):
        check_zero([links_call()], reply(plain + " Try https://www.findmypast.ie/."), None, t)
    with pytest.raises(pytest.skip.Exception):
        check_zero([], reply(plain), None, where_test())

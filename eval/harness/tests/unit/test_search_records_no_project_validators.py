"""Direct tests for the no-project page-images validators (issue #4583).

`validators/` is not collected by `make harness-test`, so each validator runs
here over replies it must accept and replies it must reject.
"""

import json
import sys
from pathlib import Path

import pytest

_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

from test_search_records import (  # noqa: E402
    test_gives_record_image_links as links_check,
    test_no_project_writes_nothing as writes_check,
)

ARK = "https://www.familysearch.org/ark:/61903"
PAGE_N1 = f"{ARK}/3:1:9396-MWWN-1"
PAGE_BQ = f"{ARK}/3:1:9396-MWWB-Q"
READS = [
    ("KHJ8-J56", PAGE_N1, f"{ARK}/1:2:9MFD-5SJP", "William Brisbin"),
    ("KHJ8-J5Z", PAGE_N1, f"{ARK}/1:2:9MFD-5SJ2", "Joseph Brisbin"),
    ("KHJ8-JTQ", PAGE_BQ, f"{ARK}/1:2:9MFD-5SKX", "Elisha Calkins"),
]

LINKS = {"tags": ["no-project", "page-images", "gives-record-image-links"]}
WRITES = {"tags": ["no-project", "page-images", "no-project-writes-nothing"]}
UNTAGGED = {"tags": ["no-project"]}


def call(tool, response=None, **args):
    return {"tool": f"mcp__genealogy__{tool}", "args": args, "response": response}


def read_call(record_id, page, record):
    return call(
        "record_read",
        response={"persons": [], "imageArk": page.split("/61903/")[1], "viewerUrl": page, "recordUrl": record},
        recordId=f"ark:/61903/1:1:{record_id}",
    )


CALLS = [read_call(rid, page, rec) for rid, page, rec, _ in READS]


def printed_block(skip_record=None, skip_page=None):
    lines = []
    for page in (PAGE_N1, PAGE_BQ):
        if page == skip_page:
            continue
        on_page = [
            f"[{name}]({rec})" for _, p, rec, name in READS if p == page and rec != skip_record
        ]
        lines.append(f"[1825 census page]({page}): {', '.join(on_page)}")
    return "\n".join(lines)


def returned(above, below):
    return [{"subagent_type": "search-records", "text": f"{above}\n\n---\n\n{below}"}]


def check_links(calls, agent_returns, test=LINKS):
    return links_check(calls, agent_returns, "", test)


# --- gives-record-image-links ----------------------------------------------

def test_links_skip_an_untagged_test():
    with pytest.raises(pytest.skip.Exception):
        check_links(CALLS, returned("Read 3 records.", ""), UNTAGGED)


def test_links_accept_every_page_and_record_after_the_rule():
    assert check_links(CALLS, returned("Read 3 records; nothing saved.", printed_block())) is None


def test_links_accept_a_stringified_response_and_bare_urls():
    calls = [dict(c, response=json.dumps(c["response"])) for c in CALLS]
    below = "\n".join(f"{page} {rec}" for _, page, rec, _ in READS)
    assert check_links(calls, returned("Read 3 records.", below)) is None


def test_links_reject_a_missing_page_link():
    with pytest.raises(AssertionError, match="MWWB-Q"):
        check_links(CALLS, returned("Read 3 records.", printed_block(skip_page=PAGE_BQ)))


def test_links_reject_a_missing_record_link():
    with pytest.raises(AssertionError, match="9MFD-5SJ2"):
        check_links(CALLS, returned("Read 3 records.", printed_block(skip_record=f"{ARK}/1:2:9MFD-5SJ2")))


def test_links_reject_links_only_above_the_rule():
    with pytest.raises(AssertionError, match="not after the return's final"):
        check_links(CALLS, returned(printed_block(), "The census pages are linked above."))


def test_links_reject_a_return_with_no_rule():
    text = f"Read 3 records.\n\n{printed_block()}"
    with pytest.raises(AssertionError, match="not after the return's final"):
        check_links(CALLS, [{"subagent_type": "search-records", "text": text}])


def test_links_read_only_the_agents_own_return():
    with pytest.raises(AssertionError, match="not after the return's final"):
        links_check(CALLS, returned("Read 3 records.", "No links."), f"---\n{printed_block()}", LINKS)


def test_links_reject_a_run_with_no_record_read_answered():
    failed = [call("record_read", response={"error": "fixture_not_found"}, recordId="KHJ8-J56")]
    searched = [call("record_search", response={"results": []}, surname="Brisbin")]
    for calls in (failed, searched, []):
        with pytest.raises(AssertionError, match="no record_read was answered"):
            check_links(calls, returned("Searched.", printed_block()))


def test_links_reject_answers_with_no_link_fields():
    calls = [call("record_read", response={"persons": []}, recordId="KHJ8-J56")]
    with pytest.raises(AssertionError, match="carried no viewerUrl or recordUrl"):
        check_links(calls, returned("Read 1 record.", printed_block()))


# --- no-project-writes-nothing ---------------------------------------------

def test_writes_skip_an_untagged_test():
    with pytest.raises(pytest.skip.Exception):
        writes_check([call("research_log_append", projectPath="/p")], UNTAGGED)


def test_writes_accept_reads_and_searches_with_no_project_path():
    calls = CALLS + [call("record_search", response={"results": []}, surname="Brisbin")]
    assert writes_check(calls, WRITES) is None
    assert writes_check([], WRITES) is None


def test_writes_reject_a_call_with_a_project_path():
    with pytest.raises(AssertionError, match="passed a projectPath"):
        writes_check(CALLS + [call("record_search", surname="Brisbin", projectPath="/p")], WRITES)


def test_writes_reject_a_stringified_args_with_a_project_path():
    stringified = {"tool": "mcp__genealogy__project_context", "args": json.dumps({"projectPath": "/p"})}
    with pytest.raises(AssertionError, match="project_context"):
        writes_check([stringified], WRITES)


def test_writes_reject_a_writer_with_no_project_path():
    for tool in ("research_log_append", "research_append", "extraction_append"):
        with pytest.raises(AssertionError, match=tool):
            writes_check(CALLS + [call(tool, notes="read three records")], WRITES)


def test_writes_read_any_server_spelling():
    bridged = {"tool": "mcp__remote-devices__Genealogy_Research__research_log_append", "args": {}}
    with pytest.raises(AssertionError, match="research_log_append"):
        writes_check([bridged], WRITES)

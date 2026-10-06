"""Suite-specific validators for the search-hints agent (issue #2029).

search-hints reviews the FamilySearch hints on one tree person. Triage asks
`person_record_matches` for the PENDING matches only, reads each hint, reads the
record image before recommending against a hint, and writes nothing. Record mode
logs one `research_log_append` entry per verdict the researcher stated.

These are the mechanical checks; whether a recommendation is genealogically
sound lives in the rubric. Each check reads a deterministic artifact — the call
log, the after-state's `log[]`, or the agent's machine-readable `Hint <ark>:
<verdict>` lines — never the judge's reading of the prose.

See test_universal.py module docstring for the validator function-signature
contract. Checks other than the pending-only one are tag-gated.
"""

from __future__ import annotations

import json
import re

import pytest

from validators_lib import new_log_entries as _new_log_entries

_AGENT = "search-hints"
# Markdown the model adds around the ark or the verdict (`code`, **bold**,
# _emphasis_) is tolerated: the line's meaning is the ark and the verdict word.
_HINT_LINE = re.compile(
    r"Hint\s+`?([^\s`]+?)`?\s*:\s*[*_`]*\s*"
    r"(accept|reject|not enough information to judge|already in the project)(?![A-Za-z])",
    re.IGNORECASE,
)
# The 1880 census page's image (fixture image-transcribe-flynn-1880-census-m80c).
_M80C_IMAGE = "3Q9M-CS80-L7Q2"


def _calls(tool_calls, name: str) -> list[dict]:
    return [c for c in (tool_calls or []) if str(c.get("tool", "")).endswith(f"__{name}")]


def _status_of(args: dict) -> object:
    status = (args or {}).get("status")
    if isinstance(status, str):
        try:
            return json.loads(status)
        except ValueError:
            return status
    return status


def _reply(agent_returns, text_response, test) -> str:
    from harness.skill_runner import subject_reply_text

    return subject_reply_text(agent_returns, text_response, _AGENT, test)


def _verdicts(reply: str) -> dict[str, str]:
    """`Hint <ark>: <verdict>` lines, keyed on the ark as written."""
    return {m.group(1): m.group(2).lower() for m in _HINT_LINE.finditer(reply or "")}


def _verdict_for(reply: str, pid: str) -> str | None:
    hits = [v for ark, v in _verdicts(reply).items() if pid.upper() in ark.upper()]
    return hits[0] if hits else None


# --- The hints list is the pending matches -----------------------------

def test_hint_list_asks_for_pending_only(tool_calls, test):
    """Every `person_record_matches` call sends `status: ["pending"]`.

    The tool's default returns accepted, pending and rejected matches; only the
    pending ones are hints. Read off the call log, not the output: the pending
    fixture is listed first, but a static mock can be made to pass either way.
    A triage test must make the call at all.
    """
    calls = _calls(tool_calls, "person_record_matches")
    if "triage" in test.get("tags", []):
        assert calls, "triage made no person_record_matches call, so it reviewed no hints"
    wrong = [c.get("args") for c in calls if _status_of(c.get("args") or {}) != ["pending"]]
    assert not wrong, (
        "a hints list must ask for pending matches only (status: [\"pending\"]); got "
        f"{len(wrong)} call(s) with {[ (a or {}).get('status') for a in wrong ]}"
    )


# --- Triage -------------------------------------------------------------

def test_triage_writes_nothing(before_state, after_state, tool_calls, test):
    """Triage recommends; the researcher decides. No log entry, no write."""
    if "writes-nothing" not in test.get("tags", []):
        pytest.skip("not a triage test")
    writes = _calls(tool_calls, "research_log_append") + _calls(tool_calls, "research_append")
    assert not writes, f"triage wrote to the project ({len(writes)} call(s)); it must write nothing"
    if before_state.get("research_json") is not None:
        assert not _new_log_entries(before_state, after_state), "triage added a log entry"


def test_image_read_before_reject(tool_calls, agent_returns, text_response, test):
    """An index-vs-tree disagreement sends the agent to the image, and the
    image decides: the 1880 census image reads Flynn where the index has Glynn,
    so that hint may not be recommended for rejection.

    Both halves, because #2185 was reasoning past the evidence, not only never
    reading it: an agent that transcribes the image and rejects anyway fails.
    """
    if "image-before-reject" not in test.get("tags", []):
        pytest.skip("not an image-before-reject test")
    read = [
        c for c in _calls(tool_calls, "image_transcribe")
        if _M80C_IMAGE in str((c.get("args") or {}).get("ark", ""))
    ]
    assert read, (
        f"the 1880 census hint's index disagrees with the tree and its record carries "
        f"an imageArk ({_M80C_IMAGE}), but image_transcribe was never called on it"
    )
    verdict = _verdict_for(_reply(agent_returns, text_response, test), "M80C")
    assert verdict is not None, "the return carries no `Hint <ark>: <verdict>` line for the M80C hint"
    assert verdict != "reject", (
        "the M80C hint was recommended for rejection although its image reads Flynn, "
        "agreeing with the tree"
    )


def test_hint_already_in_the_project_is_named(agent_returns, text_response, test):
    """FamilySearch keeps a hint pending until someone attaches it there, and
    nothing here writes back, so a record the project already extracted still
    shows as a hint. Triage reports it as already in the project; recommending
    it as a fresh accept sends it to a second extraction."""
    if "already-in-project" not in test.get("tags", []):
        pytest.skip("not an already-in-project test")
    verdict = _verdict_for(_reply(agent_returns, text_response, test), "MDEF")
    assert verdict == "already in the project", (
        f"the MDEF death certificate is already extracted as src_004; expected its line to read "
        f"'already in the project', got {verdict!r}"
    )


def test_extracted_unlinked_hint_is_triaged(tool_calls, agent_returns, text_response, test):
    """Extracted is not linked: a record whose assertions no live
    `person_evidence` entry cites was never decided to be this person, so its
    hint is read and given a recommendation like any other. Reporting it as
    already in the project skips exactly the identity question hint review
    exists to ask."""
    if "extracted-not-linked" not in test.get("tags", []):
        pytest.skip("not an extracted-not-linked test")
    verdict = _verdict_for(_reply(agent_returns, text_response, test), "MDEF")
    assert verdict in ("accept", "reject", "not enough information to judge"), (
        "the MDEF death certificate is extracted as src_004 but no person_evidence entry links "
        f"it; expected a recommendation on its line, got {verdict!r}"
    )
    reads = [c for c in _calls(tool_calls, "record_read") if "MDEF" in str((c.get("args") or {}).get("recordId", ""))]
    assert reads, "the MDEF hint got a recommendation without its record ever being read"


def test_thin_hint_is_not_enough_information(agent_returns, text_response, test):
    """A hint that neither confirms nor contradicts the tree person gets
    `not enough information to judge`, never a forced accept or reject."""
    if "not-enough-information" not in test.get("tags", []):
        pytest.skip("not a thin-evidence test")
    verdict = _verdict_for(_reply(agent_returns, text_response, test), "MTHN")
    assert verdict == "not enough information to judge", (
        f"the MTHN naturalization hint carries no county, age, birthplace or image; "
        f"expected 'not enough information to judge', got {verdict!r}"
    )


# --- Record mode --------------------------------------------------------

def test_record_mode_logs_each_verdict(before_state, after_state, agent_returns, text_response, test):
    """One log entry per stated verdict: tool person_record_matches, no plan
    item, outcome following the verdict. The accepted hint's log id comes back
    with its ark, so record-extraction reuses the entry instead of writing a
    second one."""
    if "record-mode" not in test.get("tags", []):
        pytest.skip("not a record-mode test")
    entries = _new_log_entries(before_state, after_state)
    assert len(entries) == 2, f"expected 2 new log entries (one per verdict), got {len(entries)}"

    def _for(pid: str) -> dict | None:
        # The query's recordId names the hint; notes are only a fallback, since a
        # reject note may well mention the accepted hint too.
        by_query = [e for e in entries if pid in str((e.get("query") or {}).get("recordId", ""))]
        if by_query:
            return by_query[0] if len(by_query) == 1 else None
        hits = [e for e in entries if pid in json.dumps(e.get("query")) or pid in str(e.get("notes", ""))]
        return hits[0] if len(hits) == 1 else None

    expected = {"M70C": "positive", "M80C": "negative"}
    for pid, outcome in expected.items():
        entry = _for(pid)
        assert entry is not None, f"no single log entry names hint {pid}"
        assert entry.get("tool") == "person_record_matches", (
            f"{pid}: tool is {entry.get('tool')!r}, not 'person_record_matches'"
        )
        assert entry.get("plan_item_id") is None, f"{pid}: plan_item_id should be null for a hint review"
        assert entry.get("outcome") == outcome, (
            f"{pid}: outcome {entry.get('outcome')!r} does not follow the researcher's verdict ({outcome})"
        )
    if "already-in-project-accept" in test.get("tags", []):
        assert _for("MDEF") is None, (
            "an accepted hint already in the project (MDEF, src_004) was logged; its source "
            "already carries the evidence, and a positive entry with no new assertion sends "
            "/research back to record-extraction for a record the project holds"
        )
    accepted_id = _for("M70C")["id"]
    reply = _reply(agent_returns, text_response, test)
    assert accepted_id in reply, (
        f"the return does not give the accepted hint's log id ({accepted_id}), so "
        "record-extraction cannot reuse that entry"
    )

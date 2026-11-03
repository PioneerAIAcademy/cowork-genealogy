"""Skill-specific validators for the search-images skill.

search-images browses FamilySearch digitized image volumes page-by-page
(volume_search → image_search → image_transcribe, one call per page) when a
record set is digitized but not indexed and not full-text searchable, and logs
every browse via research_log_append. The agent reads pages itself with
image_transcribe — agents cannot reach another agent. image_search does not stage
results, so no results/ sidecar is written — the log entry stands alone.

Narrative-quality dimensions (volume selection, browse procedure,
negative-result detail) live in the rubric and are graded by the LLM judge.
The mechanical "did the skill record a log entry of the right shape" checks
live here.

See test_universal.py module docstring for the validator function-signature
contract. The `test` argument is the parsed test JSON dict (the inner "test"
block) — used to gate test-specific checks on `test["tags"]`.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from validators_lib import new_log_entries as _new_log_entries


def _new_result_sidecars(before_state, after_state) -> list[str]:
    """Finalized results/*.json paths present in after_state but not before.

    `results/.staging/` is excluded: every image_transcribe call stages its page
    there (#2490), so a staged page is the expected product of a read, not a
    sidecar the browse wrote."""
    before_files = (before_state or {}).get("files", {}) or {}
    after_files = (after_state or {}).get("files", {}) or {}
    return sorted(
        path for path in after_files
        if path.startswith("results/")
        and not path.startswith("results/.staging/")
        and path.endswith(".json")
        and path not in before_files
    )


# --- Structural rules from SKILL.md -----------------------------------

def test_positive_appends_browse_log_entry(before_state, after_state, test):
    """Positive search-images tests must append a log entry recording the
    browse. The skill's whole audit-trail role depends on this. The log's
    `tool` field should reference image_search (the browse) or volume_search
    (the volume discovery, e.g. when no volume was found) so a future
    exhaustive-search declaration can cite the browse."""
    if test.get("type") != "positive":
        pytest.skip("only positive tests record browses")
    if "redirect-no-browse" in test.get("tags", []):
        pytest.skip(
            "redirect-no-browse: the volume is indexed, so the skill correctly "
            "performs no browse and writes no log entry"
        )
    if before_state.get("research_json") is None:
        pytest.skip("no research.json in scenario")
    new_entries = _new_log_entries(before_state, after_state)
    assert new_entries, "expected at least one new log entry recording the browse"
    tools = [e.get("tool") for e in new_entries]
    # A cap refusal stops the browse at a page read, so its partial log may
    # name image_transcribe.
    browse_tools = ("image_search", "volume_search") + (
        ("image_transcribe",) if "cap-refusal" in test.get("tags", []) else ()
    )
    assert any(any(b in (t or "") for b in browse_tools) for t in tools), (
        "expected a new log entry whose `tool` references image_search or "
        f"volume_search; got tools={tools}"
    )


# --- Tag-gated negative-result log shape -----------------------------

def test_negative_result_log_shape(before_state, after_state, test):
    """Tag-gated: when the test scenario probes nil-browse handling (no
    volume, empty image group, or target not found), the new log entry must
    have `outcome: "negative"` and a non-empty `query` object describing what
    was browsed. The narrative `notes` field — the volume, place, date, and
    image range examined — is judge-graded under the Browse-audit-trail rubric
    dim and not asserted here."""
    if "negative-result-log" not in test.get("tags", []):
        pytest.skip("not a negative-result-log scenario")
    new_entries = _new_log_entries(before_state, after_state)
    assert new_entries, "expected at least one new log entry"

    errors: list[str] = []
    matched = False
    for entry in new_entries:
        if entry.get("outcome") != "negative":
            continue
        matched = True
        query = entry.get("query")
        if not isinstance(query, dict) or not query:
            errors.append(
                f"log[{entry.get('id')}].query must be a non-empty object "
                f"describing the browse; got {query!r}"
            )
    assert matched, (
        f"no new log entry has outcome='negative'; "
        f"outcomes={[e.get('outcome') for e in new_entries]}"
    )
    assert not errors, "Negative-log-shape violations:\n  - " + "\n  - ".join(errors)


# --- No sidecar for an image browse ----------------------------------

def test_no_results_sidecar_written(before_state, after_state, test):
    """image_search does not stage results, so logging a browse never writes a
    results/<log_id>.json sidecar (unlike record/full-text search). A new
    sidecar would mean the skill mis-modeled the browse on the staging
    search tools. Pages image_transcribe stages are not sidecars."""
    if test.get("type") != "positive":
        pytest.skip("only positive tests perform a browse")
    new_sidecars = _new_result_sidecars(before_state, after_state)
    assert not new_sidecars, (
        "image_search does not stage results, so no results/ sidecar should "
        f"be written for a browse; got {new_sidecars}"
    )


# --- The hard image cap's refusal is relayed, not worked around -------------

CAP_FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "fixtures" / "mcp" / "image-transcribe-cap-reached.json"
)


def test_cap_refusal_relayed_and_logged_partial(
    tool_calls, text_response, test, before_state, after_state, agent_returns=None
):
    """Tag-gated: on the cap refusal (#3010) the agent makes one
    `image_transcribe` call, logs the browse `partial`, and returns NOT READ,
    the refusal, its link and its route advice, inventing no page.

    The expected text is read from the fixture, which
    `packages/engine/mcp-server/tests/packaging/image-cap-fixture.test.ts` pins
    to the refusal `browse-budget.ts` throws. Moved from the retired
    image-reader suite (#2490)."""
    from harness.skill_runner import subject_reply_text

    if "cap-refusal" not in test.get("tags", []):
        pytest.skip("not an image-cap refusal test")
    fixture = json.loads(CAP_FIXTURE.read_text(encoding="utf-8"))
    image_id = fixture["args"]["imageId"]
    error = fixture["response"]["error"]
    link = re.search(r"https://\S+?(?=\))", error).group(0)

    calls = [c for c in (tool_calls or []) if c.get("tool", "").endswith("image_transcribe")]
    assert len(calls) == 1, f"expected exactly one image_transcribe call, got {len(calls)}"

    new_entries = _new_log_entries(before_state, after_state)
    assert any(e.get("outcome") == "partial" for e in new_entries), (
        "the refusal says to log the browse as partial; outcomes logged: "
        f"{[e.get('outcome') for e in new_entries]}"
    )

    reply = subject_reply_text(agent_returns, text_response, test.get("skill") or "", test)
    assert any("NOT READ" in line and image_id in line for line in reply.splitlines()), (
        "the return lacks a line naming the refused image as NOT READ"
    )
    assert "Image cap reached" in reply, "the return does not quote the cap refusal"
    assert link in reply, f"the return drops the refused image's link {link}"
    for label in ("**Transcription:**", "**Extracted facts:**"):
        assert label not in reply, f"the return presents a {label} section for an image that was never read"


# --- Navigation: volume_bisect, the item route, and lookingFor (#3549) -------

def _calls_named(tool_calls, name: str) -> list[tuple[int, dict]]:
    return [(i, c) for i, c in enumerate(tool_calls or []) if (c.get("tool") or "").endswith(name)]


def test_bisect_before_transcribe(tool_calls, test):
    """Tag-gated: one year in a split group is found with volume_bisect, not by
    probing pages. The first volume_bisect call precedes every image_transcribe,
    and no page before the bracket's lowPosition is read (positions index the
    group's image_search list from 0)."""
    if "bisect-navigation" not in test.get("tags", []):
        pytest.skip("not a bisect-navigation test")
    bisects = _calls_named(tool_calls, "volume_bisect")
    reads = _calls_named(tool_calls, "image_transcribe")
    assert bisects, "expected a volume_bisect call before reading pages"
    assert reads, "expected at least one image_transcribe of the bracketed range"
    assert bisects[0][0] < reads[0][0], (
        f"image_transcribe of {reads[0][1].get('args', {}).get('imageId')} came before the first volume_bisect"
    )
    group = (bisects[0][1].get("args") or {}).get("imageGroupNumber")
    listing: list[str] = []
    for _, c in _calls_named(tool_calls, "image_search"):
        if (c.get("args") or {}).get("imageGroupNumber") == group:
            listing = list((c.get("response") or {}).get("imageIds") or [])
    assert listing, f"expected an image_search listing of {group}, which the bracket positions index"
    bracket = next(
        (c.get("response") or {}).get("bracket")
        for _, c in reversed(bisects)
        if isinstance((c.get("response") or {}).get("bracket"), dict)
    )
    low = bracket["lowPosition"]
    outside = []
    for _, c in reads:
        image_id = (c.get("args") or {}).get("imageId")
        if image_id not in listing or listing.index(image_id) < low:
            outside.append(image_id)
    assert not outside, f"read pages before the bracket (lowPosition {low}) or outside {group}: {outside}"


def test_item_route_before_transcribe(tool_calls, test):
    """Tag-gated: a citation with an item number goes to image_search with
    `item` before any page is read, never a page-through of the film."""
    if "item-route" not in test.get("tags", []):
        pytest.skip("not an item-route test")
    item_calls = [i for i, c in _calls_named(tool_calls, "image_search") if (c.get("args") or {}).get("item") is not None]
    reads = _calls_named(tool_calls, "image_transcribe")
    assert item_calls, "expected an image_search call with `item` for the cited item"
    assert not reads or item_calls[0] < reads[0][0], (
        f"image_transcribe of {reads[0][1].get('args', {}).get('imageId')} came before the item route"
    )


#: Phrases that only describe where to look, never who or what a record is about.
#: Built from the lookingFor strings of hosted session 54c4edd6 (2026-10-14),
#: where every FOUND they produced was the wrong page.
_NAVIGATION_PHRASE = re.compile(
    r"title page|volume title|title/index|table of contents|year boundary|entry structure|entry number|name index"
    r"|end[- ]of[- ]year|\bsection\b|\b(?:start|beginning) of\b|\b1[5-9]\d\d start\b"
    r"|\bfirst (?:birth |death |marriage |baptism |burial )?entr(?:y|ies)\b",
    re.IGNORECASE,
)


def test_lookingfor_has_no_navigation_phrase(tool_calls, test):
    """Tag-gated: lookingFor names who or what the record is about. A
    navigation phrase in it lets any of its tokens match and report FOUND on
    the wrong page."""
    if "lookingfor-no-navigation" not in test.get("tags", []):
        pytest.skip("not a lookingFor test")
    bad = [
        looking_for
        for _, c in _calls_named(tool_calls, "image_transcribe")
        if isinstance(looking_for := (c.get("args") or {}).get("lookingFor"), str)
        and _NAVIGATION_PHRASE.search(looking_for)
    ]
    assert not bad, f"lookingFor carries a navigation phrase: {bad}"


# --- A browse log entry is never relabelled image_transcribe (#4012) ---------

def test_browse_log_never_labelled_image_transcribe(before_state, after_state, test):
    """A browse's log entry names the browse tool (image_search, or
    volume_search when no volume was found) — never image_transcribe. On Haiku
    low, research_log_append refused to attach a page's staged file to an
    image_search entry, and the agent relabelled the entry
    `tool: "image_transcribe"` so the file was accepted — writing the results/
    sidecar the browse rules forbid and leaving the browse itself unlogged
    (#4012). In the split shape (a correct image_search entry PLUS a relabelled
    one) test_positive_appends_browse_log_entry still passes and, when no
    staged ref was attached, test_no_results_sidecar_written does too — this
    check is what fails it. The one legitimate image_transcribe label is a cap
    refusal's partial log, whose tests carry the cap-refusal tag."""
    if test.get("type") != "positive":
        pytest.skip("only positive tests perform a browse")
    if "cap-refusal" in test.get("tags", []):
        pytest.skip(
            "a cap refusal stops the browse at a page read, so its partial log "
            "may name image_transcribe"
        )
    relabelled = [
        entry.get("id")
        for entry in _new_log_entries(before_state, after_state)
        if "image_transcribe" in (entry.get("tool") or "")
    ]
    assert not relabelled, (
        "a browse log entry must name the browse tool (image_search or "
        f"volume_search), never image_transcribe; got entries {relabelled}. "
        "Relabelling the entry to attach a staged page file writes a results/ "
        "sidecar and leaves the browse unlogged."
    )

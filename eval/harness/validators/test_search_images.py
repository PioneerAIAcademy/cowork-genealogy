"""Skill-specific validators for the search-images skill.

search-images browses FamilySearch digitized image volumes page-by-page
(volume_search → image_search → delegate each page to the image-reader
subagent) when a record set is digitized but not indexed and not full-text
searchable, and logs every browse via research_log_append. image_search does not stage results, so no results/
sidecar is written — the log entry stands alone.

Narrative-quality dimensions (volume selection, browse procedure,
negative-result detail) live in the rubric and are graded by the LLM judge.
The mechanical "did the skill record a log entry of the right shape" checks
live here.

See test_universal.py module docstring for the validator function-signature
contract. The `test` argument is the parsed test JSON dict (the inner "test"
block) — used to gate test-specific checks on `test["tags"]`.
"""

from __future__ import annotations

import pytest


# --- Helpers ----------------------------------------------------------

def _new_log_entries(before_state, after_state) -> list[dict]:
    before = before_state.get("research_json") or {}
    after = after_state.get("research_json") or {}
    before_ids = {e.get("id") for e in before.get("log", []) if isinstance(e, dict)}
    return [
        e for e in after.get("log", [])
        if isinstance(e, dict) and e.get("id") not in before_ids
    ]


def _new_result_sidecars(before_state, after_state) -> list[str]:
    """results/*.json paths present in after_state but not before."""
    before_files = (before_state or {}).get("files", {}) or {}
    after_files = (after_state or {}).get("files", {}) or {}
    return sorted(
        path for path in after_files
        if path.startswith("results/")
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
    assert any(
        ("image_search" in (t or "")) or ("volume_search" in (t or ""))
        for t in tools
    ), (
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
    """image_search does not stage results, so a browse never writes a
    results/<log_id>.json sidecar (unlike record/full-text search). A new
    sidecar would mean the skill mis-modeled the browse on the staging
    search tools."""
    if test.get("type") != "positive":
        pytest.skip("only positive tests perform a browse")
    new_sidecars = _new_result_sidecars(before_state, after_state)
    assert not new_sidecars, (
        "image_search does not stage results, so no results/ sidecar should "
        f"be written for a browse; got {new_sidecars}"
    )


# --- No-harm invariant for planning/strategy requests ----------------

def test_no_browse_or_writes_on_planning_request(
    before_state, after_state, tool_calls, test
):
    """Tag-gated (no-browse-no-write): the search-images no-harm invariant
    for a planning/strategy request that should route to research-plan.

    search-images executes a browse and logs it; a pure planning question
    ("which unindexed record sets should I browse next?") must not cause a
    browse to be EXECUTED or anything to be persisted. This is the
    deterministic gate for the grade_on_invariant negative
    ut_search_images_009: which skill wins the route is a known-unstable
    model prior (the router picks research-plan directly on some runs,
    search-images — which then correctly redirects per SKILL.md's ROUTING
    section — on others, project-status on others), but the state-harm
    invariant holds under every one of those routes and is what we assert.
    See docs/specs/unit-test-spec.md.

    Fails iff the run:
      - made a `volume_search` or `image_search` MCP call (a browse was
        executed), or
      - appended a new `log` entry (search-images logs every browse it
        runs; research-plan — the acceptable route — never writes `log`,
        so any new log entry means a search/browse skill actually ran), or
      - wrote a new `results/` sidecar file.

    Deliberately does NOT flag other research.json writes: routing to
    research-plan legitimately writes `plans`/`questions`, which is
    correct behavior, not harm.
    """
    if "no-browse-no-write" not in test.get("tags", []):
        pytest.skip("not a no-browse-no-write scenario")

    # 1. No browse executed.
    browsed = [
        c for c in (tool_calls or [])
        if c.get("tool", "").split("__")[-1] in ("volume_search", "image_search")
    ]
    assert not browsed, (
        "planning request must not execute a browse; got "
        f"{[(c.get('tool', '').split('__')[-1], c.get('args')) for c in browsed]}"
    )

    # 2. No new browse log entry (research-plan never writes `log`).
    new_entries = _new_log_entries(before_state, after_state)
    assert not new_entries, (
        "planning request must not append a browse log entry; new log "
        f"ids: {[e.get('id') for e in new_entries]}"
    )

    # 3. No new results/ sidecar file.
    sidecars = _new_result_sidecars(before_state, after_state)
    assert not sidecars, (
        f"planning request must not write a results/ sidecar; got: {sidecars}"
    )

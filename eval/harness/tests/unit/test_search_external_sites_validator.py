"""Unit tests for the six #1950 Half-1 validators on `search-external-sites`.

**Why these exist at all.** Nothing in CI ever runs a validator against a real
run — validators execute only inside a paid `make eval-skill`, which this card
must not buy (#1933 owns the next one). So a validator that silently always
skips — wrong field name, a gate that never matches, `None` where a value was
expected — is green forever and reads as coverage. Each one below is therefore
asserted in **both** directions: it fires on the bad shape, and it stays quiet
on the good one.

**The field-name trap this suite pins.** Issue #1950 states every rule in the
MCP tool's camelCase parameter spelling, because that is what a
`research_log_append` call carries. The validators read `after_state`, which is
the persisted snake_case document. The mapping (from
`docs/specs/schemas/research.schema.json`) is:

    stagedResultsRef -> results_ref      NOT staged_results_ref
    resultsExamined  -> results_examined
    planItemId       -> plan_item_id

`results_ref` is the one that bites. Transcribing the issue's name verbatim
gives a V2 that never fires on anything, and no other test in the repo would
notice.

**Shapes are reduced inline.** An earlier draft justified that by saying a
path-reading test "ages out" under the newest-five retention. That reasoning is
wrong: `test_conflict_resolution_validator.py:61` globs `v1_*.json` and has
survived rotation fine, because a glob picks up whichever logs are present.
The real reason is thinner — six of the seven have no corpus instance to reduce
*from*, so a replay would assert only that they stay quiet.

Measured 2026-09-10 across the 80 runs in the five logs this branch commits,
reading `file_changes["research.json"].diff.log.added`:

- V3's bad shape (`results_examined > 0` logged non-positive) is the only one
  the corpus currently reproduces — **4 of 66 `external_links_search` entries,
  three tests (`_002`, `_005`, `_006`), three of the five logs.** #1950's own
  census said 9 of 48; the corpus turned over, so that is stale, not invented.
- **The other six fire on zero of those 80 runs.** V2, V4 and V6 guard rules
  the skill states that nothing enforced. V7 previously cited two run logs at
  "roughly two runs in five" — both have since been pruned by the newest-five
  retention described above, so the claim is no longer checkable and is not
  repeated. V7b and V8 have never had a committed instance.

Their bad shapes are therefore constructed from the rule, not reduced from a
run. That is the honest position: nothing in CI executes these against a real
run, so a reader learns their true firing rate only here.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import json

import pytest

_HARNESS = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_HARNESS))
sys.path.insert(0, str(_HARNESS / "validators"))  # validators_lib, the module

from test_search_external_sites import (  # noqa: E402
    test_no_plan_item_status_written_when_no_entry_names_one as check_v6,
    test_log_entries_do_not_carry_each_others_fields as check_v2,
    test_plan_items_are_updated_never_appended as check_v7,
    test_the_log_is_append_only as check_v8,
    test_the_url_logged_is_the_url_presented as check_v4,
    test_triage_closes_its_open_handoff as check_triage,
    test_archion_browse_handoff as check_archion,
    test_base_url_is_the_plan_items_collection_url as check_collection_url,
    report_collection_scoped_url_with_no_backed_collection_id as check_2521,
    test_writes_only_to_log_and_plans as check_v7b,
    test_fs_holdings_note_reaches_the_researcher as check_fs_holdings,
    test_plan_item_links_match_the_searched_repository as check_repo_link,
    test_positive_appends_external_site_log_entry as check_positive_log,
    test_capture_steps_name_the_upload_page_only_when_served as check_upload_wording,
    test_no_transcription_of_an_upload_with_text as check_no_text_transcribe,
    test_closing_capture_filename_is_the_upload as check_capture_filename,
    test_hosted_upload_is_read_with_the_tools as check_upload_read,
    test_refused_transcription_leaves_the_handoff_open as check_refused_open,
    test_folder_mode_upload_is_read_with_read as check_folder_read,
    test_blm_outside_coverage_refusal_is_the_answer as check_blm_refusal,
    test_browse_site_catalog_cross_check as check_browse_catalog,
)

from tests.unit.skip_blind import expect_fires, expect_passes  # noqa: E402

POSITIVE = {"type": "positive", "tags": []}
URL = "https://www.ancestry.com/search/?name=Patrick_Flynn&birth=1845"


def _plan(items):
    return [{"id": "pl_001", "question_id": "q_001", "items": items}]


def _item(item_id="pli_001", status="planned"):
    return {
        "id": item_id,
        "sequence": 1,
        "record_type": "census",
        "jurisdiction": "Schuylkill County, Pennsylvania",
        "date_range": "1850",
        "repository": "Ancestry",
        "rationale": "The 1850 census places Patrick in a household.",
        "fallback_for": None,
        "status": status,
    }


def _states(*, before_log=None, after_log=None, before_items=None, after_items=None):
    """A before/after pair. Only the sections these validators read are built."""
    before_items = before_items if before_items is not None else [_item()]
    after_items = after_items if after_items is not None else list(before_items)
    return (
        {"research_json": {"log": list(before_log or []), "plans": _plan(before_items)}},
        {"research_json": {"log": list(after_log or []), "plans": _plan(after_items)}},
    )


def _links_entry(entry_id="log_010", **over):
    entry = {
        "id": entry_id,
        "tool": "external_links_search",
        "outcome": "positive",
        "query": "Schuylkill County, Pennsylvania",
        "results_examined": 2,
        "results_ref": "results/log_010.json",
        "plan_item_id": None,
        "external_site": None,
    }
    entry.update(over)
    return entry


def _site_entry(entry_id="log_011", **over):
    entry = {
        "id": entry_id,
        "tool": "external_site",
        "outcome": "partial",
        "query": "Patrick Flynn 1845",
        "results_examined": 0,
        "results_ref": None,
        "plan_item_id": None,
        "external_site": {
            "site": "ancestry",
            "url_generated": URL,
            "capture_received": False,
        },
    }
    entry.update(over)
    return entry


# --- V2: an external_site entry carries no staged handle ---------------


def test_v2_fires_when_a_site_entry_carries_the_staged_handle():
    """The `results_ref` half. If this name were transcribed as
    `staged_results_ref` from the issue, this test would be the only thing in
    the repo that noticed."""
    before, after = _states(after_log=[_site_entry(results_ref="results/log_010.json")])
    expect_fires(lambda: check_v2(before, after, POSITIVE), "carries results_ref")


def test_v2_quiet_on_the_correct_pair():
    before, after = _states(after_log=[_site_entry()])
    expect_passes(lambda: check_v2(before, after, POSITIVE))


def test_v2_treats_explicit_null_as_not_carrying():
    """`results_ref: null` on a site entry is the correct shape, not a violation."""
    before, after = _states(after_log=[_site_entry(results_ref=None)])
    expect_passes(lambda: check_v2(before, after, POSITIVE))


# --- V4: the URL logged is the URL presented ---------------------------


def test_v4_fires_when_the_logged_url_is_not_in_the_reply():
    before, after = _states(after_log=[_site_entry()])
    expect_fires(
        lambda: check_v4(
            before, after, "Here is your search link: https://example.com/other", POSITIVE
        ),
        "not in\n?.*the reply|never presented",
    )


def test_v4_quiet_when_the_reply_carries_the_url():
    """The URL must be after the final `---` — that's the text the caller
    relays to the researcher (issue #4179); a reply with no `---` at all has
    an empty tail and must fire, which is exactly why this fixture has one."""
    before, after = _states(after_log=[_site_entry()])
    reply = f"Invocation: hand-off.\n---\nOpen this in your browser: {URL}"
    expect_passes(lambda: check_v4(before, after, reply, POSITIVE))


def test_v4_fires_when_the_url_is_only_above_the_final_rule():
    """The original #4179 defect: the URL sits in the caller-facing report
    above the `---`, and the researcher-facing tail never mentions it."""
    before, after = _states(after_log=[_site_entry()])
    reply = f"Invocation: hand-off.\nLink: {URL}\n---\nOpen the link I sent you."
    expect_fires(
        lambda: check_v4(before, after, reply, POSITIVE),
        "not in\n?.*the final|never presented",
    )


def test_v4_ignores_an_entry_with_no_url():
    """Shape is `test_url_generation_log_entry_shape`'s job; V4 must not
    double-report it."""
    entry = _site_entry(external_site={"site": "ancestry", "capture_received": False})
    before, after = _states(after_log=[entry])
    expect_passes(lambda: check_v4(before, after, "no link here", POSITIVE))


def test_v4_skips_a_capture_arrival_entry():
    """SKILL.md:439 — when a capture comes back the skill appends a NEW entry
    re-logging the step-4 URL, and that reply analyses the PDF rather than
    presenting a link. The schema requires `url_generated` on it regardless,
    so without the skip this reads as a URL logged but never shown."""
    entry = _site_entry(
        external_site={"site": "ancestry", "url_generated": URL, "capture_received": True}
    )
    before, after = _states(after_log=[entry])
    expect_passes(
        lambda: check_v4(before, after, "The capture shows a 1850 household of six.", POSITIVE)
    )


def test_v4_skips_a_no_access_entry():
    """SKILL.md:584 — the no-access entry logs `outcome: "error"` and its reply
    asks whether to skip the site, so it presents no link either."""
    before, after = _states(after_log=[_site_entry(outcome="error")])
    expect_passes(
        lambda: check_v4(before, after, "You have no Ancestry access — skip this site?", POSITIVE)
    )


def test_v4_still_fires_on_a_negative_outcome_that_hides_the_url():
    """The boundary that must NOT widen. Scoping the skip on
    `outcome != "partial"` would swallow this: the autonomous-defer path logs
    `negative` and DOES present the URL, where V4 holds on 10 of 10 committed
    runs. Only capture-arrival and no-access are exempt."""
    before, after = _states(after_log=[_site_entry(outcome="negative")])
    expect_fires(
        lambda: check_v4(before, after, "Deferring this search for now.", POSITIVE),
        "not in\n?.*the reply|never presented",
    )


# --- V6: no plan status when no entry names a plan item ----------------


def test_v6_fires_when_status_moves_with_no_entry_naming_an_item():
    before, after = _states(
        after_log=[_links_entry(plan_item_id=None), _site_entry(plan_item_id=None)],
        before_items=[_item(status="planned")],
        after_items=[_item(status="completed")],
    )
    expect_fires(lambda: check_v6(before, after, POSITIVE), "records no plan progress")


def test_v6_gates_out_when_an_entry_names_the_item():
    """The gate, asserted rather than left as a bare skip.

    When an entry names a plan item, status writes are in scope and V6 must not
    judge them — it skips. Calling it and letting the skip propagate would make
    this test itself SKIPPED in the suite, which is the shape #1950 warns reads
    as coverage while asserting nothing. So the skip is caught and asserted.
    """
    before, after = _states(
        after_log=[_site_entry(plan_item_id="pli_001")],
        before_items=[_item(status="planned")],
        after_items=[_item(status="completed")],
    )
    with pytest.raises(pytest.skip.Exception, match="names a plan item"):
        check_v6(before, after, POSITIVE)


def test_v6_quiet_when_no_status_moved():
    before, after = _states(
        after_log=[_site_entry(plan_item_id=None)],
        before_items=[_item(status="planned")],
        after_items=[_item(status="planned")],
    )
    expect_passes(lambda: check_v6(before, after, POSITIVE))


# --- V7: update a plan item, never append one --------------------------


def test_v7_fires_on_an_appended_plan_item():
    """`ut_search_external_sites_013`'s shape: an item appended, then an
    existing one set `skipped`."""
    before, after = _states(
        before_items=[_item("pli_007", "planned")],
        after_items=[_item("pli_007", "skipped"), _item("pli_008", "skipped")],
    )
    expect_fires(
        lambda: check_v7(before, after, POSITIVE),
        r"appended plan item\(s\) \['pli_008'\]",
    )


def test_v7_quiet_when_an_existing_item_is_updated():
    """The permitted half — updating status is what the skill is for."""
    before, after = _states(
        before_items=[_item("pli_007", "planned")],
        after_items=[_item("pli_007", "completed")],
    )
    expect_passes(lambda: check_v7(before, after, POSITIVE))


def test_v7b_fires_on_a_write_outside_log_and_plans():
    """The adjacent boundary, and `assert_only_writes_to_sections`'s first call
    site repo-wide. Deliberately a separate check: `owned={"log","plans"}`
    permits an append to `plans`, so it cannot substitute for V7."""
    before = {"research_json": {"log": [], "plans": _plan([_item()]), "sources": []}}
    after = {
        "research_json": {
            "log": [],
            "plans": _plan([_item()]),
            "sources": [{"id": "src_001", "title": "invented"}],
        }
    }
    expect_fires(
        lambda: check_v7b(before, after, POSITIVE),
        r"modified sections it doesn't own: \['sources'\]",
    )


def test_v7b_quiet_on_a_log_and_plans_write():
    before, after = _states(
        after_log=[_site_entry()],
        before_items=[_item(status="planned")],
        after_items=[_item(status="completed")],
    )
    expect_passes(lambda: check_v7b(before, after, POSITIVE))


# --- V8: the log is append-only ----------------------------------------


def test_v8_fires_when_a_prior_entry_is_edited():
    prior = _site_entry("log_001", outcome="partial")
    edited = _site_entry("log_001", outcome="positive")
    before, after = _states(before_log=[prior], after_log=[edited])
    expect_fires(
        lambda: check_v8(before, after, POSITIVE),
        "log entry log_001 was modified",
    )


def test_v8_quiet_when_entries_are_only_appended():
    """Two entries per turn plus a capture entry — the skill's normal shape."""
    prior = _site_entry("log_001")
    before, after = _states(
        before_log=[prior], after_log=[prior, _links_entry("log_002"), _site_entry("log_003")]
    )
    expect_passes(lambda: check_v8(before, after, POSITIVE))


def test_v6_is_tier_1_and_gates_the_run():
    """V6's tier is a property of the NAME, and nothing else asserts it.

    `validator_runner` decides the tier from the `report_` prefix alone
    (`is_report = attr_name.startswith("report_")`), and the V6 cases above call
    the function directly, so they pin its logic but never its tier. Demoting it
    back to `report_` would stop it gating, and nothing else here would notice:
    the module-level import by name fails with an ImportError about an import,
    not about a tier.

    The 2026-09-22 ruling (ADR-0011, "Rulings that generalize") promoted it. "No
    SKILL.md states it" - the earlier review finding that kept it reporting-only
    - does not settle the question, because the rule is decidable from the
    project documents alone. V6 is now the complement of the `research_append`
    log-attribution precondition: coarser on attribution, broader on status.

    So assert the property the ruling asked for rather than the spelling: run it
    through the harness and require that it is NOT `reporting_only`.
    """
    from harness.validator_runner import run_validators

    before, after = _states(
        after_log=[_links_entry(plan_item_id=None), _site_entry(plan_item_id=None)],
        before_items=[_item(status="planned")],
        after_items=[_item(status="completed")],
    )
    results = run_validators(
        skill="search-external-sites",
        validators_dir=Path(__file__).resolve().parents[2] / "validators",
        before_state=before,
        after_state=after,
        tool_calls=[],
        skill_frontmatter={"name": "search-external-sites"},
        test=POSITIVE,
    )
    v6 = next(
        (r for r in results
         if r.name == "test_no_plan_item_status_written_when_no_entry_names_one"),
        None,
    )
    assert v6 is not None, "V6 did not run; the harness did not collect it"
    assert v6.reporting_only is False, (
        "V6 is only reporting. The 2026-09-22 ruling (ADR-0011, 'Rulings that "
        "generalize') promoted it to gating — it must stay `test_`-prefixed. "
        "It is the complement of the research_append log-attribution "
        "precondition: coarser on attribution, broader on status."
    )


# --- #2521 Half 2: collection-ID provenance ----------------------------
#
# This check is tier 2 (`report_*`), so nothing gates on it and a defect here
# is invisible everywhere else: a validator only ever executes inside a paid
# `make eval-skill`. Both directions are asserted.
#
# An id is backed when its `ancestry:<id>` key is a row of the project's
# `external-collections.json` (any place), which `after_state["files"]` carries
# as the raw JSON string. Prose naming the collection no longer counts.

COLLECTION_URL = "https://www.ancestry.com/search/collections/8054/?name=Patrick_Flynn"
DBID_URL = "https://search.ancestry.com/cgi-bin/sse.dll?dbid=8054&gsfn=Patrick&gsln=Flynn"


def _collection_site_entry(entry_id="log_011", url=COLLECTION_URL, **over):
    """A URL-generation entry whose URL is collection-scoped."""
    return _site_entry(entry_id, external_site={
        "site": "ancestry", "url_generated": url, "capture_received": False,
    }, **over)


def _collections_file(*keys, place="Pennsylvania, United States"):
    rows = [{"key": k, "url": f"https://example.org/{k}"} for k in keys]
    return json.dumps({"places": {place: {"rows": rows}}})


def _research(log, plans=None, collections=None, **sections):
    plans = plans if plans is not None else _plan([_item()])
    state = {"research_json": {"log": list(log), "plans": plans, **sections}}
    if collections is not None:
        state["files"] = {"external-collections.json": collections}
    return state


def test_2521_fires_when_nothing_is_stored():
    after = _research([_collection_site_entry()])
    expect_fires(lambda: check_2521({}, after, POSITIVE), "ancestry:8054")


def test_2521_quiet_when_the_collection_is_stored():
    after = _research([_collection_site_entry()], collections=_collections_file("ancestry:8054"))
    expect_passes(lambda: check_2521({}, after, POSITIVE))


def test_2521_backs_the_dbid_form():
    """`?dbid=<id>` is the same collection as `/search/collections/<id>`. The prose
    predicate had no dbid arm, so a dbid-only run skipped."""
    after = _research([_collection_site_entry(url=DBID_URL)],
                      collections=_collections_file("ancestry:8054"))
    expect_passes(lambda: check_2521({}, after, POSITIVE))


def test_2521_fires_on_an_unstored_dbid():
    after = _research([_collection_site_entry(url=DBID_URL)],
                      collections=_collections_file("ancestry:7163"))
    expect_fires(lambda: check_2521({}, after, POSITIVE), "ancestry:8054")


def test_2521_a_row_stored_under_any_place_backs_the_id():
    after = _research([_collection_site_entry()],
                      collections=_collections_file("ancestry:8054", place="Schuylkill, Pennsylvania, United States"))
    expect_passes(lambda: check_2521({}, after, POSITIVE))


def test_2521_prose_naming_the_collection_does_not_back_it():
    """The old predicate counted a plan rationale; the stored list is the only backing now."""
    items = [_item()]
    items[0]["rationale"] = "Ancestry collection 8054 (1850 census) indexes the household."
    after = _research([_collection_site_entry()], plans=_plan(items),
                      collections=_collections_file("ancestry:7163"))
    expect_fires(lambda: check_2521({}, after, POSITIVE), "ancestry:8054")


@pytest.mark.parametrize("raw", ["{not json", json.dumps([1, 2]), json.dumps({"places": []}), 7])
def test_2521_an_unreadable_file_backs_nothing_and_does_not_crash(raw):
    after = _research([_collection_site_entry()], collections=raw)
    expect_fires(lambda: check_2521({}, after, POSITIVE), "ancestry:8054")


def test_2521_survives_a_null_url_generated():
    """A null url must neither crash nor suppress a backed sibling."""
    after = _research(
        [_site_entry("log_010", external_site={
            "site": "ancestry", "url_generated": None, "capture_received": False}),
         _collection_site_entry("log_011")],
        collections=_collections_file("ancestry:8054"),
    )
    expect_passes(lambda: check_2521({}, after, POSITIVE))


def test_2521_skips_a_run_whose_only_url_is_null():
    after = _research([_site_entry("log_011", external_site={
        "site": "ancestry", "url_generated": None, "capture_received": False})])
    with pytest.raises(pytest.skip.Exception):
        check_2521({}, after, POSITIVE)


def test_2521_judges_only_the_entries_this_run_appended():
    seeded = [_collection_site_entry("log_002")]
    before = {"research_json": {"log": list(seeded), "plans": _plan([_item()])}}
    after = _research(seeded)          # same entry, nothing appended
    with pytest.raises(pytest.skip.Exception):
        check_2521(before, after, POSITIVE)


def test_2521_does_not_crash_on_a_malformed_log_entry():
    """A crash gates a paid run (`validator_runner` builds it without `reporting_only`)."""
    after = _research([None, _collection_site_entry()])
    expect_fires(lambda: check_2521({}, after, POSITIVE), "ancestry:8054")
    stringified = _research([{"id": "log_010", "external_site": '{"site": "ancestry"}'},
                             _collection_site_entry()])
    expect_fires(lambda: check_2521({}, stringified, POSITIVE), "ancestry:8054")


def test_2521_reports_every_unbacked_url():
    after = _research([_collection_site_entry("log_011"),
                       _collection_site_entry("log_012", url=DBID_URL)])
    expect_fires(lambda: check_2521({}, after, POSITIVE), "2 collection-scoped")


def test_2521_matches_a_capitalised_host():
    after = _research([_collection_site_entry(
        url="https://www.Ancestry.com/search/collections/8054/?name=X")])
    expect_fires(lambda: check_2521({}, after, POSITIVE), "ancestry:8054")


def test_2521_is_tier_2_and_cannot_gate_a_run():
    """Ruling C (lead, 2026-09-24) is measure-first: it must stay `report_`."""
    from harness.validator_runner import run_validators

    before, after = _states(after_log=[_collection_site_entry()])
    results = run_validators(
        skill="search-external-sites",
        validators_dir=Path(__file__).resolve().parents[2] / "validators",
        before_state=before,
        after_state=after,
        tool_calls=[],
        skill_frontmatter={"name": "search-external-sites"},
        test=POSITIVE,
    )
    got = next(
        (r for r in results
         if r.name == "report_collection_scoped_url_with_no_backed_collection_id"),
        None,
    )
    assert got is not None, "the check did not run; the harness did not collect it"
    assert got.reporting_only is True


def test_2521_skips_a_run_with_no_collection_scoped_url():
    """A site-wide Ancestry template is the documented fallback, not a defect."""
    after = _research([_site_entry()])  # site-wide URL, no /collections/
    with pytest.raises(pytest.skip.Exception):
        check_2521({}, after, POSITIVE)


# --- V4 on the direct arm: the agent's own return, not the relay -------


def test_v4_reads_the_agents_own_return_on_the_direct_arm():
    """On the direct arm the main thread only relays; the URL is in the agent's
    return, after its own final `---`. Reading `text_response` there would
    fire on a correct run."""
    before, after = _states(after_log=[_site_entry()])
    returns = [
        {"subagent_type": "search-external-sites", "text": f"Invocation: hand-off.\n---\nSearch link: {URL}"}
    ]
    expect_passes(lambda: check_v4(before, after, "Relayed.", POSITIVE, agent_returns=returns))


def test_v4_on_the_direct_arm_still_fires_when_the_agent_omitted_the_url():
    before, after = _states(after_log=[_site_entry()])
    returns = [{"subagent_type": "search-external-sites", "text": "Here is a link: https://example.com/other"}]
    expect_fires(
        lambda: check_v4(before, after, f"Relayed {URL}", POSITIVE, agent_returns=returns),
        "not in\n?.*the reply|never presented",
    )


# --- triage closes its open hand-off -----------------------------------

TRIAGE = {"type": "positive", "tags": ["triage-closes-handoff"]}
OPEN_URL = "https://www.myheritage.com/research/collection-20822/x?qname=Josiah"


def _handoff(entry_id, outcome, url, capture):
    return {
        "id": entry_id, "tool": "external_site", "outcome": outcome,
        "external_site": {"site": "myheritage", "url_generated": url, "capture_received": capture},
    }


def test_triage_quiet_when_the_closing_entry_carries_the_rows_url():
    before, after = _states(
        before_log=[_handoff("log_001", "partial", OPEN_URL, False)],
        after_log=[_handoff("log_001", "partial", OPEN_URL, False), _handoff("log_002", "positive", OPEN_URL, True)],
    )
    expect_passes(lambda: check_triage(before, after, TRIAGE))


def test_triage_fires_when_the_closing_entry_names_another_url():
    before, after = _states(
        before_log=[_handoff("log_001", "partial", OPEN_URL, False)],
        after_log=[
            _handoff("log_001", "partial", OPEN_URL, False),
            _handoff("log_002", "positive", OPEN_URL + "&p=2", True),
        ],
    )
    expect_fires(lambda: check_triage(before, after, TRIAGE), "still open")


def test_triage_fires_when_nothing_was_logged():
    before, after = _states(
        before_log=[_handoff("log_001", "partial", OPEN_URL, False)],
        after_log=[_handoff("log_001", "partial", OPEN_URL, False)],
    )
    expect_fires(lambda: check_triage(before, after, TRIAGE), "still open")


# --- the Archion browse hand-off ----------------------------------------

ARCHION = {"type": "positive", "tags": ["archion-browse"]}
PARISH = "https://www.archion.de/de/alle-archive/baden-wuerttemberg/x/baiersbronn"


def _build(**args):
    return {"tool": "mcp__genealogy__build_external_search_url", "args": args}


def test_archion_quiet_on_the_parish_page_with_projectpath():
    calls = [_build(site="archion", baseUrl=PARISH, attributes={}, projectPath="/p")]
    expect_passes(lambda: check_archion(calls, ARCHION))


@pytest.mark.parametrize(
    "calls, match",
    [
        ([], "no build_external_search_url call with site 'archion'"),
        ([_build(site="ancestry", attributes={"surname": "Seeger"}, projectPath="/p")], "site 'archion'"),
        ([_build(site="archion", attributes={}, projectPath="/p")], "no Archion parish page"),
        ([_build(site="archion", baseUrl=PARISH, attributes={})], "omitted projectPath"),
    ],
    ids=["no_call", "wrong_site", "no_baseurl", "no_projectpath"],
)
def test_archion_fires(calls, match):
    expect_fires(lambda: check_archion(calls, ARCHION), match)


# --- a browse-site hand-off checks the FamilySearch Catalog (#4428) ------

BROWSE_CATALOG = {"type": "positive", "tags": ["browse-catalog"]}
MATRICULA_ROOT = "https://data.matricula-online.eu/de/"


def _catalog(available_online=False, response=True):
    call = {"tool": "mcp__genealogy__catalog_search", "args": {"standardPlace": "Ochtrup, Kreis Steinfurt, Westphalia, Prussia, Germany"}}
    if response:
        call["response"] = {
            "hits": [
                {
                    "id": "koha:202974",
                    "title": "Kirchenbuch, 1667-1875",
                    "filmNotes": [
                        {"filmNumber": "876539", "imageGroupNumber": "8643224", "text": "Taufen, Heiraten, Tote 1667-1809"},
                        {"filmNumber": "876540", "imageGroupNumber": "8109455", "text": "Taufen, Heiraten, Tote 1804-1865"},
                    ],
                    "availableOnline": available_online,
                }
            ]
        }
    return call


def _matricula(**over):
    args = {"site": "matricula", "attributes": {}, "projectPath": "/p"}
    args.update(over)
    return _build(**args)


GOOD_TAIL = (
    "Invocation: hand-off.\n---\nOpen the Matricula link and search Ochtrup. FamilySearch filmed the "
    "same Catholic register as film 876540, viewable only at a FamilySearch Center or affiliate library.\n"
    "Next, upload the page."
)


def test_browse_catalog_quiet_on_a_named_center_only_film():
    expect_passes(lambda: check_browse_catalog([_catalog(), _matricula()], GOOD_TAIL, BROWSE_CATALOG))


def test_browse_catalog_quiet_on_a_replay_with_no_recorded_response():
    calls = [_catalog(response=False), _matricula()]
    expect_passes(lambda: check_browse_catalog(calls, "x\n---\nOpen the Matricula link.", BROWSE_CATALOG))


def test_browse_catalog_skips_untagged_tests():
    with pytest.raises(pytest.skip.Exception):
        check_browse_catalog([], "", POSITIVE)


@pytest.mark.parametrize(
    "calls, reply, match",
    [
        ([_matricula()], GOOD_TAIL, "no catalog_search call"),
        ([_catalog()], GOOD_TAIL, "browse-site link was dropped"),
        ([_catalog(), _matricula(projectPath=None)], GOOD_TAIL, "omitted projectPath"),
        ([_catalog(), _matricula()], "Film 876540 is at a FamilySearch Center.\n---\nOpen the Matricula link.", "names none of the center-only films"),
        ([_catalog(), _matricula()], GOOD_TAIL.replace("film 876540", "film 8765401"), "names none of the center-only films"),
        ([_catalog(), _matricula()], GOOD_TAIL + " I can read image group 008109455 for you.", "offers a read"),
        ([_catalog(available_online=True), _matricula()], GOOD_TAIL, "no center-only film"),
    ],
    ids=["no_catalog", "no_build", "no_projectpath", "film_only_above_the_line", "film_number_inside_a_longer_one", "offers_the_group", "no_center_only_hit"],
)
def test_browse_catalog_fires(calls, reply, match):
    expect_fires(lambda: check_browse_catalog(calls, reply, BROWSE_CATALOG), match)


# --- a plan item's collection_url is the baseUrl (#2995) -----------------

COLL = {"type": "positive", "tags": ["collection-url"]}
CURATED = "https://www.ancestry.com/search/collections/7163/"


def _coll_before():
    item = _item("pli_007")
    item["collection_url"] = CURATED
    return {"research_json": {"log": [], "plans": _plan([item])}}


def _coll_build(base_url, plan_item="pli_007"):
    return {"tool": "mcp__genealogy__build_external_search_url",
            "args": {"site": "ancestry", "baseUrl": base_url, "planItemId": plan_item}}


def test_collection_url_passes_when_the_base_url_is_the_collection():
    expect_passes(lambda: check_collection_url(_coll_before(), [_coll_build(CURATED)], COLL))


def test_collection_url_fires_on_a_different_base_url():
    other = "https://www.ancestry.com/search/collections/1276/"
    expect_fires(lambda: check_collection_url(_coll_before(), [_coll_build(other)], COLL), "is not the")


def test_collection_url_fires_on_a_site_wide_search():
    expect_fires(lambda: check_collection_url(_coll_before(), [_coll_build(None)], COLL), "is not the")


def test_collection_url_fires_when_the_list_is_fetched_again():
    calls = [{"tool": "mcp__genealogy__external_links_search", "args": {}}, _coll_build(CURATED)]
    expect_fires(lambda: check_collection_url(_coll_before(), calls, COLL), "external_links_search")


def test_collection_url_fires_when_no_url_is_built():
    expect_fires(lambda: check_collection_url(_coll_before(), [], COLL), "no build_external_search_url")


def test_collection_url_fires_when_no_call_names_the_item():
    expect_fires(lambda: check_collection_url(_coll_before(), [_coll_build(CURATED, None)], COLL), "names a plan item")


def test_collection_url_skips_untagged_tests():
    with pytest.raises(pytest.skip.Exception):
        check_collection_url(_coll_before(), [], POSITIVE)


def test_ancestry_key_regex_matches_the_engines():
    """The validator keys an Ancestry URL exactly as the engine stores it; a drift
    in either copy would make a stored id read as unbacked."""
    import re as _re
    from test_search_external_sites import _ANCESTRY_ID

    ts = (Path(__file__).resolve().parents[4] / "packages/engine/mcp-server/src/utils/"
          "external-collections-store.ts").read_text(encoding="utf-8")
    m = _re.search(r"const ANCESTRY_ID = /(.+)/i;", ts)
    assert m, "ANCESTRY_ID not found in external-collections-store.ts"
    assert m.group(1).replace("\\/", "/") == _ANCESTRY_ID.pattern
    assert _ANCESTRY_ID.flags & _re.I


# --- the FamilySearch-holds-this-too note reaches the researcher (#4179) --

FS_HOLDINGS = {"type": "positive", "tags": ["fs-holdings"]}


def test_fs_holdings_fires_when_the_note_is_only_above_the_line():
    """The #4179 defect: the FamilySearch note sits in the caller-facing
    report, and the researcher-facing tail never mentions it."""
    reply = "FamilySearch holds collection 1459985 too.\n---\nHere is the MyHeritage link."
    expect_fires(
        lambda: check_fs_holdings(reply, FS_HOLDINGS),
        "never reached",
    )


def test_fs_holdings_quiet_when_the_note_is_after_the_line():
    reply = "Invocation: hand-off.\n---\nFamilySearch also holds this census, searchable via search-records."
    expect_passes(lambda: check_fs_holdings(reply, FS_HOLDINGS))


def test_fs_holdings_skips_untagged_tests():
    with pytest.raises(pytest.skip.Exception):
        check_fs_holdings("no FamilySearch mention anywhere", POSITIVE)


def test_fs_holdings_is_case_insensitive():
    reply = "Invocation: hand-off.\n---\nfamilysearch holds the same collection."
    expect_passes(lambda: check_fs_holdings(reply, FS_HOLDINGS))


# --- a plan-item link must match the searched repository (#4179) ---------

LINK_TEST = {"type": "positive", "tags": []}
ANCESTRY_URL = "https://www.ancestry.com/search/collections/8800/"
MYHERITAGE_URL = "https://www.myheritage.com/research/collection-20822/1855-massachusetts-state-census"


def _link_before(repository="FamilySearch", item_id="pli_006"):
    item = _item(item_id)
    item["repository"] = repository
    return {"research_json": {"log": [], "plans": _plan([item])}}


def test_repo_link_fires_on_a_different_repository():
    """The #4179 regression this restores: `pli_006`'s repository is
    FamilySearch, so an Ancestry search must not stamp its id."""
    calls = [_build(site="ancestry", baseUrl=ANCESTRY_URL, planItemId="pli_006")]
    expect_fires(
        lambda: check_repo_link(_link_before("FamilySearch"), calls, LINK_TEST),
        "different repositories",
    )


def test_repo_link_fires_on_a_nonexistent_plan_item():
    """`ut_search_external_sites_015` once passed `pli_000`, an id that does
    not exist in the project."""
    calls = [_build(site="ancestry", baseUrl=ANCESTRY_URL, planItemId="pli_000")]
    expect_fires(
        lambda: check_repo_link(_link_before("FamilySearch", "pli_006"), calls, LINK_TEST),
        "names no plan item",
    )


def test_repo_link_quiet_on_the_matching_repository():
    """The real `ut_search_external_sites_fhk` shape: the plan already has a
    MyHeritage item for this exact census, and linking it is correct —
    confirmed against the real committed v4/v5/v6 runs, which all pass
    planItemId: "pli_001" for this scenario."""
    calls = [_build(site="myheritage", baseUrl=MYHERITAGE_URL, planItemId="pli_001")]
    expect_passes(
        lambda: check_repo_link(_link_before("MyHeritage", "pli_001"), calls, LINK_TEST)
    )


def test_repo_link_quiet_when_no_planitemid_is_sent():
    calls = [_build(site="ancestry", baseUrl=ANCESTRY_URL)]
    expect_passes(lambda: check_repo_link(_link_before(), calls, LINK_TEST))


def test_repo_link_skips_a_run_with_no_linked_call():
    with pytest.raises(pytest.skip.Exception):
        check_repo_link(_link_before(), [], LINK_TEST)


def test_repo_link_quiet_on_an_aliased_repository_spelling():
    """review, 2026-11-05: `archives_gov`'s recommended repository spelling is
    "NARA", not a substring of the site's own enum value - a correct link
    must not fail for this mismatch."""
    calls = [_build(site="archives_gov", baseUrl="https://catalog.archives.gov/search", planItemId="pli_006")]
    expect_passes(
        lambda: check_repo_link(_link_before("NARA", "pli_006"), calls, LINK_TEST)
    )


def test_repo_link_quiet_on_an_other_repository():
    """`repository_recommended` is an open enum whose own documented example
    includes "other" - a plan item with nothing concrete to match against
    must not be flagged."""
    calls = [_build(site="archive_org", baseUrl="https://archive.org/search", planItemId="pli_006")]
    expect_passes(
        lambda: check_repo_link(_link_before("other", "pli_006"), calls, LINK_TEST)
    )


def test_repo_link_still_fires_on_a_familysearch_item_via_ancestry():
    """The alias/open-enum carve-outs must not swallow the original
    regression: a FamilySearch-only plan item is still wrong for any
    external site."""
    calls = [_build(site="ancestry", baseUrl=ANCESTRY_URL, planItemId="pli_006")]
    expect_fires(
        lambda: check_repo_link(_link_before("FamilySearch", "pli_006"), calls, LINK_TEST),
        "different repositories",
    )


def test_repo_link_still_fires_on_a_nonexistent_plan_item_with_aliases_present():
    """The alias/open-enum carve-outs must not swallow the nonexistent-id
    check either."""
    calls = [_build(site="archives_gov", baseUrl="https://catalog.archives.gov/search", planItemId="pli_000")]
    expect_fires(
        lambda: check_repo_link(_link_before("NARA", "pli_006"), calls, LINK_TEST),
        "names no plan item",
    )


# --- #3990: the upload page, and an upload read with the tools -----------
#
# Every check here takes its gate from the run's own documents and calls, so a
# gate that over-matches would skip it silently; each is asserted both ways.
# The folder-mode half the issue asks for ("every existing hand-off test runs
# with no uploadUrl") is the corpus replay at the bottom of this block.

PROJ = "/proj_7d4b2e91c6a05f38"
UPLOAD_URL = "https://genealogy.example.org/#/p/proj_7d4b2e91c6a05f38/upload"
STEM = "ma-1855-census-josiah-barnes"
STAGED = "results/.staging/7f3e2a.json"
TODAY = (
    "Scroll to the bottom and back to the top, press Cmd+P (Mac) or Ctrl+P "
    "(Windows), choose Save as PDF, and upload it here — log in first if the page asks."
)
REFUSED = {"type": "positive", "tags": ["transcribe-refused-stays-open"]}


def _context(uploads=None, upload_url=UPLOAD_URL):
    """A recorded `project_context` call, answered as the hosted mock answers it."""
    response = {"ok": True, "objective": "Locate Josiah Barnes", "awaitingUser": []}
    if uploads is not None:
        response["uploads"] = uploads
    if upload_url is not None:
        response["uploadUrl"] = upload_url
    return {"tool": "mcp__genealogy__project_context", "args": {"projectPath": PROJ}, "response": response}


def _row(name, has_text=False):
    return {"name": name, "uploaded": "2026-11-01T12:00:00.000Z", "hasText": has_text}


def _asks(present="yes"):
    """A hand-off test's input, with the delegation the harness threads in."""
    return {
        "type": "positive",
        "tags": [],
        "delegation": f"Search MyHeritage for Josiah Barnes.\n\nuserPresent: {present}\nprojectPath: {PROJ}",
    }


def _handoff_reply(*lines):
    return "Invocation: hand-off.\n---\n" + "\n".join((URL,) + lines)


def _wording(before, after, calls, reply, test):
    """V1 on the direct arm, where the reply graded is the agent's own return."""
    returns = [{"subagent_type": "search-external-sites", "text": reply}]
    return check_upload_wording(before, after, calls, "Relayed.", test, agent_returns=returns)


# --- V1: the capture steps name the upload page only when served ----------


def test_upload_wording_passes_todays_folder_mode_wording():
    before, after = _states(after_log=[_site_entry()])
    calls = [_context(upload_url=None)]
    expect_passes(lambda: _wording(before, after, calls, _handoff_reply(TODAY), _asks()))


@pytest.mark.parametrize(
    "planted",
    [UPLOAD_URL, "https://genealogy.example.org/upload/proj_7d4b2e91c6a05f38"],
    ids=["route_form", "plain_page_form"],
)
def test_upload_wording_fires_on_an_upload_link_in_folder_mode(planted):
    """Both link forms: today's `/#/p/<id>/upload` and the plain page's
    `/upload/<id>`, which the upload page will move to."""
    before, after = _states(after_log=[_site_entry()])
    reply = _handoff_reply(TODAY.replace("upload it here", f"upload it at {planted}"))
    calls = [_context(upload_url=None)]
    expect_fires(lambda: _wording(before, after, calls, reply, _asks()), "did not serve")


def test_upload_wording_fires_when_folder_mode_stops_saying_upload():
    before, after = _states(after_log=[_site_entry()])
    reply = _handoff_reply("Save the page as a PDF and send it back to me.")
    calls = [_context(upload_url=None)]
    expect_fires(
        lambda: _wording(before, after, calls, reply, _asks()), "no longer says to upload"
    )


def test_upload_wording_ignores_an_external_search_that_mentions_upload():
    """A query string, or a path segment that only contains the word, is not an
    upload page."""
    before, after = _states(after_log=[_site_entry()])
    reply = _handoff_reply(
        "https://www.newspapers.com/search/results/?keyword=upload&region=us-pa",
        "https://archive.org/details/uploads-1855-census",
        TODAY,
    )
    expect_passes(lambda: _wording(before, after, [], reply, _asks()))


def test_upload_wording_judges_a_user_reported_nil():
    """A nil the user reports re-gives the capture steps (step 6), so its
    `negative` entry is judged. v5's `ut_search_external_sites_008` gave none."""
    before, after = _states(after_log=[_site_entry(outcome="negative")])
    reply = _handoff_reply("Not yet conclusive; capture the empty page as a PDF to confirm it.")
    expect_fires(
        lambda: _wording(before, after, [], reply, _asks()), "no longer says to upload"
    )


def test_upload_wording_hosted_passes_with_the_served_url():
    """Sentence punctuation after the link is not part of it."""
    before, after = _states(after_log=[_site_entry()])
    reply = _handoff_reply(TODAY.replace("upload it here", f"upload it at {UPLOAD_URL}."))
    expect_passes(lambda: _wording(before, after, [_context()], reply, _asks()))


def test_upload_wording_hosted_fires_when_the_served_url_is_missing():
    before, after = _states(after_log=[_site_entry()])
    expect_fires(
        lambda: _wording(before, after, [_context()], _handoff_reply(TODAY), _asks()),
        "never gives it",
    )


def test_upload_wording_hosted_fires_on_a_link_not_served():
    """`uploadUrl` comes from `project_context`, never from the delegation."""
    before, after = _states(after_log=[_site_entry()])
    other = "https://genealogy.example.org/#/p/proj_0b5e3c8a19d27f64/upload"
    reply = _handoff_reply(TODAY.replace("upload it here", f"upload it at {UPLOAD_URL} or {other}"))
    expect_fires(lambda: _wording(before, after, [_context()], reply, _asks()), "did not serve")


@pytest.mark.parametrize("present", ["no", "**no**"])
def test_upload_wording_asks_no_capture_steps_of_an_autonomous_run(present):
    """The deferral (`userPresent: no`) gives no capture steps, in either arm."""
    before, after = _states(after_log=[_site_entry(outcome="negative")])
    reply = _handoff_reply("Deferred: this search needs a capture, which cannot happen while the run works.")
    for calls in ([_context(upload_url=None)], [_context()]):
        expect_passes(lambda: _wording(before, after, calls, reply, _asks(present)))


def test_upload_wording_still_fires_on_an_unserved_link_in_an_autonomous_run():
    before, after = _states(after_log=[_site_entry(outcome="negative")])
    reply = _handoff_reply(f"Deferred. The upload page is {UPLOAD_URL}")
    calls = [_context(upload_url=None)]
    expect_fires(lambda: _wording(before, after, calls, reply, _asks("no")), "did not serve")


def _triaged():
    """A triage run: the closing entry, and no hand-off or nil report."""
    entry = _site_entry(
        outcome="positive",
        external_site={"site": "ancestry", "url_generated": URL, "capture_received": True},
    )
    return _states(after_log=[entry])


RECORD_REQUEST = "Three results match. Click result #1 to open the full record page, then save it as a PDF and upload it"


@pytest.mark.parametrize("calls", [[], [_context(upload_url=None)], [_context()]], ids=["no_context", "folder", "hosted"])
def test_upload_wording_judges_a_triage_with_no_capture_steps(calls):
    """A triage gives no capture steps, so neither the served URL nor the word
    "upload" is asked of it: only the unserved-link arm runs, and finds nothing."""
    before, after = _triaged()
    reply = "Invocation: triage.\n---\nThree results match. Examine record #1?"
    expect_passes(lambda: _wording(before, after, calls, reply, _asks()))


@pytest.mark.parametrize("scenario", ["triage", "no_research_json"])
def test_upload_wording_fires_on_an_unserved_link_in_a_record_request(scenario):
    """Step 5's record request names the upload page as step 4 does, so a link
    `project_context` did not serve fails there too, with no hand-off this run
    and with no research.json at all."""
    before, after = _triaged() if scenario == "triage" else ({"research_json": None}, {"research_json": None})
    reply = f"Invocation: triage.\n---\n{RECORD_REQUEST} at {UPLOAD_URL}."
    expect_fires(lambda: _wording(before, after, [_context(upload_url=None)], reply, _asks()), "did not serve")
    expect_passes(lambda: _wording(before, after, [_context()], reply, _asks()))


def test_upload_wording_skips_a_reply_with_no_final_rule():
    """No `---`, no researcher text: the reply is not misreported as no longer
    saying "upload" (it does), and test_the_url_logged_is_the_url_presented
    fails the hand-off for the missing line."""
    before, after = _states(after_log=[_site_entry()])
    reply = f"{URL}\n{TODAY}"
    with pytest.raises(pytest.skip.Exception, match="no text after a final '---'"):
        _wording(before, after, [_context(upload_url=None)], reply, _asks())
    expect_fires(lambda: check_v4(before, after, reply, POSITIVE), "not in the text after the final")


def test_upload_wording_still_fires_on_a_silent_handoff():
    """An empty reply is not a reply with no `---`: a hand-off that says nothing
    gives no capture steps."""
    before, after = _states(after_log=[_site_entry()])
    expect_fires(
        lambda: _wording(before, after, [_context(upload_url=None)], "", _asks()), "no longer says to upload"
    )


def test_upload_wording_skips_a_silent_run_with_no_handoff():
    before, after = _triaged()
    with pytest.raises(pytest.skip.Exception, match="no reply and no hand-off"):
        _wording(before, after, [_context()], "", _asks())


# --- V2: no transcription of an upload that is text already --------------


def _transcribe(file, response=None):
    if response is None:
        response = {"staged": {"resultsRef": STAGED}, "digest": {"id": "capture:x", "chars": 640, "excerpt": "1855"}}
    return {
        "tool": "mcp__genealogy__image_transcribe",
        "args": {"projectPath": PROJ, "file": file},
        "response": response,
    }


def test_no_text_transcribe_fires_on_a_txt_upload():
    calls = [_context([_row(f"{STEM}.txt")]), _transcribe(f"uploads/{STEM}.txt")]
    expect_fires(lambda: check_no_text_transcribe({}, calls), "a text upload")


def test_no_text_transcribe_fires_on_an_upload_with_a_text_layer():
    calls = [_context([_row(f"{STEM}.pdf", has_text=True)]), _transcribe(f"uploads/{STEM}.pdf")]
    expect_fires(lambda: check_no_text_transcribe({}, calls), "text layer")


def test_no_text_transcribe_reads_the_layer_off_the_scenario_without_project_context():
    before = {"files": {f"uploads/{STEM}.pdf": "<binary>", f"uploads/{STEM}.pdf.txt": "1855 census"}}
    expect_fires(
        lambda: check_no_text_transcribe(before, [_transcribe(f"uploads/{STEM}.pdf")]), "text layer"
    )


def test_no_text_transcribe_passes_an_image_with_no_layer():
    """A lone `.txt` beside it is an upload of its own, not the image's layer."""
    before = {"files": {f"uploads/{STEM}.png": "<binary>", "uploads/notes.txt": "notes"}}
    calls = [_context([_row(f"{STEM}.png"), _row("notes.txt")]), _transcribe(f"uploads/{STEM}.png")]
    expect_passes(lambda: check_no_text_transcribe(before, calls))


def test_no_text_transcribe_skips_a_run_that_transcribes_no_upload():
    calls = [{"tool": "mcp__genealogy__image_transcribe", "args": {"imageId": "3:1:3Q9M-CSQ2"}, "response": {}}]
    with pytest.raises(pytest.skip.Exception, match="no image_transcribe of an upload"):
        check_no_text_transcribe({}, calls)


@pytest.mark.parametrize(
    "prefix",
    ["./", "/proj_7d4b2e91c6a05f38/", "proj_7d4b2e91c6a05f38/", "C:\\Temp\\eval-ul1\\"],
    ids=["dot", "absolute", "project_relative", "windows"],
)
def test_no_text_transcribe_sees_an_upload_by_a_longer_path(prefix):
    """A fixture matches `file` by substring (`~uploads/<name>`), so the mock
    answers these too: the check must count them as the upload, or the call it
    exists to catch goes unseen."""
    sep = "\\" if "\\" in prefix else "/"
    calls = [
        _context([_row(f"{STEM}.pdf", has_text=True), _row(f"{STEM}.txt")]),
        _transcribe(f"{prefix}uploads{sep}{STEM}.pdf"),
        _transcribe(f"{prefix}uploads{sep}{STEM}.txt"),
    ]
    expect_fires(lambda: check_no_text_transcribe({}, calls), "text layer")
    expect_fires(lambda: check_no_text_transcribe({}, calls), "a text upload")


@pytest.mark.parametrize("file", ["scans/myuploads/notes.txt", "images/uploads-1855.txt"])
def test_no_text_transcribe_ignores_a_file_outside_uploads(file):
    with pytest.raises(pytest.skip.Exception, match="no image_transcribe of an upload"):
        check_no_text_transcribe({}, [_transcribe(file)])


# --- V3: a closing entry names the upload, never its text layer ----------


def _closing(filename, entry_id="log_002"):
    entry = _handoff(entry_id, "positive", OPEN_URL, True)
    entry["external_site"]["capture_filename"] = filename
    return entry


@pytest.mark.parametrize("filename", [f"{STEM}.pdf.txt", f"uploads/{STEM}.pdf.txt"], ids=["name", "ref"])
def test_capture_filename_fires_on_the_text_layer(filename):
    before, after = _states(after_log=[_closing(filename)])
    calls = [_context([_row(f"{STEM}.pdf", has_text=True)])]
    expect_fires(lambda: check_capture_filename(before, after, calls), "text layer")


def test_capture_filename_passes_a_lone_txt_upload():
    """Form 2: the upload IS a `.txt`, so its own name is the right one."""
    before, after = _states(after_log=[_closing(f"{STEM}.txt")])
    calls = [_context([_row(f"{STEM}.txt")])]
    expect_passes(lambda: check_capture_filename(before, after, calls))


def test_capture_filename_skips_a_closing_entry_naming_the_original():
    before, after = _states(after_log=[_closing(f"{STEM}.pdf")])
    with pytest.raises(pytest.skip.Exception, match=r"no closing entry names a \.txt"):
        check_capture_filename(before, after, [_context([_row(f"{STEM}.pdf", has_text=True)])])


# --- V4: a hosted upload is read with the tools --------------------------


def _triage_test(capture):
    """A hosted triage's input: the plan item and the capture, as the router passes them."""
    return {
        "type": "positive",
        "tags": ["triage-closes-handoff"],
        "delegation": (
            "The researcher uploaded the MyHeritage results page for plan item pli_001.\n\n"
            f"capture: {capture}\nuserPresent: yes\nplanItemId: pli_001\nprojectPath: {PROJ}"
        ),
    }


def _sidecar(ref=None, refs=None):
    args = {"projectPath": PROJ}
    if ref is not None:
        args["ref"] = ref
    if refs is not None:
        args["refs"] = refs
    return {"tool": "mcp__genealogy__sidecar_read", "args": args, "response": {"ok": True}}


def _builtin(tool, **args):
    return {"tool": tool, "args": args, "agent_id": "a41c07"}


PDF_TEST = _triage_test(f"uploads/{STEM}.pdf")
TXT_TEST = _triage_test(f"uploads/{STEM}.txt")
PNG_TEST = _triage_test(f"uploads/{STEM}.png")


def test_upload_read_passes_form_1_through_the_text_layer():
    calls = [_context([_row(f"{STEM}.pdf", has_text=True)]), _sidecar(f"uploads/{STEM}.pdf.txt")]
    expect_passes(lambda: check_upload_read({}, calls, [], PDF_TEST))


def test_upload_read_fires_on_form_1_read_with_read():
    """The harness's project folder holds the layer, so a relative `Read` works
    there and nowhere hosted."""
    calls = [_context([_row(f"{STEM}.pdf", has_text=True)])]
    builtins = [_builtin("Read", file_path=f"uploads/{STEM}.pdf.txt")]
    expect_fires(lambda: check_upload_read({}, calls, builtins, PDF_TEST), "no sidecar_read")
    expect_fires(lambda: check_upload_read({}, calls, builtins, PDF_TEST), "reads an upload as a file")


def test_upload_read_fires_on_form_1_transcribed_instead():
    calls = [
        _context([_row(f"{STEM}.pdf", has_text=True)]),
        _transcribe(f"uploads/{STEM}.pdf"),
        _sidecar(STAGED),
    ]
    expect_fires(lambda: check_upload_read({}, calls, [], PDF_TEST), rf"no sidecar_read of 'uploads/{STEM}\.pdf\.txt'")


@pytest.mark.parametrize(
    "read",
    [_sidecar(f"uploads/{STEM}.txt"), _sidecar(refs=[f"uploads/{STEM}.txt"]), _sidecar(refs=json.dumps([f"uploads/{STEM}.txt"]))],
    ids=["ref", "refs", "stringified_refs"],
)
def test_upload_read_passes_form_2(read):
    calls = [_context([_row(f"{STEM}.txt")]), read]
    expect_passes(lambda: check_upload_read({}, calls, [], TXT_TEST))


def test_upload_read_fires_on_form_2_read_through_a_missing_layer():
    calls = [_context([_row(f"{STEM}.txt")]), _sidecar(f"uploads/{STEM}.txt.txt")]
    expect_fires(lambda: check_upload_read({}, calls, [], TXT_TEST), "no sidecar_read")


def test_upload_read_passes_form_3_with_the_staged_page_read():
    calls = [_context([_row(f"{STEM}.png")]), _transcribe(f"uploads/{STEM}.png"), _sidecar(STAGED)]
    expect_passes(lambda: check_upload_read({}, calls, [], PNG_TEST))


def test_upload_read_fires_on_form_3_when_the_staged_page_is_unread():
    """The digest's excerpt is the first 300 characters, so the page itself is
    read from the staged ref."""
    calls = [_context([_row(f"{STEM}.png")]), _transcribe(f"uploads/{STEM}.png")]
    expect_fires(lambda: check_upload_read({}, calls, [], PNG_TEST), "never read")


def test_upload_read_fires_on_form_3_never_transcribed():
    calls = [_context([_row(f"{STEM}.png")]), _sidecar(f"uploads/{STEM}.png")]
    expect_fires(lambda: check_upload_read({}, calls, [], PNG_TEST), "no image_transcribe")


def test_upload_read_passes_a_refused_transcription():
    """A refusal stages nothing (the mock stages only a successful page), so no
    `sidecar_read` is owed: the agent asks for the results text instead."""
    refusal = {"error": "No OpenRouter API key is configured."}
    calls = [_context([_row(f"{STEM}.png")]), _transcribe(f"uploads/{STEM}.png", refusal)]
    expect_passes(lambda: check_upload_read({}, calls, [], PNG_TEST))


def test_upload_read_follows_sidecar_read_when_no_row_names_the_upload():
    test = _triage_test("uploads/census-page-2.pdf")
    calls = [_context([_row(f"{STEM}.pdf", has_text=True)])]
    expect_fires(lambda: check_upload_read({}, calls, [], test), "no sidecar_read of 'uploads/census-page-2.pdf'")
    expect_passes(lambda: check_upload_read({}, calls + [_sidecar("uploads/census-page-2.pdf")], [], test))


@pytest.mark.parametrize(
    "builtin",
    [
        _builtin("Read", file_path="C:\\Temp\\eval-ul1\\uploads\\ma-1855-census-josiah-barnes.pdf.txt"),
        _builtin("Glob", pattern="uploads/*"),
        _builtin("Grep", pattern="Josiah", path="uploads/"),
    ],
    ids=["windows_read", "glob", "grep"],
)
def test_upload_read_fires_on_any_builtin_reach_into_uploads(builtin):
    """Even beside the right `sidecar_read`: the file is not there hosted."""
    calls = [_context([_row(f"{STEM}.pdf", has_text=True)]), _sidecar(f"uploads/{STEM}.pdf.txt")]
    expect_fires(lambda: check_upload_read({}, calls, [builtin], PDF_TEST), "reads an upload as a file")


def test_upload_read_ignores_a_grep_whose_pattern_names_uploads():
    """A Grep `pattern` is what it searches for, not where."""
    calls = [_context([_row(f"{STEM}.pdf", has_text=True)]), _sidecar(f"uploads/{STEM}.pdf.txt")]
    builtins = [_builtin("Grep", pattern="uploads/", path="research.json")]
    expect_passes(lambda: check_upload_read({}, calls, builtins, PDF_TEST))


def test_upload_read_skips_folder_mode():
    """No `uploadUrl`: the agent `Read`s the path, as on the desktop."""
    calls = [_context([_row(f"{STEM}.pdf", has_text=True)], upload_url=None)]
    builtins = [_builtin("Read", file_path=f"uploads/{STEM}.pdf")]
    with pytest.raises(pytest.skip.Exception, match="no uploadUrl"):
        check_upload_read({}, calls, builtins, PDF_TEST)


def test_upload_read_skips_a_delegation_naming_no_upload():
    with pytest.raises(pytest.skip.Exception, match="names no uploads"):
        check_upload_read({}, [_context()], [], _asks())


#: A real upload name's shape (feedback #4208): the web tier's `safe_upload_name`
#: keeps spaces.
SPACED = "Massachusetts_ U.S._ Wills and Probate Records_ 1635-1991 - Ancestry.com.pdf"
PROSE = "(uploads/old-ancestry.pdf was the Ancestry search, already triaged)"


@pytest.mark.parametrize(
    "delegation, name",
    [
        (f"capture: uploads/{SPACED}", SPACED),
        (f"capture: `uploads/{SPACED}`", SPACED),
        (f"capture: **uploads/{STEM}.pdf**", f"{STEM}.pdf"),
        (f"**capture:** _uploads/{STEM}.pdf_", f"{STEM}.pdf"),
        (f'- `capture`: "uploads/{STEM}.pdf".', f"{STEM}.pdf"),
        (f"capture: {PROJ}/uploads/{STEM}.pdf\r\nuserPresent: yes", f"{STEM}.pdf"),
        (f"capture: C:\\Temp\\eval-ul1\\uploads\\{STEM}.pdf", f"{STEM}.pdf"),
        (f"capture: C:/Users/me/My uploads/project/uploads/{STEM}.pdf", f"{STEM}.pdf"),
        (f"{PROSE}\ncapture: uploads/{STEM}.pdf", f"{STEM}.pdf"),
        (f"capture: uploads/{STEM}.pdf\n{PROSE}", f"{STEM}.pdf"),
        (f"The researcher uploaded uploads/{STEM}.pdf.", f"{STEM}.pdf"),
        (f"The researcher uploaded **uploads/{STEM}.pdf**", f"{STEM}.pdf"),
        (f"capture: the results text above\n{PROSE}", None),
        ("capture: results/myuploads/x.pdf", None),
        ("Search MyHeritage for Josiah Barnes.", None),
    ],
    ids=[
        "spaced", "spaced_backticks", "bold", "bold_key_italic_value", "listed_quoted",
        "project_path_crlf", "windows_path", "uploads_in_the_folder_path", "prose_upload_before", "prose_upload_after",
        "no_field_token", "no_field_bold_token", "field_names_no_upload", "not_an_uploads_segment",
        "no_capture",
    ],
)
def test_capture_upload_reads_only_the_capture(delegation, name):
    from test_search_external_sites import _capture_upload

    assert _capture_upload(delegation) == name


def test_upload_read_reads_a_spaced_name_whole():
    """The name parsed at the first space read `uploads/Massachusetts_`, and so
    failed every correct run on a real upload's name."""
    test = _triage_test(f"uploads/{SPACED}")
    calls = [_context([_row(SPACED, has_text=True)])]
    expect_passes(lambda: check_upload_read({}, calls + [_sidecar(f"uploads/{SPACED}.txt")], [], test))
    expect_fires(lambda: check_upload_read({}, calls, [], test), re.escape(f"no sidecar_read of 'uploads/{SPACED}.txt'"))


def test_upload_read_reads_a_bold_capture():
    test = _triage_test(f"**uploads/{STEM}.pdf**")
    calls = [_context([_row(f"{STEM}.pdf", has_text=True)])]
    expect_passes(lambda: check_upload_read({}, calls + [_sidecar(f"uploads/{STEM}.pdf.txt")], [], test))
    expect_fires(lambda: check_upload_read({}, calls, [], test), rf"no sidecar_read of 'uploads/{STEM}\.pdf\.txt'")


def test_upload_read_judges_only_the_capture_not_an_upload_in_prose():
    test = dict(PDF_TEST, delegation=f"{PROSE}\n" + PDF_TEST["delegation"])
    calls = [_context([_row(f"{STEM}.pdf", has_text=True), _row("old-ancestry.pdf", has_text=True)])]
    expect_passes(lambda: check_upload_read({}, calls + [_sidecar(f"uploads/{STEM}.pdf.txt")], [], test))
    expect_fires(
        lambda: check_upload_read({}, calls + [_sidecar("uploads/old-ancestry.pdf.txt")], [], test),
        rf"no sidecar_read of 'uploads/{STEM}\.pdf\.txt'",
    )


LONGER_PATHS = [f"./uploads/{STEM}.png", f"{PROJ}/uploads/{STEM}.png", f"{PROJ[1:]}/uploads/{STEM}.png"]


@pytest.mark.parametrize("file", LONGER_PATHS, ids=["dot", "absolute", "project_relative"])
def test_upload_read_sees_a_transcription_by_a_longer_path(file):
    """The mock transcribes these as readily as `uploads/<name>`; production
    refuses them before any OCR, so the staged page could not exist there."""
    calls = [_context([_row(f"{STEM}.png")]), _transcribe(file), _sidecar(STAGED)]
    expect_fires(lambda: check_upload_read({}, calls, [], PNG_TEST), "production refuses it")
    expect_fires(lambda: check_upload_read({}, calls[:2], [], PNG_TEST), "never read")


def test_upload_read_passes_a_refused_transcription_by_a_longer_path_then_the_ref():
    refusal = {"error": "`file` './uploads/x.png' has an empty, '.' or '..' segment."}
    calls = [
        _context([_row(f"{STEM}.png")]),
        _transcribe(f"./uploads/{STEM}.png", refusal),
        _transcribe(f"uploads/{STEM}.png"),
        _sidecar(STAGED),
    ]
    expect_passes(lambda: check_upload_read({}, calls, [], PNG_TEST))


def test_upload_read_does_not_count_a_sidecar_read_by_a_longer_path():
    """`sidecar_read` refuses `./uploads/x` in the harness as in production, so
    only the exact ref is a read."""
    calls = [_context([_row(f"{STEM}.pdf", has_text=True)]), _sidecar(f"./uploads/{STEM}.pdf.txt")]
    expect_fires(lambda: check_upload_read({}, calls, [], PDF_TEST), "no sidecar_read")


# --- V5: a refused transcription leaves the hand-off open ----------------


def _open_log():
    return [_handoff("log_001", "partial", OPEN_URL, False)]


def test_refused_open_passes_when_nothing_is_logged():
    before, after = _states(before_log=_open_log(), after_log=_open_log())
    expect_passes(lambda: check_refused_open(before, after, REFUSED))


def test_refused_open_fires_on_a_closing_entry():
    before, after = _states(
        before_log=_open_log(), after_log=_open_log() + [_handoff("log_002", "positive", OPEN_URL, True)]
    )
    expect_fires(lambda: check_refused_open(before, after, REFUSED), "capture as received")


def test_refused_open_fires_on_a_nil_that_closes_the_row():
    """A `negative` entry on the URL closes it in `awaitingUser` as surely."""
    before, after = _states(
        before_log=_open_log(), after_log=_open_log() + [_handoff("log_002", "negative", OPEN_URL, False)]
    )
    expect_fires(lambda: check_refused_open(before, after, REFUSED), "were closed")


def test_refused_open_flags_a_scenario_with_no_open_handoff():
    before, after = _states()
    expect_fires(lambda: check_refused_open(before, after, REFUSED), "fixture defect")


def test_refused_open_skips_untagged_tests():
    before, after = _states(before_log=_open_log(), after_log=_open_log())
    with pytest.raises(pytest.skip.Exception, match="not a transcribe-refused-stays-open"):
        check_refused_open(before, after, TRIAGE)


def test_positive_log_check_skips_a_refused_transcription():
    """V5 asserts the opposite there."""
    before, after = _states(before_log=_open_log(), after_log=_open_log())
    with pytest.raises(pytest.skip.Exception, match="refused transcription"):
        check_positive_log(before, after, REFUSED)


def test_positive_log_check_still_fires_without_the_tag():
    before, after = _states(before_log=_open_log(), after_log=_open_log())
    expect_fires(lambda: check_positive_log(before, after, TRIAGE), "at least one new log entry")


# --- V6: a folder-mode upload is read with Read ---------------------------

WORKSPACE = "C:/Users/Dell/AppData/Local/Temp/eval-ut_search_external_sites_ulf-0-0-65ogb6g8"
FOLDER_TEST = dict(TXT_TEST, delegation=TXT_TEST["delegation"].replace(PROJ, WORKSPACE))
FOLDER = [_context([_row(f"{STEM}.txt")], upload_url=None)]
HELD = {"files": {f"uploads/{STEM}.txt": "1855 census"}}


@pytest.mark.parametrize(
    "path",
    [
        f"{WORKSPACE}/uploads/{STEM}.txt",
        f"{WORKSPACE}/uploads/{STEM}.txt".replace("/", "\\"),
        f"uploads/{STEM}.txt",
        f"C:/Users/me/uploads/project/uploads/{STEM}.txt",
    ],
    ids=["absolute", "windows", "relative", "uploads_in_the_workspace_path"],
)
def test_folder_read_passes_a_read_of_the_capture(path):
    expect_passes(lambda: check_folder_read(HELD, FOLDER, [_builtin("Read", file_path=path)], FOLDER_TEST))


def test_folder_read_judges_a_run_that_never_called_project_context():
    builtins = [_builtin("Read", file_path=f"{WORKSPACE}/uploads/{STEM}.txt")]
    expect_passes(lambda: check_folder_read(HELD, [], builtins, FOLDER_TEST))
    expect_fires(lambda: check_folder_read(HELD, [], [], FOLDER_TEST), "no built-in Read")


@pytest.mark.parametrize(
    "path",
    [f"{WORKSPACE}/uploads/{STEM}.txt.txt", f"{WORKSPACE}/myuploads/{STEM}.txt", f"{WORKSPACE}/research.json"],
    ids=["another_file", "not_an_uploads_segment", "unrelated"],
)
def test_folder_read_fires_on_a_read_of_something_else(path):
    expect_fires(
        lambda: check_folder_read(HELD, FOLDER, [_builtin("Read", file_path=path)], FOLDER_TEST), "no built-in Read"
    )


@pytest.mark.parametrize(
    "call, match",
    [
        (_sidecar(f"uploads/{STEM}.txt"), "sidecar_read of"),
        (_sidecar(refs=[f"./uploads/{STEM}.txt"]), "sidecar_read of"),
        (_sidecar(f"uploads/{STEM}.txt.txt"), "sidecar_read of"),
        (_transcribe(f"uploads/{STEM}.txt"), "image_transcribe of"),
        (_transcribe(f"{WORKSPACE}/uploads/{STEM}.txt"), "image_transcribe of"),
    ],
    ids=["sidecar", "sidecar_by_a_longer_path", "sidecar_on_a_layer", "transcribe", "transcribe_by_a_longer_path"],
)
def test_folder_read_fires_on_the_tools_even_beside_the_read(call, match):
    builtins = [_builtin("Read", file_path=f"{WORKSPACE}/uploads/{STEM}.txt")]
    expect_fires(lambda: check_folder_read(HELD, FOLDER + [call], builtins, FOLDER_TEST), match)


def test_folder_read_ignores_the_tools_on_another_file():
    builtins = [_builtin("Read", file_path=f"{WORKSPACE}/uploads/{STEM}.txt")]
    calls = FOLDER + [_sidecar(STAGED), _sidecar("uploads/notes.txt"), _transcribe("uploads/census-page-2.png")]
    expect_passes(lambda: check_folder_read(HELD, calls, builtins, FOLDER_TEST))


def test_folder_read_matches_a_path_cut_at_the_argument_cap():
    """The run log keeps 200 characters of a `Read` path; a long workspace and a
    spaced name can run past that."""
    from harness.skill_runner import BUILTIN_ARG_TRUNCATE

    test = _triage_test(f"uploads/{SPACED}")
    held = {"files": {f"uploads/{SPACED}": "<binary>"}}
    workspace = "C:/Users/Dell/AppData/Local/Temp/" + "eval-" + "x" * 120
    cut = f"{workspace}/uploads/{SPACED}"[:BUILTIN_ARG_TRUNCATE]
    assert len(cut) == BUILTIN_ARG_TRUNCATE and f"/uploads/{SPACED}" not in cut
    expect_passes(lambda: check_folder_read(held, FOLDER, [_builtin("Read", file_path=cut)], test))
    other = f"{workspace}/uploads/old-ancestry-search-{'y' * 80}.pdf"[:BUILTIN_ARG_TRUNCATE]
    expect_fires(lambda: check_folder_read(held, FOLDER, [_builtin("Read", file_path=other)], test), "no built-in Read")
    short = f"{WORKSPACE}/uploads/{SPACED[:20]}"
    expect_fires(lambda: check_folder_read(held, FOLDER, [_builtin("Read", file_path=short)], test), "no built-in Read")


def test_folder_read_skips_a_hosted_run():
    with pytest.raises(pytest.skip.Exception, match="V4 judges"):
        check_folder_read(HELD, [_context([_row(f"{STEM}.txt")])], [], FOLDER_TEST)


def test_folder_read_skips_a_delegation_naming_no_upload():
    with pytest.raises(pytest.skip.Exception, match="names no uploads"):
        check_folder_read(HELD, FOLDER, [], _asks())


def test_folder_read_flags_a_capture_the_scenario_does_not_hold():
    """Then a `Read` fails for want of the file, and the body's fallback to the
    tools would be right: the test is malformed, not the run."""
    expect_fires(lambda: check_folder_read({"files": {}}, FOLDER, [], FOLDER_TEST), "fixture defect")


# --- V1-V3 and V6 replayed over the committed run logs --------------------

_REPO = Path(__file__).resolve().parents[4]
_SUITE = "search-external-sites"


def _log_version(path):
    match = re.match(r"v(\d+)", path.name)
    return int(match.group(1)) if match else 0


#: From v8, the first logs whose agent ends its return with the researcher's
#: text after a final `---` (#4179): v1 and v2 have no tail at all, and v5's
#: `ut_search_external_sites_008` gave a user-reported nil no capture steps and
#: no link, a miss #1950 V4 grades the same way. Globbed, so rotation keeps it.
_UPLOAD_CORPUS = sorted(
    p for p in (_REPO / "eval/runlogs/unit" / _SUITE).glob("v*.json")
    if not p.name.endswith(".ann.json") and _log_version(p) >= 8
)


def _scenario_files(scenario):
    """The scenario's other files, keyed as a before-state snapshot keys them."""
    root = _REPO / "eval/fixtures/scenarios" / scenario if scenario else None
    if root is None or not root.is_dir():
        return {}
    return {
        rel: "<file>"
        for rel in (p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file())
        if rel not in ("research.json", "tree.gedcomx.json")
    }


def _replayed_runs():
    """(label, before, after, output, test) per committed run.

    The entries the run ADDED (`file_changes["research.json"].diff.log.added`)
    against an empty prior log, as `replay_log_query_validators.py` replays them,
    the scenario's own files (its uploads), and the delegation and tags from the
    test JSON, which a run log keeps none of.
    """
    specs = {}
    for path in (_REPO / "eval/tests/unit" / _SUITE).glob("*.json"):
        doc = json.loads(path.read_text(encoding="utf-8"))
        specs[doc["test"]["id"]] = doc
    for path in _UPLOAD_CORPUS:
        log = json.loads(path.read_text(encoding="utf-8"))
        for t in log.get("tests") or []:
            spec = specs.get(t.get("test_id")) or {}
            test = {
                "type": t.get("test_type"),
                "tags": (spec.get("test") or {}).get("tags") or [],
                "delegation": (spec.get("input") or {}).get("delegation"),
            }
            files = _scenario_files((spec.get("input") or {}).get("scenario"))
            for run in t.get("runs") or []:
                out = run.get("output") or {}
                change = (out.get("file_changes") or {}).get("research.json") or {}
                added = ((change.get("diff") or {}).get("log") or {}).get("added") or []
                yield (
                    f"{path.name} {t.get('test_id')} run {run.get('run_index')}",
                    {"research_json": {"log": []}, "files": files},
                    {"research_json": {"log": added}},
                    out,
                    test,
                )


def _replay_wording(before, after, out, test, tool_calls=None, reply=None):
    returns = out.get("agent_returns") or []
    if reply is not None:
        returns = [dict(r, text=reply(r.get("text") or "")) if r.get("subagent_type") == _SUITE else r for r in returns]
    return check_upload_wording(
        before,
        after,
        (out.get("tool_calls") or []) if tool_calls is None else tool_calls,
        reply(out.get("text_response") or "") if reply is not None else (out.get("text_response") or ""),
        test,
        agent_returns=returns,
    )


_REPLAYED = {
    "V1": _replay_wording,
    "V2": lambda before, after, out, test: check_no_text_transcribe(before, out.get("tool_calls") or []),
    "V3": lambda before, after, out, test: check_capture_filename(before, after, out.get("tool_calls") or []),
    "V6": lambda before, after, out, test: check_folder_read(
        before, out.get("tool_calls") or [], out.get("builtin_tool_calls") or [], test
    ),
}


@pytest.mark.skipif(not _UPLOAD_CORPUS, reason="no committed search-external-sites run log from v8 on")
@pytest.mark.parametrize("check", sorted(_REPLAYED))
def test_upload_checks_pass_every_committed_run(check):
    """No committed run fires V1-V3 or V6. V1 is the folder-mode guard: every
    hand-off and nil report in the corpus ran with no `uploadUrl`, so each must
    still say "upload" and link no upload page, and every other reply links none
    — measured 69 judged runs (60 hand-offs or nil reports, 9 judged on the
    unserved-link arm alone), 0 fired, 0 skipped, over the three v8 logs
    (2026-11-08). V2, V3 and V6 judge no v8 run (none read an upload) and are
    replayed so a later log that does is held to them."""
    judged, fired = 0, []
    for label, before, after, out, test in _replayed_runs():
        try:
            _REPLAYED[check](before, after, out, test)
        except pytest.skip.Exception:
            continue
        except AssertionError as e:
            fired.append(f"{label}: {e}")
        judged += 1
    assert not fired, f"{check} fires on committed runs:\n" + "\n".join(fired)
    if check == "V1":
        assert judged >= 10, f"V1 judged only {judged} committed runs; its gate over-matches"


@pytest.mark.skipif(not _UPLOAD_CORPUS, reason="no committed search-external-sites run log from v8 on")
def test_upload_wording_fires_on_a_link_planted_in_a_committed_run():
    """The other direction on real data: the first committed hand-off V1 passes,
    with a researcher present and no `uploadUrl` served, fires once an upload
    link is planted in its tail, fires once that link is served and the tail
    left as it was, and passes with the link both served and given."""
    from test_search_external_sites import _USER_ABSENT, _handoff_entries, _served_upload_urls

    def _clean(run):
        _, before, after, out, test = run
        if _served_upload_urls(out.get("tool_calls")) or _USER_ABSENT.search(str(test.get("delegation") or "")):
            return False
        if not _handoff_entries(before, after):
            return False
        try:
            _replay_wording(before, after, out, test)
        except pytest.skip.Exception:
            return False
        return True

    run = next((r for r in _replayed_runs() if _clean(r)), None)
    assert run is not None, "no committed hand-off to plant in"
    label, before, after, out, test = run
    plant = lambda text: f"{text}\nOr upload it at {UPLOAD_URL}"  # noqa: E731
    served = (out.get("tool_calls") or []) + [_context()]
    expect_fires(lambda: _replay_wording(before, after, out, test, reply=plant), "did not serve")
    expect_fires(lambda: _replay_wording(before, after, out, test, tool_calls=served), "never gives it")
    expect_passes(lambda: _replay_wording(before, after, out, test, tool_calls=served, reply=plant))


@pytest.mark.skipif(not _UPLOAD_CORPUS, reason="no committed search-external-sites run log from v8 on")
def test_upload_wording_fires_on_a_link_planted_in_a_committed_reply_with_no_handoff():
    """The unserved-link arm on real data, where the other two do not run: the
    first committed run V1 passes with no hand-off or nil report fires once an
    upload link is planted in its tail, and passes once that link is served."""
    from test_search_external_sites import _handoff_entries, _served_upload_urls

    def _clean(run):
        _, before, after, out, test = run
        if _served_upload_urls(out.get("tool_calls")) or _handoff_entries(before, after):
            return False
        try:
            _replay_wording(before, after, out, test)
        except pytest.skip.Exception:
            return False
        return True

    run = next((r for r in _replayed_runs() if _clean(r)), None)
    assert run is not None, "no committed reply without a hand-off to plant in"
    label, before, after, out, test = run
    plant = lambda text: f"{text}\nThen upload the record page at {UPLOAD_URL}"  # noqa: E731
    served = (out.get("tool_calls") or []) + [_context()]
    expect_fires(lambda: _replay_wording(before, after, out, test, reply=plant), "did not serve")
    expect_passes(lambda: _replay_wording(before, after, out, test, tool_calls=served))
    expect_passes(lambda: _replay_wording(before, after, out, test, tool_calls=served, reply=plant))


# --- blm-outside-coverage: the refusal is the answer (#4402) ---------------

BLM_REFUSAL = {"type": "positive", "tags": ["blm-outside-coverage"]}


def _blm_call(response, **args):
    return {
        "tool": "mcp__genealogy__build_external_search_url",
        "args": {"site": "blm_glo", "attributes": {"surname": "Flynn", "usState": "Pennsylvania"}, **args},
        "response": response,
    }


REFUSED_BUILD = _blm_call({"ok": False, "reason": "outside_coverage", "errors": ["Pennsylvania is not a public-land state"]})
NATIONWIDE_BUILD = _blm_call(
    {"ok": True, "url": "https://glorecords.blm.gov/s/advanced-search?searchTerm=x", "access": "free"},
    attributes={"surname": "Flynn"},
)


def test_blm_refusal_passes_when_the_refusal_stands_and_nothing_is_logged():
    before, after = _states(before_log=_open_log(), after_log=_open_log())
    expect_passes(lambda: check_blm_refusal(before, after, [REFUSED_BUILD], BLM_REFUSAL))


def test_blm_refusal_fires_when_a_nationwide_build_follows_the_refusal():
    before, after = _states(before_log=_open_log(), after_log=_open_log())
    expect_fires(
        lambda: check_blm_refusal(before, after, [REFUSED_BUILD, NATIONWIDE_BUILD], BLM_REFUSAL),
        "went through after the refusal",
    )


def test_blm_refusal_fires_when_the_refused_search_is_logged():
    logged = {
        "id": "log_002", "tool": "external_site", "outcome": "negative",
        "external_site": {"site": "blm_glo", "url_generated": "https://glorecords.blm.gov/s/", "capture_received": False},
    }
    before, after = _states(before_log=_open_log(), after_log=_open_log() + [logged])
    expect_fires(
        lambda: check_blm_refusal(before, after, [REFUSED_BUILD], BLM_REFUSAL), "record a blm_glo search"
    )


def test_blm_refusal_fires_when_blm_glo_was_never_called():
    archives = {
        "tool": "mcp__genealogy__build_external_search_url",
        "args": {"site": "archives_gov", "attributes": {"surname": "Flynn"}},
        "response": {"ok": True, "url": "https://catalog.archives.gov/search?q=Flynn"},
    }
    before, after = _states(before_log=_open_log(), after_log=_open_log())
    expect_fires(
        lambda: check_blm_refusal(before, after, [archives], BLM_REFUSAL), "no blm_glo build was refused"
    )


def test_blm_refusal_skips_untagged_tests():
    before, after = _states(before_log=_open_log(), after_log=_open_log())
    with pytest.raises(pytest.skip.Exception, match="not a blm-outside-coverage"):
        check_blm_refusal(before, after, [REFUSED_BUILD], POSITIVE)


def test_positive_log_check_skips_a_blm_refusal():
    """The refusal check asserts the opposite there."""
    before, after = _states(before_log=_open_log(), after_log=_open_log())
    with pytest.raises(pytest.skip.Exception, match="refused build"):
        check_positive_log(before, after, BLM_REFUSAL)


def test_blm_refusal_fires_when_the_refusal_is_for_another_reason():
    """A `no_attributes` refusal (no name passed) is not the state-land answer."""
    no_name = _blm_call({"ok": False, "reason": "no_attributes", "errors": ["blm_glo needs a surname or given name"]})
    before, after = _states(before_log=_open_log(), after_log=_open_log())
    expect_fires(
        lambda: check_blm_refusal(before, after, [no_name], BLM_REFUSAL), "no blm_glo build was refused"
    )


def test_blm_refusal_fires_when_the_refused_state_is_retried_and_built():
    retried = _blm_call({"ok": True, "url": "https://glorecords.blm.gov/s/advanced-search?searchTerm=y"})
    before, after = _states(before_log=_open_log(), after_log=_open_log())
    expect_fires(
        lambda: check_blm_refusal(before, after, [REFUSED_BUILD, retried], BLM_REFUSAL), "for the same land"
    )


def test_blm_refusal_passes_a_build_for_another_state():
    """A public-land state the person lived in is a separate search."""
    ohio = _blm_call(
        {"ok": True, "url": "https://glorecords.blm.gov/s/advanced-search?searchTerm=oh"},
        attributes={"surname": "Flynn", "usState": "Ohio"},
    )
    before, after = _states(before_log=_open_log(), after_log=_open_log())
    expect_passes(lambda: check_blm_refusal(before, after, [REFUSED_BUILD, ohio], BLM_REFUSAL))


def test_blm_refusal_passes_a_nationwide_build_before_the_refusal():
    before, after = _states(before_log=_open_log(), after_log=_open_log())
    expect_passes(lambda: check_blm_refusal(before, after, [NATIONWIDE_BUILD, REFUSED_BUILD], BLM_REFUSAL))


def test_blm_refusal_passes_a_logged_follow_up_search_on_another_site():
    """Routing to the county deed records may build and log another site's search."""
    deeds = {
        "id": "log_002", "tool": "external_site", "outcome": "partial",
        "external_site": {"site": "familysearch_web", "url_generated": "https://www.familysearch.org/search/catalog", "capture_received": False},
    }
    before, after = _states(before_log=_open_log(), after_log=_open_log() + [deeds])
    expect_passes(lambda: check_blm_refusal(before, after, [REFUSED_BUILD], BLM_REFUSAL))

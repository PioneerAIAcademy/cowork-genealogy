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
    before, after = _states(after_log=[_site_entry()])
    expect_passes(lambda: check_v4(before, after, f"Open this in your browser: {URL}", POSITIVE))


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
    return. Reading `text_response` there would fire on a correct run."""
    before, after = _states(after_log=[_site_entry()])
    returns = [{"subagent_type": "search-external-sites", "text": f"Search link: {URL}"}]
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

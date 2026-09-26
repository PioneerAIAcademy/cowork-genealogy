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


# --- V2: the two entries must not carry each other's fields ------------


def test_v2_fires_when_a_links_entry_carries_external_site():
    before, after = _states(after_log=[_links_entry(external_site={"site": "ancestry"})])
    expect_fires(lambda: check_v2(before, after, POSITIVE), "carries external_site")


def test_v2_fires_when_a_site_entry_carries_the_staged_handle():
    """The `results_ref` half. If this name were transcribed as
    `staged_results_ref` from the issue, this test would be the only thing in
    the repo that noticed."""
    before, after = _states(after_log=[_site_entry(results_ref="results/log_010.json")])
    expect_fires(lambda: check_v2(before, after, POSITIVE), "carries results_ref")


def test_v2_quiet_on_the_correct_pair():
    before, after = _states(after_log=[_links_entry(), _site_entry()])
    expect_passes(lambda: check_v2(before, after, POSITIVE))


def test_v2_treats_explicit_null_as_not_carrying():
    """Both fields are nullable in the schema. `results_ref: null` on a site
    entry is the correct shape, not a violation."""
    before, after = _states(
        after_log=[_links_entry(external_site=None), _site_entry(results_ref=None)]
    )
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
# is invisible everywhere else: `make harness-test` collects 4,749 tests and
# zero from `validators/`, and a validator only ever executes inside a paid
# `make eval-skill`. Both directions are asserted, and the three breaks the
# card asks for are the three input shapes below (no trace / None url / int
# vs str cid) rather than scope changes, which exit 0 having done nothing.

COLLECTION_URL = "https://www.ancestry.com/search/collections/8054/?name=Patrick_Flynn"


def _collection_site_entry(entry_id="log_011", url=COLLECTION_URL, **over):
    """A URL-generation entry whose URL is collection-scoped."""
    return _site_entry(entry_id, external_site={
        "site": "ancestry", "url_generated": url, "capture_received": False,
    }, **over)


def _research(log, plans=None, **sections):
    plans = plans if plans is not None else _plan([_item()])
    return {"research_json": {"log": list(log), "plans": plans, **sections}}


def test_2521_fires_when_the_collection_id_is_backed_by_nothing():
    """Break 1: the id appears nowhere but the entry that emitted the URL.

    This is `wardell-parents` 7602 reduced — its only two occurrences in the
    whole document are `log[10].query.collectionId` and
    `log[10].external_site.url_generated`, both inside the owner entry.
    """
    after = _research([_collection_site_entry()])
    expect_fires(lambda: check_2521({}, after, POSITIVE), "collection 8054")


def test_2521_does_not_count_the_owner_entrys_own_collection_id_field():
    """The defect this predicate exists to avoid.

    `research_log_append` writes `query.collectionId` into the SAME entry that
    carries `url_generated`. Counting it makes every id self-backing and the
    check vacuous — it scored 7602 as backed on the first measurement.
    """
    after = _research([_collection_site_entry(query={"collectionId": "8054"})])
    expect_fires(lambda: check_2521({}, after, POSITIVE), "collection 8054")


def test_2521_quiet_when_a_plan_item_rationale_names_the_collection():
    """Accept direction 1 — `wardell-parents` 62303, which DOES trace."""
    items = [_item()]
    items[0]["rationale"] = "Ancestry collection 8054 (1850 census) indexes the household."
    after = _research([_collection_site_entry()], plans=_plan(items))
    expect_passes(lambda: check_2521({}, after, POSITIVE))


def test_2521_quiet_when_an_assertion_record_id_carries_the_collection():
    """Accept direction 2 — the `mid-research-flynn` scenario's real shape.

    That fixture carries `collections/8054` at research.json:188 (the owner
    entry) and `"record_id": "ancestry:8054:patrick-flynn-1850"` at :546 and
    :566 under `assertions`. The accept direction works through `assertions`,
    which is why it is a trace section.
    """
    after = _research(
        [_collection_site_entry()],
        assertions=[{"id": "a_001", "record_id": "ancestry:8054:patrick-flynn-1850"}],
    )
    expect_passes(lambda: check_2521({}, after, POSITIVE))


def test_2521_ignores_a_bare_number_with_no_collection_context():
    """`pedro-chaves-spouse` 1831 reduced: the only other occurrence is
    `query.birthYearFrom: 1831`, a birth year. A digit match with no
    collection-naming context is a coincidence, not a backing."""
    after = _research(
        [_collection_site_entry(url="https://www.ancestry.com/search/collections/1831/?name=X"),
         _links_entry("log_009", query={"birthYearFrom": "1831"})],
    )
    expect_fires(lambda: check_2521({}, after, POSITIVE), "collection 1831")


def test_2521_does_not_accept_a_downstream_narrative_mention():
    """`rejnic-burial` 7115: traced only in `questions` and `proof_summaries`,
    both written after the search. A mention there restates the URL rather
    than recording where the collection came from."""
    after = _research(
        [_collection_site_entry()],
        proof_summaries=[{"id": "ps_001", "narrative_markdown": "Ancestry collection 8054 was searched."}],
    )
    expect_fires(lambda: check_2521({}, after, POSITIVE), "collection 8054")


def test_2521_survives_a_null_url_generated():
    """Break 2: `url_generated: None`.

    Paired with a real backed entry on purpose. A null-only run has nothing of
    this shape to judge and correctly skips, which `expect_passes` would fail —
    so asserting on the null alone would test the skip gate, not the null
    handling. Here the null must neither crash nor suppress the sibling.
    """
    items = [_item()]
    items[0]["rationale"] = "Ancestry collection 8054 indexes the household."
    after = _research(
        [_site_entry("log_010", external_site={
            "site": "ancestry", "url_generated": None, "capture_received": False}),
         _collection_site_entry("log_011")],
        plans=_plan(items),
    )
    expect_passes(lambda: check_2521({}, after, POSITIVE))


def test_2521_skips_a_run_whose_only_url_is_null():
    """The other half of break 2: nothing to judge is a skip, not a pass."""
    after = _research([_site_entry("log_011", external_site={
        "site": "ancestry", "url_generated": None, "capture_received": False})])
    with pytest.raises(pytest.skip.Exception):
        check_2521({}, after, POSITIVE)


def test_2521_matches_an_integer_collection_id_written_as_a_number():
    """Break 3: the id is a JSON number, not a string.

    The earlier version of this test asserted on `results_examined=8054`, whose
    value carries no collection context — so it passed whether the walk coerced
    ints or not, and a mutation that stringified every leaf left all 31 tests
    green. The break has to run through the arm that reads a NON-string: a
    `collectionId` field holding the integer 8054 backs the id (the field name
    is the context), while the same integer in a field that is not a collection
    id does not.
    """
    backed = _research([_collection_site_entry(),
                        _links_entry("log_009", query={"collectionId": 8054})])
    expect_passes(lambda: check_2521({}, backed, POSITIVE))
    unbacked = _research([_collection_site_entry(),
                          _links_entry("log_009", results_examined=8054)])
    expect_fires(lambda: check_2521({}, unbacked, POSITIVE), "collection 8054")


def test_2521_judges_only_the_entries_this_run_appended():
    """Every positive test in the suite runs on a scenario whose seeded log
    already carries `collections/8054`. Reading the whole after-state made the
    check judge a URL the agent never wrote, on every one of them."""
    seeded = [_collection_site_entry("log_002")]
    before = {"research_json": {"log": list(seeded), "plans": _plan([_item()])}}
    after = _research(seeded)          # same entry, nothing appended
    with pytest.raises(pytest.skip.Exception):
        check_2521(before, after, POSITIVE)


def test_2521_does_not_crash_on_a_malformed_log_entry():
    """A crash is NOT a tier-2 observation. `validator_runner` builds a crash
    result without `reporting_only` — "a crash is a validator bug, so it gates
    whatever the prefix" — so an unguarded `.get()` here gates a paid eval on
    the measure-only check ruling C forbids gating."""
    after = _research([None, _collection_site_entry()])
    expect_fires(lambda: check_2521({}, after, POSITIVE), "collection 8054")
    stringified = _research([{"id": "log_010", "external_site": '{"site": "ancestry"}'},
                             _collection_site_entry()])
    expect_fires(lambda: check_2521({}, stringified, POSITIVE), "collection 8054")


def test_2521_a_second_url_on_the_same_collection_does_not_back_the_first():
    """The repeat-search case the check exists for: one run searching a
    collection for two people, or regenerating a URL after a failed capture.
    Excluding only the owner entry let the two back each other."""
    after = _research([_collection_site_entry("log_011"),
                       _collection_site_entry("log_012")])
    expect_fires(lambda: check_2521({}, after, POSITIVE), "collection 8054")


def test_2521_matches_a_capitalised_host():
    """Case A base URLs arrive verbatim from curated links and are never
    re-encoded, so the casing is the curator's. A case-sensitive pattern made
    the whole check skip, which is invisible in a tier-2 run log."""
    after = _research([_collection_site_entry(
        url="https://www.Ancestry.com/search/collections/8054/?name=X")])
    expect_fires(lambda: check_2521({}, after, POSITIVE), "collection 8054")


def test_2521_requires_the_collection_word_adjacent_to_the_id():
    """"Collection of 8054 letters" is a count, not a collection id. Matching
    the token anywhere in the string accepted it, and so did a 24-character
    window, because "Collection of " is 14 wide."""
    after = _research([_collection_site_entry()],
                      sources=[{"id": "s_1", "citation": "Collection of 8054 letters."}])
    expect_fires(lambda: check_2521({}, after, POSITIVE), "collection 8054")


def test_2521_requires_the_cid_in_the_record_id_collection_position():
    """`ancestry:1234:john-8054` is a record in collection 1234 whose slug ends
    in the digits of another collection — not a backing for 8054."""
    after = _research([_collection_site_entry()],
                      assertions=[{"id": "a_1", "record_id": "ancestry:1234:john-8054"}])
    expect_fires(lambda: check_2521({}, after, POSITIVE), "collection 8054")


def test_2521_accepts_a_structured_collection_id_field():
    """`research_log_append` writes `query.collectionId`. Matching prose only
    scored the field that actually records provenance as no provenance."""
    after = _research([_collection_site_entry(),
                       _links_entry("log_009", query={"collectionId": "8054"})])
    expect_passes(lambda: check_2521({}, after, POSITIVE))


def test_2521_is_tier_2_and_cannot_gate_a_run():
    """Ruling C says measure, do not enforce.

    Asserting `__name__.startswith("report_")` would only restate a spelling
    this module already imports by name. Assert the property instead: run it
    through the harness and require `reporting_only`, the same shape V6 uses.
    A rename to `test_` would silently start gating the skill's next paid eval
    on the 4 committed corpus instances.
    """
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
    assert got.reporting_only is True, (
        "the collection-provenance check is gating the run. Ruling C (lead, "
        "2026-09-24) is measure-first: the accept-set is re-decided on the "
        "count it produces, so it must stay `report_`-prefixed."
    )


def test_2521_skips_a_run_with_no_collection_scoped_url():
    """`ma-state-census-external` carries no collection URL at all, so the
    check must skip there rather than fire — a site-wide Ancestry template is
    the documented Case B path, not a defect."""
    after = _research([_site_entry()])  # site-wide URL, no /collections/
    with pytest.raises(pytest.skip.Exception):
        check_2521({}, after, POSITIVE)

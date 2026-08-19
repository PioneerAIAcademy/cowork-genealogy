"""Skill-specific validators for the search-full-text skill.

search-full-text queries the FamilySearch full-text MCP tool and logs
every search (positive, negative, partial). Narrative-quality dimensions
(query construction, FAN awareness, negative-result detail) live in the
rubric — graded by the LLM judge. The mechanical "did the skill record
a log entry of the right shape" checks live here.

See test_universal.py module docstring for the validator function-
signature contract. The `test` argument is the parsed test JSON dict
(the inner "test" block) — used to gate test-specific checks on
`test["tags"]`.
"""

from __future__ import annotations

import json

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


# --- Structural rules from SKILL.md -----------------------------------

def test_positive_appends_log_entry(before_state, after_state, test):
    """Positive search-full-text tests must append a log entry recording
    the search — including FAN searches. The skill's whole audit-trail role
    depends on this. The log's `tool` field should reference fulltext_search
    (the MCP tool used) so a future exhaustive-search declaration can
    cite the search."""
    if test.get("type") != "positive":
        pytest.skip("only positive tests record searches")
    if before_state.get("research_json") is None:
        pytest.skip("no research.json in scenario")
    new_entries = _new_log_entries(before_state, after_state)
    assert new_entries, "expected at least one new log entry recording the search"
    tools = [e.get("tool") for e in new_entries]
    assert any("fulltext" in (t or "") for t in tools), (
        f"expected a new log entry with a fulltext-shaped `tool`; got tools={tools}"
    )


# --- Tag-gated negative-result log shape -----------------------------

def test_negative_result_log_shape(before_state, after_state, test):
    """Tag-gated: when the test scenario probes negative-result handling, the
    new log entry must have `outcome: "negative"` and a non-empty `query`
    object describing what was searched. The narrative `notes` field — what
    collections, date ranges — is judge-graded under the Negative-result-
    handling rubric dim and not asserted here."""
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
                f"describing the search; got {query!r}"
            )
    assert matched, (
        f"no new log entry has outcome='negative'; "
        f"outcomes={[e.get('outcome') for e in new_entries]}"
    )
    assert not errors, "Negative-log-shape violations:\n  - " + "\n  - ".join(errors)


# --- Result sidecar retention ----------------------------------------

def _new_result_sidecars(before_state, after_state) -> dict:
    """results/ sidecar files present in after_state but not before, as
    {relative_path: file_content_string}."""
    before_files = (before_state or {}).get("files", {}) or {}
    after_files = (after_state or {}).get("files", {}) or {}
    return {
        path: content
        for path, content in after_files.items()
        if path.startswith("results/")
        and path.endswith(".json")
        and path not in before_files
    }


def test_sidecar_written_for_positive_fts(before_state, after_state, test):
    """Tag-gated (sidecar-write): a positive full-text search must retain its
    raw results — the new log entry carries a non-null results_ref, the
    named sidecar file is written, and its returned_count equals the
    payload's results length (the D2 integrity check)."""
    if "sidecar-write" not in test.get("tags", []):
        pytest.skip("not a sidecar-write scenario")
    new_entries = _new_log_entries(before_state, after_state)
    with_ref = [e for e in new_entries if e.get("results_ref")]
    assert with_ref, (
        "expected a new log entry with a non-null results_ref; new "
        f"entries: {[(e.get('id'), e.get('results_ref')) for e in new_entries]}"
    )
    sidecars = _new_result_sidecars(before_state, after_state)
    for e in with_ref:
        ref = e["results_ref"]
        assert ref in sidecars, (
            f"log entry {e.get('id')} references {ref}, but no such sidecar "
            f"was written; sidecars written: {sorted(sidecars)}"
        )
        sc = json.loads(sidecars[ref])
        results = (sc.get("payload") or {}).get("results")
        assert isinstance(results, list), f"{ref}: payload has no results array"
        assert sc.get("returned_count") == len(results), (
            f"{ref}: returned_count {sc.get('returned_count')} != "
            f"payload results length {len(results)}"
        )


# --- Log entries must trace to the call they document -----------------

# Structured `fulltext_search` params that are post-search filters per
# SKILL.md ("Search by name only first... Apply place as a post-search
# filter") and query-syntax.md ("Apply place and date via filters AFTER
# the initial search, not by typing into Place/Year fields").
FILTER_KEYS = (
    "recordPlace0", "recordPlace1", "recordPlace2", "recordPlace3",
    "recordType", "yearFrom", "yearTo", "collectionId",
)


def _fts_tool_calls(tool_calls):
    return [tc for tc in (tool_calls or []) if (tc.get("tool") or "").endswith("fulltext_search")]


def test_log_query_traces_to_fulltext_search_call(before_state, after_state, tool_calls):
    """A new fulltext_search log entry query must not record a
    recordPlace/yearFrom/yearTo/recordType/collectionId filter that was
    never sent in the fulltext_search call it documents (deep-dive #1651
    finding 1). Matched by keywords/nlQuery, the only stable handle a log
    entry and a tool call share; an entry whose keywords/nlQuery match no
    call this turn is left alone rather than guessed at."""
    new_entries = [e for e in _new_log_entries(before_state, after_state) if e.get("tool") == "fulltext_search"]
    if not new_entries:
        pytest.skip("no new fulltext_search log entries this turn")
    calls = _fts_tool_calls(tool_calls)
    if not calls:
        pytest.skip("no fulltext_search tool calls this turn")

    errors = []
    for entry in new_entries:
        query = entry.get("query") or {}
        handle = query.get("keywords") or query.get("nlQuery")
        matching = [
            c["args"] for c in calls
            if (c["args"].get("keywords") or c["args"].get("nlQuery")) == handle
        ]
        if not matching:
            continue
        for key in FILTER_KEYS:
            claimed = query.get(key)
            if claimed is None:
                continue
            if not any(args.get(key) == claimed for args in matching):
                errors.append(
                    f"log entry {entry.get('id')} (query {handle!r}) claims "
                    f"{key}={claimed!r}, but no fulltext_search call with that "
                    f"keywords/nlQuery sent it"
                )
    assert not errors, "Log entries claiming an unsent filter:\n  - " + "\n  - ".join(errors)


# --- First look at a query must be unscoped ----------------------------

def test_first_fulltext_search_call_is_unscoped(tool_calls):
    """SKILL.md step 4: Search by name only first; apply place as a
    post-search filter. The decision ladder in step 5 only ever adds a
    Year/RecordType/place filter once the unfiltered hit count is known
    (50-500 add Year/RecordType; over 500 add a second term or place) so
    the FIRST fulltext_search call in a turn must carry none of them
    (deep-dive #1651 finding 2). Checks only the literal first call, not
    every later first look at an independent target within the same turn
    (e.g. two names searched in parallel) -- a known narrower scope than
    the full rule, chosen to keep false positives at zero; widening it
    needs a way to tell a new target apart from the same target narrowed,
    which is a judgment call, not a mechanical one."""
    calls = _fts_tool_calls(tool_calls)
    if not calls:
        pytest.skip("no fulltext_search calls this turn")
    first_args = calls[0]["args"]
    present = [k for k in FILTER_KEYS if k in first_args]
    assert not present, (
        f"first fulltext_search call ({first_args.get('keywords') or first_args.get('nlQuery')!r}) "
        f"includes post-search filter(s) before any unfiltered hit count was observed: {present}"
    )


# --- A plan item only completes via its own search ----------------------

# Starter vocabulary per record_type, cued off references/search-strategies.md
# boilerplate-phrase lists (wills/deeds/court/probate) plus the record_type
# values actually used across eval/fixtures/scenarios/*/research.json. Built
# from reasonable terminology, not observed record-type values, and pruned
# by genealogist review (2026-08-19) to terms specific enough that a match
# actually confirms the completing search touched this record type --
# certificate (vital), alien/citizen (naturalization), parish (church), and
# funeral (obituary) were all cut as too generic to confirm anything on
# their own, and family_bible has no term reliable enough to list at all. A
# record_type with no entry here (including family_bible) gets the
# structural check only, not asserted clean by a term match it never had.
RECORD_TYPE_TERMS = {
    "probate": ("will", "estate", "executor", "executrix", "administrator",
                "administratrix", "appraise", "appraisement", "inventory",
                "bequeath", "testament", "heir", "legatee", "probate"),
    "church": ("baptism", "baptismal", "christen", "confirmation", "burial"),
    "church_record": ("baptism", "baptismal", "christen", "confirmation", "burial"),
    "vital": ("birth", "death", "marriage"),
    "vital_record": ("birth", "death", "marriage"),
    "marriage": ("marriage", "wedding", "banns", "matrimon"),
    "census": ("census", "household", "dwelling", "enumerat"),
    "naturalization": ("naturaliz", "declaration of intent"),
    "obituary": ("obituary", "death notice"),
}


def _completed_plan_items(before_state, after_state):
    """Plan items whose status became completed this turn, as
    {item_id: record_type}. Only a genuine transition counts -- an item
    already completed before this run is not this run's doing."""
    before = (before_state.get("research_json") or {}).get("plans", []) or []
    after = (after_state.get("research_json") or {}).get("plans", []) or []
    before_status = {
        item.get("id"): item.get("status")
        for plan in before for item in (plan.get("items") or [])
    }
    out = {}
    for plan in after:
        for item in plan.get("items") or []:
            iid = item.get("id")
            if item.get("status") == "completed" and before_status.get(iid) != "completed":
                out[iid] = item.get("record_type")
    return out


def test_plan_item_completion_matches_its_own_record_type(before_state, after_state):
    """SKILL.md step 8: set completed (search executed) or skipped
    (unnecessary). A plan item own search is what it says it is -- e.g.
    a record_type probate item calls for a will/estate search. Deep-dive
    #1651 finding 3: a plan item was repeatedly marked completed by an
    unrelated ad-hoc search (a witness/deed query, an nlQuery tree-ID
    lookup) that never touched its actual record type. Checks the
    structural half unconditionally (some log entry must be newly
    attributed to the item this turn) and the content half only for
    record_types in RECORD_TYPE_TERMS (skipped otherwise, not passed
    silently -- see that table's docstring)."""
    if before_state.get("research_json") is None:
        pytest.skip("no research.json in scenario")
    completed = _completed_plan_items(before_state, after_state)
    if not completed:
        pytest.skip("no plan item completed this turn")

    new_entries = _new_log_entries(before_state, after_state)
    errors = []
    checked_content = False
    for item_id, record_type in completed.items():
        attributed = [e for e in new_entries if e.get("plan_item_id") == item_id]
        if not attributed:
            errors.append(
                f"{item_id} (record_type={record_type!r}) was marked completed but no "
                f"log entry added this turn is attributed to it"
            )
            continue
        terms = RECORD_TYPE_TERMS.get(record_type)
        if not terms:
            continue  # record_type not in the starter table; structural check only
        checked_content = True
        haystack = " ".join(
            str(e.get(k, "")) + " " + json.dumps(e.get("query") or {}, ensure_ascii=False)
            for e in attributed for k in ("tool", "notes")
        ).lower()
        if not any(term in haystack for term in terms):
            errors.append(
                f"{item_id} (record_type={record_type!r}) was marked completed, but none "
                f"of its attributed log entries mention any of {terms}; attributed tools/"
                f"queries: {[(e.get('tool'), e.get('query')) for e in attributed]}"
            )
    assert not errors, "Plan-item completion mismatches:\n  - " + "\n  - ".join(errors)
    if not checked_content:
        pytest.skip("completed item(s) all have a record_type outside the starter vocabulary; structural check only")

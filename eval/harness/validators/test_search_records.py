"""Skill-specific validators for the search-records skill.

search-records executes a planned record_search against the FamilySearch
API and logs the result. Narrative-quality dimensions (search-parameter
strategy, result triage, log notes) live in the rubric — graded by the
LLM judge. The mechanical "is the log entry shaped right" checks live
here.

See test_universal.py module docstring for the validator function-
signature contract. The `test` argument is the parsed test JSON dict
(the inner "test" block) — used to gate test-specific checks on
`test["tags"]`.
"""

from __future__ import annotations

import json
import re

import pytest

from validators_lib import as_mapping as _as_mapping
from validators_lib import bare_tool_name as _bare_tool_name
from validators_lib import filter_claim_findings as _filter_claim_findings
from validators_lib import hashable_key as _hashable_key
from validators_lib import new_log_entries as _new_log_entries
from validators_lib import record_search_sent as _record_search_sent
from validators_lib import tool_input_keys as _tool_input_keys
from validators_lib import (
    assert_topical_fixture_used,
    assert_capture_pending_item_not_terminal as _assert_capture_pending_item_not_terminal,
)


# --- Structural rules from SKILL.md -----------------------------------

def test_positive_appends_log_entry(before_state, after_state, test):
    """Positive search-records tests must append a log entry. The skill's
    whole audit-trail role depends on this — every search, positive or
    negative, has to leave a log row that can be cited in a future
    exhaustive-search declaration."""
    if test.get("type") != "positive":
        pytest.skip("only positive tests record searches")
    if before_state.get("research_json") is None:
        pytest.skip("no research.json in scenario")
    new_entries = _new_log_entries(before_state, after_state)
    assert new_entries, "expected at least one new log entry recording the search"


# --- Tag-gated checks ------------------------------------------------

def test_log_outcome_positive_record_search(before_state, after_state, test):
    """Tag-gated: when the test scenario expects a successful record_search
    that hits the planned target, the new log entry must have `tool:
    "record_search"` and `outcome: "positive"`."""
    if "log-positive-record-search" not in test.get("tags", []):
        pytest.skip("not a log-positive-record-search scenario")
    new_entries = _new_log_entries(before_state, after_state)
    matched = [
        e for e in new_entries
        if e.get("tool") == "record_search" and e.get("outcome") == "positive"
    ]
    assert matched, (
        "expected a new log entry with tool='record_search' and "
        f"outcome='positive'; new entries: "
        f"{[(e.get('tool'), e.get('outcome')) for e in new_entries]}"
    )


def test_log_outcome_honest_no_match(before_state, after_state, test):
    """Tag-gated: when the test scenario probes honest negative-result
    logging (the fixture doesn't match the search the user asked for),
    the new log entry must have `outcome` in {`negative`, `error`} —
    never `positive` (which would be silently fabricating a match)."""
    if "log-honest-no-match" not in test.get("tags", []):
        pytest.skip("not a log-honest-no-match scenario")
    new_entries = _new_log_entries(before_state, after_state)
    outcomes = [e.get("outcome") for e in new_entries]
    bad_positive = [e for e in new_entries if e.get("outcome") == "positive"]
    assert not bad_positive, (
        "search-records must not log outcome='positive' when the fixture "
        f"didn't match the search; offending entries: "
        f"{[(e.get('id'), e.get('outcome')) for e in bad_positive]}"
    )
    assert any(o in ("negative", "partial", "error") for o in outcomes), (
        f"expected a new log entry with outcome in (negative, partial, error); "
        f"got outcomes={outcomes}"
    )


# --- Pre-1880 census: family structure must be marked inferred --------

_CENSUS_REFUSAL = "relationship-to-head"


def _log_append_ops(call) -> list[dict]:
    """The ops one research_log_append call sent, single-op or `ops[]`."""
    args = _as_mapping(call.get("args"))
    ops = args.get("ops")
    if isinstance(ops, str):
        try:
            ops = json.loads(ops)
        except (ValueError, TypeError):
            ops = None
    return [_as_mapping(o) for o in ops] if isinstance(ops, list) else [args]


def _op_key(op: dict):
    """Which search a log op records: its staged handle, else its tool and query."""
    ref = op.get("stagedResultsRef")
    if isinstance(ref, str) and ref:
        return ("ref", ref)
    return ("query", op.get("tool"), _hashable_key(_as_mapping(op.get("query"))))


def test_pre1880_census_structure_marked_inferred(tool_calls, test):
    """Tag-gated (pre-1880-census-household): a log note that `research_log_append`
    refused for stating a pre-1880 census household's structure as fact must be
    re-sent and logged, hedged, in a later call.

    SKILL.md's Step 4 rule: 1850/1860/1870 carry no "relationship to head"
    column, so every "head"/"wife"/"son" read off such a household is an
    inference (issue #1284). The tool enforces that at write time
    (`requirePre1880CensusHedge`), and that is the only copy of the rule:
    what counts as a claim and as a hedge is specified, measured and
    mutation-tested with the tool (research-log-editor-spec.md § 8.2,
    `dev/mutate-census-hedge.ts`), and `test_mock_mcp` proves the eval's write
    path applies it. This validator used to grade notes with its own wider word
    lists, which made ut_search_records_027 flap on wording the tool had
    accepted (issue #3054); it then replayed the tool's check, which could not
    fail, because a refused note is never logged.

    What the model CAN still get wrong is the recovery: a refusal is an error
    the model must act on, and dropping the search from the log instead leaves
    it unrecorded. So every op of a refused call (a batch is all-or-nothing) must
    be logged by a later successful call, matched on its staged handle, else on
    its tool and query.
    """
    if "pre-1880-census-household" not in test.get("tags", []):
        pytest.skip("not a pre-1880 census household scenario")
    appends = [c for c in (tool_calls or []) if _bare_tool_name(c.get("tool")) == "research_log_append"]
    refused_at = [
        i for i, c in enumerate(appends)
        if _as_mapping(c.get("response")).get("ok") is False
        and _CENSUS_REFUSAL in json.dumps(c.get("response"))
    ]
    if not refused_at:
        pytest.skip("research_log_append refused no census note this run")

    unrecovered = []
    for i in refused_at:
        later = {
            _op_key(op)
            for c in appends[i + 1:]
            if _as_mapping(c.get("response")).get("ok") is True
            for op in _log_append_ops(c)
        }
        for op in _log_append_ops(appends[i]):
            if _op_key(op) not in later:
                unrecovered.append(op.get("stagedResultsRef") or op.get("query"))
    assert not unrecovered, (
        "research_log_append refused a note for stating a pre-1880 census "
        "household's structure as fact, and the search it recorded was never "
        "logged afterwards with the structure marked inferred (SKILL.md Step 4): "
        + "; ".join(repr(u) for u in unrecovered)
    )


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


def test_sidecar_written_for_positive_search(before_state, after_state, test):
    """Tag-gated (sidecar-write): a positive record search must retain its
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


def test_no_sidecar_for_nil_search(before_state, after_state, test):
    """Tag-gated (sidecar-nil): a search that returns nothing must not write
    a sidecar — the new log entry's results_ref stays null and no new
    results/ file appears."""
    if "sidecar-nil" not in test.get("tags", []):
        pytest.skip("not a sidecar-nil scenario")
    new_entries = _new_log_entries(before_state, after_state)
    with_ref = [e for e in new_entries if e.get("results_ref")]
    assert not with_ref, (
        "a nil search must leave results_ref null; offending entries: "
        f"{[(e.get('id'), e.get('results_ref')) for e in with_ref]}"
    )
    sidecars = _new_result_sidecars(before_state, after_state)
    assert not sidecars, (
        f"a nil search must write no results/ sidecar; got: {sorted(sidecars)}"
    )


# --- No-harm invariant for planning/strategy requests ----------------

def test_no_search_or_writes_on_planning_request(
    before_state, after_state, tool_calls, test
):
    """Tag-gated (no-search-no-write): the search-records no-harm invariant
    for a planning/strategy request that should route to research-plan.

    search-records executes searches and logs them; a pure planning
    question ("what should I search for next?") must not cause a search to
    be EXECUTED or its results to be persisted. It was the deterministic
    gate for the grade_on_invariant negative ut_search_records_005, deleted by
    issue #2116 when research-plan became an agent, so in this suite it is
    dormant (tests/unit/test_tag_gate_coverage.py DORMANT) until a test carries
    the tag again. See docs/specs/unit-test-spec.md.

    Fails iff the run:
      - made a `record_search` MCP call (a search was executed), or
      - appended a new `log` entry (search-records records every search it
        runs; research-plan — the acceptable route — never writes `log`,
        so any new log entry means a search skill actually ran), or
      - wrote a new `results/` sidecar file.

    Deliberately does NOT flag other research.json writes: routing to
    research-plan legitimately writes `plans`/`questions`, which is correct
    behavior, not harm.
    """
    if "no-search-no-write" not in test.get("tags", []):
        pytest.skip("not a no-search-no-write scenario")

    # 1. No record_search executed.
    searched = [
        c for c in (tool_calls or [])
        if c.get("tool", "").split("__")[-1] == "record_search"
    ]
    assert not searched, (
        "planning request must not execute a search; got record_search "
        f"call(s) with args: {[c.get('args') for c in searched]}"
    )

    # 2. No new search log entry (research-plan never writes `log`).
    new_entries = _new_log_entries(before_state, after_state)
    assert not new_entries, (
        "planning request must not append a search log entry; new log "
        f"ids: {[e.get('id') for e in new_entries]}"
    )

    # 3. No new results/ sidecar file.
    sidecars = _new_result_sidecars(before_state, after_state)
    assert not sidecars, (
        f"planning request must not write a results/ sidecar; got: {sorted(sidecars)}"
    )


def test_escalates_to_external_sites_after_fs_exhaustion(
    skills_invoked, builtin_tool_calls, test
):
    """After FamilySearch is exhausted across name variants, the skill must
    hand off to `search-external-sites` — not merely offer to.

    Graded here rather than by the LLM judge because the hook records are
    ground truth: the PreToolUse hook fires on the real `Skill` call or agent
    spawn (`handoffs`, issue #2825), so a response that only *narrates* the
    escalation ("Shall I generate Ancestry URLs?") cannot satisfy it, and a
    response that genuinely delegates cannot be marked down for it. The judge
    has gotten this wrong in both directions — scoring Correctness=1 for
    "failed to call search-external-sites" on a run where the hook recorded
    the call.

    Tag-gated: only the nil-exhaustion escalation test asserts this. Ordinary
    search tests must NOT escalate, and negative routing tests are graded on
    routing instead.
    """
    from harness.skill_runner import handoffs

    if "familysearch-exhausted" not in test.get("tags", []):
        pytest.skip("only the FamilySearch-exhaustion escalation test")
    handed = handoffs(skills_invoked, builtin_tool_calls)
    assert "search-external-sites" in handed, (
        "FamilySearch was exhausted across name variants, so the skill had to "
        "hand off to search-external-sites. Offering it in prose is not "
        f"escalating. handoffs={handed}"
    )


def test_live_callee_used_its_own_tools(
    tool_calls, skills_invoked, builtin_tool_calls, test
):
    """Tag-gated (live-callee): a test that lets `search-external-sites`
    execute must show it was actually delegated to, and that it then called
    its own tools.

    This is the entire point of `execution.run_skills` (issue #1012). Before
    the sub-skill union the callee held neither `place_search` nor
    `external_links_search`, and the failure was silent — it invented an
    Ancestry URL from prose rather than erroring. A regression would look
    identical: plausible links, no tool call behind them.

    Deterministic rather than judged, for the same reason
    test_escalates_to_external_sites_after_fs_exhaustion is. Asked to verify
    URL provenance against a tool response, the judge has been wrong in both
    directions on this exact question: it scored Correctness=1 on 2026-07-31
    for "placeholder URLs" that were relayed verbatim, and again on
    2026-08-03 claiming Ancestry collection 1276 "does not appear in the
    returned results" when it is the fifth entry in the fixture it was
    reading. `tool_calls` is the harness's own record and cannot be misread.
    """
    from harness.skill_runner import handoffs

    if "live-callee" not in test.get("tags", []):
        pytest.skip("only the live-callee seam test")
    # Delegation first: without it the tool assert below is satisfiable the
    # wrong way. The unit harness grants every MCP tool to the main thread and
    # the test stocks `external_links_search`'s fixture, so `search-records`
    # can call it itself, never spawn the agent, and still show the tool in
    # `tool_calls` — the seam this test exists for would be untested and green.
    #
    # Nothing else covers it: this test's own `judge_context` forbids the judge
    # from grading delegation, and the validator it defers to
    # (test_escalates_to_external_sites_after_fs_exhaustion) gates on the
    # `familysearch-exhausted` tag, which ut_search_records_026 does not carry
    # — it skips, and a skipped validator is recorded `passed: true`.
    handed = handoffs(skills_invoked, builtin_tool_calls)
    assert "search-external-sites" in handed, (
        "this test's whole subject is the caller/callee seam — but the "
        "search-external-sites agent was never spawned. Calling its tools directly from the main "
        f"thread is the failure this asserts against, not a pass. handoffs={handed}"
    )
    called = {c.get("tool", "").split("__")[-1] for c in (tool_calls or [])}
    assert "external_links_search" in called, (
        "the search-external-sites agent ran live, so it had to reach its own "
        "tools — external_links_search is what turns a place into real "
        "third-party collection links. Absent, the agent can only have "
        f"invented any URLs it presented. tools called: {sorted(called)}"
    )


def test_capture_pending_item_not_terminal(before_state, after_state, test):
    """Issue #1226 — a plan item awaiting an external-site capture must not be
    `completed`/`skipped`. Shared with the other suite that can reach this
    state; the assertion lives in validators_lib."""
    _assert_capture_pending_item_not_terminal(before_state, after_state, test)


# --- jurisdictionHints consumption -------------------------------------

_GENERIC_PLACE_WORDS = frozenset({
    "county", "counties", "parish", "province", "state", "states",
    "district", "township", "borough", "city", "town", "united",
    "kingdom", "republic", "region", "department", "canton", "shire",
})


def _place_tokens(place):
    """Matchable words from a free-text place string. Drops words of 2
    characters or fewer ("of", "Co") and the generic administrative-unit
    words every place name shares: "Yell County, Arkansas" and "Union
    County, South Carolina" both contain "County", so keeping it lets a
    run that never left the searched jurisdiction satisfy the assertion
    (promise-emmanuel review, issue #1642 -- verified: the real
    jimmie-jewel-neal failure sequence, reverting to three more South
    Carolina searches with no Arkansas anywhere, passed this validator
    before this fix)."""
    tokens = []
    for t in re.split(r"[,\s]+", place or ""):
        if len(t) > 2 and t.lower() not in _GENERIC_PLACE_WORDS:
            tokens.append(t)
    return tokens


def test_jurisdiction_hints_followed(tool_calls, test):
    """Tag-gated (jurisdiction-hints-followed): issue #1642 Finding 1
    (mercyokum) -- when a record_search response returns a non-empty
    jurisdictionHints (a marriage search that came back empty in a
    sub-country place -- see packages/engine/mcp-server/src/tools/
    record-search.ts's isMarriageSearch/foundNobody/isSubCountryPlace gate),
    the next 1-2 record_search calls in the run must try the top-ranked
    candidate's place before reverting to a jurisdiction used prior to the
    hint.

    Ground truth: jimmie-jewel-neal run 2026-07-30_23-05-46 -- the tool
    returned a correctly-ordered hint naming Yell, Arkansas third (with
    supporting date and source person); the agent ran one Arkansas-scoped
    search, then reverted to nine more South Carolina searches. Both
    grandparent findings were later scored false.

    Shape: `jurisdictionHints.candidates[]`, each a `{place, earliestYear,
    whose, fromFact}` (marriage-jurisdictions.ts's own JurisdictionCandidate).
    The top candidate is candidates[0] -- the function's own date-proximity
    ordering, not re-derived here.
    """
    if "jurisdiction-hints-followed" not in test.get("tags", []):
        pytest.skip("not a jurisdiction-hints scenario")
    record_calls = []
    for c in (tool_calls or []):
        bare = c.get("tool", "").split("__")[-1]
        if bare == "record_search":
            record_calls.append(c)

    hint_pos = None
    top_place = None
    for i, c in enumerate(record_calls):
        response = c.get("response") or {}
        hints = response.get("jurisdictionHints") or {}
        candidates = hints.get("candidates") or []
        if not candidates:
            continue
        hint_pos = i
        top_place = candidates[0].get("place")
        break
    if hint_pos is None:
        pytest.skip("no jurisdictionHints returned in this run")
    if not top_place:
        pytest.skip("hint carried no usable place")
    tokens = _place_tokens(top_place)
    if not tokens:
        pytest.skip("hint place had no matchable tokens")
    place_fields = (
        "recordCountry", "recordSubdivision", "residencePlace", "birthPlace",
        "marriagePlace", "anyPlace",
    )  # recordSubdivision added (issue #1642): record-search.ts's own
    # searchedPlace computation reads recordSubdivision ahead of recordCountry
    # for a marriage search, and a real run confirmed the model reaches for
    # it naturally -- the field was missing here, false-failing a run that
    # tried the hinted place on its very next call.
    next_calls = record_calls[hint_pos + 1: hint_pos + 3]
    followed = False
    for c in next_calls:
        args = c.get("args") or {}
        for field in place_fields:
            if field == "recordSubdivision" and not args.get("recordCountry"):
                # record-search.ts throws on recordSubdivision without
                # recordCountry (promise-emmanuel review, issue #1642 round
                # 5) -- a call shaped like this is not one production would
                # ever have accepted, so it cannot count as "followed."
                continue
            value = args.get(field) or ""
            value_lower = value.lower()
            for t in tokens:
                if t.lower() in value_lower:
                    followed = True
    assert followed, (
        "record_search returned a jurisdictionHints candidate naming "
        + repr(top_place)
        + ", but neither of the next 2 record_search calls set "
        "recordSubdivision/residencePlace/marriagePlace/recordCountry/"
        "birthPlace/anyPlace to it "
        "(issue #1642 Finding 1)."
    )


# --- surnameVariantHints consumption -----------------------------------


def _is_surname_field(key):
    """`surname` and the five kin `*Surname` fields record-search.ts reads
    (SURNAME_FIELDS in utils/surname-variant-hints.ts). Matched by shape, not
    by a copied list, so a sixth kin field is accepted without an edit here.
    `surnameAlt` is not one: the hint's note directs a form listed for another
    field into that field, and the alternate name is a union paired with its own
    given name. A form the hint listed FOR `surnameAlt` is followed there; the
    caller checks that separately."""
    return key == "surname" or key.endswith("Surname")


def test_surname_variant_hints_followed(tool_calls, test):
    """Tag-gated (surname-variant-hints-followed): issue #3054 -- when a
    record_search response carries surnameVariantHints (a search that did not
    find its subject, on a -datter/-dotter patronymic; see
    packages/engine/mcp-server/src/utils/surname-variant-hints.ts), some LATER
    record_search call must put one of the hinted abbreviated forms in a
    surname field.

    Ground truth: the 2026-07-21 anders-monsen e2e run made 24 record_search
    calls, varied the bride's given name (Unna -> Urna), and never once sent a
    surname other than 'Halsteinsdatter'; the index holds 'Urna Halsteinsdr'.
    The 2026-10-08 baseline of ut_search_records_023 (before the hint) failed
    6 of 10 runs the same way.

    Any surname field counts, not only the one the hint came from: a role swap
    (hint on spouseSurname, the bride then searched as principal) is a
    legitimate way to act on it. "Any later call", not "the next two": two
    calls issued together before the hint was read, or a given-name retry
    first, would false-fail a short window. The cost is that a run which
    wanders nine calls before abbreviating still passes here -- the judge's
    score-2 band, not this validator, grades that.
    """
    if "surname-variant-hints-followed" not in test.get("tags", []):
        pytest.skip("not a surname-variant-hints scenario")
    record_calls = [
        c for c in (tool_calls or [])
        if c.get("tool", "").split("__")[-1] == "record_search"
    ]

    hint_pos = None
    variants = set()
    alt_variants = set()  # listed for surnameAlt, so followed there too
    for i, c in enumerate(record_calls):
        response = c.get("response") or {}
        hints = response.get("surnameVariantHints") or {}
        for entry in hints.get("fields") or []:
            for v in entry.get("variants") or []:
                if isinstance(v, str) and v.strip():
                    variants.add(v.strip().lower())
                    if entry.get("field") == "surnameAlt":
                        alt_variants.add(v.strip().lower())
        if variants:
            hint_pos = i
            break
    if hint_pos is None:
        pytest.skip("no surnameVariantHints returned in this run")

    followed = False
    for c in record_calls[hint_pos + 1:]:
        args = c.get("args") or {}
        for key, value in args.items():
            if not isinstance(value, str):
                continue
            form = value.strip().lower()
            if (_is_surname_field(key) and form in variants) or (
                key == "surnameAlt" and form in alt_variants
            ):
                followed = True
    assert followed, (
        "record_search returned surnameVariantHints listing "
        + repr(sorted(variants))
        + ", but no later record_search call put any of them in a surname "
        "field (issue #3054)."
    )


# --- Asks permission instead of executing a mandated lever -------------

_PERMISSION_PHRASES = (
    "should i",
    "would you like",
    "shall i",
    "want me to",
    "do you want",
)


def test_no_permission_ask_before_mandated_lever(tool_calls, text_response, test):
    """Tag-gated (asks-permission-instead-of-executing): issue #1642
    Finding 3 (mercyokum) -- when a nil result has been logged and Step
    8.2's lever ladder mandates trying more variants automatically ("before
    declaring negative"), the run must not stop and ask the user's
    permission to try the next one -- it must have already tried it.

    Ground truth: ut_search_records_nickname_bitsie
    (v1_2026-08-13_13-13-43) -- the skill searched only "Bitsie Jackson,"
    logged the nil, then asked whether to try "Mary" instead of just
    running it.

    Deterministic proxy, not a full plan re-derivation: exactly one
    record_search call was made, it nilled, and the final text_response
    asks a permission question. A single nil ending that way, with no
    further record_search call in the same run, is asking permission for
    a lever the skill was supposed to have already run.
    """
    if "asks-permission-instead-of-executing" not in test.get("tags", []):
        pytest.skip("not an unconditional-next-variant scenario")
    record_calls = []
    for c in (tool_calls or []):
        bare = c.get("tool", "").split("__")[-1]
        if bare == "record_search":
            record_calls.append(c)

    if len(record_calls) != 1:
        pytest.skip("this check only applies to a single-search run")
    response = record_calls[0].get("response") or {}
    total_matches = response.get("totalMatches")
    results = response.get("results")
    results_is_empty = isinstance(results, list) and len(results) == 0
    is_nil = total_matches == 0 or results_is_empty
    if not is_nil:
        pytest.skip("the one search was not a nil")
    text = (text_response or "").lower()
    asked = False
    for phrase in _PERMISSION_PHRASES:
        if phrase in text:
            asked = True

    assert not asked, (
        "the run made exactly one record_search call, it nilled, and the "
        "final response asks the user's permission to try the next lever "
        "instead of having already tried it (issue #1642 Finding 3): "
        + repr(text_response)
    )


def _staged_ref_by_log_id(tool_calls) -> dict[str, str]:
    """Log id -> the staged handle its research_log_append op finalized, read
    from each call's args and its response's logId(s), single-op or `ops[]`."""
    out: dict[str, str] = {}
    for c in tool_calls:
        if _bare_tool_name(c.get("tool")) != "research_log_append":
            continue
        args = _as_mapping(c.get("args"))
        response = c.get("response") if isinstance(c.get("response"), dict) else {}
        ops = args.get("ops")
        if isinstance(ops, str):
            try:
                ops = json.loads(ops)
            except (ValueError, TypeError):
                ops = None
        if isinstance(ops, list):
            ids = [r.get("logId") if isinstance(r, dict) else None for r in response.get("results") or []]
        else:
            ops, ids = [args], [response.get("logId")]
        for op, log_id in zip(ops, ids):
            ref = _as_mapping(op).get("stagedResultsRef")
            if isinstance(log_id, str) and isinstance(ref, str):
                out[log_id] = ref
    return out


def report_log_query_traces_to_record_search_call(before_state, after_state, tool_calls):
    """A new `record_search` log entry's `query` should name only filters the
    `record_search` call it documents actually sent.

    Reports two classes, labelled: a claimed filter the call never sent at all,
    and a value that differs from the one sent. For a STAGED entry the first
    class is refused by `research_log_append` itself; what is left for this
    check is the entry with no staged handle — a nil search stages nothing —
    and the value class,
    which is mostly place normalization ("Pennsylvania, United States" logged
    for "Pennsylvania" sent) and must never gate. Filter keys are
    `record_search`'s own inputs, read from the compiled schema, minus plumbing
    and paging.

    Paired exactly where it can be: log id -> the staged handle its
    `research_log_append` op finalized -> the `record_search` call whose
    response staged that handle. An entry with no handle is paired with an
    unclaimed call it traces to exactly, if there is one; otherwise it falls
    back to surname-keyed positional pairing among calls no entry has claimed, because
    two calls sharing a surname is the skill's own broad-then-narrow pattern and
    an any()-style match would hide a claim one of them never sent. An entry
    past the last call for its surname is left alone.

    **Reporting-only, by design.** The rule it would have been promoted with
    now lives in the tool (`preflightQueryFilterClaims` refuses a staged
    entry's never-sent claim), and the gating half that is left is
    `test_unstaged_log_query_filters_were_sent`, which needs no pairing. This
    check keeps the per-call detail and the value class. Run logs recorded before the eval mock
    echoed a search's arguments into its staged `query` fire on entries the tool
    FILLED from a fixture's recorded query — a harness artifact, not the
    model's claim (`scripts/replay_log_query_validators.py`).
    """
    entries = [
        e for e in _new_log_entries(before_state, after_state)
        if e.get("tool") == "record_search" and _as_mapping(e.get("query"))
    ]
    if not entries:
        pytest.skip("no new record_search log entries with a query")
    calls = [c for c in tool_calls if _bare_tool_name(c.get("tool")) == "record_search"]
    if not calls:
        pytest.skip("no record_search calls this turn")
    vocabulary = _tool_input_keys("record_search")
    if vocabulary is None:
        pytest.skip("the compiled tool schema is unavailable, so the filter vocabulary is unknown")

    by_ref: dict[str, dict] = {}
    for c in calls:
        response = c.get("response") if isinstance(c.get("response"), dict) else {}
        ref = (response.get("staged") or {}).get("resultsRef") if isinstance(response.get("staged"), dict) else None
        if isinstance(ref, str):
            by_ref[ref] = c
    ref_by_log = _staged_ref_by_log_id(tool_calls)

    pairs: list[tuple[dict, dict, str]] = []
    claimed: set[int] = set()
    unpaired: list[dict] = []
    for e in entries:
        call = by_ref.get(ref_by_log.get(e.get("id")))
        if call is not None:
            pairs.append((e, call, "staged handle"))
            claimed.add(id(call))
        else:
            unpaired.append(e)
    free: dict[str, list[dict]] = {}
    for c in calls:
        if id(c) not in claimed:
            free.setdefault(_hashable_key(_as_mapping(c.get("args")).get("surname")), []).append(c)

    def _traces(e: dict, c: dict) -> bool:
        never_sent, differs = _filter_claim_findings(e.get("query"), _record_search_sent(c.get("args")), vocabulary)
        return not never_sent and not differs

    # An entry that traces exactly to an unclaimed call is that call's log, first.
    # Position alone shifted every later pair when one search went unlogged, and
    # reported four faithful entries of ut_search_records_026 (v5_2026-10-12_12-15-56)
    # as claiming filters their calls never sent. Each call is claimed once, so two
    # entries cannot both trace to one call and hide a claim the other never sent.
    # Most specific entry first: a bare {surname} also traces to a narrower call,
    # and taken first it steals that call from the entry that names its filters.
    traced: set[int] = set()
    for e in sorted(unpaired, key=lambda e: -len(_as_mapping(e.get("query")))):
        pool = free.get(_hashable_key(_as_mapping(e.get("query")).get("surname")), [])
        match = next((c for c in pool if _traces(e, c)), None)
        if match is not None:
            pool.remove(match)
            traced.add(id(e))
            pairs.append((e, match, "exact trace"))
    still_unpaired = [e for e in unpaired if id(e) not in traced]
    positions: dict[str, int] = {}
    for e in still_unpaired:
        surname = _as_mapping(e.get("query")).get("surname")
        group = _hashable_key(surname)
        i = positions.get(group, 0)
        positions[group] = i + 1
        pool = free.get(group, [])
        if i < len(pool):
            pairs.append((e, pool[i], f"position {i} among unstaged {surname!r} calls"))

    errors = []
    for e, call, how in pairs:
        never_sent, differs = _filter_claim_findings(e.get("query"), _record_search_sent(call.get("args")), vocabulary)
        for claim in never_sent:
            errors.append(f"log entry {e.get('id')} ({how}) claims {claim}, which the call never sent")
        for claim in differs:
            errors.append(f"log entry {e.get('id')} ({how}) value differs — {claim}")
    assert not errors, "record_search log queries that do not trace to their call:\n  - " + "\n  - ".join(errors)


def test_unstaged_log_query_filters_were_sent(before_state, after_state, tool_calls):
    """A `record_search` log entry with no staged handle claims no filter that
    no `record_search` call this turn sent.

    `research_log_append` refuses a never-sent claim on a STAGED entry, so this
    covers the rest: an entry whose op carried no `stagedResultsRef` (a nil
    search stages nothing), where the `query` is the model's own claim, never a
    fill from a staged payload. A key no call sent at all was not sent by the
    call this entry documents, whichever call that was, so no pairing is needed
    and none can mislead it. Values are not compared: a different value is
    mostly place normalisation and stays with the report check above.
    """
    entries = [
        e for e in _new_log_entries(before_state, after_state)
        if e.get("tool") == "record_search" and _as_mapping(e.get("query"))
    ]
    staged = _staged_ref_by_log_id(tool_calls)
    unstaged = [e for e in entries if e.get("id") not in staged]
    if not unstaged:
        pytest.skip("no new unstaged record_search log entries with a query")
    calls = [c for c in tool_calls if _bare_tool_name(c.get("tool")) == "record_search"]
    if not calls:
        pytest.skip("no record_search calls this turn")
    vocabulary = _tool_input_keys("record_search")
    if vocabulary is None:
        pytest.skip("the compiled tool schema is unavailable, so the filter vocabulary is unknown")
    sent_anywhere: dict = {}
    for c in calls:
        sent_anywhere.update(_record_search_sent(c.get("args")))
    errors = []
    for e in unstaged:
        never_sent, _ = _filter_claim_findings(e.get("query"), sent_anywhere, vocabulary)
        errors.extend(f"log entry {e.get('id')} claims {claim}, which no record_search call sent" for claim in never_sent)
    assert not errors, "unstaged record_search log queries claim filters never sent:\n  - " + "\n  - ".join(errors)


# --- The census wiki fetch actually fires (issue #2123) ----------------

# Maps a tagged test id to the topical fixture stem its `mcp_fixtures` names.
# Hardcoded rather than read from the test spec: the `test` fixture only carries
# the inner "test" block (id/skill/name/type/tags), not top-level
# `mcp_fixtures` (validator_runner.py). Add an entry here whenever the
# "topical-fixture-required" tag is added to a test.
#
# Every entry is the SAME stem because every census scenario in this suite is a
# US one. `England_Census` and the other `{Country}_Census` branches of the
# Step 2 pre-work block therefore ship unexercised by this suite -- recorded
# here rather than left to look like coverage.
#
# The firing set is the tests whose SEARCH is a census search, derived from each
# test's user_message plus its scenario's census plan item. It is deliberately
# NOT the `census` tag (10 tests, too few) and NOT "the scenario holds a census
# plan item" (22, too many -- that set includes ut_search_records_011, a general
# sibling search, and ut_search_records_025, a marriage search, neither of which
# runs a census search at all).
_TOPICAL_FIXTURE_BY_TEST_ID = {
    "ut_search_records_001": "wiki-read-united-states-census",
    "ut_search_records_002": "wiki-read-united-states-census",
    "ut_search_records_010": "wiki-read-united-states-census",
    "ut_search_records_012": "wiki-read-united-states-census",
    "ut_search_records_013": "wiki-read-united-states-census",
    "ut_search_records_014": "wiki-read-united-states-census",
    "ut_search_records_015": "wiki-read-united-states-census",
    "ut_search_records_016": "wiki-read-united-states-census",
    "ut_search_records_017": "wiki-read-united-states-census",
    "ut_search_records_018": "wiki-read-united-states-census",
    "ut_search_records_026": "wiki-read-united-states-census",
    "ut_search_records_027": "wiki-read-united-states-census",
    "ut_search_records_h4k": "wiki-read-united-states-census",
    "ut_search_records_t9p": "wiki-read-united-states-census",
    "ut_search_records_nickname_bitsie": "wiki-read-united-states-census",
    "ut_search_records_nickname_bitsie_in_record": "wiki-read-united-states-census",
}


def test_census_wiki_fixture_actually_used(tool_calls, test):
    """A census search must actually fetch the jurisdiction's census page.

    ADR-0012 moves census schedule facts onto the wiki and records its own
    Enforcement as "None", so without this the move ships while doing nothing:
    the agent skips the fetch, states the schedule from memory as it does today,
    and every dimension still grades green. The same failure mode the
    historical-context validator was written for (issue #2283).

    The membership half and the map/tag guard are
    `validators_lib.assert_topical_fixture_used`, shared with
    `test_historical_context` -- two copies was the signal to lift it. What stays
    here is the ORDER arm below, which that caller does not need.

    `prefix_match` is on because the expected stem is the COUNTRY page and the
    skill may follow Step 2's per-year link; any `wiki-read-...-census*` stem
    satisfies "the schedule was read before searching", which is what this
    grades. (The per-year fixtures themselves were removed in 320f4d098 -- the
    generic predicate is a case-insensitive substring match, so a per-year URL
    is served the country page, which is the one stating the relationship-column
    date range.)
    """
    expected = assert_topical_fixture_used(
        tool_calls,
        test,
        _TOPICAL_FIXTURE_BY_TEST_ID,
        map_name="_TOPICAL_FIXTURE_BY_TEST_ID",
        prefix_match=True,
    )

    test_id = test.get("id")

    def _is_census_page(stem: object) -> bool:
        """Prefix, to match whatever census page the skill constructed."""
        return isinstance(stem, str) and stem.startswith(expected)

    # ORDER, not merely occurrence. Step 2 calls this "pre-work ... before
    # constructing the query": a page fetched AFTER the search cannot have
    # informed it, so a run that searches first and reads the schedule
    # afterwards satisfies the membership check above while doing the thing the
    # block exists to prevent. `tool_calls` is in call order.
    calls = tool_calls or []
    first_fetch = next(
        (i for i, c in enumerate(calls) if _is_census_page(c.get("response_fixture"))),
        None,
    )
    first_search = next(
        (
            i
            for i, c in enumerate(calls)
            if _bare_tool_name(c.get("tool") or "") == "record_search"
        ),
        None,
    )
    if first_search is None:
        return  # nothing was searched, so there is no ordering to enforce
    assert first_fetch < first_search, (
        f"{test_id}: the census page was fetched at call {first_fetch + 1}, AFTER "
        f"the first record_search at call {first_search + 1}. Step 2 requires it "
        "before the query is constructed — a schedule read afterwards cannot have "
        "shaped the search, and reading it late is how a run states from memory "
        "and then confirms itself."
    )


# --- Issue #2213 PR 3: declined items, thin subjects, collection links,
# --- household triangulation, unproven surnames ------------------------

_SEARCH_TOOLS = frozenset({
    "record_search", "fulltext_search", "volume_search", "image_search",
})


def _calls_named(tool_calls, *names) -> list[dict]:
    wanted = set(names)
    return [
        c for c in (tool_calls or [])
        if _bare_tool_name(c.get("tool") or "") in wanted
    ]


def _plan_items(research_json) -> list[tuple[dict, dict]]:
    """(plan, item) for every plan item, in file order."""
    out = []
    for plan in (research_json or {}).get("plans") or []:
        for item in plan.get("items") or []:
            out.append((plan, item))
    return out


def test_user_declined_item_skipped_not_searched(
    before_state, after_state, tool_calls, test
):
    """Tag-gated (user-declined-item): issue #2213 PR 3 item 1. When the user
    declines the current plan item, it is `skipped` with
    `skip_category: "user_declined"` and a `skip_reason`, and no search is run
    for it — a decline is terminal, not a cue to do the declined work first.

    "The current plan item" is Step 1's: the lowest-sequence `planned` item of
    the active plan in the starting state, so the test names no id.

    A search "for" the item is any of: a new log entry carrying its id as
    `plan_item_id`; a `record_search` whose `collectionId` is one the item's
    rationale names; a `record_search` whose `recordType` is the item's
    `record_type`; or a full-text, volume or image search at all (none of the
    tagged tests stocks one for any other purpose).
    """
    if "user-declined-item" not in test.get("tags", []):
        pytest.skip("not a user-declined-item scenario")
    before = before_state.get("research_json") or {}
    after = after_state.get("research_json") or {}
    planned = [
        (plan, item) for plan, item in _plan_items(before)
        if plan.get("status") == "active" and item.get("status") == "planned"
    ]
    assert planned, "scenario has no planned item in an active plan to decline"
    plan, current = min(planned, key=lambda pi: pi[1].get("sequence") or 0)
    item_id = current.get("id")

    after_item = next(
        (i for p, i in _plan_items(after)
         if p.get("id") == plan.get("id") and i.get("id") == item_id),
        None,
    )
    assert after_item is not None, f"declined item {item_id} is gone from the plan"
    assert after_item.get("status") == "skipped", (
        f"the user declined {item_id}, so it must be `skipped`; it ended "
        f"{after_item.get('status')!r}"
    )
    assert after_item.get("skip_category") == "user_declined", (
        f"{item_id} was declined by the user, so its skip_category must be "
        f"'user_declined'; got {after_item.get('skip_category')!r}"
    )
    reason = after_item.get("skip_reason")
    assert isinstance(reason, str) and reason.strip(), (
        f"{item_id} is skipped with no skip_reason saying the user declined it"
    )

    logged = [
        e.get("id") for e in _new_log_entries(before_state, after_state)
        if e.get("plan_item_id") == item_id
    ]
    assert not logged, (
        f"the user declined {item_id}, yet the run logged a search for it: {logged}"
    )

    rationale = current.get("rationale") or ""
    declined_collections = set(re.findall(r"collectionId\s+([A-Za-z0-9_-]+)", rationale))
    declined_type = (current.get("record_type") or "").strip().lower()
    for call in _calls_named(tool_calls, "record_search"):
        args = _as_mapping(call.get("args"))
        cid = str(args.get("collectionId") or "")
        assert cid not in declined_collections, (
            f"the user declined {item_id}, yet record_search ran against its "
            f"collection {cid}: {args}"
        )
        rtype = str(args.get("recordType") or "").strip().lower()
        assert not (declined_type and rtype == declined_type), (
            f"the user declined {item_id} ({declined_type}), yet record_search "
            f"ran with recordType {rtype!r}: {args}"
        )
    other = _calls_named(tool_calls, *(_SEARCH_TOOLS - {"record_search"}))
    assert not other, (
        f"the user declined {item_id}, yet the run pivoted to "
        f"{sorted({_bare_tool_name(c.get('tool') or '') for c in other})}"
    )


def test_thin_subject_hit_not_extracted(tool_calls, builtin_tool_calls, test):
    """Tag-gated (subject-too-thin): issue #2213 PR 3 item 4. When the subject
    is too thin to separate from a namesake (`ranked.subjectTooThin`), every
    hit is needs-review and none is handed to extraction on score.

    Fails on any `extraction_append` call, from any thread, and on any spawn of
    the record-structurer agent. Not conditioned on the flag having reached the
    agent: the tagged scenario's tree is thin by construction, so a run that
    dropped `subjectId` and never saw the flag has not earned an extraction
    either.
    """
    from harness.skill_runner import SPAWN_TOOL_NAMES

    if "subject-too-thin" not in test.get("tags", []):
        pytest.skip("not a subject-too-thin scenario")
    extracted = _calls_named(tool_calls, "extraction_append")
    assert not extracted, (
        "the subject is too thin to tell from a namesake, so no hit may be "
        "extracted; extraction_append was called with "
        f"{[_as_mapping(c.get('args')).get('recordIds') for c in extracted]}"
    )
    structurer = [
        c for c in (builtin_tool_calls or [])
        if c.get("tool") in SPAWN_TOOL_NAMES
        and "record-structurer" in str((c.get("args") or {}).get("subagent_type") or "")
    ]
    assert not structurer, (
        "the subject is too thin to tell from a namesake, so no hit may be "
        "handed to record-structurer either"
    )


_COLLECTION_LINK_RE = re.compile(
    r"familysearch\.org/search/collection/([A-Za-z0-9_-]+)", re.IGNORECASE
)


def _collection_ids(tool_calls) -> tuple[set[str], set[str]]:
    """(every collection id the run was served or sent, the ids of record hits)."""
    seen: set[str] = set()
    hits: set[str] = set()
    for call in tool_calls or []:
        name = _bare_tool_name(call.get("tool") or "")
        args = _as_mapping(call.get("args"))
        resp = call.get("response") if isinstance(call.get("response"), dict) else {}
        if args.get("collectionId"):
            seen.add(str(args["collectionId"]))
        if name == "record_search":
            for row in resp.get("results") or []:
                if isinstance(row, dict) and row.get("collectionId"):
                    hits.add(str(row["collectionId"]))
            if isinstance(resp.get("collections"), dict):
                hits.update(str(k) for k in resp["collections"])
        elif name == "collections_search":
            for row in resp.get("results") or []:
                if isinstance(row, dict) and row.get("id"):
                    seen.add(str(row["id"]))
    return seen | hits, hits


def test_collection_named_with_link(tool_calls, text_response, test):
    """Tag-gated (collection-link): issue #2213 PR 3 item 5. A FamilySearch
    collection named to the user carries its title and its
    `https://www.familysearch.org/search/collection/{id}` link — never a bare id.

    Two arms. The collection of a record_search hit must appear as such a link
    (the tagged test's user asks which collection holds the record). And no
    collection id the run saw — sent, or served by record_search or
    collections_search — may appear in the reply outside such a link: a mention
    preceded by `/` is the link itself and is skipped; anything else (`collection
    1803785`, `f.collectionId=1803785`) is bare. The title half is the judge's.
    """
    if "collection-link" not in test.get("tags", []):
        pytest.skip("not a collection-link scenario")
    text = text_response or ""
    ids, hit_ids = _collection_ids(tool_calls)
    if not ids:
        pytest.skip("the run was served no collection id")
    linked = {m.group(1) for m in _COLLECTION_LINK_RE.finditer(text)}
    if hit_ids:
        assert linked & hit_ids, (
            "the reply names the hit's collection without its "
            "familysearch.org/search/collection/<id> link; hit collections "
            f"{sorted(hit_ids)}, linked {sorted(linked)}"
        )
    bare = []
    for cid in sorted(ids):
        for m in re.finditer(r"(?<![\w/-])" + re.escape(cid) + r"(?![\w-])", text):
            bare.append(text[max(0, m.start() - 30): m.end() + 10])
    assert not bare, (
        "a collection id appears in the reply outside a "
        f"familysearch.org/search/collection/<id> link: {bare}"
    )


def _norm_name(value) -> str:
    return re.sub(r"[^a-z]", "", str(value or "").lower())


def _subject_and_co_residents(before_state) -> tuple[list[dict], list[list[dict]]]:
    """(the subject's names, each co-resident's names): parents of the
    project's first subject person and their other couple partners."""
    research = before_state.get("research_json") or {}
    tree = before_state.get("tree_gedcomx_json") or before_state.get("tree_gedcomx") or {}
    subjects = (research.get("project") or {}).get("subject_person_ids") or []
    if not subjects:
        return [], []
    subject = subjects[0]
    persons = {p.get("id"): p for p in tree.get("persons") or []}
    rels = tree.get("relationships") or []
    parents = {
        r.get("parent") for r in rels
        if r.get("type") == "ParentChild" and r.get("child") == subject
    }
    co = set(parents)
    for r in rels:
        if r.get("type") != "Couple":
            continue
        a, b = r.get("person1"), r.get("person2")
        if a in parents:
            co.add(b)
        if b in parents:
            co.add(a)
    co.discard(subject)
    subject_names = (persons.get(subject) or {}).get("names") or []
    return subject_names, [
        (persons.get(pid) or {}).get("names") or [] for pid in sorted(co) if pid in persons
    ]


def _same_name(a, b, width: int) -> bool:
    a, b = _norm_name(a), _norm_name(b)
    n = min(width, len(a), len(b))
    return n > 0 and a[:n] == b[:n]


def _co_resident_searches(before_state, tool_calls) -> list[dict]:
    """record_search args whose principal is a co-resident, not the subject.

    Principal means the givenName/surname fields; a parent-name anchor on a
    search for the subject (motherGivenName, ...) is not a co-resident search.
    A given name counts as the co-resident's when it shares its first four
    letters (Catharina/Catherine), a surname when it shares its first three
    (Kessler/Kesler), so a variant spelling still counts. A call whose given
    name is the subject's is the subject's own search. A call with no given
    name counts only on a co-resident surname the subject does not carry.
    """
    subject_names, co_names = _subject_and_co_residents(before_state)
    subject_given = [n.get("given") for n in subject_names]
    subject_surnames = [n.get("surname") for n in subject_names]
    found = []
    for call in _calls_named(tool_calls, "record_search"):
        args = _as_mapping(call.get("args"))
        given, surname = args.get("givenName"), args.get("surname")
        if given and any(_same_name(given, g, 4) for g in subject_given):
            continue
        for names in co_names:
            givens = [n.get("given") for n in names]
            surnames = [n.get("surname") for n in names]
            surname_ok = surname is None or any(_same_name(surname, s, 3) for s in surnames)
            if given and surname_ok and any(_same_name(given, g, 4) for g in givens):
                found.append(args)
                break
            if (
                not given and surname
                and any(_same_name(surname, s, 3) for s in surnames)
                and not any(_same_name(surname, s, 3) for s in subject_surnames)
            ):
                found.append(args)
                break
    return found


def test_household_searched_by_co_resident(before_state, tool_calls, test):
    """Tag-gated (household-triangulation): issue #2213 PR 3 item 6. When the
    subject's own entries are too many to tell apart and a co-resident (a
    parent, or a parent's other spouse) is known, the household is searched by
    that co-resident: a record_search naming them as the principal.

    Co-residents are read from the starting tree, so the test names nobody.
    """
    if "household-triangulation" not in test.get("tags", []):
        pytest.skip("not a household-triangulation scenario")
    _, co_names = _subject_and_co_residents(before_state)
    assert co_names, "scenario's subject has no parent or step-parent in the tree"
    searched = _co_resident_searches(before_state, tool_calls)
    assert searched, (
        "the subject's entries could not be told apart and a co-resident is "
        "known, but no record_search named a parent or step-parent as the "
        "principal. record_search calls: "
        f"{[_as_mapping(c.get('args')) for c in _calls_named(tool_calls, 'record_search')]}"
    )


def test_household_not_searched_by_co_resident_when_unneeded(
    before_state, tool_calls, test
):
    """Tag-gated (household-triangulation-unneeded): the over-application guard
    for test_household_searched_by_co_resident. A unique, well-indexed subject
    has nothing to triangulate, so no record_search names a co-resident as the
    principal."""
    if "household-triangulation-unneeded" not in test.get("tags", []):
        pytest.skip("not a household-triangulation-unneeded scenario")
    searched = _co_resident_searches(before_state, tool_calls)
    assert not searched, (
        "the subject had one clear match, yet the run searched the household "
        f"by a co-resident: {searched}"
    )


# Test id -> (her given name, the researcher-named surname that is not proven).
_UNPROVEN_SURNAME_BY_TEST_ID = {
    "ut_search_records_d33": ("Juanita", "Fenstermaker"),
}


def test_unproven_surname_used_as_search_input(
    before_state, after_state, tool_calls, test
):
    """Tag-gated (unproven-surname-search): issue #2213 PR 3 item 3, the Fittro
    run. Typing a researcher-named, unproven surname into a query asserts
    nothing, so she is searched under it: a record_search whose givenName is
    hers and whose surname is that surname. The caution belongs on the tree, so
    nothing written to it asserts the marriage: no new Couple relationship for
    the subject, and no name on her in that surname.
    """
    tags = test.get("tags", [])
    test_id = test.get("id")
    assert test_id not in _UNPROVEN_SURNAME_BY_TEST_ID or "unproven-surname-search" in tags, (
        f"{test_id} has an entry in _UNPROVEN_SURNAME_BY_TEST_ID but no "
        "'unproven-surname-search' tag - restore the tag or delete the entry"
    )
    if "unproven-surname-search" not in test.get("tags", []):
        pytest.skip("not an unproven-surname-search scenario")
    assert test_id in _UNPROVEN_SURNAME_BY_TEST_ID, (
        f"{test_id} carries 'unproven-surname-search' but has no entry in "
        "_UNPROVEN_SURNAME_BY_TEST_ID"
    )
    given, surname = _UNPROVEN_SURNAME_BY_TEST_ID[test_id]
    calls = [_as_mapping(c.get("args")) for c in _calls_named(tool_calls, "record_search")]
    hit = [
        a for a in calls
        if _same_name(a.get("givenName"), given, len(_norm_name(given)))
        and _norm_name(a.get("surname")).startswith(_norm_name(surname)[:6])
    ]
    assert hit, (
        f"no record_search looked for {given} under the unproven surname "
        f"{surname}; searching under it asserts nothing. record_search calls: {calls}"
    )

    research = before_state.get("research_json") or {}
    subjects = (research.get("project") or {}).get("subject_person_ids") or []
    subject = subjects[0] if subjects else None

    def couples(state):
        tree = state.get("tree_gedcomx_json") or state.get("tree_gedcomx") or {}
        return {
            r.get("id") for r in tree.get("relationships") or []
            if r.get("type") == "Couple" and subject in (r.get("person1"), r.get("person2"))
        }

    def surnames(state):
        tree = state.get("tree_gedcomx_json") or state.get("tree_gedcomx") or {}
        person = next((p for p in tree.get("persons") or [] if p.get("id") == subject), {})
        return {_norm_name(n.get("surname")) for n in person.get("names") or []}

    new_couples = couples(after_state) - couples(before_state)
    assert not new_couples, (
        f"the marriage to a {surname} is unproven, yet the run wrote a Couple "
        f"relationship for the subject: {sorted(new_couples)}"
    )
    added = surnames(after_state) - surnames(before_state)
    assert _norm_name(surname) not in added, (
        f"the marriage to a {surname} is unproven, yet the run gave the subject "
        f"a {surname} name in the tree"
    )

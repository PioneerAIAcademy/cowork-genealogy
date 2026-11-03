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
from validators_lib import new_section_entries as _new_section_entries
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
    agent_returns, text_response, test
):
    """After FamilySearch is exhausted across name variants, the agent must
    hand back to `search-external-sites` — name it, with the person attributes,
    in its caller-facing lines — not merely offer to.

    An agent cannot spawn another agent (lead ruling 2026-09-23: hand back,
    never spawn), so the escalation is the named hand-back in the return, read
    from the agent's own return text (`agent_return_text`), the same shape
    `test_hypothesis_tracking.py` asserts. A closing question ("shall I
    generate Ancestry URLs?") is the failure this exists to catch: it names the
    site but not the agent, so it does not match.

    Tag-gated: only the nil-exhaustion escalation test asserts this. Ordinary
    search tests must NOT escalate.
    """
    from harness.skill_runner import agent_return_text

    if "familysearch-exhausted" not in test.get("tags", []):
        pytest.skip("only the FamilySearch-exhaustion escalation test")
    reply = agent_return_text(agent_returns, "search-records") or (text_response or "")
    assert re.search(r"hand[- ]?back[^\n]{0,80}`?search-external-sites", reply, re.I), (
        "FamilySearch was exhausted across name variants, so the agent had to "
        "hand back to search-external-sites in its return. Offering Ancestry in "
        f"prose is not escalating. return text: {reply[:600]!r}"
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
    "ut_search_records_027": "wiki-read-united-states-census",
    "ut_search_records_hpi": "wiki-read-united-states-census",
    "ut_search_records_hpm": "wiki-read-united-states-census",
    "ut_search_records_d01": "wiki-read-united-states-census",
    "ut_search_records_d02": "wiki-read-united-states-census",
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


# --- Handed plan item (issue #3581) -----------------------------------

def _research_query_calls(tool_calls):
    return [
        c for c in (tool_calls or [])
        if _bare_tool_name(c.get("tool")) == "research_query"
    ]


def test_handed_plan_item_skips_research_query(tool_calls, test):
    """Tag-gated (handed-plan-item): the delegation carries the plan item whose
    ``id`` equals ``planItemId``, so the agent has the item and its status and
    issues no ``research_query`` for it.

    The saving is the point of the hand-off (the orientation baseline in
    docs/skill-to-agent-pair-conversion.md counts that call), and nothing else
    reads it: the judge sees the final answer, not whether a call was made.
    """
    if "handed-plan-item" not in test.get("tags", []):
        pytest.skip("not a handed-plan-item scenario")
    queries = _research_query_calls(tool_calls)
    assert not queries, (
        f"The delegation handed over plan item pli_001 verbatim, but the agent "
        f"still called research_query {len(queries)} time(s): "
        f"{[c.get('input') or c.get('args') for c in queries][:2]}"
    )


def test_handed_plan_item_status_update_uses_delegated_plan_id(tool_calls, test):
    """Tag-gated (handed-plan-item): the status update names the delegated
    ``planId``. A handed item carries no parent plan id, so an agent that skipped
    ``research_query`` has nothing else to take it from.
    """
    if "handed-plan-item" not in test.get("tags", []):
        pytest.skip("not a handed-plan-item scenario")
    updates = [
        c.get("input") or c.get("args") or {}
        for c in (tool_calls or [])
        if _bare_tool_name(c.get("tool")) == "research_append"
    ]
    updates = [
        u for u in updates
        if u.get("section") == "plan_items" and u.get("op") == "update"
    ]
    assert updates, "the agent never updated the plan item's status"
    wrong = [u.get("planId") for u in updates if u.get("planId") != "pl_001"]
    assert not wrong, f"the status update used planId {wrong}, not the delegated pl_001"


def test_handed_subject_skips_tree_read(builtin_tool_calls, tool_calls, test):
    """Tag-gated (handed-subject): the delegation carries the subject, so the agent
    takes ``subjectId`` and the names and dates from it and does not ``Read``
    ``tree.gedcomx.json`` — and still passes that ``subjectId`` to ``record_search``.
    """
    if "handed-subject" not in test.get("tags", []):
        pytest.skip("not a handed-subject scenario")
    reads = [
        (c.get("args") or {}).get("file_path", "")
        for c in builtin_tool_calls or []
        if c.get("tool") == "Read"
    ]
    tree_reads = [r for r in reads if r.replace("\\", "/").endswith("tree.gedcomx.json")]
    assert not tree_reads, (
        f"The delegation handed over the subject, but the agent still read the tree: {tree_reads[:2]}"
    )
    searches = [
        c.get("input") or c.get("args") or {}
        for c in tool_calls or []
        if _bare_tool_name(c.get("tool")) == "record_search"
    ]
    assert searches and all(s.get("subjectId") == "I1" for s in searches), (
        f"record_search was not called with the handed subjectId I1: {searches[:2]}"
    )


def test_mismatched_handed_plan_item_is_queried(tool_calls, test):
    """Tag-gated (handed-plan-item-mismatch): a ``plan_item`` whose ``id`` differs
    from ``planItemId`` is not the item the caller named, so it is not trusted and
    the agent reads ``planItemId`` itself before searching.

    Guards the other direction of the hand-off rule: a check that only proves the
    call can be skipped would pass an agent that skips it unconditionally.
    """
    if "handed-plan-item-mismatch" not in test.get("tags", []):
        pytest.skip("not a handed-plan-item-mismatch scenario")
    calls = tool_calls or []
    first_query = next(
        (i for i, c in enumerate(calls) if _bare_tool_name(c.get("tool")) == "research_query"),
        None,
    )
    first_search = next(
        (i for i, c in enumerate(calls) if _bare_tool_name(c.get("tool")) == "record_search"),
        None,
    )
    assert first_query is not None, (
        "The handed plan_item carried a different id than planItemId, so it had to "
        "be ignored and pli_001 read with research_query; no research_query was made."
    )
    assert first_search is None or first_query < first_search, (
        "research_query came after the first record_search: the agent searched "
        "on the mismatched handed item before reading the item it was asked to run."
    )


# --- Namesake rows (issue #3363, PR 2) --------------------------------


def test_namesake_row_recorded(before_state, after_state, test):
    """Tag-gated (namesake-row): a search that turned up a same-named person the
    agent ruled out records him as a `namesakes` row on the subject (Step 6b).

    A row names a subject of the project and cites a `record_search` log entry
    this run wrote. `research_append` stamps `record_persona_ids` only for a
    record found in the cited search's own results, so a row with no stamp listed
    an id the search never returned (a `recordArk`, a retyped id) or cited the
    wrong log.
    """
    if "namesake-row" not in test.get("tags", []):
        pytest.skip("not a namesake-row scenario")
    rows = _new_section_entries(before_state, after_state, "namesakes")
    assert rows, "the agent ruled a same-named person out but recorded no namesakes row"
    research = after_state.get("research_json") or {}
    subjects = set((research.get("project") or {}).get("subject_person_ids") or [])
    searches = {
        e.get("id") for e in _new_log_entries(before_state, after_state) if e.get("tool") == "record_search"
    }
    for row in rows:
        assert row.get("person_id") in subjects, (
            f"row {row.get('id')} is on {row.get('person_id')!r}, not a subject of the project {sorted(subjects)}"
        )
        assert set(row.get("log_entry_ids") or []) & searches, (
            f"row {row.get('id')} cites {row.get('log_entry_ids')}, none of them a record_search this run logged"
        )
        assert row.get("record_persona_ids"), (
            f"row {row.get('id')} lists {row.get('record_ids')}, which research_append found in none of the "
            "cited search's results: copy each recordId verbatim, never recordArk"
        )


def test_no_namesake_row(before_state, after_state, test):
    """Tag-gated (no-namesake-row): a candidate who may still be the subject is
    never recorded as his namesake, since a row caps the subject's own links."""
    if "no-namesake-row" not in test.get("tags", []):
        pytest.skip("not a no-namesake-row scenario")
    rows = _new_section_entries(before_state, after_state, "namesakes")
    assert not rows, f"the agent recorded a namesake for a candidate who may be the subject: {rows}"


def test_namesake_warning_handed_to_person_evidence(tool_calls, agent_returns, text_response, test):
    """Tag-gated (namesake-warning): when the namesakes write warns that links to
    the subject are untied, the return hands every listed `pe_` id to
    person-evidence, the only agent that may lower or tie them."""
    from harness.skill_runner import agent_return_text

    if "namesake-warning" not in test.get("tags", []):
        pytest.skip("not a namesake-warning scenario")
    warned: set[str] = set()
    for call in tool_calls or []:
        if _bare_tool_name(call.get("tool")) != "research_append":
            continue
        args = _as_mapping(call.get("input") or call.get("args"))
        ops = args.get("ops") if isinstance(args.get("ops"), list) else [args]
        if any(isinstance(op, dict) and op.get("section") == "namesakes" for op in ops):
            warned |= set(re.findall(r"\bpe_\d{3,}\b", json.dumps(call.get("response"), default=str)))
    assert warned, "no namesakes write returned a warning naming a link, so the scenario did not reach the hand-back"
    reply = agent_return_text(agent_returns, "search-records") or (text_response or "")
    hand_back = re.search(r"hand[- ]?back[^\n]{0,40}`?person-evidence[^\n]*", reply, re.I)
    assert hand_back, f"the namesakes write warned about {sorted(warned)}, but no Hand-back: person-evidence line: {reply[:600]!r}"
    missing = sorted(p for p in warned if p not in hand_back.group(0))
    assert not missing, f"the person-evidence hand-back omits warned links {missing}: {hand_back.group(0)!r}"

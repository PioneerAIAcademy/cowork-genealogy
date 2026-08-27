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

from validators_lib import new_log_entries as _new_log_entries
from validators_lib import (
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

# Words a log note uses when it is describing the household around the hit,
# rather than the hit alone. The rule below only applies once the note starts
# describing the household — a note that reports the focus person and nothing
# else has no family structure to qualify.
_HOUSEHOLD_MENTIONS = (
    "household",
    "dwelling",
    "co-resident",
    "coresident",
    "enumerated with",
    "living with",
)

# Role assertions that can only be read off a relationship column. Bare role
# words are deliberately NOT listed: a note may legitimately name a tree-side
# relative ("searched for George's wife Catherine", where Catherine turns out
# to be absent from the record), and that is not a claim about what the census
# stated. These forms are — "head of household", "X as father" — so they
# trigger the requirement even when the word "household" never appears.
_ROLE_ASSERTIONS = (
    r"head\s+of\s+household",
    r"household\s+head",
    r"\bas\s+[\"'“‘]?(?:his|her|the)?\s*[\"'“‘]?"
    r"(?:head|wife|husband|son|daughter|father|mother)\b",
)

# Possessive kinship claims about a specific named person found in the
# record — "Amos's children", "Doss's son" — a second phrasing of the same
# claim _ROLE_ASSERTIONS's "as ROLE" form catches, which "as" alone misses.
# Scoped to a capitalized name's possessive for the same reason
# _ROLE_ASSERTIONS avoids bare role words above: a bare pronoun ("his son")
# is common in a legitimate tree-side reference this rule must not trip on.
_POSSESSIVE_KINSHIP_ASSERTIONS = (
    r"\b[A-Z][a-zA-Z]*'s\s+(?:son|daughter|child|children|wife|husband)\b",
)

# A plural kinship noun immediately introducing named individuals — "plus
# sons Thos T McElwee and Stephen McElwee" — the exact phrasing behind
# issue #1912's production report. Scoped to the PLURAL forms only (never
# bare "son"/"daughter"/"wife"/"husband"): a search routinely names a single
# already-known tree-side relative this way ("anchored on his wife
# Catherine"), which is not a claim about the record; introducing multiple
# same-role people by a plural noun is not that pattern.
_PLURAL_KINSHIP_INTRODUCING_NAME = (
    r"\b(?:sons|daughters|children)\s+[A-Z]",
)

_CLAIM_PATTERNS = (
    _ROLE_ASSERTIONS
    + _POSSESSIVE_KINSHIP_ASSERTIONS
    + _PLURAL_KINSHIP_INTRODUCING_NAME
)

# Any of these in the note satisfies the rule. The skill does not have to use
# SKILL.md's exact sentence — it has to say, in some form, that the structure
# is an inference rather than something the record stated.
_INFERENCE_MARKERS = (
    r"inferr",            # inferred, inferring, indexer-inferred
    r"inference",         # inference, inferences
    r"\bnot\s+(?:a\s+)?stated\b",
    r"\bunstated\b",
    r"\bimplied\b",
    r"\bpresumed\b",
    r"no\s+relationship\s+(?:to\s+head\s+)?column",
    r"relationship\s+column[^.]{0,40}\b(?:does\s+not|did\s+not|is\s+not|"
    r"was\s+not|never|absent)\b",
)


def test_pre1880_census_structure_marked_inferred(
    before_state, after_state, test
):
    """Tag-gated (pre-1880-census-household): a log note that describes a
    pre-1880 US census household must mark the family structure inferred.

    SKILL.md's Step 4 rule: 1850/1860/1870 carry no "relationship to head"
    column, so every "head"/"wife"/"son" read off such a household — and the
    record's own `ParentChild`/`Couple` edges, which are the indexer's
    inference from the same signals — is an inference. The body prescribes
    the output: "Daniel, Margaret, Hannah in one dwelling; family structure
    inferred from surname, ages and order, not stated", *not* "head Daniel +
    wife Margaret + daughter Hannah".

    Deterministic rather than judged because compliance is genuinely
    inconsistent, not because the judge misreads it. See issue #1284.

    Re-measured for PR #1946 (superseding this docstring's earlier figure —
    "17 of 32 ... and all 32 passed" — which the review caught silently
    dropped rather than updated): across the 5 committed run logs as of this
    PR, the 9 `pre-1880-census-household`-tagged tests produced 43 logged
    searches. The marker appears in 25 of 43; outcome is 22 pass / 21 fail.
    Unlike the earlier figure, marker presence and pass no longer coincide —
    3 of the 25 marker-present runs still failed (`ut_search_records_014`
    once, `ut_search_records_h4k` twice), because this validator's own gate
    is now live and the judge separately reads whether a marker actually
    qualifies its claim. Re-derive by scanning `research_log_append` notes in
    `eval/runlogs/unit/search-records/v1_*.json` for the tagged test ids.

    Requirement: if `notes` describes a household at all (`_HOUSEHOLD_MENTIONS`)
    or makes a relationship/kinship claim (`_CLAIM_PATTERNS`), an inference
    marker (`_INFERENCE_MARKERS`) must appear somewhere in the note. This is
    the original #1284 rule — what catches a bare listing with no hedge
    anywhere ("...in household of Thomas Flynn and Mary Flynn.", no marker
    at all) or a flat, unhedged claim ("plus sons Thos T McElwee and Stephen
    McElwee", issue #1912's actual production text, no marker anywhere in
    that log entry).

    `_CLAIM_PATTERNS` covers three shapes the same underlying rule reads off:
    `_ROLE_ASSERTIONS` ("as father", "household head"), a possessive kinship
    claim naming a specific person ("Amos's children"), and a plural kinship
    noun bare-introducing named individuals ("sons Thos T McElwee and
    Stephen McElwee").

    PR #1946 review (issue #1912): a per-sentence variant of this check was
    tried, to catch a marker present elsewhere in the note that never
    actually qualifies a specific claim (e.g. "...likely Amos's children.
    Pre-1880 census — no relationship column; family structure inferred
    ..."). Withdrawn: `ut_search_records_015`'s own committed, correctly-
    hedged output ("...household headed by William Mullen ... Indexer-
    inferred ParentChild/Couple relationships — 1860 census carries no
    relationship column ...") has the identical two-sentence shape —
    claim, then the SKILL.md-prescribed hedge as its own following sentence
    — and no reliable mechanical signal separates the two. Note-wide is the
    right precision for what a validator (rather than the judge, who reads
    the whole note as a person would) can safely automate; confirmed against
    every note in every committed `search-records` run log to date (168
    notes, tag forced on all of them) with zero false positives.
    """
    if "pre-1880-census-household" not in test.get("tags", []):
        pytest.skip("not a pre-1880 census household scenario")

    offenders = []
    for e in _new_log_entries(before_state, after_state):
        if e.get("tool") != "record_search":
            continue
        if e.get("outcome") not in ("positive", "partial"):
            continue  # a nil found no household to describe
        notes = e.get("notes") or ""

        describes_household = any(
            m in notes.lower() for m in _HOUSEHOLD_MENTIONS
        ) or any(re.search(p, notes, re.IGNORECASE) for p in _CLAIM_PATTERNS)
        if not describes_household:
            continue
        if any(re.search(p, notes, re.IGNORECASE) for p in _INFERENCE_MARKERS):
            continue
        offenders.append((e.get("id"), notes))

    assert not offenders, (
        "a pre-1880 US census has no relationship column, so a log note that "
        "describes the household must say the family structure is inferred "
        "rather than stated (SKILL.md Step 4). These entries describe the "
        "household and assert its structure flat: "
        + "; ".join(f"{eid}: {notes!r}" for eid, notes in offenders)
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
    be EXECUTED or its results to be persisted. This is the deterministic
    gate for the grade_on_invariant negative ut_search_records_005: the
    routing (research-plan vs a project-status detour) is a known-unstable
    model prior, but the state-harm invariant always holds and is what we
    assert. See docs/specs/unit-test-spec.md.

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


def test_escalates_to_external_sites_after_fs_exhaustion(skills_invoked, test):
    """After FamilySearch is exhausted across name variants, the skill must
    hand off to `search-external-sites` — not merely offer to.

    Graded here rather than by the LLM judge because `skills_invoked` is
    ground truth: the PreToolUse hook fires on the real `Skill` call, so a
    response that only *narrates* the escalation ("Shall I generate Ancestry
    URLs?") cannot satisfy it, and a response that genuinely delegates cannot
    be marked down for it. The judge has gotten this wrong in both directions
    — scoring Correctness=1 for "failed to call search-external-sites" on a
    run where the hook recorded the call.

    Tag-gated: only the nil-exhaustion escalation test asserts this. Ordinary
    search tests must NOT escalate, and negative routing tests are graded on
    routing instead.
    """
    if "familysearch-exhausted" not in test.get("tags", []):
        pytest.skip("only the FamilySearch-exhaustion escalation test")
    assert "search-external-sites" in skills_invoked, (
        "FamilySearch was exhausted across name variants, so the skill had to "
        "invoke Skill('search-external-sites'). Offering it in prose is not "
        f"escalating. skills_invoked={skills_invoked}"
    )


def test_live_callee_used_its_own_tools(tool_calls, skills_invoked, test):
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
    if "live-callee" not in test.get("tags", []):
        pytest.skip("only the live-callee seam test")
    # Delegation first: without it the tool assert below is satisfiable the
    # wrong way. `run_skills` puts `external_links_search` in the SESSION
    # allowlist and stocks its fixture, so `search-records` can call it on the
    # main thread, never invoke Skill(), and still show the tool in
    # `tool_calls` — the seam this test exists for would be untested and green.
    #
    # Nothing else covers it: this test's own `judge_context` forbids the judge
    # from grading delegation, and the validator it defers to
    # (test_escalates_to_external_sites_after_fs_exhaustion) gates on the
    # `familysearch-exhausted` tag, which ut_search_records_026 does not carry
    # — it skips, and a skipped validator is recorded `passed: true`.
    assert "search-external-sites" in skills_invoked, (
        "the callee was declared under execution.run_skills, so this test's "
        "whole subject is the caller/callee seam — but Skill("
        "'search-external-sites') was never invoked. Calling its tools "
        "directly from the main thread is the failure this asserts against, "
        f"not a pass. skills_invoked={skills_invoked}"
    )
    called = {c.get("tool", "").split("__")[-1] for c in (tool_calls or [])}
    assert "external_links_search" in called, (
        "search-external-sites was allowed to run, so it had to reach its own "
        "tools — external_links_search is what turns a place into real "
        "third-party collection links. Absent, the skill can only have "
        f"invented any URLs it presented. tools called: {sorted(called)}"
    )


def test_capture_pending_item_not_terminal(before_state, after_state, test):
    """Issue #1226 — a plan item awaiting an external-site capture must not be
    `completed`/`skipped`. Shared with the other suite that can reach this
    state; the assertion lives in validators_lib."""
    _assert_capture_pending_item_not_terminal(before_state, after_state, test)

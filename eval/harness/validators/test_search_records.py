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


# Period familiar/diminutive forms, keyed by the formal given name as it
# appears on a scenario tree. Curated deliberately: whether a name is a
# diminutive of another is genealogical knowledge, not a string operation —
# "Eliza" and "Elisabeth" sit at the same edit distance from "Elizabeth" and
# only one of them is the behavior under test. Extend this table when a new
# scenario needs it; a genealogist can review a list, not a heuristic.
FAMILIAR_FORMS: dict[str, frozenset[str]] = {
    "elizabeth": frozenset(
        {
            "betty", "bettie", "bett", "bet", "betsy", "betsey", "bess",
            "bessie", "bessy", "eliza", "liza", "lizzie", "lizzy", "libby",
            "beth", "elsie", "tetty",
        }
    ),
}


def test_diminutive_given_name_tried(tool_calls, before_state, test):
    """Tag-gated (diminutive-given-name-variant): when a search under the
    formal given name returns a pool that does not contain the target, the
    skill must try the period diminutive as a distinct given-name VALUE.

    Deterministic gate for ut_search_records_b3v. Graded here rather than by
    the LLM judge because "did the skill ever send a genuinely different given
    name" is ground truth in the tool-call log, while the judge has to reason
    about whether the returned pool was good enough — and the failure this
    test captures is silent: across three committed runs of the
    young-marriage-1828 e2e fixture the agent issued 78 record_search calls,
    never varied the given name off "Elizabeth", and missed required finding f3
    every time.

    "A period diminutive" is defined by the curated FAMILIAR_FORMS table below,
    NOT by string distance from the tree name. An earlier revision of this test
    used "neither contains nor is contained by any tree given name", which is
    broken in both directions and was caught in review before it ever ran:

    * False pass. That rule accepts ANY unrelated name. This scenario's tree
      carries only "Elizabeth" and "Thomas", so re-measuring the three mined
      young-marriage-1828 runs — the exact runs this test exists to catch —
      their givenName values included "Mary Ann", "Robert", "John", "Evan" and
      "James", every one of which counted as "genuinely different". The gate
      would have passed the failure it was written to detect.
    * False fail. "Eliza" is contained by "Elizabeth", so it was rejected even
      though this test's own judge_context lists it as a correct attempt.

    Spelling variants still do not count: "Elisabeth" is absent from the table
    by design, because respelling the formal name is not the behavior under
    test. Neither is "Elizabeth Ann".

    Deliberately does NOT assert which diminutive, how many searches were run,
    or that the target was found — the fixture decides what comes back, and
    other narrowing levers alongside the diminutive are legitimate.
    """
    if "diminutive-given-name-variant" not in test.get("tags", []):
        pytest.skip("not a diminutive-given-name-variant scenario")

    searches = [
        c for c in (tool_calls or [])
        if c.get("tool", "").split("__")[-1] == "record_search"
    ]
    assert searches, "expected at least one record_search call; got none"

    tree = (
        before_state.get("tree_gedcomx")
        or before_state.get("tree_gedcomx_json")
        or {}
    )
    tree_names = [
        (
            str(name.get("given") or "").strip().lower(),
            str(name.get("surname") or "").strip().lower(),
        )
        for person in (tree.get("persons") or [])
        for name in (person.get("names") or [])
    ]
    formal = {given for given, _ in tree_names if given}
    tree_surnames = {surname for _, surname in tree_names if surname}
    if not formal:
        pytest.skip("scenario tree carries no given name to compare against")

    # Accept every familiar form of every formal given name on the tree.
    accepted: set[str] = set()
    for given in formal:
        accepted |= FAMILIAR_FORMS.get(given, frozenset())
    if not accepted:
        pytest.skip(
            "no FAMILIAR_FORMS entry for this scenario's tree given names "
            f"({sorted(formal)}); add one before tagging a test with "
            "diminutive-given-name-variant"
        )

    def given_values(call: dict) -> set[str]:
        """Both given-name slots. `givenNameAlt` is a real way to try the
        diminutive — it UNIONs the two names in a single call (spec §"Setting
        surnameAlt or givenNameAlt performs a UNION"), so a run that sends
        givenName=Elizabeth + givenNameAlt=Betty has tried Betty and must not
        be failed for it.
        """
        args = call.get("args") or {}
        return {
            str(args.get(key) or "").strip().lower()
            for key in ("givenName", "givenNameAlt")
        } - {""}

    def targets_subject(call: dict) -> bool:
        """A qualifying call must not be aimed at a different family. Only
        checked when the call carries a surname at all — the anchor rule lets
        `recordCountry` stand in for one.
        """
        args = call.get("args") or {}
        sent = {
            str(args.get(key) or "").strip().lower()
            for key in ("surname", "surnameAlt")
        } - {""}
        if not sent or not tree_surnames:
            return True
        return any(s in t or t in s for s in sent for t in tree_surnames)

    tried: set[str] = set()
    qualifying: set[str] = set()
    for call in searches:
        values = given_values(call)
        tried |= values
        if targets_subject(call):
            qualifying |= values & accepted

    assert qualifying, (
        "no record_search tried a period familiar form of the subject's given "
        f"name. Formal name(s) on the tree: {sorted(formal)}; familiar forms "
        f"that would have counted: {sorted(accepted)}; given-name values "
        f"actually sent (givenName + givenNameAlt): {sorted(tried)}. "
        "FamilySearch's default fuzzy matching covers abbreviations (Wm -> "
        "William) and some nicknames, but its coverage is partial and cannot "
        "be relied on to reach a given diminutive — a top-100 sample of fuzzy "
        "'Elizabeth' held Eliza and Betsy but no Betty. So the target may be "
        "unreachable from the formal name alone."
    )

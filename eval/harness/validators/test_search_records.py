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
from validators_lib import namesake_bare_id as _namesake_bare_id
from validators_lib import assert_namesake_warning_handed_back as _assert_namesake_warning_handed_back
from validators_lib import record_search_sent as _record_search_sent
from validators_lib import response_strings as _response_strings
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

    Tag-gated: only the escalation tests assert this -- FamilySearch exhausted
    across variants, or a record set FamilySearch holds no collection for (issue
    #4139). Ordinary search tests must NOT escalate.
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


# A claim that a record set sits at one repository alone. "held at NY State
# Library only" is the #4130 wording; the rest are its common rewordings. The
# first alternative stops at `,` and `;` so an unrelated "only" later in the
# sentence ("held at the NYSL, and only 1855 onward is on FamilySearch") is not
# read as part of the claim; "only at" before a year ("holdings begin only at
# 1855") is a date, not a place; "only in" is left out because "found only in the
# 1849 directory" reports a search result, not a holding.
_SOLE_REPOSITORY_CLAIM = re.compile(
    r"\bheld at [^.,;\n|]{0,60}\bonly\b"
    r"|\b(?:held|available|found|kept|exists?) only (?:at|by)\b"
    r"|\bonly (?:held|available|found|kept) (?:at|by)\b"
    r"|\bonly at\b(?! \d)"
    r"|\([^()\n]{0,60}(?:Library|Archives?|Society)[^()\n]{0,10}\bonly\)"
    r"|\bsole (?:repository|holder|source|custodian)\b"
    r"|\bnot available (?:elsewhere|anywhere else)\b"
    r"|\bno other (?:repository|archive|site)\b"
    r"|\bexclusively (?:at|held|from|by)\b",
    re.I,
)


def test_no_sole_repository_claim(agent_returns, text_response, test):
    """Issue #4139 -- the agent must not say a record set is held only at one
    repository, or is not available elsewhere. It has no tool that checks outside
    holdings; which outside sites hold the set is `search-external-sites`' answer.

    Reads the agent's own return (`subject_reply_text`), never the dispatcher's
    relay, so a relay cannot fail a clean agent.

    Tag-gated: only the no-FamilySearch-collection test asserts this.
    """
    from harness.skill_runner import subject_reply_text

    if "no-sole-repository-claim" not in test.get("tags", []):
        pytest.skip("only the no-FamilySearch-collection test")
    reply = subject_reply_text(agent_returns, text_response, "search-records", test)
    found = _SOLE_REPOSITORY_CLAIM.search(reply)
    assert found is None, (
        "the return claims a record set is held at one repository alone, which no "
        f"tool checked: {found.group(0)!r} in {reply[:600]!r}"
    )


def test_searched_before_no_collection_hand_back(tool_calls, test):
    """Issue #4139 -- Step 8 item 7 hands back a record set FamilySearch holds no
    collection for only after one logged `record_search`. A run that hands back on
    the wiki page alone has no search behind its "not on FamilySearch", and one
    observed run then logged a search it never ran.

    Tag-gated with `test_no_sole_repository_claim`.
    """
    if "no-sole-repository-claim" not in test.get("tags", []):
        pytest.skip("only the no-FamilySearch-collection test")
    searches = [c for c in (tool_calls or []) if _bare_tool_name(c.get("tool")) == "record_search"]
    assert searches, (
        "the agent reported the record set not on FamilySearch without running a "
        "record_search; Step 8 item 7 requires one logged search first"
    )


# --- Outside holdings must come from a tool response (issue #4352) -----------

# The outside sites the agent body names (Ancestry, MyHeritage, FindMyPast,
# FindAGrave, Newspapers.com), plus "other sites", which no tool can ground.
_SITE_NAMES = (
    r"ancestry(?:\.com)?|myheritage(?:\.com)?|find ?my ?past(?:\.com)?"
    r"|find ?a ?grave(?:\.com)?|newspapers\.com"
)
_GENERIC_SITES = r"other (?:genealogy )?sites?|another (?:genealogy )?site|other repositor(?:y|ies)"
_OUTSIDE_SITE = re.compile(rf"\b(?:{_SITE_NAMES}|{_GENERIC_SITES})\b", re.I)
# A word saying a site holds, indexes or has a record set. Started from PR
# #4229's strict check (commit 7319cd9d6). "surviving" is not one: it describes
# the records, not who holds them. Hedged "may have it" is not one either.
_HOLDING_WORD = re.compile(
    r"(?<!FamilySearch )\b(?:hold|holds|held|index|indexes|indexed|digiti[sz](?:e|es|ed)|hosts?|hosted"
    r"|carr(?:y|ies)|available|offers?|contains?|providers?"
    r"|has (?:the |these |those |its |some |many |all )?(?:[\w-]+ ){0,3}?"
    r"(?:census(?:es)?|records|schedules|rolls|images|years|collections?|index(?:es)?|returns|registers)"
    r"|found (?:on|at)|(?:is|are|was|were) (?:now )?(?:on|at))\b",
    re.I,
)
_NEGATED = re.compile(r"\b(?:not|never|no longer)\s+(?:\w+\s+)?$|n't\s+(?:\w+\s+)?$", re.I)
# "No 1825 census is available on Ancestry", "None of it is held there": a clause
# that opens on "no"/"none" denies its holding word.
_NEGATED_CLAUSE = re.compile(r"(?:^|[,:(])\s*(?:there\s+(?:is|are|was|were)\s+)?(?:no|none)\b[^,:(]*$", re.I)
# "an Ancestry search link", "an Ancestry search is available": an offer of a
# search, not a holding.
_SEARCH_OFFER = re.compile(
    rf"\b(?:{_SITE_NAMES})(?:\s*/\s*(?:{_SITE_NAMES}))*(?:'s)?"
    rf"(?:\s+search(?:es)?\b(?:\s+(?:links?|urls?|pages?)\b)?|\s+(?:links?|urls?|pages?)\b)",
    re.I,
)
# A holding word followed at once by a holder names that holder: "indexed on
# Ancestry.com", "held at the New York State Library", and, for a word that
# already ends in on/at ("is on"), the site right after it.
_HELD_BY_SITE = re.compile(
    rf"^\W*(?:(?!(?:not|never|familysearch)\b)\w+\W+){{0,3}}?(?:on|at|by|through|via|from)\s+"
    rf"(?:the\s+)?(?:\*\*)?((?:{_SITE_NAMES}|{_GENERIC_SITES})\b)",
    re.I,
)
_SITE_RIGHT_AFTER = re.compile(rf"^\s*(?:\*\*)?((?:{_SITE_NAMES}|{_GENERIC_SITES})\b)", re.I)
_HELD_BY_OTHER = re.compile(
    r"^\W*(?:\w+\W+){0,3}?(?:on|at|by|through|via|from|in)\s+(?:the\s+)?"
    r"(?:FamilySearch|NYSL|FHL|(?:[\w.'&-]+\s+){0,6}?"
    r"(?:library|archives?|society|courthouse|office|museum|clerk))\b",
    re.I,
)
# "held on FamilySearch and Ancestry": a site listed after the other holder.
_AND_SITE = re.compile(rf"^\s*(?:,|and|or|&)\s*(?:\*\*)?((?:{_SITE_NAMES})\b)", re.I)
# "find the 1825 census on Ancestry": "find" claims a holder only when it names
# the site as where the set is.
_FIND_ON_SITE = re.compile(
    rf"\bfind\b(?:\W+\w+){{0,5}}?\W+(?:on|at)\s+(?:\*\*)?((?:{_SITE_NAMES}|{_GENERIC_SITES})\b)", re.I
)
# "Ancestry is not indexing 1825": a site the sentence negates is not a holder.
_NEGATED_AFTER_SITE = re.compile(
    r"^\W*(?:\w+\s+){0,2}?(?:not|never)\b(?!\s+(?:by\s+|on\s+|at\s+)?(?:the\s+)?FamilySearch)"
    r"|^\W*\w*n't\b",
    re.I,
)
# "Ancestry doesn't hold the 1825 census, but MyHeritage does": a site that
# stands in for an earlier holding word claims it, unless it is negated too.
_SITE_DOES_TOO = re.compile(
    rf"\b(?:but|while|whereas)\s+(?:\*\*)?((?:{_SITE_NAMES})\b)\W*\s+(?:also\s+)?"
    r"(?:does|do|did|is|are|was|were|has|have)\b(?!n't|\s+not\b)",
    re.I,
)
_ONLY_AT_SITE = re.compile(
    rf"\bonly (?:on|at|by|through|via|from)\s+(?:\*\*)?((?:{_SITE_NAMES}|{_GENERIC_SITES})\b)", re.I
)
_FAMILYSEARCH = re.compile(r"\bFamilySearch\b", re.I)
# "Ancestry and FamilySearch both hold", "Ancestry, not FamilySearch, holds":
# FamilySearch listed beside a site, as a co-holder or set aside, does not take
# the holding word from it.
_COORDINATED_BEFORE = re.compile(
    rf"(?:{_SITE_NAMES})\W*\s*(?:,|and|or|&)?\s*(?:(?:but\s+)?not|rather than|instead of)?\s*$", re.I
)
# A break needs a capital (or markup) after it, so "U.S. 1825" and "ca. 1845"
# stay whole; the same rule as test_research_plan's _SENTENCE_SPLIT_RE. A
# semicolon also ends a claim: "No FamilySearch collection is available; Ancestry
# may have it" is two statements.
_SENTENCE_BREAK = re.compile(r"(?<=[.!?])\s+(?=[A-Z*\"\u201c(\[])|;\s+")
# A fragment ending in one of these stopped at an abbreviation, not a sentence
# end: "born ca. 1845", "St. Lawrence County".
_ABBREVIATION_END = re.compile(r"\b(?:ca|c|b|d|st|co|mr|mrs|abt)\.$", re.I)
_YEAR = re.compile(r"\b(?:1[5-9]\d\d|20\d\d)\b")
_BARE_YEAR = re.compile(r"(?:\*\*)?(1[5-9]\d\d|20\d\d)(?:\*\*)?")
# A person's vital year is not the year of the record set the sentence is about:
# "born ca. 1845", "born in 1845", "d. 1910", and a lifespan after a name,
# "Patrick Flynn (1845-1910)". A bare "about 1825" or "(1825-1845)" after a
# record set ("the state censuses (1825-1845)") keeps its years.
_VITAL_BEFORE_YEAR = re.compile(
    r"\b(?:born(?:\s+(?:in|on|about|around|abt\.|ca\.|c\.|circa))?|b\.|ca\.|c\.|circa|d\.|died(?:\s+in)?"
    r"|aged|abt\.)\s*~?$",
    re.I,
)
_LIFESPAN = re.compile(
    r"(\b(?!(?:Census|Censuses|Records|Schedules|Index|Indexes|Collection|Collections|Registers|Lists"
    r"|Rolls|Returns|Directory|Directories|Lists)\b)[A-Z][\w'-]+\s*)"
    r"\(\s*~?\d{4}\s*[-\u2013\u2014]\s*~?\d{4}\s*\)"
)
_YEAR_RANGE = re.compile(r"\b(1[5-9]\d\d|20\d\d)\s*[-\u2013\u2014]\s*(1[5-9]\d\d|20\d\d)\b")
_SITE_HOST = re.compile(
    r"https?://(?:[\w-]+\.)*(ancestry|myheritage|findmypast|findagrave|newspapers)\.[a-z.]+", re.I
)
# A list line that opens on a year and links a site later on the same line:
# `* **1870** [United States, Census, 1870](…) … *Also at: [Ancestry](…)*`.
_LIST_LINE_YEAR = re.compile(r"\s*(?:[*+-]\s+)?(?:\*\*)?(1[5-9]\d\d|20\d\d)\b")


def _claim_sentences(text: str) -> list[str]:
    sentences: list[str] = []
    for line in re.split(r"\n+", text or ""):
        pending = ""
        for part in _SENTENCE_BREAK.split(line):
            pending = f"{pending} {part}" if pending else part
            if _ABBREVIATION_END.search(pending):
                continue
            sentences.append(pending)
            pending = ""
        if pending:
            sentences.append(pending)
    return sentences


def _record_years(text: str) -> set[int]:
    text = _LIFESPAN.sub(lambda m: m.group(1), text or "")
    return {
        int(m.group(0))
        for m in _YEAR.finditer(text)
        if not _VITAL_BEFORE_YEAR.search(text[: m.start()])
    }


def _site_key(name: str) -> str:
    """`ancestry` / `myheritage` / `findmypast` / `findagrave` / `newspapers`, or
    "other sites", which no tool response can ground."""
    flat = name.lower().replace(" ", "")
    for key in ("ancestry", "myheritage", "findmypast", "findagrave", "newspapers"):
        if flat.startswith(key):
            return key
    return "other sites"


def _claimed_sites(sentence: str) -> set[str]:
    """The outside sites a sentence says hold a record set. Each holding word is
    tied to one holder: the site it goes on to name ("indexed on Ancestry.com",
    "is on Ancestry"), another repository it names ("held at the New York State
    Library" -- no outside claim), or else the sites named before it since the
    previous holding word. A negated word claims nothing, and neither does one
    FamilySearch owns -- "FamilySearch" stands between it and those sites ("No
    FamilySearch collection is available for 1835, so I could not search
    Ancestry") -- unless FamilySearch is listed beside a site as a co-holder.
    "only on Ancestry" claims Ancestry whatever else the sentence says, and so
    does "…, but Ancestry does" after a holding word."""
    text = _SEARCH_OFFER.sub(lambda m: " " * len(m.group(0)), sentence)
    sites = [(m.start(), m.end(), _site_key(m.group(0))) for m in _OUTSIDE_SITE.finditer(text)]
    sites = [(s, e, key) for s, e, key in sites if not _NEGATED_AFTER_SITE.match(text[e:])]
    claimed = {_site_key(m.group(1)) for m in _ONLY_AT_SITE.finditer(text)}
    claimed |= {
        _site_key(m.group(1))
        for m in _FIND_ON_SITE.finditer(text)
        if not _NEGATED.search(text[: m.start()])
    }
    claimed |= {
        _site_key(m.group(1))
        for m in _SITE_DOES_TOO.finditer(text)
        if _HOLDING_WORD.search(text, 0, m.start())
    }
    segment_start = 0
    for m in _HOLDING_WORD.finditer(text):
        before, after = text[: m.start()], text[m.end():]
        at = _HELD_BY_SITE.match(after)
        if at is None and re.search(r"\b(?:on|at)$", m.group(0), re.I):
            at = _SITE_RIGHT_AFTER.match(after)
        if _NEGATED.search(before) or _NEGATED_CLAUSE.search(before):
            pass
        elif at is not None:
            claimed.add(_site_key(at.group(1)))
        elif (other := _HELD_BY_OTHER.match(after)) is not None:
            also = _AND_SITE.match(after[other.end():])
            if also is not None:
                claimed.add(_site_key(also.group(1)))
        else:
            start = segment_start
            for fs in _FAMILYSEARCH.finditer(text, segment_start, m.start()):
                if not _COORDINATED_BEFORE.search(text[: fs.start()]):
                    start = fs.end()
            claimed |= {key for s, e, key in sites if s >= start and e <= m.start()}
        segment_start = m.end()
    return claimed


def _linked_sites(text: str) -> set[str]:
    return {m.group(1).lower() for m in _SITE_HOST.finditer(text or "")}


def _markdown_groundings(text: str) -> set[tuple[str, int]]:
    """(site, year) pairs a wiki page ties together. Three shapes: a table row
    with a bare-year cell and a cell linking the site (`| 1855 | … | at
    [Ancestry](…) |`); a table cell linking the site under a year in the nearest
    earlier all-year row (the federal grid); a list line opening on a year."""
    pairs: set[tuple[str, int]] = set()
    year_row: list[str] | None = None
    for line in (text or "").split("\n"):
        stripped = line.strip()
        if not stripped.startswith("|"):
            year_row = None
            m = _LIST_LINE_YEAR.match(line)
            if m:
                pairs |= {(site, int(m.group(1))) for site in _linked_sites(line[m.end():])}
            continue
        cells = [c.strip() for c in stripped.strip("|").split("|")]
        filled = [c for c in cells if c]
        if filled and all(_BARE_YEAR.fullmatch(c) for c in filled):
            year_row = cells
            continue
        row_year = next(
            (int(m.group(1)) for c in cells if (m := _BARE_YEAR.fullmatch(c))), None
        )
        for j, cell in enumerate(cells):
            sites = _linked_sites(cell)
            if not sites:
                continue
            year = row_year
            if year is None and year_row is not None and j < len(year_row):
                m = _BARE_YEAR.fullmatch(year_row[j])
                year = int(m.group(1)) if m else None
            if year is not None:
                pairs |= {(site, year) for site in sites}
    return pairs


def _as_year(value) -> int | None:
    try:
        year = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return year if 1500 <= year <= 2099 else None


def _link_years(link: dict) -> set[int]:
    start = _as_year(link.get("startYear", link.get("start_year")))
    end = _as_year(link.get("endYear", link.get("end_year")))
    if start is not None or end is not None:
        start, end = (start if start is not None else end), (end if end is not None else start)
        return set(range(start, end + 1)) if start <= end else set()
    text = str(link.get("linkText") or link.get("link_text") or "")
    years = {int(y) for y in _YEAR.findall(text)}
    for lo, hi in _YEAR_RANGE.findall(text):
        if int(lo) <= int(hi):
            years |= set(range(int(lo), int(hi) + 1))
    return years


def _link_groundings(value, _depth: int = 0) -> set[tuple[str, int]]:
    """(site, year) for every object in a response that links a site and dates
    it: an `external_links_search` result, or a stored external-collections row
    read back through `research_query`. Years come from `startYear`/`endYear`
    (`start_year`/`end_year` on a stored row), else from the years the link text
    names -- a written range ("1768-1801") in full, other years one by one."""
    pairs: set[tuple[str, int]] = set()
    if _depth > 12:
        return pairs
    if isinstance(value, str) and value.lstrip()[:1] in "[{":
        try:
            value = json.loads(value)
        except ValueError:
            return pairs
    if isinstance(value, list):
        for item in value:
            pairs |= _link_groundings(item, _depth + 1)
    elif isinstance(value, dict):
        sites = _linked_sites(str(value.get("url") or ""))
        if sites:
            pairs |= {(site, year) for site in sites for year in _link_years(value)}
        for item in value.values():
            pairs |= _link_groundings(item, _depth + 1)
    return pairs


def _tool_groundings(tool_calls) -> set[tuple[str, int]]:
    pairs: set[tuple[str, int]] = set()
    for call in tool_calls or []:
        if not isinstance(call, dict):
            continue
        response = call.get("response")
        pairs |= _link_groundings(response)
        for text in _response_strings(response):
            pairs |= _markdown_groundings(text)
    return pairs


def report_names_no_ungrounded_outside_holding(tool_calls, agent_returns, text_response, test):
    """Issue #4352 -- a sentence saying an outside site holds a record set must be
    backed by a tool response this run received that ties that site to that year:
    an `external_links_search` link whose years cover it, or a wiki table cell or
    list line linking the site under that year. Grounded per (site, year), not per
    site: the New York census wiki links Ancestry for 1855 onward, which must not
    back a claim about 1825-1845. A sentence naming no year takes the years of the
    delegation's first paragraph; with none there either it is ungrounded. "Other
    sites" is never grounded.

    Tier 2 -- reports, never gates (decided on the issue, 2026-11-09): at the
    measured rates a gate would red evals at random.

    Reads `tool_calls[].response`, what `mock_mcp.py` returned; never re-reads
    fixture files (see `test_check_warnings.report_unsourced_year_in_response`).
    Reads the agent's own return (`subject_reply_text`).
    """
    from harness.skill_runner import subject_reply_text

    if "outside-holding-claim" not in test.get("tags", []):
        pytest.skip("only the outside-holding measurement tests")
    if test.get("type") == "negative":
        pytest.skip("negative test -- the agent body does not run")
    reply = subject_reply_text(agent_returns, text_response, "search-records", test)
    if not reply.strip():
        pytest.skip("no reply to check")

    stated = str(test.get("delegation") or test.get("user_message") or "")
    fallback_years = _record_years(re.split(r"\n\s*\n", stated, maxsplit=1)[0])
    grounded: set[tuple[str, int]] | None = None
    problems: list[str] = []
    for sentence in _claim_sentences(reply):
        sites = sorted(_claimed_sites(sentence))
        if not sites:
            continue
        if grounded is None:
            grounded = _tool_groundings(tool_calls)
        years = _record_years(sentence) or fallback_years
        if not years:
            missing = [f"{site} (no year)" for site in sites]
        else:
            missing = [
                f"{site} {year}"
                for site in sites
                for year in sorted(years)
                if site == "other sites" or (site, year) not in grounded
            ]
        if missing:
            problems.append(f"{sentence.strip()[:300]!r} [no tool response ties: {', '.join(missing)}]")
    if problems:
        raise AssertionError(
            "the reply says an outside site holds a record set, and no tool response "
            "this run received ties that site to that year: " + " | ".join(problems)
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
# Every entry but ut_search_records_no_fs_collection (a New York state census,
# which reads the state's page) is the SAME stem because every other census
# scenario in this suite is a US federal one. `England_Census` and the other `{Country}_Census` branches of the
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
    "ut_search_records_no_fs_collection": "wiki-read-new-york-census",
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
    record found in the results of a search or read the row cites, as a result or
    as a member of a result's record, whose persona shares a given word with the
    row's `name`, so a row with no stamp listed an id no cited log returned (a
    `recordArk`, a retyped id), cited the wrong log, or listed another person of
    the record (a household member's own id).
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
        assert not str(row.get("notes") or "").lstrip().startswith("pool:"), (
            f"row {row.get('id')} is a pool row, but this scenario rules a person out on a stated ground: {row}"
        )
        assert row.get("person_id") in subjects, (
            f"row {row.get('id')} is on {row.get('person_id')!r}, not a subject of the project {sorted(subjects)}"
        )
        assert set(row.get("log_entry_ids") or []) & searches, (
            f"row {row.get('id')} cites {row.get('log_entry_ids')}, none of them a record_search this run logged"
        )
        assert row.get("record_persona_ids"), (
            f"row {row.get('id')} lists {row.get('record_ids')}, none of them stamped: research_append found no "
            "persona of the row's given name for them in the cited logs' results or their records' persons. "
            "Copy the namesake's own recordId verbatim, never recordArk or another household member's id"
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
    if "namesake-warning" not in test.get("tags", []):
        pytest.skip("not a namesake-warning scenario")
    _assert_namesake_warning_handed_back(tool_calls, agent_returns, text_response, "search-records")


# --- Pool rows and the other parents ground (issue #3363, PR 3) -------------
#
# The planted record ids are named here, as `I1` is above, because a test file
# cannot carry them: unit-test.schema.json is closed (additionalProperties false).

#: Two 1845 baptisms of a Patrick Flynn in Aghamore, Mayo, a son of Thomas
#: (the tree's parent) and a son of Michael, met on a search for the subject's
#: parents (record-search-flynn-1845-baptisms-pool).
POOL_BAPTISM_IDS = ("Q7FB-T45", "Q7FB-M45")
#: Two marriages of a Patrick Flynn, met on a search for his wife
#: (record-search-flynn-1870-marriages-other-parents): the groom of the first is
#: a son of Thomas, of the second a son of Michael.
MARRIAGE_MATCHING_PARENTS_ID = "Q7FM-T70"
MARRIAGE_OTHER_PARENTS_ID = "Q7FM-M70"


def test_namesake_pool_row_recorded(before_state, after_state, test):
    """Tag-gated (namesake-pool-row): two people of the subject's name who cannot
    both be him, neither tied to him nor ruled out, are recorded as ONE pool row:
    `record_ids` empty, since either may be the subject, `notes` starting `pool:`
    and naming both records, citing the search that met them.

    The scenario's search is for the subject's parents, so the router hands the
    `subject` block without them and neither baptism is tied or ruled out: a
    second row marking the son of Michael as a namesake on the other-parents
    ground fails the one-row count.
    """
    if "namesake-pool-row" not in test.get("tags", []):
        pytest.skip("not a namesake-pool-row scenario")
    rows = _new_section_entries(before_state, after_state, "namesakes")
    assert len(rows) == 1, f"expected exactly one namesakes row, the pool, and got {len(rows)}: {rows}"
    row = rows[0]
    research = after_state.get("research_json") or {}
    subjects = set((research.get("project") or {}).get("subject_person_ids") or [])
    assert row.get("person_id") in subjects, (
        f"the pool row is on {row.get('person_id')!r}, not a subject of the project {sorted(subjects)}"
    )
    assert row.get("record_ids") == [], (
        f"a pool row lists none of its candidates in record_ids, since any may be the subject: {row.get('record_ids')}"
    )
    notes = str(row.get("notes") or "")
    assert notes.lstrip().startswith("pool:"), f"a pool row's notes start 'pool:': {notes[:120]!r}"
    unnamed = [rid for rid in POOL_BAPTISM_IDS if rid not in notes]
    assert not unnamed, f"the pool row's notes do not name the candidate record(s) {unnamed}: {notes[:300]!r}"
    searches = {
        e.get("id") for e in _new_log_entries(before_state, after_state) if e.get("tool") == "record_search"
    }
    assert set(row.get("log_entry_ids") or []) & searches, (
        f"the pool row cites {row.get('log_entry_ids')}, none of them a record_search this run logged"
    )


def test_namesake_other_parents_row(before_state, after_state, test):
    """Tag-gated (namesake-other-parents): of two people of the subject's name,
    the one whose parents differ from the `subject` block's is ruled out on that
    ground and recorded; the one whose parents match may still be the subject
    and is not. One row, and so no pool."""
    if "namesake-other-parents" not in test.get("tags", []):
        pytest.skip("not a namesake-other-parents scenario")
    rows = _new_section_entries(before_state, after_state, "namesakes")
    assert len(rows) == 1, f"expected exactly one namesakes row, and got {len(rows)}: {rows}"
    listed = {_namesake_bare_id(r) for r in rows[0].get("record_ids") or []}
    assert MARRIAGE_OTHER_PARENTS_ID in listed, (
        f"the row lists {sorted(listed)}, not the son of Michael's marriage {MARRIAGE_OTHER_PARENTS_ID}"
    )
    assert MARRIAGE_MATCHING_PARENTS_ID not in listed, (
        f"the row lists {MARRIAGE_MATCHING_PARENTS_ID}, whose groom's parents match the subject's: he may still be the subject"
    )


PARENT_NAME_FIELDS = ("fatherGivenName", "fatherSurname", "motherGivenName", "motherSurname")
SOURCE_PIN_FIELDS = ("collectionId", "batchNumber")
CHILD_PLACE_FIELDS = ("birthPlace", "residencePlace", "anyPlace")


def _sent(args, fields):
    return sorted({f"{f}={args[f]}" for f in fields if args.get(f)})


def test_children_enumeration_unpinned(tool_calls, test):
    """Tag-gated (children-enumeration-unpinned): issue #3948
    (maria-stockburger-son) -- a children-enumeration plan item runs at least
    one record_search that names a parent, is pinned to no single source
    (`collectionId`, `batchNumber`) and carries no place.

    Ground truth: feedback bundle 2026-10-28T11-47-20, build 8728d29f3 -- every
    children search was pinned to collection 3015626 or 1395660, and the four
    children indexed only in 1473000 never surfaced; Andreas is indexed under
    "Sankt Georgen, Freiburg", so a Villingen place misses him as well. The
    scenario's catch-all fixtures answer a pin to 1473000, a batch pin and a
    place-anchored search alike, so the judge cannot tell them apart; this
    check can.

    A call the tool refused (`is_error`) does not count. A field whose value is
    null or "" was not sent as a filter.
    """
    if "children-enumeration-unpinned" not in test.get("tags", []):
        pytest.skip("not a children-enumeration-unpinned scenario")
    parent_searches = [
        _as_mapping(c.get("args"))
        for c in (tool_calls or [])
        if _bare_tool_name(c.get("tool", "")) == "record_search"
        and c.get("is_error") is not True
        and any(_as_mapping(c.get("args")).get(f) for f in PARENT_NAME_FIELDS)
    ]
    assert parent_searches, "no record_search named a parent: the children enumeration never ran"
    unpinned = [a for a in parent_searches if not _sent(a, SOURCE_PIN_FIELDS)]
    assert unpinned, (
        "every record_search naming a parent was pinned to one source "
        f"({sorted({s for a in parent_searches for s in _sent(a, SOURCE_PIN_FIELDS)})}); "
        "a children enumeration needs one parent-name search with no collectionId or batchNumber"
    )
    place_free = [a for a in unpinned if not _sent(a, CHILD_PLACE_FIELDS)]
    assert place_free, (
        "every unpinned parent-name record_search still carried a place "
        f"({sorted({s for a in unpinned for s in _sent(a, CHILD_PLACE_FIELDS)})}); "
        "the children-enumeration search clears birthPlace, residencePlace and anyPlace"
    )


# --- Issue #2213 PR 3: unproven surnames --------------------------------

def _calls_named(tool_calls, *names) -> list[dict]:
    wanted = set(names)
    return [
        c for c in (tool_calls or [])
        if _bare_tool_name(c.get("tool") or "") in wanted
    ]


def _norm_name(value) -> str:
    return re.sub(r"[^a-z]", "", str(value or "").lower())


def _same_name(a, b, width: int) -> bool:
    a, b = _norm_name(a), _norm_name(b)
    n = min(width, len(a), len(b))
    return n > 0 and a[:n] == b[:n]


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
    hers and whose `surname` or `surnameAlt` is that surname (a wildcard such as
    `Fenst*` counts when up to its first six letters match, as does a variant
    spelling such as Fenstermacher). The caution belongs on the tree, so
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
    target = _norm_name(surname)

    def under_it(value) -> bool:
        v = _norm_name(value)
        n = min(len(v), len(target), 6)
        return n >= 4 and v[:n] == target[:n]

    hit = [
        a for a in calls
        if _same_name(a.get("givenName"), given, len(_norm_name(given)))
        and (under_it(a.get("surname")) or under_it(a.get("surnameAlt")))
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

"""Skill-specific validators for the search-external-sites skill.

search-external-sites generates pre-filled search URLs for the fifteen
external sites `build_external_search_url` supports (five subscription sites
and ten free archives) and walks the user through the click-capture workflow.

URL composition quality and capture-guidance narrative live in the
rubric — graded by the LLM judge. Mechanical checks (a log entry was
written with the right shape for a URL-generation-only turn) live here.

See test_universal.py module docstring for the validator function-
signature contract. The `test` argument is the parsed test JSON dict
(the inner "test" block) — used to gate test-specific checks on
`test["tags"]`.
"""

from __future__ import annotations

import pytest

from validators_lib import new_log_entries as _new_log_entries
from validators_lib import (
    assert_capture_pending_item_not_terminal as _assert_capture_pending_item_not_terminal,
)
from validators_lib import assert_log_append_only as _assert_log_append_only
from validators_lib import (
    assert_only_writes_to_sections as _assert_only_writes_to_sections,
)
from validators_lib import bare_tool_name as _bare_tool_name


# --- Structural rules from SKILL.md -----------------------------------

def test_positive_appends_external_site_log_entry(before_state, after_state, test):
    """Positive search-external-sites tests must append a `tool: external_site`
    log entry. The skill's whole purpose is to record the URL-generation step
    in the research log so later turns can pick up the capture."""
    if test.get("type") != "positive":
        pytest.skip("only positive tests record log entries")
    if before_state.get("research_json") is None:
        pytest.skip("no research.json in scenario")
    new_entries = _new_log_entries(before_state, after_state)
    external = [e for e in new_entries if e.get("tool") == "external_site"]
    assert external, (
        f"expected at least one new log entry with tool='external_site'; "
        f"new entries: {[e.get('tool') for e in new_entries]}"
    )


def test_url_generation_log_entry_shape(before_state, after_state, test):
    """A new external_site log entry that records a URL-generation step
    (`outcome: "partial"` — in-flight, awaiting capture) must have a non-empty
    `external_site.url_generated` and `external_site.capture_received: false`.
    Entries with other outcomes (a capture analyzed, or a nil result reported
    with `outcome: "negative"`) are not URL-generation steps and are graded by
    the rubric's Log entry dimension instead."""
    if test.get("type") != "positive":
        pytest.skip("only positive tests record log entries")
    if before_state.get("research_json") is None:
        pytest.skip("no research.json in scenario")
    new_entries = _new_log_entries(before_state, after_state)
    external = [
        e for e in new_entries
        if e.get("tool") == "external_site" and e.get("outcome") == "partial"
    ]
    if not external:
        pytest.skip("no URL-generation (outcome=partial) external_site log entry")

    errors: list[str] = []
    for entry in external:
        detail = entry.get("external_site") or {}
        url = detail.get("url_generated")
        if not isinstance(url, str) or not url.strip():
            errors.append(
                f"log[{entry.get('id')}].external_site.url_generated "
                f"must be a non-empty string; got {url!r}"
            )
        if detail.get("capture_received") is not False:
            errors.append(
                f"log[{entry.get('id')}].external_site.capture_received "
                f"must be false on URL-generation step; got "
                f"{detail.get('capture_received')!r}"
            )
    assert not errors, "URL-generation log-shape violations:\n  - " + "\n  - ".join(errors)


def _place_matches_rejected(birth_place: str, rejected_place: str) -> bool:
    """True when `birth_place` names the same place as `rejected_place`: the
    same string, the rejected place with broader jurisdiction appended by a
    resolver ("Pennsylvania" vs "Pennsylvania, United States"), or the rejected
    place with a finer unit prepended ("Philadelphia, Pennsylvania" encodes the
    rejected "Pennsylvania" at a finer grain), or both at once — the shape a
    place resolver actually returns ("Philadelphia, Pennsylvania, United
    States"). Compared casefolded as a contiguous run of exactly as many
    comma-segments as `rejected_place` itself has, at any offset — so two
    different places sharing only a leaf name ("Paris, Texas, United States"
    vs the rejected "Paris, France", a common pair for towns named after Old
    World cities) do not collide: the rejected value's own context has to
    line up too."""
    rejected = _place_key(rejected_place)
    segments = _place_key(birth_place)
    n = len(rejected)
    if len(segments) < n:
        return False
    return any(segments[i : i + n] == rejected for i in range(len(segments) - n + 1))


def _place_key(place: str) -> tuple[str, ...]:
    """A place string's comma-segments, stripped and casefolded."""
    return tuple(s.strip().casefold() for s in place.split(","))


#: The attributes that reach a *birthplace* slot, per site, in the order the
#: tool's own table falls back through them (spec §4). Only the sites with a
#: fallback are listed; every other site is `("birthPlace",)`.
#:
#: `birthPlace` is judged on EVERY site, including the six whose table has no
#: place field at all. That is deliberate and is pinned by
#: `test_fires_on_any_site_regardless_of_its_own_url_parameter_name`: passing
#: a rejected birthplace is the model asserting a fact the project already
#: resolved against, and it is that judgement this check grades — not whether
#: the target site happened to have a slot to drop it into. A review pass
#: read the no-slot sites as false positives and was wrong on exactly this
#: point.
#:
#: The narrowing applies only to the FALLBACK fields. `deathPlace` is a
#: correct fact in this fixture (Patrick died in Pennsylvania, the rejected
#: BIRTHplace), so it is judged only where the tool's own `?? deathPlace`
#: makes it become the birthplace slot. A site's generic event-scope place
#: (newspapers' `searchPlace`, chronicling_america's `usState`) is excluded
#: for the same reason.
#: `archives_gov` is NOT here, and its absence is load-bearing. Its place
#: parameter (`geographicReference`) was removed from the tool after live
#: measurement showed it empties the result set (spec §9, correction #4), so
#: `deathPlace` now reaches no slot on that site at all — the tool reports it
#: as an unused attribute. Leaving it in this table made the validator FAIL a
#: legitimate, tool-generated archives_gov call carrying a death place, which
#: is the over-rejection direction. This table is a hand-maintained mirror of
#: `siteWideParams`; the TypeScript side guards its own copy with a recording
#: Proxy (`RECOGNIZED_KEYS`) and nothing guards this one, so a future change to
#: a site's place parameters must be mirrored here by hand.
_PLACE_SLOT_CHAIN = {
    "findmypast": ("birthPlace", "marriagePlace", "deathPlace", "residencePlace"),
    "antenati": ("birthPlace", "deathPlace"),
    "american_ancestors": ("birthPlace", "deathPlace"),
}


def _effective_place_field(site, attrs, accepted_keys=frozenset()):
    """The one attribute whose value actually reaches the site's birthplace
    slot, or None when nothing does — the same first-present rule the tool
    applies.

    `birthPlace` is always judged: naming a place there IS the birthplace
    assertion, whatever the site does with it.

    A FALLBACK field is judged only when its value is not a place the project
    itself accepts. That exemption is what the module docstring above is about:
    this fixture's accepted death and residence places are all "Schuylkill
    County, Pennsylvania", which contains the rejected birthplace
    "Pennsylvania", so without it a legitimate marriage, death or residence
    search on a fallback site is flagged for naming its own correct place.
    `tests/tools/build-external-search-url.test.ts` asserts that exact call is
    correct ("lets a FindMyPast marriage search name its place through
    keywordsplace"), so the two halves of this PR contradicted each other
    (review round 5). Bare "Pennsylvania" through a fallback still fires: it
    matches no accepted assertion.
    """
    chain = _PLACE_SLOT_CHAIN.get(site, ("birthPlace",))
    for field in chain:
        value = attrs.get(field)
        if not (isinstance(value, str) and value.strip()):
            continue
        if field != "birthPlace" and _place_key(value) in accepted_keys:
            return None
        return field
    return None


def test_resolved_birthplace_conflict_rejected_value_not_encoded(
    before_state, after_state, tool_calls, test
):
    """Mechanical form of SKILL.md's "check conflicts[] before encoding a
    place or date" rule, scoped to resolved `birthplace` conflicts.

    The rubric already grades this from prose, which makes it a single-run
    judgment call the skill can miss (issue #1980's own corpus: `mid-research
    -flynn`'s `conflicts[]` c_001 resolves birthplace as Ireland against a
    rejected Pennsylvania, and a model has been observed encoding the
    rejected value). Encoding a rejected fact is a genealogically wrong URL,
    not a stylistic slip, so this makes the specific failure a hard,
    deterministic fail rather than leaving it to the judge alone.

    Reads the `build_external_search_url` call's own `attributes.birthPlace`
    argument directly — option 2 of issue #1950's 2026-08-27 lead ruling
    ("V1 checks the tool call's arguments instead of the URL string"),
    available now that this tool exists. An earlier draft parsed the
    generated URL string instead, which needed a per-site table of which
    query parameter carries the birthplace value and was vulnerable to a
    substring false positive: this fixture's `residencePlace` ("Schuylkill
    County, Pennsylvania") legitimately contains the rejected value
    ("Pennsylvania"), which a whole-URL substring search would have flagged
    as if it were the birthplace parameter. Reading the structured argument
    the model actually passed needs neither.

    "Rejected" is decided by comparing each competing assertion's `place`
    value against the *preferred assertion's own value*, not by id: this
    fixture's `competing_assertion_ids` for c_001 lists three assertions, two
    of which (a_002, a_009) independently say "Ireland" — only the third
    (a_012, "Pennsylvania") actually disagrees. Treating every non-preferred
    id as rejected flagged a_009's own "Ireland" as if it were a rejected
    value, which a synthetic test against this exact fixture caught before
    this landed.

    Deliberately narrow to `disputed_attribute == "birthplace"` — the
    general case (any disputed attribute) is issue #1950/V1's fuller scope.
    """
    if test.get("type") != "positive":
        pytest.skip("only positive tests generate URLs")
    research = before_state.get("research_json")
    if research is None:
        pytest.skip("no research.json in scenario")

    resolved_birthplace_conflicts = [
        c for c in (research.get("conflicts") or [])
        if c.get("conflict_type") == "fact"
        and c.get("status") == "resolved"
        and c.get("disputed_attribute") == "birthplace"
    ]
    if not resolved_birthplace_conflicts:
        pytest.skip("no resolved birthplace conflict in this scenario")

    assertions_by_id = {a.get("id"): a for a in (research.get("assertions") or [])}

    calls = [
        c for c in (tool_calls or [])
        if _bare_tool_name(c.get("tool")) == "build_external_search_url"
    ]
    if not calls:
        pytest.skip("no build_external_search_url call")

    errors: list[str] = []
    for c in resolved_birthplace_conflicts:
        preferred_id = c.get("preferred_assertion_id")
        preferred_assertion = assertions_by_id.get(preferred_id) or {}
        preferred_place = preferred_assertion.get("place")
        if not preferred_place:
            continue
        # A competing id is not automatically a rejected VALUE: two assertions
        # can independently support the same preferred value from different
        # sources (this fixture's a_002/a_009 both say "Ireland" — only a_012's
        # "Pennsylvania" actually disagrees), so the comparison is by place
        # value against the preferred assertion's own value, not by id.
        # Compared by normalized place key, not raw string: a competing
        # assertion reading "IRELAND" (a census transcription) agrees with a
        # preferred "Ireland" and must not become a rejected value that then
        # casefold-matches the correctly encoded one.
        preferred_key = _place_key(preferred_place)
        rejected_places = {
            assertions_by_id[i]["place"]
            for i in (c.get("competing_assertion_ids") or [])
            if i in assertions_by_id
            and isinstance(assertions_by_id[i].get("place"), str)
            and _place_key(assertions_by_id[i]["place"]) != preferred_key
        }
        if not rejected_places:
            continue
        # Places the project holds as facts, for the fallback-field exemption
        # in `_effective_place_field`: every assertion place for this scenario
        # that is not one of THIS conflict's rejected values. Keyed, so the
        # comparison matches the one the rejected set uses.
        rejected_keys = {_place_key(p) for p in rejected_places}
        accepted_keys = {
            _place_key(a["place"])
            for a in assertions_by_id.values()
            if isinstance(a.get("place"), str) and a["place"].strip()
            and _place_key(a["place"]) not in rejected_keys
        }
        # A place-resolution tool commonly hands back a broader-context
        # string ("Pennsylvania, United States") for what the fixture's own
        # assertion records as the bare place name ("Pennsylvania") — the
        # same rejected fact, differently formatted. An exact-string
        # comparison missed this on a live run: the model encoded the
        # reformatted value and only the LLM judge caught it.
        # `_place_matches_rejected` catches that reformatting without needing
        # the URL-string substring match this validator deliberately avoids
        # (see the module docstring above on `residencePlace` false
        # positives) — it only ever looks at the `birthPlace` argument's own
        # value, never the rendered URL. It also anchors on the rejected
        # value's own segment count, not just its first segment, so a
        # different place that merely shares a leading token with the
        # rejected one ("Paris, Texas" vs. rejected "Paris, France") cannot
        # collide with it.
        for call in calls:
            args = call.get("args") or {}
            attrs = args.get("attributes") or {}
            # Only the attribute that actually reaches the site's place slot
            # is judged — birthPlace where present, else the first fallback the
            # tool's own table applies (`_PLACE_SLOT_CHAIN`). A rejected value
            # routed through a fallback reaches the URL exactly as if passed
            # as birthPlace; anywhere else a death place naming the rejected
            # BIRTHplace is a correct death search (this fixture's own accepted
            # death is in Pennsylvania). A non-string value (`birthPlace:
            # 1845`) is real live input the tool notes; it is skipped here.
            field = _effective_place_field(args.get("site"), attrs, accepted_keys)
            if field is not None:
                value = attrs[field]
                if any(_place_matches_rejected(value, p) for p in rejected_places):
                    errors.append(
                        f"build_external_search_url call's attributes.{field}="
                        f"{value!r} is the value conflict {c.get('id')} "
                        f"rejected (preferred: {preferred_id})"
                    )
    assert not errors, "resolved birthplace-conflict rejected value passed to the tool:\n  - " + "\n  - ".join(errors)


def test_no_hand_composed_external_site_url(before_state, after_state, tool_calls, test):
    """Issue #1980 asks explicitly for "one that checks the skill called the
    tool rather than hand-writing a URL" — no such deterministic check
    existed; the rule lived only in rubric.md's Tool selection dimension,
    graded by the judge alone. A hand-composed URL is exactly the failure
    mode this tool exists to make unnecessary: every documented correction
    (the dead qs, the retired legacy host, the missing dl=page) applies only
    to a URL `build_external_search_url` actually built.

    Fires when a new `external_site` log entry presents a freshly generated
    URL — a non-empty `url_generated`, not a re-log of an already-presented
    one — but no `build_external_search_url` call appears anywhere in this
    run's tool calls at all. Does not try to match a specific log entry to a
    specific call (a run can legitimately call the tool more than once, e.g.
    a curated-link fetch plus a site-wide fallback for the same or a
    different search) — only whether the tool was used at all, which is
    what "hand-wrote instead of calling the tool" actually means.

    Grades only step 4's own entry — `outcome: "partial"`, no capture — the
    same scoping the sibling `test_url_generation_log_entry_shape` uses. Every
    step-6 re-log (the capture arrival, the user-reported nil with no capture,
    the no-access `error` entry) carries the step-4 URL again without
    generating one, and rubric.md grades the tool as not expected on those
    turns.

    Also excludes `site: "familysearch_web"` — the one `external_site` enum
    value the tool has no template for (its SUPPORTED_SITES is a subset of
    the enum). An ad-hoc URL to a site outside the fifteen is logged under
    it without any tool call, by design, so there is nothing hand-composed
    there to flag.
    """
    if test.get("type") != "positive":
        pytest.skip("only positive tests generate URLs")
    if before_state.get("research_json") is None:
        pytest.skip("no research.json in scenario")

    new_entries = _new_external_entries(before_state, after_state, "external_site")

    # A step-6 re-log carries an EARLIER entry's URL again. That is what makes
    # it a re-log, and it is the property to test — not the outcome.
    #
    # This gate used to be `outcome != "partial"`, which excluded every
    # `negative` entry. The sibling `test_the_url_logged_is_the_url_presented`
    # says in terms why that is wrong ("the autonomous-defer path logs
    # 'negative' and DOES present the URL, where this holds on 10 of 10
    # committed runs", #2345 review), and it was measured wrong here too:
    # in v1_2026-09-15_09-57-05.json, ut_search_external_sites_013 and _008
    # each logged a single `negative` entry carrying a freshly generated URL,
    # and this check skipped both — 2 of 13 positive tests. Neither was a real
    # violation (the tool was called in both), so nothing escaped; the hole was
    # that the check issue #1980 asks for by name did not grade that path at
    # all. Re-log detection closes it without re-admitting the cases the three
    # tests below pin (review round 5).
    prior_log = ((before_state.get("research_json") or {}).get("log") or [])
    seen_before = {
        (e.get("external_site") or {}).get("url_generated")
        for e in prior_log
        if isinstance((e.get("external_site") or {}).get("url_generated"), str)
    }

    def _is_fresh_url_generation(entry):
        detail = entry.get("external_site") or {}
        url = detail.get("url_generated")
        if not isinstance(url, str) or not url.strip():
            return False
        if detail.get("capture_received") is True:
            return False
        if entry.get("outcome") == "error":
            return False
        if detail.get("site") == "familysearch_web":
            return False
        # Already in the log before this run, or re-logged alongside the entry
        # that generated it this run: a re-log either way.
        if url in seen_before:
            return False
        if any(
            other is not entry
            and (other.get("external_site") or {}).get("url_generated") == url
            and other.get("outcome") == "partial"
            for other in new_entries
        ):
            return False
        return True

    url_generation_entries = [e for e in new_entries if _is_fresh_url_generation(e)]
    if not url_generation_entries:
        pytest.skip("no URL-generation external_site log entry this run")

    called_tool = any(
        _bare_tool_name(c.get("tool")) == "build_external_search_url"
        for c in (tool_calls or [])
    )
    assert called_tool, (
        "a URL-generation external_site log entry exists "
        f"(log id(s): {[e.get('id') for e in url_generation_entries]}) but "
        "build_external_search_url was never called this run — the URL was "
        "hand-composed instead of built by the tool"
    )


# --- Tag-gated no-harm invariant (grade_on_invariant negatives) ------

def test_no_external_search_or_log_on_routeaway_negative(
    before_state, after_state, tool_calls, test
):
    """Tag-gated (no-search-no-write): the search-external-sites no-harm
    invariant for any negative whose correct answer is to route away.

    search-external-sites executes a chosen external-site search — it
    generates a pre-filled URL and logs the step to research.json. A request
    that belongs to another skill must not cause a search to be EXECUTED or
    logged. This is the deterministic gate for two grade_on_invariant
    negatives:

      - `ut_search_external_sites_011` — a planning question that belongs to
        research-plan.
      - `ut_search_external_sites_012` — a single record already in hand,
        which belongs to record-extraction (issue #1519).

    Both were flaky for the same reason: the decline is correct every run, but
    its phrasing and length vary, and a longer decline that names the right
    skill was read by the activation heuristic as substantive output. Under
    grade_on_invariant the phrasing no longer decides the outcome; only
    executing or logging a search does. See docs/specs/unit-test-spec.md and
    the sibling test_search_records.py::test_no_search_or_writes_on_planning_request.

    Fails iff the run:
      - made an `external_links_search` MCP call (a search was executed), or
      - appended a new **`external_site`** `log` entry (this skill records
        every external-site search it runs).

    **The log check narrows only for 012, via `route-away-writes-own-log`.**
    011's accepted route is research-plan, which never writes `log` at all, so
    ANY new entry there means a search skill ran and the strict form is the
    real gate. 012's accepted route is record-extraction, which holds
    `research_log_append` and may legitimately write a non-`external_site`
    entry for the record it was handed — flagging that would fail 012 for
    routing correctly. Narrowing both would have silently dropped 011's gate
    (issue #1519), so the loosening is carried
    by a tag on 012 alone rather than by the shared `no-search-no-write` gate.

    Deliberately does NOT flag other research.json writes: routing to
    research-plan legitimately writes `plans`/`questions`, and record-extraction
    legitimately writes `sources`/`assertions`. Both are correct behavior.
    """
    if "no-search-no-write" not in test.get("tags", []):
        pytest.skip("not a no-search-no-write scenario")

    # 1. No external-site search executed.
    searched = [
        c for c in (tool_calls or [])
        if c.get("tool", "").split("__")[-1] == "external_links_search"
    ]
    assert not searched, (
        "a route-away request must not execute an external-site search; got "
        f"external_links_search call(s) with args: "
        f"{[c.get('args') for c in searched]}"
    )

    # 2. No new search log entry. Which entries count depends on what the
    #    accepted route is allowed to write, so the narrowing is opt-in per
    #    test rather than applied to both.
    new_entries = _new_log_entries(before_state, after_state)
    if "route-away-writes-own-log" in test.get("tags", []):
        offending = [e for e in new_entries if e.get("tool") == "external_site"]
        detail = "external_site search log entry"
    else:
        offending = new_entries
        detail = "search log entry"
    assert not offending, (
        f"a route-away request must not append a {detail}; new log ids: "
        f"{[e.get('id') for e in offending]}"
    )


# --- Tag-gated site-specific checks ----------------------------------

def test_log_site_ancestry(before_state, after_state, test):
    """Tag-gated: when the test scenario targets Ancestry, the new external_site
    log entry's `external_site.site` must be `ancestry`."""
    if "log-site-ancestry" not in test.get("tags", []):
        pytest.skip("not a log-site-ancestry scenario")
    new_entries = _new_log_entries(before_state, after_state)
    external = [e for e in new_entries if e.get("tool") == "external_site"]
    assert external, "no external_site log entry to check"
    sites = [(e.get("external_site") or {}).get("site") for e in external]
    assert "ancestry" in sites, (
        f"expected an external_site log entry with site='ancestry'; got sites={sites}"
    )


def test_log_site_myheritage(before_state, after_state, test):
    """Tag-gated: when the test scenario targets MyHeritage, the new
    external_site log entry's `external_site.site` must be `myheritage`."""
    if "log-site-myheritage" not in test.get("tags", []):
        pytest.skip("not a log-site-myheritage scenario")
    new_entries = _new_log_entries(before_state, after_state)
    external = [e for e in new_entries if e.get("tool") == "external_site"]
    assert external, "no external_site log entry to check"
    sites = [(e.get("external_site") or {}).get("site") for e in external]
    assert "myheritage" in sites, (
        f"expected an external_site log entry with site='myheritage'; got sites={sites}"
    )


def test_log_site_findmypast(before_state, after_state, test):
    """Tag-gated: when the test scenario targets FindMyPast, the new
    external_site log entry's `external_site.site` must be `findmypast`."""
    if "log-site-findmypast" not in test.get("tags", []):
        pytest.skip("not a log-site-findmypast scenario")
    new_entries = _new_log_entries(before_state, after_state)
    external = [e for e in new_entries if e.get("tool") == "external_site"]
    assert external, "no external_site log entry to check"
    sites = [(e.get("external_site") or {}).get("site") for e in external]
    assert "findmypast" in sites, (
        f"expected an external_site log entry with site='findmypast'; got sites={sites}"
    )


def test_log_site_findagrave(before_state, after_state, test):
    """Tag-gated: when the test scenario targets FindAGrave, the new
    external_site log entry's `external_site.site` must be `findagrave`."""
    if "log-site-findagrave" not in test.get("tags", []):
        pytest.skip("not a log-site-findagrave scenario")
    new_entries = _new_log_entries(before_state, after_state)
    external = [e for e in new_entries if e.get("tool") == "external_site"]
    assert external, "no external_site log entry to check"
    sites = [(e.get("external_site") or {}).get("site") for e in external]
    assert "findagrave" in sites, (
        f"expected an external_site log entry with site='findagrave'; got sites={sites}"
    )


def test_log_site_newspapers(before_state, after_state, test):
    """Tag-gated: when the test scenario targets Newspapers.com, the new
    external_site log entry's `external_site.site` must be `newspapers`."""
    if "log-site-newspapers" not in test.get("tags", []):
        pytest.skip("not a log-site-newspapers scenario")
    new_entries = _new_log_entries(before_state, after_state)
    external = [e for e in new_entries if e.get("tool") == "external_site"]
    assert external, "no external_site log entry to check"
    sites = [(e.get("external_site") or {}).get("site") for e in external]
    assert "newspapers" in sites, (
        f"expected an external_site log entry with site='newspapers'; got sites={sites}"
    )


def test_capture_pending_item_not_terminal(before_state, after_state, test):
    """Issue #1226 — a plan item awaiting an external-site capture must not be
    `completed`/`skipped`. Shared with the other suite that can reach this
    state; the assertion lives in validators_lib."""
    _assert_capture_pending_item_not_terminal(before_state, after_state, test)


# --- #1950 Half 1: V2, V3, V4, V6, V7, V8 ------------------------------
#
# FIELD NAMES ARE snake_case HERE, NOT the camelCase issue #1950 quotes.
# The issue states each rule in the MCP tool's parameter spelling
# (`stagedResultsRef`, `resultsExamined`, `planItemId`), because that is what a
# `research_log_append` call carries. These validators read `after_state`, the
# PERSISTED document, and CLAUDE.md's casing rule makes the tool boundary the
# seam between the two. Mapping taken from
# `docs/specs/schemas/research.schema.json`, not guessed:
#
#   stagedResultsRef -> results_ref      (NOT staged_results_ref)
#   resultsExamined  -> results_examined
#   planItemId       -> plan_item_id
#   externalSite     -> external_site
#
# `results_ref` is the one that bites: writing the issue's name verbatim gives a
# validator that never fires, which is the silently-green failure its own "what
# proves this worked" section warns about — nothing in CI runs these against a
# real run.
#
# `external_site` and `results_ref` are both nullable in the schema, so "must
# not carry" is a truthiness check: absent and explicitly-null are the same
# thing to a reader of the audit trail.


def _new_external_entries(before_state, after_state, tool):
    """New log entries for one tool, or [] — shared preamble of V2/V3/V4."""
    return [
        e for e in _new_log_entries(before_state, after_state)
        if e.get("tool") == tool
    ]


def _plan_items(state):
    """Every plan item in a state, keyed by id."""
    research = state.get("research_json") or {}
    return {
        item.get("id"): item
        for plan in (research.get("plans") or [])
        for item in (plan.get("items") or [])
        if item.get("id")
    }


def test_log_entries_do_not_carry_each_others_fields(before_state, after_state, test):
    """V2. SKILL.md step 4 writes two entries per search, each owning one field.

    The `external_links_search` entry carries the staged handle and must not
    carry `external_site` (SKILL.md: "Do not pass externalSite here - that field
    is only for external_site entries"); the `external_site` entry carries the
    site detail and must not carry the handle ("that handle belongs on the
    external_links_search entry above").

    No corpus violation yet - this guards a rule the skill states twice and
    nothing enforced.
    """
    if test.get("type") != "positive":
        pytest.skip("only positive tests record log entries")
    if before_state.get("research_json") is None:
        pytest.skip("no research.json in scenario")

    errors = []
    for entry in _new_external_entries(before_state, after_state, "external_links_search"):
        if entry.get("external_site"):
            errors.append(
                f"log[{entry.get('id')}] is an external_links_search entry but "
                f"carries external_site - that field belongs only on an "
                f"external_site entry"
            )
    for entry in _new_external_entries(before_state, after_state, "external_site"):
        if entry.get("results_ref"):
            errors.append(
                f"log[{entry.get('id')}] is an external_site entry but carries "
                f"results_ref - the staged handle belongs on the "
                f"external_links_search entry"
            )
    assert not errors, (
        "log entries carrying each other's fields:\n  - " + "\n  - ".join(errors)
    )


def test_curated_links_fetch_with_results_is_not_logged_as_nil(
    before_state, after_state, test
):
    """V3. On an `external_links_search` entry, results_examined > 0 requires
    outcome "positive".

    The entry grades the FETCH, not the search. Logging "none of these links fit
    my record type" as a nil records "FamilySearch curates nothing here", which
    sends a researcher to another repository; the truth - "curates plenty, none
    relevant" - sends them to a wider year window. Collapsing the two loses that
    distinction permanently in the audit trail.

    Measured 2026-09-10 against the five run logs this branch commits, reading
    `file_changes["research.json"].diff.log.added`: **4 of 66
    external_links_search entries, across three tests
    (ut_search_external_sites_002, _005, _006) and three of the five logs.**
    Issue #1950's own census said 9 of 48; the corpus has since turned over,
    so that figure is stale rather than wrong. Re-derive rather than reword.
    """
    if test.get("type") != "positive":
        pytest.skip("only positive tests record log entries")
    if before_state.get("research_json") is None:
        pytest.skip("no research.json in scenario")

    errors = []
    for entry in _new_external_entries(before_state, after_state, "external_links_search"):
        examined = entry.get("results_examined")
        if isinstance(examined, int) and examined > 0 and entry.get("outcome") != "positive":
            errors.append(
                f"log[{entry.get('id')}] examined {examined} curated link(s) but "
                f"is logged outcome={entry.get('outcome')!r} - a fetch that "
                f"returned links is not a nil result"
            )
    assert not errors, (
        "curated-links fetches mis-logged as nil:\n  - " + "\n  - ".join(errors)
    )


def test_the_url_logged_is_the_url_presented(
    before_state, after_state, text_response, test
):
    """V4. external_site.url_generated must appear verbatim in the reply.

    The log entry is the audit trail; the link is what the user clicks. If they
    differ, research.json records a search nobody ran and the user runs a search
    nobody recorded - and every other validator still passes, because each half
    is individually well-formed. This is the guard that makes the other seven
    mean something.
    """
    if test.get("type") != "positive":
        pytest.skip("only positive tests record log entries")
    if before_state.get("research_json") is None:
        pytest.skip("no research.json in scenario")

    reply = text_response or ""
    errors = []
    for entry in _new_external_entries(before_state, after_state, "external_site"):
        detail = entry.get("external_site") or {}
        # Step 6 appends a NEW entry that re-logs the step-4 URL without
        # presenting it: the capture-arrival entry (SKILL.md:439), whose reply
        # analyses the returned PDF, and the no-access entry (SKILL.md:584,
        # outcome "error"), whose reply asks whether to skip the site. The
        # schema requires url_generated on both, so without this they read as
        # a URL logged but never shown. Not scoped on outcome == "partial"
        # instead: the autonomous-defer path logs "negative" and DOES present
        # the URL, where this holds on 10 of 10 committed runs (#2345 review).
        if detail.get("capture_received") is True or entry.get("outcome") == "error":
            continue
        url = detail.get("url_generated")
        if not isinstance(url, str) or not url.strip():
            continue  # shape is test_url_generation_log_entry_shape's job
        if url not in reply:
            errors.append(
                f"log[{entry.get('id')}].external_site.url_generated is not in "
                f"the reply the user sees: {url}"
            )
    assert not errors, "URL logged but never presented:\n  - " + "\n  - ".join(errors)


def report_no_plan_item_status_written_when_no_entry_names_one(
    before_state, after_state, test
):
    """V6. When every new log entry has plan_item_id null, no plan item's status
    may change.

    **Reporting-only, deliberately: SKILL.md does not state this rule.** An
    earlier draft claimed step 7 sets a status only on a turn that names a plan
    item. It does not — `planItemId` appears twice in the 605-line body,
    :387 and :418, both as the template literal `"<pli_XXX or null>"`, and
    step 7 at :541 keys the status write on `planId` and the `entryId`, not on
    the log entry. The schema puts no description on `plan_item_id` either.
    Nine of nine corpus runs that moved a status did also write
    `plan_item_id`, but that is model habit, not a contract (#2345 review).

    Gating on a rule the shipped skill never states would fail runs for
    behaviour nobody asked for. Landing the rule in SKILL.md first would need
    a paid run and belongs with the URL-tool work on issue #1980; until then
    this observes and the judge decides.
    """
    if test.get("type") != "positive":
        pytest.skip("only positive tests record log entries")
    if before_state.get("research_json") is None:
        pytest.skip("no research.json in scenario")

    new_entries = _new_log_entries(before_state, after_state)
    if not new_entries:
        pytest.skip("no new log entries")
    if any(e.get("plan_item_id") for e in new_entries):
        pytest.skip("a new log entry names a plan item - status writes are in scope")

    before_items = _plan_items(before_state)
    changed = [
        item_id
        for item_id, item in _plan_items(after_state).items()
        if item_id in before_items
        and item.get("status") != before_items[item_id].get("status")
    ]
    assert not changed, (
        f"no new log entry names a plan item, but these plan items had their "
        f"status changed: {sorted(changed)}. A search that matches no plan item "
        f"records no plan progress."
    )


def test_plan_items_are_updated_never_appended(before_state, after_state, test):
    """V7. The skill may update an existing plan item's status; never append one.

    An executing skill records what it did. It does not add work to the plan,
    and it certainly does not add work in order to have something to mark
    finished - a manufactured item marked `skipped` reads downstream as an
    avenue considered and closed (#1226, with the item invented as well).

    **No committed run reproduces this today — measured 0 across all 80 runs
    in the five logs on this branch (2026-09-10).** An earlier draft cited
    v1_2026-08-20_22-45-06 and v1_2026-08-27_00-08-56 at "roughly two runs in
    five"; both have since been pruned by the newest-five retention this file
    describes above, so that claim can no longer be checked from anything
    committed and is not repeated here. The guard stays because the defect it
    describes is real when it happens (#1226, where the item was invented as
    well), not because the corpus currently shows it.

    Deliberately NOT assert_only_writes_to_sections(owned={"log","plans"}),
    which the issue originally specified: that permits ANY write to `plans`,
    appends included, so it would pass the defect this exists to catch. The
    helper is wired separately below as the adjacent boundary check.
    """
    if test.get("type") != "positive":
        pytest.skip("only positive tests record log entries")
    if before_state.get("research_json") is None:
        pytest.skip("no research.json in scenario")

    before_ids = set(_plan_items(before_state))
    appended = sorted(set(_plan_items(after_state)) - before_ids)
    assert not appended, (
        f"search-external-sites appended plan item(s) {appended}. It may update "
        f"the status of an item that already existed; it may never add one."
    )


def test_writes_only_to_log_and_plans(before_state, after_state, test):
    """V7, second half. The adjacent boundary: a write to `sources` or
    `assertions` is out of this skill's lane entirely.

    Gives assert_only_writes_to_sections its first call site repo-wide - it had
    zero before this. Separate from the append check above, which it cannot
    substitute for.
    """
    if test.get("type") != "positive":
        pytest.skip("only positive tests record log entries")
    if before_state.get("research_json") is None:
        pytest.skip("no research.json in scenario")
    _assert_only_writes_to_sections(
        before_state.get("research_json") or {},
        after_state.get("research_json") or {},
        owned={"log", "plans"},
        skill_name="search-external-sites",
    )


def test_the_log_is_append_only(before_state, after_state, test):
    """V8. SKILL.md says it three times: append a new entry, never edit a prior
    one. This skill writes two entries per turn and appends a third when a
    capture returns, so it has more opportunity to violate this than any other.

    Gives assert_log_append_only its second call site repo-wide.
    """
    if before_state.get("research_json") is None:
        pytest.skip("no research.json in scenario")
    _assert_log_append_only(
        before_state.get("research_json") or {},
        after_state.get("research_json") or {},
    )

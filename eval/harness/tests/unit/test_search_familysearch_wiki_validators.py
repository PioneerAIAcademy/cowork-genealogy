"""Direct tests for the search-familysearch-wiki validators.

Same reason as `test_init_project_validator.py`: `pyproject.toml` sets
`testpaths = ["tests"]`, so nothing under `validators/` is collected by
`make harness-test`, and a validator's real pass/fail set would otherwise
appear only inside a paid per-skill run.

These exist to satisfy CLAUDE.md's "a new lint must be proven to fail" rule.
Every check added under issue #1755 is exercised here against BOTH a state
that must pass and the specific state observed failing in a committed run log,
so the assertion is known to fire before it gates anything.

Since #3244 option L (U20) the deliverable is one research-log entry, not a
`.md` file, so every planted case builds `after_state["research_json"]["log"]`
and the summary text is that entry's `notes`. Each fires/passes pair the `.md`
version carried is kept against the log entry; these pairs are the durable home
of that change's break proofs.

The violating states are drawn from the #1647 deep dive:
  - `ut_search_wiki_003`, run `v1_2026-07-22_10-11-56` — saved nothing at all
    while `wiki_search` returned three results.
  - fabricated URLs in a summary: never observable before, because the saved
    file reached no grader.

The `ut_search_wiki_007` slug drift (`death-records.md` vs
`death-records-1800s.md`) went with the filename: a log entry has none.

`test_census_era_boundaries_preserved` (#2693) is exercised the same way. Its
violating state is the one `453a2f69f` reported: a summary claiming every
census lists each household member by name, age, birthplace and relationship,
which collapses the chunk's three eras into one blanket rule.
"""

import re
import sys
from pathlib import Path

import pytest

# validators/ is not a package on the import path by default.
_VALIDATORS_DIR = Path(__file__).resolve().parents[2] / "validators"
sys.path.insert(0, str(_VALIDATORS_DIR))

# Aliased away from the `test_` prefix on purpose: pytest would otherwise
# collect the imported validators as tests of this module and error on their
# harness-supplied fixtures. Same pattern as test_init_project_validator.py.
from test_search_familysearch_wiki import (  # noqa: E402
    report_reply_does_not_restate_the_logged_entry as check_brevity,
    test_census_era_boundaries_preserved as check_census_eras,
    test_empty_results_logs_one_negative as check_empty_logs_negative,
    test_no_project_returns_template as check_no_project,
    test_one_log_entry_appended as check_one_entry,
    test_sources_section_matches_wiki_results as check_sources,
    test_stated_navigation_preserved as check_nav,
)


_URL_A = "https://www.familysearch.org/en/wiki/United_States_Death_Records#Early"
_URL_B = "https://www.familysearch.org/en/wiki/Pennsylvania_Vital_Records#Death"

RESULT_A = {
    "page_title": "United States Death Records",
    "section_heading": "Early Death Records",
    "source_url": _URL_A,
}
RESULT_B = {
    "page_title": "Pennsylvania Vital Records",
    "section_heading": "Death Certificates",
    "source_url": _URL_B,
}


def _entry(notes="x", n=1, tool="wiki_search", outcome="positive",
           results_examined=1, plan_item_id=None):
    return {
        "id": f"log_{n:03d}",
        "plan_item_id": plan_item_id,
        "performed": "2026-10-13T00:00:00.000Z",
        "tool": tool,
        "query": {"query": "How do I find death records?"},
        "outcome": outcome,
        "results_examined": results_examined,
        "external_site": None,
        "results_ref": None,
        "notes": notes,
    }


def _state(*entries, **files):
    return {"research_json": {"log": list(entries)}, "files": dict(files)}


def _logged(notes):
    """A run that logged one `wiki_search` entry carrying `notes`."""
    return _state(_entry(notes))


EMPTY = _state()


def _wiki_call(*results):
    return [{
        "tool": "mcp__genealogy__wiki_search",
        "args": {"query": "How do I find death records?"},
        "response": {"results": list(results)},
    }]


def _good_file(*results):
    body = "# FamilySearch Wiki: Death Records\n\nProse paragraph.\n\n## Sources\n\n"
    for r in results:
        body += f"- [{r['page_title']} — {r['section_heading']}]({r['source_url']})\n"
    return body


def _tags(*tags, type="positive"):
    return {"type": type, "tags": list(tags)}


# --- test_one_log_entry_appended ---------------------------------------


def test_one_entry_passes_on_a_single_entry():
    check_one_entry(EMPTY, _logged(_good_file(RESULT_A)), _tags("fs-wiki"))


def test_one_entry_ignores_entries_already_in_the_log():
    before = _state(_entry(None, n=1, tool="record_search"))
    after = _state(_entry(None, n=1, tool="record_search"), _entry("x", n=2))
    check_one_entry(before, after, _tags("fs-wiki"))


def test_one_entry_fires_on_the_ut_003_nothing_saved_run():
    """The observed violation: results returned, nothing logged."""
    with pytest.raises(AssertionError, match="exactly one new log entry"):
        check_one_entry(EMPTY, EMPTY, _tags("fs-wiki"))


def test_one_entry_fires_on_a_second_entry():
    with pytest.raises(AssertionError, match="exactly one new log entry"):
        check_one_entry(EMPTY, _state(_entry("x", n=1), _entry("x", n=2)), _tags("fs-wiki"))


def test_one_entry_fires_on_the_wrong_tool():
    with pytest.raises(AssertionError, match="not 'wiki_search'"):
        check_one_entry(EMPTY, _state(_entry("x", tool="wikipedia_search")), _tags("fs-wiki"))


def test_one_entry_fires_on_a_plan_item():
    with pytest.raises(AssertionError, match="plan_item_id"):
        check_one_entry(EMPTY, _state(_entry("x", plan_item_id="plan_001_01")), _tags("fs-wiki"))


def test_one_entry_fires_on_a_md_written_alongside():
    """The pre-U20 deliverable still written next to the entry."""
    with pytest.raises(AssertionError, match="not a file"):
        check_one_entry(
            EMPTY,
            _state(_entry(_good_file(RESULT_A)), **{"death-records-1800s.md": "x"}),
            _tags("fs-wiki"),
        )


@pytest.mark.parametrize("tag", ["no-results", "no-project"])
def test_one_entry_skips_the_empty_and_no_project_paths(tag):
    with pytest.raises(pytest.skip.Exception):
        check_one_entry(EMPTY, EMPTY, _tags(tag))


# --- test_census_era_boundaries_preserved ------------------------------

# The rank-1 chunk of `wiki-search-census-records.json` states three eras:
# 1790-1840 the head of household only, 1850-1870 every free person named with
# no stated relationship, 1880 onward everyone named with their relationship.
# The validator's proxy is that both INTERIOR boundary years survive into the
# summary. The outer years 1790 and 1950 are coverage, not boundaries, which is
# why the blanket case below still carries them and must still fire.
_CENSUS_TAGS = ("fs-wiki", "how-to", "census", "title-normalization")


def _census_file(body):
    return _logged(body)


@pytest.mark.parametrize(
    "shape, body",
    [
        (
            "reflowed prose",
            "# FamilySearch Wiki: Census Records\n\nWhat a census recorded\n"
            "about each household member changed over time. From 1790 through\n"
            "1840 only the head of household is named, with everyone else\n"
            "counted as tally marks. From 1850 through 1870 every free person\n"
            "is listed by name with age, sex and birthplace, but relationship\n"
            "to the head is not stated. Beginning in 1880 every person is\n"
            "listed together with their relationship to the head.\n",
        ),
        (
            "bullets in different words",
            "# FamilySearch Wiki: Census Records\n\n## What each era recorded\n\n"
            "- 1790 to 1840: householder named; the rest are tally marks only\n"
            "- 1850 to 1870: everyone free is named, no kinship given\n"
            "- 1880 and later: names plus how each person relates to the head\n",
        ),
        (
            "en-dash ranges",
            "# FamilySearch Wiki: Census Records\n\n"
            "Coverage runs 1790\u20131950. Recording practice differs by era: "
            "1790\u20131840 (head only), 1850\u20131870 (all free persons named), "
            "1880\u2013present (relationships stated).\n",
        ),
    ],
    ids=["reflowed-prose", "bullets-reworded", "en-dash-ranges"],
)
def test_census_eras_pass_on_faithful_shapes(shape, body):
    """Prove the other direction, per CLAUDE.md: a guard that can only fire is
    one that gets `skip`ped within a month.

    The rule is that the era distinction survives, not that a phrasing does.
    These three say the same thing in different words, wrapping and dash
    characters, and all three must pass -- otherwise the next author who
    reflows a summary reds a correct run.
    """
    check_census_eras(EMPTY, _census_file(body), _tags(*_CENSUS_TAGS))


def test_census_eras_fire_on_the_observed_blanket_claim():
    """The reported defect behind `453a2f69f`: "it claimed every census lists
    each household member by name, age, birthplace, and relationship".

    This summary is not year-free -- it carries 1790 and 1950, the chunk's
    coverage range, so a check that merely looked for "a year" would pass it.
    The era boundaries are what it dropped and what is asserted.
    """
    blanket = (
        "# FamilySearch Wiki: Census Records\n\n"
        "FamilySearch has an index and images for each federal census year "
        "from 1790 through 1950. Each census lists every member of the "
        "household by name, age, birthplace, and relationship to the head of "
        "household.\n"
    )
    with pytest.raises(AssertionError, match=r"missing \['1850', '1880'\]"):
        check_census_eras(EMPTY, _census_file(blanket), _tags(*_CENSUS_TAGS))


def test_census_eras_fire_on_a_half_flattened_summary():
    """One boundary named, the other dropped.

    1850-1870 -- named but with no stated relationship -- is the era a summary
    drops first, because it is the one that is neither of the two simple
    stories. Both years are required, so naming 1880 alone does not buy a pass.
    """
    half = (
        "# FamilySearch Wiki: Census Records\n\n"
        "From 1790 through 1840 only the head of household is named. From "
        "1880 onward every person is listed with their relationship to the "
        "head of household.\n"
    )
    with pytest.raises(AssertionError, match=r"missing \['1850'\]"):
        check_census_eras(EMPTY, _census_file(half), _tags(*_CENSUS_TAGS))


def test_census_eras_fire_on_a_summary_naming_no_year_at_all():
    no_years = (
        "# FamilySearch Wiki: Census Records\n\n"
        "Census records list households and can be traced across decades to "
        "watch children grow up and track a family's migration.\n"
    )
    with pytest.raises(AssertionError, match=r"missing \['1850', '1880'\]"):
        check_census_eras(EMPTY, _census_file(no_years), _tags(*_CENSUS_TAGS))


def test_census_eras_ignore_a_md_file_with_the_eras():
    """The eras must be in the logged notes: a faithful `.md` beside a
    flattened entry is still the flattened deliverable."""
    with pytest.raises(AssertionError, match=r"missing \['1850', '1880'\]"):
        check_census_eras(
            EMPTY,
            _state(_entry("Census records list households."),
                   **{"census-records.md": "1850 and 1880"}),
            _tags(*_CENSUS_TAGS),
        )


def test_census_eras_skip_a_non_census_test():
    """Tag-gated. Every other positive in this suite writes a summary with no
    reason to name either year, so an ungated version would fail all of them.
    """
    with pytest.raises(pytest.skip.Exception):
        check_census_eras(
            EMPTY,
            _logged("No years here."),
            _tags("fs-wiki", "how-to"),
        )


def test_census_eras_skip_when_nothing_was_logged():
    """A run that logged nothing is `test_one_log_entry_appended`'s failure to
    report; firing here too would charge one defect twice.
    """
    with pytest.raises(pytest.skip.Exception):
        check_census_eras(EMPTY, EMPTY, _tags(*_CENSUS_TAGS))


# --- test_stated_navigation_preserved ----------------------------------

# Tags that activate the navigation validator (marriage-records.json's tags).
_NAV_TAGS = ("fs-wiki", "how-to", "marriage", "direct-arm", "navigation")


def test_navigation_passes_on_click_search_then_records():
    """The exact phrasing from the fixture chunk: 'click Search, then Records'.

    Proves the other direction per CLAUDE.md: the guard must not fire on a
    faithful summary, or it will red every correct run.
    """
    body = (
        "# FamilySearch Wiki: Marriage Records\n\n"
        "Marriage records in the United States were kept by county clerks, "
        "churches, or state vital records offices. To search, go to "
        "FamilySearch.org, click Search, then Records, and enter the person's "
        "name and estimated marriage year.\n\n## Sources\n\n"
        "- [United States Marriage Records — Finding Marriage Records]"
        "(https://www.familysearch.org/en/wiki/United_States_Marriage_Records"
        "#Finding_Marriage_Records)\n"
    )
    check_nav(EMPTY, _logged(body), _tags(*_NAV_TAGS))


def test_navigation_passes_on_arrow_notation():
    """'FamilySearch.org → Search → Records' is a formatting variant that the
    fixture's judge_context already scores as faithful. The guard must accept it.
    """
    body = (
        "# FamilySearch Wiki: Marriage Records\n\n"
        "To find records: FamilySearch.org → Search → Records, then enter the "
        "person's name and estimated marriage year.\n\n## Sources\n\n"
        "- [United States Marriage Records — Finding Marriage Records]"
        "(https://www.familysearch.org/en/wiki/United_States_Marriage_Records"
        "#Finding_Marriage_Records)\n"
    )
    check_nav(EMPTY, _logged(body), _tags(*_NAV_TAGS))


def test_navigation_fires_when_step_is_dropped():
    """The observed defect: the navigation step is absent while the chunk's
    other facts are faithfully reported. \\b excludes 'FamilySearch'."""
    body = (
        "# FamilySearch Wiki: Marriage Records\n\n"
        "FamilySearch has digitized millions of marriage records from county "
        "courthouse records, church registers, and state archives.\n\n## Sources\n\n"
        "- [United States Marriage Records — Finding Marriage Records]"
        "(https://www.familysearch.org/en/wiki/United_States_Marriage_Records"
        "#Finding_Marriage_Records)\n"
    )
    with pytest.raises(AssertionError, match="navigation step the chunk states"):
        check_nav(EMPTY, _logged(body), _tags(*_NAV_TAGS))


def test_navigation_fires_when_familysearch_and_records_present_but_no_nav():
    """'FamilySearch' contains 'Search' as a substring but not as a word
    (\\b excludes it). 'Marriage Records' contains 'Records'. Neither triggers
    the pattern — only standalone 'Search' near 'Records' does.

    This is the case CLAUDE.md asks for: prove the guard does not fire on
    notes that only have 'FamilySearch' and 'Marriage Records'.
    """
    body = (
        "# FamilySearch Wiki: Marriage Records\n\n"
        "FamilySearch has digitized millions of Marriage Records from county "
        "courthouse records, church registers, and state archives.\n\n## Sources\n\n"
        "- [United States Marriage Records — Finding Marriage Records]"
        "(https://www.familysearch.org/en/wiki/United_States_Marriage_Records"
        "#Finding_Marriage_Records)\n"
    )
    with pytest.raises(AssertionError, match="navigation step the chunk states"):
        check_nav(EMPTY, _logged(body), _tags(*_NAV_TAGS))


def test_navigation_skips_without_the_tag():
    """Tag-gated: every other positive in the suite has no reason to include the
    navigation step, so an ungated version would fail all of them."""
    with pytest.raises(pytest.skip.Exception):
        check_nav(EMPTY, _logged("No navigation here."), _tags("fs-wiki", "how-to"))


def test_navigation_skips_when_nothing_was_logged():
    """A run that logged nothing is `test_one_log_entry_appended`'s failure to
    report; firing here too would charge one defect twice."""
    with pytest.raises(pytest.skip.Exception):
        check_nav(EMPTY, EMPTY, _tags(*_NAV_TAGS))


# --- test_empty_results_logs_one_negative -----------------------------

_NIL = _entry(None, outcome="negative", results_examined=0)


def test_empty_results_passes_on_one_nil_entry():
    check_empty_logs_negative(EMPTY, _state(_NIL), _tags("no-results"))


@pytest.mark.parametrize(
    "after, match",
    [
        (EMPTY, "exactly one nil entry"),
        (_state(_NIL, dict(_NIL, id="log_002")), "exactly one nil entry"),
        (_state(_entry(None, outcome="positive", results_examined=0)), "outcome 'negative'"),
        (_state(_entry(None, outcome="negative", results_examined=3)), "results_examined 0"),
        (_state(_entry("No guidance found.", outcome="negative", results_examined=0)), "notes must be null"),
        (_state(_NIL, **{"blockchain-birth-certificates.md": "x"}), "must produce no file"),
        (_state(_entry(None, tool="wikipedia_search", outcome="negative", results_examined=0)), "not 'wiki_search'"),
    ],
    ids=["nothing-logged", "two-entries", "positive-outcome", "results-examined",
         "notes-carried", "file-written", "wrong-tool"],
)
def test_empty_results_fires(after, match):
    with pytest.raises(AssertionError, match=match):
        check_empty_logs_negative(EMPTY, after, _tags("no-results"))


def test_empty_results_skips_a_results_test():
    with pytest.raises(pytest.skip.Exception):
        check_empty_logs_negative(EMPTY, EMPTY, _tags("fs-wiki"))


# --- test_sources_section_matches_wiki_results -------------------------


def test_sources_passes_when_every_result_is_cited():
    check_sources(
        EMPTY,
        _logged(_good_file(RESULT_A, RESULT_B)),
        _wiki_call(RESULT_A, RESULT_B),
        _tags("fs-wiki"),
    )


def test_sources_fires_on_a_missing_citation():
    with pytest.raises(AssertionError, match="is not cited in the logged notes"):
        check_sources(
            EMPTY,
            _logged(_good_file(RESULT_A)),
            _wiki_call(RESULT_A, RESULT_B),
            _tags("fs-wiki"),
        )


def test_sources_fires_on_a_fabricated_url():
    """`rubric.md` calls a fabricated URL a hard fail."""
    doctored = _good_file(RESULT_A) + "- [Archion](https://www.archion.de)\n"
    with pytest.raises(AssertionError, match="no URL the wiki response did not"):
        check_sources(
            EMPTY,
            _logged(doctored),
            _wiki_call(RESULT_A),
            _tags("fs-wiki"),
        )


def test_sources_fires_when_the_bullet_drops_the_section_heading():
    bare = (
        "# FamilySearch Wiki: Death Records\n\nProse.\n\n## Sources\n\n"
        f"- [Some Other Title]({_URL_A})\n"
    )
    with pytest.raises(AssertionError, match="exact page_title and"):
        check_sources(
            EMPTY,
            _logged(bare),
            _wiki_call(RESULT_A),
            _tags("fs-wiki"),
        )


def test_sources_tolerates_a_hyphen_separator():
    """Deliberate leniency: the template uses an em dash, but failing a run
    over a hyphen protects nothing a reader cares about."""
    hyphenated = (
        "# FamilySearch Wiki: Death Records\n\nProse.\n\n## Sources\n\n"
        f"- [{RESULT_A['page_title']} - {RESULT_A['section_heading']}]({_URL_A})\n"
    )
    check_sources(
        EMPTY,
        _logged(hyphenated),
        _wiki_call(RESULT_A),
        _tags("fs-wiki"),
    )


def test_sources_skips_when_two_entries_were_logged():
    """Entry count is `test_one_log_entry_appended`'s to report."""
    with pytest.raises(pytest.skip.Exception):
        check_sources(
            EMPTY,
            _state(_entry(_good_file(RESULT_A), n=1), _entry(_good_file(RESULT_A), n=2)),
            _wiki_call(RESULT_A),
            _tags("fs-wiki"),
        )


def test_sources_reads_the_notes_not_a_md_file():
    """A correct `.md` beside notes that cite nothing still fails."""
    with pytest.raises(AssertionError, match="is not cited in the logged notes"):
        check_sources(
            EMPTY,
            _state(_entry("# FamilySearch Wiki: Death Records\n\nProse.\n"),
                   **{"death-records-1800s.md": _good_file(RESULT_A)}),
            _wiki_call(RESULT_A),
            _tags("fs-wiki"),
        )


def test_sources_skips_when_the_run_returned_no_results():
    with pytest.raises(pytest.skip.Exception):
        check_sources(
            EMPTY, _logged(_good_file(RESULT_A)), _wiki_call(), _tags("fs-wiki")
        )


def test_sources_ignores_the_template_comment_placeholder():
    """Regression: `templates/wiki-search-summary.md` ships a citation-format
    reminder in an HTML comment carrying a placeholder wiki URL, and the skill
    leaves it in the filled document. On the first live run this made the
    fabrication arm fail every positive test — the URL is the template's own
    text, invisible in rendered markdown, not an invented citation.

    Observed: run `scratch_2026-08-19_17-12-24`, `ut_search_wiki_007` —
    "invented: ['https://www.familysearch.org/en/wiki/']".
    """
    with_comment = (
        _good_file(RESULT_A)
        + "\n<!-- Citation format: - [Page Title — Section Heading]"
        "(https://www.familysearch.org/en/wiki/...) -->\n"
    )
    check_sources(
        EMPTY,
        _logged(with_comment),
        _wiki_call(RESULT_A),
        _tags("fs-wiki"),
    )


def test_sources_still_fires_on_a_fabricated_url_outside_a_comment():
    """The comment-stripping above must not blunt the real guard."""
    doctored = (
        _good_file(RESULT_A)
        + "\n<!-- Citation format placeholder (https://www.familysearch.org/en/wiki/...) -->\n"
        + "- [Archion](https://www.archion.de)\n"
    )
    with pytest.raises(AssertionError, match="no URL the wiki response did not"):
        check_sources(
            EMPTY,
            _logged(doctored),
            _wiki_call(RESULT_A),
            _tags("fs-wiki"),
        )


# --- test_no_project_returns_template -----------------------------------

_TEMPLATE_RETURN = (
    _good_file(RESULT_A)
    + "\n---\nYou asked how to find death records. The wiki's guidance is shown "
    "above with the pages it came from.\n\nNext, pick a record set to search."
)


def _np(after=None, text=_TEMPLATE_RETURN, results=(RESULT_A,)):
    return dict(
        before_state=EMPTY,
        after_state=after if after is not None else EMPTY,
        tool_calls=_wiki_call(*results),
        agent_returns=[{"subagent_type": "search-familysearch-wiki", "text": text}],
        text_response="relay",
        test=_tags("fs-wiki", "no-project"),
    )


def test_no_project_passes_a_template_return():
    check_no_project(**_np())


def test_no_project_is_inert_without_the_tag():
    kwargs = _np(after=_logged(_good_file(RESULT_A)))
    kwargs["test"] = _tags("fs-wiki")
    with pytest.raises(pytest.skip.Exception):
        check_no_project(**kwargs)


@pytest.mark.parametrize(
    "kwargs, match",
    [
        (_np(after=_logged(_good_file(RESULT_A))), "nothing may be logged"),
        (_np(after=_state(**{"death-records.md": "x"})), "not a file"),
        (_np(text="Saved the guidance to the research log.\n---\nDone."), "# FamilySearch Wiki:"),
        (_np(text="Saved.\n---\n" + _good_file(RESULT_A)), "# FamilySearch Wiki:"),
        (_np(text=_good_file(RESULT_A).replace(_URL_A, "")), _URL_A),
    ],
    ids=["logged-anyway", "wrote-a-file", "claims-a-save", "template-below-separator", "dropped-source"],
)
def test_no_project_fires(kwargs, match):
    with pytest.raises(AssertionError, match=re.escape(match)):
        check_no_project(**kwargs)


# --- report_reply_does_not_restate_the_logged_entry (tier 2) -------------

# Both replies below are byte-for-byte what the model produced, copied out of
# the committed run logs -- full length, original punctuation, nothing tidied.
# The violating one recites the saved document into chat after a correct
# closing sentence; the compliant one carries the same required narration
# preambles and stops.
#
# Keep them exact. An earlier revision shortened the reciting reply to a third
# of its length and flattened an em dash to a hyphen while still calling both
# verbatim (caught in review on #2577). The narration guard's whole value is
# that it is the reply the model actually produced rather than a tidied one,
# and the non-ASCII these carry -- an u-umlaut in "Kirchenbuecher", an en dash,
# an em dash -- is exactly what a construct regex could one day care about.
# If you ever need a shortened version, call it an excerpt.
_SAVED = _logged("# FamilySearch Wiki: German Church Records\n\nProse.\n")

# ut_search_wiki_003, run v1_2026-08-19_13-00-35.
_RECITING_REPLY = (
    "Searching complete. Now let me read the template and save the summary.Now I'll write the summary file.The guidance has been saved to **`german-church-records.md`**, which includes a **Sources** section citing the wiki pages used. Here's a summary of what the wiki says:\n"
    "\n"
    "---\n"
    "\n"
    "**German Church Records (Kirchenbücher)** are the key source for German ancestry before civil registration. Catholic and Protestant parishes each kept their own registers of baptisms, marriages, and burials — many starting in the 1600s, with some Catholic registers going back to the mid-1500s. Because records are organized by **parish, not town**, your first step is identifying which parish served your ancestor's village.\n"
    "\n"
    "**Finding the right parish:** Use a gazetteer — specifically *Meyers Orts- und Verkehrs-Lexikon des Deutschen Reichs*, which covers every place in the 1871–1918 German Empire and names the Catholic and Protestant parishes for each locality.\n"
    "\n"
    "**Where to access the records:**\n"
    "- **FamilySearch Catalog** — search by parish or town name for microfilmed/digitized records\n"
    "- **Archion** (subscription) — Protestant church records\n"
    "- **Matricula** (subscription) — Catholic church records\n"
    "- **Regional church archives** (Landeskirchliches Archiv or Kirchenbuchamt) — for records not yet digitized"
)

# ut_search_wiki_006, run v1_2026-08-19_14-53-19 - narration present,
# no recitation.
_COMPLIANT_REPLY = (
    "Now I have everything I need. Let me write the summary file.The FamilySearch Wiki guidance has been saved to **`marriage-records.md`**. It covers where marriage records were kept (county clerks, churches, or state vital records offices depending on era), the shift from church to civil registration in the late 1800s, and the types of documents you may encounter — licenses, certificates, bonds, and banns. The file includes a **Sources** section citing the two wiki pages used."
)


def test_brevity_fires_on_the_observed_ut_003_recitation():
    """The observed violation: a correct closing sentence, then the document
    recited back with a horizontal rule and bullets."""
    with pytest.raises(AssertionError, match="do not restate"):
        check_brevity(EMPTY, _SAVED, _RECITING_REPLY)


def test_brevity_passes_on_the_observed_compliant_reply():
    """The guard that kept this check off the file for months: the skill's
    `**Narration:**` line mandated a one-line preamble per action and `text_response` carries every
    turn, so a naive length rule fires on required narration. This reply has
    both preambles and passes."""
    check_brevity(EMPTY, _SAVED, _COMPLIANT_REPLY)


def test_brevity_passes_on_the_return_contract_separator():
    """The contract's single `---` before `summary_for_user` is not a
    recitation; flagging it would note every compliant run."""
    check_brevity(
        EMPTY,
        _SAVED,
        "Saved the guidance to the research log; it includes a "
        "Sources section citing the wiki pages used.\n---\n"
        "You asked how to find German church records. The guidance is saved "
        "with the wiki pages it came from.\n\nNext, pick a parish to search.",
    )


def test_brevity_still_fires_on_a_recitation_after_the_separator():
    """The exemption removes the separator only: a list after it still
    reports."""
    with pytest.raises(AssertionError, match="2 list markers"):
        check_brevity(EMPTY, _SAVED, "Saved.\n---\n- one\n- two\n")


def test_brevity_grades_the_agent_return_not_the_relay():
    """On a direct test the relaying main thread may recite on its own; the
    agent's own clean return is what is graded."""
    check_brevity(
        EMPTY,
        _SAVED,
        _RECITING_REPLY,
        [{"subagent_type": "search-familysearch-wiki",
          "text": "Saved the guidance to the research log."}],
    )


def test_brevity_fires_on_a_reciting_agent_return():
    with pytest.raises(AssertionError, match="do not restate"):
        check_brevity(
            EMPTY,
            _SAVED,
            "Saved.",
            [{"subagent_type": "search-familysearch-wiki",
              "text": "Saved.\n\n- one\n- two\n"}],
        )


def test_brevity_falls_back_to_the_reply_when_the_agent_made_no_return():
    """A return from another agent is not this agent's; a routed run grades
    `text_response`."""
    with pytest.raises(AssertionError, match="do not restate"):
        check_brevity(
            EMPTY,
            _SAVED,
            _RECITING_REPLY,
            [{"subagent_type": "record-extractor", "text": "Saved."}],
        )


def test_brevity_skips_when_nothing_was_logged():
    """The rule is scoped to runs that logged the guidance - a hand-back and
    the no-project path must not be reported on."""
    with pytest.raises(pytest.skip.Exception):
        check_brevity(EMPTY, EMPTY, _RECITING_REPLY)


def test_brevity_skips_the_nil_entry():
    """The empty-results entry carries no notes, so it is not a logged
    document the reply could recite."""
    with pytest.raises(pytest.skip.Exception):
        check_brevity(
            EMPTY, _state(_entry(None, outcome="negative", results_examined=0)), _RECITING_REPLY
        )


def test_brevity_skips_a_md_file_with_no_entry():
    """The gate is the logged entry, not the pre-U20 `.md`."""
    with pytest.raises(pytest.skip.Exception):
        check_brevity(EMPTY, _state(**{"german-church-records.md": "x"}), _RECITING_REPLY)


def test_brevity_fires_on_a_repeat_invocation():
    """A repeat appends a second entry beside the first; the `.md` gate this
    replaced skipped the overwrite-in-place case entirely."""
    before = _state(_entry("first", n=1))
    after = _state(_entry("first", n=1), _entry("second", n=2))
    with pytest.raises(AssertionError, match="do not restate"):
        check_brevity(before, after, "Saved.\n\n- one\n- two\n")


def test_brevity_reports_a_recitation_inside_a_fence():
    """A fenced block is scanned like any other text.

    An earlier revision stripped fences first, by analogy with the
    HTML-comment strip in the Sources check. The analogy did not hold: that
    strip covers a real, observed case, while no run in the corpus contains a
    fence at all. Stripping bought nothing and opened the likeliest bypass —
    "here is the file" inside a fenced markdown block (#2577 review).
    """
    with pytest.raises(AssertionError, match="do not restate"):
        check_brevity(
            EMPTY,
            _SAVED,
            "Saved to **`x.md`**. Here is the file:\n\n"
            "```markdown\n# Heading\n\n- one\n- two\n```\n",
        )


@pytest.mark.parametrize(
    "construct, reply",
    [
        ("heading", "Saved.\n\n## Summary\n\nProse."),
        ("table row", "Saved.\n\n| Repo | Years |\n|---|---|\n| A | 1850 |\n"),
        # One `---` is the return contract's separator and is exempt; a second
        # is counted.
        ("horizontal rule", "Saved.\n\n---\n\nProse.\n\n---\n\nMore."),
        ("list marker", "Saved.\n\n- one\n- two\n"),
        # The #2577 blocker: 4 runs recited as a numbered list and scored
        # clean, and the list arm was the only arm with any hits at all.
        ("list marker", "Saved.\n\n1. one\n2. two\n"),
        ("list marker", "Saved.\n\n1) one\n2) two\n"),
    ],
)
def test_brevity_fires_on_each_construct(construct, reply):
    """Each of the four arms fires on its own, so a regression in one regex
    cannot hide behind the others."""
    with pytest.raises(AssertionError, match=construct):
        check_brevity(EMPTY, _SAVED, reply)

def test_brevity_validator_is_tier_two_through_the_real_runner():
    """Pin the PROPERTY, not the spelling.

    An earlier revision asserted the function's name began with `report_`,
    which `validator_runner.py:209` does use to decide the tier. But the name
    is not the only way to lose it: renaming the third parameter to something
    the harness does not supply makes the runner skip it, and `reporting_only`
    is then never observed at all, while every direct-call test in this file
    stays green (#2577 review).

    So run it through `run_validators` and require the harness itself to
    report it as tier 2. Same shape as
    `test_search_external_sites_validator.py`'s `test_v6_is_tier_2_and_cannot_gate_a_run`.
    """
    from pathlib import Path

    from harness.validator_runner import run_validators

    results = run_validators(
        skill="search-familysearch-wiki",
        validators_dir=Path(__file__).resolve().parents[2] / "validators",
        before_state={"files": {}, "research_json": {"log": []}, "tree_gedcomx_json": None},
        after_state={
            "files": {},
            "research_json": {"log": [_entry("# FamilySearch Wiki: German Church Records\n")]},
            "tree_gedcomx_json": None,
        },
        tool_calls=[],
        skill_frontmatter={"name": "search-familysearch-wiki"},
        test={"type": "positive", "tags": []},
        text_response=_RECITING_REPLY,
    )
    brevity = next(
        (r for r in results
         if r.name == "report_reply_does_not_restate_the_logged_entry"),
        None,
    )
    assert brevity is not None, (
        "the brevity validator did not run; the harness did not collect it"
    )
    assert brevity.reporting_only is True, (
        "the brevity validator is gating the run. It fires on 57 of 60 "
        "file-saving runs, so as tier 1 it would mark ~95% of this skill's "
        "positives failed for a reporting-grade observation (issue #1749)."
    )
    assert brevity.passed is False, (
        "it should have fired on the reciting reply; if it passed, this test "
        "proves nothing about the tier of a firing validator"
    )

"""Direct tests for the search-familysearch-wiki validators.

Same reason as `test_init_project_validator.py`: `pyproject.toml` sets
`testpaths = ["tests"]`, so nothing under `validators/` is collected by
`make harness-test`, and a validator's real pass/fail set would otherwise
appear only inside a paid per-skill run.

These exist to satisfy CLAUDE.md's "a new lint must be proven to fail" rule.
Every check added under issue #1755 is exercised here against BOTH a state
that must pass and the specific state observed failing in a committed run log,
so the assertion is known to fire before it gates anything.

The violating states are drawn from the #1647 deep dive:
  - `ut_search_wiki_003`, run `v1_2026-07-22_10-11-56` — wrote no file at all
    while `wiki_search` returned three results.
  - `ut_search_wiki_007`, run `v1_2026-07-01_17-14-57` — wrote
    `death-records.md` where the settled slug rule gives
    `death-records-1800s.md`; the judge scored "File saved correctly" 3 both
    ways across five runs.
  - fabricated URLs in a summary: never observable before, because the saved
    file reached no grader.
"""

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
    report_reply_does_not_restate_the_saved_file as check_brevity,
    test_expected_slug as check_slug,
    test_no_file_on_empty_results as check_no_file_on_empty,
    test_no_wiki_no_write as check_no_wiki_no_write,
    test_sources_section_matches_wiki_results as check_sources,
    test_wrote_exactly_one_markdown_file as check_one_md,
)


EMPTY = {"files": {}}

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


def _state(**files):
    return {"files": dict(files)}


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


# --- test_wrote_exactly_one_markdown_file ------------------------------


def test_one_md_passes_on_a_single_file():
    check_one_md(
        EMPTY, _state(**{"death-records-1800s.md": "x"}), _tags("fs-wiki")
    )


def test_one_md_fires_on_the_ut_003_no_file_run():
    """The observed violation: results returned, nothing written."""
    with pytest.raises(AssertionError, match="exactly one new .md"):
        check_one_md(EMPTY, EMPTY, _tags("fs-wiki"))


def test_one_md_fires_on_a_duplicate_write():
    """The "Never duplicate" arm of the same rule."""
    with pytest.raises(AssertionError, match="exactly one new .md"):
        check_one_md(
            EMPTY,
            _state(**{"death-records.md": "x", "death-records-1800s.md": "x"}),
            _tags("fs-wiki"),
        )


def test_one_md_skips_the_empty_results_path():
    with pytest.raises(pytest.skip.Exception):
        check_one_md(EMPTY, EMPTY, _tags("no-results"))


# --- test_expected_slug ------------------------------------------------


def test_slug_passes_on_the_settled_name():
    check_slug(
        EMPTY,
        _state(**{"death-records-1800s.md": "x"}),
        _tags("expects-file-death-records-1800s"),
    )


def test_slug_fires_on_the_ut_007_drift():
    """`death-records.md` vs the settled `death-records-1800s.md`.

    Both scored "File saved correctly" 3 across five runs, because no test
    recorded which was expected.
    """
    with pytest.raises(AssertionError, match="death-records-1800s.md"):
        check_slug(
            EMPTY,
            _state(**{"death-records.md": "x"}),
            _tags("expects-file-death-records-1800s"),
        )


def test_slug_skips_when_untagged():
    with pytest.raises(pytest.skip.Exception):
        check_slug(EMPTY, _state(**{"anything.md": "x"}), _tags("fs-wiki"))


def test_slug_ignores_a_descriptive_slug_tag():
    """Regression for the collision found in review of PR #1762.

    `census-records.json` carries `slug-normalization` — a DESCRIPTIVE tag
    naming what the test exercises, not what it writes. The first version of
    this helper scanned for the `slug-` prefix and so resolved the expected
    file to `normalization.md` while the test writes `census-records.md`,
    failing a green test and taking the judge down with it (a failing
    validator fails the test outright). Verified against both committed run logs at the
    time: 11 matched, this one did not.

    The prefix is now `expects-file-`, which cannot collide with a
    descriptive tag. `search-wikipedia` has four more of the same shape
    (`slug-simple`, `slug-parens`, `slug-numbers`, `slug-single-word`).
    """
    check_slug(
        EMPTY,
        _state(**{"census-records.md": "x"}),
        _tags("fs-wiki", "how-to", "census",
              "slug-normalization", "expects-file-census-records"),
    )


def test_slug_rejects_two_expected_file_tags():
    """Two filename declarations is an authoring error, not a precedence
    question — fail loudly rather than silently taking the first."""
    with pytest.raises(AssertionError, match="at most one"):
        check_slug(
            EMPTY,
            _state(**{"census-records.md": "x"}),
            _tags("expects-file-census-records", "expects-file-something-else"),
        )


# --- test_no_file_on_empty_results -------------------------------------


def test_empty_results_passes_when_nothing_written():
    check_no_file_on_empty(EMPTY, EMPTY, _tags("no-results"))


def test_empty_results_fires_when_a_file_is_written():
    with pytest.raises(AssertionError, match="must produce no file"):
        check_no_file_on_empty(
            EMPTY, _state(**{"blockchain-birth-certificates.md": "x"}),
            _tags("no-results"),
        )


# --- test_no_wiki_no_write ---------------------------------------------


def test_boundary_negative_passes_with_no_write():
    check_no_wiki_no_write(EMPTY, EMPTY, _tags("no-wiki-search", type="negative"))


def test_boundary_negative_fires_when_a_summary_is_saved():
    """The gap this closes: the search arm alone would pass a run that
    answered from training knowledge without calling the tool."""
    with pytest.raises(AssertionError, match="must not save a wiki summary"):
        check_no_wiki_no_write(
            EMPTY, _state(**{"albert-einstein.md": "x"}),
            _tags("no-wiki-search", type="negative"),
        )


# --- test_sources_section_matches_wiki_results -------------------------


def test_sources_passes_when_every_result_is_cited():
    check_sources(
        EMPTY,
        _state(**{"death-records-1800s.md": _good_file(RESULT_A, RESULT_B)}),
        _wiki_call(RESULT_A, RESULT_B),
        _tags("fs-wiki"),
    )


def test_sources_fires_on_a_missing_citation():
    with pytest.raises(AssertionError, match="is not cited in the saved file"):
        check_sources(
            EMPTY,
            _state(**{"death-records-1800s.md": _good_file(RESULT_A)}),
            _wiki_call(RESULT_A, RESULT_B),
            _tags("fs-wiki"),
        )


def test_sources_fires_on_a_fabricated_url():
    """`rubric.md` calls a fabricated URL a hard fail; nothing could see one
    before, since the file never reached the judge."""
    doctored = _good_file(RESULT_A) + "- [Archion](https://www.archion.de)\n"
    with pytest.raises(AssertionError, match="no URL the wiki response did not"):
        check_sources(
            EMPTY,
            _state(**{"death-records-1800s.md": doctored}),
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
            _state(**{"death-records-1800s.md": bare}),
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
        _state(**{"death-records-1800s.md": hyphenated}),
        _wiki_call(RESULT_A),
        _tags("fs-wiki"),
    )


def test_sources_skips_when_the_run_returned_no_results():
    with pytest.raises(pytest.skip.Exception):
        check_sources(
            EMPTY, EMPTY, _wiki_call(), _tags("fs-wiki")
        )


def test_sources_ignores_the_template_comment_placeholder():
    """Regression: `templates/wiki-search-summary.md` ships a citation-format
    reminder in an HTML comment carrying a placeholder wiki URL, and the skill
    leaves it in the filled file. On the first live run this made the
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
        _state(**{"death-records-1800s.md": with_comment}),
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
            _state(**{"death-records-1800s.md": doctored}),
            _wiki_call(RESULT_A),
            _tags("fs-wiki"),
        )


# --- report_reply_does_not_restate_the_saved_file (tier 2) -------------

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
_SAVED = {"files": {"german-church-records.md": "x"}}

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
    with pytest.raises(AssertionError, match="Keep it brief"):
        check_brevity(EMPTY, _SAVED, _RECITING_REPLY)


def test_brevity_passes_on_the_observed_compliant_reply():
    """The guard that kept this check off the file for months: SKILL.md:24
    mandates a one-line preamble per action and `text_response` carries every
    turn, so a naive length rule fires on required narration. This reply has
    both preambles and passes."""
    check_brevity(EMPTY, _SAVED, _COMPLIANT_REPLY)


def test_brevity_skips_when_no_file_was_saved():
    """The rule is scoped to runs that saved a file - the empty-results path
    and the boundary negatives must not be reported on."""
    with pytest.raises(pytest.skip.Exception):
        check_brevity(EMPTY, EMPTY, _RECITING_REPLY)


def test_brevity_reports_a_recitation_inside_a_fence():
    """A fenced block is scanned like any other text.

    An earlier revision stripped fences first, by analogy with the
    HTML-comment strip in the Sources check. The analogy did not hold: that
    strip covers a real, observed case, while no run in the corpus contains a
    fence at all. Stripping bought nothing and opened the likeliest bypass —
    "here is the file" inside a fenced markdown block (#2577 review).
    """
    with pytest.raises(AssertionError, match="Keep it brief"):
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
        ("horizontal rule", "Saved.\n\n---\n\nProse."),
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
        before_state={"files": {}, "research_json": None, "tree_gedcomx_json": None},
        after_state={
            "files": {"german-church-records.md": "x"},
            "research_json": None,
            "tree_gedcomx_json": None,
        },
        tool_calls=[],
        skill_frontmatter={"name": "search-familysearch-wiki"},
        test={"type": "positive", "tags": []},
        text_response=_RECITING_REPLY,
    )
    brevity = next(
        (r for r in results
         if r.name == "report_reply_does_not_restate_the_saved_file"),
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

"""Skill-specific validators for the search-familysearch-wiki skill.

search-familysearch-wiki searches the FamilySearch Research Wiki via the
`wiki_search` tool and saves a markdown summary to the working folder. Its
graded deliverable is therefore a **loose `.md` file**, not research.json —
which is why the checks here read `after_state["files"]` directly.

Why that matters (issue #1755, from the #1647 deep dive): the LLM judge never
sees this file. `judge.py` receives only `file_changes_summary`, which
`orchestrator.py` builds from the research.json / tree.gedcomx.json diffs — both
`None` for this skill, so the judge is told "(no file changes)". The harness's
opt-in `test.judge_reads_files` does not close the gap either: it surfaces
content out of that same research/tree diff, so it is inert for a skill whose
deliverable is a standalone markdown file. Consequently, before these
validators, the skill's central output had never been checked by anything —
"Sources cited correctly" was scored from whether the chat reply *mentioned*
appending sources.

The deterministic layer, by contrast, does receive the file:
`orchestrator.py` passes validators `after_state["files"]` and
`workspace.py` fills it with `path.read_text(encoding="utf-8")`.

See test_universal.py for the validator function-signature contract; the
`test` argument is the inner "test" block, used to gate on test["tags"].
Note: the FamilySearch wiki tool is `wiki_search`; search-wikipedia's tool
is `wikipedia_search` (which does NOT contain the substring "wiki_search"),
so `.endswith("wiki_search")` cleanly targets only the FS-wiki tool.

Deliberately NOT enforced here — the closing-message brevity rule (SKILL.md
step 5, "Keep it brief"). It is violated in 59 of 59 file-saving runs across
five committed run logs, so landing it as an assertion would fail every
positive test at once and, because a failing validator skips the judge
(`_compute_outcome`: `if not validators_passed: return "fail"`), would also
destroy the dimension scores that diagnose the skill. It stays on #1755 until
the file-visibility fix removes the incentive to recite the file into chat.
"""

from __future__ import annotations

import re

import pytest


_URL_RE = re.compile(r"https?://[^\s<>()\[\]]+")


# --- helpers ----------------------------------------------------------


def _new_md_files(before_state, after_state) -> dict[str, str]:
    """New (path → text) markdown files this run created."""
    before = set((before_state.get("files") or {}).keys())
    after = after_state.get("files") or {}
    return {
        p: text for p, text in after.items()
        if p not in before and p.endswith(".md")
    }


def _expected_file(test) -> str | None:
    """The expected basename declared by an `expects-file-<name>` tag, or None.

    **The prefix is deliberately NOT `slug-`.** That was the first attempt and
    it was wrong: `slug-` is already an established *descriptive* tag prefix
    naming what a test exercises, not what it writes. `census-records.json`
    carried `slug-normalization` (it exercises slug normalisation), so a
    prefix scan resolved its expected file to `normalization.md` while the
    test writes `census-records.md` — silently turning a green test red, and
    with it the judge (a failing validator skips grading entirely). Verified
    against both committed run logs: 11 tests matched, that one did not.

    `search-wikipedia` has four more of the same shape — `slug-simple`,
    `slug-parens`, `slug-numbers`, `slug-single-word` — which are safe only
    because that file hardcodes one function per test instead of scanning.
    Anyone reusing this helper there would hit the same collision, so the
    fix is a prefix that cannot mean anything else. Descriptive `slug-*` tags
    keep their meaning and are ignored here.

    Two tags with this prefix is an authoring error, not a precedence
    question — fail loudly rather than silently picking the first.

    Known wart, tracked as its own issue: `tags` is in
    `snapshot._COSMETIC_TEST_FIELDS`, so retagging a test does not
    invalidate its run log even though it changes what is asserted here.
    Migrating to a snapshot-hashed field is queued for the next change that
    already buys a run.
    """
    prefix = "expects-file-"
    found = [t[len(prefix):] for t in (test.get("tags") or []) if t.startswith(prefix)]
    assert len(found) <= 1, (
        f"a test may declare at most one {prefix}<name> tag; got: {found}"
    )
    return found[0] + ".md" if found else None


def _wiki_results(tool_calls) -> list[dict]:
    """Every result the fixture returned for the `wiki_search` call(s)."""
    out: list[dict] = []
    for tc in (tool_calls or []):
        if not tc.get("tool", "").endswith("wiki_search"):
            continue
        response = tc.get("response") or {}
        out.extend(response.get("results") or [])
    return out


# --- Boundary-negative invariants (tag-gated) --------------------------


def test_no_spurious_wiki_search(tool_calls, test):
    """Invariant behind the `grade_on_invariant` flag on search-familysearch-wiki
    boundary negatives, gated on the `no-wiki-search` tag.

    When a request belongs to a sibling skill, search-familysearch-wiki must
    not handle it by running its own FamilySearch-wiki search. Whether the
    router declines the request or routes it to the correct sibling, this
    skill must not call `wiki_search`. Deterministic check: `wiki_search` was
    never invoked. This is the real gate that keeps grade_on_invariant from
    passing vacuously.
    """
    if "no-wiki-search" not in (test.get("tags") or []):
        pytest.skip("only applies to no-wiki-search negative tests")
    called = [
        tc["tool"] for tc in tool_calls
        if tc.get("tool", "").endswith("wiki_search")
    ]
    assert not called, (
        "this boundary negative must not trigger a FamilySearch-wiki search; "
        f"wiki_search was invoked: {called}"
    )


def test_no_wiki_no_write(before_state, after_state, test):
    """The write half of the same boundary-negative invariant.

    `test_no_spurious_wiki_search` above asserts the *search* did not happen;
    this asserts the *summary file* was not written. Both arms are needed —
    a run that answered from training knowledge without calling the tool
    would pass the search arm while still leaving a bogus guide in the
    working folder. search-wikipedia's `test_no_wiki_no_write` already
    asserts this pair for the sibling skill; this side had only the search
    arm (#1755 request 5).
    """
    if "no-wiki-search" not in (test.get("tags") or []):
        pytest.skip("only applies to no-wiki-search negative tests")
    new_md = sorted(_new_md_files(before_state, after_state))
    assert not new_md, (
        "an out-of-scope request must not save a wiki summary; wrote: "
        f"{new_md}"
    )


# --- File-count and filename enforcement ------------------------------


def test_no_file_on_empty_results(before_state, after_state, test):
    """SKILL.md step 3: empty `results` → tell the user and save no file.

    Gated on the `no-results` tag. Only the *file* arm is asserted. The
    "and stop" half of that sentence is deliberately not checked: a
    genealogist ruled on 2026-08-19 that a brief redirect after a nil result
    is correct practice ("do not tune the skill to stop redirecting",
    v1_2026-08-19_14-53-19.ann.json), so a word-count arm here would encode
    a stricter rule than the discipline holds.
    """
    if "no-results" not in (test.get("tags") or []):
        pytest.skip("only applies to empty-results tests")
    new_md = sorted(_new_md_files(before_state, after_state))
    assert not new_md, (
        f"empty wiki results must produce no file; wrote: {new_md}"
    )


def test_wrote_exactly_one_markdown_file(before_state, after_state, test):
    """A results-returning positive test writes exactly one new `.md`.

    Zero means the skill skipped the save step — SKILL.md step 4 says
    "**Actually invoke the file-write tool to save it** (don't just describe
    the save)". More than one violates the "**Never duplicate**" rule in the
    re-invocation section.

    Observed violation this closes: `ut_search_wiki_003`, run
    `v1_2026-07-22_10-11-56`, wrote no file at all — `wiki_search` returned
    three results and the skill recited a complete formatted document into
    the chat reply instead (H2/H3 headings, a four-row repository table).
    That run's "File saved correctly" caught it, but only because the *chat
    reply* also lacked sources; nothing was checking the file.
    """
    if test.get("type") != "positive":
        pytest.skip("only positive tests save a summary file")
    if "no-results" in (test.get("tags") or []):
        pytest.skip("empty-results path is covered by test_no_file_on_empty_results")
    new_md = sorted(_new_md_files(before_state, after_state))
    assert len(new_md) == 1, (
        f"expected exactly one new .md summary; got {new_md}"
    )


def test_expected_slug(before_state, after_state, test):
    """The saved file's name matches the slug the test declares.

    SKILL.md step 4 derives `<topic-slug>` from the core noun phrase — the
    record type plus any qualifying jurisdiction, origin, or period — with
    leading verbs and qualifiers stripped, lowercased and hyphenated.

    Observed violation this closes: `ut_search_wiki_007` wrote
    `death-records.md` on run `v1_2026-07-01_17-14-57` and
    `death-records-1800s.md` on the four later runs, and the judge's "File
    saved correctly" dimension scored **3** every time — top marks for two
    different answers, because no test recorded which was expected. The
    period-qualifier rule was settled under #1647 (periods are kept).
    """
    expected = _expected_file(test)
    if expected is None:
        pytest.skip("test declares no expects-file-<name> tag")
    names = sorted(p.split("/")[-1] for p in _new_md_files(before_state, after_state))
    assert names == [expected], (
        f"expected exactly ['{expected}']; got {names}"
    )


# --- The saved file's Sources section ---------------------------------


def test_sources_section_matches_wiki_results(before_state, after_state, tool_calls, test):
    """Every wiki result is cited in the file, and no URL is invented.

    SKILL.md step 4: "Sources: one bullet per result — `- [page_title —
    section_heading](source_url)` — using the exact values from the tool
    response."

    Asserted:
      1. each result's `source_url` appears in the file;
      2. on the line carrying that URL, the result's `page_title` and
         `section_heading` both appear;
      3. no `http(s)://` URL appears in the file that the wiki response did
         not return.

    (3) is the fabrication guard — the failure mode `rubric.md` calls out as
    a hard fail ("URLs are fabricated") and which nothing could see before,
    since the file never reached the judge. Run `v1_2026-07-22_10-11-56` of
    `ut_search_wiki_003` put `archion.de`, `matricula-online.eu` and
    `meyersgaz.org` in its *chat reply* with only the last flagged; the
    file's URLs have never been checked at all.

    Not asserted: the exact separator character between title and heading.
    The bullet template uses an em dash, but failing a run over a hyphen
    would be brittle without protecting anything a reader cares about.
    """
    if test.get("type") != "positive":
        pytest.skip("only positive tests save a summary file")
    if "no-results" in (test.get("tags") or []):
        pytest.skip("no file is written on the empty-results path")
    results = _wiki_results(tool_calls)
    if not results:
        pytest.skip("no wiki_search results in this run to cite")
    new_md = _new_md_files(before_state, after_state)
    if len(new_md) != 1:
        pytest.skip("file-count is asserted by test_wrote_exactly_one_markdown_file")
    text = next(iter(new_md.values()))
    lines = text.splitlines()

    for r in results:
        url = r.get("source_url") or ""
        if not url:
            continue
        assert url in text, (
            f"wiki result '{r.get('page_title')}' was returned but its "
            f"source_url is not cited in the saved file: {url}"
        )
        carrying = [ln for ln in lines if url in ln]
        title = (r.get("page_title") or "").strip()
        heading = (r.get("section_heading") or "").strip()
        assert any(title in ln and heading in ln for ln in carrying), (
            "the Sources bullet must carry the exact page_title and "
            f"section_heading from the tool response; expected "
            f"'{title}' and '{heading}' on the line citing {url}, got: "
            f"{carrying}"
        )

    allowed = {(r.get("source_url") or "").rstrip(").,") for r in results}
    # HTML comments are stripped first. `templates/wiki-search-summary.md`
    # ships its own citation-format reminder carrying a placeholder URL
    # (`…/en/wiki/...`), and the skill routinely leaves that comment in the
    # filled file. It is invisible in rendered markdown and is the template's
    # own text, not a fabricated citation — flagging it made this check fail
    # every positive test on first live run.
    scannable = re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)
    found = {m.rstrip(").,") for m in _URL_RE.findall(scannable)}
    invented = sorted(u for u in found if u not in allowed)
    assert not invented, (
        "the saved file must contain no URL the wiki response did not "
        f"return; invented: {invented}"
    )

"""Skill-specific validators for the search-wikipedia skill.

Mechanical checks live here; narrative judgment lands on the
search-wikipedia `rubric.md` dimensions plus the base Correctness +
Completeness dimensions in the LLM judge.

See test_universal.py module docstring for the full validator
function-signature contract. The `test` argument is the parsed test
JSON dict (the inner "test" block) — used to gate test-specific checks
on `test["tags"]`.
"""

from __future__ import annotations

import re
import unicodedata

import pytest


# --- Tool-allowlist enforcement ---------------------------------------

def test_only_wikipedia_search_called(tool_calls, test):
    """Positive search-wikipedia tests must call wikipedia_search and nothing
    else. Negative tests should not call wikipedia_search at all — but
    activation/routing is graded by the negative-test outcome logic in
    orchestrator._compute_outcome, so we only enforce the positive case
    here."""
    if test.get("type") != "positive":
        pytest.skip("activation rules handle negative tests")
    mcp_calls = [
        tc for tc in tool_calls
        if tc.get("tool", "").startswith("mcp__")
    ]
    bad = [
        tc["tool"] for tc in mcp_calls
        if "wikipedia_search" not in tc.get("tool", "")
    ]
    assert not bad, (
        f"search-wikipedia positive tests must only call wikipedia_search; also called: {bad}"
    )


def test_wikipedia_search_called_exactly_once(tool_calls, test):
    """Positive search-wikipedia tests should issue exactly one wikipedia_search
    call. Multiple calls signal query-refinement loops that the SKILL.md
    doesn't authorize (and inflate cost)."""
    if test.get("type") != "positive":
        pytest.skip("activation rules handle negative tests")
    wiki_calls = [
        tc for tc in tool_calls
        if "wikipedia_search" in tc.get("tool", "")
    ]
    assert len(wiki_calls) == 1, (
        f"expected exactly 1 wikipedia_search call; got {len(wiki_calls)}"
    )


# --- File-write enforcement -------------------------------------------

def _files_created(before_state, after_state) -> list[str]:
    before = set((before_state.get("files") or {}).keys())
    after = set((after_state.get("files") or {}).keys())
    return sorted(after - before)


def test_wrote_one_markdown_file(before_state, after_state, test):
    """Positive tests must produce exactly one .md file in the working
    folder. The SKILL.md template names a single file derived from the
    article title — zero means the skill skipped the save step, more
    than one means it wrote extra noise."""
    if test.get("type") != "positive":
        pytest.skip("only positive tests write files")
    new = _files_created(before_state, after_state)
    md = [p for p in new if p.endswith(".md")]
    assert len(md) == 1, f"expected exactly one new .md file; got {md}"


# --- Negative no-harm invariant (tag-gated) ---------------------------

def test_no_wiki_no_write(tool_calls, before_state, after_state, test):
    """Tag-gated (no-wiki-no-write): the search-wikipedia no-harm invariant
    for a request that belongs to another skill (e.g. narrative migration
    history → historical-context).

    search-wikipedia's job is to look a topic up on Wikipedia and SAVE a
    markdown summary. For an out-of-scope request the skill must not perform
    that workflow. This is the deterministic gate for the grade_on_invariant
    negative ut_search_wikipedia_007: whether the model declines in place or
    routes elsewhere is a known-unstable model prior, and the harness's
    activation heuristic counts a thorough (>=30-word) in-place decline as
    activation — but the state-harm invariant always holds and is what we
    assert here.

    Fails iff the run:
      - made a `wikipedia_search` MCP call (the lookup was executed), or
      - wrote a new `.md` file (the summary was saved).
    """
    if "no-wiki-no-write" not in test.get("tags", []):
        pytest.skip("not a no-wiki-no-write scenario")

    # 1. No wikipedia_search executed.
    wiki_calls = [
        tc for tc in (tool_calls or [])
        if "wikipedia_search" in tc.get("tool", "")
    ]
    assert not wiki_calls, (
        "out-of-scope request must not execute a Wikipedia lookup; got "
        f"wikipedia_search call(s) with args: {[c.get('args') for c in wiki_calls]}"
    )

    # 2. No markdown summary saved.
    new_md = [p for p in _files_created(before_state, after_state) if p.endswith(".md")]
    assert not new_md, (
        f"out-of-scope request must not save a Wikipedia summary; wrote: {new_md}"
    )


# --- Slug-normalization regression checks (tag-gated) -----------------

def _new_md_basenames(before_state, after_state) -> list[str]:
    new = _files_created(before_state, after_state)
    return [p.split("/")[-1] for p in new if p.endswith(".md")]


def test_slug_albert_einstein(before_state, after_state, test):
    if "slug-albert-einstein" not in test.get("tags", []):
        pytest.skip("not a slug-albert-einstein scenario")
    names = _new_md_basenames(before_state, after_state)
    assert "albert-einstein.md" in names, (
        f"expected 'albert-einstein.md'; got {names}"
    )


def test_slug_schuylkill_county_pennsylvania(before_state, after_state, test):
    if "slug-schuylkill-county-pennsylvania" not in test.get("tags", []):
        pytest.skip("not a slug-schuylkill-county-pennsylvania scenario")
    names = _new_md_basenames(before_state, after_state)
    assert "schuylkill-county-pennsylvania.md" in names, (
        f"expected 'schuylkill-county-pennsylvania.md'; got {names}"
    )


def test_slug_great_famine_ireland(before_state, after_state, test):
    if "slug-great-famine-ireland" not in test.get("tags", []):
        pytest.skip("not a slug-great-famine-ireland scenario")
    names = _new_md_basenames(before_state, after_state)
    assert "great-famine-ireland.md" in names, (
        f"expected 'great-famine-ireland.md'; got {names}"
    )


def test_slug_obrien_surname(before_state, after_state, test):
    if "slug-obrien-surname" not in test.get("tags", []):
        pytest.skip("not a slug-obrien-surname scenario")
    names = _new_md_basenames(before_state, after_state)
    assert "o-brien-surname.md" in names, (
        f"expected 'o-brien-surname.md' (apostrophe → hyphen, "
        f"' (surname)' → '-surname'); got {names}"
    )


def test_slug_kirchenbuch(before_state, after_state, test):
    if "slug-kirchenbuch" not in test.get("tags", []):
        pytest.skip("not a slug-kirchenbuch scenario")
    names = _new_md_basenames(before_state, after_state)
    assert "kirchenbuch.md" in names, (
        f"expected 'kirchenbuch.md' (single-word title, no hyphens); got {names}"
    )


def test_slug_naturalization_act_of_1906(before_state, after_state, test):
    if "slug-naturalization-act-of-1906" not in test.get("tags", []):
        pytest.skip("not a slug-naturalization-act-of-1906 scenario")
    names = _new_md_basenames(before_state, after_state)
    assert "naturalization-act-of-1906.md" in names, (
        f"expected 'naturalization-act-of-1906.md' (digits are alphanumeric and "
        f"pass through unchanged); got {names}"
    )


# --- Saved-file fidelity ----------------------------------------------

def _wikipedia_responses(tool_calls) -> list[dict]:
    """Fixture responses the mock returned for wikipedia_search this run.

    `tool_calls` is the mock's own call log, and each entry carries the
    response it served (`mock_mcp.py`, `entry["response"] = response`), so
    the expected title/extract/url are available without re-reading any
    fixture file.
    """
    out = []
    for tc in (tool_calls or []):
        if "wikipedia_search" not in tc.get("tool", ""):
            continue
        resp = tc.get("response")
        if isinstance(resp, dict) and "error" not in resp:
            out.append(resp)
    return out


def test_saved_file_matches_template(
    before_state, after_state, tool_calls, test
):
    """The saved .md must be the filled template, with the tool's own
    title/extract/url copied verbatim.

    SKILL.md step 3: "Use the exact values from the tool response. Do not
    paraphrase, summarize, truncate, or editorialize the extract. Copy it
    verbatim." Nothing checked that. The judge cannot: `file_changes` carries
    only research.json and tree.gedcomx.json, so `rubric.md` tells it to grade
    file creation "from the text response and tool call" — i.e. from the
    skill's own claim. Validators see the real thing: `after_state["files"]`
    holds the complete text (`workspace.py`, `path.read_text`).

    Asserted against `templates/wiki-summary.md`:

        # {title}
        <blank>
        {extract}
        <blank>
        ---
        [Source]({url})

    Trailing whitespace is tolerated; everything else is exact. Catches a
    paraphrased or truncated extract, mangled Unicode, a dropped Source line,
    a fabricated URL, and appended content the tool never returned.
    """
    if test.get("type") != "positive":
        pytest.skip("only positive tests save a file")

    responses = _wikipedia_responses(tool_calls)
    if not responses:
        pytest.skip("no successful wikipedia_search response to compare against")

    new_md = [
        (path, text)
        for path, text in (after_state.get("files") or {}).items()
        if path.endswith(".md")
        and path not in (before_state.get("files") or {})
    ]
    assert new_md, "no new .md file to check (test_wrote_one_markdown_file covers count)"

    path, actual = new_md[0]
    expected_any = []
    for resp in responses:
        expected_any.append(
            f"# {resp.get('title')}\n\n{resp.get('extract')}\n\n"
            f"---\n[Source]({resp.get('url')})"
        )

    if any(actual.rstrip() == exp.rstrip() for exp in expected_any):
        return

    # Report the first mismatching component, so the failure names the defect
    # rather than dumping two blobs.
    resp = responses[0]
    for field, value in (
        ("title", resp.get("title")),
        ("extract", resp.get("extract")),
        ("url", resp.get("url")),
    ):
        assert value and str(value) in actual, (
            f"{path} does not contain the tool response's {field} verbatim. "
            f"SKILL.md step 3: 'Copy it verbatim.' Expected to find:\n"
            f"  {value!r}\nSaved file was:\n  {actual!r}"
        )
    raise AssertionError(
        f"{path} contains the title, extract and url but does not match "
        f"templates/wiki-summary.md exactly (extra or reordered content).\n"
        f"Expected:\n  {expected_any[0]!r}\nGot:\n  {actual!r}"
    )


def test_slug_united_states_census(before_state, after_state, test):
    """`ut_search_wikipedia_005` was the last positive test with no slug
    assertion of any kind. Its title ('United States census') is also the one
    in the suite whose casing differs from its slug in more than one place, so
    a naive title.replace(' ', '-') without lowercasing fails here."""
    if "slug-united-states-census" not in test.get("tags", []):
        pytest.skip("not a slug-united-states-census scenario")
    names = _new_md_basenames(before_state, after_state)
    assert "united-states-census.md" in names, (
        f"expected 'united-states-census.md'; got {names}"
    )


# --- Slug rule, applied generically ----------------------------------

# Letters a Unicode decomposition does NOT split into base + combining mark,
# so NFKD alone would drop them into the non-alphanumeric class and emit a
# hyphen: `Preußen` -> `preu-en`, `Łódź` -> `-od`. Each needs its conventional
# ASCII spelling instead. Applied before NFKD handles the decomposable ones
# (ü -> u, ó -> o, å -> a).
_TRANSLITERATE = str.maketrans({
    "ß": "ss", "ł": "l", "ø": "o", "æ": "ae", "œ": "oe",
    "đ": "d", "ð": "d", "þ": "th", "ı": "i", "ħ": "h", "ŋ": "n",
})


def _slug_from_title(title: str) -> str:
    """SKILL.md step 4's slug algorithm: transliterate accented letters to
    their ASCII base, lowercase, replace every run of non-alphanumeric
    characters with a single hyphen, trim leading and trailing hyphens.

    The transliteration step is what makes the rule total. Without it
    `[^a-z0-9]+` turns a title's own umlaut into a hyphen — `Württemberg`
    becomes `w-rttemberg` — which is a filename no reader would connect to
    the article. Accented titles are the normal case for the German, Polish
    and Scandinavian research this skill gets used for, so the rule has to
    cover them; `ut_search_wikipedia_w8m` pins it.
    """
    folded = unicodedata.normalize("NFKD", title.lower().translate(_TRANSLITERATE))
    ascii_only = "".join(ch for ch in folded if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", "-", ascii_only).strip("-")


def test_slug_matches_returned_title(before_state, after_state, tool_calls, test):
    """The saved filename is the slug of the title the TOOL returned — not of
    the query the skill sent.

    This needs no per-test tag, which is the point. The eight `test_slug_*`
    checks above each fire only on a test carrying their literal tag, so a
    test written without one is graded on the slug by nothing at all — which
    is what happened to `ut_search_wikipedia_009` and `_010`: both were
    authored as slug regression checks, both named their expected slug in a
    tag, and neither tag reached a validator (#1662 finding F2). This closes
    that class; the literal checks stay as belt-and-braces, since a bug in
    `_slug_from_title` would otherwise pass itself.
    """
    if test.get("type") != "positive":
        pytest.skip("only positive tests save a file")

    responses = _wikipedia_responses(tool_calls)
    if not responses:
        pytest.skip("no successful wikipedia_search response to derive a slug from")

    names = _new_md_basenames(before_state, after_state)
    if not names:
        pytest.skip("no new .md file (test_wrote_one_markdown_file covers count)")

    expected = {
        f"{_slug_from_title(str(r.get('title') or ''))}.md" for r in responses
    }
    queries = sorted(
        {
            str((tc.get("args") or {}).get("query") or "")
            for tc in (tool_calls or [])
            if "wikipedia_search" in tc.get("tool", "")
        }
    )
    query_slugs = {f"{_slug_from_title(q)}.md" for q in queries if q}
    hint = ""
    if set(names) & (query_slugs - expected):
        hint = (
            f" The saved name IS the slug of the query the skill sent "
            f"({queries!r}), so the slug was built from the query instead of "
            f"the returned title. SKILL.md step 4: 'Build <title-slug> from "
            f"the article title.'"
        )
    assert set(names) & expected, (
        f"expected one of {sorted(expected)} (slug of the returned title "
        f"{[r.get('title') for r in responses]!r}); got {names}.{hint}"
    )


def test_slug_wurttemberg(before_state, after_state, test):
    """Pins the transliteration half of the slug rule: an umlaut in the title
    becomes its ASCII base letter, not a hyphen. Without `_TRANSLITERATE` +
    NFKD this would be `w-rttemberg.md`."""
    if "slug-wurttemberg" not in test.get("tags", []):
        pytest.skip("not a slug-wurttemberg scenario")
    names = _new_md_basenames(before_state, after_state)
    assert "wurttemberg.md" in names, (
        f"expected 'wurttemberg.md' (u-umlaut transliterates to 'u'; it must "
        f"not collapse to a hyphen); got {names}"
    )


# --- Reply economy: the mechanical half --------------------------------

# First-person announcements of a step the skill is about to take. SKILL.md
# step 5 wants a report that the file exists, not a plan to write it.
#
# Deliberately narrow. This is a PROXY for step 5's actual rule ("One sentence
# only"), which is not mechanical — sentence splitting breaks on abbreviations,
# backticked filenames and decimals, and a false positive here would fail a run
# whose saved file is perfect. So this matches only the pending-action shape,
# and the `Reply economy` rubric dimension keeps the rest (extra sentences that
# do not narrate, characterising the article, restating its content).
#
# `Let me know` is excluded: a closing offer is not step narration. It is still
# a second sentence, and the judge dimension is what grades that.
_NARRATION_RE = re.compile(
    r"""(?ix)
    \b(?:
        now \s+ i(?:'|\u2019)?ll                      # Now I'll / Now Ill
      | now \s+ i \s+ will
      | i(?:'|\u2019)?ll \s+ now
      | i \s+ will \s+ now
      | i(?:'|\u2019)?m \s+ going \s+ to
      | i \s+ am \s+ going \s+ to
      | (?:next|then) ,? \s+ i(?:'|\u2019)?ll
      | let \s+ me \s+ (?!know\b)                     # "Let me fill in…" but not "Let me know…"
    )
    """
)


def test_reply_does_not_narrate_pending_step(text_response, test):
    """No assistant turn announces writing the file — not just the closing one.

    `text_response` concatenates every text block, so narration fails this
    even when the final sentence is clean. In Cowork the user sees every block.

    Added after run `v1_2026-08-22_10-20-08`, which is why that run log carries
    no result for it. On that run's data it would have failed
    `ut_search_wikipedia_001` and `ut_search_wikipedia_p4t` — the two positive
    replies that narrated. Both were graded by the `Reply economy` dimension
    and it caught only one: `_001` scored 2, `p4t` scored 3 on a rationale
    quoting a one-sentence reply that was not the reply it was given. That
    split is why this exists as well as the dimension and not instead of it
    (#1662 finding F7).
    """
    if test.get("type") != "positive":
        pytest.skip("step narration is graded on positive runs")
    # Deliberately NOT a skip. An empty reply on a positive run is itself a
    # step-5 violation ("Tell the user the file was created"), and skipping
    # here would make this validator inert the moment the harness stopped
    # supplying `text_response` — the silent-pass failure mode this whole
    # file exists to avoid. Failing names both causes.
    assert text_response, (
        "positive run recorded no reply; SKILL.md step 5 requires the skill "
        "to tell the user the file was created. If the reply WAS non-empty, "
        "the harness has stopped passing `text_response` into validators "
        "(see the run_validators call site in orchestrator.py) and this "
        "check is inert rather than passing."
    )
    hit = _NARRATION_RE.search(text_response)
    assert not hit, (
        f"reply narrates a pending step ({hit.group(0)!r}) instead of only "
        f"reporting the saved file. SKILL.md step 5: 'Tell the user the file "
        f"was created. One sentence only.' The phrase may sit in a mid-workflow "
        f"turn — this string concatenates every text block. Full text: {text_response!r}"
    )

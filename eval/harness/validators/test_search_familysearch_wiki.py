"""Validators for the search-familysearch-wiki agent.

search-familysearch-wiki (`agents/search-familysearch-wiki.md`) searches the
FamilySearch Research Wiki via the `wiki_search` tool and logs the guidance as
one research-log entry through `research_log_append` (#3244 option L, U20):
`tool: "wiki_search"`, `plan_item_id` null, the filled template (summary plus
Sources) in `notes`. An empty result logs one nil entry (`outcome:
"negative"`, `results_examined: 0`, `notes: null`). With no project the agent
logs nothing and returns the template above its `---` line instead.

Until U20 the deliverable was a **loose `.md` file** the judge never saw:
`judge.py` receives only `file_changes_summary`, built from the research.json /
tree.gedcomx.json diffs, so it was told "(no file changes)" (issue #1755). The
hosted worker's read-only `/project` also refused the `Write` outright. The
log entry is in research.json, so the judge now sees it through
`file_changes_summary`; the byte-level checks below read it from
`after_state["research_json"]["log"]` via `new_log_entries`.

See test_universal.py for the validator function-signature contract; the
`test` argument is the inner "test" block, used to gate on test["tags"].
Note: the FamilySearch wiki tool is `wiki_search`; search-wikipedia's tool
is `wikipedia_search`. Tool calls are matched by `bare_tool_name`, so neither
is mistaken for the other under any server spelling.

The closing-message rule (the agent's "Return contract": one line, "do not restate, summarize, list or quote it") is enforced here
as **tier 2** — `report_reply_does_not_restate_the_logged_entry`. It was held off
this file for months on the grounds that it would "fail every positive test at
once" and, via `_compute_outcome`, destroy the dimension scores that diagnose
the skill. Half of that is now out of date and half still stands:

  - The dimension-score half died with #2057 (PR #2444, merged 2026-09-14).
    A validator failure no longer skips the judge — see `_compute_outcome`'s
    own docstring, `orchestrator.py:1597`. The grading would survive.
  - The outcome half stands. `if not validators_passed: return "fail"`
    (`orchestrator.py:1626`) runs AHEAD of every other branch, so a `test_*`
    version would still mark ~88% of file-saving (pre-U20) runs failed.

`compute_validators_passed` filters tier-2 results out entirely
(`if not r.reporting_only  # tier-2 never gates`, issue #1749), so a `report_*`
version measures the violation and hands it to the judge as an observation
without reddening a single run. See that function's docstring for the corpus
evidence.
"""

from __future__ import annotations

import re

import pytest

from harness.skill_runner import agent_return_text
from validators_lib import bare_tool_name, new_log_entries


_URL_RE = re.compile(r"https?://[^\s<>()\[\]]+")


# --- helpers ----------------------------------------------------------


def _new_files(before_state, after_state) -> list[str]:
    """Every new file this run created, any extension."""
    before = set((before_state.get("files") or {}).keys())
    after = set((after_state.get("files") or {}).keys())
    return sorted(after - before)


def _wiki_entries(before_state, after_state) -> list[dict]:
    """New `wiki_search` log entries this run appended."""
    return [
        e for e in new_log_entries(before_state, after_state)
        if e.get("tool") == "wiki_search"
    ]


def _logged_notes(before_state, after_state) -> list[str]:
    """The non-empty `notes` of every new `wiki_search` log entry."""
    return [
        e["notes"] for e in _wiki_entries(before_state, after_state)
        if isinstance(e.get("notes"), str) and e["notes"]
    ]


def _wiki_results(tool_calls) -> list[dict]:
    """Every result the fixture returned for the `wiki_search` call(s)."""
    out: list[dict] = []
    for tc in (tool_calls or []):
        if bare_tool_name(tc.get("tool", "")) != "wiki_search":
            continue
        response = tc.get("response") or {}
        out.extend(response.get("results") or [])
    return out


def _skip_unless_logging_run(test) -> None:
    if test.get("type") != "positive":
        pytest.skip("only positive tests log a summary")
    tags = test.get("tags") or []
    if "no-results" in tags:
        pytest.skip("empty-results path is covered by test_empty_results_logs_one_negative")
    if "no-project" in tags:
        pytest.skip("no-project path is covered by test_no_project_returns_template")


# --- The log entry ----------------------------------------------------


def test_empty_results_logs_one_negative(before_state, after_state, test):
    """Agent body, "What to do" step 3: empty `results` → log the nil search as
    one entry (`outcome: "negative"`, `resultsExamined: 0`, `notes: null`), tell
    the user, and write nothing else. Logging the nil is the log-every-search
    rule (research-schema-spec §5.4).

    Gated on the `no-results` tag. The "and stop" half of that sentence is
    deliberately not checked: a genealogist ruled on 2026-08-19 that a brief
    redirect after a nil result is correct practice ("do not tune the skill to
    stop redirecting", v1_2026-08-19_14-53-19.ann.json), so a word-count arm
    here would encode a stricter rule than the discipline holds.
    """
    if "no-results" not in (test.get("tags") or []):
        pytest.skip("only applies to empty-results tests")
    new = new_log_entries(before_state, after_state)
    assert len(new) == 1, (
        f"empty wiki results must log exactly one nil entry; got {len(new)}: "
        f"{[e.get('tool') for e in new]}"
    )
    entry = new[0]
    assert entry.get("tool") == "wiki_search", (
        f"the nil entry's tool is {entry.get('tool')!r}, not 'wiki_search'"
    )
    assert entry.get("outcome") == "negative" and entry.get("results_examined") == 0, (
        "the nil entry must be outcome 'negative' with results_examined 0; got "
        f"outcome={entry.get('outcome')!r}, results_examined={entry.get('results_examined')!r}"
    )
    assert entry.get("notes") in (None, ""), (
        f"empty wiki results carry no guidance, so notes must be null; got {entry.get('notes')!r}"
    )
    files = _new_files(before_state, after_state)
    assert not files, f"empty wiki results must produce no file; wrote: {files}"


def test_one_log_entry_appended(before_state, after_state, test):
    """A results-returning positive test inside a project appends exactly one
    new log entry, with `tool == "wiki_search"` and `plan_item_id` null, and
    writes no file.

    The deliverable is that entry (#3244 option L, U20). Zero means the agent
    skipped the log step — step 5 says "**You must actually call it**". More
    than one is a second entry for one search. A loose `.md` alongside it is
    the pre-U20 deliverable, which never reaches the hosted ProjectStore.

    Observed violation the file-count predecessor closed: `ut_search_wiki_003`,
    run `v1_2026-07-22_10-11-56`, saved nothing at all — `wiki_search`
    returned three results and the skill recited a complete formatted document
    into the chat reply instead.
    """
    _skip_unless_logging_run(test)
    new = new_log_entries(before_state, after_state)
    assert len(new) == 1, (
        f"expected exactly one new log entry; got {len(new)}: "
        f"{[e.get('tool') for e in new]}"
    )
    entry = new[0]
    assert entry.get("tool") == "wiki_search", (
        f"the new log entry's tool is {entry.get('tool')!r}, not 'wiki_search'"
    )
    assert entry.get("plan_item_id") is None, (
        f"the new log entry's plan_item_id is {entry.get('plan_item_id')!r}, not null"
    )
    files = _new_files(before_state, after_state)
    assert not files, (
        f"the guidance belongs in the log entry's notes, not a file; wrote: {files}"
    )


def test_census_era_boundaries_preserved(before_state, after_state, test):
    """A census summary keeps the period boundaries its chunk states.

    Gated on the `census` tag. The fixture chunk distinguishes three eras —
    1790-1840 the head of household only, 1850-1870 every free person named
    without a stated relationship, 1880 onward everyone named with their
    relationship. A summary that collapses them into one blanket claim is the
    reviewer-reported defect behind `453a2f69f`: "it claimed every census
    lists each household member by name, age, birthplace, and relationship".

    Deterministic proxy: both interior boundary years survive into the logged
    notes. A flattened summary states one rule for all years and has no reason
    to name 1850 and 1880; a faithful one cannot express the distinction
    without them.

    This replaces `judge_context` bullet 5, deleted under #2693. That bullet
    stated the era facts AND the score to apply, so the judge audited the
    summary against a three-item checklist and docked whichever item it found
    compressed — base Correctness 2 in five consecutive runs, once with a
    rationale naming no defect at all. The rule is real; grading it by prompt
    is what failed. `docs/specs/unit-test-spec.md` 5.4: deterministic checks
    belong in validators.
    """
    if "census" not in (test.get("tags") or []):
        pytest.skip("only applies to census tests")
    notes = _logged_notes(before_state, after_state)
    if not notes:
        pytest.skip("nothing logged; covered by test_one_log_entry_appended")
    text = "\n".join(notes)
    missing = [year for year in ("1850", "1880") if year not in text]
    assert not missing, (
        "the logged census summary must keep the era boundaries the chunk "
        f"states; missing {missing}. A summary that names neither boundary "
        "has flattened the eras into one blanket claim (the defect behind "
        "453a2f69f)."
    )


# `\b` excludes "FamilySearch"; the gap accepts "click Search, then Records"
# and "Search → Records" (both ≤ 20 non-period, non-CR, non-newline chars apart).
_NAV_RE = re.compile(r"\bSearch\b[^.\r\n]{0,20}\bRecords\b")


def test_stated_navigation_preserved(before_state, after_state, test):
    """A navigation step the chunk states must survive into the logged notes.

    Gated on the `navigation` tag. The fixture's rank-1 chunk for
    `ut_search_wiki_006` states: "To search, go to FamilySearch.org, click
    Search, then Records, and enter the person's name and estimated marriage
    year." The annotator lowered Completeness from 3 to 2 because this step was
    absent from the logged notes in run `v1_2026-10-13_22-41-26` (PR #3415).
    The judge gave Completeness 3 on every run — the gap is invisible to
    automated grading.

    Likely trigger: the Summary rule forbids "invent navigation paths (e.g.
    'Search → Records, select Ireland')". The example is almost word-for-word
    the navigation the chunk states, so the model drops all navigation rather
    than only invented navigation.

    Deterministic proxy: `_NAV_RE` — `\\bSearch\\b[^.\\n]{0,20}\\bRecords\\b`
    — matches the logged notes. `\\b` excludes "FamilySearch"; the short gap
    accepts both "click Search, then Records" and "Search → Records". A
    summary that drops the navigation step has no reason to combine those two
    words in that order within 20 characters.

    This replaces the `judge_context` approach that scored Completeness 3 even
    when the step was absent. `docs/specs/unit-test-spec.md` 5.4 and the
    census validator's docstring: deterministic checks belong in validators,
    not in the judge prompt.
    """
    if "navigation" not in (test.get("tags") or []):
        pytest.skip("only applies to navigation tests")
    notes = _logged_notes(before_state, after_state)
    if not notes:
        pytest.skip("nothing logged; covered by test_one_log_entry_appended")
    text = "\n".join(notes)
    assert _NAV_RE.search(text), (
        "the logged notes must keep the navigation step the chunk states "
        "('click Search, then Records' or equivalent). A summary that drops "
        "it while keeping the chunk's other facts is the defect behind "
        "issue #3431."
    )


# --- The logged notes' Sources section --------------------------------


def test_sources_section_matches_wiki_results(before_state, after_state, tool_calls, test):
    """Every wiki result is cited in the logged notes, and no URL is invented.

    "What to do" step 4: "Sources: one bullet per result — `- [page_title —
    section_heading](source_url)` — using the exact values from the tool
    response."

    Asserted:
      1. each result's `source_url` appears in the notes;
      2. on the line carrying that URL, the result's `page_title` and
         `section_heading` both appear;
      3. no `http(s)://` URL appears in the notes that the wiki response did
         not return.

    (3) is the fabrication guard — the failure mode `rubric.md` calls out as
    a hard fail ("URLs are fabricated"). Run `v1_2026-07-22_10-11-56` of
    `ut_search_wiki_003` put `archion.de`, `matricula-online.eu` and
    `meyersgaz.org` in its *chat reply* with only the last flagged.

    Not asserted: the exact separator character between title and heading.
    The bullet template uses an em dash, but failing a run over a hyphen
    would be brittle without protecting anything a reader cares about.
    """
    _skip_unless_logging_run(test)
    results = _wiki_results(tool_calls)
    if not results:
        pytest.skip("no wiki_search results in this run to cite")
    notes = _logged_notes(before_state, after_state)
    if len(notes) != 1:
        pytest.skip("entry count is asserted by test_one_log_entry_appended")
    text = notes[0]
    lines = text.splitlines()

    for r in results:
        url = r.get("source_url") or ""
        if not url:
            continue
        assert url in text, (
            f"wiki result '{r.get('page_title')}' was returned but its "
            f"source_url is not cited in the logged notes: {url}"
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
    # HTML comments are stripped first. The skill's former
    # `templates/wiki-search-summary.md` shipped a citation-format reminder
    # carrying a placeholder URL (`…/en/wiki/...`), and the skill routinely
    # left that comment in the filled document. The agent's inlined template
    # drops the comment, but the strip stays: it is invisible in rendered
    # markdown and is the template's own text, not a fabricated citation.
    scannable = re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)
    found = {m.rstrip(").,") for m in _URL_RE.findall(scannable)}
    invented = sorted(u for u in found if u not in allowed)
    assert not invented, (
        "the logged notes must contain no URL the wiki response did not "
        f"return; invented: {invented}"
    )


# The return contract's `summary_for_user` separator: a line of exactly `---`.
_SEPARATOR_RE = re.compile(r"^[ \t]*---[ \t]*$", re.M)


def test_no_project_returns_template(
    before_state, after_state, tool_calls, agent_returns, text_response, test
):
    """Tag-gated (`no-project`): with no project `research_log_append` answers
    `reason: "no_project"`, so the agent logs nothing and returns the filled
    template above the `---` line instead (agent body step 6).

    Fails on a new log entry, a new file, or a return whose part above the
    first `---` lacks the template's heading, its Sources heading, or any
    returned result's `source_url`.
    """
    if "no-project" not in (test.get("tags") or []):
        pytest.skip("not a no-project scenario")
    new = new_log_entries(before_state, after_state)
    assert not new, f"no project, so nothing may be logged; got {len(new)} new entries"
    files = _new_files(before_state, after_state)
    assert not files, f"no project: the template is the return, not a file; wrote: {files}"
    results = _wiki_results(tool_calls)
    if not results:
        pytest.skip("no wiki_search results in this run to return")
    reply = agent_return_text(agent_returns, "search-familysearch-wiki") or (
        text_response or ""
    )
    above = _SEPARATOR_RE.split(reply, maxsplit=1)[0]
    missing = [
        part for part in ("# FamilySearch Wiki:", "## Sources")
        if part not in above
    ] + [
        r["source_url"] for r in results
        if r.get("source_url") and r["source_url"] not in above
    ]
    assert not missing, (
        "no project: the return must carry the filled template above its "
        f"`---` line; missing {missing}. Return was:\n  {reply!r}"
    )


# --- Tier 2: reporting only (never gates; issue #1749) -----------------

# Markdown constructs that only appear in a reply when the saved document is
# being recited back into chat. Re-derived over the five committed run logs on
# 2026-09-15: 60 file-saving runs, 57 carry at least one. The corpus rotates --
# re-derive rather than quoting that figure.
#
# The list arm carries ordered items as well as bullets, and that is the whole
# measurement rather than a detail: per-arm over the same 60 runs the counts are
# list 56, horizontal rule 8, heading 0, table row 0, so every arm but the first
# could be deleted without changing the total. Four runs recited the document as
# `1.`/`2.`/`3.` and scored clean until this was widened (#2577 review) -- a
# skill switching from `-` to `1.` would have dropped off the instrument
# entirely. `report_no_framework_walkthrough` in test_citation.py already
# carried the ordered-item alternative.
_RECITATION_CONSTRUCTS = (
    ("list marker", re.compile(r"^[ \t]*(?:[-*+]|\d+[.)]) ", re.M)),
    ("heading", re.compile(r"^#{1,6} ", re.M)),
    ("horizontal rule", re.compile(r"^[ \t]*(?:---|\*\*\*|___)[ \t]*$", re.M)),
    # Excludes the `|---|---|` separator, which is not a row of content.
    # Counting it reported a one-data-row table to the judge as "3 table rows"
    # (#2577 review), and `split_observations` hands that text to the judge
    # verbatim -- a wrong count is a false statement to the grader.
    ("table row", re.compile(r"^[ \t]*\|(?![-: |]*\|?[ \t]*$)", re.M)),
)


def report_reply_does_not_restate_the_logged_entry(
    before_state, after_state, text_response, agent_returns=None
):
    """The agent's "Return contract": one line saying the guidance was saved to
    the research log with a Sources section, and "do not restate, summarize,
    list or quote it". Tier 2 by design.

    On a run that logged the guidance, a list marker (bulleted or numbered),
    heading, table row or horizontal rule in the reply is the logged document
    being recited back into chat, which the return contract forbids. 57 of the
    60 file-saving runs in the five committed (pre-U20) run logs carry at least
    one.

    Attributing the prohibition to the body's "Never duplicate" rule, as an
    earlier revision did, was wrong: that rule was about not creating a second
    file for the same topic-slug. The return contract carries this point alone.

    **One `---` line is exempt.** The return contract puts a `---` line between
    the caller-facing line and the two `summary_for_user` paragraphs, so every
    compliant run carries exactly one. Counting it would hand the judge a false
    "horizontal rule" note on every run; a second rule is still counted.

    **Why tier 2, not tier 1.** A failing gating validator still forces the
    run's outcome: `if not validators_passed: return "fail"`
    (`orchestrator.py:1626`) runs ahead of every other branch. A `test_*`
    version would fire on 57 of the 60 file-saving runs in the corpus, marking
    ~88% of this skill's positives failed for what is a reporting-grade
    observation. (It would no longer cost the dimension scores as well --
    since #2057 a validator failure does not skip the judge -- but an outcome
    of "fail" on 88% of positives is reason enough.) `report_*` results are
    filtered out of `compute_validators_passed` (issue #1749), so this reports
    without gating.

    **Why this does not fire on narration.** The skill's `**Narration:**` line
    mandated a one-line preamble per action (the agent carries no such line), and `text_response` is every assistant turn,
    not the closing message alone -- the objection that held this check off the
    file. Checked against the corpus: the runs that stay clean carry their
    preambles ("Searching the FamilySearch Research Wiki now.", "Now let me
    read the template before saving.") and score zero constructs. Narration is
    prose; it does not emit them.

    **No word ceiling** -- and not because length carries no signal, which is
    what an earlier revision of this docstring claimed. That rested on calling
    all 7 non-firing runs "compliant"; 4 of them recited the document as a
    numbered list and 2 more under bold run-in headings (#2577 review). Of the
    3 that still stay clean, only `ut_search_wiki_006` at 75 words is genuinely
    brief, and every reported run is 98 words or more -- so here length and
    recitation separate almost perfectly rather than independently. The ceiling
    is omitted because request 4's author sanctioned shipping the constructs
    alone and one compliant datapoint cannot size one.

    Still uncaught: the 2 remaining clean runs recite under bold run-in
    headings (`**Union Soldiers:**`). Not added as a fifth arm here -- bold is
    common in legitimate brief replies, so it wants its own evidence.

    **Graded on the agent's own return on a direct test.** There
    `text_response` is the relaying main thread, which paraphrases and recites
    on its own; `agent_returns` carries what the agent itself said. Selection is
    `skill_runner.agent_return_text`, the call the judge makes, falling back to
    `text_response` when the agent made no return (a routed run).

    Gated on the state diff rather than a tag, so it cannot be silently
    disarmed by a tag rename (#1757): it runs when this run appended a
    `wiki_search` log entry with non-null `notes` (#3244 option L, U20). Its
    predecessor gated on a new `.md` file, which no run makes any more, so left
    unchanged it would have skipped on every run with nothing red. The nil
    entry (notes null) and the no-project path (nothing logged) do not reach
    it. A repeat invocation appends a new entry, so it is graded too -- the
    gap the `.md` gate had on an overwrite in place is closed.
    """
    if not _logged_notes(before_state, after_state):
        pytest.skip("no wiki_search entry with notes logged; the closing-message rule does not apply")

    # Scanned as-is, deliberately. An earlier revision stripped fenced code
    # first by analogy with the HTML-comment strip above, but that precedent
    # covers a real, observed case (the template ships a comment carrying a
    # placeholder URL) and this covered none: zero of the 80 runs in the five
    # committed logs contain a fence. It bought nothing and opened the likeliest
    # bypass, since "here is the file" inside a fenced markdown block is how a
    # recitation would arrive (#2577 review). It also made the word count below
    # describe the post-strip text, so a 13-word reply wrapping a fenced
    # document was reported to the judge as "runs to 3 words".
    reply = agent_return_text(agent_returns, "search-familysearch-wiki") or (
        text_response or ""
    )
    scannable = _SEPARATOR_RE.sub("", reply, count=1)

    counts = []
    for label, pattern in _RECITATION_CONSTRUCTS:
        n = len(pattern.findall(scannable))
        if n:
            counts.append(f"{n} {label}{'' if n == 1 else 's'}")
    if not counts:
        return

    words = len(scannable.split())
    # State counts as fact and quote the rule; no verdict. split_observations
    # passes this text to the judge verbatim, so a conclusion here would
    # anchor the grade.
    assert False, (
        f"the reply on a run that logged the guidance carries "
        f"{', '.join(counts)} and runs to {words} words. The return contract "
        "asks for one line saying it was saved to the research log with a Sources section, "
        'and says "do not restate, summarize, list or quote it".'
    )


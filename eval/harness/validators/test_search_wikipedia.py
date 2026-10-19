"""Validators for the search-wikipedia AGENT.

`search-wikipedia` was a skill until issue #2795; every suite file is now a
direct-agent test and every "SKILL.md step N" reference below has been
repointed at `packages/engine/plugin/agents/search-wikipedia.md`. Its
`## Return contract` is exactly one line saying the summary was saved to the
research log. It carries no `summary_for_user` paragraphs (PENDING in
`agent-return-contract.test.ts`).

The deliverable is one research-log entry (#3244 option L, U20): `tool:
"wikipedia_search"`, `plan_item_id` null, the filled template in `notes`,
written through `research_log_append`. It used to be a loose `<slug>.md` in the
working folder, which the hosted worker's read-only `/project` refused and no
ProjectStore ever saw. The judge now sees the entry through
`file_changes_summary`; the byte-level checks stay here. Positive tests run on
`empty-project-just-created` with `projectPath: <workspace>`, except the one
tagged `no-project`, where the agent logs nothing and returns the template.

`ut_search_wikipedia_008`, the decline, is a direct `grade_on_invariant`
negative, so every validator below that skips non-positive tests skips it, and
`test_no_wiki_no_write` alone decides it. The `scope-decline` skips below only
fire on a positive decline test, which the corpus does not carry today; they
stay because a future suite may add one, and because removing them would make
the tag silently inert.

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

import pytest

from harness.skill_runner import agent_return_text
from validators_lib import bare_tool_name, new_log_entries


# --- Tool-allowlist enforcement ---------------------------------------

_ALLOWED_MCP_TOOLS = frozenset({"wikipedia_search", "research_log_append"})


def _calls(tool_calls, name: str) -> list[dict]:
    return [
        tc for tc in (tool_calls or [])
        if bare_tool_name(tc.get("tool", "")) == name
    ]


def test_only_lookup_and_log_called(tool_calls, test):
    """Positive search-wikipedia tests may call only `wikipedia_search` and
    `research_log_append`, and `research_log_append` at most once.

    The agent delivers its summary as one log entry (#3244 option L), so the
    log call is part of the workflow, not a stray tool. On `scope-decline` it
    must make no log call at all: a declined request logs nothing. On the
    `no-project` tag the one call is still allowed -- it is how the agent
    learns there is no project (`reason: "no_project"`) -- and
    `test_no_project_returns_template` checks that nothing was logged.

    Skips `ut_search_wikipedia_008`, which is a negative.
    """
    if test.get("type") != "positive":
        pytest.skip("activation rules handle negative tests")
    mcp_calls = [
        tc for tc in (tool_calls or [])
        if tc.get("tool", "").startswith("mcp__")
    ]
    bad = [
        tc["tool"] for tc in mcp_calls
        if bare_tool_name(tc.get("tool", "")) not in _ALLOWED_MCP_TOOLS
    ]
    assert not bad, (
        "search-wikipedia positive tests may only call wikipedia_search and "
        f"research_log_append; also called: {bad}"
    )
    log_calls = _calls(tool_calls, "research_log_append")
    limit = 0 if "scope-decline" in test.get("tags", []) else 1
    assert len(log_calls) <= limit, (
        f"expected at most {limit} research_log_append call(s); got "
        f"{len(log_calls)}. One lookup is one log entry."
    )


def test_wikipedia_search_called_exactly_once(tool_calls, test):
    """Positive search-wikipedia tests should issue exactly one wikipedia_search
    call. Multiple calls signal query-refinement loops the agent body
    forbids by name (step 1: "Exactly one call") and inflate cost."""
    if test.get("type") != "positive":
        pytest.skip("activation rules handle negative tests")
    if "scope-decline" in test.get("tags", []):
        pytest.skip("scope-decline: a declined request issues no lookup at all")
    wiki_calls = _calls(tool_calls, "wikipedia_search")
    assert len(wiki_calls) == 1, (
        f"expected exactly 1 wikipedia_search call; got {len(wiki_calls)}"
    )


# --- The log entry ------------------------------------------------------

def _files_created(before_state, after_state) -> list[str]:
    before = set((before_state.get("files") or {}).keys())
    after = set((after_state.get("files") or {}).keys())
    return sorted(after - before)


def _skip_unless_logging_run(test) -> None:
    if test.get("type") != "positive":
        pytest.skip("only positive tests log a lookup")
    tags = test.get("tags", [])
    if "scope-decline" in tags:
        pytest.skip("scope-decline: the agent declines, so it logs nothing")
    if "no-project" in tags:
        pytest.skip("no-project: test_no_project_returns_template grades this run")


def _wiki_log_entries(before_state, after_state) -> list[dict]:
    return [
        e for e in new_log_entries(before_state, after_state)
        if e.get("tool") == "wikipedia_search"
    ]


def test_one_log_entry_appended(before_state, after_state, test):
    """A positive lookup inside a project appends exactly one log entry, with
    `tool == "wikipedia_search"` and `plan_item_id` null, and writes no file.

    The agent's deliverable is that entry (#3244 option L): a loose `.md` in
    the project folder never reaches the hosted ProjectStore, and the hosted
    worker's read-only `/project` refuses it outright.
    """
    _skip_unless_logging_run(test)
    new = new_log_entries(before_state, after_state)
    assert len(new) == 1, (
        f"expected exactly one new log entry; got {len(new)}: "
        f"{[e.get('tool') for e in new]}"
    )
    entry = new[0]
    assert entry.get("tool") == "wikipedia_search", (
        f"the new log entry's tool is {entry.get('tool')!r}, not 'wikipedia_search'"
    )
    assert entry.get("plan_item_id") is None, (
        f"the new log entry's plan_item_id is {entry.get('plan_item_id')!r}, not null"
    )
    files = _files_created(before_state, after_state)
    assert not files, (
        f"the summary belongs in the log entry's notes, not a file; wrote: {files}"
    )


def _wikipedia_responses(tool_calls) -> list[dict]:
    """Fixture responses the mock returned for wikipedia_search this run.

    `tool_calls` is the mock's own call log, and each entry carries the
    response it served (`mock_mcp.py`, `entry["response"] = response`), so
    the expected title/extract/url are available without re-reading any
    fixture file.
    """
    out = []
    for tc in _calls(tool_calls, "wikipedia_search"):
        resp = tc.get("response")
        if isinstance(resp, dict) and "error" not in resp:
            out.append(resp)
    return out


def _filled_template(resp: dict) -> str:
    return (
        f"# {resp.get('title')}\n\n{resp.get('extract')}\n\n"
        f"---\n[Source]({resp.get('url')})"
    )


def test_log_notes_match_template(before_state, after_state, tool_calls, test):
    """The logged entry's `notes` must be the filled template, with the tool's
    own title/extract/url copied verbatim.

    Agent body step 3: "Use the exact values from the tool response. Do not
    paraphrase, summarize, truncate, or editorialize the extract. Copy it
    verbatim." The judge sees the entry through `file_changes_summary`, but a
    byte-level comparison is mechanical, so it lives here.

    Asserted against the template inlined in the agent body:

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
    _skip_unless_logging_run(test)
    responses = _wikipedia_responses(tool_calls)
    if not responses:
        pytest.skip("no successful wikipedia_search response to compare against")

    entries = _wiki_log_entries(before_state, after_state)
    assert entries, "no new wikipedia_search log entry to check (test_one_log_entry_appended covers count)"

    actual = entries[0].get("notes")
    assert isinstance(actual, str) and actual, (
        f"the logged entry's notes is {actual!r}; it must carry the filled template"
    )
    expected_any = [_filled_template(resp) for resp in responses]
    if any(actual.rstrip() == exp.rstrip() for exp in expected_any):
        return

    resp = responses[0]
    for field, value in (
        ("title", resp.get("title")),
        ("extract", resp.get("extract")),
        ("url", resp.get("url")),
    ):
        assert value and str(value) in actual, (
            f"the logged notes do not contain the tool response's {field} "
            f"verbatim. Agent body step 3: 'Copy it verbatim.' Expected to "
            f"find:\n  {value!r}\nNotes were:\n  {actual!r}"
        )
    raise AssertionError(
        "the logged notes contain the title, extract and url but do not match "
        "the agent body's template exactly (extra or reordered content).\n"
        f"Expected:\n  {expected_any[0]!r}\nGot:\n  {actual!r}"
    )


#: Literal returned titles pinned by tag, belt-and-braces beside the generic
#: comparison below: a bug in how this module reads the response would
#: otherwise pass itself. Each one is a title the agent could plausibly
#: rewrite -- a redirect target, an umlaut, an apostrophe and parentheses.
_TITLE_TAGS = {
    "title-albert-einstein": "Albert Einstein",
    "title-schuylkill-county-pennsylvania": "Schuylkill County, Pennsylvania",
    "title-great-famine-ireland": "Great Famine (Ireland)",
    "title-obrien-surname": "O'Brien (surname)",
    "title-kirchenbuch": "Kirchenbuch",
    "title-naturalization-act-of-1906": "Naturalization Act of 1906",
    "title-united-states-census": "United States census",
    "title-wurttemberg": "Württemberg",
}


def test_notes_title_is_returned_title(before_state, after_state, tool_calls, test):
    """The logged notes' H1 is the title the TOOL returned, verbatim -- not
    the query the agent sent, and not an ASCII-folded or re-punctuated form.

    `ut_search_wikipedia_p4t` is the redirect case: the query names the potato
    famine and the tool returns "Great Famine (Ireland)". `_w8m` and `_004`
    pin verbatim accents and punctuation ("Württemberg", "O'Brien (surname)").
    Needs no per-test tag for the generic half; a `title-*` tag additionally
    pins the literal title.
    """
    _skip_unless_logging_run(test)
    responses = _wikipedia_responses(tool_calls)
    if not responses:
        pytest.skip("no successful wikipedia_search response to compare against")
    entries = _wiki_log_entries(before_state, after_state)
    if not entries:
        pytest.skip("no new wikipedia_search log entry (test_one_log_entry_appended covers count)")

    notes = entries[0].get("notes") or ""
    h1 = notes.split("\n", 1)[0]
    expected = {f"# {r.get('title')}" for r in responses}
    queries = sorted(
        str((tc.get("args") or {}).get("query") or "")
        for tc in _calls(tool_calls, "wikipedia_search")
    )
    hint = ""
    if h1 in {f"# {q}" for q in queries if q} - expected:
        hint = (
            f" The H1 IS the query the agent sent ({queries!r}), so the title "
            f"came from the query instead of the tool response."
        )
    assert h1 in expected, (
        f"expected the notes' H1 to be one of {sorted(expected)} (the returned "
        f"title, verbatim); got {h1!r}.{hint}"
    )
    for tag in test.get("tags", []):
        if tag in _TITLE_TAGS:
            assert h1 == f"# {_TITLE_TAGS[tag]}", (
                f"tag {tag} pins the H1 '# {_TITLE_TAGS[tag]}'; got {h1!r}"
            )


def test_no_project_returns_template(before_state, after_state, tool_calls, agent_returns, text_response, test):
    """Tag-gated (`no-project`): with no project the agent logs nothing and
    returns the filled template as its reply instead (`research_log_append`
    answers `reason: "no_project"`). Fails on a new log entry, a new file, or a
    reply that does not carry the template verbatim.
    """
    if "no-project" not in test.get("tags", []):
        pytest.skip("not a no-project scenario")
    new = new_log_entries(before_state, after_state)
    assert not new, f"no project, so nothing may be logged; got {len(new)} new entries"
    files = _files_created(before_state, after_state)
    assert not files, f"no project: the template is the reply, not a file; wrote: {files}"
    responses = _wikipedia_responses(tool_calls)
    if not responses:
        pytest.skip("no successful wikipedia_search response to compare against")
    reply = _graded_reply(agent_returns, text_response)
    assert any(_filled_template(r).rstrip() in reply for r in responses), (
        "no project: the reply must be the filled template, verbatim. "
        f"Expected to find:\n  {_filled_template(responses[0])!r}\nReply was:\n  {reply!r}"
    )


def test_not_found_logs_negative(before_state, after_state, agent_returns, text_response, test):
    """Tag-gated (`not-found`): when `wikipedia_search` answers `No Wikipedia
    article found`, the agent logs one negative entry, fills no template, writes
    no file, and returns the not-found line (agent body step 2).
    """
    if "not-found" not in test.get("tags", []):
        pytest.skip("not a not-found scenario")
    new = new_log_entries(before_state, after_state)
    assert len(new) == 1, f"expected exactly one new log entry; got {len(new)}"
    entry = new[0]
    for field, expected in (
        ("tool", "wikipedia_search"),
        ("outcome", "negative"),
        ("results_examined", 0),
        ("notes", None),
    ):
        assert entry.get(field) == expected, (
            f"the not-found entry's {field} is {entry.get(field)!r}, not {expected!r}"
        )
    files = _files_created(before_state, after_state)
    assert not files, f"a not-found lookup writes no file; wrote: {files}"
    reply = _graded_reply(agent_returns, text_response)
    assert "No Wikipedia article was found" in reply, (
        f"expected the not-found return line; reply was {reply!r}"
    )
    assert "Saved the Wikipedia summary" not in reply, (
        f"nothing was found, so nothing was saved; reply was {reply!r}"
    )


# --- Negative no-harm invariant (tag-gated) ---------------------------

def test_no_wiki_no_write(tool_calls, before_state, after_state, test):
    """Tag-gated (`no-wiki-no-write` OR `scope-decline`): the search-wikipedia
    no-harm invariant for a request this agent must not work on — either
    off-topic entirely, or genealogy work another agent owns (narrative
    migration history → historical-context).

    search-wikipedia's job is to look a topic up on Wikipedia and LOG the
    summary. For an out-of-scope request the agent must not perform that
    workflow, whatever the delegation asserts.

    This is the whole deterministic verdict for `ut_search_wikipedia_008`, the
    direct decline test (issue #2795; Richard's ruling of 2026-09-28 kept it a
    `grade_on_invariant` negative). It used to gate
    a routed `grade_on_invariant` negative, where routing was the unstable part
    and the state-harm invariant the stable one; the direct arm has no router
    at all, so the invariant is not merely the reliable half — it is the only
    mechanical thing there is to check, alongside the judge's base dimensions.

    The gate is an OR rather than a rename so that the two tags stay
    independently meaningful: `no-wiki-no-write` is the no-harm claim and
    `scope-decline` is the shape of the test. Either alone fires this.

    Fails iff the run:
      - made a `wikipedia_search` MCP call (the lookup was executed),
      - made a `research_log_append` call or left a new log entry (the
        summary was logged), or
      - wrote any new file.
    """
    tags = test.get("tags", [])
    if "no-wiki-no-write" not in tags and "scope-decline" not in tags:
        pytest.skip("not a no-wiki-no-write or scope-decline scenario")

    # 1. No wikipedia_search executed.
    wiki_calls = _calls(tool_calls, "wikipedia_search")
    assert not wiki_calls, (
        "out-of-scope request must not execute a Wikipedia lookup; got "
        f"wikipedia_search call(s) with args: {[c.get('args') for c in wiki_calls]}"
    )

    # 2. Nothing logged -- neither the call nor an entry that reached the log
    # some other way.
    log_calls = _calls(tool_calls, "research_log_append")
    new_entries = new_log_entries(before_state, after_state)
    assert not log_calls and not new_entries, (
        "out-of-scope request must not log a Wikipedia summary; got "
        f"{len(log_calls)} research_log_append call(s) and {len(new_entries)} new log entries"
    )

    # 3. No file saved -- ANY file, not just a .md. This is the WHOLE verdict
    # for ut_search_wikipedia_008 (`_compute_outcome` returns on
    # `grade_on_invariant` before a judge dimension is read), and that test's
    # prompt asks for a Python function, so an extension filter would pass a
    # run that saved `parse_csv.py`.
    new_files = _files_created(before_state, after_state)
    assert not new_files, (
        "out-of-scope request must not save a Wikipedia summary or any other "
        f"file; wrote: {new_files}"
    )


# --- Reply economy: the mechanical half --------------------------------

# First-person announcements of a step the agent is about to take. The agent
# body's `## Return contract` wants a report that the entry is logged, not a plan
# to log it.
#
# Deliberately narrow. This is a PROXY for the return contract's actual rule ("exactly
# one line"), which is not mechanical — sentence splitting breaks on abbreviations,
# backticked names and decimals, and a false positive here would fail a run
# whose logged entry is perfect. So this matches only the pending-action shape,
# and the `Reply economy` rubric dimension keeps the rest (extra sentences that
# do not narrate, characterising the article, restating its content).
#
# `Let me ...` is the one opener that needs a verb to decide it. Excluding only
# `know` was too narrow in a way that FAILS CORRECT RUNS: "Let me be clear: the
# summary has been saved." reports a completed action and was matched. Enumerating
# the benign openers is unbounded, so the branch now requires a verb naming work
# this skill actually does.
_PENDING_VERB = r"""(?: write | fill | save | create | check | add | populate
                      | generate | run | search | look | produce | prepare
                      | update | put | format | output )"""

_NARRATION_RE = re.compile(
    rf"""(?ix)
    \b(?:
        now \s+ i(?:'|\u2019)?ll                      # Now I'll / Now Ill
      | now \s+ i \s+ will
      | i(?:'|\u2019)?ll \s+ now
      | i \s+ will \s+ now
        # One optional adverb between the subject and `going to`, so
        # "I'm now going to check ..." is caught as well as "I'm going to check ...".
      | i(?:'|\u2019)?m \s+ (?: \w+ \s+ )? going \s+ to
      | i \s+ am \s+ (?: \w+ \s+ )? going \s+ to
      | (?:next|then) ,? \s+ i(?:'|\u2019)?ll
      | let \s+ me \s+ {_PENDING_VERB} \b
    )
    """
)


def _graded_reply(agent_returns, text_response: str) -> str:
    """The text this suite's reply rules apply to.

    On the direct arm `text_response` belongs to the MAIN THREAD, which is a
    dispatcher relaying the agent's return -- it paraphrases, and what it writes
    is not the subject under test. `agent_returns` carries the agent's own text,
    so it wins whenever the agent under test returned any.

    Measured on `v1_2026-09-28_09-49-04` plus a live capture of
    `ut_search_wikipedia_002` the same day, one run, two texts:

        agent:       Saved the Wikipedia summary to `albert-einstein.md`.
                     (the pre-#3244 return; it is now "Saved the Wikipedia
                     summary to the research log.")
        main thread: The subagent has completed the task. It looked up **Albert
                     Einstein** on Wikipedia and saved the article summary ...

    The agent obeyed its one-line contract; the dispatcher did not, and the
    dispatcher is what the suite had been failing.

    Selection is `skill_runner.agent_return_text`, the SAME call the judge
    makes. It used to take the first match here and join every match there, so
    a clean first return hid a narrating second one from this validator but not
    from the judge. Falls back to `text_response` when this agent returned
    nothing -- a routed run, whose reply IS the subject's.
    """
    return agent_return_text(agent_returns, "search-wikipedia") or (text_response or "")


def test_reply_does_not_narrate_pending_step(agent_returns, text_response, test):
    """No assistant turn announces logging the summary — not just the closing one.

    `text_response` joins every turn's text (blocks within one turn with no
    separator), so narration fails this even when the final sentence is
    clean. In Cowork the user sees every turn.

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
    # NOT skipped on `scope-decline`, so a positive decline test would be
    # graded for narration like any other reply. `ut_search_wikipedia_008` is a
    # negative and skips on the line above.
    # Deliberately NOT a skip. An empty reply on a positive run is itself a
    # return-contract violation, and skipping
    # here would make this validator inert the moment the harness stopped
    # supplying `text_response` — the silent-pass failure mode this whole
    # file exists to avoid. Failing names both causes.
    reply = _graded_reply(agent_returns, text_response)
    assert reply, (
        "positive run recorded no reply; the agent's return contract requires "
        "one line saying the summary was saved to the research log (or, with no "
        "project, the filled template). If the reply WAS non-empty, "
        "the harness has stopped passing `text_response` into validators "
        "(see the run_validators call site in orchestrator.py) and this "
        "check is inert rather than passing."
    )
    hit = _NARRATION_RE.search(reply)
    assert not hit, (
        f"reply narrates a pending step ({hit.group(0)!r}) instead of only "
        f"the logged entry. Agent body, '## What to do': 'Do not announce "
        f"a step before doing it.' On a direct run this is the AGENT's own "
        f"return, not the dispatcher's relay. Full text: {reply!r}"
    )

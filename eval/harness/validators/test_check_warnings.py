"""Skill-specific validators for the check-warnings skill.

check-warnings is a read-only analysis skill — it invokes the
`person_warnings` MCP tool (declared in allowed-tools) and surfaces
the results as narrative output. It does not modify research.json or
tree.gedcomx.json.

The rubric (rubric.md) keeps the narrative-judgment dimensions
(detection accuracy, severity classification, actionability). The
mechanical "didn't modify anything" rules live here.

Tool-usage enforcement is handled by the universal `test_tool_allowlist`,
which validates calls against the skill's `allowed-tools` frontmatter —
there is no separate `test_no_mcp_tools_called` here because check-warnings
legitimately calls `person_warnings` as its checking engine.

See test_universal.py module docstring for the full validator
function-signature contract.
"""

from __future__ import annotations

import pytest


# --- Read-only enforcement ---

def test_research_json_unmodified(before_state, after_state, test):
    """check-warnings must not modify research.json. The skill reports
    warnings as narrative output — the project file is read-only input.

    Skipped on negative tests: the LLM is expected to route away to
    another skill (e.g. conflict-resolution), which may legitimately
    modify project files as part of its own contract. Attributing those
    writes to check-warnings would be a false positive. Mirrors the
    same guard in test_project_status.py and test_universal.py's
    test_ownership_table.
    """
    if test.get("type") != "positive":
        pytest.skip("negative tests don't run the skill body")
    before = before_state.get("research_json")
    after = after_state.get("research_json")
    if before is None or after is None:
        pytest.skip("Missing research.json for diff")
    assert before == after, (
        "check-warnings modified research.json — this skill is read-only. "
        "Warnings should be reported as narrative, not written into the file."
    )


def test_tree_gedcomx_unmodified(before_state, after_state, test):
    """check-warnings must not modify tree.gedcomx.json either.

    Skipped on negative tests (see test_research_json_unmodified).
    """
    if test.get("type") != "positive":
        pytest.skip("negative tests don't run the skill body")
    before = (
        before_state.get("tree_gedcomx_json")
        or before_state.get("tree_gedcomx")
    )
    after = (
        after_state.get("tree_gedcomx_json")
        or after_state.get("tree_gedcomx")
    )
    if before is None or after is None:
        pytest.skip("Missing tree.gedcomx.json for diff")
    assert before == after, (
        "check-warnings modified tree.gedcomx.json — this skill is read-only."
    )


# --- V1: A not-FamilySearch-id answer is reported without naming the id ---

#: A sentence ends at . ! or ? followed by whitespace, or at a newline. NOT at
#: ; or : — the skill writes its quality line as "FamilySearch quality: …", and
#: splitting at the colon would separate that label from an id after it, so
#: "FamilySearch quality: none for I1." would pass rule (b). Caught by its own
#: must-fail vector before this landed.
_SENTENCE_SPLIT = r"(?<=[.!?])\s+|\n+"


def _not_fs_answers(tool_calls) -> tuple[list[str], list[str], int]:
    """(ids answered `not_familysearch_id`, their returned sentences, total
    person_quality calls)."""
    quality = [
        c for c in (tool_calls or [])
        if (c.get("tool") or "").endswith("person_quality")
    ]
    ids: list[str] = []
    sentences: list[str] = []
    for c in quality:
        resp = c.get("response")
        if isinstance(resp, dict) and resp.get("reason") == "not_familysearch_id":
            pid = str((c.get("args") or {}).get("personId", "")).strip()
            if pid:
                ids.append(pid)
            sentences += [str(e) for e in (resp.get("errors") or [])]
    return ids, sentences, len(quality)


#: Wording that characterises an id or its type — the leak itself. Every form
#: seen in committed or scratch replies: "synthetic ID" (the original 8 of 20),
#: "local project ID, not a FamilySearch person ID" (after the word "synthetic"
#: left the skill), and the false "does not have a FamilySearch ID".
_ID_TYPE_WORDING = (
    r"\bsynthetic\b|\blocal (?:project |tree )?id\b|\bproject id\b|\btree id\b|"
    r"\bnot a familysearch (?:person )?id\b|\bno familysearch id\b|"
    r"\bdoes(?:n't| not) have a familysearch id\b"
)
#: A heading line: markdown `#`, a bold-only line, or an all-caps label such as
#: the report template's "FAMILYSEARCH QUALITY:". A heading labels a section; it
#: is not a statement about the person.
_HEADING = r"^\s*(?:#{1,6}\s|\*\*[^*]+\*\*:?\s*$|[A-Z][A-Z ]+:)"


def test_not_fs_reply_names_no_id(tool_calls, text_response, test):
    """V1: when `person_quality` answers `not_familysearch_id`, the reply must not
    turn that into a remark about the id.

    Tier 1 — gates. The tool looks a project id up in the project tree and, for a
    person with no FamilySearch link, hands back one true sentence by name; the
    skill relays it. Fails if:
      (a) the reply characterises an id or its type, anywhere (`_ID_TYPE_WORDING`);
      (b) a non-heading sentence mentioning FamilySearch or quality names such an
          id as a whole token (`I1`, `(I1)`, `` `I1` ``, `I1.` — not `I10`).

    It polices the leak, not the layout. A heading above the sentence and true
    advice after it ("linking his profile to FamilySearch would give you a score")
    are allowed: across 15 scratch runs of the relayed-sentence design the skill
    wrote the tool's sentence verbatim every time and characterised the id in
    none, while a rule forbidding any extra FamilySearch sentence failed 13 of
    them for a heading or advice. Replayed before this landed: the design's 18
    replies pass; all 4 id-type leaks from the neutral-sentence round and all 8
    original "synthetic ID" leaks fail.

    Keyed on "FamilySearch"/"quality", never "linked" (check-warnings uses it for
    relationships). Splits at . ! ? and newlines, not at colons, so a quality
    label and an id after it stay in one sentence.

    Skipped on negative tests and on runs with no not-FamilySearch-id answer.
    """
    import re as _re

    if test.get("type") == "negative":
        pytest.skip("negative test — skill body does not run")
    ids, _sentences, _calls = _not_fs_answers(tool_calls)
    if not ids:
        pytest.skip("no person_quality answer for a non-FamilySearch id")
    response = text_response or ""
    sentences = [x for x in _re.split(_SENTENCE_SPLIT, response) if x.strip()]

    for sentence in sentences:
        if _re.search(_ID_TYPE_WORDING, sentence, _re.I):
            raise AssertionError(
                "the reply characterises an id or its type after person_quality "
                f"answered that it is not a FamilySearch id: {sentence.strip()!r}"
            )

    tokens = [_re.compile(rf"(?<![A-Za-z0-9]){_re.escape(i)}(?![A-Za-z0-9])", _re.I) for i in ids]
    for sentence in sentences:
        if _re.match(_HEADING, sentence):
            continue
        low = sentence.lower()
        if ("familysearch" in low or "quality" in low) and any(t.search(sentence) for t in tokens):
            raise AssertionError(
                "a sentence about FamilySearch quality names an id person_quality "
                f"answered as not a FamilySearch id: {sentence.strip()!r}"
            )


# --- V2: No unsourced 4-digit year in the response ---

def report_unsourced_year_in_response(tool_calls, text_response, test):
    """V2: every 4-digit year in the response must come from a tool response
    the run actually received, or from the user's own message. No arithmetic or
    tree knowledge the tool never returned.

    Tier 2 — reports, never gates.

    Reads `tool_calls[].response` — the response the mock actually returned and
    recorded (`mock_mcp.py`, all five `call_log.append` sites). Do NOT resolve
    `response_fixture` to a file under `eval/fixtures/mcp/` instead: the mock
    ENRICHES a fixture response after selecting it and before logging it, and
    `live`/`none` calls have no fixture file at all, so the fixture path cannot
    reproduce what the skill saw. `orchestrator._tool_call_entry` documents this
    and is why the run log keeps those responses.

    Skipped on negative tests: the skill body does not run so produces no
    figures of its own.

    Known looseness (acceptable at tier 2): the year pattern also matches
    4-digit non-years (record counts, ids), and membership is a substring test,
    so `1850` is considered sourced if the source text contains `18501`. Both
    err toward silence rather than a false observation.

    Shape copied from test_universal.report_unbacked_validation_claim.
    """
    import json as _json
    import re as _re

    if test.get("type") == "negative":
        pytest.skip("negative test — skill body does not run")
    response = text_response or ""
    if not response.strip():
        pytest.skip("no response text to check")

    years = set(_re.findall(r"\b\d{4}\b", response))
    if not years:
        return  # no 4-digit years in response

    # Everything the skill was legitimately given: the user's message plus
    # every tool response the run received.
    source_texts: list[str] = []

    # user_message is threaded into test by the orchestrator (issue #1965)
    user_message = test.get("user_message", "")
    if user_message:
        source_texts.append(user_message)

    for call in (tool_calls or []):
        if "response" not in call:
            continue
        source_texts.append(_json.dumps(call.get("response"), default=str))

    all_source = " ".join(source_texts)
    unsourced = sorted(y for y in years if y not in all_source)
    if unsourced:
        raise AssertionError(
            f"the response contains {unsourced} — 4-digit year(s) absent from "
            "every tool response this run received and from the user's "
            "message; SKILL.md forbids citing figures the tool never returned"
        )


# --- V3: Conflict-resolution handoff is completely silent ---

def test_conflict_resolution_handoff_is_silent(
    tool_calls, text_response, skills_invoked, test
):
    """V3: on a conflict-resolution silent-handoff test the run must make zero
    tool calls, return an empty response, and have 'conflict-resolution' in
    skills_invoked. All three must hold, or it is a violation.

    Tier 1 — gates (test_* prefix). Tag-gated: skips unless the test carries
    the 'silent-handoff' tag. Paired with negative.grade_on_invariant: true on
    negative-source-conflict.json, this hands the verdict to the validator and
    drops the judge to diagnostic — stopping the 1/1 grading on a byte-identical
    compliant run that occurred in 3 of 5 committed logs.

    SKILL.md absolutes:
      "Invoke the conflict-resolution skill right away ... as your first and
      only action"
      "Write no reply of your own — no preamble, no explanation, no summary."
    """
    if "silent-handoff" not in test.get("tags", []):
        pytest.skip("not a silent-handoff test")

    assert (tool_calls or []) == [], (
        "silent handoff must make zero tool calls; got "
        f"{len(tool_calls or [])} call(s): "
        + ", ".join(c.get("tool", "?") for c in (tool_calls or []))
    )
    assert not (text_response or "").strip(), (
        "silent handoff must produce an empty response; "
        f"got {len((text_response or '').strip())} non-whitespace characters"
    )
    assert "conflict-resolution" in (skills_invoked or []), (
        "silent handoff must invoke conflict-resolution via the Skill tool; "
        f"skills_invoked = {skills_invoked!r}"
    )
